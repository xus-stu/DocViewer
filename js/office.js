/* =====================================================================
   office.js — 只用浏览器自带能力的 Office 文档预览（只读）
   · ZIP 解包：自己读中央目录，deflate 交给 DecompressionStream('deflate-raw')
   · DOCX：把 word/document.xml 还原成段落 / 标题 / 列表 / 表格 / 基础字符格式
   · PAGES：Pages 正文是 iwa 二进制（protobuf），这里只取文件里自带的预览图
   不引第三方库、不走网络。
   ===================================================================== */
window.DV = window.DV || {};

(function () {
  'use strict';

  /* ==================== ZIP ==================== */

  function u16(d, o) { return d[o] | (d[o + 1] << 8); }
  function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }

  /** 读出 ZIP 目录：{ 名字 → {method, size, offset} } */
  function readZipDirectory(bytes) {
    const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    // 从尾部找中央目录结束标记（0x06054b50），注释最长 65535
    let eocd = -1;
    const from = Math.max(0, d.length - 65557);
    for (let i = d.length - 22; i >= from; i--) {
      if (d[i] === 0x50 && d[i + 1] === 0x4b && d[i + 2] === 0x05 && d[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP / Office 文档（找不到中央目录）');
    const count = u16(d, eocd + 10);
    let p = u32(d, eocd + 16);
    const out = Object.create(null);
    for (let k = 0; k < count; k++) {
      if (p + 46 > d.length) break;
      if (u32(d, p) !== 0x02014b50) break;
      const method = u16(d, p + 10);
      const compSize = u32(d, p + 20);
      const size = u32(d, p + 24);
      const nameLen = u16(d, p + 28);
      const extraLen = u16(d, p + 30);
      const commentLen = u16(d, p + 32);
      const offset = u32(d, p + 42);
      const name = utf8(d.subarray(p + 46, p + 46 + nameLen));
      out[name] = { method: method, size: size, compSize: compSize, offset: offset };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  function utf8(sub) {
    try { return new TextDecoder('utf-8').decode(sub); }
    catch (e) {
      let s = '';
      for (let i = 0; i < sub.length; i++) s += String.fromCharCode(sub[i]);
      return s;
    }
  }

  /** 解压 raw deflate；环境里有 DecompressionStream 才行 */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('这个系统不支持解压（DecompressionStream），请用桌面版打开');
    }
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      chunks.push(r.value);
      total += r.value.length;
    }
    const out = new Uint8Array(total);
    let at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  }

  /** 取一个条目的原始字节（自动处理 stored / deflate） */
  async function readEntry(bytes, dir, name) {
    const e = dir[name];
    if (!e) return null;
    const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const p = e.offset;
    if (p + 30 > d.length || u32(d, p) !== 0x04034b50) throw new Error('ZIP 条目损坏：' + name);
    const nameLen = u16(d, p + 26);
    const extraLen = u16(d, p + 28);
    const start = p + 30 + nameLen + extraLen;
    let raw = d.subarray(start, start + e.compSize);
    if (e.method === 0) return raw;
    if (e.method === 8) return inflateRaw(raw);
    throw new Error('不支持的压缩方式 ' + e.method + '：' + name);
  }

  /* ==================== 内嵌图片 ==================== */

  const B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function base64(bytes) {
    const parts = [];
    let chunk = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      chunk += B64CHARS[b0 >> 2] + B64CHARS[((b0 & 3) << 4) | (b1 >> 4)];
      chunk += i + 1 < bytes.length ? B64CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
      chunk += i + 2 < bytes.length ? B64CHARS[b2 & 63] : '=';
      if (chunk.length >= 8192) { parts.push(chunk); chunk = ''; }
    }
    parts.push(chunk);
    return parts.join('');
  }

  const MEDIA_MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff',
    svg: 'image/svg+xml',
  };
  /** 单张内嵌图片的上限：超过就跳过（Word 里塞几百兆的图不是没有） */
  const MEDIA_MAX = 12 * 1024 * 1024;

  /** word/_rels/document.xml.rels → { rId: 'media/image1.png' } */
  function readRels(tree) {
    const out = Object.create(null);
    (function walk(n) {
      if (n.name === 'Relationship' && n.attrs && n.attrs.Id && n.attrs.Target) {
        if ((n.attrs.TargetMode || '').toLowerCase() === 'external') return;   // 外链图片不联网取
        let t = String(n.attrs.Target).replace(/^\//, '');
        if (t.indexOf('word/') !== 0) t = 'word/' + t;
        out[n.attrs.Id] = t;
      }
      n.children.forEach(walk);
    })(tree);
    return out;
  }

  /** 把 word/media/* 全部读成 data URL（文档里的图片一般不多，一次性读最省事） */
  async function readMedia(bytes, dir) {
    const out = Object.create(null);
    const names = Object.keys(dir).filter(function (n) { return /^word\/media\//i.test(n); });
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const ext = (name.split('.').pop() || '').toLowerCase();
      const mime = MEDIA_MIME[ext];
      if (!mime) continue;                       // emf/wmf 这类浏览器画不了，跳过
      const e = dir[name];
      if (!e || e.size > MEDIA_MAX) continue;
      const raw = await readEntry(bytes, dir, name);
      out[name] = 'data:' + mime + ';base64,' + base64(raw);
    }
    return out;
  }

  /* ==================== 极简 XML ==================== */

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function decodeEntities(s) {
    return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, g) {
      if (g.charAt(0) === '#') {
        const n = g.charAt(1).toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        return isNaN(n) ? m : String.fromCharCode(n);
      }
      return ENT[g] != null ? ENT[g] : m;
    });
  }

  /**
   * 解析成 { name, attrs, children, text } 树。
   * 只处理 Office 文档里会出现的写法：自闭合、注释、CDATA、命名空间前缀。
   */
  function parseXml(src) {
    const root = { name: '#root', attrs: {}, children: [], text: '' };
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(src))) {
      const top = stack[stack.length - 1];
      if (m[0].slice(0, 4) === '<!--' || m[0].slice(0, 2) === '<?' || m[0].slice(0, 9) === '<!DOCTYPE') continue;
      if (m[1] != null) { top.text += m[1]; continue; }                 // CDATA
      if (m[2]) {                                                       // 闭合标签
        for (let k = stack.length - 1; k > 0; k--) {
          if (stack[k].name === m[2]) { stack.length = k; break; }
        }
        continue;
      }
      if (m[3]) {                                                       // 开标签
        const node = { name: m[3], attrs: {}, children: [], text: '' };
        const ar = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let a;
        while ((a = ar.exec(m[4] || ''))) {
          node.attrs[a[1]] = decodeEntities(a[2] != null ? a[2] : a[3]);
        }
        top.children.push(node);
        if (!m[5]) stack.push(node);
        continue;
      }
      if (m[6] != null) top.text += decodeEntities(m[6]);
    }
    return root;
  }

  /** 按名字找第一个直接子节点 */
  function child(node, name) {
    if (!node) return null;
    for (let i = 0; i < node.children.length; i++) if (node.children[i].name === name) return node.children[i];
    return null;
  }
  function childrenNamed(node, name) {
    const out = [];
    if (!node) return out;
    node.children.forEach(function (c) { if (c.name === name) out.push(c); });
    return out;
  }
  /** 递归找第一个后代（跳过属性节点的干扰） */
  function deep(node, name) {
    if (!node) return null;
    for (let i = 0; i < node.children.length; i++) {
      const c = node.children[i];
      if (c.name === name) return c;
      const r = deep(c, name);
      if (r) return r;
    }
    return null;
  }

  const esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ==================== DOCX → HTML ==================== */

  const HEADING_RE = /^(?:heading|标题)\s*([1-6])$/i;

  /** 一个节点下面的纯文本（用来判断这段到底像不像标题） */
  function textOf(node) {
    let s = '';
    (function walk(n) {
      if (n.name === 'w:t') s += n.text;
      else if (n.name === 'w:tab') s += ' ';
      n.children.forEach(walk);
    })(node);
    return s.replace(/\s+/g, ' ').trim();
  }

  /** 长过这个字数的「标题」一律当正文：一段一百多字的句子不可能是标题 */
  const HEADING_MAX_CHARS = 60;

  function headingLevel(p) {
    const pPr = child(p, 'w:pPr');
    const style = child(pPr, 'w:pStyle');
    const val = style && style.attrs['w:val'];
    if (!val) return 0;
    let lvl = 0;
    if (/^title$/i.test(val) || /^标题$/.test(val)) lvl = 1;
    else {
      const m = HEADING_RE.exec(val);
      if (m) lvl = parseInt(m[1], 10);
    }
    if (!lvl) return 0;
    // Word 里「标题 1」常常被当成排版工具用在整段正文上 —— 试卷、讲义尤其常见。
    // 照着 h1 排会把整页撑得大小不一，所以长段落一律按正文处理。
    const t = textOf(p);
    if (!t || t.length > HEADING_MAX_CHARS) return 0;
    return lvl;
  }

  /** 渲染上下文：图片关系表、媒体数据、是否沿用文档自带字体 */
  const CTX = { rels: null, media: null, keepFonts: false, images: 0 };

  /** 一个 run 里可能挂着的图片（DrawingML 或老式 VML） */
  function runImageHtml(r) {
    if (!CTX.media) return '';
    let rid = '';
    const blip = deep(r, 'a:blip');
    if (blip) rid = blip.attrs['r:embed'] || blip.attrs['r:link'] || '';
    if (!rid) {
      const vml = deep(r, 'v:imagedata');
      if (vml) rid = vml.attrs['r:id'] || '';
    }
    if (!rid) return '';
    const target = CTX.rels && CTX.rels[rid];
    const url = target && CTX.media[target];
    if (!url) return '';
    // wp:extent 的单位是 EMU，1 px = 9525 EMU
    let w = 0, h = 0;
    const ext = deep(r, 'wp:extent');
    if (ext) {
      w = Math.round(parseInt(ext.attrs.cx, 10) / 9525) || 0;
      h = Math.round(parseInt(ext.attrs.cy, 10) / 9525) || 0;
    }
    if (!w || w > 4000) w = 0;                   // 尺寸离谱就当自适应
    CTX.images++;
    const style = w ? ' style="width:' + w + 'px' + (h ? ';height:' + h + 'px' : ';height:auto') + '"' : '';
    return '<img class="docx-img" src="' + url + '" alt=""' + style + '>';
  }

  function inlineOfRun(r) {
    const img = runImageHtml(r);
    if (img) return img;
    let txt = '';
    r.children.forEach(function (c) {
      if (c.name === 'w:t') txt += c.text;
      else if (c.name === 'w:br') txt += '\n';
      else if (c.name === 'w:tab') txt += '\t';
      else if (c.name === 'w:cr') txt += '\n';
      else if (c.name === 'w:noBreakHyphen') txt += '\u2011';
    });
    if (!txt) return '';
    const rPr = child(r, 'w:rPr');
    const css = [];
    let cls = 'docx-r';
    if (rPr) {
      if (deep(rPr, 'w:b') && !(deep(rPr, 'w:b').attrs['w:val'] === '0')) txt = '<b>' + esc(txt) + '</b>';
      else txt = esc(txt);
      if (deep(rPr, 'w:i') && deep(rPr, 'w:i').attrs['w:val'] !== '0') txt = '<i>' + txt + '</i>';
      if (deep(rPr, 'w:u') && deep(rPr, 'w:u').attrs['w:val'] !== 'none') txt = '<u>' + txt + '</u>';
      if (deep(rPr, 'w:strike') && deep(rPr, 'w:strike').attrs['w:val'] !== '0') txt = '<s>' + txt + '</s>';
      const va = deep(rPr, 'w:vertAlign');
      if (va && va.attrs['w:val'] === 'superscript') txt = '<sup>' + txt + '</sup>';
      if (va && va.attrs['w:val'] === 'subscript') txt = '<sub>' + txt + '</sub>';
      const color = deep(rPr, 'w:color');
      // w:themeColor 表示"跟随主题色"，Word 会同时写一个 w:val 兜底值
      // （通常就是 000000）。照那个值上色，深色主题下正文就变成黑底黑字了。
      const themed = color && (color.attrs['w:themeColor'] || color.attrs['w:themeShade']);
      if (color && !themed && color.attrs['w:val'] && !/^auto$/i.test(color.attrs['w:val'])) {
        css.push('color:#' + color.attrs['w:val'].replace(/[^0-9a-f]/gi, '').slice(0, 6).toLowerCase());
      }
      const hl = deep(rPr, 'w:highlight');
      if (hl && hl.attrs['w:val'] && hl.attrs['w:val'] !== 'none') {
        css.push('background-color:' + hlName(hl.attrs['w:val']));
        // 高亮是浅底色，字色必须压深，否则深色主题下会"浅字浅底"
        css.push('color:#1b1b1b');
      }
      if (CTX.keepFonts) {
        const sz = deep(rPr, 'w:sz');
        if (sz && sz.attrs['w:val']) {
          const half = parseInt(sz.attrs['w:val'], 10);
          if (half > 0 && half !== 24) css.push('font-size:' + (half / 2) + 'pt');
        }
        const fonts = deep(rPr, 'w:rFonts');
        if (fonts && (fonts.attrs['w:ascii'] || fonts.attrs['w:eastAsia'])) {
          const family = (fonts.attrs['w:eastAsia'] || fonts.attrs['w:ascii']).replace(/"/g, '');
          css.push('font-family:"' + family + '",inherit');
        }
      }
    } else {
      txt = esc(txt);
    }
    return css.length ? '<span class="' + cls + '" style="' + css.join(';') + '">' + txt + '</span>' : txt;
  }

  function hlName(v) {
    const map = {
      yellow: '#fff2a8', green: '#b8f0b8', cyan: '#b8f0f0', magenta: '#f8b8f8', blue: '#b8d8f8',
      red: '#f8b8b8', darkBlue: '#94b8e8', darkCyan: '#94e8e8', darkGreen: '#94e894',
      darkMagenta: '#e894e8', darkRed: '#e89494', darkYellow: '#e8d894', darkGray: '#c0c0c0',
      lightGray: '#e8e8e8', black: '#000000',
    };
    return map[v] || '#fff2a8';
  }

  function runsHtml(node) {
    let out = '';
    node.children.forEach(function (c) {
      if (c.name === 'w:r') out += inlineOfRun(c);
      else if (c.name === 'w:hyperlink') out += runsHtml(c);
      else if (c.name === 'w:ins') out += runsHtml(c);          // 修订：插入的内容照常显示
      else if (c.name === 'w:smartTag' || c.name === 'w:sdt' || c.name === 'w:sdtContent') out += runsHtml(c);
      else if (c.name === 'w:del') { /* 删除的内容不显示 */ }
    });
    return out;
  }

  function paraHtml(p, inTable) {
    const pPr = child(p, 'w:pPr');
    const lvl = headingLevel(p);
    let inner = runsHtml(p);
    const style = [];
    if (pPr) {
      const jc = child(pPr, 'w:jc');
      if (jc && jc.attrs['w:val']) {
        const map = { center: 'center', right: 'right', both: 'justify', end: 'right' };
        if (map[jc.attrs['w:val']]) style.push('text-align:' + map[jc.attrs['w:val']]);
      }
      const ind = child(pPr, 'w:ind');
      if (ind) {
        const first = parseInt(ind.attrs['w:firstLine'] || ind.attrs['w:firstLineChars'] || '', 10);
        if (first > 0) style.push('text-indent:' + (first / 20).toFixed(1) + 'px');
        const left = parseInt(ind.attrs['w:left'] || ind.attrs['w:start'] || '', 10);
        if (left > 0) style.push('margin-left:' + (left / 20).toFixed(1) + 'px');
      }
      const shd = child(pPr, 'w:shd');
      if (shd && shd.attrs['w:fill'] && shd.attrs['w:fill'] !== 'auto') {
        style.push('background-color:#' + shd.attrs['w:fill'].replace(/[^0-9a-f]/gi, '').slice(0, 6).toLowerCase());
      }
    }
    // 空段落保留占位，否则 Word 里的空行会全被吃掉
    if (!inner.trim()) inner = '<br>';
    const attr = style.length ? ' style="' + style.join(';') + '"' : '';
    if (inTable) return '<p' + attr + '>' + inner + '</p>';
    if (lvl) return '<h' + lvl + attr + '>' + inner + '</h' + lvl + '>';
    return '<p' + attr + '>' + inner + '</p>';
  }

  function tableHtml(tbl) {
    let html = '<table class="docx-table">';
    let cols = 0;
    const grid = deep(tbl, 'w:tblGrid');
    if (grid) cols = childrenNamed(grid, 'w:gridCol').length;
    childrenNamed(tbl, 'w:tr').forEach(function (tr) {
      html += '<tr>';
      childrenNamed(tr, 'w:tc').forEach(function (tc) {
        const tcPr = child(tc, 'w:tcPr');
        let span = 1;
        if (tcPr) {
          const gs = child(tcPr, 'w:gridSpan');
          if (gs && gs.attrs['w:val']) span = Math.max(1, parseInt(gs.attrs['w:val'], 10) || 1);
        }
        html += '<td' + (span > 1 ? ' colspan="' + span + '"' : '') + '>';
        childrenNamed(tc, 'w:p').forEach(function (p) { html += paraHtml(p, true); });
        childrenNamed(tc, 'w:tbl').forEach(function (t) { html += tableHtml(t); });
        html += '</td>';
      });
      html += '</tr>';
    });
    html += '</table>';
    if (cols) html = html.replace('<table class="docx-table">', '<table class="docx-table" data-cols="' + cols + '">');
    return html;
  }

  /** 这个段落算不算列表项：numPr，或者 Word 内置的列表样式 */
  function listKind(p) {
    const pPr = child(p, 'w:pPr');
    if (!pPr) return '';
    if (child(pPr, 'w:numPr')) return 'ul';
    const style = child(pPr, 'w:pStyle');
    const val = style && style.attrs['w:val'];
    if (!val) return '';
    if (/^listbullet/i.test(val) || /^listparagraph$/i.test(val)) return 'ul';
    if (/^listnumber/i.test(val)) return 'ol';
    return '';
  }

  /** 列表：numPr / 列表样式的段落收进 <ul>，出现非列表段落就收尾 */
  function bodyHtml(body) {
    const out = [];
    let inList = false;
    const closeList = function () { if (inList) { out.push('</li></ul>'); inList = false; } };
    body.children.forEach(function (n) {
      if (n.name === 'w:p') {
        const kind = listKind(n);
        if (kind) {
          if (!inList) { out.push('<ul class="docx-list">'); inList = true; }
          else out.push('</li>');
          out.push('<li>' + runsHtml(n).replace(/^<br>$/, ''));
          return;
        }
        closeList();
        out.push(paraHtml(n, false));
        return;
      }
      if (n.name === 'w:tbl') { closeList(); out.push(tableHtml(n)); return; }
      // sectPr / bookmarkStart 之类不产生内容
    });
    closeList();
    return out.join('');
  }

  /**
   * 解析 .docx
   * @returns {{ok:boolean, html:string, paragraphs:number, tables:number, warnings:string[]}}
   */
  async function renderDocx(bytes, opts) {
    opts = opts || {};
    const warnings = [];
    const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dir = readZipDirectory(d);
    const names = Object.keys(dir);
    const main = names.filter(function (n) { return /^word\/document\d*\.xml$/i.test(n); })[0];
    if (!main) throw new Error('这个文件里没有 word/document.xml（不是 .docx？）');
    const xmlBytes = await readEntry(d, dir, main);
    const xml = utf8(xmlBytes);
    const tree = parseXml(xml);

    // 图片：关系表 + 媒体字节 → data URL；老式 .doc 转过来的文档没有这些，直接空表
    CTX.keepFonts = !!opts.keepFonts;
    CTX.images = 0;
    CTX.media = null;
    CTX.rels = Object.create(null);
    const relsName = names.filter(function (n) { return /^word\/_rels\/document\.xml\.rels$/i.test(n); })[0];
    if (relsName) {
      try {
        CTX.rels = readRels(parseXml(utf8(await readEntry(d, dir, relsName))));
      } catch (e) { CTX.rels = Object.create(null); }
    }
    if (names.some(function (n) { return /^word\/media\//i.test(n); })) {
      CTX.media = await readMedia(d, dir);
      const skipped = names.filter(function (n) { return /^word\/media\//i.test(n); }).length -
        Object.keys(CTX.media).length;
      if (skipped > 0) warnings.push('有 ' + skipped + ' 张图片的格式浏览器画不出来（EMF/WMF 等），已跳过');
    }

    const doc = deep(tree, 'w:document');
    const body = doc && child(doc, 'w:body');
    if (!body) throw new Error('document.xml 结构不认识');
    const html = bodyHtml(body);
    const paragraphs = (xml.match(/<w:p[\s>]/g) || []).length;
    const tables = (xml.match(/<w:tbl[\s>]/g) || []).length;
    if (names.some(function (n) { return /^word\/footnotes\.xml$/i.test(n); })) {
      warnings.push('脚注不显示');
    }
    return { ok: true, html: '<div class="docx-body">' + html + '</div>',
      paragraphs: paragraphs, tables: tables, images: CTX.images, warnings: warnings };
  }

  /** 只要文档里的纯文本（用于搜索 / 字数统计 / 复制） */
  function plainOf(html) {
    return String(html || '')
      .replace(/<\/(p|h[1-6]|li|tr|div)>/g, '\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n');
  }

  /* ==================== PAGES：取内嵌预览图 ==================== */

  const PREVIEW_NAMES = [
    'preview.jpg', 'preview.jpeg', 'Preview.jpg', 'Preview.jpeg',
    'QuickLook/Thumbnail.jpg', 'quicklook/thumbnail.jpg',
    'preview-web.jpg', 'preview-micro.jpg', 'Preview.png', 'preview.png',
  ];

  async function pagesPreview(bytes) {
    const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dir = readZipDirectory(d);
    const names = Object.keys(dir);
    let best = null;
    for (let i = 0; i < PREVIEW_NAMES.length; i++) {
      if (dir[PREVIEW_NAMES[i]]) { best = PREVIEW_NAMES[i]; break; }
    }
    if (!best) {
      // 名字大小写不固定，兜底再找一遍
      best = names.filter(function (n) { return /preview|thumbnail/i.test(n) && /\.(jpe?g|png)$/i.test(n); })[0] || null;
    }
    if (!best) return null;
    const raw = await readEntry(d, dir, best);
    const mime = /\.png$/i.test(best) ? 'image/png' : 'image/jpeg';
    return { name: best, mime: mime, data: raw };
  }

  /** 这个 zip 里有哪些条目（诊断用） */
  function listEntries(bytes) {
    return Object.keys(readZipDirectory(bytes));
  }

  DV.office = {
    readZipDirectory: readZipDirectory,
    readEntry: readEntry,
    listEntries: listEntries,
    parseXml: parseXml,
    renderDocx: renderDocx,
    plainOf: plainOf,
    pagesPreview: pagesPreview,
    inflateRaw: inflateRaw,
  };
})();
