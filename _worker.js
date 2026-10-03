/**
 * 影梭 ShadowShuttle — 自研 Cloudflare Worker 代理
 * ============================================================
 * clean-room 实现，未复制任何现有项目的代码，只参考公开协议规范
 * （VLESS/Trojan/Shadowsocks 协议头、RFC 8439、gRPC framing、SOCKS5 RFC 1928）。
 *
 * 【功能索引】
 * 一、代理协议：VLESS / Trojan / Shadowsocks over WebSocket（首包自动识别）
 * 二、传输方式：WebSocket、gRPC（POST+application/grpc）、XHTTP（stream-one 基础模式）
 * 三、订阅：base64 通用 / Clash / sing-box / Surge / Quantumult X / Loon，
 *     ?target= 指定格式，UA 自动识别；多 HOST 轮换；/{KEY} 快速订阅；
 *     ?sub= 聚合外部订阅；sub:// 优选源聚合
 * 四、优选 IP：静态列表（IP / IP:端口 / IP#备注）+ URL 文本源 + sub:// 聚合源
 *     + 内置随机生成器（默认 16 个）；归属地查询 + KV 缓存 30 天
 * 五、节点命名：{国旗emoji}{中文国名} {全局序号}，如 🇺🇸 美国 01
 * 六、出站：直连 → 链式代理（SOCKS5/HTTP/HTTPS，可配白名单）→ PROXYIP 回落
 * 七、订阅参数：0RTT（ed）、TLS 分片（fragment）开关；SS 非 TLS 备用端口
 * 八、管理面板：登录会话、配置读写、请求日志查看、优选源一键验证、
 *     链式代理检查、CF 用量查询、TG 推送配置；深色模式；二维码；3 步引导
 * 九、日志与通知：KV 请求日志（可开关）；TG 推送（拉订阅/新 IP 建连）
 *
 * 部署：把整个文件粘贴到 Cloudflare Dashboard → Workers → 编辑代码，
 * 或用 wrangler deploy。纯逻辑函数同时 export，供 node 自测。
 * 版本变更记录见仓库根目录 CHANGELOG.md。
 */

export const SS_VERSION = '3.3.0';

/* ------------------------------------------------------------------
 * 国家代码 → 中文国名映射表（ISO 3166-1 alpha-2）
 * 用于订阅节点命名：{国旗emoji}{中文国名} {序号}
 * ------------------------------------------------------------------ */
const COUNTRY_ZH = {
  AD: '安道尔', AE: '阿联酋', AF: '阿富汗', AG: '安提瓜和巴布达', AI: '安圭拉',
  AL: '阿尔巴尼亚', AM: '亚美尼亚', AO: '安哥拉', AQ: '南极洲', AR: '阿根廷',
  AS: '美属萨摩亚', AT: '奥地利', AU: '澳大利亚', AW: '阿鲁巴', AX: '奥兰群岛',
  AZ: '阿塞拜疆', BA: '波黑', BB: '巴巴多斯', BD: '孟加拉国', BE: '比利时',
  BF: '布基纳法索', BG: '保加利亚', BH: '巴林', BI: '布隆迪', BJ: '贝宁',
  BL: '圣巴泰勒米', BM: '百慕大', BN: '文莱', BO: '玻利维亚', BQ: '荷属加勒比',
  BR: '巴西', BS: '巴哈马', BT: '不丹', BV: '布维岛', BW: '博茨瓦纳',
  BY: '白俄罗斯', BZ: '伯利兹', CA: '加拿大', CC: '科科斯群岛', CD: '刚果（金）',
  CF: '中非', CG: '刚果（布）', CH: '瑞士', CI: '科特迪瓦', CK: '库克群岛',
  CL: '智利', CM: '喀麦隆', CN: '中国', CO: '哥伦比亚', CR: '哥斯达黎加',
  CU: '古巴', CV: '佛得角', CW: '库拉索', CX: '圣诞岛', CY: '塞浦路斯',
  CZ: '捷克', DE: '德国', DJ: '吉布提', DK: '丹麦', DM: '多米尼克',
  DO: '多米尼加', DZ: '阿尔及利亚', EC: '厄瓜多尔', EE: '爱沙尼亚', EG: '埃及',
  EH: '西撒哈拉', ER: '厄立特里亚', ES: '西班牙', ET: '埃塞俄比亚', FI: '芬兰',
  FJ: '斐济', FK: '福克兰群岛', FM: '密克罗尼西亚', FO: '法罗群岛', FR: '法国',
  GA: '加蓬', GB: '英国', GD: '格林纳达', GE: '格鲁吉亚', GF: '法属圭亚那',
  GG: '根西岛', GH: '加纳', GI: '直布罗陀', GL: '格陵兰', GM: '冈比亚',
  GN: '几内亚', GP: '瓜德罗普', GQ: '赤道几内亚', GR: '希腊', GS: '南乔治亚',
  GT: '危地马拉', GU: '关岛', GW: '几内亚比绍', GY: '圭亚那', HK: '香港',
  HM: '赫德岛', HN: '洪都拉斯', HR: '克罗地亚', HT: '海地', HU: '匈牙利',
  ID: '印度尼西亚', IE: '爱尔兰', IL: '以色列', IM: '马恩岛', IN: '印度',
  IO: '英属印度洋领地', IQ: '伊拉克', IR: '伊朗', IS: '冰岛', IT: '意大利',
  JE: '泽西岛', JM: '牙买加', JO: '约旦', JP: '日本', KE: '肯尼亚',
  KG: '吉尔吉斯斯坦', KH: '柬埔寨', KI: '基里巴斯', KM: '科摩罗', KN: '圣基茨和尼维斯',
  KP: '朝鲜', KR: '韩国', KW: '科威特', KY: '开曼群岛', KZ: '哈萨克斯坦',
  LA: '老挝', LB: '黎巴嫩', LC: '圣卢西亚', LI: '列支敦士登', LK: '斯里兰卡',
  LR: '利比里亚', LS: '莱索托', LT: '立陶宛', LU: '卢森堡', LV: '拉脱维亚',
  LY: '利比亚', MA: '摩洛哥', MC: '摩纳哥', MD: '摩尔多瓦', ME: '黑山',
  MF: '圣马丁（法）', MG: '马达加斯加', MH: '马绍尔群岛', MK: '北马其顿', ML: '马里',
  MM: '缅甸', MN: '蒙古', MO: '澳门', MP: '北马里亚纳', MQ: '马提尼克',
  MR: '毛里塔尼亚', MS: '蒙特塞拉特', MT: '马耳他', MU: '毛里求斯', MV: '马尔代夫',
  MW: '马拉维', MX: '墨西哥', MY: '马来西亚', MZ: '莫桑比克', NA: '纳米比亚',
  NC: '新喀里多尼亚', NE: '尼日尔', NF: '诺福克岛', NG: '尼日利亚', NI: '尼加拉瓜',
  NL: '荷兰', NO: '挪威', NP: '尼泊尔', NR: '瑙鲁', NU: '纽埃',
  NZ: '新西兰', OM: '阿曼', PA: '巴拿马', PE: '秘鲁', PF: '法属波利尼西亚',
  PG: '巴布亚新几内亚', PH: '菲律宾', PK: '巴基斯坦', PL: '波兰', PM: '圣皮埃尔和密克隆',
  PN: '皮特凯恩', PR: '波多黎各', PS: '巴勒斯坦', PT: '葡萄牙', PW: '帕劳',
  PY: '巴拉圭', QA: '卡塔尔', RE: '留尼汪', RO: '罗马尼亚', RS: '塞尔维亚',
  RU: '俄罗斯', RW: '卢旺达', SA: '沙特阿拉伯', SB: '所罗门群岛', SC: '塞舌尔',
  SD: '苏丹', SE: '瑞典', SG: '新加坡', SH: '圣赫勒拿', SI: '斯洛文尼亚',
  SJ: '斯瓦尔巴', SK: '斯洛伐克', SL: '塞拉利昂', SM: '圣马力诺', SN: '塞内加尔',
  SO: '索马里', SR: '苏里南', SS: '南苏丹', ST: '圣多美和普林西比', SV: '萨尔瓦多',
  SX: '圣马丁（荷）', SY: '叙利亚', SZ: '斯威士兰', TC: '特克斯和凯科斯', TD: '乍得',
  TF: '法属南部领地', TG: '多哥', TH: '泰国', TJ: '塔吉克斯坦', TK: '托克劳',
  TL: '东帝汶', TM: '土库曼斯坦', TN: '突尼斯', TO: '汤加', TR: '土耳其',
  TT: '特立尼达和多巴哥', TV: '图瓦卢', TW: '台湾', TZ: '坦桑尼亚', UA: '乌克兰',
  UG: '乌干达', UM: '美国本土外小岛屿', US: '美国', UY: '乌拉圭', UZ: '乌兹别克斯坦',
  VA: '梵蒂冈', VC: '圣文森特和格林纳丁斯', VE: '委内瑞拉', VG: '英属维尔京群岛', VI: '美属维尔京群岛',
  VN: '越南', VU: '瓦努阿图', WF: '瓦利斯和富图纳', WS: '萨摩亚', YE: '也门',
  YT: '马约特', ZA: '南非', ZM: '赞比亚', ZW: '津巴布韦',
};

/** 国家代码 → 中文国名，未知返回 '未知' */
export function countryNameOf(code) {
  if (!code) return '未知';
  return COUNTRY_ZH[String(code).toUpperCase()] || '未知';
}

/** 国家代码 → 国旗 emoji（regional indicator），未知返回 🌐 */
export function countryFlag(code) {
  const c = String(code || '').toUpperCase();
  // 非法格式或映射表里没有的国家代码（如 'XX'），一律回退为 🌐
  if (!/^[A-Z]{2}$/.test(c) || !COUNTRY_ZH[c]) return '🌐';
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/* ------------------------------------------------------------------
 * 基础工具函数
 * ------------------------------------------------------------------ */
const te = new TextEncoder();
const td = new TextDecoder();

export function bytesToHex(b) {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const clean = String(hex).replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('bad hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/** 标准 base64 解码（兼容 urlsafe、自动补齐）→ Uint8Array */
export function base64ToBytes(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4 !== 0) t += '=';
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Uint8Array → 标准 base64（带 padding） */
export function bytesToBase64(b) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < b.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, b.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function concatBytes(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

/** UUID 字符串 → 16 字节；非法返回 null */
export function parseUUID(s) {
  const hex = String(s || '').replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  return hexToBytes(hex);
}

/** 字节数组等长比较（避免短路泄露，用恒定时间风格） */
export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** 字符串常量时间比较（用于 Trojan 密码哈希） */
export function constTimeStrEq(a, b) {
  const ab = te.encode(String(a));
  const bb = te.encode(String(b));
  return bytesEqual(ab, bb);
}

/** IPv6 16 字节 → 文本（全写形式，一定合法） */
export function formatIPv6(b) {
  const parts = [];
  for (let i = 0; i < 16; i += 2) parts.push(((b[i] << 8) | b[i + 1]).toString(16));
  return parts.join(':');
}

/** 简单 IP 格式校验（v4 / v6） */
export function isIP(s) {
  const t = String(s || '').trim();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(t)) {
    return t.split('.').every((p) => Number(p) >= 0 && Number(p) <= 255);
  }
  return /^[0-9a-fA-F:]{2,45}$/.test(t) && t.includes(':');
}

/** 解析单条优选 IP 条目，支持四种写法：
 *  1.2.3.4 / 1.2.3.4:2053 / 1.2.3.4#备注 / [2001:db8::1]:2053#备注
 *  返回 {ip, port(0=用默认), remark}，非法返回 null。 */
export function parseIPEntry(s) {
  let t = String(s || '').trim();
  if (!t) return null;
  let remark = '';
  const hi = t.indexOf('#');
  if (hi >= 0) { remark = t.slice(hi + 1).trim(); t = t.slice(0, hi).trim(); }
  let ip = t, port = 0;
  if (t.startsWith('[')) {
    // IPv6 显式写法：[2001:db8::1]:2053
    const m = t.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (!m) return null;
    ip = m[1];
    port = m[2] ? Number(m[2]) : 0;
  } else {
    // IPv4 带端口：恰好一个冒号且后半是纯数字；裸 IPv6 不拆端口
    const parts = t.split(':');
    if (parts.length === 2 && /^\d+$/.test(parts[1]) && isIP(parts[0])) {
      ip = parts[0];
      port = Number(parts[1]);
    } else {
      ip = t;
    }
  }
  if (!isIP(ip)) return null;
  if (port && !(port > 0 && port < 65536)) return null;
  return { ip, port, remark };
}

/** IPv4 点分 → uint32 */
export function ipToInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
}

/** uint32 → IPv4 点分 */
export function intToIp(n) {
  n = n >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** CIDR → {start, end}（uint32 区间，仅 IPv4；非法返回 null） */
export function cidrToRange(cidr) {
  const m = String(cidr || '').trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m || !isIP(m[1])) return null;
  const bits = Number(m[2]);
  if (bits < 0 || bits > 32) return null;
  const base = ipToInt(m[1]);
  const size = Math.pow(2, 32 - bits);
  const start = Math.floor(base / size) * size;
  return { start, end: start + size - 1 };
}

/** 从 CIDR 列表随机抽取 count 个 IPv4（rand 可注入，便于单测） */
export function randomIPsFromCIDRs(cidrs, count, rand) {
  const r = rand || Math.random;
  const ranges = [];
  for (const c of cidrs || []) {
    const rg = cidrToRange(c);
    if (rg && rg.end > rg.start) ranges.push(rg);
  }
  const out = new Set();
  let guard = count * 50 + 100; // 防止极端情况下死循环
  while (out.size < count && guard-- > 0 && ranges.length) {
    const rg = ranges[Math.floor(r() * ranges.length)];
    const n = rg.start + 1 + Math.floor(r() * (rg.end - rg.start - 1));
    out.add(intToIp(n));
  }
  return [...out];
}

/* ------------------------------------------------------------------
 * SHA-256 / SHA-224 纯 JS 实现（FIPS 180-4）
 * WebCrypto 不提供 SHA-224（Trojan 需要 hex(sha224(password))），
 * 所以这里手写 SHA-2，SHA-224 只是换初始向量并截断输出。
 * ------------------------------------------------------------------ */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const SHA256_IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const SHA224_IV = [0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4];

function rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

function sha2Digest(msgBytes, iv, outLen) {
  const l = msgBytes.length;
  // 填充：0x80 + 0* + 64bit 大端长度
  let paddedLen = l + 1 + 8;
  while (paddedLen % 64 !== 0) paddedLen++;
  const padded = new Uint8Array(paddedLen);
  padded.set(msgBytes);
  padded[l] = 0x80;
  const dv = new DataView(padded.buffer);
  const bitLenHi = Math.floor((l * 8) / 0x100000000);
  const bitLenLo = (l * 8) >>> 0;
  dv.setUint32(paddedLen - 8, bitLenHi);
  dv.setUint32(paddedLen - 4, bitLenLo);

  const h = iv.slice();
  const w = new Uint32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(outLen);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < outLen / 4; i++) odv.setUint32(i * 4, h[i]);
  return out;
}

/** sha256(utf8字符串) → 32 字节 */
export function sha256Bytes(s) {
  return sha2Digest(te.encode(String(s)), SHA256_IV, 32);
}

/** hex(sha224(utf8字符串)) → Trojan 密码哈希（56 个 hex 字符） */
export function trojanPasswordHash(password) {
  return bytesToHex(sha2Digest(te.encode(String(password)), SHA224_IV, 28));
}

/* ------------------------------------------------------------------
 * ChaCha20-Poly1305 纯 JS 实现（RFC 8439）
 * WebCrypto 没有 ChaCha20-Poly1305，而 Shadowsocks 三种 method
 * 之一是 chacha20-ietf-poly1305，所以手写。
 * ------------------------------------------------------------------ */
function rotl32(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }

function chacha20Block(key, nonce12, counter) {
  const st = new Uint32Array(16);
  st[0] = 0x61707865; st[1] = 0x3320646e; st[2] = 0x79622d32; st[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) st[4 + i] = (key[i * 4] | (key[i * 4 + 1] << 8) | (key[i * 4 + 2] << 16) | (key[i * 4 + 3] << 24)) >>> 0;
  st[12] = counter >>> 0;
  for (let i = 0; i < 3; i++) st[13 + i] = (nonce12[i * 4] | (nonce12[i * 4 + 1] << 8) | (nonce12[i * 4 + 2] << 16) | (nonce12[i * 4 + 3] << 24)) >>> 0;
  const x = st.slice();
  const qr = (a, b, c, d) => {
    x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl32(x[d] ^ x[a], 16);
    x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl32(x[b] ^ x[c], 12);
    x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl32(x[d] ^ x[a], 8);
    x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl32(x[b] ^ x[c], 7);
  };
  for (let i = 0; i < 10; i++) {
    qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
    qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
  }
  const out = new Uint8Array(64);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) odv.setUint32(i * 4, (x[i] + st[i]) >>> 0, true);
  return out;
}

function chacha20Xor(key, nonce12, counter, data) {
  const out = new Uint8Array(data.length);
  let pos = 0, ctr = counter >>> 0;
  while (pos < data.length) {
    const ks = chacha20Block(key, nonce12, ctr++);
    const n = Math.min(64, data.length - pos);
    for (let i = 0; i < n; i++) out[pos + i] = data[pos + i] ^ ks[i];
    pos += n;
  }
  return out;
}

/* Poly1305（RFC 8439 2.5）：用 BigInt 实现，清晰且足够快（每块一次） */
function poly1305Mac(key32, msg) {
  const P = (1n << 130n) - 5n;
  let r = 0n;
  for (let i = 0; i < 16; i++) r |= BigInt(key32[i]) << (8n * BigInt(i));
  r &= 0x0ffffffc0ffffffc0ffffffc0fffffffn;
  let s = 0n;
  for (let i = 0; i < 16; i++) s |= BigInt(key32[16 + i]) << (8n * BigInt(i));
  let acc = 0n;
  for (let off = 0; off < msg.length; off += 16) {
    const block = msg.subarray(off, Math.min(off + 16, msg.length));
    let n = 0n;
    for (let i = 0; i < block.length; i++) n |= BigInt(block[i]) << (8n * BigInt(i));
    n |= 1n << (8n * BigInt(block.length));
    acc = ((acc + n) * r) % P;
  }
  acc = (acc + s) & 0xffffffffffffffffffffffffffffffffn;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = Number((acc >> (8n * BigInt(i))) & 0xffn);
  return out;
}

function aeadMacInput(aad, ciphertext) {
  const pad = (len) => new Uint8Array((16 - (len % 16)) % 16);
  const lens = new Uint8Array(16);
  const dv = new DataView(lens.buffer);
  dv.setBigUint64(0, BigInt(aad.length), true);
  dv.setBigUint64(8, BigInt(ciphertext.length), true);
  return concatBytes(aad, pad(aad.length), ciphertext, pad(ciphertext.length), lens);
}

/** ChaCha20-Poly1305 加密 → 密文+16字节tag（aad 一般为空） */
export function chacha20Poly1305Encrypt(key32, nonce12, plaintext, aad) {
  const a = aad || new Uint8Array(0);
  const otk = chacha20Block(key32, nonce12, 0).subarray(0, 32);
  const ct = chacha20Xor(key32, nonce12, 1, plaintext);
  const tag = poly1305Mac(otk, aeadMacInput(a, ct));
  return concatBytes(ct, tag);
}

/** ChaCha20-Poly1305 解密；tag 校验失败返回 null */
export function chacha20Poly1305Decrypt(key32, nonce12, ctAndTag, aad) {
  if (ctAndTag.length < 16) return null;
  const a = aad || new Uint8Array(0);
  const ct = ctAndTag.subarray(0, ctAndTag.length - 16);
  const tag = ctAndTag.subarray(ctAndTag.length - 16);
  const otk = chacha20Block(key32, nonce12, 0).subarray(0, 32);
  const expect = poly1305Mac(otk, aeadMacInput(a, ct));
  if (!bytesEqual(tag, expect)) return null;
  return chacha20Xor(key32, nonce12, 1, ct);
}

/* ------------------------------------------------------------------
 * Shadowsocks 密钥派生：subkey = HKDF-SHA1(password, salt, "ss-subkey")
 * 用 WebCrypto 的 HKDF（Workers 与 node 都有）。
 * ------------------------------------------------------------------ */
export async function ssSubkey(password, salt, keyLen) {
  const ikm = te.encode(String(password));
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-1', salt: salt, info: te.encode('ss-subkey') },
    key,
    keyLen * 8
  );
  return new Uint8Array(bits);
}

export const SS_METHODS = {
  'aes-128-gcm': { keyLen: 16, saltLen: 16, aead: 'aes-gcm' },
  'aes-256-gcm': { keyLen: 32, saltLen: 32, aead: 'aes-gcm' },
  'chacha20-ietf-poly1305': { keyLen: 32, saltLen: 32, aead: 'chacha20' },
};

/** 统一 AEAD 解密（ct 含 16 字节 tag 在尾部）；失败返回 null */
export async function ssAeadDecrypt(method, key, nonce12, ctAndTag) {
  const m = SS_METHODS[method];
  if (!m) throw new Error('unsupported method');
  if (m.aead === 'aes-gcm') {
    try {
      const ck = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce12.slice(), tagLength: 128 },
        ck, ctAndTag
      );
      return new Uint8Array(pt);
    } catch { return null; }
  }
  return chacha20Poly1305Decrypt(key, nonce12, ctAndTag);
}

/** 统一 AEAD 加密 → 密文+tag */
export async function ssAeadEncrypt(method, key, nonce12, plaintext) {
  const m = SS_METHODS[method];
  if (!m) throw new Error('unsupported method');
  if (m.aead === 'aes-gcm') {
    const ck = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce12.slice(), tagLength: 128 },
      ck, plaintext
    );
    return new Uint8Array(ct);
  }
  return chacha20Poly1305Encrypt(key, nonce12, plaintext);
}

/** nonce 小端 +1（Shadowsocks 规范：12 字节 nonce 逐块递增） */
export function ssIncNonce(nonce12) {
  for (let i = 0; i < 12; i++) {
    nonce12[i] = (nonce12[i] + 1) & 0xff;
    if (nonce12[i] !== 0) break;
  }
}

/* ------------------------------------------------------------------
 * 协议头解析（纯函数，可单测）
 * ------------------------------------------------------------------ */

/** 解析地址段（不含端口）：返回 { addr, next }；数据不足返回 null；非法抛错 */
function parseAddr(buf, off) {
  if (off + 1 > buf.length) return null;
  const atyp = buf[off++];
  let addr;
  if (atyp === 0x01) { // IPv4
    if (buf.length < off + 4) return null;
    addr = `${buf[off]}.${buf[off + 1]}.${buf[off + 2]}.${buf[off + 3]}`;
    off += 4;
  } else if (atyp === 0x02) { // 域名
    if (buf.length < off + 1) return null;
    const len = buf[off++];
    if (buf.length < off + len) return null;
    addr = td.decode(buf.subarray(off, off + len));
    off += len;
  } else if (atyp === 0x03) { // IPv6
    if (buf.length < off + 16) return null;
    addr = formatIPv6(buf.subarray(off, off + 16));
    off += 16;
  } else {
    throw new Error('unsupported atyp: ' + atyp);
  }
  return { addr, next: off };
}

/** 读 2 字节大端端口；数据不足返回 null */
function parsePort(buf, off) {
  if (buf.length < off + 2) return null;
  return { port: (buf[off] << 8) | buf[off + 1], next: off + 2 };
}

/**
 * 解析 VLESS 请求头。
 * 格式：VER(1) + UUID(16) + M(1) + ADDON(M) + CMD(1) + PORT(2) + ATYP + ADDR + ...
 * CMD: 0x01 TCP / 0x02 UDP / 0x03 MUX（拒绝）
 * 数据不足返回 null；UUID 不匹配或格式非法抛错。
 */
