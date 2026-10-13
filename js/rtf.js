/* =====================================================================
   rtf.js — RTF(Rich Text Format) → HTML 解析器（emit 式）
   覆盖：字体表/颜色表、加粗/倾斜/下划线/删除线、上下标、字号、前景/背景色、
         段落对齐与缩进、\par \line \tab \page、超级链接目标与 {\pict} 跳过、
         \'hh 十六进制转义、\uN Unicode、常用符号、\pntext 项目符号、
         简易表格 \trowd \cellx \cell \row
   设计：HTML 标签栈 + 每段落 span 复用缓存；组用状态快照栈维护。
   ===================================================================== */
window.DV = window.DV || {};

DV.rtf = (function () {

  /* CP1252 的 0x80–0x9F 区间映射。
     注意：TextEdit 一类编辑器把中文智能引号写成 CP1252 的 \'93 / \'94，
     如果按 Latin-1 解成 U+0093/U+0094（C1 控制符）就会显示成乱码。 */
  const CP1252_MAP = {
    0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E', 0x85: '\u2026',
    0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6', 0x89: '\u2030', 0x8A: '\u0160',
    0x8B: '\u2039', 0x8C: '\u0152', 0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019',
    0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
    0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A', 0x9C: '\u0153',
    0x9E: '\u017E', 0x9F: '\u0178',
  };
  /** 把解码结果里残留的 C1 控制符换回 CP1252 对应的可见字形 */
  function fixC1(str) {
    if (!str) return str;
    let out = '', changed = false;
    for (let k = 0; k < str.length; k++) {
      const code = str.charCodeAt(k);
      if (code >= 0x80 && code <= 0x9F && CP1252_MAP[code]) { out += CP1252_MAP[code]; changed = true; }
      else out += str[k];
    }
    return changed ? out : str;
  }

  const SYMBOLS = {
    lquote: '\u2018', rquote: '\u2019', ldblquote: '\u201C', rdblquote: '\u201D',
    endash: '\u2013', emdash: '\u2014', bullet: '\u2022', ellipsis: '\u2026',
    '~': '\u00A0', '_': '\u2011', '|': '\u00A6',
    '{': '{', '}': '}', '\\': '\\',
  };

  const FONT_GENERIC = [
    [/times|georgia|garamond|cambria|serif/i, 'serif'],
    [/courier|consol|mono|menlo|monaco/i, 'monospace'],
    [/symbol|wingding|dingbat|webding/i, 'serif'],
  ];

  const DEST_SKIP = new Set([
    'info', 'generator', 'title', 'author', 'company', 'creatim', 'revtim', 'printim',
    'buptim', 'doccomm', 'operator', 'category', 'keywords', 'subject', 'comment',
    'manager', 'hlinkbase', 'version', 'vern', 'edmins', 'nofpages', 'nofwords',
    'nofchars', 'id', 'nofcharsw', 'pict', 'object', 'shppict', 'nonshppict', 'shp',
    'shpinst', 'shprslt', 'shptxt', 'dobject',
    'header', 'footer', 'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf',
    'footnote', 'annotation', 'field', 'fldinst', 'datafield', 'listtable',
    'listoverridetable', 'rsidtbl', 'xmlnstbl', 'themedata', 'colorschememapping',
    'latentstyles', 'pgptbl', 'revtbl', 'upr', 'datastore', 'filetbl', 'mmath',
  ]);

  /**
   * 解析时会被整体跳过、写回时又不会重新生成的「有内容」目的地。
   * 写回前必须拿这张表去原文里核对 —— 光看解析器跳过了什么不够，
   * 因为 \header 匹配不到 \headerl/\headerr 这类带后缀的写法。
   */
  const LOSSY_DEST = new Set([
    'pict', 'shppict', 'nonshppict', 'shp', 'shpinst', 'shprslt', 'shptxt',
    'dobject', 'object', 'mmath', 'header', 'headerl', 'headerr', 'headerf',
    'footer', 'footerl', 'footerr', 'footerf', 'footnote', 'annotation',
    'field', 'fldinst', 'datafield', 'listtable', 'listoverridetable',
    'themedata', 'colorschememapping', 'latentstyles', 'rsidtbl', 'xmlnstbl',
    'datastore', 'filetbl', 'upr', 'pgptbl', 'revtbl',
  ]);

  /**
   * 原文里出现了哪些「写回会丢内容」的目的地。
   * 按控制字逐个扫描（`{\*\pict …}` 里的 \pict 也能扫到），返回去重后的名字。
   */
  function unmodeledDestinations(src) {
    const s = String(src || '');
    const hit = new Set();
    const re = /\\([a-zA-Z]+)/g;
    let m;
    while ((m = re.exec(s))) {
      const w = m[1].toLowerCase();
      if (LOSSY_DEST.has(w)) hit.add(w);
    }
    return Array.from(hit);
  }

  function genericFamily(name) {
    for (const [re, g] of FONT_GENERIC) if (re.test(name)) return g;
    return 'sans-serif';
  }

  /**
   * 解析 RTF
   * @param {string} src RTF 文本
   * @param {{decodeHex?:function(string):string}} [opts] 注入编码解码器（如 GBK）
   */
  function parse(src, opts) {
    opts = opts || {};
    const warnings = [];
    const stats = { inputChars: String(src).length, controlWords: 0, controlSymbols: 0, groups: 0,
                    paragraphs: 0, tables: 0, spans: 0, skippedGroups: 0,
                    softBreaks: 0, softParagraphs: 0, hardParagraphs: 0 };

    const cp1252 = {
      0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E', 0x85: '\u2026',
      0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6', 0x89: '\u2030', 0x8A: '\u0160',
      0x8B: '\u2039', 0x8C: '\u0152', 0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019',
      0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
      0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A', 0x9C: '\u0153',
      0x9E: '\u017E', 0x9F: '\u0178',
    };
    /** 默认解码器：把一段 \'hh 字节还原成字符串（CP1252 近似，调用方可注入 GBK 等） */
    const defaultDecode = function (bytes) {
      let out = '';
      for (let k = 0; k < bytes.length; k++) {
        const b = bytes[k];
        out += b < 128 ? String.fromCharCode(b) : (cp1252[b] || String.fromCharCode(b));
      }
      return out;
    };
    const injected = typeof opts.decodeHex === 'function';
    const rawDecode = injected ? opts.decodeHex : defaultDecode;
    /**
     * 整段解码。
     *
     * 调用方注入了编码器（按 RTF 的 \ansicpg 注入 GBK / Big5 / Shift-JIS）时，
     * 一律以**声明编码**为准：非法序列（孤立的 \'97 这种半个 GBK 字）直接丢弃，
     * 绝不落回 CP1252 —— 否则 cp936 文件里一个孤立高位字节会被悄悄变成
     * 破折号、引号之类的拉丁字符，混进中文正文里。
     *
     * 没有注入时（默认 CP1252 近似）保留原有的 C1 → 可见字形修正。
     */
    const decodeHex = function (bytes) {
      try {
        const out = rawDecode(bytes);
        if (injected) return out.indexOf('\uFFFD') >= 0 ? out.replace(/\uFFFD/g, '') : out;
        if (out.indexOf('\uFFFD') >= 0) return fixC1(fallbackDecode(bytes));
        return fixC1(out);
      } catch (e) {
        if (!injected) return fixC1(fallbackDecode(bytes));
        let out = '';
        for (let k = 0; k < bytes.length; k++) {
          try {
            const one = rawDecode(Uint8Array.from([bytes[k]]));
            if (one.indexOf('\uFFFD') < 0) out += one;
          } catch (e2) { /* 跳过非法字节 */ }
        }
        return out;
      }
    };
    function fallbackDecode(bytes) {
      let out = '';
      for (let k = 0; k < bytes.length; k++) {
        const b = bytes[k];
        if (b < 128) { out += String.fromCharCode(b); continue; }
        try {
          const one = rawDecode(Uint8Array.from([b]));
          out += (one.indexOf('\uFFFD') >= 0) ? String.fromCharCode(b) : one;
        } catch (e) { out += String.fromCharCode(b); }
      }
      return out;
    }

    /* GBK/CP936 等多字节编码必须先把 \'hh 字节收集成完整序列再解码，
       否则单个字节会被解码成 U+FFFD。这里做字节缓冲 + 整段解码。 */
    let byteBuf = [];
    function rawHexByte(hex) { const b = parseInt(hex, 16); return isNaN(b) ? -1 : b; }
    function flushBytes() {
      if (!byteBuf.length) return '';
      const bytes = Uint8Array.from(byteBuf);
      byteBuf = [];
      if (bytes.every(b => b < 0x80)) return String.fromCharCode.apply(null, Array.from(bytes));
      return decodeHex(bytes);
    }

    const str = String(src).replace(/\r\n?/g, '\n');
    DV.__dbg = DV.__dbg || [];
    DV.__dbg.push('enter: len=' + str.length + ' nl=' + (str.match(/\n/g)||[]).length + ' opts=' + Object.keys(opts||{}).join(','));
    const softWrap = opts.softWrap !== false;
    if (!/^\s*\{\s*\\rtf/.test(str)) warnings.push('缺少 {\\rtf 文件头，可能不是标准 RTF 文档');

    /* ---------------- 状态 ---------------- */
    const s = {
      b: false, i: false, ul: 0, strike: false, sup: false, sub: false, scaps: false,
      fs: 24, cf: -1, hl: -1, face: null, f: 0,
      align: 'left', indent: 0, right: 0, first: 0,
      plainBase: { b: false, i: false, ul: 0, strike: false, sup: false, sub: false, scaps: false, fs: 24, cf: -1, hl: -1 },
      uc: 1, ansiCP: 1252,
      // 模式
      mode: 'body',       // body | fonttbl | colortbl | stylesheet | skip
      skipDepth: 0, starGroup: false,
      pntext: false, inList: false, liOpen: false, pntextDepth: 0, pendingListEnd: false, pendingNewItem: false,
      inTable: false, rowOpen: false, cellOpen: false, rowCells: 0,
      fontIdx: -1,
    };

    const fontTbl = [];   // {index,name,alt}
    const colorTbl = [];  // [r,g,b]
    let curFont = null;
    let colorRGB = [0, 0, 0];
    let colorPending = false;
    let fontBuf = '';
    let buf = '';          // 待输出文本
    let pendingBreak = false;  // 已碰到软换行，等下一次写文本前插入 <br>
    let paraEmpty = false;     // 当前段落还没写进任何内容

    // HTML 栈
    const out = [];
    const stackTags = [];  // {tag, cls}
    const spanCache = new Map();
    const paragraphTags = new Set(['p', 'li', 'td', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div']);

    function escText(t) { return t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

    function findParagraph() {
      for (let k = stackTags.length - 1; k >= 0; k--) {
        if (paragraphTags.has(stackTags[k].tag)) return k;
      }
      return -1;
    }
    function isInside(tag) { return stackTags.some(f => f.tag === tag); }
    function idxOf(tag) { for (let k = stackTags.length - 1; k >= 0; k--) if (stackTags[k].tag === tag) return k; return -1; }
    /** 样式签名：用于在样式变化时切分文本 run */
    function styleSig() {
      return [s.b, s.i, s.ul, s.strike, s.sup, s.sub, s.scaps, s.fs, s.cf, s.hl, s.face].join('|');
    }
    /** 最近块级容器（p/li/td/h*）索引，没有则 -1 */
    function blockIdx() {
      for (let k = stackTags.length - 1; k >= 0; k--) {
        const t = stackTags[k].tag;
        if (paragraphTags.has(t)) return k;
      }
      return -1;
    }
    /** 段落/列表/表格的容器边界（ul/ol/table/tbody/tr） */
    function sectionIdx() {
      for (let k = stackTags.length - 1; k >= 0; k--) {
        const t = stackTags[k].tag;
        if (t === 'ul' || t === 'ol' || t === 'table' || t === 'tbody' || t === 'tr') return k;
      }
      return -1;
    }
    /** 样式变化时切分文本 run（保证每个 run 用当时的样式渲染） */
    function flushOnStyleChange(sig) {
      if (styleSig() !== sig) flush();
    }

    function isP(tag) { return tag === 'p' || tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6'; }
    /** 关闭所有 span，回到最近的块级容器末尾 */
    function closeSpansToBlock() { flush(); const bi = blockIdx(); if (bi >= 0) closeTo(bi + 1); }
    /** 关闭当前段落元素 */
    function closeParagraphTag() {
      flush();
      const bi = blockIdx();
      if (bi >= 0 && isP(stackTags[bi].tag)) closeTo(bi);
    }
    /** 关闭当前 li（若打开） */
    function closeLi() { flush(); const li = idxOf('li'); if (li >= 0) closeTo(li); s.liOpen = false; }
    /** 关闭整个列表容器 */
    function closeList() {
      closeLi();
      flush();
      const sec = sectionIdx();
      if (sec >= 0) closeTo(sec);
      s.inList = false; s.liOpen = false;
    }

    function openTag(tag, cls, style) {
      out.push('<' + tag + (cls ? ' class="' + cls + '"' : '') + (style ? ' style="' + DV.escAttr(style) + '"' : '') + '>');
      stackTags.push({ tag, cls });
      return stackTags.length - 1;
    }
    function closeTo(depth) {
      while (stackTags.length > depth) {
        const f = stackTags.pop();
        out.push('</' + f.tag + '>');
      }
    }
    function openParagraph(cls, style) {
      if (liOpen() && s.inList) return;    // 已在列表项内
      if (buf && mergeIntoLastLi()) return;
      // 开新段落前必须把上一段关掉。原来只在缓冲区为空时才关，
      // 于是「有文字 + \par」这种情况会把新段落套进上一段里，产出 <p><p>…</p></p> 的非法嵌套。
      closeParagraphTag();
      flush();
      const sec = sectionIdx();
      const blk = blockIdx();
      let depth = 0;
      if (sec > blk) depth = sec;          // 需要关掉 ul/table 容器
      else if (blk >= 0) depth = blk + 1;
      closeTo(depth);
      openTag('p', cls, style);
      spanCache.clear();
      paraEmpty = true;
      stats.paragraphs++;
    }

    /** 最近一个已关闭的 <li> 在 out 中的索引 */
    function lastLiIndex() {
      for (let k = out.length - 1; k >= 0 && k > out.length - 40; k--) {
        const t = out[k];
        if (typeof t === 'string' && t.indexOf('<li ') === 0) return k;
        if (typeof t === 'string' && t.indexOf('</li>') === 0) return -1;
      }
      return -1;
    }
    /** 回填文本到最近的 li（Word 常见结构：{\pntext}…{\fi\li 文本}） */
    function mergeIntoLastLi() {
      // 先把缓冲内容落盘，再回填到上一项
      const pending = buf;
      if (pending) { flush(); }
      closeOpenLi();
      if (lastLiIndex() < 0) return false;
      // 关闭尚未闭合的 p/span
      closeParagraphTag();
      const ul = idxOf('ul') >= 0 ? idxOf('ul') : idxOf('ol');
      if (ul < 0) return false;
      closeTo(ul + 1);
      openTag('li', 'rtf-li', paragraphStyle());
      s.liOpen = true;
      s.pntext = true;          // 后续同类组（\pard{\pntext..}{\fi\li 文本}）继续回填本项
      spanCache.clear();
      if (pending) write(pending);   // 把原本属于本项的文本放入新 li
      return true;
    }

    function openListItem() {
      if (liOpen()) return;
      closeParagraphTag();
      flush();
      ensureList();
      closeLiAtRoot();
      const ul = idxOf('ul') >= 0 ? idxOf('ul') : idxOf('ol');
      if (ul >= 0) closeTo(ul + 1);
      openTag('li', 'rtf-li', paragraphStyle());
      s.liOpen = true;
      spanCache.clear();
      stats.paragraphs++;
    }
    function ensureList() {
      if (!isInside('ul') && !isInside('ol')) {
        flush();
        const depth = Math.max(0, blockIdx() + 1);
        closeTo(depth);
        openTag('ul', 'rtf-list', null);
      }
    }

    /* 段落/字符样式 key 计算 */
    function styleKeys() {
      const keys = [], css = [];
      if (s.b) { keys.push('s-b'); css.push('font-weight:700'); }
      if (s.i) { keys.push('s-i'); css.push('font-style:italic'); }
      const deco = [];
      if (s.ul) deco.push(s.ul === 2 ? 'double underline' : 'underline');
      if (s.strike) deco.push('line-through');
      if (deco.length) { keys.push('s-u'); css.push('text-decoration:' + deco.join(' ')); }
      if (s.sup) { keys.push('s-sup'); css.push('vertical-align:super;font-size:.75em'); }
      if (s.sub) { keys.push('s-sub'); css.push('vertical-align:sub;font-size:.75em'); }
      if (s.scaps) { keys.push('s-sc'); css.push('font-variant:small-caps'); }
      if (s.fs && s.fs !== 24) { keys.push('s-fs'); css.push('font-size:' + (s.fs / 2).toFixed(1) + 'pt'); }
      if (s.cf >= 0 && colorTbl[s.cf]) { keys.push('s-c' + s.cf); css.push('color:' + rgb(colorTbl[s.cf])); }
      if (s.hl >= 0 && colorTbl[s.hl]) { keys.push('s-h' + s.hl); css.push('background-color:' + rgb(colorTbl[s.hl])); }
      if (s.face) { keys.push('s-ff'); css.push('font-family:"' + s.face.replace(/"/g, '') + '",' + genericFamily(s.face)); }
      return { keys: keys.join(' '), css: css.join(';') };
    }
    function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

    /** 确保当前 span 链与 s 匹配 */
    function syncSpans() {
      const pIdx = findParagraph();
      if (pIdx < 0) return;
      const want = styleKeys();
      const wantKeys = want.keys ? want.keys.split(' ') : [];
      // 当前 span 链（段落之后的全部）
      const curSpans = stackTags.slice(pIdx + 1);
      // 找最长公共前缀
      let common = 0;
      while (common < curSpans.length && common < wantKeys.length && curSpans[common].cls === wantKeys[common]) common++;
      // 关闭多余
      while (stackTags.length > pIdx + 1 + common) { const f = stackTags.pop(); out.push('</' + f.tag + '>'); }
      // 打开缺少
      for (let k = common; k < wantKeys.length; k++) {
        const key = wantKeys.slice(0, k + 1).join(' ');
        let spec = spanCache.get(key);
        if (!spec) { spec = { cls: wantKeys[k], css: '' }; spanCache.set(key, spec); }
        // 增量式 css：每次重新计算完整样式，简单可靠
        const full = styleKeysFor(wantKeys.slice(0, k + 1)).css;
        openTag('span', wantKeys[k], full);
        stats.spans++;
      }
    }
    /** 给定前缀 key 计算 css（用当前状态近似） */
    function styleKeysFor(prefixKeys) {
      const full = styleKeys();
      const all = full.keys ? full.keys.split(' ') : [];
      const decls = full.css ? full.css.split(';') : [];
      // 按前缀长度取前 N 条声明（与 keys 顺序一一对应）
      const want = prefixKeys.length;
      const chosen = [];
      let ki = 0;
      for (let k = 0; k < all.length && chosen.length < want; k++) {
        if (prefixKeys[chosen.length] === all[k]) { chosen.push(decls[k]); }
      }
      return { css: chosen.filter(Boolean).join(';') };
    }

    const BULLET = '\u0002';
    /** 各种项目符号字符（解析时统一成 •） */
    const BULLET_CHARS = '\u2022\u00b7\u25cf\u25aa\u25a0\u2023\u2043\u2219\\-\\*\u25cb\u25a1';
    /** \u0002 标记（连同紧邻的项目符号字符/空白）→ 一个「• 」 */
    const BULLET_RUN = new RegExp('[' + BULLET + BULLET_CHARS + '\\s\\t]*' + BULLET +
      '[' + BULLET + BULLET_CHARS + '\\s\\t]*', 'g');

    function isListBulletText(t) {
      return /^[\u0002]?\s*[\u2022\u00b7\u25cf\u25aa\u25a0\u2023\u2043\u2219\-\*\u25cb\u25a1]\s*[\t ]?$/.test(t);
    }

    /** 保证有块级容器（p/li/td），否则文本会散落在根节点上 */
    function ensureBlock() {
      if (blockIdx() >= 0 || isInside('td') || s.inTable) return;
      if (isInside('ul') || isInside('ol')) return;   // 列表项本身就是块级容器
      const sec = sectionIdx();
      if (sec >= 0) closeTo(sec + 1);
      openTag('p', 'rtf-p', paragraphStyle());
      stats.paragraphs++;
    }

    function flush() {
      if (byteBuf.length) buf += flushBytes();
      if (!buf) { return; }
      paraEmpty = false;
      if (pendingBreak) {                 // 兜底：极少情况下仍有挂起的软换行
        pendingBreak = false;
        out.push('<br>');
        stats.softBreaks++;
      }
      let t = buf; buf = '';
      const hasBullet = t.indexOf(BULLET) >= 0;
      if (hasBullet) {
        // \pntext 标记：结束上一项，惰性开启新的列表项
        ensureList();
        closeOpenLi();
        const ul = idxOf('ul') >= 0 ? idxOf('ul') : idxOf('ol');
        if (ul >= 0) closeTo(ul + 1);
        openTag('li', 'rtf-li', paragraphStyle());
        s.liOpen = true;
        spanCache.clear();
        // \pntext 已经写过标记，组里那个真正的项目符号字符（•、·、\'B7…）
        // 也要一起吃掉：以前只替换标记、留着字符，于是保存后变成「• • 第一项」。
        t = t.replace(BULLET_RUN, '\u2022 ');
      }
      if (!t) return;
      if (!s.inList) ensureBlock();
      if (s.inList && !s.liOpen && t.trim()) {
        // Word 常见结构：项目符号在上一组，正文在下一组
        ensureList();
        const ul = idxOf('ul') >= 0 ? idxOf('ul') : idxOf('ol');
        if (ul >= 0) closeTo(ul + 1);
        openTag('li', 'rtf-li', paragraphStyle());
        s.liOpen = true;
        spanCache.clear();
      }
      syncSpans();
      out.push(escText(t));
    }
    /** 关闭当前 li（若打开） */
    function closeOpenLi() { const li = idxOf('li'); if (li >= 0) closeTo(li); s.liOpen = false; }
    function closeLiAtRoot() { closeOpenLi(); }
    /** 当前是否已处于某个 li 内（跨组通过 s.liOpen 记录） */
    function liOpen() { return s.liOpen || isInside('li'); }
    function write(t) {
      if (byteBuf.length) buf += flushBytes();
      buf += t;
    }

    /**
     * 软换行。注意：这里必须"无条件"输出 <br>。
     * TextEdit 一类编辑器把换行写在 \'hh 转义行的行尾，解析到换行时
     * 缓冲往往已经被 flush 清空；如果这时跳过，整篇就会挤成一段。
     */
    function markSoftBreak() {
      // 刚开了一个空段落（典型是 \par 之后跟一个裸换行）时不要插 <br>：
      // 那个换行只是源文件的可读性折行，插了它写回就会变成 \line，把真段落降级成手动换行。
      if (paraEmpty) return;
      if (byteBuf.length) write(flushBytes());
      if (buf) flush();
      out.push('<br>');
      paraEmpty = false;
      stats.softBreaks++;
    }

    function paragraphStyle() {
      const st = [];
      if (s.align && s.align !== 'left') st.push('text-align:' + s.align);
      const ml = Math.max(0, s.indent) / 20;
      if (ml) st.push('margin-left:' + ml.toFixed(1) + 'px');
      if (s.right) st.push('margin-right:' + (Math.max(0, s.right) / 20).toFixed(1) + 'px');
      if (s.first) st.push('text-indent:' + (s.first / 20).toFixed(1) + 'px');
      return st.join(';');
    }

    /* ---------------- 组处理 ---------------- */
    const groupStack = [];

    function isSkipping() { return s.mode === 'skip' || s.skipDepth > 0; }

    function pushGroup() {
      stats.groups++;
      groupStack.push({
        mode: s.mode, skipDepth: s.skipDepth, starGroup: s.starGroup,
        b: s.b, i: s.i, ul: s.ul, strike: s.strike, sup: s.sup, sub: s.sub, scaps: s.scaps,
        fs: s.fs, cf: s.cf, hl: s.hl, face: s.face, f: s.f,
        align: s.align, indent: s.indent, right: s.right, first: s.first,
        uc: s.uc, pntext: s.pntext, inList: s.inList, liOpen: s.liOpen, pntextDepth: s.pntextDepth,
        pendingListEnd: s.pendingListEnd, pendingNewItem: s.pendingNewItem,
        fontIdx: s.fontIdx,
        tagsLen: stackTags.length,
      });
      s.starGroup = false;
    }
    function popGroup() {
      const fr = groupStack.pop();
      if (!fr) return;
      // 在恢复外层样式之前先把组内文本按内层样式落盘
      if (s.mode !== 'skip' && s.mode !== 'fonttbl' && s.mode !== 'colortbl') flush();
      if (s.mode === 'fonttbl') { finishFont(); }
      if (s.mode === 'colortbl') { colorRGB = [0, 0, 0]; }
      s.mode = fr.mode; s.skipDepth = fr.skipDepth; s.starGroup = fr.starGroup;
      s.b = fr.b; s.i = fr.i; s.ul = fr.ul; s.strike = fr.strike; s.sup = fr.sup;
      s.sub = fr.sub; s.scaps = fr.scaps; s.fs = fr.fs; s.cf = fr.cf; s.hl = fr.hl;
      s.face = fr.face; s.f = fr.f; s.align = fr.align; s.indent = fr.indent;
      s.right = fr.right; s.first = fr.first; s.uc = fr.uc; s.pntext = fr.pntext;
      s.inList = fr.inList; s.liOpen = fr.liOpen; s.pntextDepth = fr.pntextDepth;
      s.pendingListEnd = fr.pendingListEnd; s.pendingNewItem = fr.pendingNewItem; s.fontIdx = fr.fontIdx;
      // 关闭该组内打开的 span；但在列表项内要保留 ul/li 结构
      if (stackTags.length > fr.tagsLen) {
        flush();
        let floor = fr.tagsLen;
        if (s.inList || s.liOpen) {
          const ulIdx = idxOf('ul') >= 0 ? idxOf('ul') : idxOf('ol');
          floor = ulIdx >= 0 ? ulIdx + 1 : floor;
        }
        while (stackTags.length > floor) { const f = stackTags.pop(); out.push('</' + f.tag + '>'); }
      }
    }

    function finishFont() {
      if (!curFont) return;
      const name = fontBuf.replace(/;.*$/, '').trim();
      fontBuf = '';
      if (name) curFont.name = name;
      curFont = null;
    }

    function startSkip() {
      s.mode = 'skip';
      s.skipDepth = 0;
      stats.skippedGroups++;
    }

    /* ---------------- 控制字 ---------------- */
    function controlWord(word, num, hadNum, nextIsSpace) {
      stats.controlWords++;
      const N = num;

      /* --- 字体表组内 --- */
      if (s.mode === 'fonttbl') {
        if (word === 'f' && hadNum) { curFont = { index: N, name: '' }; fontTbl[N] = curFont; fontBuf = ''; }
        else if (word === 'fcharset' || word === 'fprq' || word === 'fbidi' || word === 'froman' ||
          word === 'fswiss' || word === 'fmodern' || word === 'fscript' || word === 'fdecor' ||
          word === 'ftech' || word === 'fnil' || word === 'falt') { /* 忽略 */ }
        else if (word === 'flomajor' || word === 'fhimajor' || word === 'fdbmajor' ||
          word === 'fbimajor' || word === 'flominor' || word === 'fhiminor' ||
          word === 'fdbminor' || word === 'fbiminor') { /* 忽略 */ }
        return;
      }
      /* --- 颜色表组内 --- */
      if (s.mode === 'colortbl') {
        if (word === 'red') { colorRGB[0] = N || 0; colorPending = true; }
        else if (word === 'green') { colorRGB[1] = N || 0; colorPending = true; }
        else if (word === 'blue') { colorRGB[2] = N || 0; colorPending = true; }
        return;
      }
      /* --- 跳过组内 --- */
      if (isSkipping()) {
        if (word === 'pict') { /* 保持 */ }
        return;
      }

      switch (word) {
        /* 文档级 */
        case 'rtf': case 'ansi': case 'mac': case 'pc': case 'pca': break;
        case 'ansicpg': s.ansiCP = hadNum ? N : 1252; break;
        case 'deff': case 'deflang': case 'deflangfe': case 'adeff': break;
        case 'uc': s.uc = hadNum ? Math.abs(N) : 1; break;
        case 'fonttbl': s.mode = 'fonttbl'; break;
        case 'colortbl':
          s.mode = 'colortbl';
          colorRGB = [0, 0, 0];
          colorPending = false;
          colorTbl.length = 0;              // \cf1 对应第一项颜色
          break;
        case 'stylesheet': s.mode = 'stylesheet'; startSkip(); break;

        /* 字符格式 */
        case 'b': s.b = hadNum ? N !== 0 : true; break;
        case 'i': s.i = hadNum ? N !== 0 : true; break;
        case 'ul': s.ul = hadNum ? (N === 0 ? 0 : 1) : 1; break;
        case 'ulnone': s.ul = 0; break;
        case 'uldb': s.ul = 2; break;
        case 'ulw': case 'ulth': case 'ulc': break;
        case 'strike': case 'striked': s.strike = hadNum ? N !== 0 : true; break;
        case 'super': s.sup = true; s.sub = false; break;
        case 'sub': s.sub = true; s.sup = false; break;
        case 'nosupersub': s.sup = s.sub = false; break;
        case 'fs': s.fs = hadNum && N > 0 ? N : 24; break;
        case 'cf': s.cf = hadNum ? N : -1; break;
        case 'highlight': s.hl = hadNum ? N : -1; break;
        case 'cb': case 'chcbpat': case 'chcfpat': break;
        case 'f': s.f = hadNum ? N : 0; s.face = fontTbl[s.f] && fontTbl[s.f].name ? fontTbl[s.f].name : null; break;
        case 'af': case 'afs': break;
        case 'caps': s.scaps = hadNum ? N !== 0 : true; break;
        case 'scaps': s.scaps = hadNum ? N !== 0 : true; break;
        case 'plain':
          s.b = s.i = s.strike = s.sup = s.sub = s.scaps = false;
          s.ul = 0; s.fs = 24; s.cf = -1; s.hl = -1; s.face = null;
          break;

        /* 段落 */
        case 'pard':
          closeParagraphTag();
          s.align = 'left'; s.indent = 0; s.right = 0; s.first = 0;
          s.inList = false; s.pntext = false; s.liOpen = false;
          break;
        case 'par': case 'sect':
          stats.hardParagraphs++;
          if (s.inList && s.liOpen) {
            // 列表项范围 = 上一个 pntext .. 当前 par；这里先关闭 li，若之后没有新
            // pntext（即列表真的结束）就整体关闭列表。
            closeOpenLi();
            s.pendingListEnd = true;
          } else if (s.inTable || s.rowOpen) {
            flush();
            const tdIdx = idxOf('td');
            if (tdIdx >= 0) closeTo(tdIdx + 1);
          } else {
            openParagraph('rtf-p', paragraphStyle());
          }
          break;
        case 'line': flush(); syncSpans(); out.push('<br>'); break;
        case 'page': case 'softpage':
          openParagraph('rtf-p rtf-page', paragraphStyle());
          break;
        case 'tab': write('\t'); break;  // write() 会先冲刷字节缓冲
        case 'enspace': write('\u2002'); break;
        case 'emspace': write('\u2003'); break;
        case 'qmspace': write('\u2005'); break;
        case 'bullet': write('\u2022'); break;
        case 'lquote': write(SYMBOLS.lquote); break;
        case 'rquote': write(SYMBOLS.rquote); break;
        case 'ldblquote': write(SYMBOLS.ldblquote); break;
        case 'rdblquote': write(SYMBOLS.rdblquote); break;
        case 'endash': write(SYMBOLS.endash); break;
        case 'emdash': write(SYMBOLS.emdash); break;
        case 'ellipsis': write(SYMBOLS.ellipsis); break;

        /* 对齐/缩进 */
        case 'ql': s.align = 'left'; break;
        case 'qr': s.align = 'right'; break;
        case 'qc': s.align = 'center'; break;
        case 'qj': s.align = 'justify'; break;
        case 'li':
          s.indent = hadNum ? N : 0;
          if (hadNum && N > 0) s.inList = true;    // \li720 表示列表项缩进
          break;
        case 'ri': s.right = hadNum ? N : 0; break;
        case 'fi': case 'lin': s.first = hadNum ? N : 0; break;
        case 'sa': case 'sb': case 'sl': case 'slmult': break;

        /* 列表 */
        case 'pntext':
          // \pntext 是列表项的唯一权威信号：登记标记，flush 时惰性建立 <ul><li>
          s.pntext = true; s.inList = true;
          s.pntextDepth = groupStack.length;   // 本组内的项目符号字符会被替换为 •，不原样输出
          write(BULLET);
          break;
        case 'pn': s.inList = true; break;
        case 'pnlvlblt': case 'pnlvlbody': s.inList = true; break;
        case 'pndec': case 'pnlcltr': case 'pnlcrm': case 'pnord': case 'pnordt': break;

        /* 表格 */
        case 'trowd':
          flush();
          {
            const pIdx = idxOf('p');
            if (pIdx >= 0) closeTo(pIdx);
          }
          if (!s.rowOpen) {
            out.push('<table class="rtf-table"><tbody>');
            stats.tables++;
            s.rowOpen = true;
            s.cellOpen = false;
          }
          out.push('<tr>');
          s.inTable = true;
          s.rowCells = 0;
          break;
        case 'cellx':
          flush();
          if (s.cellOpen) out.push('</td>');
          out.push('<td>');
          s.cellOpen = true;
          spanCache.clear();
          break;
        case 'intbl':
          if (s.rowOpen && !s.cellOpen) { out.push('<td>'); s.cellOpen = true; spanCache.clear(); }
          break;
        case 'cell':
          flush();
          if (!s.cellOpen) { out.push('<td>'); s.cellOpen = true; }
          closeTo(idxOf('td') + 1);
          out.push('</td>');
          s.cellOpen = false;
          spanCache.clear();
          break;
        case 'row':
          flush();
          if (s.cellOpen) { out.push('</td>'); s.cellOpen = false; }
          if (s.rowOpen) { out.push('</tr></tbody></table>'); s.rowOpen = false; s.inTable = false; }
          spanCache.clear();
          break;
        case 'nestcell': case 'nestrow': break;

        /* Unicode 与特殊 */
        case 'u':
          if (byteBuf.length) write(flushBytes());   // \'hh 字节序列到此为止
          if (hadNum && N != null) {
            let code = N < 0 ? N + 65536 : N;
            if (code > 0 && code <= 0xFFFF) write(String.fromCharCode(code));
            else if (code > 0xFFFF && code <= 0x10FFFF) {
              // 非 BMP：写成代理对（\u55357 \u57290 这类也是同样的写法）
              const v = code - 0x10000;
              write(String.fromCharCode(0xD800 + (v >> 10), 0xDC00 + (v & 0x3FF)));
            }
          }
          break;
        case 'chftn': write('\u203B'); break;
        case 'chdate': case 'chtime': case 'chpgn': case 'chatn': case 'chdpa':
        case 'chdpl': case 'chftnsep': case 'chftnsepc': case 'chpgnnum': break;
        default: break;
      }
    }

    /* ---------------- 主循环 ---------------- */
    // 组栈模式：进入组时若遇到 \* 或目的地控制字，则整组跳过
    let i = 0;
    const n = str.length;
    const groupDestStack = [];
    while (i < n) {
      const c = str[i];

      if (c === '{') {
        pushGroup();
        // 首个控制字若是 \* 或目的地，则本组整体跳过
        groupDestStack.push({ decided: false });
        i++;
        continue;
      }
      if (c === '}') {
        popGroup();
        groupDestStack.pop();
        i++;
        continue;
      }

      if (c === '\\') {
        i++;
        const cc = str[i];
        if (cc === undefined) break;

        // 控制符号
        if (cc === '\\' || cc === '{' || cc === '}') {
          if (!isSkipping()) write(cc);
          else if (buf) { /* 丢弃 */ }
          i++; continue;
        }
        if (cc === "'") {
          const hex = str.substr(i + 1, 2);
          i += 3;
          if (!isSkipping()) {
            const b = rawHexByte(hex);
            if (b >= 0) byteBuf.push(b);
            // 连续 hex 字节在一次刷新中统一解码，保证多字节字符正确
            if (byteBuf.length >= 64) write(flushBytes());
          }
          continue;
        }
        if (cc === '~') { if (!isSkipping()) write('\u00A0'); i++; continue; }
        if (cc === '_') { if (!isSkipping()) write('\u2011'); i++; continue; }
        if (cc === '-') { i++; continue; }
        if (cc === '*') {
          stats.controlSymbols++;
          const g = groupDestStack[groupDestStack.length - 1];
          if (g) { g.decided = true; g.skip = true; }
          s.starGroup = true;
          startSkip();
          i++;
          continue;
        }
        if (cc === '\n' || cc === '\r') {
          // `\<换行>` 按规范是可忽略的转义符；但这些文件（TextEdit 导出）
          // 正是用它做硬折行，忽略掉就会变成没有断行的巨长段落。
          if (softWrap && !isSkipping()) markSoftBreak();
          i++;
          continue;
        }
        if (cc === '|') { if (!isSkipping()) write('\u00A6'); i++; continue; }
        if (!/[a-zA-Z]/.test(cc)) {
          // 未知的单字符控制符号：RTF 规定等价于该字符本身
          if (!isSkipping() && cc.charCodeAt(0) >= 32) write(cc);
          i++;
          continue;
        }

        // 控制字
        let j = i;
        while (j < n && /[a-zA-Z]/.test(str[j])) j++;
        const word = str.slice(i, j);
        let neg = false, digits = '';
        if (str[j] === '-') { neg = true; j++; }
        while (j < n && str[j] >= '0' && str[j] <= '9') { digits += str[j]; j++; }
        const hadNum = digits !== '';
        const num = hadNum ? (neg ? -1 : 1) * parseInt(digits, 10) : null;
        if (str[j] === ' ') j++;  // 分隔空格
        i = j;

        // 组目的地判定
        const g = groupDestStack[groupDestStack.length - 1];
        if (g && !g.decided) {
          g.decided = true;
          if (DEST_SKIP.has(word)) { g.skip = true; startSkip(); }
        }
        // 字体表/颜色表组内记录（即便处于 skip 模式也要收集表项）
        const sigBefore = (s.mode === 'fonttbl' || s.mode === 'colortbl') ? '' : styleSig();
        if (s.mode === 'fonttbl' || s.mode === 'colortbl') {
          controlWord(word, num, hadNum);
        } else if (!isSkipping()) {
          controlWord(word, num, hadNum);
          // 样式发生变化：先把上一段文本按旧样式落盘，再建立新的 span
          if (!isSkipping() && s.mode !== 'fonttbl' && s.mode !== 'colortbl' && styleSig() !== sigBefore) flush();
        }
        // \uN 之后需要跳过 uc 个替代字符（通常是表示 UTF-16 单元的数字串）
        if (word === 'u' && hadNum && !isSkipping()) {
          let left = s.uc, k = i;
          while (left > 0 && k < n) {
            if (str[k] === '\\' && str[k + 1] === "'") { k += 4; left--; }
            else if (str[k] === '{' || str[k] === '}') break;
            else if (str[k] === ' ') { k++; }
            else { k++; left--; }
          }
          i = k;
        }
        continue;
      }

      if (c === '\n' || c === '\r') {
        if (!softWrap || isSkipping() || s.mode === 'fonttbl' || s.mode === 'colortbl') { i++; continue; }
        if (c === '\r') { i++; continue; }
        // 连续的 \r\n / \n 只算作一个换行
        let j2 = i + 1;
        while (j2 < n && (str[j2] === '\n' || (str[j2] === '\r' && str[j2 + 1] === '\n'))) {
          j2 += str[j2] === '\r' ? 2 : 1;
        }
        i = j2;
        /*
         * 每个源文件换行都变成一个 <br>。
         *
         * 为什么不做"空行 = 分段"的聪明处理：macOS 文本编辑一类的工具把段落
         * 断行写成裸换行、同时每 ~255 字节还会插一个 "\<换行>" 硬折行，两种
         * 换行在文件里长得几乎一样（实测 28 个文件里 \par 数量全是 0）。
         * 任何合并策略都会把作者的分段一起吞掉，整篇挤成一段 —— 那正是
         * "换了行没用"的原因。宁可多几个换行，也不能丢作者的结构。
         */
        markSoftBreak();
        continue;
      }

      // 普通文本（可能包含原文中的非 ASCII 字符，按 UTF-16 码元处理）
      let j = i;
      while (j < n && '\\{}\n\r'.indexOf(str[j]) < 0) j++;
      const chunk = str.slice(i, j);
      i = j;
      if (!isSkipping()) {
        if (s.mode === 'fonttbl') { fontBuf += chunk; }
        else if (/[^\x00-\x7F]/.test(chunk)) {
          // 文本本身已是 Unicode（如 UTF-8 保存的 RTF）：直接输出，不能再按字节解码
          if (s.inList && !liOpen()) {
            const merged = mergeIntoLastLi();
            if (!merged && s.inList) openListItem();
          }
          if (!isInside('p') && !liOpen() && !isInside('td') && !s.inTable && findParagraph() < 0) {
            openTag('p', 'rtf-p', paragraphStyle());
            stats.paragraphs++;
          }
          if (byteBuf.length) buf += flushBytes();   // 让 hex 字节先成像，保持顺序
          buf += chunk;
        }
        else if (s.pntextDepth > 0 && groupStack.length >= s.pntextDepth) {
          // 项目符号字符（•、·、- 等）：统一用 BULLET 标记替换
          if (isListBulletText(chunk)) write(BULLET);
        }
        else if (s.mode === 'colortbl') {
          if (chunk.indexOf(';') >= 0) {
            // RTF 颜色表里空的一项表示"自动色"（跟随阅读器），必须存 null；
            // 早先无条件 push 黑色，导致 \cf0 的正文在深色主题下变成黑字黑底。
            colorTbl.push(colorPending ? colorRGB.slice() : null);
            colorRGB = [0, 0, 0];
            colorPending = false;
          }
        }
        else {
          if (!s.pntext && !liOpen() && !isInside('p')) {
            // 段落结束后紧跟的列表正文（Word 常见结构）：回填到上一项
            const merged = mergeIntoLastLi();
            if (!merged && s.inList) openListItem();
            else if (!merged && !isInside('p') && findParagraph() < 0) {
              openTag('p', 'rtf-p', paragraphStyle());
              stats.paragraphs++;
            }
          }
          if (s.pntext) s.pntext = false;
          if (s.pendingListEnd) s.pendingListEnd = false;
          // 普通文本里可能夹着裸换行（作者的分段）：在这里切开，
          // 否则它们会被当成文本的一部分整块写进去，换行就丢失了。
          if (softWrap && chunk.indexOf('\n') >= 0) {
            const parts = chunk.split('\n');
            parts.forEach((seg, idx) => {
              if (seg) write(seg);
              if (idx < parts.length - 1) markSoftBreak();
            });
          } else {
            write(chunk);
          }
        }
      }
    }
    flush();
    closeTo(0);

    // 「结尾多出来的空段落」：\par 会先关掉上一段、再开一段新的，最后那个 \par
    // 留下一段永远填不满的空 <p>；写回时 htmlToRtf 又会为每个块补一个 \par，
    // 于是每保存一次就多一个空行（\par 5→6→7→8）。
    // 收尾时把没有任何内容的末段整个删掉，段落数才和源文件对得上。
    if (paraEmpty && out.length >= 2 &&
        out[out.length - 1] === '</p>' && /^<p\b/.test(out[out.length - 2])) {
      out.length -= 2;
      if (stats.paragraphs > 0) stats.paragraphs--;
    }

    const html = out.join('');
    DV.__dbg.push('loop done: paragraphs=' + stats.paragraphs + ' softBreaks=' + stats.softBreaks + ' softPara=' + stats.softParagraphs + ' hard=' + stats.hardParagraphs);
    const plain = extractText(str, decodeHex, { softWrap });
    return {
      ok: true,
      html: '<div class="rtf-body">' + html + '</div>',
      text: plain,
      warnings, stats,
      fonts: fontTbl, colors: colorTbl,
    };
  }

  /* ---------------- 纯文本提取（用于纯文本视图/统计） ---------------- */
  function makeDefaultDecoder() {
    const cp1252 = {
      0x80: '\u20AC', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C', 0x94: '\u201D',
      0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014', 0x85: '\u2026',
    };
    return function (bytes) {
      let out = '';
      for (let k = 0; k < bytes.length; k++) {
        const b = bytes[k];
        out += b < 128 ? String.fromCharCode(b) : (cp1252[b] || String.fromCharCode(b));
      }
      return out;
    };
  }

  /**
   * 提取纯文本（源码视图 / 字数统计 / RTF 解析失败时的回退）
   * @param {string} src RTF 文本
   * @param {function(Uint8Array):string} [decodeBytes] 多字节解码器
   */
  function extractText(src, decodeBytes, opts) {
    const softWrap = !opts || opts.softWrap !== false;
    const rawDec = decodeBytes || makeDefaultDecoder();
    const dec = function (bytes) {
      let out;
      try { out = rawDec(bytes); } catch (e) { out = '\uFFFD'; }
      if (out.indexOf('\uFFFD') < 0) return fixC1(out);
      let fix = '';
      for (let k = 0; k < bytes.length; k++) {
        const b = bytes[k];
        if (b < 128) { fix += String.fromCharCode(b); continue; }
        let one = '\uFFFD';
        try { one = rawDec(Uint8Array.from([b])); } catch (e) { /* 保留 */ }
        fix += one.indexOf('\uFFFD') >= 0 ? String.fromCharCode(b) : one;
      }
      return fixC1(fix);
    };
    const str = String(src);
    const out = [];
    let depth = 0, i = 0, uc = 1, n = str.length;
    let skipDepth = -1;
    let byteBuf = [];

    function flushBytes() {
      if (!byteBuf.length) return;
      const bytes = Uint8Array.from(byteBuf);
      byteBuf = [];
      if (bytes.every(b => b < 0x80)) out.push(String.fromCharCode.apply(null, Array.from(bytes)));
      else out.push(dec(bytes));
    }

    while (i < n) {
      const c = str[i];
      if (c === '{') { depth++; i++; continue; }
      if (c === '}') {
        if (skipDepth >= 0 && depth <= skipDepth) { skipDepth = -1; }
        depth--; i++; continue;
      }
      if (c === '\\') {
        i++;
        const cc = str[i];
        if (cc === undefined) break;
        if (cc === '\\' || cc === '{' || cc === '}') { if (skipDepth < 0) { flushBytes(); out.push(cc); } i++; continue; }
        if (cc === "'") {
          const hex = str.substr(i + 1, 2);
          i += 3;
          if (skipDepth < 0) {
            const b = parseInt(hex, 16);
            if (!isNaN(b)) byteBuf.push(b);
            if (byteBuf.length >= 64) flushBytes();
          }
          continue;
        }
        if (cc === '~') { if (skipDepth < 0) { flushBytes(); out.push('\u00A0'); } i++; continue; }
        if (cc === '_') { if (skipDepth < 0) { flushBytes(); out.push('\u2011'); } i++; continue; }
        if (cc === '*') { skipDepth = depth; i++; continue; }
        if (cc === '\n' || cc === '\r') { i++; continue; }
        if (!/[a-zA-Z]/.test(cc)) { i++; continue; }
        let j = i;
        while (j < n && /[a-zA-Z]/.test(str[j])) j++;
        const word = str.slice(i, j);
        let neg = false, digits = '';
        if (str[j] === '-') { neg = true; j++; }
        while (j < n && str[j] >= '0' && str[j] <= '9') digits += str[j++];
        if (str[j] === ' ') j++;
        i = j;
        const num = digits ? (neg ? -1 : 1) * parseInt(digits, 10) : null;

        if (skipDepth >= 0) {
          if (word === 'par' || word === 'line' || word === 'row') out.push('\n');
          continue;
        }
        if (DEST_SKIP.has(word) || word === 'fonttbl' || word === 'colortbl') {
          skipDepth = depth;
          continue;
        }
        flushBytes();
        if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') out.push('\n');
        else if (word === 'tab') out.push('\t');
        else if (word === 'cell') { if (!byteBuf.length) out.push('\t'); }
        else if (word === 'row') out.push('\n');
        else if (word === 'u' && num != null) {
          flushBytes();
          out.push(String.fromCharCode(num < 0 ? num + 65536 : num));
          let left = uc, k = i;
          while (left > 0 && k < n) {
            if (str[k] === '\\' && str[k + 1] === "'") { k += 4; left--; }
            else if (str[k] === '{' || str[k] === '}') break;
            else { k++; left--; }
          }
          i = k;
        } else if (word === 'uc') uc = num != null ? Math.abs(num) : 1;
        else if (SYMBOLS[word] != null) out.push(SYMBOLS[word]);
        continue;
      }
      if (c === '\n' || c === '\r') {
        if (skipDepth < 0 && softWrap) { flushBytes(); out.push('\n'); }
        i++;
        continue;
      }
      if (skipDepth < 0) {
        if (c.charCodeAt(0) > 127) { flushBytes(); out.push(c); }
        else byteBuf.push(c.charCodeAt(0));
      }
      i++;
    }
    flushBytes();
    return out.join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* ==================== 追加内容：生成 RTF 片段 ==================== */

  /** 去掉字体表 / 颜色表 / 样式表 / 星号组，只看正文 */
  function bodyOnly(src) {
    return String(src || '')
      .replace(/\{\\fonttbl[\s\S]*?\}/g, ' ')
      .replace(/\{\\colortbl[\s\S]*?\}/g, ' ')
      .replace(/\{\\stylesheet[\s\S]*?\}/g, ' ')
      .replace(/\{\\\*[\s\S]*?\}/g, ' ');
  }

  /** 正文里出现最多的字号 \fsN（N 是半磅，24 = 12pt） */
  function dominantFs(src) {
    const body = bodyOnly(src);
    const count = {};
    const re = /\\fs(\d+)/g;
    let m;
    while ((m = re.exec(body))) {
      const n = m[1];
      count[n] = (count[n] || 0) + 1;
    }
    let best = null, bestN = 0;
    Object.keys(count).forEach(k => { if (count[k] > bestN) { bestN = count[k]; best = k; } });
    return best;
  }

  /** 默认字体索引 \deffN，找不到就用正文里第一个 \fN */
  function defaultFontIndex(src) {
    const s = String(src || '');
    const d = /\\deff(\d+)/.exec(s);
    if (d) return d[1];
    const f = /\\f(\d+)/.exec(bodyOnly(s));
    return f ? f[1] : null;
  }

  /** 纯文本 → RTF 转义；非 ASCII 用 \uN? （与文件本身编码无关，最稳） */
  /**
   * 源文件用的「\uN 后面跟几个替代字符」（\ucN）。
   * 写回时必须沿用同一个值：原文件是 \uc0（转义后面根本不跟替代字符）时，
   * 如果写成 \uc1，任何按规范读的软件都会把转义后面那个字符当成替代字符吃掉，
   * 被吃掉的就是正文里的右引号之类。找不到声明时 RTF 默认是 1。
   */
  /** RTF \fcharsetN → 代码页（按规范的字符集表） */
  const FCHARSET = {
    0: 1252, 1: 1252, 2: 1252, 77: 10000, 128: 932, 129: 949, 130: 1361, 134: 936,
    136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256, 186: 1257,
    204: 1251, 238: 1250, 254: 874, 255: 1252,
  };

  function detectUc(src) {
    const s = String(src || '');
    const at = s.indexOf('\\pard');
    const body = at >= 0 ? s.slice(at) : s;
    const m = /\\uc(\d+)/.exec(body) || /\\uc(\d+)/.exec(s);
    if (!m) return 1;
    const n = parseInt(m[1], 10);
    return isNaN(n) ? 1 : Math.max(0, Math.min(9, n));
  }

  function escapeText(text, uc) {
    const out = [];
    const fallback = uc === undefined ? '?' : (uc > 0 ? new Array(uc + 1).join('?') : '');
    const str = String(text == null ? '' : text);
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const code = str.charCodeAt(i);
      if (ch === '\\') out.push('\\\\');
      else if (ch === '{') out.push('\\{');
      else if (ch === '}') out.push('\\}');
      else if (ch === '\n') out.push('\\par\n');
      else if (ch === '\r') { /* 忽略，交给 \n */ }
      else if (ch === '\t') out.push('\\tab ');
      else if (code === 0x0a) out.push('\\par\n');
      else if (code >= 32 && code < 127) out.push(ch);
      else {
        // RTF 的 \uN 用有符号 16 位；代理对自然拆成两个单元
        const n = code > 32767 ? code - 65536 : code;
        // ucN = 0 时不补替代字符，那就要防止下一个字符被当成控制字参数的一部分：
        // 后面紧跟字母/数字时补一个分隔空格（读的人会把它当定界符吃掉）。
        const nxt = str[i + 1];
        const delim = (fallback === '' && nxt && /[0-9A-Za-z]/.test(nxt)) ? ' ' : '';
        out.push('\\u' + n + fallback + delim);
      }
    }
    return out.join('');
  }

  /**
   * 文档级控制字（无输出、且不改变字符/段落状态）。
   * 只认这些：其余控制字一律算正文，写回时由 DOM 重新序列化。
   * 之前是「见到 \ 就一直吃」，把正文开头的 \uNNNN / \bullet 也当成前言吃掉了，
   * 于是那段内容既留在前言里、又被重新序列化一遍 —— 保存一次就多一遍。
   */
  const HEADER_WORDS = new Set([
    'rtf', 'ansi', 'mac', 'pc', 'pca', 'ansicpg', 'deff', 'deflang', 'deflangfe',
    'adeflang', 'adeff', 'fet', 'fromtext', 'viewkind', 'viewscale', 'viewzk',
    'uc', 'deftab', 'nouicompat', 'nofpages', 'nofwords', 'nofchars', 'nofcharsw',
    'lnbrkrule', 'widowctrl', 'hyphauto', 'formshade', 'horzdoc', 'vertdoc',
    'jexpand', 'viewbksp', 'nolnhtadjtbl', 'generator', 'splytwnine', 'ftnsep',
    'ftnsepc', 'ftncn', 'aendnotes', 'aenddoc', 'ltrsect', 'rtlpar', 'ltrpar',
    'ltrch', 'rtlch', 'dbch', 'loch', 'hich', 'cchs', 'ansicpg', 'nofchars',
    'oldcprops', 'oldpprops', 'oldsprops', 'oldtprops', 'clmgf', 'clmrg',
  ]);

  const WS = /[ \t\r\n\f]/;

  /** 从 i 开始读一个控制字，返回 {word, end}。
      只把「数字后面紧跟的那个空格」当定界符吃掉 —— 后面如果是反斜杠，
      那是下一个控制字，绝不能一起吞掉。 */
  function readControlWord(s, i) {
    let j = i + 1;
    let word = '';
    while (j < s.length && /[a-zA-Z]/.test(s[j])) word += s[j++];
    if (s[j] === '-') j++;
    while (j < s.length && /[0-9]/.test(s[j])) j++;
    if (s[j] === ' ') j++;
    return { word: word, end: j };
  }

  /** 跳过 { … } 整个组（s[i] 必须是 '{'），返回闭合花括号后的下标 */
  function skipGroup(s, i) {
    let depth = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; i++; if (depth === 0) return i; continue; }
      i++;
    }
    return i;
  }

  /**
   * 正文在源字符串里的起始下标（与 splitSource 的切分点一致）。
   * 单独抽出来是为了能在**原始字节**上做同样的切分：
   * 前言里的字体名可能是 GBK 字节，只有拿到原始字节才能原样写回。
   */
  function bodyStartIndex(s) {
    s = String(s || '');
    let i = 0;
    if (s[i] === '{') i++;
    // 1) 文档头：只吃 HEADER_WORDS 里的控制字
    for (;;) {
      const save = i;
      while (i < s.length && WS.test(s[i])) i++;
      if (s[i] !== '\\') { i = save; break; }
      const cw = readControlWord(s, i);
      if (!cw.word || !HEADER_WORDS.has(cw.word)) { i = save; break; }
      i = cw.end;
    }
    // 2) 依次跳过字体表 / 颜色表 / 样式表 / 星号组
    for (;;) {
      const save = i;
      while (i < s.length && WS.test(s[i])) i++;
      if (s[i] !== '{') { i = save; break; }
      i = skipGroup(s, i);
    }
    // 3) 正文从 \pard 开始；没有 \pard 就从上面停下的地方开始
    const at = s.indexOf('\\pard', i);
    return at >= 0 ? at : i;
  }

  /** 原始字节里的正文起始位置（只看 ASCII，不受文本解码影响） */
  function bodyStartBytes(bytes) {
    const n = bytes.length;
    let i = 0;
    const at = k => String.fromCharCode(bytes[k]);
    const isWs = k => { const c = bytes[k]; return c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a || c === 0x0c; };
    const isAlpha = k => { const c = bytes[k]; return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); };
    const isDigit = k => bytes[k] >= 48 && bytes[k] <= 57;
    function readWord(k) {                    // k 指向 '\'
      let j = k + 1, word = '';
      while (j < n && isAlpha(j)) word += at(j++);
      if (j < n && bytes[j] === 0x2d) j++;
      while (j < n && isDigit(j)) j++;
      if (j < n && bytes[j] === 0x20) j++;
      return { word: word, end: j };
    }
    function skipGrp(k) {
      let depth = 0;
      while (k < n) {
        const c = bytes[k];
        if (c === 0x5c) { k += 2; continue; }
        if (c === 0x7b) depth++;
        else if (c === 0x7d) { depth--; k++; if (depth === 0) return k; continue; }
        k++;
      }
      return k;
    }
    if (bytes[0] === 0x7b) i = 1;
    for (;;) {
      const save = i;
      while (i < n && isWs(i)) i++;
      if (i >= n || bytes[i] !== 0x5c) { i = save; break; }
      const cw = readWord(i);
      if (!cw.word || !HEADER_WORDS.has(cw.word)) { i = save; break; }
      i = cw.end;
    }
    for (;;) {
      const save = i;
      while (i < n && isWs(i)) i++;
      if (i >= n || bytes[i] !== 0x7b) { i = save; break; }
      i = skipGrp(i);
    }
    for (let k = i; k + 4 < n; k++) {
      if (bytes[k] === 0x5c && bytes[k + 1] === 0x70 && bytes[k + 2] === 0x61 &&
          bytes[k + 3] === 0x72 && bytes[k + 4] === 0x64) return k;
    }
    return i;
  }

  /** 原始字节 → 逐字节对应的字符串（写回时按 latin1 编码即可还原原字节） */
  function latin1OfBytes(bytes, from, to) {
    let out = '';
    const CH = 8192;
    for (let k = from; k < to; k += CH) {
      out += String.fromCharCode.apply(null, bytes.subarray(k, Math.min(to, k + CH)));
    }
    return out;
  }

  /**
   * 前言（原样保留的部分）。
   * 有原始字节时按字节切分并返回「一个字符 = 一个字节」的字符串，
   * 字体名是 GBK 字节也不会在写回时被重编码弄坏。
   */
  function preambleText(src, rawBytes) {
    if (rawBytes && rawBytes.length) {
      const end = bodyStartBytes(rawBytes);
      return latin1OfBytes(rawBytes, 0, end);
    }
    return String(src || '').slice(0, bodyStartIndex(src));
  }

  /**
   * 把源文件切成「前言（字体表/颜色表/样式表/文档级控制字）」和「正文」。
   * 写回时前言原样保留，只替换正文，这样文件自带的字体与样式不会丢。
   */
  function splitSource(src) {
    const s = String(src || '');
    const cut = bodyStartIndex(s);
    let body = s.slice(cut);
    // 去掉最外层结尾的 }
    const close = body.lastIndexOf('}');
    if (close >= 0) body = body.slice(0, close);
    return { preamble: s.slice(0, cut), body: body };
  }

  /** 内联样式 → RTF 控制字（只处理我们解析时会生成的标签） */
  function inlineToRtf(node, out, state) {
    if (!node) return;
    if (node.nodeType === 3) { out.push(escapeText(node.nodeValue, state && state.uc)); return; }
    if (node.nodeType !== 1) return;
    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'br') { out.push('\\line '); return; }
    const wrap = { b: ['\\b ', '\\b0 '], strong: ['\\b ', '\\b0 '],
                   i: ['\\i ', '\\i0 '], em: ['\\i ', '\\i0 '],
                   u: ['\\ul ', '\\ul0 '], s: ['\\strike ', '\\strike0 '],
                   sup: ['\\super ', '\\nosupersub '], sub: ['\\sub ', '\\nosubsub '] }[tag];
    if (wrap) {
      out.push(wrap[0]);
      const kids = node.childNodes || [];
      for (let i = 0; i < kids.length; i++) inlineToRtf(kids[i], out, state);
      out.push(wrap[1]);
    } else {
      const kids = node.childNodes || [];
      for (let i = 0; i < kids.length; i++) inlineToRtf(kids[i], out, state);
    }
  }

  /**
   * 把编辑后的 DOM 序列化成 RTF 正文，沿用文件自己的字体与字号。
   * node 可以是 DOM 元素，也可以是 {tagName, childNodes} 形式的对象（便于测试）。
   */
  function htmlToRtf(node, opts) {
    opts = opts || {};
    const fs = opts.fs || dominantFs(opts.source || '');
    const f = (opts.fontIndex != null) ? opts.fontIndex : defaultFontIndex(opts.source || '');
    const uc = (opts.uc != null) ? opts.uc : detectUc(opts.source || '');
    const out = [];
    out.push('\\pard' + (f != null ? '\\f' + f : '') + '\\fs' + (fs || 24) +
      '\\uc' + uc + '\\cf0 ');
    const blocks = [];
    const blockTags = ['p', 'div', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'];
    const kids = (node && node.childNodes) || [];
    let inline = [];
    const flushInline = () => {
      if (!inline.length) return;
      const parts = [];
      inline.forEach(n => inlineToRtf(n, parts, { uc: uc }));
      const text = parts.join('');
      // 空段落也要留着：RTF 里 \par\par 就是空行，丢了会把段落结构改掉
      blocks.push(text);
      inline = [];
    };
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.nodeType === 1 && blockTags.indexOf((k.tagName || '').toLowerCase()) >= 0) {
        flushInline();
        const parts = [];
        const inner = k.childNodes || [];
        for (let j = 0; j < inner.length; j++) inlineToRtf(inner[j], parts, { uc: uc });
        blocks.push(parts.join(''));
      } else {
        inline.push(k);
      }
    }
    flushInline();
    out.push(blocks.join('\\par\n'));
    out.push('\\par\n}');
    return out.join('');
  }

  /** 组装整份新文件：前言 + 新正文 + } */
  function rebuildSource(src, htmlRoot, rawBytes) {
    // 真实 DOM 里 #doc 的直接子节点是最外层 <div class="rtf-body">，段落语义在里面。
    // 不剥掉这层壳，htmlToRtf 会把整篇当成「一个块」，所有段落并成一段（主路径上的数据破坏）。
    let root = htmlRoot;
    if (root && root.nodeType === 1) {
      let wrap = null;
      try {
        if (typeof root.querySelector === 'function') wrap = root.querySelector('.rtf-body');
      } catch (e) { wrap = null; }
      if (!wrap) {
        const kids = root.childNodes || [];
        for (let i = 0; i < kids.length; i++) {
          const k = kids[i];
          if (k && k.nodeType === 1) {
            const cls = (k.className || (k.getAttribute && k.getAttribute('class')) || '') + '';
            if (/(^|\s)rtf-body(\s|$)/.test(cls)) { wrap = k; break; }
          }
        }
      }
      if (wrap) root = wrap;
    }
    // 注意：前言必须走 preambleText —— 有原始字节时它返回「一个字符 = 一个字节」的
    // 字符串，原生按 latin1 写回就是逐字节还原，GBK 字体名不会再触发编码失败。
    const preamble = preambleText(src, rawBytes);
    const newBody = htmlToRtf(root, { source: src });
    // htmlToRtf 末尾自带 }，这里只拼 前言 + 新正文
    return preamble + newBody;
  }

  return { parse, extractText, escapeText, dominantFs, defaultFontIndex,
    splitSource, bodyStartIndex, bodyStartBytes, preambleText, htmlToRtf, rebuildSource,
    detectUc, unmodeledDestinations, DEST_SKIP, LOSSY_DEST, CHARSET_PAGES: FCHARSET };
})();
