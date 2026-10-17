/* tests/parse.test.js — 在 Node 中直接验证 Markdown / RTF 解析器
   运行： node tests/parse.test.js            （使用 examples/ 样例）
   退出码 0 表示全部通过
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* --- 最小 DOM 垫片（util.js 只用到了很少的 DOM） --- */
const sandbox = {
  console,
  performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 },
  TextDecoder,
  TextEncoder,
  navigator: { userAgent: 'node-test' },
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] == null ? null : this._d[k]; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  },
  document: {
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute() { }, appendChild() { }, className: '', style: {} }),
    getElementById: () => null,
    body: { getAttribute: () => 'dark', classList: { add() { }, remove() { }, toggle() { } } },
    addEventListener() { },
    getElementsByTagName: () => [],
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: () => 0,
  // office.js 解 ZIP 用；Node 18+ 自带
  DecompressionStream: typeof DecompressionStream === 'function' ? DecompressionStream : undefined,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(file) {
  const code = fs.readFileSync(path.join(ROOT, 'js', file), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/' + file });
}
load('util.js');
load('md.js');
load('rtf.js');
load('office.js');

const DV = sandbox.DV;

/* --- 断言工具 --- */
let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg, extra) {
  if (cond) { pass++; return true; }
  fail++; failures.push(msg + (extra ? '\n      → ' + extra : ''));
  return false;
}
function has(hay, needle, msg) {
  return ok(String(hay).includes(needle), msg, '未找到: ' + JSON.stringify(needle) +
    '\n      实际片段: ' + JSON.stringify(String(hay).slice(0, 400)));
}
function strip(html) { return String(html).replace(/<[^>]*>/g, ''); }

const read = f => fs.readFileSync(path.join(ROOT, 'examples', f));

/* ================== Markdown ================== */
console.log('\n== Markdown 渲染 ==');
{
  const src = read('sample.md').toString('utf8');
  const r = DV.md.render(src, { highlight: true, toc: true, tocTitle: 'TOC' });
  const h = r.html;
  has(h, '<h1', 'H1 生成');
  has(h, '<h2', 'H2 生成');
  has(h, '<strong>', '粗体');
  has(h, '<em>', '斜体');
  has(h, '<del>', '删除线');
  has(h, '<mark>', '高亮 ==..==');
  has(h, '<code>', '行内代码');
  has(h, '<pre class="code lang-python"', '围栏代码块带语言');
  has(h, 'tok-key', '代码高亮关键字');
  has(h, '<table>', '表格');
  has(h, '<th style="text-align:center"', '表格居中对齐');
  has(h, '<blockquote>', '引用块');
  has(h, '<ol>', '有序列表');
  has(h, '<ul', '无序列表');
  has(h, 'type="checkbox" disabled checked', '任务列表已勾选');
  has(h, 'type="checkbox" disabled>', '任务列表未勾选（占位）');
  ok((h.match(/type="checkbox" disabled(?! checked)/g) || []).length >= 1, '存在未勾选的复选框');
  has(h, 'href="https://spec.commonmark.org/"', '链接');
  has(h, '<hr>', '分割线');
  ok(/md-toc/.test(r.tocHtml + h), '目录生成');
  ok(r.headings.length >= 4, '标题收集数量 ≥ 4，实际 ' + r.headings.length);
  ok(strip(h).includes('零依赖'), '正文文本存在');
}

{
  // 安全性：原始 HTML 必须转义
  const r = DV.md.render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
  ok(!r.html.includes('<script>'), 'Markdown 中的 <script> 被转义');
  ok(r.html.includes('&lt;script&gt;'), '转义为实体');
  ok(r.html.includes('&lt;img'), '裸 HTML 标签被转义');
}

