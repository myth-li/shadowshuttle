/**
 * myth-tunnel — 自研 Cloudflare Worker 代理
 * ============================================================
 * clean-room 实现：VLESS / Trojan / Shadowsocks over WebSocket，
 * 优选 IP 订阅生成（国旗+中文国名+序号命名），现代简约管理面板。
 *
 * 参考的只是公开协议规范（VLESS 协议头格式、Trojan 协议、
 * Shadowsocks AEAD、RFC 8439 ChaCha20-Poly1305），未复制任何
 * 现有项目的代码。
 *
 * 部署：把整个文件粘贴到 Cloudflare Dashboard → Workers → 编辑代码，
 * 或用 wrangler deploy。纯逻辑函数同时 export，供 node 自测。
 */

export const MT_VERSION = '1.0.0';

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
 * 其余可选项存 KV（key: mt:config），Variables 做兜底。
 * ------------------------------------------------------------------ */
const KV_CONFIG_KEY = 'mt:config';
const KV_SESSION_PREFIX = 'mt:session:';
const KV_GEO_PREFIX = 'mt:geo:';
const KV_SRC_PREFIX = 'mt:src:';

const DEFAULT_CONFIG = {
  multiUUID: [],            // 多用户 UUID 数组
  trojanPassword: '',       // Trojan 密码（空=不启用）
  ssPassword: '',           // SS 密码（空=不启用）
  ssMethod: 'aes-128-gcm',  // SS 加密方式
  preferredSources: [],     // 优选 IP 源 URL 列表
  preferredStatic: [],      // 静态优选 IP 列表
  proxyIP: '',              // 回落 IP（出站失败时重试）
  nodePort: 443,            // 节点端口
  disguiseHTML: '',         // 伪装首页（空=内置默认）
  subPath: '',              // 订阅路径（空=/{SUB_TOKEN}）
};

/** 文本域输入 → 字符串数组（每行一条，去空去重） */
export function linesToList(s) {
  if (Array.isArray(s)) return [...new Set(s.map((x) => String(x).trim()).filter(Boolean))];
  return [...new Set(String(s || '').split('\n').map((x) => x.trim()).filter(Boolean))];
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
  cfg.preferredStatic = linesToList(cfg.preferredStatic).filter(isIP);
  cfg.nodePort = Number(cfg.nodePort) > 0 && Number(cfg.nodePort) < 65536 ? Number(cfg.nodePort) : 443;
  if (!SS_METHODS[cfg.ssMethod]) cfg.ssMethod = 'aes-128-gcm';
  // env 兜底
  cfg.ADMIN = env.ADMIN || '';
  cfg.UUID = env.UUID || '';
  cfg.SUB_TOKEN = env.SUB_TOKEN || '';
  cfg.subPathCustom = String(cfg.subPath || '').trim(); // 面板回显用（未改动前为空）
  cfg.subPath = cfg.subPathCustom || (cfg.SUB_TOKEN ? `/${cfg.SUB_TOKEN}` : '/sub');
  if (!cfg.subPath.startsWith('/')) cfg.subPath = '/' + cfg.subPath;
  return cfg;
}

