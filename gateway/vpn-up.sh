#!/bin/bash
# OpenVPN --up hook：tun0 每次(重)建后重建 table 100 的默认路由。
#
# 背景：openvpn 以 --route-nopull --route-noexec 运行，不会自动管理路由；
# ping-restart（约每小时）会关闭重开 tun0，内核随之删掉 table 100 里指向
# tun0 的路由。若不补回，socks 用户流量命中 prio 1000 规则查表失败后回落
# 到 main 表，从本机 eth0 直连外泄（2026-10-05 实测出口变成 GCP 本机 IP）。
# 策略规则（ip rule）不受 tun0 开关影响，无需在此重建。
set -u
RT_TABLE="${RT_TABLE:-100}"
DEV="${dev:-tun0}"
if ip route replace default dev "$DEV" table "$RT_TABLE" 2>/dev/null; then
  echo "[vpn-up $(date '+%H:%M:%S')] table $RT_TABLE 已重建 default dev $DEV"
else
  echo "[vpn-up $(date '+%H:%M:%S')] WARN: table $RT_TABLE 路由重建失败"
fi
