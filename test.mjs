/**
 * 影梭 ShadowShuttle 纯逻辑自测（node 运行）
 * 用法：node test.mjs
 * 覆盖：SHA-256/SHA-224、ChaCha20-Poly1305（RFC 8439 向量 + node:crypto 交叉验证）、
 *       HKDF-SHA1、VLESS/Trojan 头解析、SS AEAD 回环、国旗/国名映射、订阅拼装。
 */
import {
  sha256Bytes, trojanPasswordHash, bytesToHex, hexToBytes,
  chacha20Poly1305Encrypt, chacha20Poly1305Decrypt,
  ssSubkey, SS_METHODS, SsDecryptor, SsEncryptor,
  parseVlessHeader, parseTrojanHeader, parseUUID, bytesEqual,
  countryFlag, countryNameOf, buildNodeNames,
  buildVlessUri, buildTrojanUri, buildSsUri, buildBase64Sub, buildClashSub, buildSingboxSub,
  buildSurgeSub, buildQuanxSub, buildLoonSub,
  linesToList, isIP, base64ToBytes, bytesToBase64,
  parseIPEntry, ipToInt, intToIp, cidrToRange, randomIPsFromCIDRs,
  extractIPsFromSubText, parseNodeLink, safeDecode,
  pickHost, subExtraParams, detectSubFormat, SUB_FORMATS,
  grpcEncode, grpcDecode,
  socks5Greeting, socks5AuthRequest, socks5ConnectRequest, expandIPv6, socks5CheckReply,
  buildHttpConnectReq, indexOfSeq, chainAllows,
  clampPort, clampInt,
} from './_worker.js';
import { createHash, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n    got:  ${g}\n    want: ${w}`); }
}
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
}

console.log('[1] SHA-256 / SHA-224');
eq('sha256("")', bytesToHex(sha256Bytes('')), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
eq('sha256("abc")', bytesToHex(sha256Bytes('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
eq('sha224 cross-check ("")', trojanPasswordHash(''), createHash('sha224').update('').digest('hex'));
eq('sha224 cross-check ("trojan-pw-123")', trojanPasswordHash('trojan-pw-123'), createHash('sha224').update('trojan-pw-123').digest('hex'));

console.log('[2] ChaCha20-Poly1305（RFC 8439 附录 A.5 AEAD 向量 + node:crypto 交叉验证）');
{
  // 附录 A.5：带 AAD 的完整 AEAD 解密向量（权威 RFC 文本）
  const key = hexToBytes('1c9240a5eb55d38af333888604f6b5f0473917c1402b80099dca5cbc207075c0');
  const nonce = hexToBytes('000000000102030405060708');
  const aad = hexToBytes('f33388860000000000004e91');
  const ct = hexToBytes(
    '64a0861575861af460f062c79be643bd' + '5e805cfd345cf389f108670ac76c8cb2' +
    '4c6cfc18755d43eea09ee94e382d26b0' + 'bdb7b73c321b0100d4f03b7f355894cf' +
    '332f830e710b97ce98c8a84abd0b9481' + '14ad176e008d33bd60f982b1ff37c855' +
    '9797a06ef4f0ef61c186324e2b350638' + '3606907b6a7c02b0f9f6157b53c867e4' +
    'b9166c767b804d46a59b5216cde7a4e9' + '9040c5a40433225ee282a1b0a06c523e' +
    'af4534d7f83fa1155b0047718cbc546a' + '0d072b04b3564eea1b422273f548271a' +
    '0bb2316053fa76991955ebd63159434e' + 'cebb4e466dae5a1073a6727627097a10' +
    '49e617d91d361094fa68f0ff77987130' + '305beaba2eda04df997b714d6c6f2c29' +
    'a6ad5cb4022b02709b');
  const tag = hexToBytes('eead9d67890cbb22392336fea1851f38');
  const pt = chacha20Poly1305Decrypt(key, nonce, new Uint8Array([...ct, ...tag]), aad);
  ok('rfc8439 A.5 解密+验签', !!pt && new TextDecoder().decode(pt).startsWith('Internet-Drafts'));
  const bad = new Uint8Array([...ct, ...tag]); bad[bad.length - 1] ^= 1;
  eq('rfc8439 A.5 篡改 tag → null', chacha20Poly1305Decrypt(key, nonce, bad, aad), null);
  // 与 node:crypto 交叉验证（随机 key/nonce，空 AAD 与带 AAD 各一次）
  for (const withAad of [false, true]) {
    const k2 = randomBytes(32), n2 = randomBytes(12), p2 = randomBytes(200);
    const a2 = withAad ? randomBytes(12) : undefined;
    const mine = chacha20Poly1305Encrypt(k2, n2, p2, a2);
    const ref = (() => {
      const c = createCipheriv('chacha20-poly1305', k2, n2, { authTagLength: 16 });
      if (a2) c.setAAD(a2);
      return Buffer.concat([c.update(p2), c.final(), c.getAuthTag()]);
    })();
    eq(`cross-check node:crypto 加密（aad=${withAad}）`, bytesToHex(mine), ref.toString('hex'));
    const d = createDecipheriv('chacha20-poly1305', k2, n2, { authTagLength: 16 });
    if (a2) d.setAAD(a2);
    d.setAuthTag(mine.subarray(mine.length - 16));
    const refPt = Buffer.concat([d.update(mine.subarray(0, mine.length - 16)), d.final()]);
    eq(`cross-check node:crypto 解密（aad=${withAad}）`, Buffer.from(refPt).toString('hex'), Buffer.from(p2).toString('hex'));
  }
}

console.log('[3] HKDF-SHA1（ss-subkey 派生，与 node:crypto 对照）');
{
  const salt = randomBytes(16);
  const mine = await ssSubkey('test-password', salt, 16);
  const ref = hkdfSync('sha1', Buffer.from('test-password'), salt, 'ss-subkey', 16);
  eq('hkdf-sha1', bytesToHex(mine), Buffer.from(ref).toString('hex'));
}

console.log('[4] VLESS 头解析');
{
  const uuid = parseUUID('123e4567-e89b-12d3-a456-426614174000');
  const domain = new TextEncoder().encode('example.com');
  const hdr = new Uint8Array([0x00, ...uuid, 0x00, 0x01, 0x01, 0xbb, 0x02, domain.length, ...domain]);
  const r = parseVlessHeader(hdr, [uuid]);
  eq('vless tcp domain', [r.cmd, r.port, r.addr, r.headerLen], [1, 443, 'example.com', hdr.length]);
  // UDP + IPv4
  const h2 = new Uint8Array([0x00, ...uuid, 0x00, 0x02, 0x00, 0x35, 0x01, 8, 8, 8, 8]);
  const r2 = parseVlessHeader(h2, [uuid]);
  eq('vless udp ipv4', [r2.cmd, r2.port, r2.addr], [2, 53, '8.8.8.8']);
  // 数据不足 → null
  eq('vless short → null', parseVlessHeader(new Uint8Array([0x00, 0x01]), [uuid]), null);
  // UUID 不匹配 → 抛错
  let threw = false;
  try { parseVlessHeader(hdr, [new Uint8Array(16)]); } catch { threw = true; }
  ok('vless bad uuid throws', threw);
  // MUX → 抛错
  const h3 = new Uint8Array(hdr); h3[18] = 0x03;
  threw = false;
  try { parseVlessHeader(h3, [uuid]); } catch { threw = true; }
  ok('vless mux throws', threw);
}

console.log('[5] Trojan 头解析');
{
  const pw = 'my-trojan-password';
  const hash = trojanPasswordHash(pw);
  ok('trojan hash 长度 56', hash.length === 56);
  const head = new TextEncoder().encode(hash + '\r\n');
  const body = new Uint8Array([0x01, 0x01, 1, 2, 3, 4, 0x01, 0xbb, 0x0d, 0x0a, 0x99]);
  const buf = new Uint8Array([...head, ...body]);
  const r = parseTrojanHeader(buf, hash);
  eq('trojan tcp', [r.cmd, r.port, r.addr, r.headerLen], [1, 443, '1.2.3.4', buf.length - 1]);
  let threw = false;
  try { parseTrojanHeader(buf, '0'.repeat(56)); } catch { threw = true; }
  ok('trojan 密码错误抛错（常量时间比较）', threw);
  eq('trojan 数据不足 → null', parseTrojanHeader(new Uint8Array(10), hash), null);
}

console.log('[6] Shadowsocks AEAD 回环（三种 method）');
for (const method of Object.keys(SS_METHODS)) {
  const password = 'ss-test-pw';
  const enc = new SsEncryptor(method, password);
  const dec = new SsDecryptor(method, password);
  // 构造服务端首包明文：ATYP=IPv4 10.0.0.1:8080 + 载荷
  const payload = new TextEncoder().encode('hello-ss-payload');
  const first = new Uint8Array([0x01, 10, 0, 0, 1, 0x1f, 0x90, ...payload]);
  const wire = await enc.encrypt(first);
  // 分两次喂入，模拟 TCP 分片
  const cut = Math.floor(wire.length / 2);
  const p1 = await dec.push(wire.subarray(0, cut));
  const p2 = await dec.push(wire.subarray(cut));
  const all = new Uint8Array([...p1, ...p2]);
  eq(`ss ${method} 回环`, [bytesToHex(all.subarray(0, 7)), new TextDecoder().decode(all.subarray(7))],
    [bytesToHex(first.subarray(0, 7)), 'hello-ss-payload']);
  // 反方向加密（服务端→客户端）也能被解密器解开
  const enc2 = new SsEncryptor(method, password);
  const dec2 = new SsDecryptor(method, password);
  const w2 = await enc2.encrypt(new TextEncoder().encode('server-reply'));
  eq(`ss ${method} 反向回环`, new TextDecoder().decode(await dec2.push(w2)), 'server-reply');
}

console.log('[7] 国旗 / 国名映射');
eq('flag US', countryFlag('US'), '🇺🇸');
eq('flag hk（小写）', countryFlag('hk'), '🇭🇰');
eq('flag 未知', countryFlag('XX'), '🌐');
eq('flag 空', countryFlag(''), '🌐');
eq('name US', countryNameOf('US'), '美国');
eq('name HK', countryNameOf('HK'), '香港');
eq('name TW', countryNameOf('TW'), '台湾');
eq('name 未知', countryNameOf('ZZ'), '未知');

console.log('[8] 节点命名：分组排序 + 全局序号');
{
  const ips = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'];
  const geo = { '1.1.1.1': 'US', '2.2.2.2': 'HK', '3.3.3.3': null, '4.4.4.4': 'US' };
  const nodes = buildNodeNames(ips, geo);
  eq('节点名', nodes.map((n) => n.name), ['🇭🇰 香港 01', '🇺🇸 美国 02', '🇺🇸 美国 03', '🌐 未知 04']);
}

console.log('[9] 订阅拼装');
{
  const nodes = [{ ip: '1.1.1.1', code: 'US', name: '🇺🇸 美国 01' }];
  const cfg = { UUID: '123e4567-e89b-12d3-a456-426614174000', trojanPassword: 'tpw', ssPassword: 'spw', ssMethod: 'aes-128-gcm', nodePort: 443 };
  const host = 'example.workers.dev';
  const v = buildVlessUri(nodes[0], cfg.UUID, cfg.nodePort, host);
  ok('vless uri 格式', v === `vless://${cfg.UUID}@1.1.1.1:443?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=%2F${cfg.UUID}#${encodeURIComponent('🇺🇸 美国 01')}`);
  const t = buildTrojanUri(nodes[0], cfg.trojanPassword, cfg.nodePort, host);
  ok('trojan uri 含 /trojan', t.includes('path=%2Ftrojan') && t.startsWith('trojan://tpw@1.1.1.1:443?'));
  const s = buildSsUri(nodes[0], cfg.ssMethod, cfg.ssPassword, cfg.nodePort, host);
  ok('ss uri 含 plugin', s.startsWith('ss://') && s.includes('plugin='));
  const b64 = buildBase64Sub(nodes, cfg, host);
  const decoded = new TextDecoder().decode(base64ToBytes(b64));
  eq('base64 订阅 3 行', decoded.split('\n').length, 3);
  const clash = buildClashSub(nodes, cfg, host);
  ok('clash 含 vless/trojan/ss', clash.includes('type: vless') && clash.includes('type: trojan') && clash.includes('type: ss'));
  const sj = JSON.parse(buildSingboxSub(nodes, cfg, host));
  eq('singbox 3 outbounds', sj.outbounds.length, 3);
  eq('singbox 类型', sj.outbounds.map((o) => o.type), ['vless', 'trojan', 'shadowsocks']);
}

