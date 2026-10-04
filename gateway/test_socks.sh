#!/bin/bash
# 网关 SOCKS5 端到端测试：在宿主机上经每个端口做完整 SOCKS5 握手 + 出口 IP 查询
# 用法：bash /opt/resgateway/test_socks.sh
# （Cloud Shell 终端长命令输入不可靠，故做成脚本文件，用短命令调用）
set -u
cd /opt/resgateway || exit 2
set -a; source .env 2>/dev/null; set +a
U="${SOCKS_USER:-resuser}"
P="${SOCKS_PASS:?SOCKS_PASS 未设置}"
fail=0
for port in 1080 1081 1082; do
  out=$(curl -s -m 25 --socks5-hostname "127.0.0.1:$port" \
    -U "$U:$P" https://api.ipify.org 2>&1)
  code=$?
  if [ $code -eq 0 ] && [[ "$out" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "port $port OK exit=$out"
  else
    echo "port $port FAIL curl_exit=$code out=${out:0:120}"
    fail=1
  fi
done
exit $fail