/** 校验并保存配置到 KV（只接受白名单字段） */
export async function saveConfig(env, input) {
  const kv = env.KV;
  if (!kv) throw new Error('KV 未绑定');
  const cfg = { ...DEFAULT_CONFIG };
  cfg.multiUUID = linesToList(input.multiUUID).filter((s) => parseUUID(s));
  cfg.trojanPassword = String(input.trojanPassword || '').trim();
  cfg.ssPassword = String(input.ssPassword || '');
  cfg.ssMethod = SS_METHODS[input.ssMethod] ? input.ssMethod : 'aes-128-gcm';
  cfg.preferredSources = linesToList(input.preferredSources).filter((s) => /^https?:\/\//.test(s));
  cfg.preferredStatic = linesToList(input.preferredStatic).filter(isIP);
  cfg.proxyIP = isIP(String(input.proxyIP || '').trim()) ? String(input.proxyIP).trim() : '';
  cfg.nodePort = Number(input.nodePort) > 0 && Number(input.nodePort) < 65536 ? Number(input.nodePort) : 443;
  cfg.disguiseHTML = String(input.disguiseHTML || '');
  const sp = String(input.subPath || '').trim();
  cfg.subPath = sp ? (sp.startsWith('/') ? sp : '/' + sp) : '';
  await kv.put(KV_CONFIG_KEY, JSON.stringify(cfg));
  return cfg;
}

/* ------------------------------------------------------------------
 * 优选 IP 获取：静态列表 + 源 URL 抓取（KV 缓存 6 小时），去重
 * ------------------------------------------------------------------ */
function sha256HexSync(s) {
  // 非加密用途的短哈希：用 FNV-1a 做缓存 key（避免 async）
  let h1 = 0x811c9dc5;
  const b = te.encode(String(s));
  for (let i = 0; i < b.length; i++) { h1 ^= b[i]; h1 = Math.imul(h1, 0x01000193); }
  return (h1 >>> 0).toString(16).padStart(8, '0');
}

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
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const text = await res.text();
      for (const line of text.split('\n')) {
        const ip = line.trim().split(/[\s,#;]+/)[0];
        if (ip && isIP(ip)) ips.push(ip);
      }
    }
  } catch { /* 单个源失败不影响整体 */ }
  const uniq = [...new Set(ips)];
  if (kv && uniq.length) {
    try { await kv.put(cacheKey, JSON.stringify({ ts: Date.now(), ips: uniq }), { expirationTtl: 6 * 3600 }); } catch { /* 忽略 */ }
  }
  return uniq;
}

/** 全部优选 IP（去重）：静态 + 各源抓取 */
export async function getPreferredIPs(cfg, env) {
  const all = [...cfg.preferredStatic];
  const kv = env.KV;
  const results = await Promise.all(cfg.preferredSources.map((u) => fetchSourceIPs(u, kv)));
  for (const ips of results) all.push(...ips);
  return [...new Set(all)];
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
 * 命名：{国旗emoji}{中文国名} {全局序号}，如 🇺🇸 美国 01
 * 排序：按国家代码分组，组内按 IP 排序，组按代码排序；全局编号 01..NN
 * 每个 IP 生成 VLESS / Trojan / SS 各一条（按配置启用的协议）
 * ------------------------------------------------------------------ */
export function buildNodeNames(ips, geoMap) {
  const items = ips.map((ip) => ({ ip, code: geoMap[ip] || '??' }));
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
    return { ip: it.ip, code: it.code, name: `${flag} ${name} ${num}` };
  });
}

export function buildVlessUri(node, uuid, port, host) {
  const params = `encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=%2F${uuid}`;
  return `vless://${uuid}@${node.ip}:${port}?${params}#${encodeURIComponent(node.name)}`;
}

export function buildTrojanUri(node, password, port, host) {
  const params = `security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=%2Ftrojan`;
  return `trojan://${encodeURIComponent(password)}@${node.ip}:${port}?${params}#${encodeURIComponent(node.name)}`;
}

export function buildSsUri(node, method, password, port, host) {
  const userinfo = bytesToBase64(te.encode(`${method}:${password}`));
  const plugin = encodeURIComponent(`v2ray-plugin;tls;host=${host};path=/ss`);
  return `ss://${userinfo}@${node.ip}:${port}/?plugin=${plugin}#${encodeURIComponent(node.name)}`;
}

/** 通用 base64 订阅（v2rayN / Shadowrocket 等） */
export function buildBase64Sub(nodes, cfg, host) {
  const lines = [];
  for (const n of nodes) {
    lines.push(buildVlessUri(n, cfg.UUID, cfg.nodePort, host));
    if (cfg.trojanPassword) lines.push(buildTrojanUri(n, cfg.trojanPassword, cfg.nodePort, host));
    if (cfg.ssPassword) lines.push(buildSsUri(n, cfg.ssMethod, cfg.ssPassword, cfg.nodePort, host));
  }
  return bytesToBase64(te.encode(lines.join('\n')));
}

