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

- **三协议全支持**：VLESS、Trojan、Shadowsocks（AES-128-GCM / AES-256-GCM / ChaCha20-Poly1305）全部跑在 WebSocket 上，一个 Worker 全搞定
- **优选 IP 订阅**：来源 URL 自动抓取 + 静态列表，去重聚合，每个 IP 自动生成 VLESS / Trojan / SS 三个节点
- **看得懂的节点名**：`🇺🇸 美国 01`、`🇭🇰 香港 02` —— 国旗 emoji + 中文国名（内置约 240 项映射）+ 全局序号，订阅里一眼找到想要的线路
- **三种订阅格式**：通用 base64（v2rayN / Shadowrocket）、Clash YAML、sing-box JSON，一次配置多端通用
- **现代简约管理面板**：无外部依赖、单文件离线可用；多用户、密码、优选 IP 源、回落 IP、伪装页全部可视化配置
- **智能回落**：出站直连失败时自动用 proxyIP 重试一次；伪装首页让扫描器无功而返
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
| trojanPassword / ssPassword / ssMethod | Trojan 密码；SS 密码与加密方式 |
| preferredSources | 优选 IP 源 URL（每行一个；文本源每行一个 IP，抓取结果 KV 缓存 6 小时） |
| preferredStatic | 静态优选 IP（每行一个） |
| proxyIP | 出站直连失败时的回落 IP（可选） |
| nodePort | 订阅节点端口（默认 443） |
| disguiseHTML | 伪装首页 HTML（默认 nginx 风格，可自定义） |
| subPath | 订阅路径（默认 `/{SUB_TOKEN}`） |

## 📡 订阅地址

| 格式 | 地址 | 适用客户端 |
|---|---|---|
| 通用 base64 | `https://<域名>/{SUB_TOKEN}` | v2rayN / v2rayNG / Shadowrocket |
| Clash | `https://<域名>/{SUB_TOKEN}/clash` | Clash / ClashMeta |
| sing-box | `https://<域名>/{SUB_TOKEN}/singbox` | sing-box / SFA |

## 🗺 路由一览

| 路径 | 说明 |
|---|---|
| `GET /` | 伪装首页 |
| `GET /login` · `POST /api/login` | 登录（Cookie `ss_session`，KV token 1 小时过期） |
| `GET /admin` | 管理面板（未登录跳转 `/login`） |
| `GET/POST /api/config` · `/api/logout` | 读写配置 / 登出（需登录） |
| WS `/{UUID}` | VLESS（含 early data） |
| WS `/trojan` | Trojan（sha224 hex 验密码，常量时间比较） |
| WS `/ss` | Shadowsocks AEAD |

## 🧪 自测

纯逻辑部分有 node 自测脚本（不依赖 Workers API），提交前已全量通过：

```bash
node test.mjs   # 45 项：RFC 8439 向量、node:crypto 交叉验证、协议头解析、订阅拼装…
```

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

- **All three protocols**: VLESS, Trojan, Shadowsocks (AES-128-GCM / AES-256-GCM / ChaCha20-Poly1305) over WebSocket — one Worker does it all
- **Preferred-IP subscriptions**: auto-fetch from source URLs + static list, deduplicated; every IP becomes 3 nodes (one per protocol)
- **Readable node names**: `🇺🇸 United States 01` — flag emoji + Chinese country name (built-in ~240-entry map) + global sequence number
- **3 subscription formats**: generic base64 (v2rayN / Shadowrocket), Clash YAML, sing-box JSON
- **Modern minimal admin panel**: no external CDN, works offline as a single file; manage users, passwords, IP sources, fallback IP and disguise page visually
- **Smart fallback**: retries once via `proxyIP` when direct outbound fails; disguise homepage shrugs off scanners
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
`ssPassword`, `ssMethod`, `preferredSources`, `preferredStatic`, `proxyIP`, `nodePort`,
`disguiseHTML`, `subPath`.

## 📡 Subscriptions

- `https://<domain>/{SUB_TOKEN}` — generic base64 (v2rayN / Shadowrocket)
- `https://<domain>/{SUB_TOKEN}/clash` — Clash YAML
- `https://<domain>/{SUB_TOKEN}/singbox` — sing-box JSON

## 🧪 Tests

```bash
node test.mjs   # 45 checks: RFC 8439 vectors, node:crypto cross-validation, header parsing, subscription building…
```

## ⚠️ Limitations

- No UDP sockets in Workers: only DNS (port 53) is relayed via DoH; other UDP is gracefully closed without breaking TCP.
- GeoIP via `ip-api.com` free tier (45 req/min), cached in KV for 30 days; unknown IPs show as `🌐 未知` and are backfilled asynchronously.

## 📄 License

MIT — see [LICENSE](https://github.com/myth-li/shadowshuttle/blob/main/LICENSE).
Stars ⭐, issues and PRs are welcome.
