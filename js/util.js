/* =====================================================================
   util.js — 命名空间 / 图标 / DOM 助手 / 格式化 / 日志
   ===================================================================== */
window.DV = window.DV || {};

/* ---------------- lucide 图标（内联 path，零网络依赖） ---------------- */
const ICON_PATHS = {
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  // 追加内容（lucide file-plus）
  edit: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M12 12v6"/><path d="M9 15h6"/>',
  // 小齿轮（lucide settings）
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  'file-code': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>',
  'file-type': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M12 13v6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'folder-open': '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  'hard-drive': '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  'corner-down-right': '<polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  'file-warning': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  // 图片（lucide image）
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  // PDF（lucide file + 折角 + 两条线）
  'file-pdf': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 16h1.5a1.5 1.5 0 0 0 0-3H8v6"/><path d="M13.5 13v6h1a3 3 0 0 0 0-6z"/><path d="M19 13h-2.5v3h2"/><path d="M16.5 16v3"/>',
  // Pages（lucide presentation）
  presentation: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
  // Word（lucide file-type 的变体：带 W 形折线）
  'file-word': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m8 12 1.6 6 2.4-4.4L14.4 18 16 12"/>',
  // 放大 / 缩小
  'zoom-in': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
  'zoom-out': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>',
  'maximize-2': '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
};

DV.icon = function (name, cls) {
  const body = ICON_PATHS[name] || ICON_PATHS['file-text'];
  return '<span class="ms' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" stroke="currentColor">' + body + '</svg></span>';
};

/* ---------------- DOM 助手 ---------------- */
DV.$ = (sel, root) => (root || document).querySelector(sel);
DV.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
DV.el = function (tag, attrs, children) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'text') n.textContent = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else n.setAttribute(k, attrs[k]);
  }
  (children || []).forEach(c => n.appendChild(c));
  return n;
};

/* ---------------- 面板开合动效（侧栏 / 设置 / 调试都用同一套） ---------------- */
DV.animOff = function () {
  try { return DV.Settings && DV.Settings.get().anim === 'off'; } catch (e) { return false; }
};

/** 展开：从宽度 0 平滑撑开 */
DV.openPane = function (el) {
  if (!el || !el.hidden) return;
  el.classList.remove('pane-closing');
  el.classList.add('pane-opening');
  el.hidden = false;
  if (DV.animOff()) { el.classList.remove('pane-opening'); return; }
  void el.offsetWidth;                    // 强制回流，让 0 → 340px 有过渡起点
  el.classList.remove('pane-opening');
};

/** 收起：先动画缩到 0，再真正隐藏；done 在结束后回调 */
DV.closePane = function (el, done) {
  if (!el || el.hidden) { if (done) done(); return; }
  if (DV.animOff()) { el.hidden = true; if (done) done(); return; }
  el.classList.remove('pane-opening');
  el.classList.add('pane-closing');
  const finish = () => {
    el.hidden = true;
    el.classList.remove('pane-closing');
    if (done) done();
  };
  let done2 = false;
  const once = () => { if (done2) return; done2 = true; el.removeEventListener('transitionend', once); finish(); };
  el.addEventListener('transitionend', once);
  setTimeout(once, 420);                  // 兜底：动画事件丢失也能收尾
};

/* ---------------- 格式化 ---------------- */
DV.esc = function (s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
};
DV.escAttr = DV.esc;

DV.fmtBytes = function (n) {
  if (n == null || isNaN(n)) return '—';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n < 10 ? n.toFixed(2) : n.toFixed(1)) + ' ' + u[i];
};
DV.fmtNum = n => (n == null ? '—' : n.toLocaleString('en-US'));
DV.fmtMs = function (ms) {
  if (ms == null) return '—';
  if (ms < 1) return ms.toFixed(2) + ' ms';
  if (ms < 1000) return ms.toFixed(1) + ' ms';
  return (ms / 1000).toFixed(2) + ' s';
};
DV.fmtTime = function (d) {
  const p = x => String(x).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) +
    '.' + String(d.getMilliseconds()).padStart(3, '0');
};
DV.fmtDuration = function (sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const p = x => String(x).padStart(2, '0');
  return (h ? h + ':' : '') + p(m) + ':' + p(s);
};

DV.ext = function (name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
};
DV.baseName = function (p) {
  return String(p).replace(/\\/g, '/').split('/').pop() || p;
};
DV.dirName = function (p) {
  const s = String(p).replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i <= 0 ? '' : s.slice(0, i);
};
DV.KIND = {
  rtf: { label: 'RTF 富文本', icon: 'file-type', color: '#e5a03c' },
  md: { label: 'Markdown', icon: 'book', color: '#6fb3e0' },
  txt: { label: '纯文本', icon: 'file-text', color: '#8cc63f' },
  code: { label: '代码 / 数据', icon: 'file-code', color: '#c792ea' },
  image: { label: '图片', icon: 'image', color: '#4fc1a6' },
  pdf: { label: 'PDF', icon: 'file-pdf', color: '#e5604c' },
  docx: { label: 'Word 文档', icon: 'file-word', color: '#5a8de0' },
  pages: { label: 'Pages 文稿', icon: 'presentation', color: '#e0a13c' },
  other: { label: '未知类型', icon: 'file-warning', color: '#e5604c' },
  merged: { label: '拼接文档', icon: 'layers', color: '#8cc63f' },
};

