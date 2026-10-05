#!/bin/bash
# 网关容器内诊断：区分"隧道本身通不通"和"策略路由通不通"
# 用法：docker cp diag_in.sh <容器>:/tmp/diag_in.sh && docker exec <容器> bash /tmp/diag_in.sh
echo "=== 1. tun0 状态 ==="
ip addr show tun0 2>&1 | head -6
echo "=== 2. ip rule ==="
ip rule show 2>&1
echo "=== 3. iptables mangle OUTPUT（含计数器）==="
iptables -t mangle -L OUTPUT -n -v 2>&1
echo "=== 4. table 100 路由 ==="
ip route show table 100 2>&1
echo "=== 5. 当前节点 ==="
cat /tmp/vpn_node.txt 2>&1
echo "bad_nodes: $(wc -l < /tmp/bad_nodes.txt 2>/dev/null || echo 0)"
echo "=== 6. root 直连（不经隧道，测容器基础出网）==="
curl -s -m 10 https://api.ipify.org 2>&1; echo " [rc=$?]"
echo "=== 7. root 经 tun0（测隧道本身通不通）==="
curl -s -m 10 --interface tun0 https://api.ipify.org 2>&1; echo " [rc=$?]"
echo "=== 8. socks 用户经策略路由（测标记+table100 通不通）==="
SUID=$(id -u socks 2>/dev/null)
if [ -n "$SUID" ]; then
  setpriv --reuid=$SUID --regid=$SUID --clear-groups curl -s -m 10 https://api.ipify.org 2>&1; echo " [rc=$?]"
else
  echo "无 socks 用户"
fi
echo "=== 9. openvpn 日志尾 ==="
tail -12 /tmp/openvpn.log 2>&1