console.log('[10] 杂项');
eq('linesToList 去重去空', linesToList('a\n\nb\na\n c '), ['a', 'b', 'c']);
ok('isIP v4', isIP('1.2.3.4') && !isIP('999.1.1.1'));
ok('parseUUID 非法 → null', parseUUID('not-a-uuid') === null);
eq('clampPort 正常', clampPort(8080, 443), 8080);
eq('clampPort 非法回退', clampPort(99999, 443), 443);
eq('clampInt 越界钳制', clampInt(999, 0, 500, 16), 500);
eq('clampInt 非数字回退', clampInt('x', 0, 500, 16), 16);

console.log('[11] 单 IP 条目解析（IP / IP:端口 / IP#备注）');
eq('裸 IP', parseIPEntry('1.2.3.4'), { ip: '1.2.3.4', port: 0, remark: '' });
eq('IP:端口', parseIPEntry('1.2.3.4:2053'), { ip: '1.2.3.4', port: 2053, remark: '' });
eq('IP#备注', parseIPEntry('1.2.3.4#香港专线'), { ip: '1.2.3.4', port: 0, remark: '香港专线' });
eq('IP:端口#备注', parseIPEntry('1.2.3.4:2096#备注'), { ip: '1.2.3.4', port: 2096, remark: '备注' });
eq('IPv6 显式', parseIPEntry('[2001:db8::1]:443'), { ip: '2001:db8::1', port: 443, remark: '' });
eq('裸 IPv6 不拆端口', parseIPEntry('2001:db8::1').ip, '2001:db8::1');
eq('非法 → null', parseIPEntry('not-an-ip'), null);
eq('端口越界 → null', parseIPEntry('1.2.3.4:99999'), null);

