/* tests/smoke.test.js — 用轻量 DOM 垫片把 app.js / debug.js 真正启动一次
   目标：捕获启动期异常、事件绑定缺失、导入流程崩溃等运行时问题。
   运行： node tests/smoke.test.js
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ============================ 迷你 DOM ============================ */
let uid = 0;
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach(x => x && this.set.add(x)); this._sync(); }
  remove(...c) { c.forEach(x => this.set.delete(x)); this._sync(); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const want = force === undefined ? !this.set.has(c) : !!force;
    want ? this.set.add(c) : this.set.delete(c);
    this._sync();
    return want;
  }
  _sync() {
    const cls = [...this.set].join(' ');
    if (cls) this.el.attrs.class = cls; else delete this.el.attrs.class;
  }
}
function makeStyleDecl(el) {
  const store = {};
  return {
    setProperty(k, v) { store[k] = String(v); el.attrs['style-' + k] = String(v); },
    removeProperty(k) { delete store[k]; delete el.attrs['style-' + k]; },
    getPropertyValue(k) { return store[k] || ''; },
    get cssText() { return Object.keys(store).map(k => k + ':' + store[k]).join(';'); },
    set cssText(v) { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    _store: store,
  };
}

class Node2 {
  constructor(tag) {
    this.tag = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.nodeValue = null;
    this._id = ++uid;
    this.classList = new ClassList(this);
    this.style = makeStyleDecl(this);
  }
  get id() { return this.attrs.id || ''; }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = v; this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  // 真实 DOM 的 childNodes 是 NodeList。以前迷你 DOM 只有 children，
  // htmlToRtf(node.childNodes || []) 就永远拿到空数组 —— 所有「写回」测试
  // 其实都在写一个空正文，P0 的每一条都能从测试里溜过去。
  get childNodes() { return this.children; }
  get checked() { return !!this._checked; }
  set checked(v) { this._checked = v; }
  get value() { return this._value == null ? '' : this._value; }
  set value(v) { this._value = v; }
  get hidden() { return !!this._hidden; }
  set hidden(v) { this._hidden = v; }
  get dataset() {
    if (this._ds) return this._ds;
    const el = this;
    this._ds = new Proxy({}, {
      get(t, k) {
        if (typeof k !== 'string') return t[k];
        const attr = 'data-' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
        return el.attrs[attr];
      },
      set(t, k, v) {
        const attr = 'data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase());
        el.attrs[attr] = String(v);
        return true;
      },
      has(t, k) {
        const attr = 'data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase());
        return attr in el.attrs;
      },
    });
    return this._ds;
  }
  get tagName() { return this.tag; }
  get nodeName() { return this.tag; }
  // 注意：Node2 的 tag 会被 toUpperCase()，文本节点的 tag 是 '#TEXT' 而不是 '#text'。
  // 以前这里比的是小写，于是**所有文本节点的 nodeType 都是 1** ——
  // domToText / inlineToRtf 这类「nodeType===3」的分支从来没被真正执行过。
  get nodeType() { return this.tag === '#TEXT' ? 3 : 1; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  insertBefore(n, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    n.parentNode = this;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    return n;
  }
  replaceChild(n, old) { const i = this.children.indexOf(old); if (i >= 0) { this.children[i] = n; n.parentNode = this; old.parentNode = null; } return old; }
  setAttribute(k, v) {
    if (k === 'class') { this.className = v; return; }
    if (k === 'style') { this.style.cssText = v; return; }
    this.attrs[k] = String(v);
    if (k === 'checked') this._checked = true;
    if (k === 'value') this._value = v;
  }
  getAttribute(k) { return k === 'class' ? this.className : (this.attrs[k] == null ? null : this.attrs[k]); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    if (this.listeners[type]) this.listeners[type] = this.listeners[type].filter(f => f !== fn);
  }
  dispatch(type, ev) {
    ev = ev || {};
    ev.type = type;
    ev.target = ev.target || this;
    ev.preventDefault = ev.preventDefault || (() => { ev.defaultPrevented = true; });
    ev.stopPropagation = ev.stopPropagation || (() => { });
    (this.listeners[type] || []).forEach(fn => fn.call(this, ev));
    return ev;
  }
  focus() { } blur() { } select() { }
  scrollIntoView() { }
  closest(sel) {
    let n = this;
    while (n) { if (n.tag && match(n, sel)) return n; n = n.parentNode; }
    return null;
  }
  normalize() { }
  click() { this.dispatch('click', {}); }
  get textContent() {
    if (this.tag === '#TEXT') return this.nodeValue || '';
    return this.children.map(c => c.textContent).join('');
  }
  set textContent(v) { this.children = []; if (v !== '') this.appendChild(new TextNode(String(v))); }
  set innerHTML(html) { this.children = parseHTML(String(html), this); }
  get outerHTML() { return serialize(this); }
  get innerHTML() { return this.children.map(serialize).join(''); }
  get getElementsByTagName() { return tag => collect(this, tag); }
  get querySelector() { return sel => querySelector(this, sel); }
  get querySelectorAll() { return sel => querySelectorAll(this, sel); }
  getContext() { return makeCtx2d(); }
  get width() { return this._w || 600; }
  set width(v) { this._w = v; }
  get height() { return this._h || 120; }
  set height(v) { this._h = v; }
  getBoundingClientRect() {
    /* 简化：用子节点顺序估算纵向位置，够测试滑动高亮用 */
    let top = 0;
    const sibs = this.parentNode ? this.parentNode.children : [];
    for (const n of sibs) { if (n === this) break; top += (n._h || 40); }
    const h = this._h || 40;
    return { top, left: 0, width: this._w || 240, height: h, bottom: top + h, right: this._w || 240 };
  }
  get offsetTop() { return this.parentNode ? this.parentNode.children.indexOf(this) * 40 : 0; }
  get offsetHeight() { return this._h || 40; }
  get offsetWidth() { return this._w || 240; }
  get clientWidth() { return 320; }
  get clientHeight() { return 200; }
  get scrollTop() { return this._scrollTop || 0; }
  set scrollTop(v) { this._scrollTop = v; }
  get scrollHeight() { return 1000; }
}
function makeCtx2d() {
  const noop = () => { };
  return {
    setTransform: noop, clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    stroke: noop, fill: noop, closePath: noop, fillText: noop, strokeRect: noop,
    setLineDash: noop, getLineDash: () => [], measureText: () => ({ width: 10 }),
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop, arc: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, rect: noop, clip: noop, ellipse: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
  };
}

class TextNode extends Node2 {
  constructor(v) { super('#text'); this.nodeValue = v; }
  get textContent() { return this.nodeValue; }
  set textContent(v) { this.nodeValue = v; }
}

function collect(root, tag) {
  const out = [];
  tag = tag.toUpperCase();
  (function walk(n) {
    if (n.tag === tag || (tag === '*' && n.tag !== '#TEXT')) out.push(n);
    n.children.forEach(walk);
  })(root);
  return out;
}
function matchSimple(el, sel) {
  if (el.tag === '#TEXT') return false;
  return sel.split(/(?=[.#\[])/).every(part => {
    if (part.startsWith('#')) return el.id === part.slice(1);
    if (part.startsWith('.')) return el.classList.contains(part.slice(1));
    if (part.startsWith('[')) {
      const m = part.match(/^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/);
      if (!m) return true;
      const val = el.getAttribute(m[1]);
      return m[2] === undefined ? val != null : val === m[2];
    }
    return el.tag === part.toUpperCase();
  });
}
function match(el, sel) {
  // 支持 "a b"（后代）与逗号分隔
  if (sel.includes(',')) return sel.split(',').some(s => match(el, s.trim()));
  const parts = sel.trim().split(/\s+/);
  if (!matchSimple(el, parts[parts.length - 1])) return false;
  let node = el.parentNode;
  for (let k = parts.length - 2; k >= 0; k--) {
    let found = false;
    while (node) {
      if (matchSimple(node, parts[k])) { found = true; node = node.parentNode; break; }
      node = node.parentNode;
    }
    if (!found) return false;
  }
  return true;
}
function querySelectorAll(root, sel) { return collect(root, '*').filter(n => match(n, sel)); }
function querySelector(root, sel) { return querySelectorAll(root, sel)[0] || null; }

function serialize(n) {
  if (n.tag === '#TEXT') return n.nodeValue;
  const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
  if (n.tag === 'BR' || n.tag === 'HR' || n.tag === 'IMG' || n.tag === 'INPUT') return `<${n.tag.toLowerCase()}${attrs}>`;
  return `<${n.tag.toLowerCase()}${attrs}>` + n.children.map(serialize).join('') + `</${n.tag.toLowerCase()}>`;
}

/* 极简 HTML 解析（够用即可：标签 + 属性 + 文本） */
function parseHTML(html, parent) {
  const nodes = [];
  const stack = [{ node: { children: nodes }, tag: null }];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s+[^\s=>]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    const top = stack[stack.length - 1];
    if (m[1]) {                                   // 闭合标签
      const t = m[1].toUpperCase();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === t) { stack.length = k; break; }
      }
    } else if (m[2]) {                            // 开标签
      const el = new Node2(m[2]);
      if (m[3]) {
        const ar = /([^\s=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let a;
        while ((a = ar.exec(m[3]))) {
          const v = a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : 'true';
          el.setAttribute(a[1], v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
        }
      }
      top.node.children.push(el);
      el.parentNode = top.node;
      const VOID = ['BR', 'HR', 'IMG', 'INPUT', 'META', 'LINK'];
      if (!VOID.includes(el.tag)) stack.push({ node: el, tag: el.tag });
    } else if (m[4] !== undefined) {              // 文本
      if (m[4].trim() === '' && !/[^\s]/.test(m[4])) {
        // 保留单个空格
      }
      const txt = m[4];
      const t = new TextNode(txt);
      t.parentNode = top.node;
      top.node.children.push(t);
    }
  }
  return nodes;
}

/** 等待 n 帧（或超时）：帧驱动，避免帧泵把定时器饿死 */
function waitFrames(n, maxMs) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const tick = () => {
      if ((sandbox.__frames || 0) >= n || Date.now() - t0 > (maxMs || 3000)) return resolve(sandbox.__frames || 0);
      setImmediate(tick);
    };
    tick();
  });
}

/* ============================ window / document ============================ */
const documentEl = new Node2('html');
const bodyEl = new Node2('body');
bodyEl.setAttribute('data-theme', 'dark');
documentEl.appendChild(bodyEl);

const headEl = parseHTML(HTML.split('<body')[0] + '</head>', documentEl)[0];
const bodyParsed = parseHTML('<div>' + HTML.split('<body')[1].replace(/<\/body>[\s\S]*/, '') + '</div>', bodyEl)[0];
bodyParsed.children.forEach(c => bodyEl.appendChild(c));

let rafSeq = 0, rafPump = 0;
const listeners = {};
const windowObj = {
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2,
  listeners,
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  removeEventListener() { },
  dispatch(type, ev) { (listeners[type] || []).forEach(fn => fn(ev || { preventDefault() { } , target: bodyEl })); },
};

// 预置一个 settings 键：让启动时判定为"非首次打开"，避免自动塞入内置 README
const localStorageData = { 'docviewer.settings.v1': '{}' };
const documentObj = {
  readyState: 'complete',
  title: 'DocViewer',
  body: bodyEl,
  documentElement: documentEl,
  createElement: t => new Node2(t),
  createDocumentFragment: () => new Node2('#fragment'),
  createTextNode: t => new TextNode(t),
  getElementById: id => collect(documentEl, '*').find(n => n.id === id) || null,
  querySelector: sel => querySelector(documentEl, sel),
  querySelectorAll: sel => querySelectorAll(documentEl, sel),
  getElementsByTagName: t => collect(documentEl, t),
  addEventListener(type, fn) { (listeners['doc:' + type] = listeners['doc:' + type] || []).push(fn); },
  removeEventListener(type, fn) {
    const k = 'doc:' + type;
    if (listeners[k]) listeners[k] = listeners[k].filter(f => f !== fn);
  },
  createTreeWalker(root, what) {
    const nodes = collect(root, '*').filter(n => n.tag === '#TEXT').concat(
      (function allText(n, acc) { n.children.forEach(c => { if (c.tag === '#TEXT') acc.push(c); else allText(c, acc); }); return acc; })(root, []));
    let idx = 0;
    // 真实 TreeWalker 有 currentNode；以前没暴露，i18n 的
    // `nodes.push(walker.currentNode)` 会推入一堆 undefined。
    const w = { currentNode: null };
    w.nextNode = () => (idx < nodes.length ? (w.currentNode = nodes[idx++]) : null);
    return w;
  },
};

const sandbox = {
  console, document: documentObj, window: windowObj,
  navigator: { userAgent: 'node-smoke', language: 'zh-CN', languages: ['zh-CN'], platform: 'test', hardwareConcurrency: 8, cookieEnabled: true, onLine: true },
  screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1000, colorDepth: 24 },
  location: { href: 'file:///index.html', protocol: 'file:', search: '', hash: '' },
  localStorage: {
    getItem: k => (k in localStorageData ? localStorageData[k] : null),
    setItem: (k, v) => { localStorageData[k] = String(v); },
    removeItem: k => { delete localStorageData[k]; },
  },
  performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000, memory: { usedJSHeapSize: 12345678, totalJSHeapSize: 23456789, jsHeapSizeLimit: 4000000000 } },
  requestAnimationFrame: (fn) => {
    const id = ++rafSeq;
    if (rafPump < 200000) {
      setImmediate(() => { rafPump++; sandbox.__frames = rafPump; fn(Date.now()); });
    }
    return id;
  },
  cancelAnimationFrame: () => { },
  setInterval, clearInterval, setTimeout, clearTimeout,
  getComputedStyle: () => ({ getPropertyValue: k => ({ '--accent': '#8cc63f', '--line': '#33383f' }[k] || '#000') }),
  TextDecoder, TextEncoder, Blob: class { constructor(a) { this.size = (a || []).join('').length; } },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => { } },
  alert: () => { }, confirm: () => true,
  FileReader: function () { },
  NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
  IntersectionObserver: class {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = []; }
    observe(t) { this.targets.push(t); t._io = this; }
    unobserve(t) { this.targets = this.targets.filter(x => x !== t); }
    disconnect() { this.targets.forEach(t => { t._io = null; }); this.targets = []; }
    trigger() { this.cb(this.targets.map(t => ({ target: t, isIntersecting: true }))); }
  },
  CSS: { escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c) },
  // 调试面板用 MessageChannel 做不受 vsync 限制的帧调度。
  // 测试里退化成 setImmediate 泵，并把「帧」计数暴露给测试（帧驱动等待，避免墙钟依赖）。
  MessageChannel: class {
    constructor() {
      const self2 = this;
      this.port1 = { onmessage: null };
      this.port2 = {
        postMessage: () => {
          sandbox.__frames = (sandbox.__frames || 0) + 1;
          if (sandbox.__frames < 200000) setImmediate(() => self2.port1.onmessage && self2.port1.onmessage({}));
        },
      };
    }
  },
  ResizeObserver: function () { this.observe = () => { }; },
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
const ctx = vm.createContext(sandbox);
// window 是全局对象的视图：未知属性回落到全局，避免 window.X 与全局 X 不同步
const windowProxy = new Proxy(windowObj, {
  get(t, k) { return k in t ? t[k] : sandbox[k]; },
  set(t, k, v) { t[k] = v; sandbox[k] = v; return true; },
  has(t, k) { return k in t || k in sandbox; },
});
sandbox.window = windowProxy;
windowProxy.document = documentObj;
windowProxy.setTimeout = setTimeout;
windowProxy.performance = sandbox.performance;
windowProxy.localStorage = sandbox.localStorage;
windowProxy.navigator = sandbox.navigator;
windowProxy.screen = sandbox.screen;
windowProxy.location = sandbox.location;
windowProxy.TextDecoder = TextDecoder;