export function parseVlessHeader(buf, validUUIDs) {
  if (buf.length < 24) return null;
  let off = 0;
  const version = buf[off++];
  const uuid = buf.slice(off, off + 16); off += 16;
  if (!validUUIDs.some((u) => bytesEqual(uuid, u))) throw new Error('bad uuid');
  const mLen = buf[off++]; off += mLen;
  if (buf.length < off + 1 + 2 + 1) return null;
  const cmd = buf[off++];
  if (cmd === 0x03) throw new Error('mux not supported');
  if (cmd !== 0x01 && cmd !== 0x02) throw new Error('bad cmd: ' + cmd);
  const pp = parsePort(buf, off);
  if (!pp) return null;
  const ap = parseAddr(buf, pp.next);
  if (!ap) return null;
  return { version, cmd, port: pp.port, addr: ap.addr, headerLen: ap.next };
}

/**
 * 解析 Trojan 请求头。
 * 格式：hex(sha224(password))(56) + CRLF + CMD(1) + ATYP + ADDR + PORT(2) + CRLF + 数据
 * CMD: 0x01 TCP / 0x03 UDP。密码用常量时间比较。
 */
export function parseTrojanHeader(buf, passwordHashHex) {
  if (buf.length < 62) return null;
  const hex = td.decode(buf.subarray(0, 56));
  if (!constTimeStrEq(hex, passwordHashHex)) throw new Error('bad trojan password');
  if (buf[56] !== 0x0d || buf[57] !== 0x0a) throw new Error('bad trojan crlf');
  let off = 58;
  const cmd = buf[off++];
  if (cmd !== 0x01 && cmd !== 0x03) throw new Error('bad trojan cmd: ' + cmd);
  const ap = parseAddr(buf, off);
  if (!ap) return null;
  const pp = parsePort(buf, ap.next);
  if (!pp) return null;
  off = pp.next;
  if (buf.length < off + 2) return null;
  if (buf[off] !== 0x0d || buf[off + 1] !== 0x0a) throw new Error('bad trojan crlf2');
  off += 2;
  return { cmd, port: pp.port, addr: ap.addr, headerLen: off };
}

/**
 * Shadowsocks TCP AEAD 流式解密器（服务端收方向）。
 * salt → HKDF 派生 subkey → 逐块解密 [2B长度][数据]。
 * 用法：先 feed(salt)，再循环 feed(chunk) 取明文。
 */
export class SsDecryptor {
  constructor(method, password) {
    const m = SS_METHODS[method];
    if (!m) throw new Error('unsupported ss method: ' + method);
    this.method = method;
    this.password = password;
    this.saltLen = m.saltLen;
    this.keyLen = m.keyLen;
    this.buf = new Uint8Array(0);
    this.stage = 'salt';      // salt → len → data → len …
    this.need = this.saltLen;
    this.nonce = new Uint8Array(12);
    this.subkey = null;
  }

  async _decryptPiece(piece) {
    const pt = await ssAeadDecrypt(this.method, this.subkey, this.nonce, piece);
    ssIncNonce(this.nonce);
    if (!pt) throw new Error('ss decrypt failed');
    return pt;
  }

  /** 喂入 WS 收到的原始字节，返回解密出的明文（可能为空） */
  async push(chunk) {
    this.buf = concatBytes(this.buf, chunk);
    const out = [];
    for (;;) {
      if (this.buf.length < this.need) break;
      const piece = this.buf.subarray(0, this.need);
      this.buf = this.buf.subarray(this.need);
      if (this.stage === 'salt') {
        this.subkey = await ssSubkey(this.password, piece, this.keyLen);
        this.stage = 'len'; this.need = 2 + 16;
      } else if (this.stage === 'len') {
        const pt = await this._decryptPiece(piece);
        const dlen = (pt[0] << 8) | pt[1];
        if (dlen > 0x3fff) throw new Error('ss chunk too large');
        this.stage = 'data'; this.need = dlen + 16;
      } else {
        const pt = await this._decryptPiece(piece);
        out.push(pt);
        this.stage = 'len'; this.need = 2 + 16;
      }
    }
    return concatBytes(...out);
  }
}

/**
 * Shadowsocks TCP AEAD 流式加密器（服务端发方向）。
 * 构造时生成随机 salt，encrypt() 把明文切块加密。
 */
export class SsEncryptor {
  constructor(method, password) {
    const m = SS_METHODS[method];
    if (!m) throw new Error('unsupported ss method: ' + method);
    this.method = method;
    this.keyLen = m.keyLen;
    this.salt = crypto.getRandomValues(new Uint8Array(m.saltLen));
    this.nonce = new Uint8Array(12);
    this.password = password;
    this.subkeyPromise = ssSubkey(password, this.salt, this.keyLen);
    this.headerSent = false;
  }

  async encrypt(plaintext) {
    const subkey = await this.subkeyPromise;
    const parts = [];
    if (!this.headerSent) { parts.push(this.salt); this.headerSent = true; }
    let off = 0;
    while (off < plaintext.length) {
      const n = Math.min(0x3fff, plaintext.length - off);
      const lenBuf = new Uint8Array([(n >>> 8) & 0xff, n & 0xff]);
      parts.push(await ssAeadEncrypt(this.method, subkey, this.nonce, lenBuf));
      ssIncNonce(this.nonce);
      parts.push(await ssAeadEncrypt(this.method, subkey, this.nonce, plaintext.subarray(off, off + n)));
      ssIncNonce(this.nonce);
      off += n;
    }
    return concatBytes(...parts);
  }
}

/* ------------------------------------------------------------------
 * WebSocket 读取器：把 message 事件转成可 await 的字节流。
 * 支持 prepend()（early data 先喂给解析器）。
 * ------------------------------------------------------------------ */
export class WsReader {
  constructor(ws) {
    this.queue = [];
    this.waiters = [];
    this.closed = false;
    ws.addEventListener('message', (e) => {
      const d = e.data;
      const buf = d instanceof ArrayBuffer ? new Uint8Array(d)
        : typeof d === 'string' ? te.encode(d)
        : new Uint8Array(d);
      this._deliver(buf);
    });
    const onClose = () => {
      this.closed = true;
      while (this.waiters.length) this.waiters.shift()(null);
    };
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onClose);
  }
  _deliver(buf) {
    if (this.waiters.length) this.waiters.shift()(buf);
    else this.queue.push(buf);
  }
  prepend(buf) {
    if (buf && buf.length) this.queue.unshift(buf);
  }
  async read() {
    if (this.queue.length) return this.queue.shift();
    if (this.closed) return null;
    return new Promise((res) => this.waiters.push(res));
  }
}

/* ------------------------------------------------------------------
 * 订阅 token 每日轮换（v3）
 * ------------------------------------------------------------------ */

/** 今天的 UTC 日期（YYYY-MM-DD）。
 * 用 UTC 而不用本地时区：Workers 边缘节点遍布全球，同一时刻各地日期可能
 * 不同；统一用 UTC 才能保证全球客户端在同一天算出同一个 token。 */
export function utcToday(d) {
  return (d || new Date()).toISOString().slice(0, 10);
}

/** 订阅 token 每日派生（纯函数）。
 * 为什么：固定 token 一旦泄露（转发/截图/仓库误提交）就长期有效，任何人
 * 都能拉你的订阅。开启轮换后，每天按日期派生不同 token
 * （sha256(固定token + "|" + YYYY-MM-DD) 取前 32 位 hex），旧链接次日自动
 * 失效。代价是每天要重新复制订阅链接，所以默认关闭，需要的用户手动开。
 * enabled=false 时原样返回 base，保证关闭=零行为变化。 */
export function rotatedSubToken(base, dateStr, enabled) {
  if (!enabled) return base;
  return bytesToHex(sha256Bytes(`${base}|${dateStr}`)).slice(0, 32);
}

/* ------------------------------------------------------------------
 * 配置模型
 * Worker Variables（必填）：ADMIN / UUID / SUB_TOKEN
 * 其余可选项存 KV（key: ss:config），Variables 做兜底。
 * ------------------------------------------------------------------ */
const KV_CONFIG_KEY = 'ss:config';
const KV_SESSION_PREFIX = 'ss:session:';
const KV_GEO_PREFIX = 'ss:geo:';
const KV_SRC_PREFIX = 'ss:src:';
const KV_CIDR_KEY = 'ss:cf-cidrs';   // Cloudflare IP 段缓存（24 小时）
const KV_LOG_KEY = 'ss:log';         // 请求日志（JSON 数组，最多 200 条）
const KV_TGIP_PREFIX = 'ss:tg:';     // TG 建连通知去重（每 IP 每天一次）

const DEFAULT_CONFIG = {
  // —— 用户与协议 ——
  multiUUID: [],            // 多用户 UUID 数组
  trojanPassword: '',       // Trojan 密码（空=不启用）
  ssPassword: '',           // SS 密码（空=不启用）
  ssMethod: 'aes-128-gcm',  // SS 加密方式
  ssAltPort: 0,             // SS 非 TLS 备用端口（0=关闭，如 80）
  // —— 订阅 ——
  subKey: '',               // 快速订阅路径 KEY（空=不启用），/{KEY} 直达订阅
  subTokenRotate: false,    // 订阅 token 每日轮换（默认关闭；开启后每天派生新 token）
  hosts: [],                // 多 HOST 轮换（空=用请求 host）
  nodePort: 443,            // 节点端口
  earlyData: false,         // 0RTT：订阅拼 ed=2048 参数
  fragment: false,          // TLS 分片：订阅拼 fragment 参数（需客户端支持）
  // —— 优选 IP ——
  preferredSources: [],     // 优选 IP 源 URL 列表（支持 https:// 文本源与 sub:// 聚合源）
  preferredStatic: [],      // 静态优选 IP 列表（支持 IP / IP:端口 / IP#备注）
  randIPCount: 16,          // 订阅节点总数目标（静态+来源优先，随机补足差额；0=关闭随机）
  randIPPort: 443,          // 随机优选 IP 端口
  // —— 出站 ——
  proxyIP: '',              // 回落 IP（出站失败时重试）
  speedtestDomains: ['speedtest.net', 'speed.cloudflare.com', 'fast.com'],
  // 测速域名名单（后缀匹配；清空=关闭测速模式）
  dialRace: false,          // 并发拨号：同时拨直连/链式/回落，取最快成功的（默认关闭，保持串行）
  dialConcurrency: 3,       // 并发拨号数（2-5）
  dialTimeoutMs: 0,         // 单次拨号超时 ms（0=自适应：按历史耗时动态调整）
  chainEnabled: false,      // 链式代理开关
  chainType: 'socks5',      // socks5 / http / https
  chainHost: '',            // 链式代理地址
  chainPort: 1080,          // 链式代理端口
  chainUser: '',            // 链式代理账号（可空）
  chainPass: '',            // 链式代理密码（可空）
  chainWhitelist: [],       // 域名白名单（空=全部走链；否则仅名单内走链）
  // —— 日志与通知 ——
  logEnabled: false,        // KV 请求日志开关
  tgEnabled: false,         // Telegram 推送开关
  tgBotToken: '',           // TG Bot Token
  tgChatId: '',             // TG Chat ID
  // —— Cloudflare ——
  cfApiToken: '',           // CF API Token（用量查询）
  cfAccountId: '',          // CF Account ID（用量查询）
  // —— 其他 ——
  disguiseHTML: '',         // 伪装首页（空=内置默认）
  subPath: '',              // 订阅路径（空=/{SUB_TOKEN}）
};

/** 文本域输入 → 字符串数组（每行一条，去空去重） */
export function linesToList(s) {
  if (Array.isArray(s)) return [...new Set(s.map((x) => String(x).trim()).filter(Boolean))];
  return [...new Set(String(s || '').split('\n').map((x) => x.trim()).filter(Boolean))];
}

/** 端口钳制：非法时回退默认值 */
export function clampPort(v, def) {
  const n = Number(v);
  return n > 0 && n < 65536 ? Math.floor(n) : def;
}

/** 整数钳制到 [min, max]，非法时回退默认值 */
export function clampInt(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** 读取合并后的配置：KV > 默认值；ADMIN/UUID/SUB_TOKEN 只从 env 取 */
export async function loadConfig(env) {
  const cfg = { ...DEFAULT_CONFIG };
  const kv = env.KV;
  if (kv) {
    try {
      const raw = await kv.get(KV_CONFIG_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        for (const k of Object.keys(DEFAULT_CONFIG)) {
          if (saved[k] !== undefined) cfg[k] = saved[k];
        }
      }
    } catch { /* KV 读取失败就用默认值 */ }
  }
  cfg.multiUUID = linesToList(cfg.multiUUID);
  cfg.preferredSources = linesToList(cfg.preferredSources);
  // 静态优选 IP：保留原始条目文本（支持 IP / IP:端口 / IP#备注），解析在 getPreferredIPs 做
  cfg.preferredStatic = linesToList(cfg.preferredStatic);
  cfg.hosts = linesToList(cfg.hosts);
  cfg.chainWhitelist = linesToList(cfg.chainWhitelist);
  cfg.speedtestDomains = linesToList(cfg.speedtestDomains); // linesToList 兼容数组与文本
  cfg.nodePort = clampPort(cfg.nodePort, 443);
  cfg.randIPPort = clampPort(cfg.randIPPort, 443);
  cfg.randIPCount = clampInt(cfg.randIPCount, 0, 500, 16);
  cfg.ssAltPort = clampInt(cfg.ssAltPort, 0, 65535, 0);
  cfg.chainPort = clampPort(cfg.chainPort, 1080);
  cfg.dialConcurrency = clampInt(cfg.dialConcurrency, 2, 5, 3);
  cfg.dialTimeoutMs = clampInt(cfg.dialTimeoutMs, 0, 30000, 0);
  if (!SS_METHODS[cfg.ssMethod]) cfg.ssMethod = 'aes-128-gcm';
  if (!['socks5', 'http', 'https'].includes(cfg.chainType)) cfg.chainType = 'socks5';
  cfg.subKey = String(cfg.subKey || '').trim().replace(/^\/+|\/+$/g, '');
  cfg.earlyData = !!cfg.earlyData;
  cfg.fragment = !!cfg.fragment;
  cfg.chainEnabled = !!cfg.chainEnabled;
  cfg.dialRace = !!cfg.dialRace;
  cfg.subTokenRotate = !!cfg.subTokenRotate;
  cfg.logEnabled = !!cfg.logEnabled;
  cfg.tgEnabled = !!cfg.tgEnabled;
  // env 兜底
  cfg.ADMIN = env.ADMIN || '';
  cfg.UUID = env.UUID || '';
  cfg.SUB_TOKEN = env.SUB_TOKEN || '';
  cfg.subPathCustom = String(cfg.subPath || '').trim(); // 面板回显用（未改动前为空）
  // 订阅路径：自定义 >（轮换派生/固定 token）> /sub
  const effToken = rotatedSubToken(cfg.SUB_TOKEN, utcToday(), cfg.subTokenRotate);
  cfg.subPath = cfg.subPathCustom || (effToken ? `/${effToken}` : '/sub');
  if (!cfg.subPath.startsWith('/')) cfg.subPath = '/' + cfg.subPath;
  return cfg;
}

/** 校验并保存配置到 KV（只接受白名单字段）。
 *  敏感 Token 类字段（chainPass/tgBotToken/cfApiToken）GET 不回显，
 *  留空表示不修改：先读出现有配置做合并，避免每次保存被清空。 */
export async function saveConfig(env, input) {
  const kv = env.KV;
  if (!kv) throw new Error('KV 未绑定');
  // 读出现有配置，用于密码留空时保留旧值
  let old = {};
  try {
    const raw = await kv.get(KV_CONFIG_KEY);
    if (raw) old = JSON.parse(raw);
  } catch { /* 忽略 */ }
  // 留空=不修改的密码类字段：先填回旧值再走统一校验
  // （仅限 GET 不回显的敏感 Token；ssPassword/trojanPassword 回显，留空=清空/禁用）
  const keepIfEmpty = (k) => {
    if (input[k] === undefined || String(input[k]) === '') input[k] = old[k] || '';
  };
  keepIfEmpty('chainPass');
  keepIfEmpty('tgBotToken');
  keepIfEmpty('cfApiToken');
  const cfg = { ...DEFAULT_CONFIG };
  cfg.multiUUID = linesToList(input.multiUUID).filter((s) => parseUUID(s));
  cfg.trojanPassword = String(input.trojanPassword || '').trim();
  cfg.ssPassword = String(input.ssPassword || '');
  cfg.ssMethod = SS_METHODS[input.ssMethod] ? input.ssMethod : 'aes-128-gcm';
  cfg.ssAltPort = clampInt(input.ssAltPort, 0, 65535, 0);
  cfg.subKey = String(input.subKey || '').trim().replace(/^\/+|\/+$/g, '');
  cfg.subTokenRotate = !!input.subTokenRotate;
  cfg.hosts = linesToList(input.hosts);
  cfg.nodePort = clampPort(input.nodePort, 443);
  cfg.earlyData = !!input.earlyData;
  cfg.fragment = !!input.fragment;
  cfg.preferredSources = linesToList(input.preferredSources).filter((s) => /^(https?|sub):\/\//.test(s));
  cfg.preferredStatic = linesToList(input.preferredStatic);
  cfg.randIPCount = clampInt(input.randIPCount, 0, 500, 16);
  cfg.randIPPort = clampPort(input.randIPPort, 443);
  cfg.proxyIP = isIP(String(input.proxyIP || '').trim()) ? String(input.proxyIP).trim() : '';
  cfg.speedtestDomains = linesToList(input.speedtestDomains);
  cfg.chainEnabled = !!input.chainEnabled;
  cfg.chainType = ['socks5', 'http', 'https'].includes(input.chainType) ? input.chainType : 'socks5';
  cfg.chainHost = String(input.chainHost || '').trim();
  cfg.chainPort = clampPort(input.chainPort, 1080);
  cfg.chainUser = String(input.chainUser || '');
  cfg.chainPass = String(input.chainPass || '');
  cfg.chainWhitelist = linesToList(input.chainWhitelist);
  cfg.dialRace = !!input.dialRace;
  cfg.dialConcurrency = clampInt(input.dialConcurrency, 2, 5, 3);
  cfg.dialTimeoutMs = clampInt(input.dialTimeoutMs, 0, 30000, 0);
  cfg.logEnabled = !!input.logEnabled;
  cfg.tgEnabled = !!input.tgEnabled;
  cfg.tgBotToken = String(input.tgBotToken || '').trim();
  cfg.tgChatId = String(input.tgChatId || '').trim();
  cfg.cfApiToken = String(input.cfApiToken || '').trim();
  cfg.cfAccountId = String(input.cfAccountId || '').trim();
  cfg.disguiseHTML = String(input.disguiseHTML || '');
  const sp = String(input.subPath || '').trim();
  cfg.subPath = sp ? (sp.startsWith('/') ? sp : '/' + sp) : '';
  await kv.put(KV_CONFIG_KEY, JSON.stringify(cfg));
  return cfg;
}

/* ------------------------------------------------------------------
 * 优选 IP 获取（v2）
 * 数据来源（按顺序合并，按 IP 去重，首个出现的条目保留端口/备注）：
 *  1. 静态列表：支持 IP / IP:端口 / IP#备注 / [IPv6]:端口#备注
 *  2. URL 源：https:// 文本源（每行一个 IP，KV 缓存 6 小时）
 *  3. sub:// 聚合源：拉取外部订阅，提取其中的节点 IP
 *  4. 内置随机生成器：从 Cloudflare 公开 IP 段随机抽取（默认 16 个）
 * 返回条目数组 [{ip, port(0=用默认), remark}]。
 * ------------------------------------------------------------------ */
function sha256HexSync(s) {
  // 非加密用途的短哈希：用 FNV-1a 做缓存 key（避免 async）
  let h1 = 0x811c9dc5;
  const b = te.encode(String(s));
  for (let i = 0; i < b.length; i++) { h1 ^= b[i]; h1 = Math.imul(h1, 0x01000193); }
  return (h1 >>> 0).toString(16).padStart(8, '0');
}

/** 从订阅文本提取 IP：支持整段 base64、vless/trojan/ss/vmess 链接、裸 IP 行 */
export function extractIPsFromSubText(text) {
  const ips = new Set();
  let t = String(text || '').trim();
  if (!t) return [];
  // 整段无 "://" 且像 base64：先解码一次
  if (!t.includes('://') && /^[A-Za-z0-9+/=\r\n\s]+$/.test(t) && t.replace(/\s+/g, '').length % 4 === 0) {
    try { t = td.decode(base64ToBytes(t.replace(/\s+/g, ''))); } catch { /* 不是 base64，按原文处理 */ }
  }
  for (const rawLine of t.split('\n')) {
    const s = rawLine.trim();
    if (!s) continue;
    // vmess://BASE64(JSON) → 取 add 字段
    if (s.startsWith('vmess://')) {
      try {
        const j = JSON.parse(td.decode(base64ToBytes(s.slice(8).trim())));
        if (j && isIP(j.add)) ips.add(String(j.add).trim());
      } catch { /* 忽略坏行 */ }
      continue;
    }
    // 协议链接：取 @ 后面的 host（ss 的 userinfo 是 base64，无 @ 时跳过）
    const m = s.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^@\s]*@([^:/?#\s]+)/);
    if (m && isIP(m[1])) { ips.add(m[1]); continue; }
    // 裸 IP 行（顺手支持 IP:端口 / IP#备注写法，只取 IP）
    const e = parseIPEntry(s.split(/\s+/)[0]);
    if (e) ips.add(e.ip);
  }
  return [...ips];
}

/** 抓取单个优选源（https 文本源 或 sub:// 聚合源），返回去重 IP 数组 */
async function fetchSourceIPs(url, kv) {
  const cacheKey = KV_SRC_PREFIX + sha256HexSync(url);
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) {
        const { ts, ips } = JSON.parse(cached);
        if (Date.now() - ts < 6 * 3600 * 1000) return ips;
      }
    } catch { /* 忽略缓存错误 */ }
  }
  const ips = [];
  try {
    // sub:// 开头：去掉前缀后按普通 URL 拉取
    const realUrl = url.startsWith('sub://') ? url.slice(6) : url;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(realUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const text = await res.text();
      if (url.startsWith('sub://')) {
        ips.push(...extractIPsFromSubText(text));
      } else {
        for (const line of text.split('\n')) {
          const e = parseIPEntry(line.trim().split(/[\s;]+/)[0]);
          if (e) ips.push(e.ip);
        }
      }
    }
  } catch { /* 单个源失败不影响整体 */ }
  const uniq = [...new Set(ips)];
  if (kv && uniq.length) {
    try { await kv.put(cacheKey, JSON.stringify({ ts: Date.now(), ips: uniq }), { expirationTtl: 6 * 3600 }); } catch { /* 忽略 */ }
  }
  return uniq;
}

/** 内嵌兜底的 Cloudflare IPv4 段（官方会变，优先拉取在线列表） */
const CF_CIDR_FALLBACK = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];