console.log('[12] CIDR 与随机 IP');
eq('ipToInt/intToIp 回环', intToIp(ipToInt('104.16.0.1')), '104.16.0.1');
{
  const rg = cidrToRange('104.16.0.0/13');
  eq('cidr 起止', [intToIp(rg.start), intToIp(rg.end)], ['104.16.0.0', '104.23.255.255']);
  eq('cidr 非法 → null', cidrToRange('xxx'), null);
  // 确定性随机：序列 rand，保证抽到不同 IP
  let _s = 0; const seqRand = () => (_s = (_s + 0.37) % 1);
  const ips = randomIPsFromCIDRs(['104.16.0.0/24'], 2, seqRand);
  ok('随机 IP 落在段内', ips.length === 2 && ips.every((ip) => ip.startsWith('104.16.0.')));
  ok('随机 IP 去重', new Set(ips).size === ips.length);
}

console.log('[13] 订阅文本 IP 提取（sub:// 聚合用）');
{
  const v1 = 'vless://11111111-2222-3333-4444-555555555555@9.9.9.9:443?security=tls#US';
  const v2 = 'trojan://pw@8.8.4.4:443#HK';
  const b64 = Buffer.from([v1, v2].join('\n')).toString('base64');
  eq('整段 base64 订阅', extractIPsFromSubText(b64).sort(), ['8.8.4.4', '9.9.9.9']);
  eq('裸 IP 行', extractIPsFromSubText('1.1.1.1\n2.2.2.2 # 注释'), ['1.1.1.1', '2.2.2.2']);
  const vmess = 'vmess://' + Buffer.from(JSON.stringify({ add: '7.7.7.7', port: 443, id: 'x' })).toString('base64');
  eq('vmess add 字段', extractIPsFromSubText(vmess), ['7.7.7.7']);
}

