#!/bin/bash
# 住宅 IP 网关入口：选节点 → OpenVPN 拨号 → microsocks SOCKS5 → 60秒自检
#
# 路由设计（修复旧版环路 bug）：
#   旧 bug：--route-nopull --route-noexec 后直接把容器默认路由换成 tun0，
#           却没给 VPN server 留 /32 例外 → OpenVPN 控制流量进了 tun0 形成环路。
#   新设计：
#     1. 容器主默认路由永远不动（走 eth0 直连），选节点/DNS 等管理流量不受 VPN 影响，
#        VPN 断了也能重新拉节点（旧版 VPN 断 = 全断，连新节点都拉不到）。
#     2. VPN server IP 加 /32 主机路由走原网关 → OpenVPN 控制流量不进 tun0。
#     3. microsocks 以专用 socks 用户运行，策略路由（uidrange）只把它的出站流量
#        导入 table 100 走 tun0；其他流量一律走主表。
set -u

SOCKS_USER="${SOCKS_USER:-resuser}"
SOCKS_PASS="${SOCKS_PASS:?必须设置 SOCKS_PASS 环境变量}"
SOCKS_PORT="${SOCKS_PORT:-1080}"
CHECK_INTERVAL="${CHECK_INTERVAL:-60}"
RT_TABLE=100
RULE_PRIO=1000

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

# 清掉 table 100 相关的旧策略规则（按 priority 逐条删）
clear_table_rules() {
  ip rule show 2>/dev/null | grep -E "lookup ${RT_TABLE}([[:space:]]|$)" | \
    awk -F: '{print $1}' | while read -r prio; do
      ip rule del priority "$prio" 2>/dev/null || true
    done
}

setup_policy_routing() {
  # 先清旧规则/旧路由（tun0 重建后必须重做）
  clear_table_rules
  ip route flush table $RT_TABLE 2>/dev/null || true
  ip route add default dev tun0 table $RT_TABLE 2>/dev/null || {
    log "WARN: table $RT_TABLE 路由添加失败（需要 NET_ADMIN）"; return 1; }
  ip rule add uidrange "${SOCKS_UID}-${SOCKS_UID}" table $RT_TABLE \
    priority $RULE_PRIO 2>/dev/null || {
    log "WARN: uidrange 策略规则添加失败"; return 1; }
  # tun0 源地址的包也走 table 100（兜底，保证 --interface tun0 类探测可用）
  local tun_ip
  tun_ip=$(ip -4 addr show dev tun0 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)
  if [ -n "$tun_ip" ]; then
    ip rule add from "$tun_ip" table $RT_TABLE priority $((RULE_PRIO+1)) 2>/dev/null || true
  fi
  log "策略路由已建立（socks 用户出站走 tun0，主默认路由不动）"
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
  clear_table_rules
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
    return 1
  fi
  log "tun0 已建立"
  # 策略路由：仅 microsocks（socks 用户）出站走 tun0
  if [ -n "$SOCKS_UID" ] && setup_policy_routing; then
    log "路由模式：策略路由（推荐）"
  else
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
  if [ -n "$SOCKS_UID" ]; then
    ip=$(setpriv --reuid="$SOCKS_UID" --regid="$SOCKS_UID" --clear-groups \
      curl -s -m 15 https://api.ipify.org 2>/dev/null || \
      setpriv --reuid="$SOCKS_UID" --regid="$SOCKS_UID" --clear-groups \
      curl -s -m 15 https://ip.sb 2>/dev/null)
  else
    ip=$(curl -s -m 15 --interface tun0 https://api.ipify.org 2>/dev/null || \
         curl -s -m 15 --interface tun0 https://ip.sb 2>/dev/null)
  fi
  if [ -z "$ip" ]; then
    log "健康检查失败：VPN 出口无响应"
    return 1
  fi
  log "健康检查 OK，当前出口 IP: $ip"
  return 0
}

# ---- 启动 ----
save_orig_route
ensure_socks_user

# 主循环
while true; do
  cleanup
  sleep 2
  if connect_once && start_socks; then
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
          break
        fi
      fi
    done
  else
    log "连接失败，30 秒后重试..."
    sleep 30
  fi
done
