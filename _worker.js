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

export const SS_VERSION = '2.0.0';

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
  hosts: [],                // 多 HOST 轮换（空=用请求 host）
  nodePort: 443,            // 节点端口
  earlyData: false,         // 0RTT：订阅拼 ed=2048 参数
  fragment: false,          // TLS 分片：订阅拼 fragment 参数（需客户端支持）
  // —— 优选 IP ——
  preferredSources: [],     // 优选 IP 源 URL 列表（支持 https:// 文本源与 sub:// 聚合源）
  preferredStatic: [],      // 静态优选 IP 列表（支持 IP / IP:端口 / IP#备注）
  randIPCount: 16,          // 内置随机优选 IP 生成数量（0=关闭）
  randIPPort: 443,          // 随机优选 IP 端口
  // —— 出站 ——
  proxyIP: '',              // 回落 IP（出站失败时重试）
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
  cfg.nodePort = clampPort(cfg.nodePort, 443);
  cfg.randIPPort = clampPort(cfg.randIPPort, 443);
  cfg.randIPCount = clampInt(cfg.randIPCount, 0, 500, 16);
  cfg.ssAltPort = clampInt(cfg.ssAltPort, 0, 65535, 0);
  cfg.chainPort = clampPort(cfg.chainPort, 1080);
  if (!SS_METHODS[cfg.ssMethod]) cfg.ssMethod = 'aes-128-gcm';
  if (!['socks5', 'http', 'https'].includes(cfg.chainType)) cfg.chainType = 'socks5';
  cfg.subKey = String(cfg.subKey || '').trim().replace(/^\/+|\/+$/g, '');
  cfg.earlyData = !!cfg.earlyData;
  cfg.fragment = !!cfg.fragment;
  cfg.chainEnabled = !!cfg.chainEnabled;
  cfg.logEnabled = !!cfg.logEnabled;
  cfg.tgEnabled = !!cfg.tgEnabled;
  // env 兜底
  cfg.ADMIN = env.ADMIN || '';
  cfg.UUID = env.UUID || '';
  cfg.SUB_TOKEN = env.SUB_TOKEN || '';
  cfg.subPathCustom = String(cfg.subPath || '').trim(); // 面板回显用（未改动前为空）
  cfg.subPath = cfg.subPathCustom || (cfg.SUB_TOKEN ? `/${cfg.SUB_TOKEN}` : '/sub');
  if (!cfg.subPath.startsWith('/')) cfg.subPath = '/' + cfg.subPath;
  return cfg;
}

/** 校验并保存配置到 KV（只接受白名单字段）。
 *  密码类字段（chainPass/tgBotToken/cfApiToken/ssPassword）留空表示不修改：
 *  先读出现有配置做合并，避免前端不回显导致每次保存被清空。 */
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
  const keepIfEmpty = (k) => {
    if (input[k] === undefined || String(input[k]) === '') input[k] = old[k] || '';
  };
  keepIfEmpty('ssPassword');
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
  cfg.hosts = linesToList(input.hosts);
  cfg.nodePort = clampPort(input.nodePort, 443);
  cfg.earlyData = !!input.earlyData;
  cfg.fragment = !!input.fragment;
  cfg.preferredSources = linesToList(input.preferredSources).filter((s) => /^(https?|sub):\/\//.test(s));
  cfg.preferredStatic = linesToList(input.preferredStatic);
  cfg.randIPCount = clampInt(input.randIPCount, 0, 500, 16);
  cfg.randIPPort = clampPort(input.randIPPort, 443);
  cfg.proxyIP = isIP(String(input.proxyIP || '').trim()) ? String(input.proxyIP).trim() : '';
  cfg.chainEnabled = !!input.chainEnabled;
  cfg.chainType = ['socks5', 'http', 'https'].includes(input.chainType) ? input.chainType : 'socks5';
  cfg.chainHost = String(input.chainHost || '').trim();
  cfg.chainPort = clampPort(input.chainPort, 1080);
  cfg.chainUser = String(input.chainUser || '');
  cfg.chainPass = String(input.chainPass || '');
  cfg.chainWhitelist = linesToList(input.chainWhitelist);
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

/** 内置随机优选 IP 生成器：从 CF 段随机抽 count 个 */
export async function genRandomPreferredIPs(count, env, rand) {
  if (!count || count <= 0) return [];
  const cidrs = await getCloudflareCIDRs(env);
  return randomIPsFromCIDRs(cidrs, Math.min(count, 500), rand);
}

/** 全部优选 IP 条目（去重）：静态 + 各源抓取 + 随机生成。
 *  返回 [{ip, port, remark}]，port 为 0 表示用节点默认端口。 */
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
  // 4. 随机生成
  if (cfg.randIPCount > 0) {
    const rnd = await genRandomPreferredIPs(cfg.randIPCount, env);
    for (const ip of rnd) push(ip, cfg.randIPPort || 0, '');
  }
  return out;
}

