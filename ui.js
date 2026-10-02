/* ============================================================================
 * 影梭 ShadowShuttle · 管理面板 UI（clean-room 手写实现）
 * ----------------------------------------------------------------------------
 * 本模块只负责「长什么样」：CSS、登录页 HTML、后台 HTML（含内联 <script>）。
 * 会被原样内联进 _worker.js 替换旧实现，因此三个导出函数的签名必须保持一致：
 *
 *   cssBase()            -> 全站 CSS 字符串（登录页 / 后台共用）
 *   loginPageHTML()      -> 登录页完整 HTML（含 <style> 与内联 <script>）
 *   adminPageHTML(sub)   -> 后台完整 HTML（含 <style> 与内联 <script>）
 *
 * 内联 <script> 的写法：把顶层函数 qrcodeSVG / loginApp / adminApp 经
 * Function.prototype.toString() 序列化后拼进 <script> 字符串。
 * 这样做的好处：客户端逻辑可以用正常的函数写法（含模板字符串），
 * 不用在模板字符串里再嵌套模板字符串；且这三个函数必须完全自包含，
 * 不能引用模块作用域的其它变量（序列化后在浏览器里独立运行）。
 *
 * 约束遵守情况：
 * - 无 CDN、无外部库；二维码编码器为手写实现（见 qrcodeSVG）
 * - 中文注释；`node --check ui.js` 可通过
 * ============================================================================ */


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
export function cssBase() {
  return `
:root{
  --bg:#f6f7f9; --card:#ffffff; --text:#151a23; --muted:#6b7280;
  --line:#e6e8ec; --accent:#2563eb; --accent-soft:#e9f0fd;
  --danger:#dc2626; --danger-soft:#fdf0f0; --ok:#16a34a;
  --radius:10px;
}
[data-theme="dark"]{
  --bg:#0c1016; --card:#141a24; --text:#e8ebf1; --muted:#98a1b3;
  --line:#232c3b; --accent:#2563eb; --accent-soft:#17294d;
  --danger:#f87171; --danger-soft:#2b1416; --ok:#34d399;
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
  padding:8px 18px;border-radius:8px;border:1px solid transparent;font:inherit;cursor:pointer;white-space:nowrap}
.btn-pri{background:var(--accent);color:#fff;font-weight:600}
.btn-pri:hover{filter:brightness(1.08)}
.btn-ghost{background:transparent;border-color:var(--line);color:var(--text)}
.btn-ghost:hover{border-color:var(--muted)}
.btn-danger-ghost{background:transparent;border-color:var(--danger);color:var(--danger)}
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
      var old = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(function () { btn.textContent = old; }, 1200);
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
    ['proxyIP', 't'], ['chainEnabled', 'b'], ['chainType', 'pill'], ['chainHost', 't'], ['chainPort', 'n'],
    ['chainUser', 't'], ['chainPass', 't'], ['chainWhitelist', 'ta'],
    ['hosts', 'ta'], ['nodePort', 'n'], ['subKey', 't'], ['earlyData', 'b'], ['fragment', 'b'],
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
    var rnd = srcN ? (parseInt(cfg.randIPCount, 10) || 0) : 0;
    $('stIpNum').textContent = stN + rnd;
    $('stIpSub').textContent = '静态 ' + stN + ' · 随机 ' + rnd + ' / 源';
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
    srow('🎲', '随机数量', fNum('randIPCount', '16'), '每个优选源随机抽取的 IP 数，默认 16') +
    srow('🔌', '随机端口', fNum('randIPPort', '443')) +
    '<div style="margin:10px 0 4px"><button class="btn btn-ghost btn-sm" id="srcTestBtn">🔍 验证优选源</button></div>' +
    '<div id="srcTestRes"></div>',
    true) +
  dCard('card-chain', '🔗', '出站与回落',
    srow('🛡️', '回落 IP', fText('proxyIP', '如 1.2.3.4'), '出站失败时回落重试一次') +
    srow('🔗', '链式代理', fTgl('chainEnabled'), '开启后出站经由下方的代理服务器') +
    srow('📡', '链式类型', fPills('chainType',
      [['socks5', 'socks5'], ['http', 'http'], ['https', 'https']])) +
    srow('🖥️', '链式地址', fText('chainHost', '代理服务器域名或 IP')) +
    srow('🔌', '链式端口', fNum('chainPort', '1080')) +
    srow('👤', '链式用户', fText('chainUser', '无认证可留空')) +
    srow('🔑', '链式密码', fPass('chainPass', '')) +
    srow('📋', '白名单', fArea('chainWhitelist', '每行一个域名', 3), '命中白名单的域名直连，不走链式代理') +
    '<div style="margin:10px 0 4px"><button class="btn btn-ghost btn-sm" id="chainTestBtn">🔍 检查链式代理</button></div>' +
    '<div id="chainTestRes"></div>') +
  dCard('card-sub', '📄', '订阅参数',
    srow('🌍', '订阅 HOST', fArea('hosts', '每行一个域名', 2), '多 HOST 轮换，订阅页可切换') +
    srow('🔌', '节点端口', fNum('nodePort', '443')) +
    srow('🗝️', '订阅 KEY', fText('subKey', '快速订阅路径 KEY'), '留空则使用默认订阅路径') +
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