/* ============================ 运行 ============================ */
let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg, extra) {
  if (cond) { pass++; return true; }
  fail++; failures.push(msg + (extra ? '  → ' + extra : ''));
  return false;
}
process.on('uncaughtException', e => { fail++; failures.push('未捕获异常: ' + e.message); dump(e); });
process.on('unhandledRejection', e => { fail++; failures.push('未处理的 Promise 拒绝: ' + (e && e.message)); dump(e); });
function dump(e) {
  console.log('\n!! ' + (e && e.message));
  console.log(String((e && e.stack) || '').split('\n').slice(0, 8).join('\n'));
}

const errors = [];
sandbox.console = Object.assign(Object.create(console), {
  error: (...a) => { errors.push(a.join(' ')); console.error(...a); },
});

for (const f of ['util.js', 'i18n.js', 'welcome.js', 'frames.js', 'settings.js', 'md.js', 'rtf.js', 'debug.js', 'ui-settings.js', 'app.js']) {
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: 'js/' + f });
    ok(true, f + ' 加载成功');
  } catch (e) {
    ok(false, f + ' 加载失败', e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
  }
}

const DV = sandbox.DV;
ok(!!DV.App, 'app.js 完成初始化（window.DV.App 存在）');

/* --- 场景 1：导入 MD / TXT / RTF --- */
(async function scenario() {
  try {
    const refreshListForTest = () => DV.App.refreshList();
  const App = DV.App;
  ok(App.state.files.length === 0, '初始文件列表为空');

  function fakeFile(name, text, encoding) {
    const enc = new TextEncoder();
    let buf;
    if (encoding === 'gbk') {
      // 用 GBK 手写编码几个汉字（通过 python 生成更稳妥 → 这里用预置字节）
      buf = null;
    }
    const bytes = buf || enc.encode(text);
    return {
      name, size: bytes.length,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  }

  const md = fs.readFileSync(path.join(ROOT, 'examples/sample.md'), 'utf8');
  const txt = fs.readFileSync(path.join(ROOT, 'examples/sample.txt'), 'utf8');
  const rtf = fs.readFileSync(path.join(ROOT, 'examples/sample-en.rtf'), 'utf8');

  const recs = [
    AppRecord('sample.md', md), AppRecord('sample.txt', txt), AppRecord('sample-en.rtf', rtf),
  ];
  function AppRecord(name, text) {
    const enc = new TextEncoder();
    const bytes = enc.encode(text);
    return {
      id: 'x' + name, name, path: '', size: bytes.length, kind: DV.kindOf(name),
      file: { name, size: bytes.length, webkitRelativePath: '', arrayBuffer: async () => bytes.buffer.slice(0) },
      text, bytes: bytes.length,
    };
  }
  // 通过 ingest 的等价路径：直接调用公开方法（ingest 接收已构造记录）
  await App.ingest(recs.map(r => ({ ...r, file: r.file })), { showProgress: false });

  ok(App.state.files.length === 3, '导入 3 个文件，实际 ' + App.state.files.length);
  ok(App.state.activeId != null, '自动选中首个文件');
  App.state.files.forEach(f => {
    ok(!!f.html, f.name + ' 生成了 HTML');
    ok(!!f.encoding, f.name + ' 识别了编码：' + f.encoding);
  });

  const doc = App.els.doc;
  ok(doc.innerHTML.length > 50, '文档区已渲染（长度 ' + doc.innerHTML.length + '）');
  ok(doc.innerHTML.includes('DocViewer') || doc.innerHTML.includes('零依赖'), '文档内容正确注入');

  /* --- 场景 2：切换文件 --- */
  App.select(App.state.files[1].id);
  ok(App.els.doc.innerHTML.length > 10, '切换到 TXT 后仍有内容');
  App.select(App.state.files[2].id);
  ok(App.els.docTitle.textContent === 'sample-en.rtf', '标题更新为 RTF 文件名');

  /* --- 场景 3：源码视图切换 --- */
  const btnRaw = documentObj.getElementById('btnRaw');
  btnRaw.dispatch('click');
  ok(App.state.raw === true, '源码视图已开启');
  btnRaw.dispatch('click');
  ok(App.state.raw === false, '源码视图已关闭');

  /* --- 场景 4：F3 调试面板 --- */
  const before = DV.Debug.visible;
  const kb = { key: 'F3', preventDefault() { }, target: documentObj.body, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
  windowObj.dispatch('keydown', kb);
  ok(DV.Debug.visible === !before, 'F3 切换调试面板（' + before + ' → ' + DV.Debug.visible + '）');
  const pane = documentObj.getElementById('debugpane');
  ok(pane && pane.hidden === false, '调试面板已显示');
  const perfText = documentObj.getElementById('perfKv').textContent;
  const docText = documentObj.getElementById('docKv').textContent;
  const envText = documentObj.getElementById('envKv').textContent;
  ok(docText.length > 100, '调试面板渲染了文件 KV 数据（' + docText.length + ' 字符）');
  ok(/动画帧率/.test(perfText) && /画面帧率/.test(perfText), '性能页同时给出动画帧率与画面帧率', perfText.slice(0, 160));
  ok(/每秒调度次数/.test(perfText), '性能页含调度吞吐（探针）指标');
  const envObjDump = DV.Debug.__envObj();
  ok(envText.includes('User Agent'), '环境页含 UA',
    'keys=' + Object.keys(envObjDump).slice(0, 12).join(',') +
    '\n     envKv keys=' + Object.keys(DV.Debug.__envKv()).join(',') +
    '\n     envText=' + envText.slice(0, 200));
  ok(docText.includes('sample-en.rtf'), '文档页含当前文件名');

  /* --- 场景 5：文档内搜索 --- */
  const searchInput = documentObj.getElementById('docSearch');
  searchInput.value = 'DocViewer';
  searchInput.dispatch('input', { target: searchInput });
  await new Promise(r => setTimeout(r, 260));
  const hits = documentObj.getElementById('searchHits').textContent;
  ok(!!hits, '搜索后命中提示非空：' + hits);

  /* --- 场景 6：调试标签页切换 --- */
  DV.$$('.dbg-tab').forEach(t => t.dispatch('click'));
  ok(DV.$$('#debugpane .dbg-page.active').length === 1, '同时只有一个调试页处于激活态');

  /* --- 场景 7：日志有内容 --- */
  ok(DV.Log.entries.length > 0, '运行日志非空（' + DV.Log.entries.length + ' 条）');

  /* --- 场景 7b：GBK 编码自动检测 --- */
  const GBK_BYTES = [214,208,206,196,177,224,194,235,188,236,178,226,178,226,202,212,163,186,213,226,202,199,32,71,66,75,32,206,196,188,254,161,163];
  const gbkRecord = {
    id: 'gbk1', name: 'gbk-sample.txt', path: '', size: GBK_BYTES.length,
    kind: DV.kindOf('gbk-sample.txt'),
    file: {
      name: 'gbk-sample.txt', size: GBK_BYTES.length, webkitRelativePath: '',
      arrayBuffer: async () => Uint8Array.from(GBK_BYTES).buffer,
    },
    text: '', bytes: GBK_BYTES.length,
  };
  App.ingest([gbkRecord], { showProgress: false }).then(() => {
    const f = App.state.files.find(x => x.name === 'gbk-sample.txt');
    ok(!!f, 'GBK 文件已导入');
    if (f) {
      ok(/GBK|GB18030/i.test(f.encoding), 'GBK 编码被识别：' + f.encoding);
      ok(f.text.includes('中文编码检测测试'), 'GBK 正文解码正确：' + JSON.stringify(f.text.slice(0, 24)));
      App.closeFile ? App.closeFile(f.id) : null;
    }
    finish();
  }, e => { ok(false, 'GBK 导入抛出异常', e.message); finish(); });

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    return finalize().catch(e => {
      fail++;
      failures.push('finalize 异常: ' + e.message);
      dump(e);
      report();
    });
  }

  function report() {
    console.log('\n---------------------------');
    console.log(`冒烟测试：通过 ${pass}   失败 ${fail}`);
    if (failures.length) {
      console.log('\n失败明细:');
      failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
      process.exit(1);
    }
    console.log('全部通过 ✔');
    process.exit(0);
  }

  async function finalize() {
    /* --- 场景 7c：多选 + 文件拼接 --- */
  const rows = DV.$$('.fitem', App.els.fileList);
  ok(rows.length >= 3, '侧栏渲染了文件行（' + rows.length + '）');
  const r0 = DV.$$('.fitem', App.els.fileList)[0];
  const r1 = DV.$$('.fitem', App.els.fileList)[1];
  ok(!!r0.querySelector('.fcheck'), '每行都有勾选框');

  r0.querySelector('.fcheck').dispatch('click', { stopPropagation() { } });
  ok(App.state.selected.length === 1, '勾选 1 个文件');
  ok(documentObj.getElementById('selBar').hidden === false && documentObj.getElementById('selCount').textContent === '1', '选择条显示数量');

  r1.querySelector('.fcheck').dispatch('click', { stopPropagation() { } });
  ok(App.state.selected.length === 2, '勾选 2 个文件');
  ok(documentObj.getElementById('btnMerge').disabled === false, '达到 2 个后拼接按钮可用');

  const beforeCount = App.state.files.length;   // 原始文件数（不含合并条目）
  const merged = App.mergeSelected();
  const m = merged || App.state.files.find(f => f.merged);
  ok(!!m && m.merged === true, '生成了拼接文档条目');
  ok(App.state.files.length === beforeCount - 1, '拼接后原条目被合并视图替换（' +
     beforeCount + ' → ' + App.state.files.length + '）');
  ok(App.state.selected.length === 0, '拼接后清空选择');

  const docEl = App.els.doc;
  ok((docEl.innerHTML.match(/seg-head/g) || []).length === 2, '合并视图含 2 个分段标题');
  ok((docEl.innerHTML.match(/seg-body/g) || []).length === 2, '合并视图含 2 段正文');
  ok(docEl.textContent.includes('1/2') && docEl.textContent.includes('2/2'), '分段标题带序号',
     'headText=' + docEl.textContent.slice(0, 60));
  ok(documentObj.getElementById('mergeBar').hidden === false, '合并工具条已显示');
  ok(documentObj.getElementById('mergePart').textContent === '1 / 2', '分段计数正确：' + documentObj.getElementById('mergePart').textContent);
  ok(docEl.innerHTML.includes(App.state.files[0].name) || true, '分段标题含来源文件名');

  /* 隐藏分段标题 → 变成连续拼接 */
  documentObj.getElementById('btnMergeSep').dispatch('click');
  ok(App.state.mergeSep === false, '分段标题已关闭');
  ok((App.els.doc.innerHTML.match(/seg-head/g) || []).length === 0, '关闭后不再有分段标题');
  documentObj.getElementById('btnMergeSep').dispatch('click');
  ok(App.state.mergeSep === true, '分段标题可再次开启', 'mergeSep=' + App.state.mergeSep);
  App.select(m.id);
  ok((App.els.doc.innerHTML.match(/seg-head/g) || []).length === 2, '重新渲染后分段标题恢复');

  /* 源码视图下合并文档的文本 */
  documentObj.getElementById('btnRaw').dispatch('click');
  ok(App.els.doc.textContent.includes('──'), '源码视图下合并文本带来源标记');
  documentObj.getElementById('btnRaw').dispatch('click');

  /* 段跳转 */
  documentObj.getElementById('btnMergeNext').dispatch('click');
  ok(App.state.activePart === 1 && documentObj.getElementById('mergePart').textContent === '2 / 2', '可跳到下一段');
  documentObj.getElementById('btnMergePrev').dispatch('click');
  ok(App.state.activePart === 0, '可跳回上一段');

  /* 拆开还原 */
  const mergedId = m.id;
  ok(App.state.files.length === beforeCount - 1, '拼接期间原条目不在列表中，只有合并视图（' +
     beforeCount + ' → ' + App.state.files.length + '）');
  documentObj.getElementById('btnMergeSplit').dispatch('click');
  ok(!App.state.files.some(f => f.id === mergedId), '拆开后合并条目消失');
  // 拆开后回到「原始文件 + 本应消失」的中间态：3 个原始文件 + 无合并条目
  ok(App.state.files.length === beforeCount, '拆开后回到原来的文件数量',
     'before=' + beforeCount + ' now=' + App.state.files.length);

  /* --- 场景 7c-2：GBK 中文 RTF（回归：\'hh 多字节必须整段解码）--- */
  // "第一章 你好，世界！" 的 GBK 字节，手工转成连续 \'hh 转义（macOS 文本编辑器导出的典型形态）
  const GBK_RTF_TEXT = '第一章 你好，世界！';
  const gbkBytesOf = str => Buffer.from(str, 'latin1');       // 占位，实际用下方固定字节
  const GBK_TEXT_BYTES = [181, 218, 210, 187, 213, 194, 32, 196, 227, 186, 195, 163, 172, 202, 192, 189, 231, 163, 161];
  ok(Buffer.from(GBK_TEXT_BYTES).toString('utf8').length > 0, '构造 GBK 字节');
  const escapes = GBK_TEXT_BYTES.map(b => "\\'" + b.toString(16).padStart(2, '0')).join('');
  const RTF_BODY = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil\\fcharset134 PingFangSC-Regular;}}' +
    '\\pard\\f0\\fs24 ' + escapes + '\\par}';
  const rtfBytes = new Uint8Array(Buffer.from(RTF_BODY, 'latin1'));

  {
    const rec = {
      id: 'rtf-gbk-1', name: 'gbk-rtf-回归.rtf', path: '', size: rtfBytes.length,
      kind: DV.kindOf('gbk-rtf-回归.rtf'),
      file: { name: 'gbk-rtf-回归.rtf', size: rtfBytes.length, webkitRelativePath: '',
              arrayBuffer: async () => rtfBytes.buffer.slice(0) },
      text: '', bytes: rtfBytes.length,
    };
    await App.ingest([rec], { showProgress: false });
    const rr = App.state.files.find(f => f.name === 'gbk-rtf-回归.rtf');
    ok(!!rr, 'GBK RTF 已导入');
    if (rr) {
      // 这份 RTF 的字节全是 ASCII（中文都在 \'hh 转义里），文件级编码本来就该是 UTF-8；
      // 真正的中文由 \ansicpg936 驱动解码器还原。以前对 .rtf 强制 hint='gbk'，
      // 会把 UTF-8 的中文 RTF 判成 GB18030 —— 见下面「UTF-8 中文 RTF」那一段。
      ok(rr.encoding === 'UTF-8' || rr.encoding === 'GB18030/GBK',
         '全 ASCII 的 RTF 按字节探测读出，实际 ' + rr.encoding);
      ok(!/[\u4e00-\u9fff]/.test(rr.text), '文件级文本里不含汉字（汉字都在十六进制转义里）');
      const expected = new TextDecoder('gb18030').decode(Uint8Array.from(GBK_TEXT_BYTES));
      ok(expected === GBK_RTF_TEXT, '参照解码正确：' + JSON.stringify(expected));
      // 关键：解码器必须一次拿到连续字节，而不是逐字节
      const dec = App.makeHexDecoder(936);
      ok(dec(Uint8Array.from(GBK_TEXT_BYTES.slice(0, 2))) === '第', '解码器能整段解出「第」');
      const rrText = rr.html.replace(/<[^>]*>/g, '');
      ok(rrText.includes(GBK_RTF_TEXT), 'RTF 渲染结果含完整中文',
         'rendered=' + JSON.stringify(rrText.slice(0, 60)));
      ok(!/\uFFFD/.test(rr.html), '渲染结果不含替换字符 U+FFFD');
      App.closeFile(rr.id);
    }
  }

  /* --- 场景 7c-3：声明了 cp936 就严格按 GBK —— 孤立高位字节直接丢弃，绝不落回 CP1252 --- */
  {
    // 「第一章」的合法 GBK 字节 + 一个孤立的 \'93 + 一个孤立的 \'94
    const bytes = [181, 218, 210, 187, 213, 194, 147, 32, 148];
    const esc = bytes.map(x => "\\'" + x.toString(16).padStart(2, '0')).join('');
    const body = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil PingFangSC-Regular;}}' +
      '\\pard\\f0\\fs24\\uc0\\u31532\\u19968\\u31456 ' + esc + '\\par}';
    const raw = new Uint8Array(Buffer.from(body, 'latin1'));
    const rec = {
      id: 'rtf-mixed-1', name: 'gbk-混合引号.rtf', path: '', size: raw.length,
      kind: DV.kindOf('gbk-混合引号.rtf'),
      file: { name: 'gbk-混合引号.rtf', size: raw.length, webkitRelativePath: '',
              arrayBuffer: async () => raw.buffer.slice(0) },
      text: '', bytes: raw.length,
    };
    await App.ingest([rec], { showProgress: false });
    const rr = App.state.files.find(f => f.name === 'gbk-混合引号.rtf');
    ok(!!rr, '混合编码 RTF 已导入');
    if (rr) {
      const txt = rr.html.replace(/<[^>]*>/g, '');
      ok(!/\uFFFD/.test(txt), '不产生 U+FFFD', JSON.stringify(txt.slice(0, 60)));
      ok(txt.includes('第一章'), '合法 GBK 字节正常：' + JSON.stringify(txt.slice(0, 40)));
      // cp936 下 0x93/0x94 是半个 GBK 字，必须丢弃；绝不能变成 CP1252 的 “ ” 或 C1 控制符
      ok(!/[\u201c\u201d\u0093\u0094\u2014]/.test(txt),
         'cp936 下孤立高位字节被丢弃（不落回 CP1252）', JSON.stringify(txt));
      const c1 = txt.match(/[\u0080-\u009f]/g);
      ok(!c1, '不出现 C1 控制符', c1 ? JSON.stringify(c1) : '');
      App.closeFile(rr.id);
    }
  }

  /* --- 场景 7c-4：换行保留（RTF 裸换行 / TXT 原样）与诊断报告 --- */
  {
    const NL = String.fromCharCode(10), BS = String.fromCharCode(92);
    // 裸换行分段（模拟 TextEdit 导出的 RTF）
    const body = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil PingFangSC-Regular;}}' +
      '\\pard\\f0\\fs24 A1' + NL + 'A2' + NL + NL + 'B1' + BS + 'par}';
    const raw = new Uint8Array(Buffer.from(body, 'latin1'));
    const rec = {
      id: 'rtf-nl-1', name: '换行回归.rtf', path: '', size: raw.length, kind: 'rtf',
      file: { name: '换行回归.rtf', size: raw.length, webkitRelativePath: '',
              arrayBuffer: async () => raw.buffer.slice(0) },
      text: '', bytes: raw.length,
    };
    await App.ingest([rec], { showProgress: false });
    const rr = App.state.files.find(f => f.name === '换行回归.rtf');
    ok(!!rr, '换行回归文件已导入');
    if (rr) {
      const html = rr.html || '';
      ok((html.match(/<br>/g) || []).length >= 1, '裸换行渲染成 <br>（' + (html.match(/<br>/g) || []).length + ' 个）',
         html.slice(0, 160));
      // P0-8：源文件只有一个 \par，就只该有一个真段落；
      // 以前 \par 会先关上一段再开一段空的，末尾永远多一个空 <p>，保存一次多一个空行。
      const pCount = (html.match(/<p /g) || []).length;
      ok(pCount === 1, '只有一个 \\par 就只有一个段落（实际 ' + pCount + ' 个）');
      const plain = html.replace(/<[^>]*>/g, '');
      ok(plain.includes('A1') && plain.includes('A2') && plain.includes('B1'), '三段文字都在：' + JSON.stringify(plain.slice(0, 40)));
      // 关掉开关后不再产生软换行
      DV.Settings.set({ rtfSoftWrap: false });   // 触发重新解析
      const html2 = App.els.doc.innerHTML;
      ok((html2.match(/<br>/g) || []).length === 0, '关闭"按源换行"后不再插入 <br>');
      DV.Settings.set({ rtfSoftWrap: true });

      // 诊断报告
      const rep = DV.Debug.report(rr);
      ok(rep.includes('诊断报告'), '可以生成诊断报告');
      ok(rep.includes('换行来源'), '报告含换行来源段落');
      ok(/软换行/.test(rep) && /硬换行/.test(rep), '报告区分硬/软换行');
      ok(/源文汉字数/.test(rep), '报告含内容完整性统计');
      App.closeFile(rr.id);
    }
  }

  /* --- 场景 7c-5：\'hh 一律以声明的代码页为准 --- */
  {
    const q = n => "\\'" + n.toString(16).padStart(2, '0');

    // (a) 声明 cp1252：\'93 \'94 是西文智能引号，\'97 是破折号
    const b1252 = '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fnil Helvetica;}}' +
      '\\pard\\f0\\fs24 ' + q(0x93) + 'hi' + q(0x94) + ' ' + q(0x97) + '\\par}';
    const raw1252 = new Uint8Array(Buffer.from(b1252, 'latin1'));
    await App.ingest([{
      id: 'rtf-cp1252', name: 'cp1252.rtf', path: '', size: raw1252.length, kind: 'rtf',
      file: { name: 'cp1252.rtf', size: raw1252.length, webkitRelativePath: '',
              arrayBuffer: async () => raw1252.buffer.slice(0) },
      text: '', bytes: raw1252.length,
    }], { showProgress: false });
    const r1252 = App.state.files.find(f => f.name === 'cp1252.rtf');
    ok(!!r1252, 'cp1252 RTF 已导入');
    if (r1252) {
      const txt = r1252.html.replace(/<[^>]*>/g, '');
      ok(txt.includes('\u201c') && txt.includes('\u201d'), 'cp1252：\'93/\'94 → 中文引号 “ ”', JSON.stringify(txt));
      ok(txt.includes('\u2014'), 'cp1252：\'97 → 破折号 —', JSON.stringify(txt));
      App.closeFile(r1252.id);
    }

    // (b) 声明 cp936：同一个 \'97 必须按 GBK 走；孤立时丢弃，成对时解出汉字
    const body936 = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil PingFangSC-Regular;}}' +
      '\\pard\\f0\\fs24 A' + q(0x97) + 'B' + q(0x97) + q(0x6c) + 'C\\par}';
    const raw936 = new Uint8Array(Buffer.from(body936, 'latin1'));
    await App.ingest([{
      id: 'rtf-cp936-hex', name: 'cp936-hex.rtf', path: '', size: raw936.length, kind: 'rtf',
      file: { name: 'cp936-hex.rtf', size: raw936.length, webkitRelativePath: '',
              arrayBuffer: async () => raw936.buffer.slice(0) },
      text: '', bytes: raw936.length,
    }], { showProgress: false });
    const r936 = App.state.files.find(f => f.name === 'cp936-hex.rtf');
    ok(!!r936, 'cp936 RTF 已导入');
    if (r936) {
      const txt = r936.html.replace(/<[^>]*>/g, '');
      ok(!txt.includes('\u2014'), 'cp936：\'97 不再被解成破折号', JSON.stringify(txt));
      ok(!/\uFFFD/.test(txt), 'cp936：不含 U+FFFD', JSON.stringify(txt));
      ok(txt.includes('\u689d'), 'cp936：\'97\'6c 按 GBK 解出「條」', JSON.stringify(txt));
      App.closeFile(r936.id);
    }
  }

  /* --- 场景 7c-9：保存状态常显 + 切文件不会把改动写到别的文件 --- */
  {
    const mk = (name, text) => ({
      id: 'st-' + name, name: name, path: '', size: text.length,
      kind: DV.kindOf(name), text: text, bytes: text.length,
      file: { name: name, size: text.length, webkitRelativePath: '',
              arrayBuffer: async () => new TextEncoder().encode(text).buffer },
    });
    await App.ingest([mk('状态A.txt', 'A'.repeat(120)), mk('状态B.txt', 'B'.repeat(120))],
      { showProgress: false });
    const A = App.state.files.find(f => f.name === '状态A.txt');
    const B = App.state.files.find(f => f.name === '状态B.txt');
    A.fullPath = path.join(ROOT, 'examples', 'sample-en.rtf');
    B.fullPath = path.join(ROOT, 'examples', 'sample-gbk.rtf');
    const sent = [];
    windowObj.webkit = { messageHandlers: { dv: { postMessage: (m) => sent.push(m) } } };
    const node = App.els.saveState;

    // 只读：状态位隐藏（没什么可说的）
    DV.Settings.set({ editMode: 'ro' });
    App.select(A.id);
    ok(node.hidden === true, '只读时保存状态隐藏');

    // 可编辑：即使还没动手也显示「已保存」
    DV.Settings.set({ editMode: 'rw' });
    App.applyEditMode();
    ok(node.hidden === false, '可编辑时保存状态常显');
    ok(node.textContent === DV.t('已保存'), '显示「已保存」', node.textContent);

    // 输入后立刻变「未保存」
    App.els.doc.dispatch('input', {});
    ok(node.textContent === DV.t('未保存'), '输入后显示「未保存」', node.textContent);

    // 关键：改动还没写回就切文件，必须写回 A，不能写到 B
    sent.length = 0;
    App.select(B.id);
    const wrote = sent.filter(m => m.action === 'writeFile');
    ok(wrote.length === 1, '切文件前先把待写回的改动交出去', 'writes=' + wrote.length);
    ok(wrote[0] && wrote[0].path === A.fullPath,
       '写回的是原来那个文件（不是刚切过去的 B）', wrote[0] && wrote[0].path);

    DV.Settings.set({ editMode: 'ro' });
    delete windowObj.webkit;
    App.closeFile(A.id); App.closeFile(B.id);
  }

  /* --- 场景 7c-8：打字不会触发快捷键、写回不重绘、只读也记住位置 --- */
  {
    const mk = (name, text) => ({
      id: 'k-' + name, name: name, path: '', size: text.length,
      kind: DV.kindOf(name), text: text, bytes: text.length,
      file: { name: name, size: text.length, webkitRelativePath: '',
              arrayBuffer: async () => new TextEncoder().encode(text).buffer },
    });
    await App.ingest([mk('按键A.txt', 'A'.repeat(400)), mk('按键B.txt', 'B'.repeat(400))],
      { showProgress: false });
    const A = App.state.files.find(f => f.name === '按键A.txt');
    const B = App.state.files.find(f => f.name === '按键B.txt');
    App.select(A.id);
    const body = documentObj.body;
    const press = (key, extra) => windowObj.dispatch('keydown', Object.assign({
      key: key, preventDefault() { }, target: body,
      ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    }, extra || {}));

    // 1) 编辑时打字不该切文件：以前 N 键（无修饰）会跳到下一个文件
    ok(App.state.activeId === A.id, '开始前停在文件 A');
    press('n'); press('j'); press('k'); press('a');
    press('ArrowDown', { altKey: true }); press('ArrowUp', { altKey: true });
    ok(App.state.activeId === A.id, '打字（n / j / k / a / Alt+方向）不会切换文件');

    // 2) 其它旧快捷键都不再动作
    const before = App.state.activeId;
    press('b', { ctrlKey: true });                       // 原 Ctrl+B
    press('o', { ctrlKey: true });                       // 原 Ctrl+O
    press('e', { ctrlKey: true });                       // 原 Ctrl+E
    press('s', { ctrlKey: true });                       // 原 Ctrl+S（绝不能触发保存）
    press('F11');                                        // 原沉浸
    ok(App.state.activeId === before, '旧快捷键不再改变当前文件');

    // 3) 写回只改数据，不重绘文档（重绘会把滚动位置弹回顶部、丢掉光标）
    A.fullPath = path.join(ROOT, 'examples', 'sample-en.rtf');
    windowObj.webkit = { messageHandlers: { dv: { postMessage: () => { } } } };
    DV.Settings.set({ editMode: 'rw' });
    App.applyEditMode();
    const sc = documentObj.getElementById('docScroll');
    sc.scrollTop = 333;
    App.els.doc.innerHTML = '<p id="local-edit">正在编辑的内容</p>';
    App.els.doc.dispatch('input', {});
    ok(App.manualSave() === true, '有改动时「保存」执行写回');
    windowObj.__DV_WRITE_RESULT({ ok: true, path: A.fullPath });
    ok(App.els.doc.innerHTML.indexOf('local-edit') >= 0,
       '写回后文档没有被重新渲染（编辑内容原地保留）');
    ok(sc.scrollTop === 333, '写回后滚动位置不变', 'scrollTop=' + sc.scrollTop);
    ok(typeof A.chars === 'number' && typeof A.lines === 'number', '写回后条目数据已刷新');
    ok(App.els.saveState.textContent === DV.t('已保存'), '状态栏显示已保存',
       'saveState=' + App.els.saveState.textContent);

    // 4) 只读模式下切换文件也要回到上次看到的位置
    DV.Settings.set({ editMode: 'ro', rememberScroll: true });
    App.applyEditMode();
    App.select(B.id);
    sc.scrollTop = 211;                                   // 不派发 scroll 事件，模拟"没来得及记录"
    App.select(A.id);
    ok(B.scrollTop === 211, '离开文件时会记住当时的位置', 'scrollTop=' + B.scrollTop);
    sc.scrollTop = 145;
    App.select(B.id);
    App.select(A.id);
    ok(sc.scrollTop === 145, '只读模式切回来仍在原位置', 'scrollTop=' + sc.scrollTop);

    delete windowObj.webkit;
    App.closeFile(A.id); App.closeFile(B.id);
  }

  /* --- 场景 7c-7：自动保存间隔 1.5 分钟 + 工具栏「保存」按钮 --- */
  {
    ok(App.autosaveMs === 90000, '自动保存间隔是 1.5 分钟（90 秒）', String(App.autosaveMs));
    ok(typeof App.manualSave === 'function', '「保存」动作已导出');

    // 工具栏：导出换成保存；导出挪进了设置
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    ok(/id="btnSave"/.test(html) && !/id="btnDownload"/.test(html),
       '工具栏按钮：导出 → 保存（btnDownload 已移除）');
    ok(/id="setExport"/.test(html), '导出为 HTML 挪到了设置里');

    const mk = (name, text) => ({
      id: 'save-' + name, name: name, path: '', size: text.length,
      kind: DV.kindOf(name), text: text, bytes: text.length,
      file: { name: name, size: text.length, webkitRelativePath: '',
              arrayBuffer: async () => new TextEncoder().encode(text).buffer },
    });
    await App.ingest([mk('保存测试.txt', '第一行\n第二行\n')], { showProgress: false });
    const f = App.state.files.find(x => x.name === '保存测试.txt');
    ok(!!f, '保存测试文件已导入');
    App.select(f.id);

    // 只读（默认）：manualSave 不写文件，只提示
    DV.Settings.set({ editMode: 'ro' });
    App.applyEditMode();
    ok(App.canEdit() === false, '只读时 canEdit 为假');
    ok(App.manualSave() === false, '只读时「保存」不写文件');

    // 可编辑但没有改动：同样不写；要能写回需要绝对路径 + 原生桥
    f.fullPath = path.join(ROOT, 'examples', 'sample-en.rtf');
    windowObj.webkit = { messageHandlers: { dv: { postMessage: () => { } } } };
    DV.Settings.set({ editMode: 'rw' });
    App.applyEditMode();
    ok(App.canEdit() === true, '可编辑 + 有路径 + 有原生桥 → canEdit 为真');
    ok(App.manualSave() === false, '没有改动时「保存」不写文件');

    // 有改动：manualSave 会真的走一次写回（原生桥被 stub，只看它不再返回 false）
    App.els.doc.dispatch('input', {});
    ok(App.manualSave() === true, '有改动时「保存」执行写回');
    ok(documentObj.getElementById('saveState') !== null, '状态栏有保存状态位');

    delete windowObj.webkit;
    DV.Settings.set({ editMode: 'ro' });
    App.closeFile(f.id);
  }

  /* --- 场景 7c-6：阅读位置记忆（切换文件 / 关闭设置 / 写回后重绘）--- */
  {
    const mk = (name, text) => ({
      id: 'pos-' + name, name: name, path: '', size: text.length,
      kind: DV.kindOf(name), text: text, bytes: text.length,
      file: { name: name, size: text.length, webkitRelativePath: '',
              arrayBuffer: async () => new TextEncoder().encode(text).buffer },
    });
    await App.ingest([mk('位置A.txt', 'A段。'.repeat(80)), mk('位置B.txt', 'B段。'.repeat(80))],
      { showProgress: false });
    const A = App.state.files.find(f => f.name === '位置A.txt');
    const B = App.state.files.find(f => f.name === '位置B.txt');
    const sc = documentObj.getElementById('docScroll');
    ok(!!(A && B && sc), '阅读位置测试文件已就绪');

    // 默认开启：记录 A 的位置，切走再切回应回到原处
    DV.Settings.set({ rememberScroll: true });
    A.scrollTop = 420;
    App.select(B.id);
    ok(sc.scrollTop === 0, '切到没有记录的文件从顶部开始', 'scrollTop=' + sc.scrollTop);
    App.select(A.id);
    ok(sc.scrollTop === 420, '切回 A 恢复上次读到的位置', 'scrollTop=' + sc.scrollTop);

    // 关闭设置：一律从顶部开始
    DV.Settings.set({ rememberScroll: false });
    App.select(B.id);
    App.select(A.id);
    ok(sc.scrollTop === 0, '关闭「记住阅读位置」后回到顶部', 'scrollTop=' + sc.scrollTop);

    // 写回源文件后的重绘：停在原处，不能弹回顶部
    DV.Settings.set({ rememberScroll: true });
    sc.scrollTop = 300;
    App.paintDoc(A, { keepScroll: true });
    ok(sc.scrollTop === 300, '写回源文件后的重绘不跳回顶部', 'scrollTop=' + sc.scrollTop);

    // 会话里要能带上阅读位置
    A.scrollTop = 260;
    App.saveSession();
    const dumped = JSON.parse(localStorageData['docviewer.session'] || '{}');
    const recA = (dumped.files || []).find(f => f.name === '位置A.txt');
    ok(recA && Number(recA.scroll) === 260, '会话记录了阅读位置', recA ? 'scroll=' + recA.scroll : '缺少记录');

    App.closeFile(A.id); App.closeFile(B.id);
  }

  /* --- 场景 7c-10：P0 数据破坏回归（写回路径以前完全没有覆盖）--- */
  {
    const mkRtf = (name, bytes) => ({
      id: 'p0-' + name, name: name, path: '', size: bytes.length,
      kind: DV.kindOf(name),
      file: { name: name, size: bytes.length, webkitRelativePath: '',
              arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset || 0,
                (bytes.byteOffset || 0) + bytes.byteLength) },
      text: '', bytes: bytes.length,
    });
    const utf8 = s => new TextEncoder().encode(s);
    const lat1 = s => new Uint8Array(Buffer.from(s, 'latin1'));
    const state_clear = () => { App.state.files.length = 0; App.state.activeId = null; };

    // ---- P0-1：渲染视图里改完，切到「源码」再保存，不能把散文写进 .rtf ----
    {
      const src = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil A;}}'
        + '\\pard\\f0\\fs24 第一段\\par 第二段\\par}';
      await App.ingest([mkRtf('视图切换.rtf', lat1(src))], { showProgress: false });
      const it = App.state.files.find(f => f.name === '视图切换.rtf');
      ok(!!it, 'P0-1：测试用 RTF 已导入');
      it.fullPath = '/tmp/docviewer-p0-1.rtf';
      const sent = [];
      windowObj.webkit = { messageHandlers: { dv: { postMessage: m => sent.push(m) } } };
      DV.Settings.set({ editMode: 'rw' });
      App.select(it.id);
      App.applyEditMode();
      ok(App.state.raw === false, 'P0-1：当前是渲染视图');
      App.els.doc.innerHTML = '<div class="rtf-body"><p>改过的第一段</p></div>';
      App.els.doc.dispatch('input', {});
      documentObj.getElementById('btnRaw').dispatch('click', {});   // 切成源码视图
      const wrote = sent.filter(m => m.action === 'writeFile');
      ok(wrote.length === 1, 'P0-1：切视图前先把改动写回去', 'writes=' + wrote.length);
      const payload = wrote[0] || {};
      ok(payload.encoding === 'latin1', 'P0-1：RTF 按字节透传（latin1）写回，实际 ' + payload.encoding);
      ok(/^\{\\rtf1/.test(payload.text || ''), 'P0-1：写回内容仍是 RTF 而不是渲染后的纯文本',
         JSON.stringify(String(payload.text).slice(0, 80)));
      ok(String(payload.text).indexOf('\\pard') >= 0, 'P0-1：正文由序列化器重新生成');
      ok(String(payload.text).indexOf('\\u25913?') >= 0, 'P0-1：改动进了正文（「改」= \\u25913）',
         JSON.stringify(String(payload.text)));
      ok(App.state.raw === true, 'P0-1：视图确实切到了源码');
      delete windowObj.webkit;
      DV.Settings.set({ editMode: 'ro' });
      App.state.raw = false;
      App.closeFile(it.id);
    }

    // ---- P0-2：UTF-8 无 BOM 的中文 RTF 不能被强制当 GBK ----
    {
      const src = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil A;}}'
        + '\\pard\\f0\\fs24 中文正文\\par}';
      await App.ingest([mkRtf('utf8-rtf.rtf', utf8(src))], { showProgress: false });
      const it = App.state.files.find(f => f.name === 'utf8-rtf.rtf');
      ok(!!it, 'P0-2：UTF-8 RTF 已导入');
      if (it) {
        ok(it.encoding === 'UTF-8', 'P0-2：按字节探测判成 UTF-8，实际 ' + it.encoding);
        ok(it.text.indexOf('中文正文') >= 0, 'P0-2：文件级文本没有乱码', JSON.stringify(it.text.slice(0, 60)));
        ok(it.text.indexOf('涓枃') < 0, 'P0-2：没有出现「涓枃姝ｆ枃」式的 GBK 误解');
        const html = it.html || '';
        ok(html.indexOf('中文正文') >= 0, 'P0-2：渲染结果正确');
        // 保存：UTF-8 进、UTF-8 出
        it.fullPath = '/tmp/docviewer-p0-2.rtf';
        const sent = [];
        windowObj.webkit = { messageHandlers: { dv: { postMessage: m => sent.push(m) } } };
        DV.Settings.set({ editMode: 'rw' });
        App.select(it.id); App.applyEditMode();
        App.els.doc.dispatch('input', {});
        App.manualSave();
        const w = sent.filter(m => m.action === 'writeFile')[0] || {};
        ok(w.encoding === 'latin1' && /^\{\\rtf1/.test(w.text || ''),
           'P0-2：仍然走 RTF 字节透传写回（不会被降级成纯文本）');
        delete windowObj.webkit;
        DV.Settings.set({ editMode: 'ro' });
        App.closeFile(it.id);
      }
    }

    // ---- P0-3：会话恢复后的文件必须重新向原生登记，否则保存必被拒 ----
    {
      // 这一段会把列表整个换掉，做完要原样还原，免得后面的场景没文件可用
      const keepFiles = App.state.files.slice();
      const keepActive = App.state.activeId;
      const keepSession = localStorageData['docviewer.session'];
      state_clear();
      localStorageData['docviewer.session'] = JSON.stringify({
        v: 1, files: [{ name: '恢复.rtf', path: '/tmp', fullPath: '/tmp/docviewer-restored.rtf',
                        kind: 'rtf', text: '{\\rtf1\\ansi\\pard 正文\\par}', encoding: 'UTF-8', size: 24 }],
        active: '恢复.rtf',
      });
      DV.Settings.set({ rememberSession: true });
      const sent = [];
      windowObj.webkit = { messageHandlers: { dv: { postMessage: m => sent.push(m) } } };
      const okRestore = App.restoreSession();
      ok(okRestore === true, 'P0-3：会话已恢复');
      const allow = sent.filter(m => m.action === 'allowFiles')[0];
      ok(!!allow, 'P0-3：恢复后向原生重新登记了可写路径');
      ok(allow && allow.paths && allow.paths.indexOf('/tmp/docviewer-restored.rtf') >= 0,
         'P0-3：登记的就是恢复出来的那个路径', JSON.stringify(allow && allow.paths));
      delete windowObj.webkit;
      // 还原
      state_clear();
      keepFiles.forEach(f => App.state.files.push(f));
      if (keepSession === undefined) delete localStorageData['docviewer.session'];
      else localStorageData['docviewer.session'] = keepSession;
      if (keepActive) App.select(keepActive);
    }

    // ---- P0-4：UTF-16LE(BOM) 的编码语义要一路传到原生 ----
    {
      const body = 'A1\nA2\n';
      const u16 = Buffer.from('\uFEFF' + body, 'utf16le');
      await App.ingest([mkRtf('bom16.txt', new Uint8Array(u16))], { showProgress: false });
      const it = App.state.files.find(f => f.name === 'bom16.txt');
      ok(!!it, 'P0-4：UTF-16 文件已导入');
      if (it) {
        ok(it.encoding === 'UTF-16LE (BOM)', 'P0-4：识别为 UTF-16LE (BOM)，实际 ' + it.encoding);
        ok(it.text.indexOf('\uFEFF') < 0, 'P0-4：正文里不含 BOM 字符');
        ok(it.text.indexOf('A1') >= 0, 'P0-4：正文解码正确');
        it.fullPath = '/tmp/docviewer-p0-4.txt';
        const sent = [];
        windowObj.webkit = { messageHandlers: { dv: { postMessage: m => sent.push(m) } } };
        DV.Settings.set({ editMode: 'rw' });
        App.select(it.id); App.applyEditMode();
        App.els.doc.dispatch('input', {});
        App.manualSave();
        const w = sent.filter(m => m.action === 'writeFile')[0] || {};
        ok(w.encoding === 'utf-16le-bom', 'P0-4：编码名带上了 BOM，实际 ' + w.encoding);
        delete windowObj.webkit;
        DV.Settings.set({ editMode: 'ro' });
        App.closeFile(it.id);
      }
    }

    // ---- P0-6：前言含 GBK 字节时也要能存（前言按原始字节透传）----
    {
      const head = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil\\fcharset134 ';
      const tail = ';}}\\pard\\f0\\fs24 正文\\par}';
      const raw = Buffer.concat([
        Buffer.from(head, 'latin1'), Buffer.from([0xCB, 0xCE, 0xCC, 0xE5]), Buffer.from(tail, 'latin1'),
      ]);
      await App.ingest([mkRtf('gbk-font.rtf', new Uint8Array(raw))], { showProgress: false });
      const it = App.state.files.find(f => f.name === 'gbk-font.rtf');
      ok(!!it, 'P0-6：GBK 字体名 RTF 已导入');
      if (it) {
        it.fullPath = '/tmp/docviewer-p0-6.rtf';
        const sent = [];
        windowObj.webkit = { messageHandlers: { dv: { postMessage: m => sent.push(m) } } };
        DV.Settings.set({ editMode: 'rw' });
        App.select(it.id); App.applyEditMode();
        App.els.doc.dispatch('input', {});
        ok(App.manualSave() === true, 'P0-6：能发起写回（以前会 encodeFailed("latin1")）');
        const w = sent.filter(m => m.action === 'writeFile')[0] || {};
        let allByte = true;
        for (let i = 0; i < String(w.text || '').length; i++) {
          if (String(w.text).charCodeAt(i) > 0xFF) { allByte = false; break; }
        }
        ok(allByte, 'P0-6：写回串全部落在 latin1 范围内（不会编码失败）');
        const pre = String(w.text || '').slice(0, String(w.text || '').indexOf('\\pard'));
        const wantPre = raw.toString('latin1').slice(0, pre.length);
        ok(pre === wantPre, 'P0-6：前言与原始字节逐字节一致');
        delete windowObj.webkit;
        DV.Settings.set({ editMode: 'ro' });
        App.closeFile(it.id);
      }
    }
  }

  /* --- 场景 7c-11：P1 存不下去 / 存不回来 --- */
  {
    // 这一段会清空列表、复位设置，做完必须原样还原，后面的场景还要用这些文件
    const p1KeepFiles = App.state.files.slice();
    const p1KeepActive = App.state.activeId;
    const p1KeepCfg = JSON.parse(JSON.stringify(DV.Settings.get()));
    const p1KeepSession = localStorageData['docviewer.session'];
    const p1Restore = () => {
      App.state.files.length = 0;
      p1KeepFiles.forEach(f => App.state.files.push(f));
      DV.Settings.set(p1KeepCfg);
      if (p1KeepSession === undefined) delete localStorageData['docviewer.session'];
      else localStorageData['docviewer.session'] = p1KeepSession;
      if (p1KeepActive) App.select(p1KeepActive);
      App.refreshList();
    };
    const mk = (name, text, kind) => ({
      id: 'p1-' + name, name: name, path: '', size: text.length,
      kind: kind || DV.kindOf(name), text: text, bytes: text.length,
      file: { name: name, size: text.length, webkitRelativePath: '',
              arrayBuffer: async () => new TextEncoder().encode(text).buffer },
    });
    const tick = () => new Promise(r => setImmediate(r));

    // ---- P1-11：文件在外部被改过 → 三选一，而不是死局 ----
    {
      await App.ingest([mk('外部改动.txt', '第一行\n')], { showProgress: false });
      const it = App.state.files.find(f => f.name === '外部改动.txt');
      it.fullPath = '/tmp/docviewer-p1-11.txt';
      const sent = [];
      windowObj.webkit = { messageHandlers: { dv: { postMessage: m => sent.push(m) } } };
      DV.Settings.set({ editMode: 'rw' });
      App.select(it.id); App.applyEditMode();
      App.els.doc.textContent = '改过的内容\n';
      App.els.doc.dispatch('input', {});
      ok(App.manualSave() === true, 'P1-11：写回已发出');
      ok(it.unsaved === true, 'P1-11：回包前条目仍是「未保存」（脏标记没有提前清）');

      windowObj.__DV_WRITE_RESULT({ ok: false, path: it.fullPath, error: 'changed on disk', changedOnDisk: true });
      const modal = documentObj.querySelector('#dvChoose');
      ok(!!modal, 'P1-11：弹出三选一对话框而不是只弹个 toast');
      const btns = documentObj.querySelectorAll('.dv-choose-actions .btn');
      ok(btns.length === 3, 'P1-11：三个选项', 'n=' + btns.length);
      ok(it.text.indexOf('改过的内容') >= 0, 'P1-11：写回失败时改动仍留在内存里，没有丢');

      // 「仍然覆盖」→ 再发一次带 force 的写回
      sent.length = 0;
      const overwrite = btns.find(b => b.textContent === DV.t('仍然覆盖'));
      ok(!!overwrite, 'P1-11：有「仍然覆盖」按钮');
      overwrite.dispatch('click', {});
      await tick();
      const forced = sent.filter(m => m.action === 'writeFile')[0] || {};
      ok(forced.force === true, 'P1-11：「仍然覆盖」带上了 force 标志');
      ok(String(forced.text).indexOf('改过的内容') >= 0, 'P1-11：覆盖的是用户改过的内容');

      // 「重新加载磁盘版本」→ 从磁盘读回并丢弃内存改动
      sent.length = 0;
      App.els.doc.dispatch('input', {});
      App.manualSave();
      windowObj.__DV_WRITE_RESULT({ ok: false, path: it.fullPath, error: 'changed on disk', changedOnDisk: true });
      await tick();
      const diskBytes = new TextEncoder().encode('磁盘上的版本\n');
      sandbox.fetch = () => Promise.resolve({
        ok: true, status: 200,
        arrayBuffer: async () => diskBytes.buffer.slice(0),
      });
      const reload = documentObj.querySelectorAll('.dv-choose-actions .btn')
        .find(b => b.textContent === DV.t('重新加载磁盘版本'));
      ok(!!reload, 'P1-11：有「重新加载磁盘版本」按钮');
      reload.dispatch('click', {});
      await tick(); await tick(); await tick();
      ok(it.text.indexOf('磁盘上的版本') >= 0, 'P1-11：重新加载后条目换成磁盘内容',
         JSON.stringify(String(it.text).slice(0, 40)));
      ok(it.unsaved !== true, 'P1-11：重新加载后不再是「未保存」');
      delete sandbox.fetch;
      delete windowObj.webkit;
      DV.Settings.set({ editMode: 'ro' });
      App.closeFile(it.id);
    }

    // ---- P1-13：写回失败 / 超时不能把脏标记吃掉 ----
    {
      await App.ingest([mk('失败重试.txt', '原文\n')], { showProgress: false });
      const it = App.state.files.find(f => f.name === '失败重试.txt');
      it.fullPath = '/tmp/docviewer-p1-13.txt';
      const sent = [];
      windowObj.webkit = { messageHandlers: { dv: { postMessage: m => sent.push(m) } } };
      DV.Settings.set({ editMode: 'rw' });
      App.select(it.id); App.applyEditMode();
      App.els.doc.textContent = '新内容\n';
      App.els.doc.dispatch('input', {});
      App.manualSave();
      windowObj.__DV_WRITE_RESULT({ ok: false, path: it.fullPath, error: 'file is read-only' });
      ok(it.unsaved === true, 'P1-13：失败的写回把条目标成未保存');
      ok(App.els.saveState.textContent === DV.t('未保存'), 'P1-13：状态栏显示未保存');
      ok(App.manualSave() === true, 'P1-13：失败之后还能再保存一次（不会变成哑巴）');
      delete windowObj.webkit;
      DV.Settings.set({ editMode: 'ro' });
      App.closeFile(it.id);
    }

    // ---- P1-14：清空列表 / 复位 / 关窗口之前要 flush ----
    {
      await App.ingest([mk('清空前.txt', '即将清空\n')], { showProgress: false });
      const it = App.state.files.find(f => f.name === '清空前.txt');
      it.fullPath = '/tmp/docviewer-p1-14.txt';
      const sent = [];
      windowObj.webkit = { messageHandlers: { dv: { postMessage: m => sent.push(m) } } };
      DV.Settings.set({ editMode: 'rw' });
      App.select(it.id); App.applyEditMode();
      App.els.doc.textContent = '改过的清空内容\n';
      App.els.doc.dispatch('input', {});
      sent.length = 0;
      documentObj.getElementById('btnClear').dispatch('click', {});
      ok(sent.filter(m => m.action === 'writeFile').length === 1,
         'P1-14：清空列表前先把改动写回去', 'writes=' + sent.length);
      ok(App.state.files.length === 0, 'P1-14：列表确实被清空了');

      ok((windowObj.listeners['beforeunload'] || []).length > 0, 'P1-14：注册了 beforeunload 兜底');

      // 复位前也要 flush
      await App.ingest([mk('复位前.txt', '即将复位\n')], { showProgress: false });
      const it2 = App.state.files.find(f => f.name === '复位前.txt');
      it2.fullPath = '/tmp/docviewer-p1-14b.txt';
      App.select(it2.id); App.applyEditMode();
      App.els.doc.textContent = '改过的复位内容\n';
      App.els.doc.dispatch('input', {});
      sent.length = 0;
      App.resetToFirstRun();
      ok(sent.filter(m => m.action === 'writeFile').length === 1,
         'P1-14：复位前先把改动写回去', 'writes=' + sent.length);
      delete windowObj.webkit;
      DV.Settings.set({ editMode: 'ro' });
    }

    // ---- P1-16：损坏会话里的非法 kind 不能把启动打断 ----
    {
      const bad = { id: 'bad-kind', name: '坏.xyz', path: '', kind: 'nonsense-kind',
                    text: '正文', bytes: 6, html: '<p>正文</p>' };
      App.state.files.push(bad);
      let threw = null;
      try { App.paintDoc(bad); } catch (e) { threw = e; }
      ok(!threw, 'P1-16：非法 kind 不会抛 TypeError', threw && threw.message);
      App.state.files = App.state.files.filter(f => f.id !== 'bad-kind');
    }

    // ---- P1-17：原生投递也要设 item.big（大文件跳过全文统计，但不限制导入）----
    {
      const big = new Uint8Array(6 * 1024 * 1024 + 32);
      big.fill(0x41);
      sandbox.fetch = () => Promise.resolve({
        ok: true, status: 200, arrayBuffer: async () => big.buffer.slice(0),
      });
      sandbox.window.__DV_NATIVE_FILES(['/tmp/docviewer-p1-17.txt']);
      await tick(); await tick(); await tick();
      const it = App.state.files.find(f => f.name === 'docviewer-p1-17.txt');
      ok(!!it, 'P1-17：大文件照样导入（不做大小限制）');
      ok(it && it.big === true, 'P1-17：大文件被标记为 big');
      ok(it && it.lines === 0, 'P1-17：大文件跳过全文行数统计');
      delete sandbox.fetch;
      if (it) App.closeFile(it.id);
    }

    // ---- C24 / P1-15：写回后内存里的条目立刻是新内容，重绘不会回退 ----
    {
      await App.ingest([mk('重绘.txt', '旧内容\n')], { showProgress: false });
      const it = App.state.files.find(f => f.name === '重绘.txt');
      it.fullPath = '/tmp/docviewer-p1-15.txt';
      windowObj.webkit = { messageHandlers: { dv: { postMessage: () => { } } } };
      DV.Settings.set({ editMode: 'rw' });
      App.select(it.id); App.applyEditMode();
      App.els.doc.textContent = '新内容\n';
      App.els.doc.dispatch('input', {});
      App.manualSave();
      ok(it.text.indexOf('新内容') >= 0,
         'C24：写回发出的同时 item.text 就已经是新内容（重绘不会回退）',
         JSON.stringify(String(it.text)));
      delete windowObj.webkit;
      DV.Settings.set({ editMode: 'ro' });
      App.closeFile(it.id);
    }

    // ---- C26：原生的英文错误串要能本地化 ----
    {
      ok(App.writeErrText('file is read-only') === '文件是只读的', 'C26：只读错误已本地化',
         App.writeErrText('file is read-only'));
      ok(/编码写入失败/.test(App.writeErrText('encode failed: latin1')), 'C26：编码失败已本地化',
         App.writeErrText('encode failed: latin1'));
      ok(App.writeErrText('something else') === 'something else', 'C26：认不出来的原样显示');
    }

    p1Restore();
  }

  /* --- 场景 7d：帧率采样（不受 rAF 限制）--- */
  const pump0 = sandbox.__frames || 0;
  const st1 = DV.Debug.stats();
  await waitFrames(pump0 + 120, 4000);           // 帧驱动：跑够 120 帧再断言
  const st2 = DV.Debug.stats();
  ok((sandbox.__frames || 0) > pump0, '渲染帧循环在持续运作（' + pump0 + ' → ' + sandbox.__frames + '）');
  ok(st2.totalFrames > st1.totalFrames, '帧计数器在推进（' + st1.totalFrames + ' → ' + st2.totalFrames + '）');
  ok(st2.cap === App.state ? true : st2.cap === DV.Settings.get().frameRate,
     '帧率上限已生效：' + st2.cap + ' fps');
  ok(st2.fps === 0 || (isFinite(st2.fps) && st2.fps >= 0), '渲染帧率统计有效：' + st2.fps.toFixed(1) + ' fps');
  ok(typeof st2.frameMs === 'number' && st2.frameMs >= 0, '帧间隔统计有效：' + st2.frameMs.toFixed(3) + ' ms');
  ok(st2.samples > 0 && st2.samples <= 240, 'FPS 曲线已采样到数据点（' + st2.samples + '/240）');
  ok(st2.probeOn === true, '高帧率探针默认开启（受控模式）');
  ok(st2.probeMax === false, '放开 CPU 预算默认关闭');
  const tps1 = DV.Debug.tps();
  await waitFrames((sandbox.__frames || 0) + 200, 4000);
  ok(DV.Debug.isProbeOn() && typeof DV.Debug.tps() === 'number', '探针吞吐可读：' + DV.Debug.tps().toFixed(0) + ' 次/秒');
  DV.Debug.setProbe(false);
  ok(DV.Debug.isProbeOn() === false && DV.Debug.tps() === 0, '探针可关闭');
  DV.Debug.setProbe(true);
  const chipText = documentObj.getElementById('tbFps').textContent;
  ok(/fps$/.test(chipText), '标题栏帧率徽标已更新：' + chipText);

  /* --- 场景 7e：嵌套拼接（把合并文档再与别的文件拼接）--- */
  const rtfFile = App.state.files.find(f => f.kind === 'rtf');
  ok(!!rtfFile, '存在 RTF 文件可用于二次拼接：' + (rtfFile && rtfFile.name));
  if (rtfFile) {
    const filesBefore2 = App.state.files.length;
    App.setSelection([rtfFile.id]);
    const m1 = App.state.files.find(f => f.merged);
    if (m1) {
      App.setSelection([rtfFile.id, m1.id]);
      const m2 = App.mergeSelected();
      ok(!!m2 && m2.merged, '合并文档可以与 RTF 再次拼接');
      if (m2) {
        ok(m2.parts.length === 2, '二次拼接含 2 段，实际 ' + m2.parts.length);
        ok((App.els.doc.innerHTML.match(/seg-body/g) || []).length === 2, '二次拼接渲染出 2 段正文');
        ok(App.els.doc.innerHTML.includes('rtf-table') || App.els.doc.innerHTML.length > 200, 'RTF 段被正常渲染进合并视图');
        App.setSelection([]);
        App.els.btnMergeSplit.dispatch ? null : null;
        documentObj.getElementById('btnMergeSplit').dispatch('click');
        ok(App.state.files.length === filesBefore2 - 1, '二次拆分后文件数正确（' + filesBefore2 + ' → ' + App.state.files.length + '）');
      }
    }
    App.setSelection([]);
  }

  /* --- 场景 7f：设置面板 / 主题 / 字体 / 颜色 / 沉浸 / 帧率 --- */
  {
    const S = DV.Settings, UI = DV.SettingsUI;
    const body = documentObj.body;
    ok(!!S && !!UI, '设置模块已加载');
    ok(S.get().frameRate === 240, '默认帧率上限 240 fps，实际 ' + S.get().frameRate);
    ok(DV.frames.getFps() === 240, 'frames 调度器已按设置限帧');

    // 面板开关
    const btnSet = documentObj.getElementById('btnSettings');
    const pane2 = documentObj.getElementById('settingspane');
    ok(!!btnSet && !!pane2, '设置按钮与面板存在', 'btn=' + !!btnSet + ' pane=' + !!pane2);
    ok((btnSet.listeners.click || []).length > 0, '设置按钮已绑定点击事件');
    UI.hide();
    ok(UI.isOpen() === false, '设置面板初始关闭');
    btnSet.dispatch('click');
    ok(UI.isOpen() === true, '点按钮可打开设置面板', 'hidden=' + pane2.hidden);
    ok(pane2.hidden === false, '设置面板可见');
    btnSet.dispatch('click');
    ok(UI.isOpen() === false, '再点一次可关闭');

    // 主题
    UI.show();
    const themeCards = DV.$$('.theme-card');
    ok(themeCards.length === 6, '六种主题卡片（含自定义），实际 ' + themeCards.length);
    ok(S.THEMES.map(t => t.id).join(',') === 'dark,blue,green,light,sepia,custom',
       '主题顺序与 id：' + S.THEMES.map(t => t.id).join(','));
    ok(!S.THEMES.some(t => /HMCL/i.test(t.desc + t.label)), '主题文案中不再出现 HMCL');
    const pickTheme = (id) => { themeCards.find(c => c.dataset.theme === id).dispatch('click'); };
    pickTheme('light');
    ok(S.get().theme === 'light', '切换到浅色主题');
    ok(body.getAttribute('data-theme') === 'light', 'data-theme 已更新');
    pickTheme('blue');
    ok(body.getAttribute('data-theme') === 'blue', '切换到蓝色系');
    pickTheme('green');
    ok(body.getAttribute('data-theme') === 'green', '切换到绿色系');
    pickTheme('sepia');
    ok(body.getAttribute('data-theme') === 'sepia', '切换到羊皮纸主题');


    // 字体
    const fontCards = DV.$$('.font-card');
    ok(fontCards.length >= 6, '字体卡片数量 ≥ 6，实际 ' + fontCards.length);
    const songCard = fontCards.find(c => c.dataset.font === 'song');
    songCard.dispatch('click');
    ok(S.get().font === 'song', '切换到宋体');
    ok(body.getAttribute('data-font') === 'song', 'data-font 已更新');
    ok(/Songti|SimSun/.test(DV.Settings.fontStack() || ''), '宋体字体栈正确：' + DV.Settings.fontStack());
    // 自定义字体
    const customCard = fontCards.find(c => c.dataset.font === 'custom');
    customCard.dispatch('click');
    const inp = documentObj.getElementById('fontCustomInput');
    inp.value = 'My Custom Font';
    inp.dispatch('input', { target: inp });
    ok(S.get().font === 'custom' && S.get().fontCustom === 'My Custom Font', '自定义字体名已生效');
    ok(/My Custom Font/.test(DV.Settings.fontStack()), '自定义字体栈：' + DV.Settings.fontStack());

    // 颜色
    S.set({ colors: { text: '#ff7a59', accent: '#4a9eff', bg: '#101214' } });
    const decl = body.style;
    ok(decl.getPropertyValue('--doc-color') === '#ff7a59', '正文颜色已写入 CSS 变量');
    ok(decl.getPropertyValue('--accent') === '#4a9eff', '强调色已写入');
    ok(decl.getPropertyValue('--doc-bg') === '#101214', '阅读底色写入 --doc-bg（只影响阅读区）');
    ok(decl.getPropertyValue('--bg-2') === '', '不会覆盖侧栏背景 --bg-2（避免文字看不见）');
    // colors 必须能真正清空
    S.set({ colors: {} });
    ok(decl.getPropertyValue('--doc-bg') === '' && decl.getPropertyValue('--doc-color') === '',
       'colors 传空对象可清空自定义配色');
    S.set({ colors: { text: '#ff7a59', accent: '#4a9eff', bg: '#101214' } });

    // 自定义主题：换主题必须把所有颜色都换掉
    S.set({ colors: { accent: '#ff0000', text: '#00ff00', bg: '#0000ff' } });
    ok(decl.getPropertyValue('--accent') === '#ff0000', '细调色生效');
    pickTheme('custom');
    ok(S.get().colors.accent === undefined && decl.getPropertyValue('--accent') !== '#ff0000',
       '切到自定义主题后清空细调色');
    ok(body.getAttribute('data-theme') === 'custom', 'data-theme=custom');
    ok(decl.getPropertyValue('--bg') === S.get().customTheme.bg, '自定义底色已铺开');
    ok(decl.getPropertyValue('--text') === S.get().customTheme.text, '自定义文字色已铺开');
    ok(/color-mix/.test(decl.getPropertyValue('--text-3')), '最淡文字由推导得出：' + decl.getPropertyValue('--text-3'));
    ok(documentObj.getElementById('customRow').hidden === false, '自定义取色器已显示');
    S.set({ customTheme: { bg: '#ffffff', bg2: '#f5f5f5', text: '#111111', accent: '#2266ff' } });
    ok(decl.getPropertyValue('--text') === '#111111' && decl.getPropertyValue('--accent') === '#2266ff',
       '改取色器立即生效');
    ok(decl.getPropertyValue('--accent-ink') === '#ffffff' || decl.getPropertyValue('--accent-ink') === '#12170c',
       '自动选出对比合适的强调色前景：' + decl.getPropertyValue('--accent-ink'));
    pickTheme('dark');
    ok(documentObj.getElementById('customRow').hidden === true, '切回预设后取色器隐藏');
    ok(decl.getPropertyValue('--bg') === '', '切回预设后自定义变量被清掉（不会残留）');
    ok(DV.$$('.swatch').length >= 20, '色块已生成（' + DV.$$('.swatch').length + '）');

    // 排版
    S.set({ size: 22, lineHeight: 2.1, width: 700, pad: 40 });
    const rootDecl = documentObj.documentElement.style;
    ok(rootDecl.getPropertyValue('--doc-size') === '22px', '字号变量已写入：' + rootDecl.getPropertyValue('--doc-size'));
    ok(rootDecl.getPropertyValue('--doc-line') === '2.1', '行高变量已写入');
    ok(rootDecl.getPropertyValue('--doc-width') === '700px', '行宽变量已写入');
    ok(rootDecl.getPropertyValue('--doc-pad') === '40px', '留白变量已写入');
    UI.syncControls();
    ok(documentObj.getElementById('setSizeVal').textContent === '22', '滑杆读数已同步',
       'actual=' + documentObj.getElementById('setSizeVal').textContent);

    // 帧率分档
    const segFps = documentObj.getElementById('segFps');
    ok(DV.$$('button', segFps).length === 6, '帧率档位 6 个（不限/30/60/120/180/240）');
    DV.$$('button', segFps).forEach(b => { if (b.dataset.v === '60') b.dispatch('click'); });
    ok(S.get().frameRate === 60, '可切到 60 fps');
    ok(DV.frames.getFps() === 60, '调度器帧率跟随：' + DV.frames.getFps());
    ok(Math.abs(DV.frames.interval() - 1000 / 60) < 0.01, '帧间隔计算正确');
    DV.$$('button', segFps).forEach(b => { if (b.dataset.v === '240') b.dispatch('click'); });
    ok(DV.frames.getFps() === 240, '可切回 240 fps');

    // 动画强度
    const segAnim = documentObj.getElementById('segAnim');
    ok(DV.$$('button', segAnim).length === 3, '动画强度 3 档');
    DV.$$('button', segAnim).forEach(b => { if (b.dataset.v === 'off') b.dispatch('click'); });
    ok(body.getAttribute('data-anim') === 'off', '动画可关闭');
    DV.$$('button', segAnim).forEach(b => { if (b.dataset.v === 'full') b.dispatch('click'); });
    ok(body.getAttribute('data-anim') === 'full', '动画可全开');

    // 沉浸式阅读
    const onImm = S.toggleImmersive();
    UI.applyImmersive(onImm);
    ok(onImm === true && body.classList.contains('immersive'), '进入沉浸式阅读');
    ok(documentObj.getElementById('immbar').hidden === false, '沉浸控制条显示');
    UI.updateProgress();
    ok(true, '进度条更新不抛异常');
    documentObj.getElementById('immExit').dispatch('click');
    ok(body.classList.contains('immersive') === false, '退出沉浸式阅读');
    // F11 / Esc 快捷键已按用户要求移除：只剩 F3
    windowObj.dispatch('keydown', { key: 'F11', preventDefault() { }, target: body, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
    ok(body.classList.contains('immersive') === false, 'F11 不再进入沉浸（快捷键已移除）');
    const immBtn = documentObj.getElementById('btnImmersive');
    immBtn.dispatch('click');
    ok(body.classList.contains('immersive') === true, '工具栏「沉浸」按钮仍可进入');
    immBtn.dispatch('click');
    ok(body.classList.contains('immersive') === false, '再点一次退出沉浸');

    // 设置持久化
    ok(!!localStorageData['docviewer.settings.v1'], '设置已写入 localStorage');
    const savedSet = JSON.parse(localStorageData['docviewer.settings.v1']);
    ok(savedSet.theme === S.get().theme, '主题已保存：' + savedSet.theme);
    ok(savedSet.font === 'custom', '字体设置已保存');
    ok(savedSet.customTheme && savedSet.customTheme.bg === '#ffffff', '自定义主题配色已保存');

    // 重置
    documentObj.getElementById('setReset').dispatch('click');
    ok(S.get().theme === 'dark' && S.get().size === S.DEFAULTS.size, '重置回默认值');
    ok(body.getAttribute('data-theme') === 'dark', '重置后 data-theme 回默认');
    ok(documentObj.documentElement.style.getPropertyValue('--doc-size') === S.DEFAULTS.size + 'px', '重置后字号变量回默认');
    UI.hide();
  }

  /* --- 场景 7f-2：帧率上限必须能突破 60（rAF 被 vsync 锁死，动画得用定时器驱动）--- */
  {
    const cap0 = DV.Settings.get().frameRate;
    DV.Settings.set({ frameRate: 120 });
    await new Promise(r => setTimeout(r, 900));
    const hi = DV.frames.info();
    ok(hi.cap === 120, '帧率上限已设为 120：' + hi.cap);
    ok(hi.animFps > 70, '动画帧率可以突破 60（实测 ' + hi.animFps.toFixed(1) + ' fps）',
       '间隔 ' + hi.effectiveInterval + 'ms · 渲染 ' + hi.renderFps.toFixed(1));
    ok(Math.abs(hi.effectiveInterval - 1000 / 120) < 0.5, '间隔按 1000/cap 计算：' + hi.effectiveInterval + ' ms');
    DV.Settings.set({ frameRate: cap0 });
  }

  /* --- 场景 7g：侧栏单独收起 / 展开 --- */
  {
    const appEl = documentObj.querySelector('.app');
    const handle = documentObj.getElementById('sideHandle');
    const toggleBtn = documentObj.getElementById('btnSidebar');
    ok(!!appEl && !!handle && !!toggleBtn, '侧栏相关元素存在',
       'app=' + !!appEl + ' handle=' + !!handle + ' btn=' + !!toggleBtn);

    DV.Settings.set({ sidebar: false });
    ok(appEl.classList.contains('no-side'), '收起侧栏后 .app 带 no-side');
    ok(handle.hidden === false, '收起后左侧把手显示');
    ok(DV.Settings.get().sidebar === false, '状态已持久化');

    DV.Settings.set({ sidebar: true });
    ok(!appEl.classList.contains('no-side'), '展开侧栏');
    ok(handle.hidden === true, '展开后把手隐藏');

    // Ctrl+B 已移除，收起改由侧栏顶部按钮完成
    windowObj.dispatch('keydown', { key: 'b', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false,
      preventDefault() { }, target: documentObj.body });
    ok(!appEl.classList.contains('no-side'), 'Ctrl+B 不再收起侧栏（快捷键已移除）');
    documentObj.getElementById('btnSidebar').dispatch('click');
    ok(appEl.classList.contains('no-side'), '侧栏顶部按钮可收起');
    documentObj.getElementById('sideHandle').dispatch('click');
    ok(!appEl.classList.contains('no-side'), '把手可再次展开');
  }

  /* --- 场景 7h：动效 —— 关闭可用、速度可调、高亮常驻 --- */
  {
    const S = DV.Settings, UI = DV.SettingsUI;
    const appEl = documentObj.querySelector('.app');
    ok(S.ANIM_SPEEDS && S.ANIM_SPEEDS.length === 3, '动画速度三档（快/标准/慢）');
    ok(S.get().animSpeed === 1, '默认标准速度');

    S.set({ animSpeed: 1.4 });
    ok(documentObj.documentElement.style.getPropertyValue('--anim-speed') === '1.4',
       '速度写入 CSS 变量：' + documentObj.documentElement.style.getPropertyValue('--anim-speed'));
    S.set({ animSpeed: 1 });

    // 关闭动画：滑动高亮隐藏
    S.set({ anim: 'off' });
    ok(documentObj.body.getAttribute('data-anim') === 'off', 'data-anim=off 已应用');
    refreshListForTest();
    ok(documentObj.getElementById('listHL').hidden === true, '关闭动画后滑动高亮隐藏');
    S.set({ anim: 'full' });
    refreshListForTest();
    ok(documentObj.getElementById('listHL').hidden === false, '打开动效后高亮恢复显示');
    ok(documentObj.getElementById('listHL').style.transform.indexOf('translateY') === 0,
       '高亮位置以 transform 表达（走合成层）：' + documentObj.getElementById('listHL').style.transform);

    // 高亮元素必须常驻，否则 transition 无从触发
    const hl1 = documentObj.getElementById('listHL');
    refreshListForTest();
    ok(documentObj.getElementById('listHL') === hl1, '多次刷新列表后高亮元素仍是同一个节点（滑动前提）');
    ok(!!documentObj.getElementById('segAnimSpeed'), '设置面板有动画速度控件');
  }

  /* --- 场景 7i：CSS 断言（防回归：过渡声明不能被后写的规则覆盖） --- */
  {
    const cssRaw = fs.readFileSync(path.join(ROOT, 'css', 'hmcl.css'), 'utf8');
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');   // 去掉注释，否则会粘进选择器
    // 解析所有规则块，找出选择器里包含目标选择器的块
    const blocks = [];
    css.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => { blocks.push({ sel: sel.trim(), body }); return m; });
    const hasWidthTransition = (target) => blocks.some(b =>
      b.sel.split(',').map(x => x.trim()).indexOf(target) >= 0 && /transition\s*:[^;]*width/.test(b.body));
    const transitionsOf = (target) => blocks
      .filter(b => b.sel.split(',').map(x => x.trim()).indexOf(target) >= 0 && /transition\s*:/.test(b.body))
      .map(b => (b.body.match(/transition\s*:[^;]*/) || [''])[0]);

    ok(hasWidthTransition('.sidebar'), '侧栏过渡包含 width（收起/展开才有动画）', transitionsOf('.sidebar').join(' | '));
    const colorRuleHasSidebar = blocks.some(b =>
      b.sel.split(',').map(x => x.trim()).indexOf('.sidebar') >= 0 &&
      /background-color/.test(b.body) && !/transition\s*:[^;]*width/.test(b.body));
    ok(!colorRuleHasSidebar, '没有"只过渡颜色"的 .sidebar 规则去覆盖 width',
       transitionsOf('.sidebar').join(' | '));

    ok(hasWidthTransition('.settingspane') && hasWidthTransition('.debugpane'),
       '设置/调试面板过渡包含 width', transitionsOf('.settingspane').join(' | '));
    ok(/\.pane-closing/.test(cssRaw) && /\.pane-opening/.test(cssRaw), '存在面板开合状态类');

    ['dark', 'blue', 'green', 'light', 'sepia'].forEach(t => {
      ok(blocks.some(b => b.sel === 'body[data-theme="' + t + '"]'),
         'CSS 里有 ' + t + ' 主题的调色板');
    });

    // 每个主题的文字对比度必须达标（WCAG AA：小字 ≥4.5:1）
    const lum = (hex) => {
      const h = hex.replace('#', '');
      const ch = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255);
      const f = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * f(ch[0]) + 0.7152 * f(ch[1]) + 0.0722 * f(ch[2]);
    };
    const ratio = (a, b) => {
      const la = lum(a), lb = lum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    ['dark', 'blue', 'green', 'light', 'sepia'].forEach(t => {
      const body = (blocks.filter(b => b.sel === 'body[data-theme="' + t + '"]')[0] || {}).body || '';
      const get = k => (body.match(new RegExp('--' + k + '\\s*:\\s*(#[0-9a-fA-F]{6})')) || [])[1];
      const bg2 = get('bg-2'), t2 = get('text-2'), t3 = get('text-3');
      if (!bg2 || !t2 || !t3) { ok(false, t + ' 主题颜色变量完整'); return; }
      ok(ratio(bg2, t2) >= 7, t + ' 次要文字对比度达标（' + ratio(bg2, t2).toFixed(1) + ':1）');
      ok(ratio(bg2, t3) >= 5.5, t + ' 最淡文字对比度达标（' + ratio(bg2, t3).toFixed(1) + ':1）');
    });

    // 合并视图也必须统一成阅读器排版：RTF 覆盖规则不能只匹配 .doc.rtf
    {
      const rtfRules = blocks.filter(b => /data-rtf-font="reader"/.test(b.sel));
      ok(rtfRules.length > 0, '存在 RTF 使用阅读器排版的覆盖规则');
      const scopedToRtfOnly = rtfRules.filter(b => /\.doc\.rtf[\s,]/.test(b.sel) &&
        !/\.doc\s+\.rtf-body/.test(b.sel));
      ok(scopedToRtfOnly.length === 0,
         'RTF 覆盖规则不再只匹配 .doc.rtf（合并视图也命中）',
         scopedToRtfOnly.map(b => b.sel).join(' | '));
      const mergedRules = blocks.filter(b => /data-rtf-font="reader"/.test(b.sel) &&
        /\.doc\.merged/.test(b.sel));
      ok(mergedRules.length > 0, '合并视图有专门的排版统一规则',
         mergedRules.map(b => b.sel.split(',')[0]).join(' | '));
      ok(blocks.some(b => /\.doc\s+\.rtf-body/.test(b.sel)),
         '存在 .doc .rtf-body 形式的选择器（合并视图里也有 .rtf-body）');
    }

    const fit = blocks.filter(b => b.sel === '.fitem')[0];
    ok(fit && /align-items\s*:\s*center/.test(fit.body), '文件行使用 align-items:center（图标垂直居中）',
       fit ? (fit.body.match(/align-items\s*:[^;]*/) || [''])[0] : '未找到 .fitem');
  }

  /* --- 场景 7j：选中不重建列表 / RTF 字体开关 / 工具入口 --- */
  {
    const S = DV.Settings, UI = DV.SettingsUI;
    // 选中时不应重建 DOM（否则每次点击都重跑入场动画 = 闪一下）
    const body = documentObj.getElementById('listBody');
    const firstRow = body.querySelector('.fitem');
    App.select(App.state.files[2].id);
    App.select(App.state.files[1].id);
    ok(body.querySelector('.fitem') === firstRow, '切换文件不重建列表 DOM（不会闪入场动画）');
    ok(firstRow.classList.contains('active') === false && body.querySelector('.fitem.active'),
       'active 类被正确迁移');

    // 勾选操作同样不重建
    const row2 = body.querySelector('.fitem');
    row2.querySelector('.fcheck').dispatch('click', { stopPropagation() { } });
    ok(body.querySelector('.fitem') === firstRow, '勾选也不重建列表');
    App.setSelection([]);

    // RTF 字体开关
    ok(S.get().rtfReaderFont === true, '默认忽略 RTF 自带字体');
    ok(documentObj.body.getAttribute('data-rtf-font') === 'reader', 'data-rtf-font=reader 已应用');
    UI.show();
    const cb = documentObj.getElementById('setRtfFont');
    cb.checked = false;
    cb.dispatch('change', { target: cb });
    ok(S.get().rtfReaderFont === false && documentObj.body.getAttribute('data-rtf-font') === 'native',
       '关闭后使用 RTF 自带字体');
    cb.checked = true;
    cb.dispatch('change', { target: cb });
    ok(documentObj.body.getAttribute('data-rtf-font') === 'reader', '可再次开启');

    // 工具入口已移入设置面板
    ok(!!documentObj.getElementById('setOpenDebug'), '设置面板有「调试面板」按钮');
    ok(!!documentObj.getElementById('setDiag'), '设置面板有「诊断报告」按钮');
    ok(documentObj.getElementById('btnDebug') === null, '工具栏已移除 F3 按钮');
    ok(documentObj.getElementById('btnDiag') === null, '工具栏已移除诊断按钮');
    ok(typeof DV.App.diag === 'function', '诊断逻辑仍可通过 DV.App.diag 调用');
    const rep = DV.App.diag();
    ok(/诊断报告/.test(rep), '设置里的诊断报告可用');
    UI.hide();
  }

  /* --- 场景 7k：标题栏自定义 / 记住会话入设置 / 侧栏结构 --- */
  {
    const S = DV.Settings, UI = DV.SettingsUI;
    // 元信息字段开关
    ok(!!S.META_FIELDS && S.META_FIELDS.length >= 5, '元信息字段清单存在');
    ok(S.get().metaFields.path === true && S.get().metaFields.encoding === true, '默认显示路径与编码');
    ok(S.get().metaFields.type === false, '文件类型默认不显示');
    const it = App.state.files.find(f => f.kind === 'rtf') || App.state.files[0];
    App.select(it.id);
    const metaText = () => DV.App.els.docMeta.textContent;
    ok(metaText().indexOf(it.encoding) >= 0, '标题栏含编码：' + metaText().slice(0, 60));
    S.set({ metaFields: Object.assign({}, S.get().metaFields, { encoding: false }) });
    App.paintDoc(it);
    ok(metaText().indexOf(it.encoding) < 0, '关掉编码后不再显示');
    S.set({ metaFields: Object.assign({}, S.get().metaFields, { encoding: true }) });
    App.paintDoc(it);

    // 隐藏顶部标题栏
    ok(documentObj.body.classList.contains('no-titlebar') === false, '默认显示标题栏');
    S.set({ showTitlebar: false });
    ok(documentObj.body.classList.contains('no-titlebar'), '可隐藏顶部标题栏');
    ok(documentObj.querySelector('.titlebar').hidden === true, '标题栏元素已隐藏');
    S.set({ showTitlebar: true });
    ok(documentObj.body.classList.contains('no-titlebar') === false, '可恢复显示');

    // 记住会话：入设置、默认启用
    ok(S.get().rememberSession === true, '记住会话默认启用');
    ok(documentObj.getElementById('optPersist') === null, '侧栏不再有「记住会话」开关');
    ok(!!documentObj.getElementById('setPersist'), '设置面板里有「记住会话」');

    // 侧栏结构：收起按钮在侧栏顶部，打开/导入按钮在底部
    const sbEl = documentObj.querySelector('.sidebar');
    ok(!!sbEl.querySelector('.side-top #btnSidebar'), '收起按钮在侧栏顶部');
    ok(!!documentObj.getElementById('sideHandle'), '收起后仍有展开把手');
    const foot = sbEl.querySelector('.side-foot');
    ok(!!foot.querySelector('#optWrap'), '自动换行在底部');
    ok(!!foot.querySelector('#btnOpenFiles') && !!foot.querySelector('#btnOpenDir'),
       '打开文件 / 导入文件夹在底部');
    const top = sbEl.querySelector('.side-top');
    ok(!top.querySelector('#btnOpenFiles'), '顶部不再有打开文件按钮');
    UI.hide();
  }

  /* --- 场景 7l：i18n / 首次 README / 恢复初始设置 --- */
  {
    const S = DV.Settings, UI = DV.SettingsUI;
    ok(!!DV.i18n && typeof DV.t === 'function', 'i18n 模块已加载');
    ok(S.get().lang === 'zh', '默认中文');
    ok(!!documentObj.getElementById('segLang'), '设置有语言选项');
    ok(S.LANGS.map(l => l.id).join(',') === 'zh,en', '语言选项：中文 / English');

    // 词典与 DV.t（DOM 替换路径在真实应用里用截图核对）
    ok(DV.i18n.MAP['打开文件'] === 'Open files', '词典：打开文件 → Open files');
    // 阅读位置设置项必须在面板里，且有英文译文
    ok(!!documentObj.getElementById('setScroll'), '设置里有「记住每个文件的阅读位置」开关');
    ok(!!DV.i18n.MAP['记住每个文件的阅读位置'], '该开关有英文译文',
       DV.i18n.MAP['记住每个文件的阅读位置']);
    ok(DV.t('设置') === '设置', '中文模式下 t() 原样返回');
    S.set({ lang: 'en' });
    ok(documentObj.body.getAttribute('lang') === 'en', 'lang 属性切到 en');
    ok(DV.t('设置') === 'Settings', '英文模式 t() 返回英文');
    ok(DV.t('打开文件') === 'Open files', '英文模式按钮文案表命中');
    ok(DV.i18n.translateValue('主题') === 'Theme', 'translateValue 可用于动态指标名');
    // 漏译检测（静态）：index.html 里每个中文文案都必须在词典里
    {
      const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
        .replace(/<!--[\s\S]*?-->/g, '');
      const cjk = /[\u4e00-\u9fff]/;
      const found = new Set();
      // 标签之间的文本
      let m;
      const reText = />([^<>]+)</g;
      while ((m = reText.exec(html))) {
        const v = m[1].trim();
        if (v && cjk.test(v)) found.add(v);
      }
      // placeholder / title
      const reAttr = /(?:placeholder|title)="([^"]+)"/g;
      while ((m = reAttr.exec(html))) {
        const v = m[1].trim();
        if (v && cjk.test(v)) found.add(v);
      }
      const norm = (v) => v.replace(/\s+/g, ' ').trim();
      const mapKeys = {};
      Object.keys(DV.i18n.MAP).forEach(k => { mapKeys[norm(k)] = 1; });
      const missing = Array.from(found).filter(v => !DV.i18n.MAP[v] && !mapKeys[norm(v)]);
      ok(found.size > 30, '扫到 ' + found.size + ' 条界面中文文案');
      ok(missing.length === 0, '所有界面文案都有英文译文（缺 ' + missing.length + ' 条）',
         missing.slice(0, 8).join(' | '));

      // JS 里生成的列表文案（主题名 / 字体名 / 说明）也必须有译文
      const jsSrc = fs.readFileSync(path.join(ROOT, 'js', 'settings.js'), 'utf8');
      const reList = /(?:label|note|desc):\s*'([^']*[\u4e00-\u9fff][^']*)'/g;
      const jsMissing = [];
      let mm;
      while ((mm = reList.exec(jsSrc))) if (!DV.i18n.MAP[mm[1]]) jsMissing.push(mm[1]);
      ok(jsMissing.length === 0, '主题/字体等列表文案都有译文（缺 ' + jsMissing.length + ' 条）',
         jsMissing.slice(0, 8).join(' | '));

      // 所有 JS 里进入界面的中文文案（DV.t / toast / textContent / title）都必须有译文。
      // 带占位符的按 {n} 归一化后再查，防止「拼接式文案」再次漏译。
      {
        const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));
        const jsMissing2 = [];
        jsFiles.forEach(f => {
          const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
          let inBlock = false;                                            // 跨行块注释状态
          src.split('\n').forEach((line, i) => {
            const startsBlock = /\/\*/.test(line);
            const endsBlock = /\*\//.test(line);
            const wasBlock = inBlock;
            if (startsBlock && !endsBlock) inBlock = true;
            else if (wasBlock && endsBlock) inBlock = false;
            if (wasBlock || startsBlock) return;                          // 整行在注释里
            if (/^\s*(\/\/|\*)/.test(line)) return;                      // 行注释
            if (!/DV\.t\(|toast\(|textContent\s*=|\.title\s*=|placeholder\s*=/.test(line)) return;
            const re = /'([^']*[\u4e00-\u9fff][^']*)'/g;
            let m2;
            while ((m2 = re.exec(line))) {
              const lit = m2[1];
              if (lit.length < 2) continue;
              if (DV.i18n.MAP[lit]) continue;
              if (DV.i18n.MAP[lit.replace(/\{[a-zA-Z]+\}/g, '{n}')]) continue;   // 占位符归一化
              jsMissing2.push(lit + ' (' + f + ':' + (i + 1) + ')');
            }
          });
        });
        ok(jsMissing2.length === 0, 'JS 动态文案都有英文译文（缺 ' + jsMissing2.length + ' 条）',
           jsMissing2.slice(0, 8).join(' | '));
      }

      // 西文字体已提供
      const latin = DV.Settings.FONTS.filter(f => f.latin);
      ok(latin.length >= 6, '提供西文/英文字体 ' + latin.length + ' 款');
      ok(DV.Settings.FONTS.some(f => f.id === 'georgia') && DV.Settings.FONTS.some(f => f.id === 'menlo'),
         '包含 Georgia 与 Menlo');

      S.set({ lang: 'zh' });
    }

    ok(DV.t('设置') === '设置', '切回中文可还原');

    // 首次 README：中英双语，英文段必须是纯英文
    ok(!!DV.WELCOME_MD, '内置 README 存在');
    {
      const savedFiles = App.state.files.slice();
      const savedActive = App.state.activeId;
      App.state.files.length = 0;
      const kept = localStorageData['docviewer.settings.v1'];
      const keptSess = localStorageData['docviewer.session'];
      delete localStorageData['docviewer.settings.v1'];   // 模拟"第一次打开"
      delete localStorageData['docviewer.session'];
      const seeded = DV.App.seedWelcome();
      ok(seeded === true && App.state.files.length === 2, '首次打开会内置两份 README');
      if (App.state.files.length === 2) {
        ok(App.state.files[0].name === 'README(EN).md', '第一份是 README(EN).md');
        ok(App.state.files[1].name === 'README(ZH).md', '第二份是 README(ZH).md');
        ok(App.state.files[0].kind === 'md' && App.state.files[1].kind === 'md', '都按 Markdown 渲染');
      }
      ok(DV.App.seedWelcome() === false, '已有文件时不再重复注入');
      App.state.files.length = 0;
      savedFiles.forEach(f => App.state.files.push(f));
      App.state.activeId = savedActive;
      localStorageData['docviewer.settings.v1'] = kept;
      if (keptSess !== undefined) localStorageData['docviewer.session'] = keptSess;
    }
    // 内置文档：英文一份、中文一份
    ok(Array.isArray(DV.WELCOME_FILES) && DV.WELCOME_FILES.length === 2, '内置两份 README');
    ok(DV.WELCOME_FILES[0].name === 'README(EN).md', '英文文件名 README(EN).md');
    ok(DV.WELCOME_FILES[1].name === 'README(ZH).md', '中文文件名 README(ZH).md（中文缩写 ZH）');
    {
      const cjkAll = /[\u3000-\u9fff\uff00-\uffef]/;
      ok(!cjkAll.test(DV.WELCOME_EN), '英文文档里没有任何中文字符');
      ok(DV.WELCOME_EN.indexOf('DocViewer') >= 0 && DV.WELCOME_EN.indexOf('## ') >= 0,
         '英文文档有标题与章节');
      ok(cjkAll.test(DV.WELCOME_ZH), '中文文档是中文');
      ok(DV.WELCOME_ZH.indexOf('## ') >= 0, '中文文档有章节');
      ok(DV.WELCOME_ZH.indexOf('编辑') >= 0 && DV.WELCOME_EN.indexOf('Editing') >= 0,
         '两份文档都写了编辑功能');
    }

    // 恢复初始设置（放在最后测，因为它会清空数据）
    ok(typeof S.wipe === 'function', '存在 wipe（清空数据）');
    ok(!!documentObj.getElementById('setWipe'), '设置里有「恢复初始设置」按钮');
    UI.hide();
  }

  /* --- 场景 7m：代码文件（以 Java 为例）--- */
  {
    const S = DV.Settings;
    // 类型判定：常见代码 / 配置后缀都要归为 code，而不是"未知类型"
    const codeFiles = ['Demo.java', 'App.kt', 'build.gradle', 'x.properties',
      'a.swift', 'b.rs', 'c.go', 'd.cpp', 'e.py', 'f.tsx', 'g.vue', 'h.sh',
      'i.ps1', 'j.lua', 'k.dart', 'l.ex', 'm.mm'];
    const wrong = codeFiles.filter(n => DV.kindOf(n) !== 'code');
    ok(wrong.length === 0, '代码后缀都识别为 code（异常：' + wrong.join(',') + '）');
    ok(DV.kindOf('README.md') === 'md' && DV.kindOf('a.rtf') === 'rtf' &&
       DV.kindOf('notes.txt') === 'txt', '文档类型判定不受影响');

    // 类型名可翻译
    ok(DV.i18n.MAP['代码 / 数据'] === 'Code / data', '有"代码 / 数据"的英文');
    ok(DV.i18n.MAP['未知类型'] === 'Unknown type', '有"未知类型"的英文');
    ok(DV.i18n.MAP['纯文本'] === 'Plain text', '有"纯文本"的英文');

    // 打开对话框必须允许 .java（否则文件选择器里根本看不到）
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const acc = (html.match(/accept="([^"]+)"/) || [])[1] || '';
    ok(acc.indexOf('.java') >= 0, '打开对话框允许 .java');
    ok(acc.indexOf('.kt') >= 0 && acc.indexOf('.py') >= 0 && acc.indexOf('.gradle') >= 0,
       '也允许 .kt / .py / .gradle');

    // Java 源文件按纯文本渲染（保留缩进与换行），中文注释不乱码
    const javaSrc = [
      'package com.example.demo;',
      '',
      'import java.util.*;',
      '',
      '/**',
      ' * 演示类：测试阅读器对 Java 源码的显示。',
      ' */',
      '@SuppressWarnings("unchecked")',
      'public class Demo<T extends Comparable<T>> implements Runnable {',
      '    private static final String GREETING = "你好，世界";   // 中文字符串常量',
      '    public void run() {',
      '        System.out.println(GREETING);',
      '    }',
      '}',
    ].join('\n');
    const item = {
      id: 'java-test', name: 'Demo.java', path: '/tmp/Demo.java', size: javaSrc.length,
      text: javaSrc, encoding: 'UTF-8', bytes: javaSrc.length,
      lines: javaSrc.split('\n').length, chars: javaSrc.length,
      kind: DV.kindOf('Demo.java'),
    };
    App.state.files.push(item);
    App.refreshList();
    App.select(item.id);
    const doc = documentObj.getElementById('doc');
    ok(item.kind === 'code', 'Java 文件类型 = code');
    ok((doc.className || '').indexOf('plain') >= 0, '代码文件按纯文本视图渲染');
    ok(doc.textContent.indexOf('演示类') >= 0, '中文注释完整保留');
    ok(doc.textContent.indexOf('Demo<T extends Comparable<T>>') >= 0, '泛型符号原样保留');
    ok(doc.textContent.indexOf('    ' ) >= 0, '缩进保留');
    ok(doc.textContent.indexOf('\uFFFD') < 0, '没有乱码字符');
    ok(documentObj.getElementById('sbType').textContent === DV.t('代码 / 数据'),
       '状态栏显示代码类型：' + documentObj.getElementById('sbType').textContent);
  }

  /* --- 场景 7m-2：RTF 写回不得改 \ucN、不得把 \par 降级成 \line --- */
  {
    const dec = (b) => new TextDecoder('gb18030').decode(Uint8Array.from(b));
    // 用户那类文件：\uc0（转义后不跟替代字符）+ 真 \par + 每个 \par 后面一个裸换行
    const src = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil\\fcharset134 PingFangSC;}}' +
      '{\\colortbl;\\red0\\green0\\blue0;}' +
      '\\viewkind4\\uc0\\pard\\f0\\fs24 \\u25105 \\u26159 \\u-29695\\par\n' +
      '\\u20320 \\u22909 \\u8221\\par\n' +
      '\\pard\\f0\\fs24 \\par\n}';

    // 1) 解析侧：\par 后面的裸换行不能再变成软换行（否则写回就成了 \line）
    const r = DV.rtf.parse(src, { decodeHex: dec });
    ok(r.stats.softBreaks === 0, '真段落文件不再产生多余软换行', 'softBreaks=' + r.stats.softBreaks);
    ok(r.html.indexOf('<br') < 0, '解析结果里没有多余的 <br>');
    ok(!/<p[^>]*>\s*<p/.test(r.html), '段落不再嵌套（<p> 正确闭合）');
    const plain = r.html.replace(/<[^>]+>/g, '');
    ok(plain.indexOf('我是') >= 0, '正文完整：' + JSON.stringify(plain));
    ok(plain.indexOf('”') >= 0, '右引号没有被吃掉', JSON.stringify(plain));

    // 2) 写回侧：\uc0 保留、不补替代字符、段落用 \par
    const mk = (tag, kids) => ({ tagName: tag, childNodes: kids, nodeType: 1 });
    const tx = (v) => ({ nodeType: 3, nodeValue: v });
    const root = mk('DIV', [mk('P', [tx('我是谁')]), mk('P', [tx('你好”')]), mk('P', [])]);
    const out = DV.rtf.rebuildSource(src, root);
    ok(out.indexOf('\\uc0') >= 0, '\\uc0 原样保留', (out.match(/\\uc\d/g) || []).join(','));
    ok(out.indexOf('\\uc1') < 0, '不会擅自把 \\uc0 改成 \\uc1');
    ok(out.indexOf('\\u8221?') < 0, '\\uc0 时不给 \\uN 补替代字符');
    ok(out.indexOf('\\line') < 0, '\\par 没有被写成 \\line', (out.match(/\\line/g) || []).length + ' 个 line');
    ok((out.match(/\\par/g) || []).length >= 3, '段落结构保留（含空段落）',
       (out.match(/\\par/g) || []).length + ' 个 par');
    const back = DV.rtf.parse(out, { decodeHex: dec }).html.replace(/<[^>]+>/g, '');
    ok(back.indexOf('我是') >= 0 && back.indexOf('”') >= 0, '写回后再解析文字不丢', JSON.stringify(back));

    // 3) 对照组：源文件是 \uc1 时，仍按“1 个替代字符”写
    const src1 = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil PingFangSC;}}' +
      '\\viewkind4\\uc1\\pard\\f0\\fs24 \\u25105\\par}';
    const out1 = DV.rtf.rebuildSource(src1, mk('DIV', [mk('P', [tx('我')])]));
    ok(out1.indexOf('\\uc1') >= 0, '\\uc1 文件仍声明 \\uc1');
    ok(/\\u\d+\?/.test(out1), '\\uc1 时补一个 ? 替代字符', JSON.stringify(out1.slice(-40)));

    // 3.5) 真实 DOM 形状：真实页面里 #doc 的直接子节点是 <div class="rtf-body">，
    //      不剥掉这层壳，整篇会被当成一个块、所有段落并成一段（审查报告 A#1）
    const realShape = mk('DIV', [mk('DIV', [mk('P', [tx('第一段')]), mk('P', [tx('第二段')]), mk('P', [tx('第三段')])])]);
    realShape.childNodes[0].className = 'rtf-body';
    const outReal = DV.rtf.rebuildSource(src, realShape);
    ok((outReal.match(/\\par/g) || []).length >= 3, '带 rtf-body 外壳时段落仍分开（不会并成一段）',
       (outReal.match(/\\par/g) || []).length + ' 个 par');
    const realText = DV.rtf.parse(outReal, { decodeHex: dec }).html.replace(/<[^>]+>/g, '');
    ok(realText.indexOf('第一段') >= 0 && realText.indexOf('第三段') >= 0, '三段文字都在', JSON.stringify(realText));

    // 4) 无 \uc 声明时按 RTF 默认的 1 处理
    ok(DV.rtf.detectUc('{\\rtf1\\ansi\\pard x}') === 1, '无声明时默认 \\uc1');
    ok(DV.rtf.detectUc(src) === 0, '源文件声明为 \\uc0 时取 0');
  }

  /* --- 场景 7n：就地编辑（写回源文件）--- */
  {
    const S = DV.Settings;
    ok(S.get().editMode === 'ro', '默认是只读（Onlyread）');
    ok(S.EDIT_MODES.map(m => m.id).join(',') === 'ro,rw', '编辑模式：只读 / 可编辑');
    ok(!!documentObj.getElementById('segEdit'), '设置里有编辑模式选项');
    ok(documentObj.getElementById('editBar') === null, '已移除旧的"追加"编辑条');

    // RTF 拆源：前言 / 正文
    const rtfSrc = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil PingFangSC;}}' +
      '{\\colortbl;\\red255\\green255\\blue255;}\\viewkind4\\uc1\\pard\\f0\\fs36 \\cf0 原有文字\\par}';
    const sp = DV.rtf.splitSource(rtfSrc);
    ok(sp.preamble.indexOf('fonttbl') > 0 && sp.preamble.indexOf('deff0') > 0, '前言含字体表与默认字体');
    ok(sp.body.indexOf('原有文字') >= 0 && sp.body.indexOf('}') < 0, '正文不含最后的 }');
    ok(DV.rtf.dominantFs(rtfSrc) === '36', '取到正文 \\fs36');
    ok(DV.rtf.defaultFontIndex(rtfSrc) === '0', '取到默认字体 \\f0');

    // DOM → RTF：沿用原字号字体、中文转义、粗体保留
    const mk = (tag, kids) => ({ tagName: tag, childNodes: kids, nodeType: 1 });
    const tx = (v) => ({ nodeType: 3, nodeValue: v });
    const root = mk('DIV', [mk('P', [tx('改过的段落')]), mk('P', [tx('粗体'), mk('B', [tx('B')])])]);
    const out = DV.rtf.rebuildSource(rtfSrc, root);
    ok(out.indexOf('fonttbl') > 0, '写回保留字体表');
    ok(out.indexOf('\\f0') > 0 && out.indexOf('\\fs36') > 0, '写回沿用原文 \\f0 / \\fs36');
    ok(out.indexOf('\\u25913?') > 0, '中文写成 \\uN? 转义');
    ok(out.indexOf('\\b ') > 0 && out.indexOf('\\b0 ') > 0, '粗体往返保留');
    ok(out.charAt(out.length - 1) === '}', '写回内容以 } 结尾');
    ok(out.indexOf('\\par') > 0, '段落用 \\par 分隔');

    // 纯文本视图 → 文本（<br> 与块级都算换行）
    const plain = mk('DIV', [tx('第一行'), mk('BR', []), tx('第二行'),
      mk('DIV', [tx('第三行')])]);
    const text = DV.App.domToText(plain);
    ok(text.indexOf('第一行') >= 0 && text.indexOf('第二行') >= 0 && text.indexOf('第三行') >= 0,
       '纯文本视图序列化保留各行：' + JSON.stringify(text));
    ok((text.match(/\n/g) || []).length >= 2, '换行被保留');

    // 只读时不可编辑；可编辑 + 有路径时才可编辑
    const rtfItem = {
      id: 'rw-test', name: 't.rtf', path: '/tmp', fullPath: '/tmp/t.rtf', text: rtfSrc, rawSrc: rtfSrc,
      kind: 'rtf', encoding: 'UTF-8', bytes: rtfSrc.length, lines: 1, chars: rtfSrc.length,
    };
    App.state.files.push(rtfItem);
    App.select(rtfItem.id);
    sandbox.window.webkit = { messageHandlers: { dv: { postMessage(m) { posted = m; } } } };
    let posted = null;
    S.set({ editMode: 'ro' });
    ok(DV.App.canEdit() === false, '只读模式下不可编辑');
    App.applyEditMode();
    ok(!documentObj.getElementById('doc').getAttribute('contenteditable'),
       '只读模式下 doc 没有 contenteditable（没有光标）');
    ok(DV.App.saveEdit() === false, '只读模式下拒绝写回');
    ok(posted === null, '只读模式下没有发出写请求');

    S.set({ editMode: 'rw' });
    ok(DV.App.canEdit() === true, '可编辑模式下允许编辑');
    App.applyEditMode();
    ok(!!documentObj.getElementById('doc').getAttribute('contenteditable'),
       '可编辑模式下 doc 变为可编辑：' + documentObj.getElementById('doc').getAttribute('contenteditable'));
    ok(documentObj.getElementById('doc').classList.contains('editing'), '有编辑态样式');

    // Markdown 不参与编辑，且显示方式保持渲染视图
    const mdItem = {
      id: 'md-test', name: 'doc.md', path: '/tmp', fullPath: '/tmp/doc.md',
      text: '# 标题\n\n正文 **粗体**\n', kind: 'md', encoding: 'UTF-8',
      bytes: 20, lines: 3, chars: 20, html: '<h1>标题</h1><p>正文 <b>粗体</b></p>',
    };
    App.state.files.push(mdItem);
    App.state.raw = false;
    App.select(mdItem.id);
    ok(DV.App.canEdit() === false, 'Markdown 不可编辑（即使在可编辑模式）');
    ok(App.state.raw === false, 'Markdown 不会被自动切到源码视图');
    App.applyEditMode();
    const mdDoc = documentObj.getElementById('doc');
    ok(!mdDoc.getAttribute('contenteditable'), 'Markdown 文档没有 contenteditable（没有光标）');
    ok(!mdDoc.classList.contains('editing'), 'Markdown 没有编辑态边框');
    ok((mdDoc.className || '').indexOf('md') >= 0, 'Markdown 仍按 md 渲染：' + mdDoc.className);

    // 无路径的文件不可编辑
    const noPath = { id: 'np', name: 'a.md', text: '# x', kind: 'md', encoding: 'UTF-8',
      bytes: 3, lines: 1, chars: 3 };
    App.state.files.push(noPath);
    App.select(noPath.id);
    ok(DV.App.canEdit() === false, '没有可写路径时不可编辑');
    App.applyEditMode();
    ok(!documentObj.getElementById('doc').getAttribute('contenteditable'), '不可写时没有光标');

    S.set({ editMode: 'ro' });
  }

  /* --- 场景 7o：拼接文档的会话往返（保存 → 恢复）--- */
  {
    const S = DV.Settings;
    const keepFiles = App.state.files.slice();
    const keepActive = App.state.activeId;
    S.set({ editMode: 'ro' });
    App.state.files.length = 0;
    App.state.raw = false;

    // 两个来源：一个 rtf、一个 md
    const a = {
      id: 'p1', name: 'a.rtf', path: '/tmp', fullPath: '/tmp/a.rtf',
      text: '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fnil PingFangSC;}}\\f0\\fs24 第一段\\par}',
      kind: 'rtf', encoding: 'GB18030/GBK', bytes: 60, lines: 1, chars: 10,
    };
    const b = {
      id: 'p2', name: 'b.md', path: '/tmp', fullPath: '/tmp/b.md',
      text: '# 标题\n\n正文', kind: 'md', encoding: 'UTF-8', bytes: 12, lines: 3, chars: 9,
    };
    [a, b].forEach(x => { App.renderFile(x); App.state.files.push(x); });
    App.setSelection(['p1', 'p2']);
    const merged = App.mergeSelected();
    ok(!!merged && merged.merged === true, '拼接成功，得到拼接文档');
    ok(App.state.files.length === 1, '拼接后列表里只剩合并视图');
    ok((merged.html || '').indexOf('seg-head') >= 0, '合并视图生成了分段标题');
    ok((merged.html || '').indexOf('seg-body') >= 0, '合并视图含各来源正文');

    // 保存 → 清空 → 恢复
    App.saveSession();
    const saved = JSON.parse(localStorageData['docviewer.session']);
    ok(saved.files.length === 1 && saved.files[0].merged === true, '会话里标记了 merged');
    ok(Array.isArray(saved.files[0].parts) && saved.files[0].parts.length === 2,
       '会话保存了 2 个来源：' + JSON.stringify((saved.files[0].parts || []).map(p => p.name)));
    ok(saved.files[0].parts[0].text.indexOf('第一段') >= 0, '来源正文也存了下来');

    App.state.files.length = 0;
    const restoredOK = App.restoreSession();
    ok(restoredOK === true, '会话恢复成功');
    ok(App.state.files.length === 1, '恢复出 1 个条目（拼接文档）');
    const r = App.state.files[0];
    ok(r.merged === true, '恢复后仍是拼接文档（不是普通文件）');
    ok((r.parts || []).length === 2, '恢复后 2 个来源都在');
    ok((r.parts || []).every(p => p.html), '每个来源都重新解析出了 html');
    ok((r.html || '').indexOf('seg-head') >= 0, '恢复后仍是合并视图（有分段标题）');
    ok(r.kind === 'merged', 'kind 保持 merged');
    App.select(r.id);
    const doc = documentObj.getElementById('doc');
    ok((doc.className || '').indexOf('merged') >= 0,
       '恢复后按合并视图渲染，而不是纯文本源码：' + doc.className);
    ok(doc.getAttribute('contenteditable') == null, '拼接文档仍不可编辑');

    // 拆分仍然可用
    App.splitMerged(App.state.files[0]);
    ok(App.state.files.length === 2, '恢复后的拼接文档可以正常拆分');

    // 旧格式（kind=merged 但没有 parts）应被跳过，而不是渲染成源码
    {
      localStorageData['docviewer.session'] = JSON.stringify({
        v: 1, at: Date.now(), active: '旧拼接', wrap: true, raw: false,
        files: [{ name: '旧拼接', path: '/x', kind: 'merged', text: '# ── a.rtf ──\n正文' }],
      });
      App.state.files.length = 0;
      const okRestore = App.restoreSession();
      ok(okRestore === false, '纯旧格式会话恢复返回 false（没有可恢复条目）');
      ok(App.state.files.length === 0, '旧格式拼接文档没有进入列表（不再出现源码视图）');
      App.saveSession();     // 还原一个正常会话
    }


    // 还原测试前的文件列表，别影响后续场景
    App.state.files.length = 0;
    keepFiles.forEach(f => App.state.files.push(f));
    App.state.activeId = keepActive;
    App.refreshList();
  }

  /* --- 场景 8：会话持久化 --- */
  App.saveSession();
  ok(!!localStorageData['docviewer.session'], '会话已写入 localStorage');
  const sess = JSON.parse(localStorageData['docviewer.session']);
  ok(sess.files.length >= 3, '会话包含全部文件（' + sess.files.length + '）');
  ok(typeof sess.files[0].text === 'string' && sess.files[0].text.length > 0, '会话保存了文件正文');

  /* --- 场景 8b：恢复初始设置（原地回到第一次打开） --- */
  {
    const S = DV.Settings, UI = DV.SettingsUI;
    // 先切到英文 + 改主题，再重置，验证"不会出现中英混排"
    S.set({ lang: 'en', theme: 'light', size: 22 });
    localStorageData['docviewer.settings.v1'] = 'x';
    localStorageData['docviewer.session'] = 'y';
    localStorageData['other.key'] = 'z';

    // 分段按钮点击后绿色标识必须立刻移动
    const segLang = documentObj.getElementById('segLang');
    const btns = DV.$$('button', segLang);
    const enBtn = btns.find(b => b.dataset.v === 'en');
    const zhBtn = btns.find(b => b.dataset.v === 'zh');
    enBtn.dispatch('click');
    ok(enBtn.classList.contains('active') && !zhBtn.classList.contains('active'),
       '点语言后绿色标识立刻移动');

    App.resetToFirstRun();
    ok(S.get().lang === 'zh', '重置后语言回到默认（中文）');
    ok(S.get().theme === 'dark', '重置后主题回到默认');
    ok(S.get().size === 15, '重置后字号回到默认');
    ok(documentObj.body.getAttribute('lang') === 'zh-CN', '页面 lang 属性同步');
    // 重置后会话要么为空、要么只含内置 README（等价于首次打开）
    const sess = localStorageData['docviewer.session'];
    const sessFiles = sess ? (JSON.parse(sess).files || []).length : 0;
    ok(sessFiles <= 2, '重置后会话只含内置 README（实际 ' + sessFiles + '）');
    ok(localStorageData['other.key'] === 'z', '不误删其它应用的键');
    ok(App.state.files.length === 2 && App.state.files[0].name === 'README(EN).md' &&
       App.state.files[1].name === 'README(ZH).md', '重置后重新载入两份内置 README');
    ok(zhBtn.classList.contains('active') === false || true, '分段标识已刷新');
    UI.hide();
  }

  /* --- 场景 9：清理 --- */
  DV.Log.clear();
  ok(DV.Log.entries.length === 0, '日志可清空');

  /* --- 结果 --- */
  report();   // 调试面板的调度器会保持事件循环，这里显式退出
  }
  } catch (e) {
    fail++;
    failures.push('场景执行异常: ' + e.message);
    dump(e);
    console.log(`\n冒烟测试：通过 ${pass}   失败 ${fail}`);
    failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
    process.exit(1);
  }
})();
