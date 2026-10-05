#!/bin/bash
# 住宅 IP 网关入口：选节点 → OpenVPN 拨号 → microsocks SOCKS5 → 60秒自检
#
# 路由设计（v3）：
#   v1：uidrange 把 socks 用户所有出站（含回给客户端的回包）导入 tun0 → 回包黑洞。
#   v2：iptables 按目标打 mark，但标记链路实测不通（tunnel 本身 OK，标记后无数据）。
#   v3：回到验证过可用的 uidrange（v1 数据通路曾拿到真实出口 IP），但加三条
#       高优先级 `to <私网> → main` 规则（prio 999，在 uidrange prio 1000 之前），
#       让回给 SOCKS 客户端/Docker DNS 的包走主表，只把去公网的包导入 tun0。
#   1. 容器主默认路由永远不动（走 eth0 直连），选节点/DNS 等管理流量不受 VPN 影响。
#   2. VPN server IP 加 /32 主机路由走原网关 → OpenVPN 控制流量不进 tun0。
#   3. microsocks 以专用 socks 用户运行，公网出站经 table 100 走 tun0。
set -u

SOCKS_USER="${SOCKS_USER:-resuser}"
SOCKS_PASS="${SOCKS_PASS:?必须设置 SOCKS_PASS 环境变量}"
SOCKS_PORT="${SOCKS_PORT:-1080}"
CHECK_INTERVAL="${CHECK_INTERVAL:-60}"
RT_TABLE=100
RULE_PRIO=1000
RULE_PRIO_PRIV=999
# 私网/回环：发往这些目标的包走主表（回包给客户端、容器 DNS 等）
PRIVATE_NETS="127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16"
BAD_NODES_FILE="/tmp/bad_nodes.txt"

log() { echo "[gateway $(date '+%H:%M:%S')] $*"; }

ORIG_GW=""
ORIG_IF=""
SOCKS_UID=""
VPN_SRV=""
FALLBACK_DEFAULT=0

save_orig_route() {
  ORIG_GW=$(ip route show default 2>/dev/null | awk '{print $3}' | head -1)
  ORIG_IF=$(ip route show default 2>/dev/null | awk '{print $5}' | head -1)
  log "原始默认路由: via ${ORIG_GW:-?} dev ${ORIG_IF:-?}"
}

ensure_socks_user() {
  if ! id socks >/dev/null 2>&1; then
    useradd -r -s /usr/sbin/nologin socks 2>/dev/null || \
      log "WARN: 创建 socks 用户失败，将回退到默认路由模式"
  fi
  SOCKS_UID=$(id -u socks 2>/dev/null || echo "")
  [ -n "$SOCKS_UID" ] && log "socks 用户 UID=$SOCKS_UID"
}