/* ================== RTF ================== */
console.log('\n== RTF 渲染 ==');
{
  const src = read('sample-gbk.rtf').toString('latin1');
  const cp = parseInt(/\\ansicpg(\d+)/.exec(src)[1], 10);
  // 注入多字节解码器：RTF 解析器会先把连续 \'hh 字节合并后再调用
  const decodeHex = bytes => {
    if (typeof bytes === 'string') bytes = Uint8Array.from([parseInt(bytes, 16)]);
    return new TextDecoder('gb18030').decode(bytes);
  };
  const r = DV.rtf.parse(src, { decodeHex });
  const h = r.html, t = strip(h);

  ok(cp === 936, 'ansicpg 解析为 936，实际 ' + cp);
  has(h, 'rtf-body', '输出容器 class');
  has(h, 'font-weight:700', '粗体样式');
  has(h, 'font-style:italic', '斜体样式');
  has(h, 'text-decoration:underline', '下划线样式');
  has(h, 'line-through', '删除线样式');
  has(h, 'color:rgb(0,0,255)', '前景色 #1 = 蓝色');
  has(h, 'color:rgb(200,30,30)', '前景色 #2 = 红色');
  has(h, 'background-color:rgb(255,255,0)', '高亮色（\highlight3 → 黄底）');
  has(h, 'text-align:center', '居中对齐');
  has(t, 'DocViewer RTF 测试文档', '标题中文（GBK 转义解码）');
  has(t, '正常文本：', '正文中文');
  has(t, '加粗', '加粗中文片段');
  has(t, '蓝色文字', '蓝色文字中文');
  has(t, '第一项', '列表第一项');
  has(t, '第二项', '列表第二项');
  has(t, 'A\tB\tC', '制表符保留');
  has(t, '自动换行：', '长行文本');
  has(t, '2024 DocViewer Sample', '页脚文本');
  has(h, '<ul', '列表容器');

  ok(t.length > 100, '纯文本长度合理，实际 ' + t.length);
  ok(!/\\[a-z]+/.test(t), '纯文本中不含残留控制字', t.slice(0, 200));
  ok(r.stats.controlWords > 30, '统计控制字数量 > 30，实际 ' + r.stats.controlWords);
  ok(r.stats.paragraphs >= 8, '段落数 ≥ 8，实际 ' + r.stats.paragraphs);
  ok(r.stats.groups >= 6, '组数 ≥ 6，实际 ' + r.stats.groups);
  ok(r.fonts.some(f => f && /SimSun|Arial/.test(f.name || '')), '字体表解析出字体名');
  ok(r.colors.length >= 4, '颜色表 ≥ 4 项，实际 ' + r.colors.length);
}

{
  const src = read('sample-en.rtf').toString('utf8');
  const r = DV.rtf.parse(src);
  const t = strip(r.html);
  has(t, 'DocViewer Sample RTF', '英文标题');
  has(t, 'Regular text with bold, italic, underline', '英文正文（前段）');
  has(t, 'and strike.', '英文正文（后段，控制字后的空格保留）');
  has(t, 'Unicode escape: 中文', '\\uN 转义（含替代字符跳过）');
  has(strip(r.html), '中文', 'HTML 中包含 \\uN 解码结果');
  has(t, 'hex: éèè', "\\'e9 等十六进制转义");
  has(t, 'Special: “quoted”', '智能引号');
  has(t, '–', '短破折号');
  has(t, '—', '长破折号');
  has(strip(r.html), '100%', '转义百分号（\\% 字面输出）');
  has(t, '\u00A0nbsp', '\\~ 不换行空格');
  has(t, 'bullet one', '项目符号项一');
  has(t, 'bullet two', '项目符号项二');
  has(t, 'Right aligned line', '右对齐段落');
  has(t, '© 2024 DocViewer Sample', "CP1252 \\'a9 版权符号");
  has(r.html, 'text-align:right', '右对齐样式');
  ok(r.warnings.length === 0, '无警告，实际 ' + JSON.stringify(r.warnings));
}

{
  // 非法 RTF：不应抛异常
  const r = DV.rtf.parse('这不是 RTF 文件，只是一段普通文本。');
  ok(!!r && typeof r.html === 'string', '非 RTF 输入不抛异常');
  ok(r.warnings.length > 0, '给出“不是标准 RTF”的警告');
  has(strip(r.html), '这不是 RTF', '非 RTF 内容仍可读出为文本');
}

