# myth-tunnel
Self-built Cloudflare Worker proxy (VLESS / Trojan / Shadowsocks) with preferred-IP subscription

自研单文件 Cloudflare Worker 代理：VLESS / Trojan / Shadowsocks over WebSocket，
带优选 IP 订阅（节点名自动标注国旗+中文国名+序号）与现代简约风管理面板。
clean-room 实现，只参考公开协议规范编写。

## 功能

- **三协议**：VLESS、Trojan、Shadowsocks（AEAD：aes-128-gcm / aes-256-gcm / chacha20-ietf-poly1305）over WebSocket
- **优选 IP 订阅**：来源 URL 抓取 + 静态列表，去重后每个 IP 生成 VLESS / Trojan / SS 三个节点
- **节点命名**：`🇺🇸 美国 01` —— 国旗 emoji + 中文国名（内置约 240 项映射表）+ 全局两位序号
- **三种订阅格式**：通用 base64（v2rayN / Shadowrocket）、Clash YAML、sing-box JSON
- **管理面板**：现代简约风格（无外部 CDN，单文件离线可用），可改多用户、密码、优选 IP 源、回落 IP、伪装页等
- **出站**：`cloudflare:sockets` TCP 直连；直连失败且配了 proxyIP 时回落重试一次
- **UDP**：仅 DNS（53 端口）经 DoH 中继，其余 UDP 优雅关闭、不断 TCP

## 快速部署（dashboard 粘贴，推荐）

1. 打开 [Cloudflare dashboard](https://dash.cloudflare.com) → Workers & Pages → Create → Create Worker → Deploy
2. 点 **Edit code**，把本仓库 `_worker.js` 的全部内容粘贴进去，**Deploy**
3. 左侧 Settings → Variables and Secrets → 添加明文变量（Add variable）：
   - `ADMIN`：后台密码（必填，建议同时在面板里改复杂）
   - `UUID`：VLESS 主 UUID（必填，用 `uuidgen` 或在线生成标准格式）
   - `SUB_TOKEN`：订阅路径 token（必填，随机长字符串，别人猜不到订阅地址）
4. **绑定 KV**（Variables and Secrets → KV namespace bindings → Add binding）：
   - Variable name 填 `KV`，选你的 namespace（没有就先去 Storage & databases → KV 新建一个）
   - 不绑也能跑，但面板配置改完重启会丢，且会失去优选 IP 缓存与 GeoIP 缓存
5. 访问 `https://<你的worker域名>/login`，用 ADMIN 密码登录管理面板

> 先在新 Worker 上测好，确认没问题再把正式域名（如 dpdns.org 的路由）切过来；
> 线上已有业务的 Worker 不要直接覆盖。

## wrangler 部署

```bash
npm i -g wrangler
wrangler login
# 填好 wrangler.toml 里的 KV namespace id
wrangler kv namespace create KV
wrangler secret put ADMIN
wrangler secret put UUID
wrangler secret put SUB_TOKEN
wrangler deploy
```

## 变量说明

| 变量 | 必填 | 位置 | 说明 |
|---|---|---|---|
| `ADMIN` | 是 | Variables/Secret | 后台登录密码 |
| `UUID` | 是 | Variables | VLESS 主 UUID，也是 WS 路径 `/{UUID}` |
| `SUB_TOKEN` | 是 | Variables | 订阅路径 token，订阅地址为 `/{SUB_TOKEN}` |

其余配置在管理面板里改，存 KV（key `mt:config` 的 JSON），Variables 做兜底：

| 配置项 | 说明 |
|---|---|
| multiUUID | 多用户 UUID（数组），除主 UUID 外的合法用户 |
| trojanPassword / ssPassword / ssMethod | Trojan 密码；SS 密码与加密 method |
| preferredSources | 优选 IP 源 URL（每行一个，文本源每行一个 IP；抓取结果 KV 缓存 6 小时） |
| preferredStatic | 静态优选 IP（每行一个） |
| proxyIP | 出站直连失败时的回落 IP（可选，如 CDN IP） |
| nodePort | 订阅节点端口（默认 443） |
| disguiseHTML | 伪装首页 HTML（默认 nginx 风格，可自定义） |
| subPath | 订阅路径（默认 `/{SUB_TOKEN}`） |

## 路由一览

| 路径 | 说明 |
|---|---|
| `GET /` | 伪装首页 |
| `GET /login` / `POST /api/login` | 登录（成功 Set-Cookie `mt_session`，KV token 1 小时过期） |
| `GET /admin` | 管理面板（未登录跳 /login） |
| `GET/POST /api/config`、`/api/logout` | 读写配置 / 登出（需登录） |
| `GET /{SUB_TOKEN}` | base64 通用订阅 |
| `GET /{SUB_TOKEN}/clash` | Clash YAML 订阅 |
| `GET /{SUB_TOKEN}/singbox` | sing-box JSON 订阅 |
| WS `/{UUID}` | VLESS（early data 从 Sec-WebSocket-Protocol 取） |
| WS `/trojan` | Trojan（首包 sha224 hex 验密码，常量时间比较） |
| WS `/ss` | Shadowsocks（AEAD，salt+地址头解密） |

## 自测

纯逻辑部分有 node 自测脚本（不依赖 Workers API）：

```bash
node test.mjs
```

覆盖：SHA-256/SHA-224、ChaCha20-Poly1305（RFC 8439 附录 A.5 向量 + node:crypto 交叉验证）、
HKDF-SHA1、VLESS/Trojan 头解析、SS 三种 method 加解密回环、国旗/国名映射、
节点命名排序、三种订阅格式拼装。

## 已知限制

- Workers 没有 UDP socket：只有 DNS 查询（目的 53 端口）经 DoH（1.1.1.1 / cloudflare-dns.com）中继，
  其他 UDP（如游戏、VoIP、BT）会被优雅关闭，不影响 TCP 连接。
- IP 归属地用 `ip-api.com` 免费接口（http，45 次/分钟限流），结果 KV 缓存 30 天；
  查不到的 IP 节点名显示 `🌐 未知`，后台异步补齐，不阻塞订阅生成。
- SS AEAD nonce 采用 12 字节小端递增（shadowsocks-rust / v2ray 事实标准）；
  Trojan UDP 包分帧按 `ATYP+ADDR+PORT+LEN(2)+DATA` 解析（规范未完全明确，解析失败则关闭该连接）。
