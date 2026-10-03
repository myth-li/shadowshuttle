#!/bin/bash
# 住宅 IP 网关入口：选节点 → OpenVPN 拨号 → microsocks SOCKS5 → 60秒自检
set -u

SOCKS_USER="${SOCKS_USER:-resuser}"
SOCKS_PASS="${SOCKS_PASS:?必须设置 SOCKS_PASS 环境变量}"
SOCKS_PORT="${SOCKS_PORT:-1080}"
CHECK_INTERVAL="${CHECK_INTERVAL:-60}"

log() { echo "[gateway $(date '+%H:%M:%S')] $*"; }

cleanup() {
  log "清理中..."
  pkill -f "openvpn.*vpn.ovpn" 2>/dev/null || true
  pkill microsocks 2>/dev/null || true
}
trap cleanup EXIT

connect_once() {
  log "获取 VPN Gate 节点列表..."
  if ! python3 /app/select_node.py; then
    log "节点选择失败"
    return 1
  fi
  # 给 UDP 留出路：VPN Gate 常用 UDP 端口，TCP 443 备用（配置里自带）
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
  # 拿到 VPN 分配的网关 IP，做策略路由：只让 microsocks 的流量走 tun0
  # 简化方案：容器内默认路由走 tun0（容器网络命名空间隔离，不影响宿主机 SSH）
  VPN_GW=$(ip route show dev tun0 2>/dev/null | awk '/scope link/ {print $1}' | head -1)
  log "tun0 已建立"
  ip route replace default dev tun0 2>/dev/null || log "设置默认路由失败（可能需要 NET_ADMIN）"
  return 0
}

start_socks() {
  pkill microsocks 2>/dev/null || true
  sleep 1
  log "启动 SOCKS5 (0.0.0.0:${SOCKS_PORT}, 用户 ${SOCKS_USER})..."
  microsocks -i 0.0.0.0 -p "${SOCKS_PORT}" -u "${SOCKS_USER}" -P "${SOCKS_PASS}" &
  sleep 2
  if ! ss -tlnp 2>/dev/null | grep -q ":${SOCKS_PORT}"; then
    log "SOCKS5 启动失败"
    return 1
  fi
  log "SOCKS5 运行中"
  return 0
}

check_health() {
  # 通过 tun0 检查出口 IP（走 VPN）
  local ip
  ip=$(curl -s -m 15 --interface tun0 https://ip.sb 2>/dev/null || \
       curl -s -m 15 --interface tun0 https://api.ipify.org 2>/dev/null)
  if [ -z "$ip" ]; then
    log "健康检查失败：tun0 无出口"
    return 1
  fi
  log "健康检查 OK，当前出口 IP: $ip"
  return 0
}

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