{
  // 空输入 / 截断输入
  for (const bad of ['', '{\\rtf1', '{\\rtf1\\ansi\\par', '{}', '{\\rtf1 foo \\b']) {
    let threw = false;
    try { DV.rtf.parse(bad); } catch (e) { threw = true }
    ok(!threw, '健壮性：不抛异常 → ' + JSON.stringify(bad.slice(0, 24)));
  }
}

/* ================== 颜色表：空项 = 自动色 ================== */
{
  // \colortbl;\red255\green255\blue255; → 第 0 项是自动色（继承），不能当黑色
  const src = '{\\rtf1\\ansi\\deff0{\\colortbl;\\red255\\green255\\blue255;}'
    + '\\cf0 自动色文字\\par \\cf1 白色文字\\par}';
  const r = DV.rtf.parse(src, {});
  const html = r.html || '';
  ok(!/color:\s*rgb\(0,\s*0,\s*0\)/.test(html), '自动色 (\\cf0) 不输出黑色');
  ok(/color:\s*rgb\(255,\s*255,\s*255\)/.test(html), '显式白色 (\\cf1) 正常输出');
  ok(html.indexOf('自动色文字') >= 0, '自动色文字仍在');

  // 显式黑色仍要输出（不误伤）：颜色表第 0 项是自动色，黑色在第 1 项
  const src2 = '{\\rtf1\\ansi{\\colortbl;\\red0\\green0\\blue0;}\\cf1 黑字\\par}';
  const r2 = DV.rtf.parse(src2, {});
  ok(/color:\s*rgb\(0,\s*0,\s*0\)/.test(r2.html || ''), '显式黑色仍输出');
}

/* ================== 链接/图片协议白名单（C23） ================== */
console.log('\n== 协议白名单 ==');
{
  const r = DV.md.render('[x](javascript:alert(1)) ![i](javascript:alert(1))\n\n'
    + '![d](data:text/html;base64,PHNjcmlwdD4=) ![ok](data:image/png;base64,iVBORw0KGgo=)\n\n'
    + '[rel](//evil.com) ![rel](//evil.com)');
  const h = r.html;
  ok(h.indexOf('href="javascript:') < 0, 'C23：javascript: 链接被降级');
  ok(h.indexOf('src="javascript:') < 0, 'C23：javascript: 图片被降级', h.slice(0, 200));
  ok(h.indexOf('src="data:text/html') < 0, 'C23：data:text/html 图片被降级');
  ok(h.indexOf('src="data:image/png') >= 0, 'C23：data:image/* 仍然放行');
  ok(h.indexOf('href="//evil.com"') < 0, 'C23：协议相对链接不再原样放行');
  ok(h.indexOf('https://evil.com') >= 0, 'C23：协议相对地址明确走 https');
}

