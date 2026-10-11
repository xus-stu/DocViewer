/* =====================================================================
   settings.js — 设置系统
   主题预设 / 自定义配色 / 字体 / 排版 / 帧率分档 / 动画强度 / 沉浸式阅读
   把结果写成 body 上的 data-* 属性与 CSS 自定义属性，样式全部由 CSS 消费。
   ===================================================================== */
window.DV = window.DV || {};

DV.Settings = (function () {

  const KEY = 'docviewer.settings.v1';

  /* ---------------- 可选值 ---------------- */
  const THEMES = [
    { id: 'dark', label: '深色', desc: '默认', accent: '#8cc63f' },
    { id: 'blue', label: '蓝色系', desc: '冷色', accent: '#4a9eff' },
    { id: 'green', label: '绿色系', desc: '自然', accent: '#52c41a' },
    { id: 'light', label: '浅色', desc: '明亮', accent: '#8cc63f' },
    { id: 'sepia', label: '羊皮纸', desc: '护眼', accent: '#a4713d' },
    { id: 'custom', label: '自定义', desc: '自己配色', accent: '#8cc63f' },
  ];

  /** 自定义主题需要接管这些变量（切回预设主题时要全部清掉） */
  const CUSTOM_VARS = ['--bg', '--bg-2', '--bg-3', '--bg-4', '--bg-hover', '--titlebar',
    '--line', '--line-soft', '--text', '--text-2', '--text-3',
    '--accent', '--accent-2', '--accent-ink', '--sel'];


  function hexLum(hex) {
    const h = String(hex || '#000').replace('#', '');
    if (h.length < 6) return 0;
    const ch = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255);
    const f = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * f(ch[0]) + 0.7152 * f(ch[1]) + 0.0722 * f(ch[2]);
  }

  function mix(a, b, pct) { return 'color-mix(in srgb, ' + a + ' ' + (100 - pct) + '%, ' + b + ' ' + pct + '%)'; }

  /** 用 4 个基础色推导出一整套配色，做到"换主题=所有颜色都换" */
  function applyCustomTheme(body, ct) {
    const bg = ct.bg, bg2 = ct.bg2, text = ct.text, accent = ct.accent;
    const dark = hexLum(bg) < 0.45;
    const set = (k, v) => body.style.setProperty(k, v);
    set('--bg', bg);
    set('--bg-2', bg2);
    set('--bg-3', mix(bg2, text, 6));
    set('--bg-4', mix(bg2, text, 12));
    set('--bg-hover', mix(bg2, text, 18));
    set('--titlebar', dark ? mix(bg, '#000000', 22) : mix(bg, '#000000', 8));
    set('--line', mix(bg2, text, 24));
    set('--line-soft', mix(bg2, text, 12));
    set('--text', text);
    set('--text-2', mix(text, bg2, 22));       // 次要文字
    set('--text-3', mix(text, bg2, 36));       // 最淡文字（仍保证可读）
    set('--accent', accent);
    set('--accent-2', mix(accent, '#000000', 18));
    set('--accent-ink', hexLum(accent) > 0.5 ? '#12170c' : '#ffffff');
    set('--sel', mix(accent, 'transparent', 78));
  }

  const FONTS = [
    { id: 'system', label: '系统默认', stack: null, note: '跟随界面字体' },
    { id: 'song', label: '宋体', stack: '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", Georgia, serif', note: '衬线，适合长文' },
    { id: 'serif', label: '西文衬线', latin: true, stack: 'Georgia, "Times New Roman", "Songti SC", serif', note: 'Georgia / Times' },
    { id: 'kai', label: '楷体', stack: '"Kaiti SC", "STKaiti", "KaiTi", serif', note: '手写感' },
    { id: 'hei', label: '黑体', stack: '"PingFang SC", "Microsoft YaHei", sans-serif', note: '无衬线，屏幕友好' },
    { id: 'mono', label: '等宽', latin: true, stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', note: '代码与表格' },
    /* --- 西文 / 英文字体 --- */
    { id: 'georgia', label: 'Georgia', latin: true, stack: 'Georgia, "Times New Roman", serif', note: '英文正文衬线' },
    { id: 'times', label: 'Times New Roman', latin: true, stack: '"Times New Roman", Times, serif', note: '经典英文衬线' },
    { id: 'palatino', label: 'Palatino', latin: true, stack: 'Palatino, "Palatino Linotype", "Book Antiqua", serif', note: '优雅英文衬线' },
    { id: 'charter', label: 'Charter', latin: true, stack: 'Charter, "Bitstream Charter", Georgia, serif', note: '适合长文阅读' },
    { id: 'avenir', label: 'Avenir Next', latin: true, stack: '"Avenir Next", Avenir, "Helvetica Neue", sans-serif', note: '现代无衬线' },
    { id: 'helvetica', label: 'Helvetica Neue', latin: true, stack: '"Helvetica Neue", Helvetica, Arial, sans-serif', note: '中性无衬线' },
    { id: 'menlo', label: 'Menlo', latin: true, stack: 'Menlo, Monaco, "SF Mono", monospace', note: '等宽（代码）' },
    { id: 'courier', label: 'Courier New', latin: true, stack: '"Courier New", Courier, monospace', note: '打字机等宽' },
    { id: 'custom', label: '自定义', stack: null, note: '手动输入字体名' },
  ];

  const FRAME_RATES = [
    { v: 0, label: '不限' },
    { v: 30, label: '30' },
    { v: 60, label: '60' },
    { v: 120, label: '120' },
    { v: 180, label: '180' },
    { v: 240, label: '240' },
  ];

  const ANIMS = [
    { id: 'off', label: '关闭' },
    { id: 'subtle', label: '轻量' },
    { id: 'full', label: '完整' },
  ];

  const EDIT_MODES = [
    { id: 'ro', label: '只读' },
    { id: 'rw', label: '可编辑' },
  ];

  const LANGS = [
    { id: 'zh', label: '中文' },
    { id: 'en', label: 'English' },
  ];

  const META_FIELDS = [
    { id: 'path', label: '路径' },
    { id: 'size', label: '文件大小' },
    { id: 'encoding', label: '编码' },
    { id: 'type', label: '文件类型' },
    { id: 'lines', label: '行数' },
    { id: 'chars', label: '字符数' },
  ];

  const ANIM_SPEEDS = [
    { v: 0.7, label: '快' },
    { v: 1, label: '标准' },
    { v: 1.4, label: '慢' },
  ];

  // 注意：底色只作用于「阅读区」，不要去改全局 --bg/--bg-2，
  // 否则侧栏背景会被改掉而文字仍跟主题走，出现"文字看不见"。
  const COLOR_TARGETS = [
    { id: 'text', label: '正文颜色', cssVar: '--doc-color' },
    { id: 'accent', label: '界面强调色', cssVar: '--accent' },
    { id: 'bg', label: '阅读区底色', cssVar: '--doc-bg' },
  ];

  const COLOR_PRESETS = {
    text: ['#e7eaee', '#dfe4ea', '#c9d1d9', '#3d3423', '#22262b', '#8cc63f', '#6fb3e0', '#e5a03c'],
    accent: ['#8cc63f', '#6fa32c', '#4a9eff', '#b06bff', '#ff7a59', '#e5a03c', '#e5604c', '#29c0b0'],
    bg: ['#17191c', '#1b1d20', '#101214', '#20232a', '#f6efe0', '#ece3d2', '#f2f3f5', '#ffffff'],
  };

  /* ---------------- 默认值 ---------------- */
  const DEFAULTS = {
    theme: 'dark',
    lang: 'zh',        // zh | en
    font: 'system',
    fontCustom: '',
    size: 15,          // 正文基础字号 px
    lineHeight: 1.8,   // 行高倍数
    width: 860,        // 阅读区最大宽度 px
    pad: 22,           // 顶部留白
    colors: {},        // { text, accent, bg } → 覆盖 CSS 变量
    immersiveWidth: 42,// 沉浸模式宽度（em）
    rtfSoftWrap: true, // 把 RTF 里的裸换行当作软换行（TextEdit 导出的文件靠它分段）
    rtfReaderFont: true, // 忽略 RTF 自带字体/字号，统一用阅读器设置呈现
    editMode: 'ro',    // ro = 只读（默认，Onlyread）｜ rw = 可编辑（可把内容追加回源文件）
    frameRate: 240,    // 渲染帧率上限；0 = 不限
    anim: 'subtle',    // off | subtle | full
    animSpeed: 1,      // 动画时长倍率：0.7 快 / 1 标准 / 1.4 慢
    immersive: false,
    sidebar: true,     // 侧栏是否显示（可单独收起）
    showTitlebar: true,// 是否显示应用标题栏（DocViewer 那一行）
    rememberSession: true, // 记住会话（默认启用）
    customTheme: {     // 「自定义」主题的 4 个基础色
      bg: '#15181c', bg2: '#1d2126', text: '#f2f5f8', accent: '#8cc63f',
    },
    metaFields: {      // 文件名下方那行显示哪些字段
      path: true, size: true, encoding: true, type: false, lines: true, chars: false,
    },
  };

  let cur = Object.assign({}, DEFAULTS);
  let lastLang = null;
  const subs = [];

  /* ---------------- 读写 ---------------- */
  function prefersReduced() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && typeof saved === 'object') {
      cur = Object.assign({}, DEFAULTS, saved);
      cur.colors = Object.assign({}, saved.colors || {});
      cur.metaFields = Object.assign({}, DEFAULTS.metaFields, saved.metaFields || {});
      cur.customTheme = Object.assign({}, DEFAULTS.customTheme, saved.customTheme || {});
    } else {
      // 首次运行且系统开启了"减少动态效果"：默认关闭动画
      if (prefersReduced()) cur.anim = 'off';
      // 兼容旧会话里的字号设置
      try {
        const old = JSON.parse(localStorage.getItem('docviewer.session') || 'null');
        if (old && old.fontSize) cur.size = Math.round(old.fontSize);
      } catch (e) { /* 忽略 */ }
    }
    return cur;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cur)); }
    catch (e) { DV.Log.warn('设置保存失败：' + (e && e.name)); }
  }

  /* ---------------- 应用 ---------------- */
  function fontStack() {
    const f = FONTS.find(x => x.id === cur.font) || FONTS[0];
    if (cur.font === 'custom') return (cur.fontCustom || '').trim() || null;
    return f.stack;
  }

  function apply(opt) {
    const body = document.body;
    const root = document.documentElement;

    // 优先用 data-theme 里的预设值；自定义颜色再覆盖
    body.setAttribute('data-theme', cur.theme);
    body.setAttribute('data-font', cur.font);
    body.setAttribute('data-anim', cur.anim);
    body.setAttribute('data-rtf-font', cur.rtfReaderFont === false ? 'native' : 'reader');
    body.setAttribute('lang', cur.lang === 'en' ? 'en' : 'zh-CN');
    if (DV.applyI18n && lastLang !== cur.lang) {
      lastLang = cur.lang;
      DV.applyI18n();                        // 只在语言变化时重扫，避免滑杆每动一下都遍历 DOM
    }

    root.style.setProperty('--anim-speed', String(cur.animSpeed || 1));
    body.classList.toggle('no-titlebar', cur.showTitlebar === false);
    const tb = document.querySelector('.titlebar');
    if (tb) tb.hidden = cur.showTitlebar === false;
    root.style.setProperty('--doc-size', cur.size + 'px');
    root.style.setProperty('--doc-line', String(cur.lineHeight));
    root.style.setProperty('--doc-width', cur.width + 'px');
    root.style.setProperty('--doc-pad', cur.pad + 'px');

    const stack = fontStack();
    if (stack) root.style.setProperty('--font-custom', stack);
    else root.style.removeProperty('--font-custom');

    // 先把所有内联颜色清干净：换主题时必须"全部换掉"，不能有上一套残留
    CUSTOM_VARS.forEach(k => body.style.removeProperty(k));
    ['--bg', '--bg-2', '--bg-3'].forEach(k => body.style.removeProperty(k));
    COLOR_TARGETS.forEach(t => body.style.removeProperty(t.cssVar));

    // 自定义主题：用 4 个基础色推导整套变量
    if (cur.theme === 'custom' && cur.customTheme) applyCustomTheme(body, cur.customTheme);

    // 细调色（作用在主题之上，优先级更高）
    COLOR_TARGETS.forEach(t => {
      const v = cur.colors[t.id];
      if (v) body.style.setProperty(t.cssVar, v);
    });

    body.classList.toggle('immersive', !!cur.immersive);
    document.documentElement.style.setProperty('--imm-width', cur.immersiveWidth + 'em');

    // 帧率上限交给渲染管理器
    if (DV.frames) DV.frames.setFps(cur.frameRate);
    // 文档内部分块动画的强度
    body.setAttribute('data-anim', cur.anim);
    body.setAttribute('data-rtf-font', cur.rtfReaderFont === false ? 'native' : 'reader');
  }

  function set(patch, opt) {
    let dirty = [];
    for (const k in patch) {
      if (k === 'customTheme') {
        cur.customTheme = Object.assign({}, cur.customTheme, patch.customTheme || {});
        dirty.push(k);
      } else if (k === 'colors') {
        // 整体替换：传 {} 就是清空（之前用 Object.assign 合并，永远清不掉）
        cur.colors = Object.assign({}, patch.colors || {});
        dirty.push('colors');
      } else if (cur[k] !== patch[k]) {
        cur[k] = patch[k];
        dirty.push(k);
      }
    }
    if (!dirty.length) return cur;
    apply(opt);
    if (!opt || opt.persist !== false) save();
    subs.forEach(fn => { try { fn(cur, dirty); } catch (e) { DV.Log.error('设置回调异常：' + e.message); } });
    return cur;
  }

  /** 只清 localStorage，不重载（供 App 层做"原地回到首次打开"） */
  function wipeStorage() {
    const keys = {};
    ['docviewer.settings.v1', 'docviewer.session'].forEach(k => { keys[k] = 1; });
    try {
      if (typeof localStorage.length === 'number' && typeof localStorage.key === 'function') {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf('docviewer.') === 0) keys[k] = 1;
        }
      }
      Object.keys(keys).forEach(k => localStorage.removeItem(k));
      if (window.sessionStorage && sessionStorage.clear) sessionStorage.clear();
    } catch (e) { /* 忽略 */ }
  }

  /** 内存里的设置也回到默认，并立即应用 */
  function toDefaults() {
    cur = Object.assign({}, DEFAULTS, { colors: {}, metaFields: Object.assign({}, DEFAULTS.metaFields),
      customTheme: Object.assign({}, DEFAULTS.customTheme) });
    lastLang = null;                       // 强制下次 apply 重扫文案
    apply();
    return cur;
  }

  /** 清空全部本地数据，回到"第一次打开" */
  function wipe() {
    try {
      // 已知键 + 枚举（某些环境不提供 length/key）
      const keys = {};
      ['docviewer.settings.v1', 'docviewer.session'].forEach(k => { keys[k] = 1; });
      if (typeof localStorage.length === 'number' && typeof localStorage.key === 'function') {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf('docviewer.') === 0) keys[k] = 1;
        }
      }
      Object.keys(keys).forEach(k => localStorage.removeItem(k));
      if (window.sessionStorage && sessionStorage.clear) sessionStorage.clear();
    } catch (e) { /* 忽略 */ }
    location.reload();
  }

  function reset() {
    cur = Object.assign({}, DEFAULTS, { colors: {} });
    apply();
    save();
    subs.forEach(fn => fn(cur, ['reset']));
    return cur;
  }

  function toggleImmersive(on) {
    const v = on === undefined ? !cur.immersive : !!on;
    set({ immersive: v });
    return v;
  }

  return {
    wipeStorage, toDefaults,
    THEMES, FONTS, FRAME_RATES, ANIMS, ANIM_SPEEDS, LANGS, EDIT_MODES, META_FIELDS, COLOR_TARGETS, COLOR_PRESETS, DEFAULTS,
    CUSTOM_VARS,
    load, save, apply, set, reset, wipe, toggleImmersive,
    get: () => cur,
    fontStack,
    on: fn => subs.push(fn),
  };
})();
