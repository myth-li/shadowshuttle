# 影梭 ShadowShuttle

> **单文件、零依赖的 Cloudflare Worker 代理** —— VLESS / Trojan / Shadowsocks 三协议 over WebSocket，
> 优选 IP 自动聚合订阅，节点按 `🇺🇸 美国 01` 格式命名，3 分钟部署上线。

<p>
  <a href="https://github.com/myth-li/shadowshuttle/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/myth-li/shadowshuttle?style=flat"></a>
  <a href="https://github.com/myth-li/shadowshuttle/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/github/license/myth-li/shadowshuttle"></a>
</p>

[English version](#english) | [问题反馈](https://github.com/myth-li/shadowshuttle/issues)

---

## ✨ 功能亮点

- **三协议 + 三传输**：VLESS、Trojan、Shadowsocks（AES-128-GCM / AES-256-GCM / ChaCha20-Poly1305），跑在 WebSocket / gRPC / XHTTP 上，一个 Worker 全搞定
- **优选 IP 全都要**：静态列表（`IP` / `IP:端口` / `IP#备注`）+ URL 文本源 + `sub://` 聚合源 + **内置随机生成器**（从 Cloudflare 公开 IP 段随机抽取，默认 16 个，零配置可用）
- **看得懂的节点名**：`🇺🇸 美国 01`、`🇭🇰 香港 02` —— 国旗 emoji + 中文国名（内置约 240 项映射）+ 全局序号，归属地自动查询 + KV 缓存 30 天
- **六种订阅格式**：通用 base64、Clash、sing-box、Surge、Quantumult X、Loon；`?target=` 指定、UA 自动识别；`?sub=` 再聚合一个外部订阅；多 HOST 轮换；`/{KEY}` 快速订阅
- **链式代理出站**：SOCKS5 / HTTP 代理链，可配账号密码与域名白名单；拨号顺序直连 → 代理链 → PROXYIP 回落
- **现代管理面板**：深色模式、订阅二维码、折叠卡片、状态仪表盘、3 步引导；请求日志、TG 推送、CF 用量查询、优选源一键验证全部可视化
- **clean-room 自研**：只参考公开协议规范逐行手写，SHA-224 / ChaCha20-Poly1305 等 Workers 缺失的算法全部内置实现

## 📸 截图

| 管理面板 | 订阅节点 |
|---|---|
| ![管理面板](docs/screenshot-admin.png) | ![订阅节点](docs/screenshot-nodes.png) |

> 截图待补充（docs/ 目录占位）。

## 🚀 3 步部署

**第 1 步** —— Cloudflare Dashboard → Workers & Pages → Create Worker → Deploy → **Edit code**，
把 [`_worker.js`](https://github.com/myth-li/shadowshuttle/blob/main/_worker.js) 全文粘贴进去，**Deploy**。

**第 2 步** —— Settings → Variables and Secrets，添加三个变量：

| 变量 | 说明 |
|---|---|
| `ADMIN` | 后台密码（`/login` 用） |
| `UUID` | VLESS 主 UUID（标准 8-4-4-4-12 格式） |
| `SUB_TOKEN` | 订阅路径 token（随机长字符串，猜不到才安全） |

**第 3 步** —— 绑定 KV：Variables and Secrets → KV namespace bindings → Add binding，
Variable name 填 `KV`（没有 namespace 先去 Storage & databases → KV 新建一个）。
打开 `https://<你的域名>/login` 登录管理面板，开始添加优选 IP。

> 💡 先在新 Worker 上测好，确认没问题再把正式域名切过来；有线上业务的 Worker 不要直接覆盖。

<details>
<summary>用 wrangler 部署（可选）</summary>

```bash
npm i -g wrangler && wrangler login
# 填好 wrangler.toml 里的 KV namespace id
wrangler kv namespace create KV
wrangler secret put ADMIN
wrangler secret put UUID
wrangler secret put SUB_TOKEN
wrangler deploy
```

</details>

## ⚙️ 配置说明

`ADMIN` / `UUID` / `SUB_TOKEN` 只从 Worker Variables 读取；其余在管理面板里改，
存 KV（key `ss:config`），Variables 做兜底：

| 配置项 | 说明 |
|---|---|
| multiUUID | 多用户 UUID 数组（除主 UUID 外的合法用户） |
| trojanPassword / ssPassword / ssMethod | Trojan 密码；SS 密码与加密方式（密码留空=不修改） |
| ssAltPort | SS 非 TLS 备用端口（如 80，0=关闭） |
| subKey | 快速订阅 KEY，`/{KEY}` 直达订阅（空=不启用） |
| hosts | 多 HOST 轮换（空=用请求 host） |
| nodePort | 订阅节点端口（默认 443） |
| earlyData / fragment | 0RTT（`ed=2048`）/ TLS 分片开关，拼进订阅链接 |
| preferredSources | 优选 IP 源（每行一个；`https://` 文本源 / `sub://` 聚合源，KV 缓存 6 小时） |
| preferredStatic | 静态优选 IP（每行一个；支持 `IP` / `IP:端口` / `IP#备注`） |
| randIPCount / randIPPort | 内置随机优选 IP 数量（默认 16，0=关闭）与端口 |
| proxyIP | 出站失败时的回落 IP（可选） |
| chainEnabled / chainType / chainHost / chainPort / chainUser / chainPass | 链式代理开关、类型（socks5/http）、地址、端口、账号密码 |
| chainWhitelist | 链式代理域名白名单（空=全部走链） |
| logEnabled | KV 请求日志开关 |
| tgEnabled / tgBotToken / tgChatId | Telegram 推送开关与配置 |
| cfApiToken / cfAccountId | Cloudflare API Token 与 Account ID（用量查询） |
| disguiseHTML | 伪装首页 HTML（默认极简 404，可自定义） |
| subPath | 订阅路径（默认 `/{SUB_TOKEN}`） |

## 📡 订阅地址

| 格式 | 地址 | 适用客户端 |
|---|---|---|
| 通用 base64 | `https://<域名>/{SUB_TOKEN}` | v2rayN / v2rayNG / Shadowrocket |
| Clash | `https://<域名>/{SUB_TOKEN}/clash` | Clash / ClashMeta / Stash |
| sing-box | `https://<域名>/{SUB_TOKEN}/singbox` | sing-box / SFA |
| Surge | `https://<域名>/{SUB_TOKEN}/surge` | Surge |
| Quantumult X | `https://<域名>/{SUB_TOKEN}/quanx` | Quantumult X |
| Loon | `https://<域名>/{SUB_TOKEN}/loon` | Loon |

> `?target=` 可强制指定格式（如 `?target=clash`）；不带后缀时按客户端 UA 自动识别。
> `?sub=<url>` 可再聚合一个外部订阅的节点。设了 `subKey` 后也可用 `/{KEY}` 系列短路径。

## 🗺 路由一览

| 路径 | 说明 |
|---|---|
| `GET /` | 伪装首页（默认极简 404） |
| `GET /login` · `POST /api/login` | 登录（Cookie `ss_session`，KV token 1 小时过期） |
| `GET /admin` | 管理面板（未登录跳转 `/login`；深色模式/二维码/引导） |
| `GET/POST /api/config` · `/api/logout` | 读写配置 / 登出（需登录） |
| `GET /api/logs` · `/api/test-source` · `/api/cf-usage` · `/api/check-proxy` | 日志 / 优选源验证 / CF 用量 / 代理检查（需登录） |
| WS `/{UUID}` | VLESS（含 early data） |
| WS `/trojan` | Trojan（sha224 hex 验密码，常量时间比较） |
| WS `/ss` | Shadowsocks AEAD |
| `POST` + `application/grpc` | gRPC 传输（VLESS/Trojan，TCP） |
| `POST` + `x-padding` 头或 `?xhttp=` | XHTTP 传输（stream-one 基础模式） |

## 🧪 自测

纯逻辑部分有 node 自测脚本（不依赖 Workers API），提交前已全量通过：

```bash
node test.mjs   # 113 项：RFC 8439 向量、node:crypto 交叉验证、协议头解析、
                # gRPC 帧、SOCKS5 握手字节、订阅拼装（6 格式）、单 IP 解析、CIDR 随机…
```

版本变更记录见 [CHANGELOG.md](https://github.com/myth-li/shadowshuttle/blob/main/CHANGELOG.md)。

## ⚠️ 已知限制

- Workers 无 UDP socket：仅 DNS（目的 53 端口）经 DoH 中继，其他 UDP 优雅关闭、不影响 TCP。
- IP 归属地走 `ip-api.com` 免费接口（45 次/分钟限流），结果 KV 缓存 30 天；查不到的显示 `🌐 未知`，后台异步补齐。
- SS AEAD nonce 为 12 字节小端递增（shadowsocks-rust / v2ray 事实标准）。

## 📄 License

MIT —— 详见 [LICENSE](https://github.com/myth-li/shadowshuttle/blob/main/LICENSE)。
欢迎 star ⭐、提 issue 和 PR。

---

<a id="english"></a>
# ShadowShuttle (English)

> **A single-file, zero-dependency Cloudflare Worker proxy** — VLESS / Trojan / Shadowsocks over WebSocket,
> with preferred-IP subscription auto-aggregation and nodes named like `🇺🇸 United States 01`. Deploy in 3 minutes.

## ✨ Highlights

- **3 protocols × 3 transports**: VLESS, Trojan, Shadowsocks (AES-128-GCM / AES-256-GCM / ChaCha20-Poly1305) over WebSocket / gRPC / XHTTP — one Worker does it all
- **Every preferred IP**: static list (`IP` / `IP:port` / `IP#remark`) + URL text sources + `sub://` aggregation + **built-in random generator** (random picks from Cloudflare's public ranges, 16 by default, zero-config)
- **Readable node names**: `🇺🇸 United States 01` — flag emoji + Chinese country name (built-in ~240-entry map) + global sequence number, geo-lookup with 30-day KV cache
- **6 subscription formats**: generic base64, Clash, sing-box, Surge, Quantumult X, Loon; `?target=` override, UA auto-detect; `?sub=` merges another subscription; multi-HOST rotation; `/{KEY}` quick path
- **Chained outbound**: SOCKS5 / HTTP proxy chaining with auth + domain whitelist; dial order direct → chain → PROXYIP fallback
- **Modern admin panel**: dark mode, QR codes, collapsible cards, status dashboard, 3-step guide; request logs, Telegram push, CF usage meter, one-click source validation
- **Clean-room implementation**: hand-written from public protocol specs only; missing Workers primitives (SHA-224, ChaCha20-Poly1305) implemented in pure JS

## 🚀 Deploy in 3 steps

**1.** Cloudflare Dashboard → Workers & Pages → Create Worker → Deploy → **Edit code**,
paste the whole [`_worker.js`](https://github.com/myth-li/shadowshuttle/blob/main/_worker.js), **Deploy**.

**2.** Settings → Variables and Secrets, add:
`ADMIN` (panel password), `UUID` (main VLESS UUID), `SUB_TOKEN` (random subscription path token).

**3.** Bind KV: Add binding with Variable name `KV` (create a namespace under Storage & databases → KV first).
Open `https://<your-domain>/login` and add your preferred IPs.

> 💡 Test on a fresh Worker first; only then switch your production domain over.

## ⚙️ Configuration

`ADMIN` / `UUID` / `SUB_TOKEN` come from Worker Variables only. Everything else is editable
in the admin panel and stored in KV (key `ss:config`): `multiUUID`, `trojanPassword`,
`ssPassword`, `ssMethod`, `ssAltPort`, `subKey`, `hosts`, `nodePort`, `earlyData`, `fragment`,
`preferredSources` (`https://` / `sub://`), `preferredStatic` (`IP` / `IP:port` / `IP#remark`),
`randIPCount`, `randIPPort`, `proxyIP`, chain proxy settings (`chainEnabled`/`chainType`/`chainHost`/`chainPort`/`chainUser`/`chainPass`/`chainWhitelist`),
`logEnabled`, `tgEnabled`/`tgBotToken`/`tgChatId`, `cfApiToken`/`cfAccountId`,
`disguiseHTML`, `subPath`. Password fields are never echoed back; empty = keep.

## 📡 Subscriptions

- `https://<domain>/{SUB_TOKEN}` — generic base64 (v2rayN / Shadowrocket)
- `https://<domain>/{SUB_TOKEN}/clash` — Clash YAML
- `https://<domain>/{SUB_TOKEN}/singbox` — sing-box JSON
- `https://<domain>/{SUB_TOKEN}/surge` — Surge
- `https://<domain>/{SUB_TOKEN}/quanx` — Quantumult X
- `https://<domain>/{SUB_TOKEN}/loon` — Loon

`?target=` forces a format; otherwise the client UA is sniffed. `?sub=<url>` merges an
external subscription. `/{KEY}` short paths work when `subKey` is set.

## 🧪 Tests

```bash
node test.mjs   # 113 checks: RFC 8439 vectors, node:crypto cross-validation, header parsing,
                # gRPC framing, SOCKS5 handshake bytes, 6-format subscription building…
```

See [CHANGELOG.md](https://github.com/myth-li/shadowshuttle/blob/main/CHANGELOG.md) for version history.

## ⚠️ Limitations

- No UDP sockets in Workers: only DNS (port 53) is relayed via DoH; other UDP is gracefully closed without breaking TCP.
- GeoIP via `ip-api.com` free tier (45 req/min), cached in KV for 30 days; unknown IPs show as `🌐 未知` and are backfilled asynchronously.

## 📄 License

MIT — see [LICENSE](https://github.com/myth-li/shadowshuttle/blob/main/LICENSE).
Stars ⭐, issues and PRs are welcome.
