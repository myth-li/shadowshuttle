#!/usr/bin/env python3
"""从 hproxy 拉取免费 SOCKS5 非机房代理，输出 ShadowShuttle 网关配置格式。
用法: python3 fetch_hproxy.py [国家代码逗号分隔] [每国数量]
示例: python3 fetch_hproxy.py US,JP,KR,GB,DE 3
"""
import json
import sys
import urllib.request
from collections import defaultdict

API_URL = "https://hproxy.com/api/proxy-list?format=json"

def fetch():
    req = urllib.request.Request(API_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def main():
    countries = [c.strip().upper() for c in (sys.argv[1] if len(sys.argv) > 1 else "US,JP,KR,GB,DE,FR,CA,AU").split(",") if c.strip()]
    per_country = int(sys.argv[2]) if len(sys.argv) > 2 else 3

    data = fetch()
    proxies = data if isinstance(data, list) else data.get("proxies", data.get("data", []))

    # 过滤：SOCKS5 + 非机房 + 高可用
    good = []
    for p in proxies:
        protos = [x.lower() for x in (p.get("protocols") or [])]
        if "socks5" not in protos:
            continue
        if p.get("is_datacenter"):
            continue
        uptime = float(p.get("uptime_24h") or 0)
        if uptime < 80:
            continue
        cc = (p.get("country_code") or "").upper()
        if cc not in countries:
            continue
        good.append({
            "ip": p.get("ip"),
            "port": p.get("port"),
            "cc": cc,
            "city": p.get("city", ""),
            "uptime": uptime,
            "latency": p.get("latency_ms"),
        })

    # 按国家分组，每国取前 N 个（按 uptime 排序）
    by_cc = defaultdict(list)
    for g in good:
        by_cc[g["cc"]].append(g)
    for cc in by_cc:
        by_cc[cc].sort(key=lambda x: -x["uptime"])

    print(f"# hproxy 多国网关（共 {len(good)} 个可用）", flush=True)
    for cc in countries:
        lst = by_cc.get(cc, [])[:per_country]
        for p in lst:
            # 格式：备注#host:port（无认证）
            name = f"{cc}-{p['city']}" if p['city'] else cc
            print(f"{name}# {p['ip']}:{p['port']}")
        if not lst:
            print(f"# {cc}: 暂无可用节点", flush=True)

if __name__ == "__main__":
    main()