/* ================== 写回往返（解析 → DOM → rebuildSource） ==================
   这一组是补回来的：以前三套测试全绿，但写回路径（P0 里的每一条）根本没被覆盖。 */
{
  const decode936 = b => new TextDecoder('gb18030').decode(b);
  const ent = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  /** 解析器产出的 HTML → htmlToRtf 能吃的节点树（只需 nodeType/tagName/childNodes/className） */
  function nodes(html) {
    const root = { nodeType: 1, tagName: '#root', childNodes: [], className: '',
      getAttribute() { return ''; }, querySelector() { return null; } };
    const stack = [root];
    const re = /<(\/)?([a-zA-Z0-9]+)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g;
    let m;
    while ((m = re.exec(html))) {
      const top = stack[stack.length - 1];
      if (m[1]) {
        const t = m[2].toUpperCase();
        for (let k = stack.length - 1; k > 0; k--) if (stack[k].tagName === t) { stack.length = k; break; }
      } else if (m[2]) {
        const cls = (/(?:^|\s)class="([^"]*)"/.exec(m[3] || '') || [])[1] || '';
        const el = {
          nodeType: 1, tagName: m[2].toUpperCase(), className: cls, childNodes: [],
          getAttribute: k => (k === 'class' ? cls : null), querySelector: () => null,
        };
        top.childNodes.push(el);
        if (['BR', 'HR', 'IMG', 'INPUT'].indexOf(el.tagName) < 0) stack.push(el);
      } else if (m[4] != null && m[4] !== '') {
        top.childNodes.push({ nodeType: 3, nodeValue: ent(m[4]) });
      }
    }
    return root;
  }
  /** 走一遍真实主路径：解析 → DOM → 拼回源文件 */
  function roundTrip(src, rawBytes) {
    const r = DV.rtf.parse(src, { decodeHex: decode936, softWrap: true });
    return DV.rtf.rebuildSource(src, nodes(r.html), rawBytes);
  }
  const parCount = s => (String(s).match(/\\par(?![a-z])/g) || []).length;
  const bulletCount = s => (String(s).match(/\\u8226/g) || []).length;

  console.log('\n== 写回往返 ==');
  {
    // P0-8：每保存一次就多一个空段落
    const src = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil A;}}'
      + '\\pard\\f0\\fs24 第一段\\par 第二段\\par 第三段\\par}';
    let cur = src;
    const n0 = parCount(src);
    let grew = false;
    for (let i = 0; i < 3; i++) {
      cur = roundTrip(cur);
      if (parCount(cur) !== n0) grew = true;
    }
    ok(!grew, 'P0-8：连续保存三次，\\par 数不变', n0 + ' → ' + parCount(cur));
    const rp = DV.rtf.parse(cur, { decodeHex: decode936, softWrap: true });
    ok(rp.stats.paragraphs === 3, 'P0-8：段落数仍是 3，实际 ' + rp.stats.paragraphs);
  }

  {
    // P0-9：正文首个 \uN / \bullet 被吞进前言 → 内容重复
    const src = '{\\rtf1\\ansi\\ansicpg936\\deff0\\u31532?\\u19968?\\u27573?\\par}';
    const out = roundTrip(src);
    const first = (out.match(/\\u31532/g) || []).length;
    ok(first === 1, 'P0-9：首个 \\uN 只出现一次，实际 ' + first, JSON.stringify(out));
    ok(out.indexOf('\\pard') >= 0, 'P0-9：前言与正文正确拼合');
  }

  {
    // P0-10：列表项保存后多出一个字面 •
    const src = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil A;}}'
      + '\\pard\\li720\\fi-360{\\pntext\\bullet\\tab}第一项\\par}';
    const r = DV.rtf.parse(src, { decodeHex: decode936, softWrap: true });
    const bulletsInDom = (r.html.match(/\u2022/g) || []).length;
    ok(bulletsInDom === 1, 'P0-10：解析后只有一个项目符号，实际 ' + bulletsInDom, r.html);
    const out = roundTrip(src);
    ok(bulletCount(out) === 1, 'P0-10：保存后项目符号数不变，实际 ' + bulletCount(out), JSON.stringify(out));
    const again = roundTrip(out);
    ok(bulletCount(out) === bulletCount(again), 'P0-10：再保存一次仍然只有一个');
  }

  {
    // P0-7：写回守卫必须认全 \headerl/\footerr/\field/\fldinst/\shpinst/\mmath
    const cases = ['headerl', 'headerr', 'footerl', 'footerr', 'field', 'fldinst',
      'shpinst', 'mmath', 'pict', 'footnote', 'annotation'];
    cases.forEach(w => {
      const hit = DV.rtf.unmodeledDestinations('{\\rtf1\\ansi{\\' + w + ' x}}');
      ok(hit.indexOf(w) >= 0, 'P0-7：守卫拦得住 \\' + w, JSON.stringify(hit));
    });
    const plain = DV.rtf.unmodeledDestinations('{\\rtf1\\ansi\\pard 普通正文\\par}');
    ok(plain.length === 0, 'P0-7：普通正文不被误拦', JSON.stringify(plain));
  }

  {
    // P0-6：前言按原始字节透传（GBK 字体名不再触发 latin1 编码失败）
    const head = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil\\fcharset134 ';
    const tail = ';}}\\pard\\f0\\fs24 正文\\par}';
    const bytes = [];
    // 「宋体」的 GBK 字节 = CB CE CC E5
    const rawName = [0xCB, 0xCE, 0xCC, 0xE5];
    for (const ch of head) bytes.push(ch.charCodeAt(0));
    rawName.forEach(b => bytes.push(b));
    for (const ch of tail) bytes.push(ch.charCodeAt(0));
    const raw = Uint8Array.from(bytes);
    const text = new TextDecoder('gb18030').decode(raw);
    const out = roundTrip(text, raw);
    // 写回串的每个字符都必须 ≤ 0xFF，才能按 latin1 逐字节还原
    let allByte = true;
    for (let i = 0; i < out.length; i++) if (out.charCodeAt(i) > 0xFF) { allByte = false; break; }
    ok(allByte, 'P0-6：写回串全部落在 latin1 范围内（可逐字节还原）');
    const prefix = out.slice(0, out.indexOf('\\pard'));
    const wantPrefix = Buffer.from(raw.subarray(0, raw.length)).toString('latin1');
    ok(prefix === wantPrefix.slice(0, prefix.length),
      'P0-6：前言与原始字节逐字节一致');
    ok(out.indexOf('\u5b8b\u4f53') < 0, 'P0-6：前言里的 GBK 字体名没有变成 Unicode 字符');
  }
}

