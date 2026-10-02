# 影梭 ShadowShuttle 更新日志

本文档记录每次版本变更，方便以后更新版本时对照。

## v2.0.0（2026-10-03）

v1 用户反馈"功能太差""界面好难看"后的重构版本。相对 edgetunnel 只多不少，
并参考了 yonggekkk、BPB Panel、sublink 等优秀项目的设计。

### 新增传输方式
- gRPC（gun 模式子集）：POST + `application/grpc` 自动识别，Length-Prefixed-Message
  帧编解码，首帧按 VLESS/Trojan 解析，仅 TCP。HTTP/1 下 trailers 无法流式发送，
  grpc-status 放在响应头，多数客户端可接受。
- XHTTP（stream-one 基础模式）：POST + `x-padding` 头或 `?xhttp=` 参数识别，
  body 为原始流，首段按 VLESS/Trojan 解析。packet-up 等多请求拆分模式暂不支持。

### 订阅系统
- 新增 Surge / Quantumult X / Loon 三种订阅格式（共 6 种）。
- `?target=` 参数指定格式；按 UA 自动识别（Clash/Stash/sing-box/Surge/Quantumult/Loon）。
- `?sub=<url>` 聚合外部订阅节点（base64 直接追加原文，其余格式尽力转换）。
- 优选源支持 `sub://` 前缀聚合外部订阅。
- 多 HOST 轮换：面板可配多个 HOST，订阅节点按序号轮换。
- 快速订阅路径：面板可设 KEY，`/{KEY}` 直达订阅。
- 订阅参数开关：0RTT（`ed=2048`）、TLS 分片（`fragment=`，需客户端支持）。
- SS 非 TLS 备用端口（如 80）：额外生成一条节点。

### 优选 IP
- 单 IP 粒度：静态条目支持 `IP` / `IP:端口` / `IP#备注` / `[IPv6]:端口#备注`。
- 内置随机优选 IP 生成器：从 Cloudflare 公开 IP 段（在线拉取 + 内嵌兜底，
  KV 缓存 24 小时）随机抽取，默认 16 个，可配数量与端口，零配置可用。
- 节点命名保持「国旗+中文国名+序号」，带 #备注 的条目追加在末尾。

### 出站
- 链式代理：SOCKS5 / HTTP（HTTPS 暂不支持，已明确抛错提示），可配账号密码、
  域名白名单（空=全部走链）。拨号顺序：直连 → 链式代理 → PROXYIP 回落。
- 面板"检查链式代理"：经链拨号抓取 api.ipify.org 显示出口 IP。

### 日志与通知
- KV 请求日志（IP、国家、路径、UA，最多 200 条，7 天过期），面板可开关、查看。
- Telegram 推送：面板配置 BotToken/ChatID；拉订阅即推，代理建连每 IP 每天只推一次。

### 面板
- Cloudflare 用量查询：填 API Token + Account ID，后台显示当日请求数/10 万进度条。
- 优选源一键验证：测试源 URL 有效性并显示抓到的 IP 数。
- 管理界面推倒重做：深色模式、订阅/节点二维码、折叠卡片、emoji 图标行、
  toggle 开关、pill 多选、toast 提示、状态仪表盘、3 步引导卡。
- 密码类字段（SS 密码/链密码/TG Token/CF Token）不回显，留空=不修改。

### 已知限制
- Workers 无 UDP socket：仅 DNS（目的 53）经 DoH 中继，其余 UDP 优雅关闭。
- ip-api.com 免费版 45 次/分钟，归属地 KV 缓存 30 天；未知显示 🌐 未知，后台补齐。
- gRPC trailers、XHTTP packet-up、HTTPS 链式代理暂不支持。
- Surge/QuanX/Loon 的 SS+WS 写法按各客户端常见格式尽力输出，极端客户端可能需微调。

## v1.0.0（2026-10-03）

首个可用版本（测试 Worker 跑通）。
- VLESS / Trojan / Shadowsocks over WebSocket（WS 首包自动识别协议）。
- 优选 IP：静态列表 + URL 文本源（KV 缓存 6 小时），去重。
- 订阅：base64 通用 / Clash / sing-box；节点命名「国旗+中文国名+序号」；
  IP 归属地 ip-api 查询 + KV 缓存 30 天。
- 管理面板：登录会话、UUID/多用户/Trojan/SS/订阅 Token/优选源/回落 IP/
  节点端口/伪装页配置；现代简约浅色 UI。
- 出站：直连，失败时 PROXYIP 回落；UDP 仅 DNS 经 DoH。
- 默认伪装首页：极简 404（v1.0.0 初版为 nginx 欢迎页，后改为 404）。
- 自测：45/45 通过（node test.mjs）。