# 解析 VPN 服务器 IP：首选 select_node.py 写出的节点 IP，兜底解析 ovpn
vpn_server_ip() {
  local ip host
  ip=$(awk -F'|' '{print $3; exit}' /tmp/vpn_node.txt 2>/dev/null)
  if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "$ip"; return 0
  fi
  host=$(awk '/^remote /{print $2; exit}' /tmp/vpn.ovpn 2>/dev/null)
  [ -z "$host" ] && return 1
  if [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "$host"; return 0
  fi
  getent hosts "$host" | awk '{print $1; exit}'
}

# 拨号失败的节点记入黑名单（select_node.py 会跳过），避免反复选中同一坏节点
blacklist_node() {
  [ -n "$VPN_SRV" ] || return 0
  if ! grep -qxF "$VPN_SRV" "$BAD_NODES_FILE" 2>/dev/null; then
    echo "$VPN_SRV" >> "$BAD_NODES_FILE" 2>/dev/null || true
    # 最多保留 100 条
    tail -100 "$BAD_NODES_FILE" > "${BAD_NODES_FILE}.tmp" 2>/dev/null && \
      mv "${BAD_NODES_FILE}.tmp" "$BAD_NODES_FILE" 2>/dev/null || true
    log "节点 $VPN_SRV 已加入黑名单"
  fi
}

# 清掉我们加的策略规则（按固定 priority 删，幂等）
clear_policy_rules() {
  local prio
  for prio in $RULE_PRIO_PRIV $RULE_PRIO $((RULE_PRIO+1)); do
    while ip rule del priority "$prio" 2>/dev/null; do :; done
  done
}

setup_policy_routing() {
  # 先清旧规则/旧路由（tun0 重建后必须重做）
  clear_policy_rules
  ip route flush table $RT_TABLE 2>/dev/null || true
  ip route add default dev tun0 table $RT_TABLE 2>/dev/null || {
    log "WARN: table $RT_TABLE 路由添加失败（需要 NET_ADMIN）"; return 1; }
  # 私网/回环目标走主表（回包给 SOCKS 客户端、Docker DNS），优先级高于 uidrange
  local net
  for net in $PRIVATE_NETS; do
    ip rule add to "$net" table main priority $RULE_PRIO_PRIV 2>/dev/null || {
      log "WARN: 私网策略规则添加失败"; return 1; }
  done
  # socks 用户其余出站（公网）走 tun0
  ip rule add uidrange "${SOCKS_UID}-${SOCKS_UID}" table $RT_TABLE \
    priority $RULE_PRIO 2>/dev/null || {
    log "WARN: uidrange 策略规则添加失败"; return 1; }
  # tun0 源地址的包也走 table 100（兜底）
  local tun_ip
  tun_ip=$(ip -4 addr show dev tun0 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)
  if [ -n "$tun_ip" ]; then
    ip rule add from "$tun_ip" table $RT_TABLE priority $((RULE_PRIO+1)) 2>/dev/null || true
  fi
  log "策略路由已建立（uidrange + 私网直通：socks 用户公网出站走 tun0，私网/回包走主表）"
  return 0
}

cleanup() {
  log "清理中..."
  pkill -f "openvpn.*vpn.ovpn" 2>/dev/null || true
  pkill microsocks 2>/dev/null || true
  # 删 VPN server /32 主机路由
  if [ -n "$VPN_SRV" ]; then
    ip route del "${VPN_SRV}/32" 2>/dev/null || true
  fi
  # 清策略路由表与规则
  ip route flush table $RT_TABLE 2>/dev/null || true
  clear_policy_rules
  # 回退模式下恢复被替换的主默认路由
  if [ "$FALLBACK_DEFAULT" = "1" ]; then
    if [ -n "$ORIG_GW" ] && [ -n "$ORIG_IF" ]; then
      ip route replace default via "$ORIG_GW" dev "$ORIG_IF" 2>/dev/null || true
      log "已恢复原始默认路由（回退模式）"
    fi
    FALLBACK_DEFAULT=0
  fi
  VPN_SRV=""
}
trap cleanup EXIT

connect_once() {
  log "获取 VPN Gate 节点列表..."
  if ! python3 /app/select_node.py; then
    log "节点选择失败"
    return 1
  fi
  # 关键修复：VPN server /32 走原网关，控制流量不进 tun0（防环路）
  VPN_SRV=$(vpn_server_ip)
  if [ -z "$VPN_SRV" ]; then
    log "无法解析 VPN 服务器地址"
    return 1
  fi
  log "VPN 服务器: $VPN_SRV"
  if [ -n "$ORIG_GW" ] && [ -n "$ORIG_IF" ]; then
    ip route replace "${VPN_SRV}/32" via "$ORIG_GW" dev "$ORIG_IF" 2>/dev/null || \
      log "WARN: VPN server 主机路由添加失败（需要 NET_ADMIN）"
  fi
  log "启动 OpenVPN..."
  openvpn --config /tmp/vpn.ovpn --dev tun0 --daemon --log /tmp/openvpn.log \
    --route-nopull --route-noexec 2>&1 | head -5 || true
  # 等待 tun0 出现（最多 30 秒）
  for i in $(seq 1 30); do
    ip link show tun0 >/dev/null 2>&1 && break
    sleep 1
  done
  if ! ip link show tun0 >/dev/null 2>&1; then
    log "tun0 未建立，查看日志："
    tail -20 /tmp/openvpn.log 2>/dev/null || true
    blacklist_node
    return 1
  fi
  log "tun0 已建立"
  # 策略路由：socks 用户公网出站走 tun0，私网/回包走主表
  if [ -n "$SOCKS_UID" ] && setup_policy_routing; then
    log "路由模式：策略路由（uidrange + 私网直通）"
  else
    # 确保无残留规则再回退
    clear_policy_rules
    ip route flush table $RT_TABLE 2>/dev/null || true
    log "WARN: 策略路由不可用，回退：默认路由走 tun0（server /32 例外已加）"
    ip route replace default dev tun0 2>/dev/null || \
      log "WARN: 设置默认路由失败（需要 NET_ADMIN）"
    FALLBACK_DEFAULT=1
  fi
  return 0
}

start_socks() {
  pkill microsocks 2>/dev/null || true
  sleep 1
  log "启动 SOCKS5 (0.0.0.0:${SOCKS_PORT}, 用户 ${SOCKS_USER})..."
  if [ -n "$SOCKS_UID" ]; then
    # 以 socks 用户运行 → 出站被策略路由导入 tun0
    setpriv --reuid="$SOCKS_UID" --regid="$SOCKS_UID" --clear-groups \
      microsocks -i 0.0.0.0 -p "${SOCKS_PORT}" -u "${SOCKS_USER}" -P "${SOCKS_PASS}" &
  else
    microsocks -i 0.0.0.0 -p "${SOCKS_PORT}" -u "${SOCKS_USER}" -P "${SOCKS_PASS}" &
  fi
  sleep 2
  if ! ss -tlnp 2>/dev/null | grep -q ":${SOCKS_PORT}"; then
    log "SOCKS5 启动失败"
    return 1
  fi
  log "SOCKS5 运行中"
  return 0
}

check_health() {
  # 以 socks 用户身份探测 → 流量走 tun0，测的是真实 VPN 出口
  local ip
  ip=$(get_exit_ip)
  if [ -z "$ip" ]; then
    log "健康检查失败：VPN 出口无响应"
    return 1
  fi
  log "健康检查 OK，当前出口 IP: $ip"
  return 0
}

# 以 socks 用户身份取真实 VPN 出口 IP（走 tun0）
get_exit_ip() {
  local ip
  if [ -n "$SOCKS_UID" ]; then
    ip=$(setpriv --reuid="$SOCKS_UID" --regid="$SOCKS_UID" --clear-groups \
      curl -s -m 15 https://api.ipify.org 2>/dev/null || \
      setpriv --reuid="$SOCKS_UID" --regid="$SOCKS_UID" --clear-groups \
      curl -s -m 15 https://ip.sb 2>/dev/null)
  else
    ip=$(curl -s -m 15 --interface tun0 https://api.ipify.org 2>/dev/null || \
         curl -s -m 15 --interface tun0 https://ip.sb 2>/dev/null)
  fi
  # 只接受纯 IPv4
  if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "$ip"
  fi
}

# 校验真实出口国家：拨号后验证一次。出口国与 COUNTRY 不符 → 拉黑重拨，
# 保证网关命名（日本/韩国/美国）与真实出口一致，绝不挂羊头卖狗肉。
verify_exit_country() {
  local want="${COUNTRY%%,*}"
  want=$(echo "$want" | tr 'a-z' 'A-Z' | tr -d ' ')
  if [ -z "$want" ]; then
    log "未设置 COUNTRY，跳过出口国家校验"
    return 0
  fi
  local ip cc
  ip=$(get_exit_ip)
  if [ -z "$ip" ]; then
    log "出口国家校验：拿不到出口 IP，稍后由健康检查处理"
    return 0
  fi
  # 走 VPN 出口查该 IP 的归属国（主 ip-api.com，备 ipapi.co）
  if [ -n "$SOCKS_UID" ]; then
    cc=$(setpriv --reuid="$SOCKS_UID" --regid="$SOCKS_UID" --clear-groups \
      curl -s -m 15 "http://ip-api.com/json/${ip}?fields=status,countryCode" 2>/dev/null | \
      grep -o '"countryCode":"[A-Z]*"' | cut -d'"' -f4)
    if [ -z "$cc" ]; then
      cc=$(setpriv --reuid="$SOCKS_UID" --regid="$SOCKS_UID" --clear-groups \
        curl -s -m 15 "https://ipapi.co/${ip}/country/" 2>/dev/null | tr -d ' \n\r')
    fi
  else
    cc=$(curl -s -m 15 --interface tun0 "http://ip-api.com/json/${ip}?fields=status,countryCode" 2>/dev/null | \
      grep -o '"countryCode":"[A-Z]*"' | cut -d'"' -f4)
    [ -z "$cc" ] && cc=$(curl -s -m 15 --interface tun0 "https://ipapi.co/${ip}/country/" 2>/dev/null | tr -d ' \n\r')
  fi
  cc=$(echo "$cc" | tr 'a-z' 'A-Z' | tr -d ' ')
  if [ -z "$cc" ]; then
    log "WARN: 出口国家查询失败（$ip），本次跳过校验"
    return 0
  fi
  if [ "$cc" != "$want" ]; then
    log "出口国家不符：期望 $want，实际 $cc（$ip），拉黑重拨"
    blacklist_node
    return 1
  fi
  log "出口国家校验通过：$cc（$ip）"
  return 0
}

# ---- 启动 ----
save_orig_route
ensure_socks_user

# 主循环
while true; do
  cleanup
  sleep 2
  if connect_once && start_socks && verify_exit_country; then
    log "网关已上线，开始健康检查（每 ${CHECK_INTERVAL}s）"
    fail_count=0
    while true; do
      sleep "${CHECK_INTERVAL}"
      if check_health; then
        fail_count=0
      else
        fail_count=$((fail_count + 1))
        log "健康检查失败 ${fail_count} 次"
        if [ "$fail_count" -ge 2 ]; then
          log "连续失败，重新拨号..."
          blacklist_node
          break
        fi
      fi
    done
  else
    log "连接失败，30 秒后重试..."
    sleep 30
  fi
done