/** 取 Cloudflare 公开 IPv4 段：KV 缓存 24 小时 → 在线拉取 → 内嵌兜底 */
async function getCloudflareCIDRs(env) {
  const kv = env.KV;
  if (kv) {
    try {
      const cached = await kv.get(KV_CIDR_KEY);
      if (cached) {
        const { ts, cidrs } = JSON.parse(cached);
        if (Date.now() - ts < 24 * 3600 * 1000 && cidrs && cidrs.length) return cidrs;
      }
    } catch { /* 忽略 */ }
  }
  let cidrs = [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch('https://www.cloudflare.com/ips-v4', { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      for (const line of (await res.text()).split('\n')) {
        if (cidrToRange(line.trim())) cidrs.push(line.trim());
      }
    }
  } catch { /* 拉取失败用兜底 */ }
  if (!cidrs.length) cidrs = [...CF_CIDR_FALLBACK];
  if (kv) {
    try { await kv.put(KV_CIDR_KEY, JSON.stringify({ ts: Date.now(), cidrs }), { expirationTtl: 24 * 3600 }); } catch { /* 忽略 */ }
  }
  return cidrs;
}

/** 按日期播种的确定性随机数（mulberry32 + FNV-1a 种子）：
 *  同一天内生成的随机 IP 列表完全稳定（订阅刷新不闪变，归属地缓存一次补齐
 *  全天有效），跨天自动轮换一批新 IP。 */
export function seededRand(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 当天日期种子（UTC），如 2026-10-3 */
export function todaySeed() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

/** 内置随机优选 IP 生成器：从 CF 段随机抽 count 个 */
export async function genRandomPreferredIPs(count, env, rand) {
  if (!count || count <= 0) return [];
  const cidrs = await getCloudflareCIDRs(env);
  return randomIPsFromCIDRs(cidrs, Math.min(count, 500), rand);
}

/** 全部优选 IP 条目（去重）：静态 + 各源抓取 + 随机生成。
 *  返回 [{ip, port, remark}]，port 为 0 表示用节点默认端口。
 *  数量语义：randIPCount 是订阅节点总数目标。静态条目与来源抓取的 IP
 *  优先保留，随机生成只补足差额（设 99、静态 3 个 → 随机补 96 个）。
 *  randIPCount 为 0 时关闭随机补足，节点数 = 静态 + 来源。 */
export async function getPreferredIPs(cfg, env) {
  const seen = new Set();
  const out = [];
  const push = (ip, port, remark) => {
    if (!ip || seen.has(ip)) return;
    seen.add(ip);
    out.push({ ip, port: port || 0, remark: remark || '' });
  };
  // 1. 静态列表（支持端口与备注）
  for (const s of cfg.preferredStatic || []) {
    const e = parseIPEntry(s);
    if (e) push(e.ip, e.port, e.remark);
  }
  // 2/3. URL 源（含 sub:// 聚合源）
  const kv = env.KV;
  const results = await Promise.all((cfg.preferredSources || []).map((u) => fetchSourceIPs(u, kv)));
  for (const ips of results) for (const ip of ips) push(ip, 0, '');
  // 4. 随机生成：补足到总数目标（按日期播种，同一天结果稳定）
  if (cfg.randIPCount > 0) {
    const need = Math.max(0, cfg.randIPCount - out.length);
    if (need > 0) {
      const rnd = await genRandomPreferredIPs(need, env, seededRand('ss-rand-' + todaySeed()));
      for (const ip of rnd) push(ip, cfg.randIPPort || 0, '');
    }
  }
  return out;
}

/* ------------------------------------------------------------------
 * IP 归属地：ip-api.com（免费，无需 key），KV 缓存。
 * 订阅生成时只读缓存；缺失的在后台（waitUntil）用 /batch 接口一次性
 * 补齐（单次最多 100 个 IP），缺失时节点先显示 🌐 未知，不阻塞订阅。
 * 成功结果缓存 30 天；查询失败只缓存 1 小时，避免长期污染。
 * 之前串行 1.4s/IP 的写法在 IP 多时 waitUntil 跑不完，缓存永远补不齐，
 * 这就是订阅里长期显示"未知"的根因。
 * ------------------------------------------------------------------ */
async function queryGeo(ip) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = await res.json();
    if (j && j.status === 'success' && j.countryCode) return String(j.countryCode).toUpperCase();
  } catch { /* 忽略 */ }
  return null;
}

/** 批量归属地查询：POST /batch，一次最多 100 个 IP，返回 {ip: 国家代码} */
export async function queryGeoBatch(ips) {
  const out = {};
  if (!ips || !ips.length) return out;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch('http://ip-api.com/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ips.map((ip) => ({ query: ip, fields: 'status,countryCode,query' }))),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return out;
    const arr = await res.json();
    if (Array.isArray(arr)) {
      for (const j of arr) {
        if (j && j.status === 'success' && j.countryCode && j.query) {
          out[String(j.query)] = String(j.countryCode).toUpperCase();
        }
      }
    }
  } catch { /* 忽略 */ }
  return out;
}

/** 读缓存的归属地；miss 返回 null（调用方负责后台补齐） */
export async function getCachedGeo(ip, env) {
  const kv = env.KV;
  if (!kv) return null;
  try {
    const v = await kv.get(KV_GEO_PREFIX + ip);
    return v || null;
  } catch { return null; }
}

/** 后台补齐缺失的归属地缓存（传给 ctx.waitUntil） */
export async function refreshGeoCache(ips, env) {
  const kv = env.KV;
  if (!kv) return;
  const uniq = [...new Set(ips || [])].filter(Boolean);
  if (!uniq.length) return;
  // 并行查缓存，找出缺失的
  const flags = await Promise.all(uniq.map(async (ip) => {
    try { return await kv.get(KV_GEO_PREFIX + ip); } catch { return null; }
  }));
  const missing = uniq.filter((_, i) => !flags[i]);
  if (!missing.length) return;
  // 批量查询（每批 100），全部失败才回退串行单个查询
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    let got = await queryGeoBatch(batch);
    if (!Object.keys(got).length && batch.length) {
      got = {};
      for (const ip of batch) {
        const code = await queryGeo(ip);
        if (code) got[ip] = code;
        await new Promise((r) => setTimeout(r, 1400));
      }
    }
    for (const ip of batch) {
      const code = got[ip] || null;
      try {
        await kv.put(KV_GEO_PREFIX + ip, code || '??',
          { expirationTtl: code ? 30 * 86400 : 3600 });
      } catch { /* 忽略 */ }
    }
  }
}

/* ------------------------------------------------------------------
 * 订阅节点组装
 * 命名：{域名} {国旗emoji}{中文国名} {组内序号}，如 udptoos.com 🇺🇸 美国 01；
 * 条目带 #备注 时追加在末尾，如 example.com 🇺🇸 美国 01 香港专线。
 * 排序：按国家代码分组（未知归属地 '??' 排最后），组内按 IP 排序；
 * 每个国家组内独立编号 01..NN（不同国家序号不混排），同国家节点排在一起。
 * 每个 IP 生成 VLESS / Trojan / SS 各一条（按配置启用的协议）
 * 输入兼容旧格式的字符串数组（自动转为条目）。
 * ------------------------------------------------------------------ */
export function buildNodeNames(entries, geoMap, hostPrefix) {
  const items = (entries || []).map((e) => {
    const en = typeof e === 'string' ? { ip: e, port: 0, remark: '' } : e;
    return { ip: en.ip, port: en.port || 0, remark: en.remark || '', code: (geoMap || {})[en.ip] || '??' };
  });
  // 按国家代码分组，未知归属地（'??'）排在最后；同国家内按 IP 排
  items.sort((a, b) => {
    const au = a.code === '??', bu = b.code === '??';
    if (au !== bu) return au ? 1 : -1;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.ip < b.ip ? -1 : a.ip > b.ip ? 1 : 0;
  });
  // 每组独立编号：🇺🇸 美国 01、🇺🇸 美国 02、🇨🇦 加拿大 01……
  const counters = Object.create(null);
  const prefix = hostPrefix ? hostPrefix + ' ' : '';
  return items.map((it) => {
    const known = it.code !== '??';
    const flag = known ? countryFlag(it.code) : '🌐';
    const name = known ? countryNameOf(it.code) : '未知';
    const n = (counters[it.code] = (counters[it.code] || 0) + 1);
    const num = String(n).padStart(2, '0');
    const full = `${prefix}${flag} ${name} ${num}` + (it.remark ? ` ${it.remark}` : '');
    return { ip: it.ip, port: it.port, code: it.code, name: full };
  });
}

/** 多 HOST 轮换：按节点序号取 hosts[i % n]，未配置则用请求 host */
export function pickHost(cfg, requestHost, index) {
  const hs = (cfg.hosts && cfg.hosts.length ? cfg.hosts : [requestHost]).filter(Boolean);
  if (!hs.length) return requestHost;
  return hs[index % hs.length];
}

/** 订阅 URI 的通用查询参数：0RTT / TLS 分片（按面板开关拼接） */
export function subExtraParams(cfg) {
  let p = '';
  if (cfg.earlyData) p += '&ed=2048';
  if (cfg.fragment) p += '&fragment=1,40-60,30-50,tlshello';
  return p;
}

export function buildVlessUri(node, uuid, port, host, cfg) {
  const p = node.port || port;
  let params = `encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=%2F${uuid}`;
  params += subExtraParams(cfg || {});
  return `vless://${uuid}@${node.ip}:${p}?${params}#${encodeURIComponent(node.name)}`;
}

export function buildTrojanUri(node, password, port, host, cfg) {
  const p = node.port || port;
  let params = `security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=%2Ftrojan`;
  params += subExtraParams(cfg || {});
  return `trojan://${encodeURIComponent(password)}@${node.ip}:${p}?${params}#${encodeURIComponent(node.name)}`;
}

export function buildSsUri(node, method, password, port, host, useTls) {
  const p = node.port || port;
  const userinfo = bytesToBase64(te.encode(`${method}:${password}`));
  const tlsPart = useTls === false ? '' : ';tls';
  const plugin = encodeURIComponent(`v2ray-plugin${tlsPart};host=${host};path=/ss`);
  return `ss://${userinfo}@${node.ip}:${p}/?plugin=${plugin}#${encodeURIComponent(node.name)}`;
}

/** 通用 base64 订阅（v2rayN / Shadowrocket 等）。
 *  extraLinks：?sub= 聚合进来的外部链接原文，直接追加。 */
export function buildBase64Sub(nodes, cfg, host, extraLinks) {
  const lines = [];
  nodes.forEach((n, i) => {
    const h = pickHost(cfg, host, i);
    lines.push(buildVlessUri(n, cfg.UUID, cfg.nodePort, h, cfg));
    if (cfg.trojanPassword) lines.push(buildTrojanUri(n, cfg.trojanPassword, cfg.nodePort, h, cfg));
    if (cfg.ssPassword) {
      lines.push(buildSsUri(n, cfg.ssMethod, cfg.ssPassword, cfg.nodePort, h, true));
      // SS 非 TLS 备用端口：额外生成一条 80 端口节点
      if (cfg.ssAltPort > 0) {
        const alt = { ...n, port: cfg.ssAltPort, name: n.name + ' 80' };
        lines.push(buildSsUri(alt, cfg.ssMethod, cfg.ssPassword, cfg.ssAltPort, h, false));
      }
    }
  });
  for (const l of extraLinks || []) lines.push(l);
  return bytesToBase64(te.encode(lines.join('\n')));
}