function yamlStr(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Clash YAML 订阅 */
export function buildClashSub(nodes, cfg, host) {
  const L = ['proxies:'];
  for (const n of nodes) {
    const name = yamlStr(n.name);
    L.push(`  - name: ${name}`);
    L.push(`    type: vless`);
    L.push(`    server: ${n.ip}`);
    L.push(`    port: ${cfg.nodePort}`);
    L.push(`    uuid: ${cfg.UUID}`);
    L.push(`    tls: true`);
    L.push(`    servername: ${host}`);
    L.push(`    client-fingerprint: chrome`);
    L.push(`    network: ws`);
    L.push(`    ws-opts:`);
    L.push(`      path: /${cfg.UUID}`);
    L.push(`      headers:`);
    L.push(`        Host: ${host}`);
    if (cfg.trojanPassword) {
      L.push(`  - name: ${name}`);
      L.push(`    type: trojan`);
      L.push(`    server: ${n.ip}`);
      L.push(`    port: ${cfg.nodePort}`);
      L.push(`    password: ${yamlStr(cfg.trojanPassword)}`);
      L.push(`    sni: ${host}`);
      L.push(`    client-fingerprint: chrome`);
      L.push(`    network: ws`);
      L.push(`    ws-opts:`);
      L.push(`      path: /trojan`);
      L.push(`      headers:`);
      L.push(`        Host: ${host}`);
    }
    if (cfg.ssPassword) {
      L.push(`  - name: ${name}`);
      L.push(`    type: ss`);
      L.push(`    server: ${n.ip}`);
      L.push(`    port: ${cfg.nodePort}`);
      L.push(`    cipher: ${cfg.ssMethod}`);
      L.push(`    password: ${yamlStr(cfg.ssPassword)}`);
      L.push(`    plugin: v2ray-plugin`);
      L.push(`    plugin-opts:`);
      L.push(`      mode: websocket`);
      L.push(`      tls: true`);
      L.push(`      host: ${host}`);
      L.push(`      path: /ss`);
    }
  }
  return L.join('\n') + '\n';
}

/** sing-box JSON 订阅 */
export function buildSingboxSub(nodes, cfg, host) {
  const outbounds = [];
  for (const n of nodes) {
    const tls = { enabled: true, server_name: host, utls: { enabled: true, fingerprint: 'chrome' } };
    const ws = (path) => ({ type: 'ws', path, headers: { Host: host } });
    outbounds.push({
      type: 'vless', tag: n.name, server: n.ip, server_port: cfg.nodePort,
      uuid: cfg.UUID, tls, transport: ws(`/${cfg.UUID}`),
    });
    if (cfg.trojanPassword) {
      outbounds.push({
        type: 'trojan', tag: n.name, server: n.ip, server_port: cfg.nodePort,
        password: cfg.trojanPassword, tls, transport: ws('/trojan'),
      });
    }
    if (cfg.ssPassword) {
      outbounds.push({
        type: 'shadowsocks', tag: n.name, server: n.ip, server_port: cfg.nodePort,
        method: cfg.ssMethod, password: cfg.ssPassword, tls, transport: ws('/ss'),
      });
    }
  }
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
<title>登录 · myth-tunnel</title>
<style>${cssBase()}
.login-box { max-width: 360px; margin: 12vh auto 0; }
.login-box h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
.login-box .sub { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
.err { display: none; color: #dc2626; font-size: 13px; margin-top: 10px; }
</style></head>
<body>
<div class="wrap"><div class="card login-box">
  <h1>myth-tunnel</h1>
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
<title>管理后台 · myth-tunnel</title>
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
    <div><h1>myth-tunnel<span class="ver">v${MT_VERSION}</span></h1></div>
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
<html><head><meta charset="utf-8"><title>Welcome to nginx!</title>
<style>body{width:35em;margin:0 auto;font-family:Tahoma,Verdana,Arial,sans-serif;}</style>
</head><body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p>
<p>For online documentation and support please refer to <a href="http://nginx.org/">nginx.org</a>.<br>
Commercial support is available at <a href="http://nginx.com/">nginx.com</a>.</p>
<p><em>Thank you for using nginx.</em></p>
</body></html>`;
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
  const m = /(?:^|;\s*)mt_session=([0-9a-f]+)/.exec(cookie);
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
    'Set-Cookie': `mt_session=${token}; HttpOnly; Path=/; Max-Age=3600; SameSite=Lax${secure}`,
  });
}

async function handleLogout(request, env) {
  const kv = env.KV;
  const cookie = request.headers.get('Cookie') || '';
  const m = /(?:^|;\s*)mt_session=([0-9a-f]+)/.exec(cookie);
  if (kv && m) { try { await kv.delete(KV_SESSION_PREFIX + m[1]); } catch { /* 忽略 */ } }
  return json({ ok: true }, 200, { 'Set-Cookie': 'mt_session=; HttpOnly; Path=/; Max-Age=0' });
}

function handleGetConfig(cfg, env) {
  return json({
    hasKV: !!env.KV,
    UUID: cfg.UUID,
    multiUUID: cfg.multiUUID,
    trojanPassword: cfg.trojanPassword,
    ssPassword: cfg.ssPassword,
    ssMethod: cfg.ssMethod,
    preferredSources: cfg.preferredSources,
    preferredStatic: cfg.preferredStatic,
    proxyIP: cfg.proxyIP,
    nodePort: cfg.nodePort,
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
 * 订阅接口
 * ------------------------------------------------------------------ */
async function handleSub(env, ctx, cfg, host, format) {
  if (!cfg.UUID) return new Response('UUID 未配置', { status: 500 });
  const ips = await getPreferredIPs(cfg, env);
  const geoMap = {};
  await Promise.all(ips.map(async (ip) => { geoMap[ip] = await getCachedGeo(ip, env); }));
  // 后台补齐缺失的归属地，不阻塞本次响应
  ctx.waitUntil(refreshGeoCache(ips, env));
  const nodes = buildNodeNames(ips, geoMap);
  if (format === 'clash') {
    return new Response(buildClashSub(nodes, cfg, host), { headers: { 'content-type': 'text/yaml; charset=utf-8' } });
  }
  if (format === 'singbox') {
    return new Response(buildSingboxSub(nodes, cfg, host), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  return new Response(buildBase64Sub(nodes, cfg, host), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/* ------------------------------------------------------------------
 * 出站：cloudflare:sockets TCP；失败且配了 proxyIP 则回落重试一次
 * ------------------------------------------------------------------ */
async function tcpConnect(hostname, port) {
  const mod = await import('cloudflare:sockets');
  return mod.connect({ hostname, port });
}

async function tcpConnectWithFallback(addr, port, cfg) {
  try {
    return await tcpConnect(addr, port);
  } catch (e) {
    if (cfg.proxyIP) return await tcpConnect(cfg.proxyIP, 443);
    throw e;
  }
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
 * 路由
 * ------------------------------------------------------------------ */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const host = url.host;
    const cfg = await loadConfig(env);
    const isWs = request.headers.get('Upgrade') === 'websocket';

    // 首页伪装
    if (path === '/') return htmlResp(cfg.disguiseHTML || defaultDisguiseHTML());

    // 登录页 / 登录登出 API（无需会话）
    if (path === '/login' && request.method === 'GET') return htmlResp(loginPageHTML());
    if (path === '/api/login' && request.method === 'POST') return handleLogin(request, env, cfg, url);
    if (path === '/api/logout' && request.method === 'POST') return handleLogout(request, env);

    // 管理后台与配置 API（需要会话）
    if (path === '/admin' || path === '/api/config') {
      if (!(await checkSession(request, env))) {
        if (path === '/admin') return Response.redirect(new URL('/login', url).toString(), 302);
        return json({ error: 'unauthorized' }, 401);
      }
      if (path === '/admin') return htmlResp(adminPageHTML(cfg.subPath));
      if (request.method === 'GET') return handleGetConfig(cfg, env);
      if (request.method === 'POST') return handlePostConfig(request, env);
      return new Response('method not allowed', { status: 405 });
    }

    // 订阅（三种格式）
    const subBase = cfg.subPath;
    if (path === subBase || path === subBase + '/') return handleSub(env, ctx, cfg, host, 'base64');
    if (path === subBase + '/clash') return handleSub(env, ctx, cfg, host, 'clash');
    if (path === subBase + '/singbox') return handleSub(env, ctx, cfg, host, 'singbox');

    // WS 代理入口
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
        return run((s) => handleTrojan(s, request, env, cfg));
      }
      if (seg === 'ss') {
        if (!cfg.ssPassword) return new Response('ss disabled', { status: 404 });
        return run((s) => handleSs(s, request, env, cfg));
      }
      if (parseUUID(seg)) {
        if (!cfg.UUID) return new Response('uuid not configured', { status: 500 });
        return run((s) => handleVless(s, request, env, cfg));
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};