/* ------------------------------------------------------------------
 * IP 归属地：ip-api.com（免费，无需 key），KV 缓存 30 天。
 * 订阅生成时只读缓存；缺失的在后台（waitUntil）异步补齐，
 * 缺失时节点先显示 🌐 未知，不阻塞订阅。
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
  const missing = [];
  for (const ip of ips) {
    try {
      if (!(await kv.get(KV_GEO_PREFIX + ip))) missing.push(ip);
    } catch { /* 忽略 */ }
  }
  // 限速：ip-api 免费版 45 次/分钟，这里串行 + 小间隔
  for (const ip of missing) {
    const code = await queryGeo(ip);
    try {
      await kv.put(KV_GEO_PREFIX + ip, code || '??', { expirationTtl: 30 * 86400 });
    } catch { /* 忽略 */ }
    await new Promise((r) => setTimeout(r, 1400));
  }
}

/* ------------------------------------------------------------------
 * 订阅节点组装
 * 命名：{国旗emoji}{中文国名} {全局序号}，如 🇺🇸 美国 01；
 * 条目带 #备注 时追加在末尾，如 🇺🇸 美国 01 香港专线。
 * 排序：按国家代码分组，组内按 IP 排序，组按代码排序；全局编号 01..NN
 * 每个 IP 生成 VLESS / Trojan / SS 各一条（按配置启用的协议）
 * 输入兼容旧格式的字符串数组（自动转为条目）。
 * ------------------------------------------------------------------ */