function yamlStr(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Clash YAML 订阅 */
export function buildClashSub(nodes, cfg, host) {
  const L = ['proxies:'];
  nodes.forEach((n, i) => {
    const h = pickHost(cfg, host, i);   // 多 HOST 轮换
    const p = n.port || cfg.nodePort;   // 单 IP 指定端口优先
    const name = yamlStr(n.name);
    L.push(`  - name: ${name}`);
    L.push(`    type: vless`);
    L.push(`    server: ${n.ip}`);
    L.push(`    port: ${p}`);
    L.push(`    uuid: ${cfg.UUID}`);
    L.push(`    tls: true`);
    L.push(`    servername: ${h}`);
    L.push(`    client-fingerprint: chrome`);
    L.push(`    network: ws`);
    L.push(`    ws-opts:`);
    L.push(`      path: /${cfg.UUID}`);
    L.push(`      headers:`);
    L.push(`        Host: ${h}`);
    if (cfg.trojanPassword) {
      L.push(`  - name: ${name}`);
      L.push(`    type: trojan`);
      L.push(`    server: ${n.ip}`);
      L.push(`    port: ${p}`);
      L.push(`    password: ${yamlStr(cfg.trojanPassword)}`);
      L.push(`    sni: ${h}`);
      L.push(`    client-fingerprint: chrome`);
      L.push(`    network: ws`);
      L.push(`    ws-opts:`);
      L.push(`      path: /trojan`);
      L.push(`      headers:`);
      L.push(`        Host: ${h}`);
    }
    if (cfg.ssPassword) {
      L.push(`  - name: ${name}`);
      L.push(`    type: ss`);
      L.push(`    server: ${n.ip}`);
      L.push(`    port: ${p}`);
      L.push(`    cipher: ${cfg.ssMethod}`);
      L.push(`    password: ${yamlStr(cfg.ssPassword)}`);
      L.push(`    plugin: v2ray-plugin`);
      L.push(`    plugin-opts:`);
      L.push(`      mode: websocket`);
      L.push(`      tls: true`);
      L.push(`      host: ${h}`);
      L.push(`      path: /ss`);
      if (cfg.ssAltPort > 0) {
        // SS 非 TLS 备用端口节点
        L.push(`  - name: ${yamlStr(n.name + ' 80')}`);
        L.push(`    type: ss`);
        L.push(`    server: ${n.ip}`);
        L.push(`    port: ${cfg.ssAltPort}`);
        L.push(`    cipher: ${cfg.ssMethod}`);
        L.push(`    password: ${yamlStr(cfg.ssPassword)}`);
        L.push(`    plugin: v2ray-plugin`);
        L.push(`    plugin-opts:`);
        L.push(`      mode: websocket`);
        L.push(`      tls: false`);
        L.push(`      host: ${h}`);
        L.push(`      path: /ss`);
      }
    }
  });
  return L.join('\n') + '\n';
}

/* ------------------------------------------------------------------
 * 更多订阅格式：Surge / Quantumult X / Loon
 * 均为尽力而为的标准写法；SS 在这些客户端里按各自插件写法输出。
 * ------------------------------------------------------------------ */

/** Surge 订阅（proxy 段） */
export function buildSurgeSub(nodes, cfg, host) {
  const L = ['#!MANAGED-CONFIG https://example.com/surge.conf interval=86400', '', '[Proxy]'];
  nodes.forEach((n, i) => {
    const h = pickHost(cfg, host, i);
    const p = n.port || cfg.nodePort;
    const tag = n.name.replace(/,/g, ' ');
    const extra = subExtraParams(cfg);
    L.push(`${tag} = vless, ${n.ip}, ${p}, username=${cfg.UUID}, tls=true, sni=${h}, ws=true, ws-path=/${cfg.UUID}, ws-headers=Host:${h}, fingerprint=chrome${extra ? ', ' + extra.slice(1).replace(/&/g, ', ') : ''}`);
    if (cfg.trojanPassword) {
      L.push(`${tag} = trojan, ${n.ip}, ${p}, password=${cfg.trojanPassword}, sni=${h}, ws=true, ws-path=/trojan, ws-headers=Host:${h}, fingerprint=chrome`);
    }
    if (cfg.ssPassword) {
      L.push(`${tag} = ss, ${n.ip}, ${p}, encrypt-method=${cfg.ssMethod}, password=${cfg.ssPassword}, ws=true, ws-path=/ss, ws-headers=Host:${h}, tls=true`);
    }
  });
  L.push('', '[Proxy Group]', '影梭 = select, ' + nodes.map((n) => n.name.replace(/,/g, ' ')).join(', '));
  return L.join('\n') + '\n';
}

/** Quantumult X 订阅 */
export function buildQuanxSub(nodes, cfg, host) {
  const L = [];
  nodes.forEach((n, i) => {
    const h = pickHost(cfg, host, i);
    const p = n.port || cfg.nodePort;
    const tag = `tag=${n.name.replace(/,/g, ' ')}`;
    const extra = subExtraParams(cfg);
    L.push(`vless=${n.ip}:${p}, method=none, password=${cfg.UUID}, fast-open=false, udp-relay=true, tls=true, sni=${h}, ws=true, ws-path=/${cfg.UUID}, ws-headers=Host:${h}, ${tag}${extra.replace(/&/g, ', ')}`);
    if (cfg.trojanPassword) {
      L.push(`trojan=${n.ip}:${p}, password=${cfg.trojanPassword}, over-tls=true, tls-host=${h}, ws=true, ws-path=/trojan, ws-headers=Host:${h}, ${tag}`);
    }
    if (cfg.ssPassword) {
      L.push(`shadowsocks=${n.ip}:${p}, method=${cfg.ssMethod}, password=${cfg.ssPassword}, ws=true, ws-path=/ss, ws-headers=Host:${h}, tls=true, ${tag}`);
    }
  });
  return L.join('\n') + '\n';
}

/** Loon 订阅 */
export function buildLoonSub(nodes, cfg, host) {
  const L = ['[Proxy]'];
  nodes.forEach((n, i) => {
    const h = pickHost(cfg, host, i);
    const p = n.port || cfg.nodePort;
    const tag = n.name.replace(/,/g, ' ');
    L.push(`${tag} = VLESS,${n.ip},${p},${cfg.UUID},udp=true,tls=true,sni=${h},ws=true,ws-path=/${cfg.UUID},ws-headers=Host:${h},fingerprint=chrome`);
    if (cfg.trojanPassword) {
      L.push(`${tag} = Trojan,${n.ip},${p},${cfg.trojanPassword},udp=true,sni=${h},ws=true,ws-path=/trojan,ws-headers=Host:${h}`);
    }
    if (cfg.ssPassword) {
      L.push(`${tag} = Shadowsocks,${n.ip},${p},${cfg.ssMethod},"${cfg.ssPassword}",udp=true,ws=true,ws-path=/ss,ws-headers=Host:${h},tls=true`);
    }
  });
  return L.join('\n') + '\n';
}

/* ------------------------------------------------------------------
 * 外部节点链接解析（用于 ?sub= 聚合）：解析 vless/trojan/ss 链接为
 * {proto, server, port, id, name}，非法返回 null。
 * ------------------------------------------------------------------ */
export function parseNodeLink(link) {
  const s = String(link || '').trim();
  let m = s.match(/^vless:\/\/([^@]+)@([^:/?#]+)(?::(\d+))?[^#]*(?:#(.*))?$/i);
  if (m) {
    return { proto: 'vless', id: m[1], server: m[2], port: m[3] ? Number(m[3]) : 443, name: safeDecode(m[4] || 'vless'), raw: s };
  }
  m = s.match(/^trojan:\/\/([^@]+)@([^:/?#]+)(?::(\d+))?[^#]*(?:#(.*))?$/i);
  if (m) {
    return { proto: 'trojan', id: m[1], server: m[2], port: m[3] ? Number(m[3]) : 443, name: safeDecode(m[4] || 'trojan'), raw: s };
  }
  m = s.match(/^ss:\/\/([^@\/]+)@([^:/?#]+)(?::(\d+))?[^#]*(?:#(.*))?$/i);
  if (m) {
    let method = '', password = '';
    try {
      const up = td.decode(base64ToBytes(m[1]));
      const ci = up.indexOf(':');
      if (ci > 0) { method = up.slice(0, ci); password = up.slice(ci + 1); }
    } catch { /* 忽略 */ }
    return { proto: 'ss', method, password, server: m[2], port: m[3] ? Number(m[3]) : 443, name: safeDecode(m[4] || 'ss'), raw: s };
  }
  return null;
}

/** 安全解码 URI 片段（失败返回原文） */
export function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** 从 ?sub= 指定的外部订阅拉取节点链接原文数组（去重） */
export async function fetchAggSubLinks(subUrl) {
  const links = [];
  try {
    const u = new URL(subUrl);
    if (!/^https?:$/.test(u.protocol)) return links;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(subUrl, { signal: ctrl.signal, headers: { 'user-agent': 'shadowshuttle/2.0' } });
    clearTimeout(timer);
    if (!res.ok) return links;
    let text = await res.text();
    text = text.trim();
    if (!text.includes('://') && /^[A-Za-z0-9+/=\r\n\s]+$/.test(text)) {
      try { text = td.decode(base64ToBytes(text.replace(/\s+/g, ''))); } catch { /* 按原文 */ }
    }
    for (const line of text.split('\n')) {
      const s = line.trim();
      if (s && /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) links.push(s);
    }
  } catch { /* 忽略 */ }
  return [...new Set(links)];
}

/* ------------------------------------------------------------------
 * 订阅格式识别：显式 ?target= 参数优先，其次 UA 嗅探，默认 base64。
 * ------------------------------------------------------------------ */
export const SUB_FORMATS = ['base64', 'clash', 'singbox', 'surge', 'quanx', 'loon'];

export function detectSubFormat(request, explicitPath) {
  if (explicitPath && SUB_FORMATS.includes(explicitPath)) return explicitPath;
  try {
    const u = new URL(request.url);
    const t = (u.searchParams.get('target') || '').toLowerCase();
    if (SUB_FORMATS.includes(t)) return t;
    // 兼容 subconverter 风格的 target 名
    if (t === 'mixed') return 'base64';
  } catch { /* 忽略 */ }
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  if (ua.includes('clash') || ua.includes('stash')) return 'clash';
  if (ua.includes('sing-box') || ua.includes('singbox') || ua.includes('sfa')) return 'singbox';
  if (ua.includes('surge')) return 'surge';
  if (ua.includes('quantumult')) return 'quanx';
  if (ua.includes('loon')) return 'loon';
  return 'base64';
}

/** sing-box JSON 订阅 */
export function buildSingboxSub(nodes, cfg, host) {
  const outbounds = [];
  nodes.forEach((n, i) => {
    const h = pickHost(cfg, host, i);   // 多 HOST 轮换
    const p = n.port || cfg.nodePort;   // 单 IP 指定端口优先
    const tls = { enabled: true, server_name: h, utls: { enabled: true, fingerprint: 'chrome' } };
    const ws = (path) => ({ type: 'ws', path, headers: { Host: h } });
    outbounds.push({
      type: 'vless', tag: n.name, server: n.ip, server_port: p,
      uuid: cfg.UUID, tls, transport: ws(`/${cfg.UUID}`),
    });
    if (cfg.trojanPassword) {
      outbounds.push({
        type: 'trojan', tag: n.name, server: n.ip, server_port: p,
        password: cfg.trojanPassword, tls, transport: ws('/trojan'),
      });
    }
    if (cfg.ssPassword) {
      outbounds.push({
        type: 'shadowsocks', tag: n.name, server: n.ip, server_port: p,
        method: cfg.ssMethod, password: cfg.ssPassword, tls, transport: ws('/ss'),
      });
      if (cfg.ssAltPort > 0) {
        // SS 非 TLS 备用端口节点
        outbounds.push({
          type: 'shadowsocks', tag: n.name + ' 80', server: n.ip, server_port: cfg.ssAltPort,
          method: cfg.ssMethod, password: cfg.ssPassword,
          transport: { type: 'ws', path: '/ss', headers: { Host: h } },
        });
      }
    }
  });
  return JSON.stringify({ outbounds }, null, 2);
}

/* ------------------------------------------------------------------
 * 管理界面（v2）：现代简约风格
 * 纯手写 HTML + CSS + JS，不依赖任何 CDN，保证单文件可离线部署。
 * - 深色模式：CSS 变量 + [data-theme] 切换，localStorage 'ss-theme' 记忆
 * - 二维码：自研内联 QR 编码器（byte 模式 / ECC-M），无外部库
 * - 折叠卡片、emoji 设置行、toggle 开关、pill 多选、toast 提示
 * - 源码维护在仓库 ui.js，本文件为内联后的部署版本（保持同步）
 * ------------------------------------------------------------------ */

/* ----------------------------------------------------------------------------
 * 自研 QR 编码器（clean-room 实现，未参考任何现成 QR 库源码）
 * - 数据模式：byte 模式，文本按 UTF-8 编码
 * - 纠错级别：M（约可恢复 15% 码字）
 * - 版本：按内容长度自动选择 1 ~ 10
 * - 输出：SVG 字符串（含 4 模块静区，黑底白底 crispEdges）
 * 用法：qrcodeSVG('https://example.com') -> '<svg ...>...</svg>'
 * ---------------------------------------------------------------------------- */
function qrcodeSVG(text) {
  // 版本 1~10 在 ECC-M 下的分块参数：
  // [每块纠错码字数, 组1块数, 组1每块数据码字数, 组2块数, 组2每块数据码字数]
  // （与 ISO/IEC 18004 表 9 一致，并用「总码字数 = 各块(数据+纠错)之和」
  //  逐版本核对过：26/44/70/100/134/172/196/242/292/346）
  var BLK = [
    [10, 1, 16, 0, 0],
    [16, 1, 28, 0, 0],
    [26, 1, 44, 0, 0],
    [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0],
    [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44]
  ];
  // 校正图形中心坐标（版本 1 没有校正图形）
  var ALI = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
             [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  var bytes = new TextEncoder().encode(text);

  // —— 按容量选择能装下的最小版本 ——
  var ver = 0, dataCap = 0, blk = null, v, b, cap, need;
  for (v = 1; v <= 10; v++) {
    b = BLK[v - 1];
    cap = b[1] * b[2] + b[3] * b[4];                    // 数据码字总数
    need = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;    // 模式指示+字符计数+数据
    if (need <= cap * 8) { ver = v; dataCap = cap; blk = b; break; }
  }
  if (!ver) throw new Error('内容过长，超出版本 10 上限');

  // —— 数据编码：模式指示 0100 + 字符计数 + 数据字节 ——
  // 注：byte 模式字符计数位宽：版本 1~9 用 8 位，版本 10 用 16 位
  var bits = [], i, j;
  function put(val, n) { for (var k = n - 1; k >= 0; k--) bits.push((val >> k) & 1); }
  put(4, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (i = 0; i < bytes.length; i++) put(bytes[i], 8);
  var total = dataCap * 8;
  var term = Math.min(4, total - bits.length);           // 终结符（按剩余空间截断）
  for (i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);                  // 补齐到字节边界
  var data = [];
  for (i = 0; i < bits.length; i += 8) {
    var w = 0;
    for (j = 0; j < 8; j++) w = (w << 1) | bits[i + j];
    data.push(w);
  }
  for (var p = 0; data.length < dataCap; p++) data.push(p % 2 ? 0x11 : 0xEC); // 填充码字

  // —— GF(256)：本原多项式 x^8 + x^4 + x^3 + x^2 + 1（0x11D）——
  var EXP = new Array(512), LOG = new Array(256), x = 1;
  for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
  for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  function gmul(aa, bb) { return (aa === 0 || bb === 0) ? 0 : EXP[LOG[aa] + LOG[bb]]; }

  // —— RS 生成多项式：∏(x + α^i)，i = 0..ecLen-1（特征 2 下减法即加法）——
  var ecLen = blk[0], gen = [1], nx;
  for (i = 0; i < ecLen; i++) {
    nx = new Array(gen.length + 1).fill(0);
    for (j = 0; j < gen.length; j++) { nx[j] ^= gmul(gen[j], EXP[i]); nx[j + 1] ^= gen[j]; }
    gen = nx;
  }
  // 单块 RS 编码：返回 ecLen 个纠错码字（多项式长除法取余数）。
  // 注意 gen 是升幂排列（gen[0] 为常数项、gen[ecLen] = 1 为首项），
  // 长除法消元时首项要对齐 r[ii]，故下标取 gen[ecLen - jj]。
  function rsBlock(d) {
    var r = d.concat(new Array(ecLen).fill(0));
    for (var ii = 0; ii < d.length; ii++) {
      var c = r[ii];
      if (c) for (var jj = 0; jj <= ecLen; jj++) r[ii + jj] ^= gmul(gen[ecLen - jj], c);
    }
    return r.slice(d.length);
  }

  // —— 按块参数切分数据块，再把数据码字 / 纠错码字分别交织 ——
  // 交织顺序：先按列交织全部数据块（短块缺位跳过），再按列交织纠错块
  var blocks = [], off = 0;
  var groups = [[blk[1], blk[2]], [blk[3], blk[4]]];
  for (var g = 0; g < 2; g++) for (var k = 0; k < groups[g][0]; k++) {
    blocks.push({ d: data.slice(off, off + groups[g][1]) });
    off += groups[g][1];
  }
  var seq = [], maxD = Math.max(blk[2], blk[4]), bi;
  for (i = 0; i < maxD; i++)
    for (bi = 0; bi < blocks.length; bi++)
      if (i < blocks[bi].d.length) seq.push(blocks[bi].d[i]);
  for (bi = 0; bi < blocks.length; bi++) blocks[bi].e = rsBlock(blocks[bi].d);
  for (i = 0; i < ecLen; i++)
    for (bi = 0; bi < blocks.length; bi++) seq.push(blocks[bi].e[i]);

  // —— 矩阵：mod=true 深色；fun=true 功能图形（不放数据、不参与掩模）——
  var n = 21 + (ver - 1) * 4, yy, xx;
  var mod = [], fun = [];
  for (yy = 0; yy < n; yy++) { mod.push(new Array(n).fill(false)); fun.push(new Array(n).fill(false)); }
  function setM(px, py, val, isFun) { mod[py][px] = !!val; if (isFun) fun[py][px] = true; }

  // 定位图形（7x7）+ 一圈分隔带
  function finder(cx, cy) {
    for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
      var dd = Math.max(Math.abs(dx), Math.abs(dy));
      var px = cx + dx, py = cy + dy;
      if (px >= 0 && py >= 0 && px < n && py < n) setM(px, py, dd !== 2 && dd !== 4, true);
    }
  }
  finder(3, 3); finder(n - 4, 3); finder(3, n - 4);

  // 时钟图形（跳过定位图形区，只画中间段）
  for (i = 8; i < n - 8; i++) { setM(6, i, i % 2 === 0, true); setM(i, 6, i % 2 === 0, true); }

  // 校正图形（5x5，跳过与定位图形重叠的位置）
  var FR = [[0, 0, 7, 7], [n - 8, 0, n - 1, 7], [0, n - 8, 7, n - 1]]; // 三个定位区范围
  var ap = ALI[ver - 1];
  for (var iy = 0; iy < ap.length; iy++) for (var ix = 0; ix < ap.length; ix++) {
    var ax = ap[ix], ay = ap[iy], overlap = false;
    for (var f = 0; f < 3; f++) {
      var r = FR[f];
      if (ax + 2 >= r[0] && ax - 2 <= r[2] && ay + 2 >= r[1] && ay - 2 <= r[3]) { overlap = true; break; }
    }
    if (overlap) continue;
    for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++)
      setM(ax + dx2, ay + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1, true);
  }

  // 格式信息占位（15 位，掩模选定后再填真实值）
  for (i = 0; i < 6; i++) { fun[i][8] = true; fun[8][i] = true; }
  fun[7][8] = true; fun[8][8] = true; fun[8][7] = true;
  for (i = 0; i < 8; i++) fun[8][n - 1 - i] = true;
  for (i = 8; i < 15; i++) fun[n - 15 + i][8] = true;
  fun[8][4 * ver + 9] = true;                                   // 暗模块
  // 版本信息占位（版本 7+ 才有，18 位）
  if (ver >= 7) for (i = 0; i < 18; i++) {
    var va = n - 11 + (i % 3), vc = (i / 3) | 0;
    fun[vc][va] = true; fun[va][vc] = true;
  }

  // —— 数据放置：从右下开始蛇形向上 / 下，跳过第 6 列时钟线 ——
  var bitLen = seq.length * 8, pos = 0;
  function nextBit() { var wd = seq[pos >> 3]; return (wd >> (7 - (pos++ & 7))) & 1; }
  for (var right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (var vert = 0; vert < n; vert++) for (j = 0; j < 2; j++) {
      xx = right - j;
      yy = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
      if (!fun[yy][xx] && pos < bitLen) mod[yy][xx] = nextBit() === 1;
    }
  }
  // 剩余未填模块保持浅色（即规范里的补余位 0）

  // —— 掩模：8 种公式全试，按标准罚分规则选最优 ——
  function maskBit(m, px, py) {
    switch (m) {
      case 0: return (px + py) % 2 === 0;
      case 1: return py % 2 === 0;
      case 2: return px % 3 === 0;
      case 3: return (px + py) % 3 === 0;
      case 4: return ((((px / 3) | 0) + ((py / 2) | 0)) % 2) === 0;
      case 5: return ((px * py) % 2 + (px * py) % 3) === 0;
      case 6: return (((px * py) % 2 + (px * py) % 3) % 2) === 0;
      default: return (((px + py) % 2 + (px * py) % 3) % 2) === 0;
    }
  }
  // 标准罚分 N1~N4
  function penalty(mx) {
    var s = 0, r, c;
    // N1：行 / 列连续 5 个以上同色
    for (r = 0; r < n; r++) {
      var run = 1;
      for (c = 1; c <= n; c++) {
        if (c < n && mx[r][c] === mx[r][c - 1]) run++;
        else { if (run >= 5) s += 3 + (run - 5); run = 1; }
      }
    }
    for (c = 0; c < n; c++) {
      var run2 = 1;
      for (r = 1; r <= n; r++) {
        if (r < n && mx[r][c] === mx[r - 1][c]) run2++;
        else { if (run2 >= 5) s += 3 + (run2 - 5); run2 = 1; }
      }
    }
    // N2：2x2 同色块
    for (r = 0; r < n - 1; r++) for (c = 0; c < n - 1; c++) {
      var z = mx[r][c];
      if (z === mx[r][c + 1] && z === mx[r + 1][c] && z === mx[r + 1][c + 1]) s += 3;
    }
    // N3：形如 10111010000 / 00001011101 的图形
    var lines = [], li, pi, idx;
    for (r = 0; r < n; r++) { var s1 = ''; for (c = 0; c < n; c++) s1 += mx[r][c] ? '1' : '0'; lines.push(s1); }
    for (c = 0; c < n; c++) { var s2 = ''; for (r = 0; r < n; r++) s2 += mx[r][c] ? '1' : '0'; lines.push(s2); }
    var pats = ['10111010000', '00001011101'], cnt3 = 0;
    for (li = 0; li < lines.length; li++) for (pi = 0; pi < 2; pi++) {
      idx = -1;
      while ((idx = lines[li].indexOf(pats[pi], idx + 1)) !== -1) cnt3++;
    }
    s += cnt3 * 40;
    // N4：深色模块比例偏离 50%，每 5% 计 10 分
    var dark = 0;
    for (r = 0; r < n; r++) for (c = 0; c < n; c++) if (mx[r][c]) dark++;
    s += Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10;
    return s;
  }
  var best = 0, bestScore = Infinity, m;
  for (m = 0; m < 8; m++) {
    var trial = [];
    for (yy = 0; yy < n; yy++) {
      var trow = [];
      for (xx = 0; xx < n; xx++)
        trow.push(fun[yy][xx] ? mod[yy][xx] : (mod[yy][xx] !== maskBit(m, xx, yy)));
      trial.push(trow);
    }
    var sc = penalty(trial);
    if (sc < bestScore) { bestScore = sc; best = m; }
  }
  for (yy = 0; yy < n; yy++) for (xx = 0; xx < n; xx++)
    if (!fun[yy][xx] && maskBit(best, xx, yy)) mod[yy][xx] = !mod[yy][xx];

  // —— 绘制格式信息（15 位 BCH：数据 5 位 + 余式 10 位，再异或掩模 0x5412）——
  // 纠错级 M 的指示位是 00，故数据 5 位就是掩模编号本身
  // （校验：掩模 0 时结果恒为 0x5412，与公开锚点一致）
  function fmtBits(mask) {
    var d5 = mask, dd = d5 << 10, G = 0x537, k;
    for (k = 14; k >= 10; k--) if ((dd >> k) & 1) dd ^= G << (k - 10);
    return (((d5 << 10) | (dd & 0x3FF)) ^ 0x5412) & 0x7FFF;
  }
  var fb = fmtBits(best);
  function fbit(k) { return ((fb >> k) & 1) === 1; }
  for (i = 0; i <= 5; i++) mod[i][8] = fbit(i);
  mod[7][8] = fbit(6); mod[8][8] = fbit(7); mod[8][7] = fbit(8);
  for (i = 9; i < 15; i++) mod[8][14 - i] = fbit(i);
  for (i = 0; i < 8; i++) mod[8][n - 1 - i] = fbit(i);
  for (i = 8; i < 15; i++) mod[n - 15 + i][8] = fbit(i);
  mod[8][4 * ver + 9] = true;                                   // 暗模块恒为深色

  // —— 绘制版本信息（版本 7+，18 位 BCH；版本 7 的锚点是 0x07C94）——
  if (ver >= 7) {
    var vd = ver << 12, G2 = 0x1F25, k2;
    for (k2 = 17; k2 >= 12; k2--) if ((vd >> k2) & 1) vd ^= G2 << (k2 - 12);
    var vb = ((ver << 12) | (vd & 0xFFF)) & 0x3FFFF;
    for (i = 0; i < 18; i++) {
      var vv = ((vb >> i) & 1) === 1;
      var aa = n - 11 + (i % 3), cc = (i / 3) | 0;
      mod[cc][aa] = vv; mod[aa][cc] = vv;
    }
  }

  // —— 输出 SVG（含 4 模块静区）——
  var S = n + 8, d = '';
  for (yy = 0; yy < n; yy++) for (xx = 0; xx < n; xx++)
    if (mod[yy][xx]) d += 'M' + (xx + 4) + ' ' + (yy + 4) + 'h1v1h-1z';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + S + ' ' + S + '"' +
    ' shape-rendering="crispEdges"><rect width="' + S + '" height="' + S + '" fill="#fff"/>' +
    '<path d="' + d + '" fill="#000"/></svg>';
}

/* ----------------------------------------------------------------------------
 * 全站基础样式：现代简约
 * - 14px 系统字体栈，大量留白；中性灰 + 单一强调色 #2563eb
 * - 卡片圆角 10px、1px 分割线；无渐变、无阴影堆砌（仅 toast/弹窗一层柔光）
 * - 深色模式：[data-theme="dark"] 变量切换，记忆在 localStorage 'ss-theme'
 * ---------------------------------------------------------------------------- */
function cssBase() {
  return `
:root{
  --bg:#f6f7f9; --card:#ffffff; --text:#151a23; --muted:#6b7280;
  --line:#e6e8ec; --accent:#2563eb; --accent-soft:#e9f0fd;
  --danger:#dc2626; --danger-soft:#fdf0f0; --ok:#16a34a;
  --radius:10px;
  color-scheme:light; /* 原生控件（数字微调/滚动条）跟随浅色 */
}
[data-theme="dark"]{
  --bg:#0c1016; --card:#141a24; --text:#e8ebf1; --muted:#98a1b3;
  --line:#232c3b; --accent:#2563eb; --accent-soft:#17294d;
  --danger:#f87171; --danger-soft:#2b1416; --ok:#34d399;
  color-scheme:dark; /* 深色下原生控件不刺眼 */
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);
  font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}
.wrap{max-width:860px;margin:0 auto;padding:20px 16px 150px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
.muted{color:var(--muted)}
.center{text-align:center}

/* 顶栏与 Tab */
.topbar{background:var(--card);border-bottom:1px solid var(--line)}
.tb-in{display:flex;align-items:center;justify-content:space-between;padding:14px 0 10px}
.brand{font-size:16px;display:flex;align-items:center;gap:8px}
.brand .ver{font-size:12px;color:var(--muted);font-weight:400}
.tb-act{display:flex;gap:8px}
.tabs{display:flex;gap:4px;padding:0 0 12px}
.tab{flex:1;padding:9px 4px;border:0;border-radius:8px;background:transparent;
  color:var(--muted);font:inherit;cursor:pointer;white-space:nowrap}
.tab:hover{color:var(--text)}
.tab.on{background:var(--accent-soft);color:var(--accent);font-weight:600}

/* 卡片 */
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:18px 20px;margin:0 0 16px}
.card h3{margin:0 0 4px;font-size:15px}
.card .sub{margin:0 0 6px;color:var(--muted);font-size:13px}

/* 设置行：emoji 图标 + 固定宽 label 两栏对齐 + 右侧控件 */
.row{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0;padding-bottom:2px}
.row .ic{width:24px;flex:none;text-align:center;padding-top:7px}
.row .lb{width:118px;flex:none;padding-top:8px;font-weight:500}
.row .ct{flex:1;min-width:0}
.hint{font-size:12px;color:var(--muted);margin-top:6px;line-height:1.5}

/* 输入控件 */
.inp{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;
  background:var(--card);color:var(--text);font:inherit;max-width:100%}
.inp:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.inp::placeholder{color:var(--muted);opacity:.7}
textarea.inp{resize:vertical;min-height:74px;line-height:1.6}
select.inp{width:auto;min-width:200px}
input[type="number"].inp{width:140px}
input[readonly].inp{background:var(--bg);cursor:default}

/* 开关（toggle switch） */
.sw{position:relative;display:inline-block;width:42px;height:23px;flex:none;margin-top:8px}
.sw input{opacity:0;width:0;height:0;margin:0}
.sw .tr{position:absolute;inset:0;background:#cbd5e1;border-radius:999px;cursor:pointer;transition:background .15s}
.sw .tr:before{content:"";position:absolute;width:17px;height:17px;left:3px;top:3px;
  background:#fff;border-radius:50%;transition:transform .15s}
.sw input:checked + .tr{background:var(--accent)}
.sw input:checked + .tr:before{transform:translateX(19px)}
[data-theme="dark"] .sw .tr{background:#3a4356}

/* 胶囊多选组 */
.pills{display:flex;gap:8px;flex-wrap:wrap;padding-top:4px}
.pill{padding:6px 16px;border:1px solid var(--line);border-radius:999px;background:transparent;
  color:var(--muted);font:inherit;cursor:pointer}
.pill.on{background:var(--accent-soft);border-color:var(--accent);color:var(--accent);font-weight:600}

/* 按钮层级：实心强调 / 灰色幽灵 / 红色幽灵 */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;
  padding:8px 18px;border-radius:8px;border:1px solid transparent;font:inherit;cursor:pointer;white-space:nowrap;
  transition:border-color .15s, color .15s, background .15s, filter .15s}
.btn-pri{background:var(--accent);color:#fff;font-weight:600}
.btn-pri:hover{filter:brightness(1.08)}
.btn-ghost{background:transparent;border-color:var(--line);color:var(--text)}
.btn-ghost:hover{border-color:var(--muted)}
.btn-danger-ghost{background:transparent;border-color:var(--danger);color:var(--danger)}
/* 复制成功态：绿边 + 勾选，给用户明确反馈 */
.btn.copied{border-color:var(--ok);color:var(--ok)}
.btn-sm{padding:5px 12px;font-size:13px}
.btn:disabled{opacity:.55;cursor:default}
.ibtn{width:34px;height:34px;border:1px solid var(--line);border-radius:8px;background:transparent;
  color:var(--text);font-size:15px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.ibtn:hover{border-color:var(--muted)}

/* 底部 sticky 保存栏 */
.savebar{position:fixed;left:0;right:0;bottom:0;z-index:30;background:var(--card);border-top:1px solid var(--line)}
.savebar-in{max-width:860px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;justify-content:flex-end;gap:12px}
.dirty{font-size:13px;color:var(--accent)}

/* 状态仪表盘 */
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px}
.stat .k{font-size:12px;color:var(--muted);margin-bottom:6px;display:flex;align-items:center;gap:6px}
.stat .v{font-size:20px;font-weight:700}
.stat .s{font-size:12px;color:var(--muted);margin-top:2px}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex:none}
.dot.on{background:var(--ok)} .dot.off{background:#cbd5e1}
[data-theme="dark"] .dot.off{background:#3a4356}
.bar{height:8px;background:var(--line);border-radius:99px;overflow:hidden;margin:6px 0 2px}
.bar>i{display:block;height:100%;background:var(--accent);border-radius:99px}

/* 引导步骤 */
.step{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);align-items:flex-start}
.step:last-child{border-bottom:0}
.step .n{width:24px;height:24px;border-radius:50%;background:var(--accent-soft);color:var(--accent);
  font-weight:700;display:flex;align-items:center;justify-content:center;flex:none;font-size:13px}
.step .t{flex:1;min-width:0}
.step .t b{display:block;margin-bottom:4px}

/* 可折叠卡片 */
details.dcard{padding:0}
details.dcard summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;
  padding:16px 20px;font-size:15px;font-weight:600;user-select:none}
details.dcard summary::-webkit-details-marker{display:none}
details.dcard summary .chev{margin-left:auto;color:var(--muted);transition:transform .15s;font-size:16px}
details.dcard[open] summary .chev{transform:rotate(90deg)}
details.dcard .dbody{padding:0 20px 14px}

/* 订阅行 */
.subitem{padding:10px 0;border-bottom:1px solid var(--line)}
.subitem:last-child{border-bottom:0}
.subrow{display:flex;gap:8px;align-items:center}
.subrow .nm{width:104px;flex:none;font-weight:500}
.subrow .inp{flex:1;min-width:0}

/* 逐行测试结果 */
.trow{display:flex;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px dashed var(--line);font-size:13px;flex-wrap:wrap}
.trow:last-child{border-bottom:0}
.trow .ok{color:var(--ok);font-weight:600}
.trow .bad{color:var(--danger)}

/* 弹窗 */
.mback{position:fixed;inset:0;background:rgba(15,20,30,.5);z-index:90;
  display:flex;align-items:center;justify-content:center;padding:20px}
.modal{background:var(--card);border-radius:12px;width:100%;max-width:480px;max-height:82vh;
  overflow:auto;padding:18px 20px;box-shadow:0 12px 40px rgba(0,0,0,.18)}
.modal.wide{max-width:720px}
.mhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-size:15px}
.qrbox{display:flex;justify-content:center;padding:8px 0}
.qrbox svg{width:100%;max-width:280px;height:auto;border:1px solid var(--line);border-radius:8px}

/* 日志表格 */
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;word-break:break-all}
th{color:var(--muted);font-weight:600;white-space:nowrap}
td.uacell{max-width:220px;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}

/* 右上 toast（滑入） */
.toasts{position:fixed;top:16px;right:16px;z-index:100;display:flex;flex-direction:column;gap:8px;align-items:flex-end}
.toast{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--accent);
  border-radius:8px;padding:10px 14px;max-width:340px;box-shadow:0 6px 24px rgba(0,0,0,.12);
  animation:slidein .22s ease-out}
.toast.err{border-left-color:var(--danger)}
.toast.out{opacity:0;transform:translateX(16px);transition:all .25s}
@keyframes slidein{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}

/* 危险区 */
.danger{border-color:var(--danger)}
.danger h3{color:var(--danger)}

/* 登录页 */
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.login-card{width:100%;max-width:360px;background:var(--card);border:1px solid var(--line);
  border-radius:14px;padding:30px 28px;text-align:center}
.login-card .logo{font-size:40px;margin-bottom:8px}
.login-card h1{font-size:19px;margin:0 0 4px}
.login-card p{color:var(--muted);font-size:13px;margin:0 0 20px}
.login-card .inp{margin-bottom:12px;text-align:center}
.login-card .btn{width:100%}

/* 命名规则说明 */
.rule-eg{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.rule-eg span{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:4px 10px;font-size:13px}

/* 移动端 */
@media (max-width:640px){
  .row .lb{width:92px}
  .stats{grid-template-columns:repeat(2,1fr)}
  .subrow{flex-wrap:wrap}
  .subrow .nm{width:100%}
  .subrow .inp{flex:1 1 100%}
  select.inp{min-width:0;width:100%}
  input[type="number"].inp{width:100%}
  .card{padding:14px 16px}
  details.dcard summary{padding:14px 16px}
  details.dcard .dbody{padding:0 16px 10px}
}
`;
}

/* ----------------------------------------------------------------------------
 * 服务端小工具：拼 HTML 转义与表单行（只在 Worker 端执行，不进浏览器）
 * ---------------------------------------------------------------------------- */
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// <head> 内联主题初始化脚本：localStorage 'ss-theme' 记忆，默认跟随系统。
// 放在 <head> 最前，避免深色模式下闪白。
var THEME_INIT = `<script>(function(){try{var t=localStorage.getItem('ss-theme');` +
  `if(t!=='dark'&&t!=='light'){t=(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)` +
  `?'dark':'light';}document.documentElement.dataset.theme=t;}` +
  `catch(e){document.documentElement.dataset.theme='light';}})();<\/script>`;

// 一行设置：emoji 图标 + 固定宽 label 两栏对齐 + 右侧控件（+ 可选小字说明）
function srow(icon, label, inner, hint) {
  return '<div class="row"><span class="ic">' + icon + '</span>' +
    '<span class="lb">' + label + '</span><div class="ct">' + inner +
    (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div></div>';
}
function fText(k, ph) {
  return '<input class="inp" id="f-' + k + '" type="text" placeholder="' + escHtml(ph || '') +
    '" autocomplete="off" spellcheck="false">';
}
function fNum(k, ph) {
  return '<input class="inp" id="f-' + k + '" type="number" min="0" placeholder="' + escHtml(ph || '') + '">';
}
function fArea(k, ph, rows) {
  return '<textarea class="inp mono" id="f-' + k + '" rows="' + (rows || 3) + '" placeholder="' +
    escHtml(ph || '') + '" spellcheck="false"></textarea>';
}
function fSel(k, opts) {
  var h = '<select class="inp" id="f-' + k + '">';
  for (var i = 0; i < opts.length; i++)
    h += '<option value="' + escHtml(opts[i][0]) + '">' + escHtml(opts[i][1]) + '</option>';
  return h + '</select>';
}
function fTgl(k) {
  return '<label class="sw"><input type="checkbox" id="f-' + k + '"><span class="tr"></span></label>';
}
// 胶囊多选组：点击后把值记在容器 data-val 上
function fPills(k, opts) {
  var h = '<div class="pills" id="pills-' + k + '" data-k="' + k + '" data-val="">';
  for (var i = 0; i < opts.length; i++)
    h += '<button type="button" class="pill" data-v="' + escHtml(opts[i][0]) + '">' +
      escHtml(opts[i][1]) + '</button>';
  return h + '</div>';
}
// 可折叠卡片
function dCard(id, icon, title, inner, open) {
  return '<details class="card dcard"' + (open ? ' open' : '') + ' id="' + id + '">' +
    '<summary><span class="ic">' + icon + '</span><span>' + title + '</span>' +
    '<span class="chev">›</span></summary><div class="dbody">' + inner + '</div></details>';
}


/* ----------------------------------------------------------------------------
 * 登录页客户端逻辑（自包含，将被序列化内联进 <script>）
 * ---------------------------------------------------------------------------- */
function loginApp() {
  'use strict';
  function toast(msg) {
    var box = document.getElementById('toasts');
    var el = document.createElement('div');
    el.className = 'toast err';
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }, 2600);
  }
  document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault(); // 表单提交即 Enter 提交
    var pw = document.getElementById('pw').value;
    if (!pw) { toast('请输入管理密码'); return; }
    var btn = document.getElementById('loginBtn');
    btn.disabled = true;
    fetch('api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      btn.disabled = false;
      if (res.ok && res.j && res.j.ok) location.href = '/admin';
      else toast((res.j && res.j.error) || '登录失败');
    }).catch(function () { btn.disabled = false; toast('网络错误，请重试'); });
  });
  document.getElementById('pw').focus();
}

/* 登录页：居中卡片（项目名 + 密码框 + 登录按钮），Enter 提交，错误 toast */
export function loginPageHTML() {
  var clientJs = '(' + loginApp.toString() + ')();';
  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>登录 · 影梭 ShadowShuttle</title>\n' + THEME_INIT +
    '<style>' + cssBase() + '</style>\n</head>\n<body>\n' +
    '<div class="login-wrap"><div class="login-card">\n' +
    '<div class="logo">🛰️</div>\n<h1>影梭 ShadowShuttle</h1>\n<p>管理面板登录</p>\n' +
    '<form id="loginForm" autocomplete="off">\n' +
    '<input class="inp" type="password" id="pw" placeholder="管理密码" autocomplete="current-password">\n' +
    '<button class="btn btn-pri" type="submit" id="loginBtn">登录</button>\n' +
    '</form>\n</div></div>\n' +
    '<div class="toasts" id="toasts"></div>\n' +
    '<script>' + clientJs + '</' + 'script>\n</body>\n</html>';
}

/* ----------------------------------------------------------------------------
 * 后台客户端逻辑（自包含，将被序列化内联进 <script>）
 * 约定：
 * - 相对路径调 API：api/login、api/config、api/logs、api/test-source、
 *   api/cf-usage、api/check-proxy、api/logout（与 _worker.js 路由一致）
 * - GET /api/config 兼容 {cfg:{...},subPath,version} 与扁平两种返回形状
 * - 二维码直接调用同 <script> 内的 qrcodeSVG(text)
 * ---------------------------------------------------------------------------- */
function adminApp(SUB_INIT) {
  'use strict';
  /* ---------- 基础小工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toast(msg, isErr) {
    var box = $('toasts');
    var el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }, 2600);
  }
  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
      return r.json();
    });
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    });
  }
  function nonEmptyLines(s) {
    return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
  }
  /* ---------- 弹窗 ---------- */
  function openModal(title, bodyHTML, wide) {
    var root = $('modalRoot');
    root.innerHTML = '<div class="mback"><div class="modal' + (wide ? ' wide' : '') + '">' +
      '<div class="mhead"><b>' + esc(title) + '</b><button class="ibtn" id="mClose">✕</button></div>' +
      '<div class="mbody">' + bodyHTML + '</div></div></div>';
    $('mClose').onclick = closeModal;
    root.firstChild.onclick = function (e) { if (e.target === this) closeModal(); };
  }
  function closeModal() { $('modalRoot').innerHTML = ''; }
  function copyText(t, btn) {
    function done() {
      // 反馈三连：按钮变"✓ 已复制"+绿边、1.2 秒后恢复、右上 toast；
      // 比单纯改文字更醒目，手机端尤其需要（剪贴板无系统提示时）。
      var old = btn.textContent;
      btn.textContent = '✓ 已复制';
      btn.classList.add('copied');
      setTimeout(function () { btn.textContent = old; btn.classList.remove('copied'); }, 1200);
      toast('已复制到剪贴板');
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动复制', true); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback);
    else fallback();
  }

  /* ---------- 深色模式 ---------- */
  function paintThemeBtn() {
    $('themeBtn').textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';
  }
  $('themeBtn').onclick = function () {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('ss-theme', next); } catch (e) {}
    paintThemeBtn();
  };
  paintThemeBtn(); // 与 <head> 内联脚本的初始值保持一致

  /* ---------- Tab 切换 ---------- */
  var TAB_IDS = ['ov', 'user', 'node', 'sub'];
  function goTab(name) {
    var tabs = document.querySelectorAll('.tab');
    tabs.forEach(function (b) { b.classList.toggle('on', b.dataset.t === name); });
    TAB_IDS.forEach(function (k) { $('t-' + k).hidden = (k !== name); });
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tab').forEach(function (b) {
    b.onclick = function () { goTab(b.dataset.t); };
  });

  /* ---------- 字段表：[字段名, 类型]；t 文本 / ta 多行 / n 数字 / b 开关 / sel 下拉 / pill 胶囊 ---------- */
  var FIELDS = [
    ['multiUUID', 'ta'], ['trojanPassword', 't'], ['ssPassword', 't'], ['ssMethod', 'sel'], ['ssAltPort', 'n'],
    ['preferredSources', 'ta'], ['preferredStatic', 'ta'], ['randIPCount', 'n'], ['randIPPort', 'n'],
    ['proxyIP', 't'], ['speedtestDomains', 'ta'], ['chainEnabled', 'b'], ['chainType', 'pill'], ['chainHost', 't'], ['chainPort', 'n'],
    ['chainUser', 't'], ['chainPass', 't'], ['chainWhitelist', 'ta'],
    ['dialRace', 'b'], ['dialConcurrency', 'n'], ['dialTimeoutMs', 'n'],
    ['hosts', 'ta'], ['nodePort', 'n'], ['subKey', 't'], ['subTokenRotate', 'b'], ['earlyData', 'b'], ['fragment', 'b'],
    ['disguiseHTML', 'ta'],
    ['logEnabled', 'b'], ['tgEnabled', 'b'], ['tgBotToken', 't'], ['tgChatId', 't'],
    ['cfApiToken', 't'], ['cfAccountId', 't']
  ];
  // 后端不回显的密码类字段：空值表示"不修改"，仅做占位提示
  var NOECHO = { ssPassword: 1, chainPass: 1, tgBotToken: 1, cfApiToken: 1 };
  function fieldEl(k) { return $('f-' + k); }
  function getVal(k, type) {
    var el = fieldEl(k);
    if (type === 'b') return el.checked;
    if (type === 'n') { var v = parseInt(el.value, 10); return isNaN(v) ? 0 : v; }
    if (type === 'pill') { var c = $('pills-' + k); return (c && c.dataset.val) || ''; }
    return el.value;
  }
  function setPill(k, v) {
    var c = $('pills-' + k);
    if (!c) return;
    c.dataset.val = v || '';
    c.querySelectorAll('.pill').forEach(function (b) { b.classList.toggle('on', b.dataset.v === (v || '')); });
  }
  function setVal(k, type, v) {
    var el = fieldEl(k);
    if (!el) return;
    if (type === 'b') { el.checked = !!v; return; }
    if (type === 'pill') { setPill(k, v || 'socks5'); return; }
    if (type === 'n') { el.value = (v === undefined || v === null || v === '') ? '' : v; return; }
    el.value = Array.isArray(v) ? v.join('\n') : (v === undefined || v === null ? '' : v);
  }
  // 胶囊组点击
  document.querySelectorAll('.pills').forEach(function (c) {
    c.querySelectorAll('.pill').forEach(function (b) {
      b.onclick = function () { setPill(c.dataset.k, b.dataset.v); markDirty(); };
    });
  });

  /* ---------- 脏标记 ---------- */
  function markDirty() { $('dirtyTip').hidden = false; }
  document.querySelectorAll('#t-user input, #t-user textarea, #t-user select,' +
    '#t-node input, #t-node textarea, #t-node select').forEach(function (el) {
    el.addEventListener('input', markDirty);
    el.addEventListener('change', markDirty);
  });

  /* ---------- 状态 ---------- */
  var cfg = {}, subPath = SUB_INIT || '/sub';

  function dot(on) { return '<span class="dot ' + (on ? 'on' : 'off') + '"></span>'; }
  function renderOverview() {
    var uuidOk = !!(cfg.UUID || nonEmptyLines(cfg.multiUUID).length);
    $('stVless').innerHTML = dot(uuidOk) + '<span>VLESS</span>';
    $('stVlessSub').textContent = uuidOk ? '已配置' : '未配置';
    var trojanOk = !!cfg.trojanPassword;
    $('stTrojan').innerHTML = dot(trojanOk) + '<span>Trojan</span>';
    $('stTrojanSub').textContent = trojanOk ? '已配置' : '未配置';
    var ssOk = !!cfg.ssPassword;
    $('stSs').innerHTML = dot(ssOk) + '<span>Shadowsocks</span>';
    $('stSsSub').textContent = ssOk ? '已配置' : '未配置';
    var stN = nonEmptyLines(cfg.preferredStatic).length;
    var srcN = nonEmptyLines(cfg.preferredSources).length;
    var target = parseInt(cfg.randIPCount, 10) || 0;
    $('stIpNum').textContent = target > 0 ? target : (stN + ' + 源');
    $('stIpSub').textContent = '静态 ' + stN + ' · 来源 ' + srcN + ' 个' + (target > 0 ? ' · 随机补足至 ' + target : '');
  }

  /* ---------- Cloudflare 用量（概览 + 节点配置页共用） ---------- */
  function fmtNum(v) { return Number(v).toLocaleString('en-US'); }
  function refreshCfUsage() {
    return getJSON('api/cf-usage').then(function (j) {
      var bars = document.querySelectorAll('[data-cfbar]');
      bars.forEach(function (b) {
        if (j && j.ok && j.limit > 0) {
          var pct = Math.min(100, Math.round(j.used / j.limit * 100));
          b.innerHTML = '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
            '<div class="hint">' + esc(fmtNum(j.used)) + ' / ' + esc(fmtNum(j.limit)) + '（' + pct + '%）</div>';
        } else {
          b.innerHTML = '<div class="hint">' + esc((j && j.error) || '未配置 Token 或查询失败') + '</div>';
        }
      });
    }).catch(function (e) {
      if (e && e.message === 'unauthorized') throw e;
      document.querySelectorAll('[data-cfbar]').forEach(function (b) {
        b.innerHTML = '<div class="hint">查询失败</div>';
      });
    });
  }
  $('cfBtn').onclick = function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = '查询中…';
    refreshCfUsage().then(function () {
      btn.disabled = false; btn.textContent = '查询用量';
    }).catch(function () { btn.disabled = false; btn.textContent = '查询用量'; });
  };

  /* ---------- 加载配置并填充表单 ---------- */
  function load() {
    getJSON('api/config').then(function (j) {
      if (!j) return;
      cfg = j.cfg || j; // 兼容 {cfg:{}} 与扁平两种返回形状
      if (j.subPath || cfg.subPath) subPath = j.subPath || cfg.subPath;
      if (j.version) $('ver').textContent = 'v' + j.version;
      FIELDS.forEach(function (f) { setVal(f[0], f[1], cfg[f[0]]); });
      Object.keys(NOECHO).forEach(function (k) {
        var el = fieldEl(k);
        if (el && !el.value) el.placeholder = '留空 = 不修改';
      });
      if (!fieldEl('randIPCount').value) fieldEl('randIPCount').value = 16;
      if (!fieldEl('ssMethod').value) fieldEl('ssMethod').value = 'aes-128-gcm';
      renderOverview();
      renderSubs();
      refreshCfUsage();
      $('dirtyTip').hidden = true;
    }).catch(function (e) {
      if (!e || e.message !== 'unauthorized') toast('配置加载失败', true);
    });
  }

  /* ---------- 保存（底部 sticky 栏） ---------- */
  $('saveBtn').onclick = function () {
    var body = {};
    FIELDS.forEach(function (f) { body[f[0]] = getVal(f[0], f[1]); });
    var btn = this;
    btn.disabled = true;
    postJSON('api/config', body).then(function (r) {
      btn.disabled = false;
      if (r.ok && r.j && r.j.ok) {
        toast('✅ 配置已保存');
        $('dirtyTip').hidden = true;
        load(); // 回读后端，确保状态灯 / 回显一致
      } else {
        toast('❌ 保存失败：' + ((r.j && r.j.error) || '未知错误'), true);
      }
    }).catch(function (e) {
      btn.disabled = false;
      if (!e || e.message !== 'unauthorized') toast('❌ 保存失败：网络错误', true);
    });
  };

  /* ---------- 概览：引导卡 ---------- */
  $('goUserBtn').onclick = function () { goTab('user'); };
  $('goSubBtn').onclick = function () { goTab('sub'); };
  $('fillSrcBtn').onclick = function () {
    var el = fieldEl('preferredSources');
    var def = 'https://www.cloudflare.com/ips-v4\n' +
      'sub://优选IP源地址1（请替换为真实地址）\n' +
      'sub://优选IP源地址2（请替换为真实地址）';
    if (el.value.trim() && !confirm('优选源已有内容，确定要用默认值覆盖吗？')) return;
    el.value = def;
    markDirty();
    toast('已填入默认优选源，请把占位地址换成真实的');
    goTab('node');
    var d = $('card-pref');
    if (d && !d.open) d.open = true;
  };

  /* ---------- 概览：危险区（重置配置，POST 空对象即恢复默认值） ---------- */
  $('resetBtn').onclick = function () {
    if (!confirm('确定要重置全部配置为默认值吗？此操作不可撤销。')) return;
    if (!confirm('再次确认：真的要清空并重置所有配置吗？')) return;
    postJSON('api/config', {}).then(function (r) {
      if (r.ok && r.j && r.j.ok) { toast('已重置，正在重新加载…'); load(); }
      else toast('❌ 重置失败：' + ((r.j && r.j.error) || '未知错误'), true);
    }).catch(function (e) {
      if (!e || e.message !== 'unauthorized') toast('❌ 重置失败：网络错误', true);
    });
  };

  /* ---------- 优选源验证：逐个调 /api/test-source ---------- */
  $('srcTestBtn').onclick = function () {
    var list = nonEmptyLines(fieldEl('preferredSources').value);
    var box = $('srcTestRes');
    if (!list.length) { box.innerHTML = '<div class="hint">请先填写优选源</div>'; return; }
    var btn = this;
    btn.disabled = true;
    var i = 0, html = '';
    function next() {
      if (i >= list.length) {
        btn.disabled = false;
        box.innerHTML = html || '<div class="hint">无结果</div>';
        return;
      }
      var u = list[i++];
      var short = u.length > 52 ? u.slice(0, 52) + '…' : u;
      getJSON('api/test-source?url=' + encodeURIComponent(u)).then(function (j) {
        html += j && j.ok
          ? '<div class="trow"><span class="mono">' + esc(short) + '</span><span class="ok">抓到 ' + (+j.count || 0) + ' 个 IP</span></div>'
          : '<div class="trow"><span class="mono">' + esc(short) + '</span><span class="bad">' + esc((j && j.error) || '失败') + '</span></div>';
        box.innerHTML = html;
        next();
      }).catch(function (e) {
        if (e && e.message === 'unauthorized') { btn.disabled = false; return; }
        html += '<div class="trow"><span class="mono">' + esc(short) + '</span><span class="bad">请求失败</span></div>';
        box.innerHTML = html;
        next();
      });
    }
    box.innerHTML = '<div class="hint">正在逐个验证…</div>';
    next();
  };

  /* ---------- 链式代理检查 ---------- */
  $('chainTestBtn').onclick = function () {
    var box = $('chainTestRes');
    var btn = this;
    btn.disabled = true;
    box.innerHTML = '<div class="hint">正在检查…</div>';
    getJSON('api/check-proxy').then(function (j) {
      btn.disabled = false;
      box.innerHTML = j && j.ok
        ? '<div class="trow"><span class="ok">出口 IP：' + esc(j.ip) + '（' + esc(j.country || '未知地区') + '）</span></div>'
        : '<div class="trow"><span class="bad">' + esc((j && j.error) || '检查失败') + '</span></div>';
    }).catch(function (e) {
      btn.disabled = false;
      if (!e || e.message !== 'unauthorized')
        box.innerHTML = '<div class="trow"><span class="bad">请求失败</span></div>';
    });
  };

  /* ---------- 查看日志（弹窗表格） ---------- */
  $('logBtn').onclick = function () {
    getJSON('api/logs').then(function (j) {
      var rows = (j && j.logs) || [];
      var h = '<table><thead><tr><th>时间</th><th>IP</th><th>国家</th><th>路径</th><th>UA</th></tr></thead><tbody>';
      if (!rows.length) h += '<tr><td colspan="5" class="muted center">暂无日志</td></tr>';
      rows.forEach(function (r) {
        var t = r.t;
        if (typeof t === 'number') { try { t = new Date(t).toLocaleString(); } catch (e) {} }
        h += '<tr><td class="mono">' + esc(t) + '</td><td class="mono">' + esc(r.ip) + '</td>' +
          '<td>' + esc(r.cc) + '</td><td class="mono">' + esc(r.path) + '</td>' +
          '<td class="uacell">' + esc(r.ua) + '</td></tr>';
      });
      openModal('请求日志', h + '</tbody></table>', true);
    }).catch(function (e) {
      if (!e || e.message !== 'unauthorized') toast('日志加载失败', true);
    });
  };

  /* ---------- 订阅链接 ---------- */
  // 6 种格式：通用 / Clash / sing-box 走后端已有路由；
  // Surge / Quantumult X / Loon 按同名路径约定（后端实现后即生效）
  var SUBS = [
    ['通用订阅', '', 'v2rayN / Shadowrocket / NekoBox 等'],
    ['Clash', '/clash', 'Clash / ClashMeta'],
    ['sing-box', '/singbox', 'sing-box 1.8+'],
    ['Surge', '/surge', 'Surge 5+'],
    ['Quantumult X', '/quanx', 'Quantumult X'],
    ['Loon', '/loon', 'Loon']
  ];
  function drawSubRows() {
    var box = $('subList');
    var host = $('hostSel').value || location.host;
    box.innerHTML = '';
    SUBS.forEach(function (d, i) {
      var url = location.protocol + '//' + host + subPath + d[1];
      var item = document.createElement('div');
      item.className = 'subitem';
      item.innerHTML =
        '<div class="subrow"><span class="nm">' + esc(d[0]) + '</span>' +
        '<input class="inp mono" readonly value="' + esc(url) + '" id="suburl' + i + '">' +
        '<button class="btn btn-ghost btn-sm" data-c="' + i + '">复制</button>' +
        '<button class="btn btn-ghost btn-sm" data-q="' + i + '">二维码</button></div>' +
        '<div class="hint" style="margin:6px 0 0">' + esc(d[2]) + '</div>';
      box.appendChild(item);
    });
    box.querySelectorAll('[data-c]').forEach(function (b) {
      b.onclick = function () { copyText($('suburl' + b.dataset.c).value, b); };
    });
    box.querySelectorAll('[data-q]').forEach(function (b) {
      b.onclick = function () {
        var url = $('suburl' + b.dataset.q).value;
        var svg;
        try { svg = qrcodeSVG(url); }
        catch (e) { toast('二维码生成失败：' + e.message, true); return; }
        openModal('订阅二维码',
          '<div class="qrbox">' + svg + '</div><div class="hint center mono">' + esc(url) + '</div>');
      };
    });
  }
  function renderSubs() {
    var hosts = nonEmptyLines(fieldEl('hosts') ? fieldEl('hosts').value : cfg.hosts);
    if (!hosts.length) hosts = [location.host];
    var sel = $('hostSel'), cur = sel.value;
    sel.innerHTML = '';
    hosts.forEach(function (h) {
      var o = document.createElement('option');
      o.value = h; o.textContent = h;
      sel.appendChild(o);
    });
    if (hosts.indexOf(cur) !== -1) sel.value = cur;
    drawSubRows();
  }
  $('hostSel').onchange = drawSubRows;

  /* ---------- 退出 ---------- */
  $('logoutBtn').onclick = function () {
    fetch('api/logout', { method: 'POST' }).then(function () { location.href = '/login'; });
  };

  /* ---------- 启动 ---------- */
  load();
}

/* 密码型输入框（防窥视；后端对此类字段不回显，空=不修改） */
function fPass(k, ph) {
  return '<input class="inp" id="f-' + k + '" type="password" placeholder="' + escHtml(ph || '') +
    '" autocomplete="new-password" spellcheck="false">';
}

/* ----------------------------------------------------------------------------
 * 后台完整 HTML（含 <script>）
 * subPath：服务端已知的当前订阅路径，透传给客户端逻辑做初始值，
 *           之后以 GET /api/config 返回的 subPath 为准
 * ---------------------------------------------------------------------------- */
export function adminPageHTML(subPath) {
  /* ---------- 概览 ---------- */
  var overview =
    '<div class="stats">' +
      '<div class="stat"><div class="k" id="stVless"></div><div class="s" id="stVlessSub">…</div></div>' +
      '<div class="stat"><div class="k" id="stTrojan"></div><div class="s" id="stTrojanSub">…</div></div>' +
      '<div class="stat"><div class="k" id="stSs"></div><div class="s" id="stSsSub">…</div></div>' +
      '<div class="stat"><div class="k">🎯 优选 IP 总数</div><div class="v" id="stIpNum">–</div>' +
        '<div class="s" id="stIpSub"></div></div>' +
      '<div class="stat"><div class="k">☁️ Cloudflare 用量</div><div data-cfbar>' +
        '<div class="hint">加载中…</div></div></div>' +
    '</div>' +
    '<div class="card"><h3>🧭 三步上手</h3><p class="sub">按顺序完成，即可分发订阅</p>' +
      '<div class="step"><span class="n">1</span><div class="t"><b>填写 UUID / 密码</b>' +
        '<div class="hint">VLESS 的 UUID（每行一个），以及 Trojan / SS 密码（留空即不启用该协议）。</div>' +
        '<div style="margin-top:8px"><button class="btn btn-ghost btn-sm" id="goUserBtn">去填写 →</button></div>' +
      '</div></div>' +
      '<div class="step"><span class="n">2</span><div class="t"><b>填入优选源</b>' +
        '<div class="hint">一键填入 Cloudflare 官方 IP 段与两个占位源，记得把占位地址换成真实的优选 IP 源。</div>' +
        '<div style="margin-top:8px"><button class="btn btn-ghost btn-sm" id="fillSrcBtn">⚡ 一键填入默认优选源</button></div>' +
      '</div></div>' +
      '<div class="step"><span class="n">3</span><div class="t"><b>复制订阅链接</b>' +
        '<div class="hint">6 种客户端格式任选，点二维码按钮可弹窗展示扫码导入。</div>' +
        '<div style="margin-top:8px"><button class="btn btn-ghost btn-sm" id="goSubBtn">去复制 →</button></div>' +
      '</div></div>' +
    '</div>' +
    '<div class="card danger"><h3>⚠️ 危险区</h3><p class="sub">以下操作不可撤销，请谨慎</p>' +
      '<button class="btn btn-danger-ghost" id="resetBtn">重置全部配置</button>' +
    '</div>';

  /* ---------- 用户管理 ---------- */
  var userTab =
    '<div class="card"><h3>👤 用户管理</h3><p class="sub">UUID 与各协议密码，留空即不启用该协议</p>' +
    srow('🔑', 'UUID 列表', fArea('multiUUID', '每行一个 UUID', 4), 'VLESS：每个 UUID 独立生成一条节点') +
    srow('🔒', 'Trojan 密码', fText('trojanPassword', '留空则不启用 Trojan')) +
    srow('🔒', 'SS 密码', fText('ssPassword', '留空则不启用 Shadowsocks')) +
    srow('🧩', 'SS 加密方式', fSel('ssMethod',
      [['aes-128-gcm', 'aes-128-gcm'], ['aes-256-gcm', 'aes-256-gcm'],
       ['chacha20-ietf-poly1305', 'chacha20-ietf-poly1305']])) +
    srow('🔌', 'SS 备用端口', fNum('ssAltPort', '0'), '0 = 关闭；备用端口走非 TLS 直连') +
    '</div>';

  /* ---------- 节点配置（可折叠卡片） ---------- */
  var nodeTab = dCard('card-pref', '🎯', '优选 IP',
    srow('🌐', '优选源', fArea('preferredSources', 'https://… / sub://…，每行一个', 3),
      '支持 https:// 与 sub:// 两种来源，每行一个') +
    srow('📌', '静态优选', fArea('preferredStatic', '每行一个，支持 IP / IP:端口 / IP#备注', 3),
      '手动指定的固定 IP，优先级最高') +
    srow('🎲', '随机数量', fNum('randIPCount', '16'), '订阅节点总数目标：静态 IP 与来源 IP 优先保留，不足部分随机补足。设 0 关闭随机补足') +
    srow('🔌', '随机端口', fNum('randIPPort', '443')) +
    '<div style="margin:10px 0 4px"><button class="btn btn-ghost btn-sm" id="srcTestBtn">🔍 验证优选源</button></div>' +
    '<div id="srcTestRes"></div>',
    true) +
  dCard('card-chain', '🔗', '出站与回落',
    srow('🛡️', '回落 IP', fText('proxyIP', '如 1.2.3.4'), '出站失败时回落重试一次') +
    srow('🚀', '测速域名', fArea('speedtestDomains', '每行一个域名', 3), '命中则本地回显测速（不经过出站）；清空=关闭') +
    srow('🔗', '链式代理', fTgl('chainEnabled'), '开启后出站经由下方的代理服务器') +
    srow('📡', '链式类型', fPills('chainType',
      [['socks5', 'socks5'], ['http', 'http'], ['https', 'https']])) +
    srow('🖥️', '链式地址', fText('chainHost', '代理服务器域名或 IP'), 'https 类型请填域名（TLS 证书校验需要）') +
    srow('🔌', '链式端口', fNum('chainPort', '1080')) +
    srow('👤', '链式用户', fText('chainUser', '无认证可留空')) +
    srow('🔑', '链式密码', fPass('chainPass', '')) +
    srow('📋', '白名单', fArea('chainWhitelist', '每行一个域名', 3), '命中白名单的域名直连，不走链式代理') +
    srow('🏁', '并发拨号', fTgl('dialRace'), '同时拨直连/链式/回落，取最快成功的') +
    srow('🔢', '并发数', fNum('dialConcurrency', '3'), '2-5') +
    srow('⏱️', '拨号超时', fNum('dialTimeoutMs', '0'), '毫秒；0=自适应（弱网自动收紧超时）') +
    '<div style="margin:10px 0 4px"><button class="btn btn-ghost btn-sm" id="chainTestBtn">🔍 检查链式代理</button></div>' +
    '<div id="chainTestRes"></div>') +
  dCard('card-sub', '📄', '订阅参数',
    srow('🌍', '订阅 HOST', fArea('hosts', '每行一个域名', 2), '多 HOST 轮换，订阅页可切换') +
    srow('🔌', '节点端口', fNum('nodePort', '443')) +
    srow('🗝️', '订阅 KEY', fText('subKey', '快速订阅路径 KEY'), '留空则使用默认订阅路径') +
    srow('🔄', 'Token 日轮换', fTgl('subTokenRotate'), '开启后订阅 token 每天变化，旧链接次日失效（防泄露）') +
    srow('⚡', '0RTT', fTgl('earlyData'), 'Early Data（0RTT），需客户端支持') +
    srow('🧱', 'TLS 分片', fTgl('fragment'), '需客户端支持')) +
  dCard('card-disguise', '🎭', '伪装首页',
    srow('🎭', '伪装 HTML', fArea('disguiseHTML', '粘贴完整的 HTML…', 6),
      '访问根路径时展示的伪装页面，留空用默认')) +
  dCard('card-log', '📝', '日志与通知',
    srow('📝', '请求日志', fTgl('logEnabled'), '记录请求 IP / 路径等（存 KV，注意配额）') +
    '<div style="margin:10px 0 4px"><button class="btn btn-ghost btn-sm" id="logBtn">📋 查看日志</button></div>' +
    srow('📨', 'TG 推送', fTgl('tgEnabled'), '开启后重要事件推送到 Telegram') +
    srow('🤖', 'Bot Token', fPass('tgBotToken', '')) +
    srow('💬', 'Chat ID', fText('tgChatId', ''))) +
  dCard('card-cf', '☁️', 'Cloudflare',
    srow('🔐', 'API Token', fPass('cfApiToken', ''), '需要账户用量读取权限') +
    srow('🆔', '账户 ID', fText('cfAccountId', '')) +
    '<div style="margin:10px 0 4px"><button class="btn btn-ghost btn-sm" id="cfBtn">📊 查询用量</button></div>' +
    '<div data-cfbar><div class="hint">加载中…</div></div>');

  /* ---------- 订阅链接 ---------- */
  var subTab =
    '<div class="card"><h3>🌍 订阅域名</h3>' +
    srow('🌍', 'HOST', '<select class="inp" id="hostSel"></select>',
      '取自「节点配置 → 订阅参数 → 多 HOST」，切换后下方链接实时更新') +
    '</div>' +
    '<div class="card"><h3>🔗 订阅链接</h3><p class="sub">6 种客户端格式，按需复制或扫码</p>' +
    '<div id="subList"></div></div>' +
    '<div class="card"><h3>🏷️ 节点命名规则</h3>' +
    '<p class="sub">订阅中的节点名按「国旗 + 中文国名 + 序号」自动生成，例如：</p>' +
    '<div class="rule-eg"><span>🇺🇸 美国-01</span><span>🇭🇰 香港-02</span>' +
    '<span>🇸🇬 新加坡-03</span><span>🇯🇵 日本-04</span></div>' +
    '<div class="hint">归属地来自 IP 地理库；同一国家按 IP 顺序编号。</div></div>';

  /* ---------- 拼装页面 ---------- */
  var clientJs = qrcodeSVG.toString() + '\n' + adminApp.toString() +
    '\nadminApp(' + JSON.stringify(subPath || '') + ');';
  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>影梭 ShadowShuttle · 管理面板</title>\n' + THEME_INIT +
    '<style>' + cssBase() + '</style>\n</head>\n<body>\n' +
    '<header class="topbar"><div class="wrap" style="padding-top:0;padding-bottom:0">' +
      '<div class="tb-in"><div class="brand">🛰️ <b>影梭 ShadowShuttle</b>' +
      '<span class="ver" id="ver"></span></div>' +
      '<div class="tb-act"><button class="ibtn" id="themeBtn" title="深色 / 浅色">🌙</button>' +
      '<button class="ibtn" id="logoutBtn" title="退出登录">⏻</button></div></div>' +
      '<nav class="tabs">' +
      '<button class="tab on" data-t="ov">概览</button>' +
      '<button class="tab" data-t="user">用户管理</button>' +
      '<button class="tab" data-t="node">节点配置</button>' +
      '<button class="tab" data-t="sub">订阅链接</button>' +
      '</nav>' +
    '</div></header>\n' +
    '<main class="wrap" style="padding-top:16px">' +
      '<section id="t-ov">' + overview + '</section>' +
      '<section id="t-user" hidden>' + userTab + '</section>' +
      '<section id="t-node" hidden>' + nodeTab + '</section>' +
      '<section id="t-sub" hidden>' + subTab + '</section>' +
    '</main>\n' +
    '<div class="savebar"><div class="savebar-in">' +
      '<span class="dirty" id="dirtyTip" hidden>● 有未保存的修改</span>' +
      '<button class="btn btn-pri" id="saveBtn">💾 保存配置</button>' +
    '</div></div>\n' +
    '<div class="toasts" id="toasts"></div>\n' +
    '<div id="modalRoot"></div>\n' +
    '<script>' + clientJs + '</' + 'script>\n</body>\n</html>';
}


/** 默认伪装首页（nginx 风格） */
export function defaultDisguiseHTML() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>404 Not Found</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;color:#333;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}h1{font-size:24px;font-weight:600;}p{color:#888;}</style>
</head><body><div><h1>404 Not Found</h1><p>The requested URL was not found on this server.</p></div></body></html>`;
}

/* ------------------------------------------------------------------
 * 会话与 API
 * ------------------------------------------------------------------ */
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers || {}),
  });
}

function htmlResp(s) {
  return new Response(s, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** 创建登录会话：KV 存随机 token，1 小时过期 */
async function createSession(env) {
  const kv = env.KV;
  if (!kv) return null;
  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(24)));
  await kv.put(KV_SESSION_PREFIX + token, '1', { expirationTtl: 3600 });
  return token;
}

/** 校验 Cookie 中的会话 */
async function checkSession(request, env) {
  const kv = env.KV;
  if (!kv) return false;
  const cookie = request.headers.get('Cookie') || '';
  const m = /(?:^|;\s*)ss_session=([0-9a-f]+)/.exec(cookie);
  if (!m) return false;
  try {
    return !!(await kv.get(KV_SESSION_PREFIX + m[1]));
  } catch { return false; }
}

async function handleLogin(request, env, cfg, url) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, 400); }
  if (!cfg.ADMIN || !constTimeStrEq(String((body && body.password) || ''), cfg.ADMIN)) {
    return json({ error: '密码错误' }, 401);
  }
  const token = await createSession(env);
  if (!token) return json({ error: 'KV 未绑定，无法创建会话' }, 500);
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return json({ ok: true }, 200, {
    'Set-Cookie': `ss_session=${token}; HttpOnly; Path=/; Max-Age=3600; SameSite=Lax${secure}`,
  });
}

async function handleLogout(request, env) {
  const kv = env.KV;
  const cookie = request.headers.get('Cookie') || '';
  const m = /(?:^|;\s*)ss_session=([0-9a-f]+)/.exec(cookie);
  if (kv && m) { try { await kv.delete(KV_SESSION_PREFIX + m[1]); } catch { /* 忽略 */ } }
  return json({ ok: true }, 200, { 'Set-Cookie': 'ss_session=; HttpOnly; Path=/; Max-Age=0' });
}

function handleGetConfig(cfg, env) {
  return json({
    hasKV: !!env.KV,
    version: SS_VERSION,
    UUID: cfg.UUID,
    multiUUID: cfg.multiUUID,
    trojanPassword: cfg.trojanPassword,
    ssPassword: cfg.ssPassword,
    ssMethod: cfg.ssMethod,
    ssAltPort: cfg.ssAltPort,
    subKey: cfg.subKey,
    subTokenRotate: cfg.subTokenRotate,
    hosts: cfg.hosts,
    nodePort: cfg.nodePort,
    earlyData: cfg.earlyData,
    fragment: cfg.fragment,
    preferredSources: cfg.preferredSources,
    preferredStatic: cfg.preferredStatic,
    randIPCount: cfg.randIPCount,
    randIPPort: cfg.randIPPort,
    proxyIP: cfg.proxyIP,
    speedtestDomains: cfg.speedtestDomains,
    chainEnabled: cfg.chainEnabled,
    chainType: cfg.chainType,
    chainHost: cfg.chainHost,
    chainPort: cfg.chainPort,
    chainUser: cfg.chainUser,
    chainPass: '', // 密码不回显，前端留空=不修改
    chainWhitelist: cfg.chainWhitelist,
    dialRace: cfg.dialRace,
    dialConcurrency: cfg.dialConcurrency,
    dialTimeoutMs: cfg.dialTimeoutMs,
    logEnabled: cfg.logEnabled,
    tgEnabled: cfg.tgEnabled,
    tgBotToken: '', // Token 不回显
    tgChatId: cfg.tgChatId,
    cfApiToken: '', // Token 不回显
    cfAccountId: cfg.cfAccountId,
    subPath: cfg.subPath,
    subPathCustom: cfg.subPathCustom || '',
    disguiseHTML: cfg.disguiseHTML,
  });
}

async function handlePostConfig(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, 400); }
  try {
    await saveConfig(env, body || {});
    const cfg = await loadConfig(env);
    // 后台预热归属地缓存：下次拉订阅时节点名直接显示国家，不用等
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil((async () => {
        try {
          const entries = await getPreferredIPs(cfg, env);
          await refreshGeoCache(entries.map((e) => e.ip), env);
        } catch { /* 忽略 */ }
      })());
    }
    return json({ ok: true, subPath: cfg.subPath });
  } catch (e) {
    return json({ error: e.message || '保存失败' }, 500);
  }
}

/* ------------------------------------------------------------------
 * 请求日志（KV，最多保留 200 条，7 天过期）
 * 记录：时间、客户端 IP、国家、路径、UA。面板可开关、查看。
 * ------------------------------------------------------------------ */

/** 追加一条请求日志 */
export async function appendLog(env, entry) {
  const kv = env.KV;
  if (!kv) return;
  try {
    const raw = await kv.get(KV_LOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    arr.push({ t: Date.now(), ...entry });
    while (arr.length > 200) arr.shift();
    await kv.put(KV_LOG_KEY, JSON.stringify(arr), { expirationTtl: 7 * 86400 });
  } catch { /* 忽略 */ }
}

/** 读日志（倒序，最新的在前） */
export async function getLogs(env, limit) {
  const kv = env.KV;
  if (!kv) return [];
  try {
    const raw = await kv.get(KV_LOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return arr.slice(-(limit || 100)).reverse();
  } catch { return []; }
}

/** 从请求提取日志条目 */
export function logEntryOf(request) {
  const h = request.headers;
  return {
    ip: h.get('cf-connecting-ip') || '',
    cc: h.get('cf-ipcountry') || '',
    path: new URL(request.url).pathname,
    ua: (h.get('user-agent') || '').slice(0, 120),
  };
}

/* ------------------------------------------------------------------
 * Telegram 推送（有人拉订阅 / 新 IP 建连时通知）
 * ------------------------------------------------------------------ */

/** 发 TG 消息（fire-and-forget，失败忽略） */
export async function tgNotify(env, cfg, text) {
  if (!cfg.tgEnabled || !cfg.tgBotToken || !cfg.tgChatId) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    await fetch(`https://api.telegram.org/bot${cfg.tgBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.tgChatId, text: String(text).slice(0, 4000) }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch { /* 忽略 */ }
}

/** 代理建连的 TG 通知（每 IP 每天只推一次，避免刷屏） */
export async function tgNotifyOncePerDay(env, cfg, ip, text) {
  if (!cfg.tgEnabled || !cfg.tgBotToken || !cfg.tgChatId || !ip) return;
  const kv = env.KV;
  const key = KV_TGIP_PREFIX + ip;
  try {
    if (kv && (await kv.get(key))) return; // 今天已推过
  } catch { /* 忽略 */ }
  await tgNotify(env, cfg, text);
  if (kv) {
    try { await kv.put(key, '1', { expirationTtl: 86400 }); } catch { /* 忽略 */ }
  }
}

/* ------------------------------------------------------------------
 * Cloudflare Workers 用量查询（GraphQL，需 API Token + Account ID）
 * 显示当日请求数，进度条上限 10 万/天（免费计划）。
 * ------------------------------------------------------------------ */
export async function fetchCfUsage(env, cfg) {
  if (!cfg.cfApiToken || !cfg.cfAccountId) throw new Error('请先在面板配置 CF API Token 与 Account ID');
  const today = new Date().toISOString().slice(0, 10);
  const query = `query{viewer{accounts(filter:{accountTag:"${cfg.cfAccountId}"}){workersInvocationsAdaptive(limit:1000,filter:{date_gt:"${today}"}){sum{requests}}}}}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + cfg.cfApiToken, 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('CF API 请求失败: ' + res.status);
    const j = await res.json();
    const accts = j && j.data && j.data.viewer && j.data.viewer.accounts;
    const sum = accts && accts[0] && accts[0].workersInvocationsAdaptive && accts[0].workersInvocationsAdaptive[0];
    const used = sum && sum.sum ? Number(sum.sum.requests) || 0 : 0;
    return { used, limit: 100000, date: today };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

/* ------------------------------------------------------------------
 * 面板扩展 API（均需登录会话）
 * ------------------------------------------------------------------ */

/** GET /api/logs：查看请求日志 */
async function handleLogs(env) {
  return json({ logs: await getLogs(env, 100) });
}

/** GET /api/test-source?url=：一键验证优选源，返回抓到的 IP 数量与示例 */
async function handleTestSource(env, url) {
  const u = String(url || '').trim();
  if (!/^(https?|sub):\/\//.test(u)) return json({ ok: false, error: 'URL 须以 https:// 或 sub:// 开头' });
  try {
    const ips = await fetchSourceIPs(u, env.KV);
    return json({ ok: true, count: ips.length, sample: ips.slice(0, 5) });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) });
  }
}

/** GET /api/cf-usage：查询 Workers 当日用量 */
async function handleCfUsage(env, cfg) {
  try {
    const r = await fetchCfUsage(env, cfg);
    return json({ ok: true, ...r });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) });
  }
}

/** 经 socket 发最小 HTTP GET，读响应并提取 body（check-proxy 测出口 IP 用） */
async function httpGetBodyViaSocket(sock, host, path) {
  const w = sock.writable.getWriter();
  const r = sock.readable.getReader();
  try {
    await w.write(te.encode(`GET ${path} HTTP/1.0\r\nHost: ${host}\r\nUser-Agent: shadowshuttle/2.0\r\n\r\n`));
    try { w.releaseLock(); } catch { /* 忽略 */ }
    let acc = new Uint8Array(0);
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      if (value) acc = concatBytes(acc, value);
      if (acc.length > 65536) break;
    }
    const text = td.decode(acc);
    const idx = text.indexOf('\r\n\r\n');
    return idx >= 0 ? text.slice(idx + 4).trim() : text.trim();
  } finally {
    try { r.cancel(); } catch { /* 忽略 */ }
    try { sock.close(); } catch { /* 忽略 */ }
  }
}

/** GET /api/check-proxy：经链式代理抓取 api.ipify.org，验证链路并显示出口 IP */
async function handleCheckProxy(env, cfg) {
  if (!cfg.chainEnabled || !cfg.chainHost) return json({ ok: false, error: '链式代理未启用' });
  try {
    // 走 80 端口做纯 HTTP 探测（避免在代理隧道内再套 TLS 的复杂度）
    const sock = await dialViaChain('api.ipify.org', 80, cfg);
    const body = await httpGetBodyViaSocket(sock, 'api.ipify.org', '/');
    const ip = body.split('\n')[0].trim();
    if (!isIP(ip)) throw new Error('出口 IP 解析失败: ' + body.slice(0, 60));
    return json({ ok: true, ip, via: `${cfg.chainType}://${cfg.chainHost}:${cfg.chainPort}` });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) });
  }
}

/* ------------------------------------------------------------------
 * 订阅接口
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------
 * 订阅接口（v2）
 * 流程：优选 IP 条目 → 归属地 → 节点命名 → 各格式生成。
 *  ?sub=<url>：再聚合一个外部订阅的节点原文（base64 直接追加原文；
 *    clash/singbox/surge/quanx/loon 尽力转换可解析的 vless/trojan/ss 链接）。
 *  ?target= 或 UA 自动识别格式；显式路径（/clash 等）优先。
 * ------------------------------------------------------------------ */
async function handleSub(request, env, ctx, cfg, host, explicitFormat) {
  if (!cfg.UUID) return new Response('UUID 未配置', { status: 500 });
  const url = new URL(request.url);
  const format = detectSubFormat(request, explicitFormat);
  // 优选 IP 条目（含端口/备注）
  const entries = await getPreferredIPs(cfg, env);
  const geoMap = {};
  await Promise.all(entries.map(async (e) => { geoMap[e.ip] = await getCachedGeo(e.ip, env); }));
  // 后台补齐缺失的归属地，不阻塞本次响应
  ctx.waitUntil(refreshGeoCache(entries.map((e) => e.ip), env));
  const nodes = buildNodeNames(entries, geoMap, host);
  // ?sub= 聚合外部订阅
  const aggParam = url.searchParams.get('sub');
  let aggLinks = [];
  if (aggParam) {
    try { aggLinks = await fetchAggSubLinks(aggParam); } catch { /* 忽略 */ }
  }
  // 日志 + TG（后台，不阻塞）
  const le = logEntryOf(request);
  if (cfg.logEnabled) ctx.waitUntil(appendLog(env, le));
  if (cfg.tgEnabled) {
    ctx.waitUntil(tgNotify(env, cfg,
      `📥 有人拉取订阅\nIP: ${le.ip || '未知'}${le.cc ? ' (' + le.cc + ')' : ''}\n格式: ${format}\nUA: ${le.ua || '-'}\n时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`));
  }
  const aggParsed = aggLinks.map(parseNodeLink).filter(Boolean);
  if (format === 'clash') {
    return new Response(buildClashSub(nodes, cfg, host) + clashAgg(aggParsed), { headers: { 'content-type': 'text/yaml; charset=utf-8' } });
  }
  if (format === 'singbox') {
    return new Response(mergeSingboxAgg(buildSingboxSub(nodes, cfg, host), aggParsed, cfg, host), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  if (format === 'surge') {
    return new Response(buildSurgeSub(nodes, cfg, host) + surgeAgg(aggParsed), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (format === 'quanx') {
    return new Response(buildQuanxSub(nodes, cfg, host) + '\n' + quanxAgg(aggParsed), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (format === 'loon') {
    return new Response(buildLoonSub(nodes, cfg, host) + '\n' + loonAgg(aggParsed), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  return new Response(buildBase64Sub(nodes, cfg, host, aggLinks), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/** 聚合节点 → clash proxies 段（尽力转换） */
function clashAgg(list) {
  if (!list.length) return '';
  const L = [];
  for (const n of list) {
    const name = yamlStr(n.name);
    if (n.proto === 'vless') {
      L.push(`  - name: ${name}`, `    type: vless`, `    server: ${n.server}`, `    port: ${n.port}`,
        `    uuid: ${n.id}`, `    tls: true`, `    network: ws`);
    } else if (n.proto === 'trojan') {
      L.push(`  - name: ${name}`, `    type: trojan`, `    server: ${n.server}`, `    port: ${n.port}`,
        `    password: ${yamlStr(n.id)}`, `    network: ws`);
    } else if (n.proto === 'ss' && n.method) {
      L.push(`  - name: ${name}`, `    type: ss`, `    server: ${n.server}`, `    port: ${n.port}`,
        `    cipher: ${n.method}`, `    password: ${yamlStr(n.password)}`);
    }
  }
  return L.length ? L.join('\n') + '\n' : '';
}

/** 聚合节点并入 sing-box JSON */
function mergeSingboxAgg(jsonStr, list, cfg, host) {
  if (!list.length) return jsonStr;
  try {
    const j = JSON.parse(jsonStr);
    for (const n of list) {
      if (n.proto === 'vless') j.outbounds.push({ type: 'vless', tag: n.name, server: n.server, server_port: n.port, uuid: n.id });
      else if (n.proto === 'trojan') j.outbounds.push({ type: 'trojan', tag: n.name, server: n.server, server_port: n.port, password: n.id });
      else if (n.proto === 'ss' && n.method) j.outbounds.push({ type: 'shadowsocks', tag: n.name, server: n.server, server_port: n.port, method: n.method, password: n.password });
    }
    return JSON.stringify(j, null, 2);
  } catch { return jsonStr; }
}

/** 聚合节点 → surge proxy 行（尽力转换） */
function surgeAgg(list) {
  if (!list.length) return '';
  const L = [];
  for (const n of list) {
    const tag = n.name.replace(/,/g, ' ');
    if (n.proto === 'vless') L.push(`${tag} = vless, ${n.server}, ${n.port}, username=${n.id}, tls=true`);
    else if (n.proto === 'trojan') L.push(`${tag} = trojan, ${n.server}, ${n.port}, password=${n.id}`);
    else if (n.proto === 'ss' && n.method) L.push(`${tag} = ss, ${n.server}, ${n.port}, encrypt-method=${n.method}, password=${n.password}`);
  }
  return L.length ? '\n' + L.join('\n') + '\n' : '';
}

/** 聚合节点 → quanx 行（尽力转换） */
function quanxAgg(list) {
  if (!list.length) return '';
  const L = [];
  for (const n of list) {
    const tag = `tag=${n.name.replace(/,/g, ' ')}`;
    if (n.proto === 'vless') L.push(`vless=${n.server}:${n.port}, method=none, password=${n.id}, tls=true, ${tag}`);
    else if (n.proto === 'trojan') L.push(`trojan=${n.server}:${n.port}, password=${n.id}, over-tls=true, ${tag}`);
    else if (n.proto === 'ss' && n.method) L.push(`shadowsocks=${n.server}:${n.port}, method=${n.method}, password=${n.password}, ${tag}`);
  }
  return L.join('\n');
}

/** 聚合节点 → loon 行（尽力转换） */
function loonAgg(list) {
  if (!list.length) return '';
  const L = [];
  for (const n of list) {
    const tag = n.name.replace(/,/g, ' ');
    if (n.proto === 'vless') L.push(`${tag} = VLESS,${n.server},${n.port},${n.id},udp=true,tls=true`);
    else if (n.proto === 'trojan') L.push(`${tag} = Trojan,${n.server},${n.port},${n.id},udp=true`);
    else if (n.proto === 'ss' && n.method) L.push(`${tag} = Shadowsocks,${n.server},${n.port},${n.method},"${n.password}",udp=true`);
  }
  return L.join('\n');
}

/* ------------------------------------------------------------------
 * 出站：cloudflare:sockets TCP
 * 拨号顺序：直连 → 链式代理（按配置）→ PROXYIP 回落。
 * 链式代理启用且目标在白名单（白名单为空=全部）时优先走链。
 * ------------------------------------------------------------------ */
/* 出站 TCP 建连。
 * secure=true 时让 Workers 在建连阶段直接完成 TLS 握手（含 SNI 与证书校验，
 * 对应 cloudflare:sockets 的 secureTransport:"on"），返回的已是加密流。
 * 这是 HTTPS 链式代理的基础：先对代理服务器做 TLS，再在加密隧道里发明文
 * CONNECT 请求。注意：chainHost 填域名时才能通过证书校验，填 IP 可能失败。 */
async function tcpConnect(hostname, port, secure) {
  const mod = await import('cloudflare:sockets');
  return secure
    ? mod.connect({ hostname, port }, { secureTransport: 'on' })
    : mod.connect({ hostname, port });
}

/** 白名单判定：空=全部走链；否则目标 host 等于或以任一条目为后缀才走链 */
export function chainAllows(cfg, targetHost) {
  const wl = cfg.chainWhitelist || [];
  if (!wl.length) return true;
  const t = String(targetHost || '').toLowerCase();
  return wl.some((w) => {
    const s = String(w || '').toLowerCase().trim();
    return s && (t === s || t.endsWith('.' + s));
  });
}

/* ---------- SOCKS5（RFC 1928）握手字节构造（纯函数，可单测） ---------- */

/** 握手问候：支持无认证(0x00)与账号密码(0x02) */
export function socks5Greeting(withAuth) {
  return withAuth
    ? new Uint8Array([0x05, 0x02, 0x00, 0x02])
    : new Uint8Array([0x05, 0x01, 0x00]);
}

/** 账号密码认证请求（RFC 1929） */
export function socks5AuthRequest(user, pass) {
  const u = te.encode(String(user || ''));
  const p = te.encode(String(pass || ''));
  const out = new Uint8Array(3 + u.length + p.length);
  out[0] = 0x01;
  out[1] = u.length; out.set(u, 2);
  out[2 + u.length] = p.length; out.set(p, 3 + u.length);
  return out;
}

/** CONNECT 请求：目标支持域名/IP（ATYP 按目标类型选） */
export function socks5ConnectRequest(targetHost, targetPort) {
  const port = [(targetPort >>> 8) & 255, targetPort & 255];
  if (isIP(targetHost) && targetHost.includes('.')) {
    // IPv4
    const parts = targetHost.split('.').map(Number);
    return new Uint8Array([0x05, 0x01, 0x00, 0x01, ...parts, ...port]);
  }
  if (isIP(targetHost)) {
    // IPv6：16 字节
    const groups = expandIPv6(targetHost);
    const out = new Uint8Array(4 + 16 + 2);
    out.set([0x05, 0x01, 0x00, 0x04], 0);
    out.set(groups, 4);
    out[out.length - 2] = port[0]; out[out.length - 1] = port[1];
    return out;
  }
  // 域名
  const h = te.encode(String(targetHost));
  const out = new Uint8Array(4 + 1 + h.length + 2);
  out.set([0x05, 0x01, 0x00, 0x03, h.length], 0);
  out.set(h, 5);
  out[out.length - 2] = port[0]; out[out.length - 1] = port[1];
  return out;
}

/** IPv6 展开为 16 字节（处理 :: 缩写） */
export function expandIPv6(ip) {
  const out = new Uint8Array(16);
  const halves = String(ip).split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  const groups = [...head, ...new Array(Math.max(fill, 0)).fill('0'), ...tail].slice(0, 8);
  groups.forEach((g, i) => {
    const v = parseInt(g || '0', 16);
    out[i * 2] = (v >>> 8) & 255;
    out[i * 2 + 1] = v & 255;
  });
  return out;
}

/** 校验 SOCKS5 服务端应答（greeting/auth/CONNECT 均为 2 字节或 10 字节头） */
export function socks5CheckReply(buf, expectLen) {
  if (!buf || buf.length < expectLen) return false;
  if (expectLen === 2) return buf[0] === 0x05 && buf[1] === 0x00;
  return buf[0] === 0x05 && buf[1] === 0x00; // CONNECT 成功：VER=5 REP=0
}

/* ---------- HTTP(S) CONNECT 代理 ---------- */

/** 构造 HTTP CONNECT 请求行（含 Proxy-Authorization） */
export function buildHttpConnectReq(targetHost, targetPort, user, pass) {
  let req = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
  if (user) {
    const cred = bytesToBase64(te.encode(`${user}:${pass || ''}`));
    req += `Proxy-Authorization: Basic ${cred}\r\n`;
  }
  return req + '\r\n';
}

/** 读 socket 首行，判断 CONNECT 是否成功（2xx） */
async function readHttpStatusLine(reader) {
  let acc = new Uint8Array(0);
  for (let i = 0; i < 8; i++) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) acc = concatBytes(acc, value);
    const idx = indexOfSeq(acc, te.encode('\r\n'));
    if (idx >= 0) {
      const line = td.decode(acc.subarray(0, idx));
      return { line, rest: acc.subarray(idx + 2) };
    }
  }
  return { line: '', rest: acc };
}

/** 在字节流中找子序列，返回起始下标或 -1 */
export function indexOfSeq(hay, needle) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** 从 socket 读指定字节数（握手用） */
async function readExactly(reader, n) {
  let acc = new Uint8Array(0);
  while (acc.length < n) {
    const { done, value } = await reader.read();
    if (done) throw new Error('proxy closed');
    if (value) acc = concatBytes(acc, value);
  }
  return acc.subarray(0, n);
}

/** 经 SOCKS5 代理建立到目标的 TCP 隧道，返回已握手好的 socket */
async function socks5Dial(cfg, targetHost, targetPort) {
  const sock = await tcpConnect(cfg.chainHost, cfg.chainPort);
  const w = sock.writable.getWriter();
  const r = sock.readable.getReader();
  const useAuth = !!(cfg.chainUser);
  try {
    await w.write(socks5Greeting(useAuth));
    if (!socks5CheckReply(await readExactly(r, 2), 2)) throw new Error('socks5 greeting rejected');
    if (useAuth) {
      await w.write(socks5AuthRequest(cfg.chainUser, cfg.chainPass));
      if (!socks5CheckReply(await readExactly(r, 2), 2)) throw new Error('socks5 auth failed');
    }
    await w.write(socks5ConnectRequest(targetHost, targetPort));
    // CONNECT 应答：VER REP RSV ATYP + BND.ADDR + BND.PORT，按 ATYP 读完整
    const head4 = await readExactly(r, 4);
    if (head4[0] !== 0x05 || head4[1] !== 0x00) throw new Error('socks5 connect failed');
    const atyp = head4[3];
    if (atyp === 0x01) await readExactly(r, 6);        // IPv4: 4 + 2
    else if (atyp === 0x04) await readExactly(r, 18);  // IPv6: 16 + 2
    else if (atyp === 0x03) {
      const ln = (await readExactly(r, 1))[0];
      await readExactly(r, ln + 2);                    // 域名：1 + len + 2
    } else throw new Error('socks5 bad atyp');
  } catch (e) {
    try { w.releaseLock(); } catch { /* 忽略 */ }
    try { r.cancel(); } catch { /* 忽略 */ }
    try { sock.close(); } catch { /* 忽略 */ }
    throw e;
  }
  try { w.releaseLock(); } catch { /* 忽略 */ }
  // 注意：r 仍被占用？CONNECT 成功后 reader 需交还调用方做透传。
  // 这里把 reader 锁释放后由调用方重新 getReader。
  try { r.releaseLock(); } catch { /* 忽略 */ }
  return sock;
}

/** 链式代理是否需要先对代理服务器做 TLS（https 类型）。
 * 抽成纯函数：一是单测可覆盖，二是防止以后有人把 https 又当成"不支持"抛错。 */
export function chainNeedsTls(cfg) {
  return !!(cfg && cfg.chainType === 'https');
}

/** 经 HTTP/HTTPS 代理 CONNECT 到目标，返回已握手好的 socket。
 * chainType=https 时：先 tcpConnect(secure=true) 对代理服务器建 TLS，
 * 再在 TLS 流里发送明文 CONNECT（HTTPS 代理的标准用法，RFC 2817 思想）。
 * 之后的数据透传与 http 完全一致，所以握手逻辑复用同一套。 */
async function httpProxyDial(cfg, targetHost, targetPort) {
  const useTls = chainNeedsTls(cfg);
  let sock = await tcpConnect(cfg.chainHost, cfg.chainPort, useTls);
  const w = sock.writable.getWriter();
  const r = sock.readable.getReader();
  try {
    await w.write(te.encode(buildHttpConnectReq(targetHost, targetPort, cfg.chainUser, cfg.chainPass)));
    const { line, rest } = await readHttpStatusLine(r);
    if (!/^HTTP\/\d(\.\d)?\s+2\d\d/.test(line)) throw new Error('proxy connect rejected: ' + line);
    if (rest.length) {
      // 代理回了多余字节（不应发生），无法推回 socket，报错
      throw new Error('proxy sent unexpected bytes');
    }
  } catch (e) {
    try { w.releaseLock(); } catch { /* 忽略 */ }
    try { r.cancel(); } catch { /* 忽略 */ }
    try { sock.close(); } catch { /* 忽略 */ }
    throw e;
  }
  try { w.releaseLock(); } catch { /* 忽略 */ }
  try { r.releaseLock(); } catch { /* 忽略 */ }
  return sock;
}

/** 经链式代理拨号（按 chainType 分发） */
async function dialViaChain(addr, port, cfg) {
  if (cfg.chainType === 'socks5') return socks5Dial(cfg, addr, port);
  return httpProxyDial(cfg, addr, port);
}

/* ------------------------------------------------------------------
 * 拨号调优（v3）：并发竞速 + 自适应超时
 * ------------------------------------------------------------------ */

/** 纯函数：按配置排出拨号尝试顺序（链式→直连→回落）。
 * 抽出来一是单测可覆盖顺序逻辑，二是串行/并发两种模式共用一份顺序。 */
export function buildDialPlan(addr, cfg) {
  const plan = [];
  const chainOk = cfg.chainEnabled && cfg.chainHost;
  const chainFirst = chainOk && chainAllows(cfg, addr);
  if (chainFirst) plan.push({ kind: 'chain' });
  plan.push({ kind: 'direct' });
  if (chainOk && !chainFirst) plan.push({ kind: 'chain' });
  if (cfg.proxyIP) plan.push({ kind: 'proxyip' });
  return plan;
}

/** 按计划项实际拨号 */
function dialByKind(kind, addr, port, cfg) {
  if (kind === 'chain') return dialViaChain(addr, port, cfg);
  if (kind === 'proxyip') return tcpConnect(cfg.proxyIP, 443);
  return tcpConnect(addr, port);
}

/** 自适应拨号超时（纯函数，可单测）。
 * 思路：平时按历史平均耗时的 2 倍给超时；弱网（失败数超过成功数）时收紧到
 * 平均耗时——因为弱网下"等一个注定失败的拨号"最浪费时间，快速失败、
 * 快速试下一条反而更快建连；网络正常时给足 2 倍余量避免误杀慢但可用的链路。
 * 上下限钳制（1200~8000ms）防止极端值。 */
export function computeDialTimeout(manualMs, avgMs, okCount, failCount) {
  if (manualMs > 0) return manualMs; // 面板手动指定优先
  const avg = avgMs > 0 ? avgMs : 3000; // 无历史时按 3s 估
  const weak = failCount > okCount;     // 失败比成功多 → 视为弱网
  const t = weak ? Math.min(avg, 2500) : avg * 2;
  return Math.min(8000, Math.max(1200, Math.round(t)));
}

// 模块级拨号统计（同 isolate 内共享；Workers 无跨请求持久内存，尽力而为）
const dialStats = { ok: 0, fail: 0, totalMs: 0 };
/** 记录一次拨号结果：ms=null 表示失败 */
export function noteDialResult(ms) {
  if (ms == null) { dialStats.fail++; }
  else { dialStats.ok++; dialStats.totalMs += ms; }
  if (dialStats.ok + dialStats.fail > 10000) { // 防溢出：衰减
    dialStats.ok = Math.floor(dialStats.ok / 2);
    dialStats.fail = Math.floor(dialStats.fail / 2);
    dialStats.totalMs = Math.floor(dialStats.totalMs / 2);
  }
}
/** 当前配置下的拨号超时（供 raceDials 用） */
export function dialTimeoutFor(cfg) {
  const avg = dialStats.ok ? dialStats.totalMs / dialStats.ok : 0;
  return computeDialTimeout(cfg.dialTimeoutMs, avg, dialStats.ok, dialStats.fail);
}

/** 并发竞速拨号（纯逻辑，可单测，fn 返回类 socket {close()}）。
 * 同时发起多个拨号，取最快成功的；落败或超时的尝试会被关闭，避免泄漏。
 * 注意：超时的尝试底层 connect 可能稍后才成功，通过 side-tap 统一关闭。 */
export async function raceDials(fns, timeoutMs) {
  if (!fns.length) throw new Error('no dial attempts');
  const sockets = [];
  let settled = false;
  return await new Promise((resolve, reject) => {
    let pending = fns.length;
    let lastErr = null;
    const finish = (sock) => {
      if (settled) { try { sock.close(); } catch { /* 忽略 */ } return; }
      settled = true;
      for (const s of sockets) if (s !== sock) { try { s.close(); } catch { /* 忽略 */ } }
      resolve(sock);
    };
    fns.forEach((fn) => {
      let timer = null;
      const p = fn();
      // side-tap：任何尝试只要建连成功就登记；若已决出胜负，立即关闭（防泄漏）
      p.then((s) => {
        sockets.push(s);
        if (settled) { try { s.close(); } catch { /* 忽略 */ } }
      }, () => {});
      (async () => {
        try {
          const sock = timeoutMs > 0
            ? await Promise.race([p, new Promise((_, rej) => {
                timer = setTimeout(() => rej(new Error('dial timeout')), timeoutMs);
              })])
            : await p;
          if (timer) clearTimeout(timer);
          finish(sock);
        } catch (e) {
          if (timer) clearTimeout(timer);
          lastErr = e;
          if (--pending === 0 && !settled) { settled = true; reject(lastErr); }
        }
      })();
    });
  });
}

/** 统一出站拨号。
 * dialRace 关闭（默认）：串行逐个尝试（v1/v2 原有行为，稳定优先）。
 * dialRace 开启：前 N 个尝试并发竞速取最快成功的；若全败，剩余的串行补试
 * （比如 proxyip 回落），保证回落语义不丢。 */
async function dialOut(addr, port, cfg) {
  const plan = buildDialPlan(addr, cfg);
  const timed = async (kind) => {
    const t0 = Date.now();
    try {
      const sock = await dialByKind(kind, addr, port, cfg);
      noteDialResult(Date.now() - t0);
      return sock;
    } catch (e) {
      noteDialResult(null);
      throw e;
    }
  };
  if (!cfg.dialRace || plan.length < 2) {
    let err = null;
    for (const step of plan) {
      try { return await timed(step.kind); } catch (e) { err = e; }
    }
    throw err || new Error('dial failed');
  }
  const n = Math.min(plan.length, clampInt(cfg.dialConcurrency, 2, 5, 3));
  const timeoutMs = dialTimeoutFor(cfg);
  try {
    return await raceDials(plan.slice(0, n).map((s) => () => timed(s.kind)), timeoutMs);
  } catch (e) {
    let err = e;
    for (const step of plan.slice(n)) {
      try { return await timed(step.kind); } catch (e2) { err = e2; }
    }
    throw err;
  }
}

// 旧名保留兼容（内部已统一走 dialOut）
async function tcpConnectWithFallback(addr, port, cfg) {
  return dialOut(addr, port, cfg);
}

/* ------------------------------------------------------------------
 * 测速模式（v3）：目标命中测速名单 → 本地回显，不经过出站
 * ------------------------------------------------------------------ */

/** 测速目标判定（纯函数）：host 命中名单则走本地回显。
 * 后缀匹配（speedtest.net 能命中 www.speedtest.net），空名单=关闭测速模式。
 * 注意与 chainAllows 的区别：chainAllows 空名单=全部走链，这里空名单=全不命中。 */
export function isSpeedtestTarget(host, list) {
  const t = String(host || '').toLowerCase().trim();
  if (!t || !list || !list.length) return false;
  return list.some((w) => {
    const s = String(w || '').toLowerCase().trim().replace(/^\*\./, '');
    return s && (t === s || t.endsWith('.' + s));
  });
}

/** 本地回显 socket（测速模式用）。
 * 为什么：客户端测速真正关心的是"客户端↔Worker"这段链路的吞吐；让 Worker
 * 把收到的数据原样返回，测到的是真实可用带宽，且不消耗出站、不依赖测速站
 * 本身的速度（测速站限速/排队会导致误判节点慢）。
 * 实现：TransformStream 默认就是恒等变换，写进 writable 的数据会原样出现在
 * readable 上——天然就是个回显器；接口与 TCP socket 的 readable/writable/
 * close 一致，bridgeWsTcp 无需任何改动。 */
export function localEchoSocket() {
  const ts = new TransformStream();
  return {
    readable: ts.readable,
    writable: ts.writable,
    close() { try { ts.writable.close(); } catch { /* 忽略 */ } },
  };
}

/** 出站建连统一入口（含测速模式）。
 * 目标地址命中测速名单 → 返回本地回显（不拨号）；否则走正常拨号流程。
 * 注意：Trojan fallback 的透传目标不走这里（那是用户自建服务器地址，
 * 不是代理目标），直接用 dialOut。 */
async function dialForTarget(addr, port, cfg) {
  if (isSpeedtestTarget(addr, cfg.speedtestDomains)) return localEchoSocket();
  return tcpConnectWithFallback(addr, port, cfg);
}

/** 从 Sec-WebSocket-Protocol 头取 early data（base64） */
function getEarlyData(request) {
  const h = request.headers.get('sec-websocket-protocol');
  if (!h) return new Uint8Array(0);
  try { return base64ToBytes(h.trim()); } catch { return new Uint8Array(0); }
}

/** 读够协议头：parseFn(buf) 数据不足返回 null，非法抛错 */
async function readHeader(reader, parseFn, earlyData) {
  if (earlyData && earlyData.length) reader.prepend(earlyData);
  let buf = new Uint8Array(0);
  for (;;) {
    const chunk = await reader.read();
    if (chunk === null) throw new Error('ws closed before header');
    buf = concatBytes(buf, chunk);
    const res = parseFn(buf); // 抛错 = 非法请求
    if (res) {
      reader.prepend(buf.subarray(res.headerLen));
      // 透传场景（如 Trojan fallback）需要原始头字节，这里一并带出；
      // 普通代理路径用不到，忽略即可。
      res.raw = buf.subarray(0, res.headerLen);
      return res;
    }
    if (buf.length > 16384) throw new Error('header too large');
  }
}

/* ------------------------------------------------------------------
 * WS ↔ TCP 双向桥接（带背压：await write 即天然背压；关闭清理）
 * ------------------------------------------------------------------ */
async function pumpWsToSock(reader, writer, transform) {
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk === null) break;
      const out = transform ? await transform(chunk) : chunk;
      if (out && out.length) await writer.write(out);
    }
  } catch { /* 忽略，转入清理 */ }
  try { await writer.close(); } catch { /* 忽略 */ }
}

async function pumpSockToWs(sockReader, ws, prefix, transform) {
  try {
    if (prefix && prefix.length && ws.readyState === 1) ws.send(prefix);
    for (;;) {
      const r = await sockReader.read();
      if (r.done) break;
      if (ws.readyState !== 1) break;
      const out = transform ? await transform(r.value) : r.value;
      if (out && out.length) ws.send(out);
    }
  } catch { /* 忽略，转入清理 */ }
  try { ws.close(); } catch { /* 忽略 */ }
}

async function bridgeWsTcp(ws, socket, reader, opts) {
  const o = opts || {};
  const sockReader = socket.readable.getReader();
  const sockWriter = socket.writable.getWriter();
  await Promise.allSettled([
    pumpWsToSock(reader, sockWriter, o.wsToSock || null),
    pumpSockToWs(sockReader, ws, o.prefix || null, o.sockToWs || null),
  ]);
  try { sockReader.cancel(); } catch { /* 忽略 */ }
  try { sockWriter.abort(); } catch { /* 忽略 */ }
  try { ws.close(); } catch { /* 忽略 */ }
}

/* ------------------------------------------------------------------
 * UDP → DNS over HTTPS（Workers 没有 UDP socket；
 * DNS 查询走 DoH 中继，非 DNS 的 UDP 优雅关闭）
 * ------------------------------------------------------------------ */
async function dohQuery(datagram) {
  const endpoints = ['https://1.1.1.1/dns-query', 'https://cloudflare-dns.com/dns-query'];
  let lastErr = null;
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'content-type': 'application/dns-message', accept: 'application/dns-message' },
        body: datagram,
      });
      if (!res.ok) { lastErr = new Error('doh status ' + res.status); continue; }
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('doh failed');
}

/** VLESS UDP：流内 [2B长度][datagram] 分帧，只中继 DNS（port 53） */
async function handleVlessUdp(ws, reader, hdr) {
  try {
    if (hdr.port !== 53) return;
    if (ws.readyState === 1) ws.send(new Uint8Array([hdr.version, 0x00]));
    let buf = new Uint8Array(0);
    for (;;) {
      const chunk = await reader.read();
      if (chunk === null) break;
      buf = concatBytes(buf, chunk);
      while (buf.length >= 2) {
        const len = (buf[0] << 8) | buf[1];
        if (buf.length < 2 + len) break;
        const dg = buf.subarray(2, 2 + len);
        buf = buf.subarray(2 + len);
        try {
          const resp = await dohQuery(dg);
          if (ws.readyState === 1) {
            ws.send(concatBytes(new Uint8Array([(resp.length >>> 8) & 0xff, resp.length & 0xff]), resp));
          }
        } catch { /* 单个查询失败忽略 */ }
      }
      if (buf.length > 65535) buf = new Uint8Array(0);
    }
  } finally {
    try { ws.close(); } catch { /* 忽略 */ }
  }
}

/**
 * Trojan UDP：每包 ATYP + ADDR + PORT(2) + LEN(2) + DATA
 * （假设：包尾无 CRLF；解析失败则关闭。只中继 DNS。）
 */
async function handleTrojanUdp(ws, reader) {
  try {
    let buf = new Uint8Array(0);
    for (;;) {
      const chunk = await reader.read();
      if (chunk === null) break;
      buf = concatBytes(buf, chunk);
      for (;;) {
        let ap;
        try { ap = parseAddr(buf, 0); } catch { return; }
        if (!ap) break;
        const pp = parsePort(buf, ap.next);
        if (!pp) break;
        if (buf.length < pp.next + 2) break;
        const len = (buf[pp.next] << 8) | buf[pp.next + 1];
        if (buf.length < pp.next + 2 + len) break;
        const dg = buf.subarray(pp.next + 2, pp.next + 2 + len);
        buf = buf.subarray(pp.next + 2 + len);
        if (pp.port !== 53) continue;
        try {
          const resp = await dohQuery(dg);
          if (ws.readyState === 1) {
            // 回包按同样分帧：ATYP=IPv4 0.0.0.0:53
            const head = new Uint8Array([0x01, 0, 0, 0, 0, 0, 53, (resp.length >>> 8) & 0xff, resp.length & 0xff]);
            ws.send(concatBytes(head, resp));
          }
        } catch { /* 单个查询失败忽略 */ }
      }
      if (buf.length > 65535) buf = new Uint8Array(0);
    }
  } finally {
    try { ws.close(); } catch { /* 忽略 */ }
  }
}

/* ------------------------------------------------------------------
 * 三协议 WS 入口
 * ------------------------------------------------------------------ */
async function handleVless(server, request, env, cfg) {
  const ws = server;
  try {
    const validUUIDs = [parseUUID(cfg.UUID), ...cfg.multiUUID.map(parseUUID)].filter(Boolean);
    if (!validUUIDs.length) return;
    const reader = new WsReader(ws);
    const hdr = await readHeader(reader, (b) => parseVlessHeader(b, validUUIDs), getEarlyData(request));
    if (hdr.cmd === 0x02) { await handleVlessUdp(ws, reader, hdr); return; }
    const socket = await dialForTarget(hdr.addr, hdr.port, cfg);
    await bridgeWsTcp(ws, socket, reader, { prefix: new Uint8Array([hdr.version, 0x00]) });
  } catch {
    try { ws.close(); } catch { /* 忽略 */ }
  }
}

/** 解析 /trojan=IP:端口 路径（纯函数）。
 * 用途：Trojan fallback——用户自建的有完整 UDP 能力的 Trojan 服务器地址。
 * 示例：trojan=1.1.1.1:1234 → {host:'1.1.1.1', port:1234} */
export function parseTrojanFallback(seg) {
  const m = /^trojan=(.+):(\d+)$/.exec(String(seg || ''));
  if (!m) return null;
  const port = Number(m[2]);
  if (!m[1] || !(port > 0 && port < 65536)) return null;
  return { host: m[1], port };
}

/** Trojan UDP 透传到自建 fallback。
 * 为什么需要透传而不是本地终结：Workers 没有 UDP 出站 socket，UDP 包无法
 * 从 Worker 直接发出去（v2 里只能把 DNS 挑出来走 DoH 中继，非 DNS 直接丢弃）。
 * fallback 是用户自建的、有完整 UDP 能力的 Trojan 服务器。这里只做"认证后
 * 透传"：先校验 Trojan 密码（防止未授权蹭用），然后把原始字节流（含 Trojan
 * 头）原样转发给 fallback，由它解析并完成 UDP 转发；回包再原样送回客户端。
 * 出站走统一 dialOut（直连/链式/回落策略与面板一致）。 */
async function pipeTrojanToFallback(ws, reader, rawHeader, fallback, cfg) {
  const sock = await dialOut(fallback.host, fallback.port, cfg);
  const w = sock.writable.getWriter();
  const r = sock.readable.getReader();
  try {
    await w.write(rawHeader);
    const up = (async () => {
      for (;;) {
        const chunk = await reader.read();
        if (chunk === null) break;
        await w.write(chunk);
      }
    })();
    const down = (async () => {
      for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        if (value && value.length && ws.readyState === 1) ws.send(value);
      }
    })();
    await Promise.race([up, down]);
  } finally {
    try { w.releaseLock(); } catch { /* 忽略 */ }
    try { r.cancel(); } catch { /* 忽略 */ }
    try { sock.close(); } catch { /* 忽略 */ }
    try { ws.close(); } catch { /* 忽略 */ }
  }
}

async function handleTrojan(server, request, env, cfg, fallback) {
  const ws = server;
  try {
    const pwdHash = trojanPasswordHash(cfg.trojanPassword);
    const reader = new WsReader(ws);
    const hdr = await readHeader(reader, (b) => parseTrojanHeader(b, pwdHash), getEarlyData(request));
    if (hdr.cmd === 0x03) {
      // UDP：有 fallback 则认证后透传给自建服务器；无 fallback 走 DoH（仅 DNS）。
      if (fallback && hdr.raw) { await pipeTrojanToFallback(ws, reader, hdr.raw, fallback, cfg); return; }
      await handleTrojanUdp(ws, reader); return;
    }
    const socket = await dialForTarget(hdr.addr, hdr.port, cfg);
    await bridgeWsTcp(ws, socket, reader, {});
  } catch {
    try { ws.close(); } catch { /* 忽略 */ }
  }
}

async function handleSs(server, request, env, cfg) {
  const ws = server;
  try {
    const reader = new WsReader(ws);
    const early = getEarlyData(request);
    if (early.length) reader.prepend(early);
    const dec = new SsDecryptor(cfg.ssMethod, cfg.ssPassword);
    const enc = new SsEncryptor(cfg.ssMethod, cfg.ssPassword);
    // 先解密出目标地址（首个数据块内：ATYP + ADDR + PORT + 后续载荷）
    let plain = new Uint8Array(0);
    let target = null;
    for (;;) {
      const chunk = await reader.read();
      if (chunk === null) return;
      plain = concatBytes(plain, await dec.push(chunk));
      let ap = null;
      try { ap = parseAddr(plain, 0); } catch { return; }
      if (ap) {
        const pp = parsePort(plain, ap.next);
        if (pp) {
          target = { addr: ap.addr, port: pp.port };
          plain = plain.subarray(pp.next);
          break;
        }
      }
      if (plain.length > 512) return;
    }
    const socket = await dialForTarget(target.addr, target.port, cfg);
    // 首包载荷（地址之后的部分）随后续解密流一起发出
    let pending = plain.length ? plain : null;
    const wsToSock = async (chunk) => {
      const pt = await dec.push(chunk);
      if (pending) { const out = concatBytes(pending, pt); pending = null; return out; }
      return pt;
    };
    await bridgeWsTcp(ws, socket, reader, {
      wsToSock,
      sockToWs: (chunk) => enc.encrypt(chunk),
    });
  } catch {
    try { ws.close(); } catch { /* 忽略 */ }
  }
}

/* ------------------------------------------------------------------
 * gRPC 传输（gun 模式子集，clean-room 实现）
 * 识别：POST + Content-Type 含 application/grpc（/api/* 除外）。
 * 帧格式参考 gRPC HTTP/2 Length-Prefixed-Message：
 *   1B 压缩标志（0=未压缩）+ 4B 大端长度 + 载荷
 * 首帧载荷按 VLESS 解析（失败再试 Trojan）；仅支持 TCP，UDP 拒绝。
 * 回包逐帧封装；流结束时补 trailer 帧（grpc-status:0，首字节 0x80），
 * 严格 gRPC 客户端靠它确认 RPC 正常完成；响应头也带 grpc-status 兼容 HTTP/1 客户端。
 * ------------------------------------------------------------------ */

/** gRPC 编码：一组载荷 → Length-Prefixed-Message 字节流 */
export function grpcEncode(payloads) {
  const bufs = [];
  let total = 0;
  for (const p of payloads) {
    const b = p instanceof Uint8Array ? p : te.encode(String(p));
    bufs.push(b);
    total += 5 + b.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of bufs) {
    out[o++] = 0; // 压缩标志：0=未压缩
    out[o++] = (b.length >>> 24) & 255;
    out[o++] = (b.length >>> 16) & 255;
    out[o++] = (b.length >>> 8) & 255;
    out[o++] = b.length & 255;
    out.set(b, o);
    o += b.length;
  }
  return out;
}

/** gRPC 解帧：返回 {frames（完整帧载荷数组）, rest（不完整尾巴）} */
export function grpcDecode(buf) {
  const frames = [];
  let o = 0;
  while (o + 5 <= buf.length) {
    const len = buf[o + 1] * 16777216 + (buf[o + 2] << 16) + (buf[o + 3] << 8) + buf[o + 4];
    if (len < 0 || len > 32 * 1024 * 1024) break; // 非法长度：停
    if (o + 5 + len > buf.length) break;          // 不完整：等更多数据
    frames.push(buf.subarray(o + 5, o + 5 + len));
    o += 5 + len;
  }
  return { frames, rest: buf.subarray(o) };
}

/** gRPC trailer 帧编码（纯函数）。
 * 为什么需要：标准 gRPC 客户端在流结束时期望收到 trailer 帧（首字节最高位
 * 0x80 置位，载荷为 "grpc-status:0\r\n" 等 ASCII 头），用它确认一次 RPC 正常
 * 结束；收不到时部分严格客户端会判定流异常中断而不断重试。v2 只把 grpc-status
 * 放在 HTTP 响应头里，HTTP/1 下多数 gun 客户端能接受，但严格客户端会断连；
 * v3 在数据流末尾补一个 trailer 帧，两者兼顾。 */
export function grpcEncodeTrailer(status, message) {
  const payload = te.encode(`grpc-status:${status}\r\ngrpc-message:${message || ''}\r\n`);
  const out = new Uint8Array(5 + payload.length);
  out[0] = 0x80; // trailer 标志位（压缩标志的最高位）
  out[1] = (payload.length >>> 24) & 255;
  out[2] = (payload.length >>> 16) & 255;
  out[3] = (payload.length >>> 8) & 255;
  out[4] = payload.length & 255;
  out.set(payload, 5);
  return out;
}

/** gRPC 错误响应（HTTP 200 + grpc-status 非零，客户端按 gRPC 语义处理） */
function grpcError(message) {
  return new Response('', {
    headers: { 'content-type': 'application/grpc', 'grpc-status': '13', 'grpc-message': encodeURIComponent(message || 'error') },
  });
}

/** gRPC 建连：POST body 流 → 解帧 → 协议解析 → TCP 出站 → 回包逐帧 */
async function handleGrpc(request, env, cfg, ctx) {
  const ok = (body) => new Response(body, {
    headers: { 'content-type': 'application/grpc', 'grpc-status': '0', 'grpc-message': '' },
  });
  try {
    const validUUIDs = [parseUUID(cfg.UUID), ...cfg.multiUUID.map(parseUUID)].filter(Boolean);
    if (!validUUIDs.length) return grpcError('uuid 未配置');
    const trojanHash = cfg.trojanPassword ? trojanPasswordHash(cfg.trojanPassword) : null;
    const reader = request.body.getReader();
    let acc = new Uint8Array(0);
    let target = null, leftover = null;
    // 攒出首批完整帧，做协议头解析
    for (;;) {
      const { done, value } = await reader.read();
      if (value && value.length) acc = concatBytes(acc, value);
      const { frames, rest } = grpcDecode(acc);
      if (frames.length) {
        const payload = concatBytes(...frames);
        acc = rest;
        let hdr = null;
        try {
          const v = parseVlessHeader(payload, validUUIDs);
          if (v && v.cmd === 0x01) hdr = { addr: v.addr, port: v.port, len: v.headerLen };
        } catch { /* 不是 VLESS，试 Trojan */ }
        if (!hdr && trojanHash) {
          try {
            const t = parseTrojanHeader(payload, trojanHash);
            if (t && t.cmd === 0x01) hdr = { addr: t.addr, port: t.port, len: t.headerLen };
          } catch { /* 不是 Trojan */ }
        }
        if (!hdr) return grpcError('协议头非法或仅支持 TCP');
        target = { addr: hdr.addr, port: hdr.port };
        leftover = payload.subarray(hdr.len);
        break;
      }
      if (done) return grpcError('空请求');
      if (acc.length > 65536) return grpcError('请求头过大');
    }
    const socket = await dialForTarget(target.addr, target.port, cfg);
    const sockReader = socket.readable.getReader();
    const sockWriter = socket.writable.getWriter();
    // 上行：剩余帧载荷 + 后续帧 → socket
    const upstream = (async () => {
      try {
        if (leftover && leftover.length) await sockWriter.write(leftover);
        for (;;) {
          const { done, value } = await reader.read();
          if (value && value.length) acc = concatBytes(acc, value);
          const { frames, rest } = grpcDecode(acc);
          acc = rest;
          for (const f of frames) await sockWriter.write(f);
          if (done) break;
          if (acc.length > 1024 * 1024) break; // 垃圾数据防爆：1MB 未成帧则断开
        }
      } catch { /* 忽略 */ }
      try { await sockWriter.close(); } catch { /* 忽略 */ }
    })();
    // 下行：socket 数据 → gRPC 帧 → 响应流
    const downstream = new ReadableStream({
      async start(ctrl) {
        try {
          for (;;) {
            const { done, value } = await sockReader.read();
            if (done) break;
            if (value && value.length) ctrl.enqueue(grpcEncode([value]));
          }
        } catch { /* 忽略 */ }
        try {
          // 流正常结束：补 trailer 帧（grpc-status:0），严格客户端靠它确认 RPC 完成
          ctrl.enqueue(grpcEncodeTrailer(0, ''));
          ctrl.close();
        } catch { /* 忽略 */ }
        try { sockReader.cancel(); } catch { /* 忽略 */ }
      },
      cancel() { try { sockReader.cancel(); } catch { /* 忽略 */ } },
    });
    if (ctx) ctx.waitUntil(upstream); else upstream.catch(() => {});
    return ok(downstream);
  } catch {
    return grpcError('内部错误');
  }
}

/* ------------------------------------------------------------------
 * XHTTP 传输（stream-one 基础模式，clean-room 实现）
 * 识别：POST +（x-padding 请求头 或 ?xhttp= 查询参数），/api/* 除外。
 * stream-one：整个上行流在一个 POST body 里，原始字节流（无帧封装），
 * 首段按 VLESS/Trojan 解析目标地址，之后透传；回包原始流。
 *
 * 为什么不支持 stream-up / packet-up（v3 结论，保持 stream-one）：
 * 这两种模式把一次代理会话拆成多个 HTTP 请求（上行 POST、下行 GET 长轮询，
 * 靠 session id 配对），要求服务端在"上行请求"和"下行请求"之间共享会话状态
 * 且延迟要低。Cloudflare Workers 的 isolate 是无状态的（同用户两次请求大
 * 概率落到不同 isolate，内存 Map 共享不可靠），唯一跨请求存储是 KV，而 KV
 * 是最终一致性、读写几十毫秒——拿它做逐包的上下行配对既不可靠又慢。
 * stream-one 把上下行收敛在一次请求里，无需跨请求状态，是 Workers 下唯一
 * 稳妥的 XHTTP 形态；客户端用 auto 模式会自动协商到 stream-one。
 * ------------------------------------------------------------------ */

/** XHTTP 建连：body 原始流 → 协议解析 → TCP 出站 → 原始流回包 */
async function handleXhttp(request, env, cfg, ctx) {
  try {
    const validUUIDs = [parseUUID(cfg.UUID), ...cfg.multiUUID.map(parseUUID)].filter(Boolean);
    if (!validUUIDs.length) return new Response('uuid 未配置', { status: 500 });
    const trojanHash = cfg.trojanPassword ? trojanPasswordHash(cfg.trojanPassword) : null;
    const reader = request.body.getReader();
    let acc = new Uint8Array(0);
    let target = null, leftover = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (value && value.length) acc = concatBytes(acc, value);
      let hdr = null;
      try {
        const v = parseVlessHeader(acc, validUUIDs);
        if (v && v.cmd === 0x01) hdr = { addr: v.addr, port: v.port, len: v.headerLen };
      } catch { /* 试 Trojan */ }
      if (!hdr && trojanHash) {
        try {
          const t = parseTrojanHeader(acc, trojanHash);
          if (t && t.cmd === 0x01) hdr = { addr: t.addr, port: t.port, len: t.headerLen };
        } catch { /* 忽略 */ }
      }
      if (hdr) {
        target = { addr: hdr.addr, port: hdr.port };
        leftover = acc.subarray(hdr.len);
        break;
      }
      if (done) return new Response('bad request', { status: 400 });
      if (acc.length > 65536) return new Response('header too large', { status: 400 });
    }
    const socket = await dialForTarget(target.addr, target.port, cfg);
    const sockReader = socket.readable.getReader();
    const sockWriter = socket.writable.getWriter();
    const upstream = (async () => {
      try {
        if (leftover && leftover.length) await sockWriter.write(leftover);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length) await sockWriter.write(value);
        }
      } catch { /* 忽略 */ }
      try { await sockWriter.close(); } catch { /* 忽略 */ }
    })();
    const downstream = new ReadableStream({
      async start(ctrl) {
        try {
          for (;;) {
            const { done, value } = await sockReader.read();
            if (done) break;
            if (value && value.length) ctrl.enqueue(value);
          }
        } catch { /* 忽略 */ }
        try { ctrl.close(); } catch { /* 忽略 */ }
        try { sockReader.cancel(); } catch { /* 忽略 */ }
      },
      cancel() { try { sockReader.cancel(); } catch { /* 忽略 */ } },
    });
    if (ctx) ctx.waitUntil(upstream); else upstream.catch(() => {});
    return new Response(downstream, { headers: { 'content-type': 'application/octet-stream' } });
  } catch {
    return new Response('internal error', { status: 500 });
  }
}