console.log('[14] 外部节点链接解析（?sub= 聚合用）');
{
  const v = parseNodeLink('vless://11111111-2222-3333-4444-555555555555@9.9.9.9:443?security=tls#%E7%BE%8E%E5%9B%BD');
  eq('vless 解析', [v.proto, v.server, v.port, v.name], ['vless', '9.9.9.9', 443, '美国']);
  const t = parseNodeLink('trojan://pw@8.8.4.4:8443#HK');
  eq('trojan 解析', [t.proto, t.server, t.port], ['trojan', '8.8.4.4', 8443]);
  const up = Buffer.from('aes-128-gcm:mypw').toString('base64');
  const s = parseNodeLink(`ss://${up}@6.6.6.6:8388#ssnode`);
  eq('ss 解析', [s.proto, s.method, s.password, s.server], ['ss', 'aes-128-gcm', 'mypw', '6.6.6.6']);
  eq('非法 → null', parseNodeLink('https://example.com'), null);
  eq('safeDecode 坏编码不抛', safeDecode('%zz'), '%zz');
}

console.log('[15] 多 HOST 轮换 / 订阅参数 / 格式识别');
{
  const cfg = { hosts: ['a.com', 'b.com'] };
  eq('pickHost 轮换', [pickHost(cfg, 'x.com', 0), pickHost(cfg, 'x.com', 1), pickHost(cfg, 'x.com', 2)], ['a.com', 'b.com', 'a.com']);
  eq('pickHost 空 hosts 用请求 host', pickHost({ hosts: [] }, 'x.com', 5), 'x.com');
  eq('subExtraParams 全开', subExtraParams({ earlyData: true, fragment: true }), '&ed=2048&fragment=1,40-60,30-50,tlshello');
  eq('subExtraParams 全关', subExtraParams({}), '');
  const mkReq = (url, ua) => ({ url, headers: new Headers(ua ? { 'user-agent': ua } : {}) });
  eq('target 参数', detectSubFormat(mkReq('https://x/s?target=surge', ''), null), 'surge');
  eq('target mixed→base64', detectSubFormat(mkReq('https://x/s?target=mixed', ''), null), 'base64');
  eq('显式路径优先', detectSubFormat(mkReq('https://x/s?target=surge', ''), 'clash'), 'clash');
  eq('UA clash', detectSubFormat(mkReq('https://x/s', 'ClashforWindows/1.0'), null), 'clash');
  eq('UA sing-box', detectSubFormat(mkReq('https://x/s', 'sing-box 1.9'), null), 'singbox');
  eq('UA surge', detectSubFormat(mkReq('https://x/s', 'Surge iOS/5'), null), 'surge');
  eq('UA quantumult', detectSubFormat(mkReq('https://x/s', 'Quantumult%20X'), null), 'quanx');
  eq('UA loon', detectSubFormat(mkReq('https://x/s', 'Loon/3.0'), null), 'loon');
  eq('默认 base64', detectSubFormat(mkReq('https://x/s', 'curl/8.0'), null), 'base64');
  ok('SUB_FORMATS 6 种', SUB_FORMATS.length === 6);
}