/** 只能看、不能编辑的类型（二进制 / 专有格式） */
DV.BINARY_KINDS = { image: 1, pdf: 1, docx: 1, pages: 1 };
DV.isBinaryKind = function (k) { return !!DV.BINARY_KINDS[k]; };
DV.kindOf = function (name) {
  const e = DV.ext(name);
  if (e === 'rtf') return 'rtf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif',
    'avif', 'ico', 'svg'].indexOf(e) >= 0) return 'image';
  if (e === 'pdf') return 'pdf';
  if (e === 'docx' || e === 'doc' || e === 'rtfd') return 'docx';
  if (e === 'pages') return 'pages';
  if (e === 'md' || e === 'markdown' || e === 'mdown' || e === 'mkd') return 'md';
  if (['txt', 'text', 'log', 'nfo', 'ini', 'cfg', 'conf'].includes(e)) return 'txt';
  // 代码 / 数据 / 配置：与打开对话框的 accept 列表保持一致
  if (['json', 'jsonc', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte',
    'py', 'java', 'kt', 'kts', 'scala', 'groovy', 'gradle', 'properties', 'env',
    'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'go', 'rs', 'swift', 'm', 'mm',
    'rb', 'php', 'pl', 'lua', 'r', 'dart', 'ex', 'exs', 'clj', 'hs', 'fs', 'vb',
    'asm', 's', 'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1',
    'html', 'htm', 'css', 'scss', 'less', 'sass',
    'xml', 'yml', 'yaml', 'toml', 'sql', 'csv', 'tsv'].includes(e)) return 'code';
  return 'other';
};
DV.isTextLike = k => k !== 'other' || true; // 一律按文本处理，未知类型也尝试阅读

/* ---------------- Toast ---------------- */
DV.toast = function (msg, type, ttl) {
  const box = DV.$('#toasts');
  if (!box) return;
  const t = DV.el('div', { class: 'toast' + (type ? ' ' + type : ''), text: msg });
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 240); }, ttl || 2600);
};

/* ---------------- 多选一对话框（Promise） ----------------
   需要用户明确选一条路时用（例如「文件在磁盘上被改过」的三选一），
   不依赖原生 window.confirm（它只能表达两个选项）。
   opts: { title, text, options: [{id,label,kind}] } → resolve(id)  */
DV.choose = function (opts) {
  opts = opts || {};
  const options = opts.options || [];
  return new Promise(function (resolve) {
    let box = DV.$('#dvChoose');
    if (box && box.parentNode) box.parentNode.removeChild(box);
    const overlay = DV.el('div', { class: 'dv-choose', id: 'dvChoose' });
    const card = DV.el('div', { class: 'dv-choose-card' });
    if (opts.title) card.appendChild(DV.el('div', { class: 'dv-choose-title', text: opts.title }));
    if (opts.text) card.appendChild(DV.el('div', { class: 'dv-choose-text', text: opts.text }));
    const row = DV.el('div', { class: 'dv-choose-actions' });
    let settled = false;
    const done = function (v) {
      if (settled) return;
      settled = true;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    options.forEach(function (o) {
      const b = DV.el('button', { class: 'btn' + (o.kind ? ' ' + o.kind : ''), text: o.label });
      b.addEventListener('click', function () { done(o.id); });
      row.appendChild(b);
    });
    card.appendChild(row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); done((options[options.length - 1] || {}).id); }
    }
    document.addEventListener('keydown', onKey, true);
  });
};

/* ---------------- 日志（调试面板 + 控制台） ---------------- */
DV.Log = (function () {
  const MAX = 500;
  const entries = [];
  const counts = { info: 0, ok: 0, warn: 0, error: 0, debug: 0 };
  let onPush = null;

  function push(level, msg) {
    const e = { level, msg: String(msg), t: new Date() };
    entries.push(e);
    if (entries.length > MAX) entries.shift();
    counts[level] = (counts[level] || 0) + 1;
    if (onPush) onPush(e);
    const c = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (DV.debugEnabled || level === 'error' || level === 'warn') c('[DocViewer]', msg);
  }
  return {
    entries, counts,
    info: m => push('info', m), ok: m => push('ok', m),
    warn: m => push('warn', m), error: m => push('error', m),
    debug: m => push('debug', m),
    subscribe: fn => { onPush = fn; },
    clear: function () {
      entries.length = 0;
      for (const k in counts) counts[k] = 0;
      if (onPush) onPush(null);
    },
  };
})();