/* ================== Office：ZIP / DOCX / Pages ================== */
{
  const zlib = require('zlib');

  /** 现造一个 ZIP（stored + deflate 两种都要能读） */
  function makeZip(entries) {
    const chunks = [], central = [];
    let offset = 0;
    entries.forEach(function (e) {
      const name = Buffer.from(e.name, 'utf8');
      const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
      const comp = e.deflate ? zlib.deflateRawSync(raw) : raw;
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4);
      lh.writeUInt16LE(e.deflate ? 8 : 0, 8);
      lh.writeUInt32LE(0, 14);
      lh.writeUInt32LE(comp.length, 18);
      lh.writeUInt32LE(raw.length, 22);
      lh.writeUInt16LE(name.length, 26);
      chunks.push(lh, name, comp);
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(e.deflate ? 8 : 0, 10);
      cd.writeUInt32LE(comp.length, 20);
      cd.writeUInt32LE(raw.length, 24);
      cd.writeUInt16LE(name.length, 28);
      cd.writeUInt32LE(offset, 42);
      central.push(cd, name);
      offset += lh.length + name.length + comp.length;
    });
    const cdBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat(chunks.concat([cdBuf, eocd])));
  }

  function finish() {
    console.log('\n---------------------------');
    console.log('通过 ' + pass + '   失败 ' + fail);
    if (failures.length) {
      console.log('\n失败明细:');
      failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
      process.exit(1);
    }
    console.log('全部通过 ✔');
  }

  if (typeof DecompressionStream !== 'function') {
    console.log('\n（这个 Node 没有 DecompressionStream，Office 用例跳过）');
    finish();
  } else {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    console.log('\n== Office 预览 ==');

    (async function () {
      // 1) 真实 Word 文件（python-docx 生成）
      const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'examples/sample.docx')));
      const r = await DV.office.renderDocx(bytes);
      const h = r.html;
      ok(h.indexOf('<h1') >= 0, 'DOCX：一级标题识别成 <h1>');
      ok(h.indexOf('DocViewer Word 样例') >= 0, 'DOCX：标题文字');
      ok(h.indexOf('<b>') >= 0 && h.indexOf('这一句加粗') >= 0, 'DOCX：加粗');
      ok(h.indexOf('<i>') >= 0 && h.indexOf('这一句斜体') >= 0, 'DOCX：斜体');
      ok(h.indexOf('<u>') >= 0, 'DOCX：下划线');
      ok(h.indexOf('<h2') >= 0, 'DOCX：二级标题');
      ok(/text-align:center/.test(h), 'DOCX：居中对齐');
      ok(/color:#c03030/.test(h), 'DOCX：显式文字颜色保留', h.slice(0, 300));
      // 默认「统一成阅读器的字体与字号」：不把文档自带的字体/字号写进正文
      ok(!/font-size:\s*13pt/.test(h), 'DOCX：默认不套用文档自带字号');
      ok(!/font-family:\s*"/.test(h.replace(/font-family:[^;"]*;?/g, m => m.indexOf('&quot;') >= 0 ? m : '')),
         'DOCX：默认不套用文档自带字体');
      const rk = await DV.office.renderDocx(bytes, { keepFonts: true });
      ok(/font-size:13pt/.test(rk.html), 'DOCX：打开开关后才套用文档字号');
      ok(h.indexOf('<ul') >= 0 && h.indexOf('第一项') >= 0, 'DOCX：项目符号列表');
      ok(h.indexOf('<table') >= 0 && (h.match(/<td/g) || []).length >= 6, 'DOCX：表格与单元格');
      ok(r.paragraphs >= 6, 'DOCX：段落计数 ' + r.paragraphs);
      ok(r.tables >= 1, 'DOCX：表格计数 ' + r.tables);
      const plain = DV.office.plainOf(h);
      ok(plain.indexOf('DocViewer Word 样例') >= 0 && plain.indexOf('表头1') >= 0,
         'DOCX：纯文本可用于复制 / 搜索');

      // 2) 现造的 ZIP：stored 与 deflate 都要能读
      const stored = makeZip([{ name: 'word/document.xml', data: '<x/>', deflate: false }]);
      const dir1 = DV.office.readZipDirectory(stored);
      ok(!!dir1['word/document.xml'], 'ZIP：能读出目录（stored）');
      const e1 = await DV.office.readEntry(stored, dir1, 'word/document.xml');
      ok(new TextDecoder().decode(e1) === '<x/>', 'ZIP：stored 条目读回原文');

      const body = '<w:document ' + W + '><w:body>'
        + '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题一</w:t></w:r></w:p>'
        + '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>加粗段</w:t></w:r>'
        + '<w:r><w:t xml:space="preserve"> 普通段</w:t></w:r></w:p>'
        + '<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>列表项</w:t></w:r></w:p>'
        + '<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>'
        + '<w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>'
        + '<w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
        + '<w:p/></w:body></w:document>';
      const zipped = makeZip([{ name: 'word/document.xml', data: body, deflate: true }]);
      const r2 = await DV.office.renderDocx(zipped);
      ok(r2.html.indexOf('标题一') >= 0 && /<h1/.test(r2.html), 'DOCX（deflate）：标题');
      ok(/<b>加粗段<\/b>/.test(r2.html), 'DOCX（deflate）：加粗', r2.html);
      ok(r2.html.indexOf('<li>') >= 0 && r2.html.indexOf('列表项') >= 0, 'DOCX（deflate）：列表项');
      ok(r2.html.indexOf('<table') >= 0 && r2.html.indexOf('<td>') >= 0, 'DOCX（deflate）：表格');
      ok(r2.html.indexOf('<br>') >= 0, 'DOCX（deflate）：空段落留了一个占位');

      // 2b) 图片：关系表 + word/media → data URL；主题色不能被当成黑色
      {
        const pngBytes = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64');
        const withImg = '<w:document ' + W + '><w:body>'
          + '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/>'
          + '<a:graphic><a:graphicData><a:pic><a:blip r:embed="rId7"/></a:pic></a:graphicData></a:graphic>'
          + '</wp:inline></w:drawing></w:r></w:p>'
          + '<w:p><w:r><w:rPr><w:color w:val="000000" w:themeColor="text1"/></w:rPr>'
          + '<w:t>跟随主题的正文</w:t></w:r></w:p>'
          + '<w:p><w:r><w:rPr><w:color w:val="C03030"/></w:rPr><w:t>显式红色</w:t></w:r></w:p>'
          + '</w:body></w:document>';
        const rels = '<?xml version="1.0"?><Relationships>'
          + '<Relationship Id="rId7" Type="image" Target="media/image1.png"/>'
          + '</Relationships>';
        const imgZip = makeZip([
          { name: 'word/document.xml', data: withImg, deflate: true },
          { name: 'word/_rels/document.xml.rels', data: rels, deflate: true },
          { name: 'word/media/image1.png', data: pngBytes, deflate: false },
        ]);
        const ri = await DV.office.renderDocx(imgZip);
        ok(/<img class="docx-img" src="data:image\/png;base64,/.test(ri.html),
           'DOCX：内嵌图片转成 data URL', ri.html.slice(0, 200));
        ok(/width:96px;height:48px/.test(ri.html), 'DOCX：图片按 EMU 还原成像素尺寸', ri.html);
        ok(ri.images === 1, 'DOCX：图片计数 ' + ri.images);
        ok(ri.html.indexOf('color:#000000') < 0,
           'DOCX：带 themeColor 的黑色不上色（深色主题下才不会看不见）');
        ok(/color:#c03030/.test(ri.html), 'DOCX：显式颜色仍然保留');
      }

      // 2c) 「标题 1」被当排版工具用在整段正文上时，不能排成巨型标题
      {
        const longText = '1. To protect your personal information in digital life, you had better '
          + 'not share your passwords with anyone online, or you will lose them.';
        const bodyDoc = '<w:document ' + W + '><w:body>'
          + '<w:p><w:pPr><w:pStyle w:val="标题 1"/></w:pPr><w:r><w:t>短标题</w:t></w:r></w:p>'
          + '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + longText + '</w:t></w:r></w:p>'
          + '<w:p><w:pPr><w:pStyle w:val="标题 2"/></w:pPr><w:r><w:t>Why learn languages?</w:t></w:r></w:p>'
          + '</w:body></w:document>';
        const rz = await DV.office.renderDocx(makeZip([
          { name: 'word/document.xml', data: bodyDoc, deflate: true },
        ]));
        ok(rz.html.indexOf('<h1>短标题</h1>') >= 0, 'DOCX：真正的短标题仍排成 h1', rz.html);
        ok(rz.html.indexOf(longText) >= 0 && rz.html.indexOf('<h1>' + longText) < 0,
           'DOCX：一百多字的「标题 1」按正文排（不会突然变大）', rz.html.slice(0, 240));
        ok(rz.html.indexOf('<h2>Why learn languages?</h2>') >= 0, 'DOCX：短标题 2 仍是 h2');
      }

      // 3) Pages：取文件里内嵌的预览图
      const jpg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
      const pagesZip = makeZip([
        { name: 'Index/Document.iwa', data: Buffer.from('iwa'), deflate: true },
        { name: 'preview.jpg', data: jpg, deflate: false },
      ]);
      const pv = await DV.office.pagesPreview(pagesZip);
      ok(!!pv && pv.mime === 'image/jpeg', 'Pages：找到内嵌预览图');
      ok(!!pv && pv.data.length === jpg.length && pv.data[0] === 0xFF, 'Pages：预览图字节正确');
      const noPv = await DV.office.pagesPreview(makeZip([{ name: 'Index/Document.iwa', data: 'x' }]));
      ok(noPv === null, 'Pages：没有预览图时返回 null（交给 Quick Look）');

      // 4) 不是 Office 文件：给一句人看得懂的错误
      let err = null;
      try { await DV.office.renderDocx(new Uint8Array([1, 2, 3, 4, 5])); } catch (e) { err = e; }
      ok(!!err && /不是有效的 ZIP/.test(err.message), 'Office：非 ZIP 输入给出可读错误',
         err && err.message);

      finish();
    })().catch(function (e) {
      fail++;
      failures.push('Office 用例抛异常: ' + (e && e.message));
      finish();
    });
  }
}