export function buildNodeNames(entries, geoMap) {
  const items = (entries || []).map((e) => {
    const en = typeof e === 'string' ? { ip: e, port: 0, remark: '' } : e;
    return { ip: en.ip, port: en.port || 0, remark: en.remark || '', code: (geoMap || {})[en.ip] || '??' };
  });
  // 按国家代码排序，未知归属地（'??'）排在最后；同国家内按 IP 排；最后全局编号 01..NN
  items.sort((a, b) => {
    const au = a.code === '??', bu = b.code === '??';
    if (au !== bu) return au ? 1 : -1;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.ip < b.ip ? -1 : a.ip > b.ip ? 1 : 0;
  });
  return items.map((it, i) => {
    const known = it.code !== '??';
    const flag = known ? countryFlag(it.code) : '🌐';
    const name = known ? countryNameOf(it.code) : '未知';
    const num = String(i + 1).padStart(2, '0');
    const full = `${flag} ${name} ${num}` + (it.remark ? ` ${it.remark}` : '');
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
 * 管理界面：现代简约风格
 * 纯手写 HTML + CSS + 少量 JS，不依赖任何 CDN，保证单文件可离线。
 * 浅色极简：大量留白、细分割线、14px 系统字体、中性灰 + #2563eb
 * 强调色、8~10px 圆角卡片。
 * ------------------------------------------------------------------ */

function cssBase() {
  return `
  :root { --accent: #2563eb; --text: #1a1a1a; --muted: #6b7280; --line: #e5e7eb; --bg: #fafafa; --card: #ffffff; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
         font-size: 14px; line-height: 1.6; color: var(--text); background: var(--bg);
         -webkit-font-smoothing: antialiased; }
  a { color: var(--accent); text-decoration: none; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 48px 20px 80px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 24px; margin-bottom: 16px; }
  .card h2 { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
  .card .desc { color: var(--muted); font-size: 13px; margin-bottom: 16px; }
  .field { margin-bottom: 16px; }
  .field:last-child { margin-bottom: 0; }
  label { display: block; font-weight: 500; margin-bottom: 6px; }
  .hint { color: var(--muted); font-size: 12.5px; margin-top: 6px; }
  input[type=text], input[type=password], input[type=number], textarea, select {
    width: 100%; padding: 9px 12px; font-size: 14px; font-family: inherit; color: var(--text);
    border: 1px solid var(--line); border-radius: 8px; background: #fff; outline: none; }
  input:focus, textarea:focus, select:focus { border-color: var(--accent); }
  textarea { min-height: 96px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  input[readonly] { background: #f5f5f5; color: var(--muted); }
  .btn { display: inline-block; padding: 9px 20px; font-size: 14px; font-weight: 500; color: #fff;
         background: var(--accent); border: none; border-radius: 8px; cursor: pointer; }
  .btn:hover { background: #1d4ed8; }
  .btn-ghost { background: #fff; color: var(--text); border: 1px solid var(--line); }
  .btn-ghost:hover { background: #f5f5f5; }
  .btn-sm { padding: 6px 14px; font-size: 13px; }
  hr.sep { border: none; border-top: 1px solid var(--line); margin: 20px 0; }
  `;
}

export function loginPageHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录 · 影梭 ShadowShuttle</title>
<style>${cssBase()}
.login-box { max-width: 360px; margin: 12vh auto 0; }
.login-box h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
.login-box .sub { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
.err { display: none; color: #dc2626; font-size: 13px; margin-top: 10px; }
</style></head>
<body>
<div class="wrap"><div class="card login-box">
  <h1>影梭 ShadowShuttle</h1>
  <div class="sub">管理后台登录</div>
  <div class="field"><label>管理密码</label>
    <input type="password" id="pw" placeholder="输入 ADMIN 密码" autocomplete="current-password"></div>
  <button class="btn" id="go" style="width:100%">登录</button>
  <div class="err" id="err">密码错误，请重试</div>
</div></div>
<script>
var pw = document.getElementById('pw'), err = document.getElementById('err');
function doLogin() {
  err.style.display = 'none';
  fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw.value }) }).then(function(r) {
    if (r.ok) location.href = '/admin'; else err.style.display = 'block';
  }).catch(function() { err.style.display = 'block'; });
}
document.getElementById('go').onclick = doLogin;
pw.onkeydown = function(e) { if (e.key === 'Enter') doLogin(); };
pw.focus();
</script>
</body></html>`;
}

export function adminPageHTML(subPath) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>管理后台 · 影梭 ShadowShuttle</title>
<style>${cssBase()}
.topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.topbar h1 { font-size: 18px; font-weight: 600; }
.topbar .ver { color: var(--muted); font-size: 12.5px; margin-left: 8px; font-weight: 400; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 24px; }
.tab { padding: 10px 16px; font-size: 14px; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 500; }
.pane { display: none; } .pane.active { display: block; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 18px; }
.stat .num { font-size: 26px; font-weight: 600; }
.stat .lbl { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
.urlrow { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.urlrow input { flex: 1; font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
.urlrow .tag { min-width: 86px; font-weight: 500; }
.savebar { position: sticky; bottom: 0; background: var(--bg); padding: 16px 0; border-top: 1px solid var(--line); margin-top: 8px;
            display: flex; align-items: center; gap: 12px; }
.dirty { display: none; color: #b45309; font-size: 13px; }
.warn { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; font-size: 13px; }
.ok { display: none; color: #15803d; font-size: 13px; }
</style></head>
<body>
<div class="wrap">
  <div class="topbar">
    <div><h1>影梭 ShadowShuttle<span class="ver">v${SS_VERSION}</span></h1></div>
    <button class="btn btn-ghost btn-sm" id="logout">退出登录</button>
  </div>
  <div id="kvWarn" class="warn" style="display:none">未检测到 KV 绑定：配置无法保存。请在 Worker 设置里绑定 KV（变量名 KV）后再使用。</div>
  <div class="tabs">
    <div class="tab active" data-pane="p-overview">概览</div>
    <div class="tab" data-pane="p-users">用户管理</div>
    <div class="tab" data-pane="p-nodes">节点配置</div>
    <div class="tab" data-pane="p-subs">订阅链接</div>
  </div>

  <div class="pane active" id="p-overview">
    <div class="stats">
      <div class="stat"><div class="num" id="st-ips">–</div><div class="lbl">优选 IP</div></div>
      <div class="stat"><div class="num" id="st-nodes">–</div><div class="lbl">订阅节点</div></div>
      <div class="stat"><div class="num" id="st-proto">–</div><div class="lbl">启用协议</div></div>
    </div>
    <div class="card"><h2>订阅链接</h2><div class="desc">复制到客户端即可使用</div><div id="subList"></div></div>
  </div>

  <div class="pane" id="p-users">
    <div class="card"><h2>用户与凭证</h2><div class="desc">UUID 在 Worker Variables 中修改，此处仅展示</div>
      <div class="field"><label>VLESS 主 UUID（Variables）</label><input type="text" id="f-uuid" readonly></div>
      <div class="field"><label>多用户 UUID</label><textarea id="f-multiUUID" placeholder="每行一个 UUID"></textarea>
        <div class="hint">额外允许的用户，每行一个，留空则只有主 UUID 可用</div></div>
      <hr class="sep">
      <div class="field"><label>Trojan 密码</label><input type="text" id="f-trojanPassword" placeholder="留空则不启用 Trojan">
        <div class="hint">对应代理路径 /trojan</div></div>
      <div class="field"><label>Shadowsocks 密码</label><input type="text" id="f-ssPassword" placeholder="留空则不启用 Shadowsocks">
        <div class="hint">对应代理路径 /ss</div></div>
      <div class="field"><label>Shadowsocks 加密方式</label>
        <select id="f-ssMethod">
          <option value="aes-128-gcm">aes-128-gcm</option>
          <option value="aes-256-gcm">aes-256-gcm</option>
          <option value="chacha20-ietf-poly1305">chacha20-ietf-poly1305</option>
        </select></div>
    </div>
  </div>

  <div class="pane" id="p-nodes">
    <div class="card"><h2>优选 IP</h2><div class="desc">订阅节点 = 去重后的全部优选 IP，每个 IP 按启用协议生成节点</div>
      <div class="field"><label>优选 IP 源 URL</label><textarea id="f-preferredSources" placeholder="每行一个 URL，返回文本每行一个 IP"></textarea>
        <div class="hint">抓取结果缓存 6 小时</div></div>
      <div class="field"><label>静态优选 IP</label><textarea id="f-preferredStatic" placeholder="每行一个 IP"></textarea></div>
      <hr class="sep">
      <div class="field"><label>回落 IP（proxyIP）</label><input type="text" id="f-proxyIP" placeholder="可选，出站直连失败时改走该 IP:443 重试">
      </div>
      <div class="field"><label>节点端口</label><input type="number" id="f-nodePort" min="1" max="65535"></div>
      <div class="field"><label>订阅路径</label><input type="text" id="f-subPath" placeholder="默认 /{SUB_TOKEN}">
        <div class="hint">修改后订阅链接随之变化</div></div>
    </div>
    <div class="card"><h2>伪装首页</h2><div class="desc">访问域名根路径时展示的页面，留空使用内置默认</div>
      <div class="field"><textarea id="f-disguiseHTML" style="min-height:160px" placeholder="自定义 HTML，留空使用默认"></textarea></div>
    </div>
  </div>

  <div class="pane" id="p-subs">
    <div class="card"><h2>订阅链接</h2><div class="desc">三种格式，覆盖主流客户端</div><div id="subList2"></div></div>
    <div class="card"><h2>节点命名规则</h2>
      <div class="desc">格式：{国旗} {中文国名} {序号}，例如 🇺🇸 美国 01。归属地来自 ip-api.com 并缓存 30 天；<br>首次生成时未知归属地的 IP 会显示为 🌐 未知，后台会自动补齐。</div>
    </div>
  </div>

  <div class="savebar">
    <button class="btn" id="save">保存配置</button>
    <span class="dirty" id="dirty">● 有未保存的更改</span>
    <span class="ok" id="okmsg">已保存</span>
  </div>
</div>
<script>
var SUB_PATH = ${JSON.stringify(subPath)};
var dirtyEl = document.getElementById('dirty'), okEl = document.getElementById('okmsg');
function markDirty() { dirtyEl.style.display = 'inline'; okEl.style.display = 'none'; }
function markClean() { dirtyEl.style.display = 'none'; }
document.querySelectorAll('input, textarea, select').forEach(function(el) {
  el.addEventListener('input', markDirty); el.addEventListener('change', markDirty);
});
document.querySelectorAll('.tab').forEach(function(t) {
  t.onclick = function() {
    document.querySelectorAll('.tab').forEach(function(x) { x.classList.remove('active'); });
    document.querySelectorAll('.pane').forEach(function(x) { x.classList.remove('active'); });
    t.classList.add('active'); document.getElementById(t.dataset.pane).classList.add('active');
  };
});
document.getElementById('logout').onclick = function() {
  fetch('/api/logout', { method: 'POST' }).then(function() { location.href = '/login'; });
};
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function renderSubs() {
  var base = location.origin + SUB_PATH;
  var defs = [['通用订阅', base, 'v2rayN / Shadowrocket / NekoBox 等'], ['Clash', base + '/clash', 'Clash / ClashMeta'], ['sing-box', base + '/singbox', 'sing-box 1.8+']];
  var html = '';
  defs.forEach(function(d, i) {
    html += '<div class="urlrow"><span class="tag">' + d[0] + '</span>' +
      '<input type="text" readonly value="' + esc(d[1]) + '" id="suburl' + i + '">' +
      '<button class="btn btn-ghost btn-sm" data-copy="suburl' + i + '">复制</button></div>' +
      '<div class="hint" style="margin:-4px 0 12px 94px">' + d[2] + '</div>';
  });
  document.getElementById('subList').innerHTML = html;
  document.getElementById('subList2').innerHTML = html.replace(/suburl/g, 'suburl2');
  document.querySelectorAll('[data-copy]').forEach(function(b) {
    b.onclick = function() {
      var inp = document.getElementById(b.dataset.copy);
      inp.select(); inp.setSelectionRange(0, 99999);
      function done(t) { b.textContent = t; setTimeout(function() { b.textContent = '复制'; }, 1200); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(inp.value).then(function() { done('已复制'); }, function() {
          document.execCommand('copy'); done('已复制');
        });
      } else { document.execCommand('copy'); done('已复制'); }
    };
  });
}
function load() {
  fetch('/api/config').then(function(r) {
    if (r.status === 401) { location.href = '/login'; return null; }
    return r.json();
  }).then(function(cfg) {
    if (!cfg) return;
    if (cfg.hasKV === false) document.getElementById('kvWarn').style.display = 'block';
    document.getElementById('f-uuid').value = cfg.UUID || '';
    document.getElementById('f-multiUUID').value = (cfg.multiUUID || []).join('\\n');
    document.getElementById('f-trojanPassword').value = cfg.trojanPassword || '';
    document.getElementById('f-ssPassword').value = cfg.ssPassword || '';
    document.getElementById('f-ssMethod').value = cfg.ssMethod || 'aes-128-gcm';
    document.getElementById('f-preferredSources').value = (cfg.preferredSources || []).join('\\n');
    document.getElementById('f-preferredStatic').value = (cfg.preferredStatic || []).join('\\n');
    document.getElementById('f-proxyIP').value = cfg.proxyIP || '';
    document.getElementById('f-nodePort').value = cfg.nodePort || 443;
    document.getElementById('f-subPath').value = cfg.subPathCustom || '';
    document.getElementById('f-disguiseHTML').value = cfg.disguiseHTML || '';
    if (cfg.subPath) SUB_PATH = cfg.subPath;
    renderSubs();
    var nProto = 1 + (cfg.trojanPassword ? 1 : 0) + (cfg.ssPassword ? 1 : 0);
    document.getElementById('st-proto').textContent = nProto;
    var nIps = (cfg.preferredStatic || []).length + (cfg.preferredSources || []).length + '+';
    document.getElementById('st-ips').textContent = (cfg.preferredStatic || []).length + ' 静态';
    document.getElementById('st-nodes').textContent = '按需生成';
    markClean();
  }).catch(function() {});
}
document.getElementById('save').onclick = function() {
  var body = {
    multiUUID: document.getElementById('f-multiUUID').value,
    trojanPassword: document.getElementById('f-trojanPassword').value,
    ssPassword: document.getElementById('f-ssPassword').value,
    ssMethod: document.getElementById('f-ssMethod').value,
    preferredSources: document.getElementById('f-preferredSources').value,
    preferredStatic: document.getElementById('f-preferredStatic').value,
    proxyIP: document.getElementById('f-proxyIP').value,
    nodePort: document.getElementById('f-nodePort').value,
    subPath: document.getElementById('f-subPath').value,
    disguiseHTML: document.getElementById('f-disguiseHTML').value,
  };
  fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, status: r.status, j: j }; }); })
    .then(function(res) {
      if (res.ok) { markClean(); okEl.style.display = 'inline'; setTimeout(function() { okEl.style.display = 'none'; }, 2000); if (res.j.subPath) SUB_PATH = res.j.subPath; renderSubs(); }
      else alert('保存失败：' + (res.j.error || res.status));
    }).catch(function() { alert('保存失败：网络错误'); });
};
load();
</script>
</body></html>`;
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
    hosts: cfg.hosts,
    nodePort: cfg.nodePort,
    earlyData: cfg.earlyData,
    fragment: cfg.fragment,
    preferredSources: cfg.preferredSources,
    preferredStatic: cfg.preferredStatic,
    randIPCount: cfg.randIPCount,
    randIPPort: cfg.randIPPort,
    proxyIP: cfg.proxyIP,
    chainEnabled: cfg.chainEnabled,
    chainType: cfg.chainType,
    chainHost: cfg.chainHost,
    chainPort: cfg.chainPort,
    chainUser: cfg.chainUser,
    chainPass: '', // 密码不回显，前端留空=不修改
    chainWhitelist: cfg.chainWhitelist,
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

async function handlePostConfig(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, 400); }
  try {
    await saveConfig(env, body || {});
    const cfg = await loadConfig(env);
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
  const nodes = buildNodeNames(entries, geoMap);
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
async function tcpConnect(hostname, port) {
  const mod = await import('cloudflare:sockets');
  return mod.connect({ hostname, port });
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

/** 经 HTTP/HTTPS 代理 CONNECT 到目标，返回已握手好的 socket */
async function httpProxyDial(cfg, targetHost, targetPort) {
  let sock = await tcpConnect(cfg.chainHost, cfg.chainPort);
  if (cfg.chainType === 'https') {
    // 对代理本身先做 TLS（Workers 下用 fetch 做 CONNECT 隧道较复杂，
    // 这里用原始 TLS：暂不支持，回退为 http 语义并抛错提示）
    try { sock.close(); } catch { /* 忽略 */ }
    throw new Error('https 链式代理暂不支持，请用 http 或 socks5');
  }
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

/** 统一出站拨号：直连 → 链式代理 → PROXYIP 回落，逐个尝试 */
async function dialOut(addr, port, cfg) {
  const chainOk = cfg.chainEnabled && cfg.chainHost;
  const chainFirst = chainOk && chainAllows(cfg, addr);
  const attempts = [];
  if (chainFirst) attempts.push(() => dialViaChain(addr, port, cfg));
  attempts.push(() => tcpConnect(addr, port));
  if (chainOk && !chainFirst) attempts.push(() => dialViaChain(addr, port, cfg));
  if (cfg.proxyIP) attempts.push(() => tcpConnect(cfg.proxyIP, 443));
  let err = null;
  for (const fn of attempts) {
    try { return await fn(); } catch (e) { err = e; }
  }
  throw err || new Error('dial failed');
}

// 旧名保留兼容（内部已统一走 dialOut）
async function tcpConnectWithFallback(addr, port, cfg) {
  return dialOut(addr, port, cfg);
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
    const socket = await tcpConnectWithFallback(hdr.addr, hdr.port, cfg);
    await bridgeWsTcp(ws, socket, reader, { prefix: new Uint8Array([hdr.version, 0x00]) });
  } catch {
    try { ws.close(); } catch { /* 忽略 */ }
  }
}

async function handleTrojan(server, request, env, cfg) {
  const ws = server;
  try {
    const pwdHash = trojanPasswordHash(cfg.trojanPassword);
    const reader = new WsReader(ws);
    const hdr = await readHeader(reader, (b) => parseTrojanHeader(b, pwdHash), getEarlyData(request));
    if (hdr.cmd === 0x03) { await handleTrojanUdp(ws, reader); return; }
    const socket = await tcpConnectWithFallback(hdr.addr, hdr.port, cfg);
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
    const socket = await tcpConnectWithFallback(target.addr, target.port, cfg);
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
 * 回包逐帧封装；HTTP/1 下 trailers 无法流式发送，这里把 grpc-status
 * 放在响应头（多数 gun 客户端可接受），已知限制见 CHANGELOG。
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
    const socket = await dialOut(target.addr, target.port, cfg);
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
        try { ctrl.close(); } catch { /* 忽略 */ }
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
 * （packet-up 等多请求拆分模式暂不支持，见 CHANGELOG）
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
    const socket = await dialOut(target.addr, target.port, cfg);
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
      if (method === 'POST') return handlePostConfig(request, env);
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
      if (seg === 'trojan') {
        if (!cfg.trojanPassword) return new Response('trojan disabled', { status: 404 });
        logAndNotifyProxy(request, env, ctx, cfg, 'trojan');
        return run((s) => handleTrojan(s, request, env, cfg));
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