console.log('[16] surge / quanx / loon 订阅拼装');
{
  const nodes = [{ ip: '1.1.1.1', port: 0, code: 'US', name: '🇺🇸 美国 01' }];
  const cfg = { UUID: '123e4567-e89b-12d3-a456-426614174000', trojanPassword: 'tpw', ssPassword: 'spw', ssMethod: 'aes-128-gcm', nodePort: 443, hosts: [] };
  const host = 'example.workers.dev';
  const surge = buildSurgeSub(nodes, cfg, host);
  ok('surge 含 vless 行', surge.includes('= vless, 1.1.1.1, 443, username='));
  ok('surge 含 Proxy Group', surge.includes('[Proxy Group]'));
  const qx = buildQuanxSub(nodes, cfg, host);
  ok('quanx vless 行', qx.includes('vless=1.1.1.1:443, method=none'));
  ok('quanx trojan 行', qx.includes('trojan=1.1.1.1:443, password=tpw'));
  const loon = buildLoonSub(nodes, cfg, host);
  ok('loon VLESS 行', loon.includes('= VLESS,1.1.1.1,443,'));
  // 单 IP 端口覆盖
  const n2 = [{ ip: '2.2.2.2', port: 2053, code: 'HK', name: '🇭🇰 香港 01' }];
  ok('单 IP 端口进 surge', buildSurgeSub(n2, cfg, host).includes('2.2.2.2, 2053'));
  // 多 HOST 轮换进订阅
  const cfg2 = { ...cfg, hosts: ['h1.com', 'h2.com'] };
  const qx2 = buildQuanxSub([...nodes, ...n2], cfg2, host);
  ok('多 HOST 轮换', qx2.includes('sni=h1.com') && qx2.includes('sni=h2.com'));
}

