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

/* ================== 汇总 ================== */
console.log('\n---------------------------');
console.log(`通过 ${pass}   失败 ${fail}`);
if (failures.length) {
  console.log('\n失败明细:');
  failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
  process.exit(1);
}
console.log('全部通过 ✔');