/* ------------------------------------------------------------------
 * 路由
 * ------------------------------------------------------------------ */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const host = url.host;
    const cfg = await loadConfig(env);
    const isWs = request.headers.get('Upgrade') === 'websocket';
    const method = request.method;

    // 首页伪装
    if (path === '/' && method === 'GET') return htmlResp(cfg.disguiseHTML || defaultDisguiseHTML());

    // 登录页 / 登录登出 API（无需会话）
    if (path === '/login' && method === 'GET') return htmlResp(loginPageHTML());
    if (path === '/api/login' && method === 'POST') return handleLogin(request, env, cfg, url);
    if (path === '/api/logout' && method === 'POST') return handleLogout(request, env);

    // 管理后台与面板 API（需要会话）
    const needSession = path === '/admin' || path === '/api/config' ||
      path === '/api/logs' || path === '/api/test-source' ||
      path === '/api/cf-usage' || path === '/api/check-proxy';
    if (needSession) {
      if (!(await checkSession(request, env))) {
        if (path === '/admin') return Response.redirect(new URL('/login', url).toString(), 302);
        return json({ error: 'unauthorized' }, 401);
      }
      if (path === '/admin') return htmlResp(adminPageHTML(cfg.subPath));
      if (path === '/api/logs') return handleLogs(env);
      if (path === '/api/test-source') return handleTestSource(env, url.searchParams.get('url'));
      if (path === '/api/cf-usage') return handleCfUsage(env, cfg);
      if (path === '/api/check-proxy') return handleCheckProxy(env, cfg);
      if (method === 'GET') return handleGetConfig(cfg, env);
      if (method === 'POST') return handlePostConfig(request, env, ctx);
      return new Response('method not allowed', { status: 405 });
    }

    // gRPC 传输：POST + application/grpc（/api/* 已在上面处理）
    const ctype = request.headers.get('content-type') || '';
    if (method === 'POST' && ctype.includes('application/grpc') && !path.startsWith('/api/')) {
      logAndNotifyProxy(request, env, ctx, cfg, 'grpc');
      return handleGrpc(request, env, cfg, ctx);
    }
    // XHTTP 传输（stream-one 基础模式）：POST + x-padding 头或 ?xhttp= 参数
    if (method === 'POST' && !path.startsWith('/api/') &&
        (request.headers.has('x-padding') || url.searchParams.has('xhttp'))) {
      logAndNotifyProxy(request, env, ctx, cfg, 'xhttp');
      return handleXhttp(request, env, cfg, ctx);
    }

    // 订阅：主路径 + 显式格式路径 + 快速订阅 KEY 路径
    // 格式按「显式路径 > ?target= > UA 嗅探」决定，handleSub 内统一处理
    const subBase = cfg.subPath;
    const subRoutes = [
      [subBase, null], [subBase + '/', null],
      [subBase + '/clash', 'clash'], [subBase + '/singbox', 'singbox'],
      [subBase + '/surge', 'surge'], [subBase + '/quanx', 'quanx'], [subBase + '/loon', 'loon'],
    ];
    if (cfg.subKey) {
      const kb = '/' + cfg.subKey;
      subRoutes.push([kb, null], [kb + '/', null],
        [kb + '/clash', 'clash'], [kb + '/singbox', 'singbox'],
        [kb + '/surge', 'surge'], [kb + '/quanx', 'quanx'], [kb + '/loon', 'loon']);
    }
    for (const [p, f] of subRoutes) {
      if (path === p) return handleSub(request, env, ctx, cfg, host, f);
    }

    // WS 代理入口（按首包形状自动识别协议，v1 行为保留）
    if (isWs) {
      const seg = path.slice(1);
      const run = (fn) => {
        const pair = new WebSocketPair();
        const client = pair[0], server = pair[1];
        server.accept();
        ctx.waitUntil((async () => { try { await fn(server); } catch { /* 忽略 */ } })());
        return new Response(null, { status: 101, webSocket: client });
      };
      if (seg === 'trojan' || seg.startsWith('trojan=')) {
        if (!cfg.trojanPassword) return new Response('trojan disabled', { status: 404 });
        // /trojan=IP:端口：Trojan fallback 路径，UDP 认证后透传给自建服务器
        const fb = seg.startsWith('trojan=') ? parseTrojanFallback(seg) : null;
        if (seg.startsWith('trojan=') && !fb) return new Response('bad fallback', { status: 400 });
        logAndNotifyProxy(request, env, ctx, cfg, 'trojan');
        return run((s) => handleTrojan(s, request, env, cfg, fb));
      }
      if (seg === 'ss') {
        if (!cfg.ssPassword) return new Response('ss disabled', { status: 404 });
        logAndNotifyProxy(request, env, ctx, cfg, 'ss');
        return run((s) => handleSs(s, request, env, cfg));
      }
      if (parseUUID(seg)) {
        if (!cfg.UUID) return new Response('uuid not configured', { status: 500 });
        logAndNotifyProxy(request, env, ctx, cfg, 'vless');
        return run((s) => handleVless(s, request, env, cfg));
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};

/** 代理建连的日志 + TG 通知（后台，不阻塞；TG 每 IP 每天一次） */
function logAndNotifyProxy(request, env, ctx, cfg, proto) {
  try {
    const le = logEntryOf(request);
    le.path = `proxy:${proto}`;
    if (cfg.logEnabled) ctx.waitUntil(appendLog(env, le));
    if (cfg.tgEnabled && le.ip) {
      ctx.waitUntil(tgNotifyOncePerDay(env, cfg, le.ip,
        `🔗 新代理连接\n协议: ${proto}\nIP: ${le.ip}${le.cc ? ' (' + le.cc + ')' : ''}\nUA: ${le.ua || '-'}`));
    }
  } catch { /* 忽略 */ }
}