console.log('[17] gRPC 帧编解码');
{
  const p1 = new TextEncoder().encode('hello');
  const p2 = new TextEncoder().encode('world!');
  const enc = grpcEncode([p1, p2]);
  eq('帧头', [...enc.subarray(0, 5)], [0, 0, 0, 0, 5]);
  const { frames, rest } = grpcDecode(enc);
  eq('解出 2 帧', frames.length, 2);
  eq('帧内容', new TextDecoder().decode(Buffer.concat(frames.map((f) => Buffer.from(f)))), 'helloworld!');
  eq('无尾巴', rest.length, 0);
  const partial = enc.subarray(0, 7);
  const d2 = grpcDecode(partial);
  eq('不完整帧 → 等待', [d2.frames.length, d2.rest.length], [0, 7]);
  const bad = new Uint8Array([0, 255, 255, 255, 255]);
  eq('非法长度 → 停', grpcDecode(bad).frames.length, 0);
}

console.log('[18] SOCKS5 / HTTP 代理握手字节');
{
  eq('greeting 无认证', [...socks5Greeting(false)], [5, 1, 0]);
  eq('greeting 有认证', [...socks5Greeting(true)], [5, 2, 0, 2]);
  const auth = socks5AuthRequest('u', 'p');
  eq('auth 包头', [auth[0], auth[1], auth[3]], [1, 1, 1]);
  const cr = socks5ConnectRequest('example.com', 443);
  eq('connect 域名', [cr[0], cr[1], cr[2], cr[3], cr[4]], [5, 1, 0, 3, 11]);
  eq('connect 端口', [cr[cr.length - 2], cr[cr.length - 1]], [1, 187]);
  const cr4 = socks5ConnectRequest('1.2.3.4', 80);
  eq('connect IPv4', [...cr4.subarray(0, 8)], [5, 1, 0, 1, 1, 2, 3, 4]);
  ok('checkReply 通过', socks5CheckReply(new Uint8Array([5, 0]), 2));
  ok('checkReply 拒绝', !socks5CheckReply(new Uint8Array([5, 2]), 2));
  const v6 = expandIPv6('2001:db8::1');
  eq('IPv6 展开长度', v6.length, 16);
  eq('IPv6 首尾', [v6[0], v6[1], v6[14], v6[15]], [0x20, 0x01, 0, 1]);
  const hc = buildHttpConnectReq('a.com', 443, 'u', 'p');
  ok('http connect 含认证头', hc.startsWith('CONNECT a.com:443 HTTP/1.1') && hc.includes('Proxy-Authorization: Basic '));
  eq('indexOfSeq 找到', indexOfSeq(new Uint8Array([1, 2, 13, 10, 3]), new Uint8Array([13, 10])), 2);
  eq('indexOfSeq 未找到', indexOfSeq(new Uint8Array([1, 2, 3]), new Uint8Array([9])), -1);
  eq('白名单空=全走', chainAllows({ chainWhitelist: [] }, 'x.com'), true);
  eq('白名单命中', chainAllows({ chainWhitelist: ['example.com'] }, 'sub.example.com'), true);
  eq('白名单未命中', chainAllows({ chainWhitelist: ['example.com'] }, 'other.com'), false);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
