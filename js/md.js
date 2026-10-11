/* =====================================================================
   md.js — 零依赖 Markdown 渲染器
   支持：标题/段落/引用/列表(含任务)/代码块(围栏+缩进)/表格/分割线/
         行内代码/粗斜体/删除线/链接/图片/自动链接/锚点
   ===================================================================== */
window.DV = window.DV || {};

DV.md = (function () {

  function esc(s) { return DV.esc(s); }

  /* ---------------- 行内解析 ---------------- */
  function inline(text) {
    if (text == null) return '';
    const store = [];
    const stash = html => { store.push(html); return '\u0000' + (store.length - 1) + '\u0000'; };

    // 1) 行内代码优先，避免其中内容被二次解析
    let s = String(text).replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m, tick, code) =>
      stash('<code>' + esc(code.replace(/^ (.*) $/, '$1')) + '</code>'));

    // 2) 图片 ![alt](src "title")
    s = s.replace(/!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+["']([^"']*)["'])?\s*\)/g,
      (m, alt, src, title) =>
        stash('<img src="' + DV.escAttr(src) + '" alt="' + DV.escAttr(alt) + '"' +
          (title ? ' title="' + DV.escAttr(title) + '"' : '') + ' loading="lazy">'));

    // 3) 链接 [text](href "title")
    s = s.replace(/\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+["']([^"']*)["'])?\s*\)/g,
      (m, txt, href, title) =>
        stash('<a href="' + DV.escAttr(href) + '" target="_blank" rel="noreferrer"' +
          (title ? ' title="' + DV.escAttr(title) + '"' : '') + '>' + inline(txt) + '</a>'));

    // 4) 引用式链接 [text][id] / [text][] —— 简化：直接退化为文本
    s = s.replace(/\[([^\]]*)\]\[[^\]]*\]/g, (m, txt) => inline(txt));

    // 5) 自动链接
    s = s.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, (m, url) =>
      stash('<a href="' + DV.escAttr(url) + '" target="_blank" rel="noreferrer">' + esc(url) + '</a>'));
    s = s.replace(/(^|[\s(（])((?:https?:\/\/)[^\s<>()（）]+)/g,
      (m, pre, url) => pre + stash('<a href="' + DV.escAttr(url) + '" target="_blank" rel="noreferrer">' + esc(url) + '</a>'));

    // 6) 裸 HTML 一律转义（安全）
    s = esc(s);
    // 但上面 esc 会破坏已 stash 的 \u0000N\u0000 —— 它们不含特殊字符，安全

    // 7) 强调
    s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
    s = s.replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?![\w_])/g, '$1<em>$2</em>');
    s = s.replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>');

    // 8) 行内换行
    s = s.replace(/ {2,}\n/g, '<br>\n');

    // 9) HTML 实体还原（esc 已处理，这里保持原样）

    // 10) 还原 stash
    s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => store[+i] || '');
    return s;
  }

  /* ---------------- 代码高亮（极简） ---------------- */
  const KEYWORDS = /\b(function|return|if|else|for|while|do|break|continue|const|let|var|new|class|extends|super|this|import|from|export|default|try|catch|finally|throw|typeof|instanceof|null|undefined|true|false|def|elif|lambda|pass|raise|with|as|in|not|and|or|None|True|False|self|public|private|protected|static|void|int|float|double|bool|string|struct|enum|package|switch|case|default|yield|async|await|match)\b/g;

  function highlight(code) {
    // 先分出「字符串」与「注释」，其余部分再做关键字/数字着色
    const src = String(code);
    let html = '';
    let plain = '';
    const flush = () => {
      if (!plain) return;
      html += esc(plain)
        .replace(new RegExp(KEYWORDS.source, 'g'), m => '\u0001k' + m + '\u0001')
        .replace(/\b\d+(?:\.\d+)?\b/g, m => '\u0001n' + m + '\u0001')
        .replace(/\u0001k([\s\S]*?)\u0001/g, (m, w) => '<span class="tok-key">' + w + '</span>')
        .replace(/\u0001n([\s\S]*?)\u0001/g, (m, w) => '<span class="tok-num">' + w + '</span>');
      plain = '';
    };
    let i = 0;
    while (i < src.length) {
      const ch = src[i], nx = src[i + 1];
      if (ch === '/' && nx === '/') {
        flush();
        let j = i; while (j < src.length && src[j] !== '\n') j++;
        html += '<span class="tok-com">' + esc(src.slice(i, j)) + '</span>';
        i = j; continue;
      }
      if (ch === '/' && nx === '*') {
        flush();
        let j = src.indexOf('*/', i + 2); j = j < 0 ? src.length : j + 2;
        html += '<span class="tok-com">' + esc(src.slice(i, j)) + '</span>';
        i = j; continue;
      }
      if (ch === '#' && nx !== '!') {
        // 行注释：# / --（不影响 JSON 之外的普通文本，只在代码块中使用）
        flush();
        let j = i; while (j < src.length && src[j] !== '\n') j++;
        html += '<span class="tok-com">' + esc(src.slice(i, j)) + '</span>';
        i = j; continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        flush();
        let j = i + 1;
        while (j < src.length && src[j] !== ch) { if (src[j] === '\\') j++; j++; }
        j = Math.min(j + 1, src.length);
        html += '<span class="tok-str">' + esc(src.slice(i, j)) + '</span>';
        i = j; continue;
      }
      plain += ch; i++;
    }
    flush();
    return html;
  }

  /* ---------------- 列表（先建树，再渲染，避免非法嵌套） ---------------- */
  const LIST_RE = /^( *)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;

  function parseList(lines, i, opt, headings) {
    function parseLevel(start, minIndent) {
      const items = [];
      let j = start;
      let ordered = false, startNum = null;
      while (j < lines.length) {
        const m = lines[j].match(LIST_RE);
        if (!m) break;
        const indent = m[1].length;
        const marker = m[2];
        if (indent < minIndent) break;
        if (indent > minIndent) break;
        ordered = /\d/.test(marker[0]);
        if (ordered && startNum == null) startNum = parseInt(marker, 10) || 1;
        const contentLines = [m[4]];
        j++;
        // 续行 / 空行后的续行
        while (j < lines.length) {
          const nl = lines[j];
          if (nl.trim() === '') {
            if (j + 1 < lines.length && (LIST_RE.test(lines[j + 1]) || /^\s{2,}\S/.test(lines[j + 1]))) {
              contentLines.push('');
              j++;
              continue;
            }
            break;
          }
          if (LIST_RE.test(nl)) break;   // 同级/更浅的列表项：本项结束
          const ind = nl.match(/^ */)[0].length;
          if (ind > indent) { contentLines.push(nl.replace(/^ {1,4}/, '')); j++; continue; }
          break;
        }
        const item = { content: contentLines.join('\n').trim(), children: [], ordered: false };
        item.bullet = marker;
        // 子列表
        if (j < lines.length) {
          const nm = lines[j].match(LIST_RE);
          if (nm && nm[1].length > indent) {
            const sub = parseLevel(j, nm[1].length);
            item.children = sub.items;
            item.ordered = sub.ordered;
            j = sub.next;
          }
        }
        items.push(item);
      }
      return { items, next: j, ordered, startNum };
    }
    const r = parseLevel(i, lines[i].match(LIST_RE)[1].length);
    return r;
  }

  function renderList(node, out, opt, headings) {
    const tag = node.ordered ? 'ol' : 'ul';
    out.push('<' + tag + (node.startNum && node.startNum !== 1 ? ' start="' + node.startNum + '"' : '') + '>');
    node.items.forEach(it => {
      let content = it.content || '';
      const task = content.match(/^\[([ xX])\]\s*([\s\S]*)$/);
      let cls = '', pre = '';
      if (task) {
        cls = ' class="task-item"';
        pre = '<input type="checkbox" disabled' + (task[1].toLowerCase() === 'x' ? ' checked' : '') + '> ';
        content = task[2];
      }
      let inner = '';
      if (content) {
        const sub = blocks(content, opt);
        (sub.headings || []).forEach(h => headings.push(h));
        inner = sub.html.replace(/^<p>([\s\S]*?)<\/p>\s*$/, '$1');
      }
      if (it.children && it.children.length) {
        const co = [];
        renderList({ items: it.children, ordered: !!it.ordered, startNum: 1 }, co, opt, headings);
        inner += co.join('');
      }
      out.push('<li' + cls + '>' + pre + inner + '</li>');
    });
    out.push('</' + tag + '>');
  }

  /* ---------------- 表格 ---------------- */
  function splitRow(line) {
    let s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
      if (ch === '|') { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells.map(c => c.trim());
  }
  const DELIM_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

  /* ---------------- 块级解析 ---------------- */
  function blocks(src, opt) {
    const lines = String(src).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    const out = [];
    const headings = [];
    let i = 0;
    let listStack = [];

    function closeLists() {
      while (listStack.length) { out.push('</' + listStack.pop() + '>'); }
    }

    while (i < lines.length) {
      const line = lines[i];

      // 代码围栏
      const fence = line.match(/^\s{0,3}(```+|~~~+)\s*([^\s`]*)/);
      if (fence) {
        closeLists();
        const mark = fence[1][0].repeat(3);
        const lang = fence[2] || '';
        const buf = [];
        i++;
        while (i < lines.length && !new RegExp('^\\s{0,3}' + mark + '\\s*$').test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // 跳过结束围栏
        const code = buf.join('\n');
        out.push('<pre class="code' + (lang ? ' lang-' + esc(lang) : '') + '"><code>' +
          (opt && opt.highlight ? highlight(code) : esc(code)) + '</code></pre>');
        continue;
      }

      // 分割线
      if (/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
        closeLists(); out.push('<hr>'); i++; continue;
      }

      // 标题
      const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) {
        closeLists();
        const lv = h[1].length;
        const txt = inline(h[2]);
        const id = 'h-' + (headings.length + 1) + '-' +
          h[2].replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
        headings.push({ level: lv, text: h[2], id });
        out.push('<h' + lv + ' id="' + id + '">' + txt +
          '<a class="anchor" href="#' + id + '" aria-hidden="true">#</a></h' + lv + '>');
        i++; continue;
      }

      // 表格
      if (line.includes('|') && i + 1 < lines.length && DELIM_ROW.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        closeLists();
        const head = splitRow(line);
        const aligns = splitRow(lines[i + 1]).map(c => {
          const l = c.startsWith(':'), r = c.endsWith(':');
          return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
        });
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
          rows.push(splitRow(lines[i])); i++;
        }
        let html = '<table><thead><tr>' + head.map((c, k) =>
          '<th' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inline(c) + '</th>').join('') +
          '</tr></thead><tbody>';
        rows.forEach(r => {
          html += '<tr>' + r.map((c, k) =>
            '<td' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inline(c) + '</td>').join('') + '</tr>';
        });
        html += '</tbody></table>';
        out.push(html);
        continue;
      }

      // 引用
      if (/^\s{0,3}>/.test(line)) {
        closeLists();
        const buf = [];
        while (i < lines.length) {
          const cur2 = lines[i];
          if (/^\s{0,3}>/.test(cur2)) { buf.push(cur2.replace(/^\s{0,3}>\s?/, '')); i++; continue; }
          // 延迟式续行：非空、非块级起始的行并入引用
          if (buf.length && cur2.trim() !== '' &&
              !/^\s{0,3}(#{1,6}\s|>|```|~~~|\s*([-*+]|\d{1,9}[.)])\s)/.test(cur2) &&
              !/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(cur2)) {
            buf.push(cur2); i++; continue;
          }
          break;
        }
        const sub1 = blocks(buf.join('\n'), opt);
        sub1.headings.forEach(hd => headings.push(hd));
        out.push('<blockquote>' + sub1.html + '</blockquote>');
        continue;
      }

      // 列表
      const li = line.match(LIST_RE);
      if (li) {
        closeLists();
        const r = parseList(lines, i, opt, headings);
        renderList(r, out, opt, headings);
        i = r.next;
        continue;
      }

      // 空行
      if (line.trim() === '') { closeLists(); i++; continue; }

      // 缩进代码块
      if (/^ {4,}/.test(line) && !/^\s*$/.test(line)) {
        closeLists();
        const buf = [];
        while (i < lines.length && (/^ {4,}/.test(lines[i]) || lines[i].trim() === '')) { buf.push(lines[i].replace(/^ {4}/, '')); i++; }
        out.push('<pre class="code"><code>' + esc(buf.join('\n').replace(/\n+$/, '')) + '</code></pre>');
        continue;
      }

      // 段落（连续非空行合并）
      closeLists();
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() !== '' &&
        !/^(\s*)(#{1,6}\s|>|```|~~~|[-*+]\s|\d{1,9}[.)]\s)/.test(lines[i]) &&
        !/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(lines[i]) &&
        !(lines[i].includes('|') && DELIM_ROW.test(lines[i]))) {
        buf.push(lines[i]); i++;
      }
      out.push('<p>' + inline(buf.join('\n')) + '</p>');
    }
    closeLists();
    return { html: out.join('\n'), headings };
  }

  /* ---------------- 目录 ---------------- */
  function buildToc(headings, title) {
    const hs = headings.filter(h => h.level <= 3);
    if (hs.length < 3) return '';
    let html = '<nav class="md-toc"><div class="toc-title">' + esc(title || '目录') + '</div><ul>';
    hs.forEach(h => {
      html += '<li style="margin-left:' + ((h.level - 1) * 14) + 'px"><a href="#' + h.id + '">' + inline(h.text) + '</a></li>';
    });
    return html + '</ul></nav>';
  }

  /**
   * 渲染 Markdown
   * @param {string} src
   * @param {{highlight?:boolean, toc?:boolean, tocTitle?:string}} [opts]
   * @returns {{html:string, headings:Array, tocHtml:string}}
   */
  function render(src, opts) {
    opts = opts || {};
    const r = blocks(src, opts);
    return {
      html: r.html,
      headings: r.headings,
      tocHtml: opts.toc ? buildToc(r.headings, opts.tocTitle) : '',
    };
  }

  return { render, inline, highlight, esc };
})();
