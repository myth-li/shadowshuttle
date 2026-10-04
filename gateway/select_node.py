#!/usr/bin/env python3
"""VPN Gate 节点选择器：从 vpngate.net API 获取服务器列表，
按国家偏好和评分选出最优节点，输出 OpenVPN 配置文件。
"""
import base64
import csv
import io
import os
import sys
import urllib.request

API_URL = "https://www.vpngate.net/api/iphone/"
OUTPUT = "/tmp/vpn.ovpn"

def fetch_csv():
    req = urllib.request.Request(API_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="ignore")

def parse_servers(text):
    # 去掉注释行（# 开头）和末尾的 * 行
    lines = [l for l in text.splitlines() if l and not l.startswith("#") and not l.startswith("*")]
    if not lines:
        return []
    reader = csv.DictReader(io.StringIO("\n".join(lines)))
    servers = []
    for row in reader:
        try:
            cfg_b64 = (row.get("OpenVPN_ConfigData_Base64") or "").strip()
            if not cfg_b64:
                continue
            servers.append({
                "host": row.get("HostName", ""),
                "ip": row.get("IP", ""),
                "score": int(row.get("Score") or 0),
                "ping": int(row.get("Ping") or 9999),
                "speed": int(row.get("Speed") or 0),
                "country": (row.get("CountryShort") or "").upper(),
                "country_long": row.get("CountryLong", ""),
                "sessions": int(row.get("NumVpnSessions") or 0),
                "uptime": int(row.get("Uptime") or 0),
                "config_b64": cfg_b64,
            })
        except (ValueError, TypeError):
            continue
    return servers

def pick_best(servers, countries):
    """按国家偏好顺序 + 评分选最优。要求：uptime > 1小时，sessions < 50（别太挤）"""
    cands = [s for s in servers if s["country"] in countries and s["uptime"] > 3600_000 and s["sessions"] < 50]
    if not cands:
        # 放宽条件：只要国家对
        cands = [s for s in servers if s["country"] in countries]
    if not cands:
        # 兜底：首选国家无节点时，用任意可用节点（保证网关不断线）
        cands = [s for s in servers if s["uptime"] > 3600_000 and s["sessions"] < 50]
    if not cands:
        cands = servers  # 最后兜底：只要有节点就用
    if not cands:
        return None
    order = {c: i for i, c in enumerate(countries)}
    cands.sort(key=lambda s: (order.get(s["country"], 99), -s["score"]))
    return cands[0]

def main():
    countries = [c.strip().upper() for c in os.environ.get("COUNTRY", "JP,KR,US").split(",") if c.strip()]
    print(f"[selector] 国家偏好: {countries}", flush=True)
    text = fetch_csv()
    servers = parse_servers(text)
    print(f"[selector] 获取到 {len(servers)} 个节点", flush=True)
    best = pick_best(servers, countries)
    if not best:
        print("[selector] 没有找到符合条件的节点", flush=True)
        sys.exit(1)
    print(f"[selector] 选中: {best['country_long']} ({best['country']}) {best['ip']} "
          f"score={best['score']} ping={best['ping']} sessions={best['sessions']}", flush=True)
    cfg = base64.b64decode(best["config_b64"]).decode("utf-8", errors="ignore")
    # 强制关键选项：后台运行由外部控制，这里只确保配置可用
    with open(OUTPUT, "w") as f:
        f.write(cfg)
    # 把选中的节点信息写出来给 entrypoint 用
    with open("/tmp/vpn_node.txt", "w") as f:
        f.write(f"{best['country']}|{best['country_long']}|{best['ip']}|{best['score']}\n")
    print(f"[selector] 配置已写入 {OUTPUT}", flush=True)

if __name__ == "__main__":
    main()
