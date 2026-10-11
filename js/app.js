/* =====================================================================
   app.js — 主程序
   多文件管理 / 编码检测 / RTF·TXT·MD 渲染 / 搜索 / 拖拽 / 会话持久化
   ===================================================================== */
window.DV = window.DV || {};

(function () {
  'use strict';
  const $ = DV.$;
  const T0 = performance.now();
  const APP_VERSION = '1.3.0';

  /* ================= 状态 ================= */
  const state = {
    files: [],          // {id,name,path,size,file,kind,encoding,text,html,parsedAt,error,lines,chars}
    activeId: null,
    raw: false,         // 源码视图
    wrap: true,
    filter: '',
    selected: [],        // 多选（用于拼接）
    mergeSep: true,      // 合并文档是否显示分段标题
    activePart: 0,       // 当前所在的段
    query: '',
    matches: [],
    matchIndex: -1,
  };
  let uid = 0;
  const MAX_KEEP = 400 * 1024;     // 单个文件持久化上限
  const MAX_TOTAL = 4 * 1024 * 1024;

  const els = {};

  /* ================= 编码检测 ================= */
  function decodeBuffer(buf, hint) {
    const bytes = new Uint8Array(buf);
    // BOM
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)
      return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8 (BOM)' };
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE)
      return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16LE (BOM)' };
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF)
      return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16BE (BOM)' };

    const h = hint ? String(hint).toLowerCase().replace(/[^a-z0-9]/g, '') : '';

    function tryDec(enc) {
      try {
        const t = new TextDecoder(enc, { fatal: true }).decode(bytes);
        return t;
      } catch (e) { return null; }
    }

    const order = [];
    if (/936|gbk|gb2312|gb18030/.test(h)) order.push('gb18030');
    if (/950|big5/.test(h)) order.push('big5');
    if (/1252|latin/.test(h)) order.push('windows-1252');
    if (/utf8|65001/.test(h)) order.push('utf-8');
    order.push('utf-8', 'gb18030', 'big5', 'windows-1252', 'utf-16le');

    const seen = new Set();
    for (const enc of order) {
      if (seen.has(enc)) continue;
      seen.add(enc);
      const t = tryDec(enc);
      if (t != null) return { text: t, encoding: enc === 'gb18030' ? 'GB18030/GBK' : enc.toUpperCase() };
    }
    // 全部失败：非致命 UTF-8
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF-8 (替换非法字节)' };
  }

  /**
   * 判断 RTF 的代码页。
   *
   * 优先级：\ansicpg 声明 > 字体表里的 \fcharset > 默认 936。
   * 声明值是唯一权威 —— 用户文件写的是什么编码就按什么解。
   */
  function detectRtfCodepage(text) {
    const head = text.slice(0, 6000);
    const m = /\\ansicpg(\d+)/i.exec(head);
    if (m) return parseInt(m[1], 10);
    const cs = /\\fcharset(\d+)/i.exec(head);
    if (cs) {
      const n = parseInt(cs[1], 10);
      if (n === 134) return 936;                       // GB2312 / GBK
      if (n === 136) return 950;                       // Big5
      if (n === 128 || n === 129) return 932;          // Shift-JIS
      if (n === 0 || n === 1 || n === 2 || n === 77) return 1252;   // 西文
    }
    return 936;
  }

  /**
   * RTF \'hh 字节解码器（按 RTF 声明的代码页）
   *
   * 注意：rtf.js 会把连续出现的 \'hh 收集成 Uint8Array 后再整段交过来，
   * 因为 GBK/Big5 是多字节编码 —— 逐字节解码必然得到 U+FFFD。
   * 这里同时兼容旧的「单个 hex 字符串」调用形式。
   */
  function makeHexDecoder(codepage) {
    const multiByte = codepage === 936 || codepage === 950 || codepage === 54936 || codepage === 932;
    const encName = codepage === 950 ? 'big5'
      : codepage === 932 ? 'shift_jis'
        : 'gb18030';

    let decoder = null;
    if (multiByte) {
      try { decoder = new TextDecoder(encName); } catch (e) { decoder = null; }
    }

    const CP1252 = {
      0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E', 0x85: '\u2026',
      0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6', 0x89: '\u2030', 0x8A: '\u0160',
      0x8B: '\u2039', 0x8C: '\u0152', 0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019',
      0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
      0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A', 0x9C: '\u0153',
      0x9E: '\u017E', 0x9F: '\u0178',
    };

    // 只有当文件确实是单字节编码（cp1252 / 未声明且无多字节编码器）时才用 CP1252。
    // 声明了 cp936 一类多字节编码时，全部交给该编码器，绝不混入 CP1252 字形，
    // 否则孤立的 \'97 会被悄悄解成破折号「—」。
    const single = b => (b < 128 ? String.fromCharCode(b) : (CP1252[b] || String.fromCharCode(b)));

    function parseSingleHex(hex) {
      const b = parseInt(String(hex).replace(/[^0-9a-fA-F]/g, '').slice(0, 2), 16);
      return isNaN(b) ? '' : b;
    }

    /** 多字节编码：整段解码，非法序列直接丢弃（保留其中合法的字符） */
    function decodeStrict(arr) {
      try {
        const out = decoder.decode(arr);
        return out.indexOf('\uFFFD') >= 0 ? out.replace(/\uFFFD/g, '') : out;
      } catch (e) {
        let out = '';
        for (let k = 0; k < arr.length; k++) {
          try {
            const one = decoder.decode(Uint8Array.from([arr[k]]));
            if (one.indexOf('\uFFFD') < 0) out += one;
          } catch (e2) { /* 跳过非法字节 */ }
        }
        return out;
      }
    }

    return function decode(bytes) {
      // 兼容旧接口：传入的是 'hh' 这样的字符串
      if (typeof bytes === 'string') {
        const b = parseSingleHex(bytes);
        if (isNaN(b)) return '';
        if (b < 128) return String.fromCharCode(b);
        if (decoder) return decodeStrict(Uint8Array.from([b]));
        return single(b);
      }
      // 新接口：Uint8Array（可能含多字节字符）
      const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
      if (!arr.length) return '';
      if (decoder) return decodeStrict(arr);
      return Array.prototype.map.call(arr, single).join('');
    };
  }

  function gbkSupported() {
    try { new TextDecoder('gb18030'); return true; } catch (e) { return false; }
  }

  /* ================= 文件解析 ================= */
  function renderFile(item) {
    const kind = item.kind;
    const t0 = performance.now();
    let html = '';
    let info = {};
    const warnings = [];
    const text = item.text || '';

    if (kind === 'md') {
      const t1 = performance.now();
      const r = DV.md.render(text, {
        highlight: true,
        toc: /\[\[?toc\]?\]/i.test(text) || text.length > 6000,
        tocTitle: item.name.replace(/\.(md|markdown|mdown|mkd)$/i, ''),
      });
      const t2 = performance.now();
      html = (r.tocHtml ? r.tocHtml : '') + r.html;
      info = { 'Markdown 解析': DV.fmtMs(t2 - t1), '标题数': r.headings.length, '目录': r.tocHtml ? '已生成' : '未生成' };
    } else if (kind === 'rtf') {
      item.rawSrc = text;                    // 追加内容时要在原文里找 \fsN / \deffN
      const t1 = performance.now();
      const cp = detectRtfCodepage(text);
      const res = DV.rtf.parse(text, {
        decodeHex: makeHexDecoder(cp),
        softWrap: DV.Settings.get().rtfSoftWrap !== false,
      });
      const t2 = performance.now();
      html = res.html;
      res.warnings.forEach(w => warnings.push(w));
      info = {
        'RTF 解析': DV.fmtMs(t2 - t1),
        'RTF 代码页': 'cp' + cp,
        '控制字': DV.fmtNum(res.stats.controlWords),
        '组': DV.fmtNum(res.stats.groups),
        '段落': DV.fmtNum(res.stats.paragraphs),
        '表格': DV.fmtNum(res.stats.tables),
        '跳过组': DV.fmtNum(res.stats.skippedGroups),
        '硬换行 (\\par)': DV.fmtNum(res.stats.hardParagraphs || res.stats.paragraphs),
        '软换行 (<br>)': DV.fmtNum(res.stats.softBreaks || 0),
        '软分段 (空行)': DV.fmtNum(res.stats.softParagraphs || 0),
        '按源换行': DV.Settings.get().rtfSoftWrap !== false ? '开' : '关',
        '字体表': (res.fonts.filter(Boolean).map(f => f.name).filter(Boolean).slice(0, 4).join(' / ') || '—'),
        '颜色表': (res.colors.length - 1) + ' 项',
      };
      if (!html || html.replace(/<[^>]+>/g, '').trim().length < 2) {
        warnings.push('RTF 正文为空，已回退为纯文本视图');
      }
    } else {
      // txt / code：纯文本
      html = '<pre class="plain-text">' + DV.esc(text) + '</pre>';
      info = { '按纯文本展示': '是' };
    }

    // 拼接文档走 renderMerged，绝不能落到下面的纯文本分支（否则看起来像源码）
    if (kind === 'merged' && item.parts) {
      item.rawSrc = undefined;
      renderMerged(item);
      warnings.forEach(w => DV.Log.warn(item.name + '：' + w));
      return;
    }

    item.html = html;
    item.info = info;
    item.warnings = warnings;
    item.parsedAt = performance.now() - t0;
    warnings.forEach(w => DV.Log.warn(item.name + '：' + w));
  }

  function makeFileRecord(file, relPath) {
    const name = file.name;
    const kind = DV.kindOf(name);
    return {
      id: 'f' + (++uid),
      name,
      path: relPath || (file.webkitRelativePath || ''),
      file,
      size: file.size,
      kind,
    };
  }

  async function ingest(fileRecords, opts) {
    opts = opts || {};
    if (!fileRecords.length) return;
    const list = els.fileList;
    if (opts.showProgress !== false) {
      DV.toast(DV.t('正在读取 {n} 个文件…', { n: fileRecords.length }), '', 1600);
    }

    let ok = 0, fail = 0;
    for (let idx = 0; idx < fileRecords.length; idx++) {
      const item = fileRecords[idx];
      try {
        const buf = await item.file.arrayBuffer();
        const hint = /\.rtf$/i.test(item.name) ? 'gbk' : '';
        const dec = decodeBuffer(buf, hint);
        item.text = dec.text;
        item.encoding = dec.encoding;
        item.bytes = buf.byteLength;
        item.lines = countLines(dec.text);
        item.chars = dec.text.length;
        renderFile(item);
        state.files.push(item);
        ok++;
      } catch (e) {
        fail++;
        item.error = e.message || String(e);
        DV.Log.error('读取失败 ' + item.name + '：' + item.error);
      }
      if (idx % 25 === 24) await new Promise(r => setTimeout(r, 0)); // 让 UI 喘口气
    }

    DV.Log.ok('导入完成：成功 ' + ok + (fail ? '，失败 ' + fail : '') + '，共 ' + state.files.length + ' 个文件');
    refreshList();
    if (!state.activeId && state.files.length) {
      select(state.files[0].id);
    } else {
      saveSession();
    }
    if (fail) DV.toast(DV.t('{n} 个文件读取失败，详见 F3 日志', { n: fail }), 'err');
    else if (ok > 1) DV.toast(DV.t('已导入 {n} 个文件', { n: ok }), '', 1800);
  }

  function countLines(t) { return t ? t.split('\n').length : 0; }

  /* ================= 列表渲染 ================= */
  function kindBadge(item) {
    const k = DV.KIND[item.kind] || DV.KIND.other;
    return k;
  }

  /** 只更新行的 active / selected 状态，不重建 DOM（避免每次选中都闪一次入场动画） */
  function syncRowClasses() {
    const body = els.fileBody;
    if (!body) return;
    const rows = body.querySelectorAll('.fitem');
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = row.dataset.id;
      row.classList.toggle('active', id === state.activeId);
      row.classList.toggle('selected', isSelected(id));
    }
  }

  function refreshList() {
    const box = els.fileBody || els.fileList;
    const list = filteredFiles();

    let totalSize = 0;
    state.files.forEach(f => totalSize += (f.bytes || f.size || 0));
    els.statCount.textContent = state.files.length;
    els.statSize.textContent = DV.fmtBytes(totalSize);
    // 清理已不存在的选中项
    const ids = new Set(state.files.map(f => f.id));
    if (state.selected.some(id => !ids.has(id))) state.selected = state.selected.filter(id => ids.has(id));
    paintSelBar();

    if (!state.files.length || !list.length) {
      box.innerHTML = !state.files.length
        ? '<div class="empty-list"><p>' + DV.t('还没有文件') + '</p><p class="dim">' +
          DV.t('把文件拖到这里，或点下方「打开文件」') + '</p></div>'
        : '<div class="empty-list"><p>' + DV.t('没有匹配') + ' “' + DV.esc(state.filter) + '”</p></div>';
      if (els.listHL) els.listHL.hidden = true;
      return;
    }

    const frag = document.createDocumentFragment();
    list.forEach(f => {
      const k = kindBadge(f);
      const sel = isSelected(f.id);
      const div = document.createElement('div');
      div.className = 'fitem' +
        (f.id === state.activeId ? ' active' : '') +
        (sel ? ' selected' : '') +
        (f.merged ? ' merged' : '');
      div.dataset.id = f.id;
      div.draggable = true;
      const dim = f.merged
        ? (f.parts || []).length + ' 段拼接 · ' + DV.fmtBytes(f.bytes)
        : k.label + ' · ' + DV.fmtBytes(f.bytes || f.size) + (f.error ? ' · 读取失败' : '');
      div.title = (f.path ? f.path + '\n' : '') + f.name + '\n' + k.label +
        '\nCtrl/⌘ 点选 · Shift 连选 · 拖动排序';
      div.innerHTML =
        '<span class="fcheck">' + DV.icon('check') + '</span>' +
        '<span class="ficon">' + DV.icon(k.icon) + '</span>' +
        '<span class="fmeta"><span class="fname">' + DV.esc(f.name) + '</span>' +
        '<span class="fdim">' + DV.esc(dim) + '</span></span>' +
        '<button class="fclose" title="移除">' + DV.icon('x') + '</button>';
      div.querySelector('.fclose').addEventListener('click', e => { e.stopPropagation(); closeFile(f.id); });
      div.querySelector('.fcheck').addEventListener('click', e => {
        e.stopPropagation();
        toggleSelect(f.id);
      });
      div.addEventListener('click', e => {
        if (e.ctrlKey || e.metaKey) { toggleSelect(f.id); return; }
        if (e.shiftKey) { selectRange(f.id, e.altKey); return; }
        select(f.id);
      });
      wireRowDrag(div, f.id);
      frag.appendChild(div);
    });
    box.innerHTML = '';
    box.appendChild(frag);
    updateListHighlight();
  }

  /* ---- 侧栏拖动排序（改变拼接顺序） ---- */
  let dragId = null;
  function wireRowDrag(div, id) {
    div.addEventListener('dragstart', e => {
      dragId = id;
      div.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; } catch (err) { }
    });
    div.addEventListener('dragend', () => {
      dragId = null;
      DV.$$('.fitem', els.fileList).forEach(n => n.classList.remove('dragging', 'dropbefore', 'dropafter'));
    });
    div.addEventListener('dragover', e => {
      if (!dragId || dragId === id) return;
      e.preventDefault();
      const r = div.getBoundingClientRect();
      const after = r.height ? (e.clientY - r.top) > r.height / 2 : true;
      div.classList.toggle('dropafter', after);
      div.classList.toggle('dropbefore', !after);
    });
    div.addEventListener('dragleave', () => div.classList.remove('dropbefore', 'dropafter'));
    div.addEventListener('drop', e => {
      e.preventDefault();
      const after = div.classList.contains('dropafter');
      div.classList.remove('dropbefore', 'dropafter');
      if (!dragId || dragId === id) return;
      reorder(dragId, id, after);
    });
  }

  function reorder(fromId, toId, after) {
    const fromId2 = fromId, toId2 = toId;
    const from = state.files.findIndex(f => f.id === fromId);
    if (from < 0) return;
    const moved = state.files.splice(from, 1)[0];
    let to = state.files.findIndex(f => f.id === toId);
    if (to < 0) { state.files.splice(from, 0, moved); return; }
    if (after) to += 1;
    state.files.splice(to, 0, moved);
    const it = active();
    if (it && it.merged) {
      // 拖动合并条目 = 调整内部段顺序
      if (moved.merged && moved.id === it.id) {
        const from2 = it.parts.findIndex(p => p.id === fromId2);
        const to2 = it.parts.findIndex(p => p.id === toId2);
        if (from2 >= 0 && to2 >= 0) {
          const mv = it.parts.splice(from2, 1)[0];
          it.parts.splice(after ? to2 + 1 : to2, 0, mv);
          renderMerged(it);
          paintDoc(it);
        }
      } else {
        const order = new Map(state.files.map((f, i) => [f.id, i]));
        it.parts.sort((a, b) => (order.get(a.id) || 0) - (order.get(b.id) || 0));
        renderMerged(it);
        paintDoc(it);
      }
    }
    refreshList();
    DV.Log.debug('调整顺序：' + moved.name);
  }

  /* ================= 多选与拼接 ================= */
  function isSelected(id) { return state.selected.includes(id); }

  function filteredFiles() {
    const q = (state.filter || '').toLowerCase();
    return state.files.filter(f => !q || f.name.toLowerCase().includes(q) || (f.path || '').toLowerCase().includes(q));
  }

  function setSelection(ids) {
    state.selected = Array.from(new Set(ids)).filter(id => state.files.some(f => f.id === id));
    syncRowClasses();
    paintSelBar();
  }

  function toggleSelect(id) {
    const i = state.selected.indexOf(id);
    if (i >= 0) state.selected.splice(i, 1);
    else state.selected.push(id);
    syncRowClasses();
    paintSelBar();
  }

  function selectRange(id, additive) {
    const list = filteredFiles().map(f => f.id);
    const anchor = state.selected.length ? state.selected[state.selected.length - 1] : null;
    const a = list.indexOf(anchor == null ? id : anchor);
    const b = list.indexOf(id);
    if (a < 0 || b < 0) { setSelection([id]); return; }
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const range = list.slice(lo, hi + 1);
    setSelection(additive ? state.selected.concat(range) : range);
  }

  function paintSelBar() {
    const bar = els.selBar;
    if (!bar) return;
    const n = state.selected.length;
    bar.hidden = n === 0;
    if (n) {
      els.selCount.textContent = n;
      const total = state.selected.reduce((sum, id) => {
        const f = state.files.find(x => x.id === id);
        return sum + (f ? (f.bytes || f.size || 0) : 0);
      }, 0);
      els.selHint.textContent = DV.t('合计 {size} · Ctrl/⌘ 点选 · Shift 连选 · 拖动排序', { size: DV.fmtBytes(total) });
      els.btnMerge.disabled = n < 2;
      els.btnMerge.title = n < 2
        ? '至少选择 2 个文件才能拼接'
        : '按列表顺序拼接成 ' + n + ' 段（不改动原文件）';
    }
  }

  /** 生成分段标题 */
  function segHeadHtml(part, index, total) {
    const k = DV.KIND[part.kind] || DV.KIND.txt;
    return '<div class="seg-head">' +
      '<span class="seg-no">' + (index + 1) + '/' + total + '</span>' +
      '<span class="seg-name">' + DV.esc(part.name) + '</span>' +
      '<span class="seg-dim">' + k.label + ' · ' + DV.fmtBytes(part.bytes || part.size) +
      ' · ' + DV.fmtNum(part.lines || 0) + ' ' + DV.t('行') + '</span>' +
      '</div>';
  }

  /** 段落正文：统一成 HTML 片段 */
  function partBodyHtml(part) {
    const plain = part.kind === 'txt' || part.kind === 'code' || !part.html;
    if (plain) return '<pre class="plain-text">' + DV.esc(part.text || '') + '</pre>';
    return part.html;
  }

  /** 构建合并文档（可切换是否显示分段标题） */
  function buildMerged(item, withHeads) {
    const parts = item.parts || [];
    const out = [];
    parts.forEach((p, i) => {
      if (withHeads) out.push(segHeadHtml(p, i, parts.length));
      else if (i) out.push('<hr class="seg-sep">');
      out.push('<div class="seg-body" data-part="' + i + '">' + partBodyHtml(p) + '</div>');
    });
    return out.join('');
  }

  /** 合并已选文件 → 一个新的只读“虚拟文档”（不写回原文件） */
  function mergeSelected() {
    if (state.selected.length < 2) { DV.toast('至少选择 2 个文件', 'warn'); return null; }
    const selIds = state.selected.slice();
    const parts = selIds
      .map(id => state.files.find(f => f.id === id))
      .filter(Boolean);
    if (parts.length < 2) return null;

    // 原条目退出列表（对象本身被合并文档持有，拆开时原样还原）；
    // 这样侧栏不会同时出现原文件与合并视图，序号也不会错位。
    const rest = state.files.filter(f => selIds.indexOf(f.id) < 0);
    const insertAt = state.files.findIndex(f => selIds.indexOf(f.id) >= 0);
    state.files = rest;

    const name = parts[0].name.replace(/\.[^.]+$/, '') + ' + ' + (parts.length - 1) + ' 个文件';
    const item = {
      id: 'm' + (++uid),
      name,
      path: parts.map(p => p.path || p.name).join('  +  '),
      kind: 'merged',
      merged: true,
      parts,
      bytes: parts.reduce((a, p) => a + (p.bytes || p.size || 0), 0),
      size: 0,
      encoding: '合并视图 · ' + Array.from(new Set(parts.map(p => p.encoding))).join(' / '),
      lines: parts.reduce((a, p) => a + (p.lines || 0), 0),
      chars: parts.reduce((a, p) => a + (p.chars || 0), 0),
      warnings: [],
    };
    item.size = item.bytes;
    // 合并后的纯文本（用于复制 / 搜索兜底 / 统计）
    item.text = parts.map(p => '# ── ' + p.name + ' ──\n' + (p.text || '')).join('\n\n');
    renderMerged(item);

    const at = insertAt < 0 ? state.files.length : Math.min(insertAt, state.files.length);
    state.files.splice(at, 0, item);
    setSelection([]);
    refreshList();
    select(item.id);
    DV.Log.ok('拼接 ' + parts.length + ' 个文件 → ' + item.name + '（原文件未改动）');
    DV.toast(DV.t('已拼接 {n} 个文件（只影响本阅读器）', { n: parts.length }), '', 2400);
    return item;
  }

  function renderMerged(item) {
    const t0 = performance.now();
    item.html = buildMerged(item, !!state.mergeSep);
    item.htmlPlain = item.html;                 // 合并视图恒为富文本
    item.info = {
      '__m1': { __group: '拼接' },
      '来源文件数': DV.fmtNum((item.parts || []).length),
      '分段标题': state.mergeSep ? '显示' : '隐藏',
      '合并顺序': (item.parts || []).map((p, i) => (i + 1) + '. ' + p.name).join(' ｜ '),
    };
    item.parsedAt = performance.now() - t0;
  }

  /** 拆开：还原成各自独立的文件条目 */
  function splitMerged(item) {
    if (!item || !item.merged) return;
    const idx = state.files.findIndex(f => f.id === item.id);
    if (idx < 0) return;
    const parts = item.parts.slice();
    parts.forEach(p => { p.restored = true; });   // 复用原对象与 ID
    state.files.splice(idx, 1, ...parts);
    DV.Log.info('拆开合并文档 ' + item.name + '（位于 #' + idx + '）→ ' + parts.length + ' 个文件，当前共 ' + state.files.length);
    refreshList();
    select(parts[0].id);
    DV.toast(DV.t('已拆开为 {n} 个文件', { n: parts.length }), '', 1800);
  }

  /** 跳转到第 n 段 */
  function gotoPart(delta) {
    const it = active();
    if (!it || !it.merged) return;
    const n = it.parts.length;
    let i = state.activePart + delta;
    i = Math.max(0, Math.min(n - 1, i));
    if (i === state.activePart) return;
    state.activePart = i;
    const head = els.doc.querySelector('.seg-body[data-part="' + i + '"]') ||
      els.doc.querySelectorAll('.seg-body')[i];
    const target = els.doc.querySelectorAll('.seg-head')[i] || head;
    if (target) {
      const rel = target.offsetTop - els.doc.offsetTop;
      scrollDocTo(Math.max(0, rel), 320);
    }
    paintMergeBar();
    fixRtfColors(els.doc);
    applyEditMode();
  }

  /**
   * RTF 自带颜色适配：若某段文字与阅读背景的对比度过低（例如深色主题下的黑字），
   * 就把这段颜色交还给阅读器配色。只改呈现，不动原文件。
   */
  function fixRtfColors(doc) {
    if (!doc || !doc.querySelector) return;
    // RTF 富文本视图与「合并文档」里都嵌着 .rtf-body；只认 .rtf 类会漏掉合并视图
    if (!doc.querySelector('.rtf-body')) return;
    if (DV.Settings.get().rtfReaderFont === false) return;
    const spans = doc.querySelectorAll('[style*="color"]');
    if (!spans.length) return;

    const rgbOf = (c) => {
      const m = String(c).match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      return m ? [+m[1], +m[2], +m[3]] : null;
    };
    const lumOf = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };

    // 阅读区真正生效的背景（含自定义阅读底色）
    let bgRGB = null;
    for (const el of [DV.$('.doc-scroll'), document.body]) {
      if (!el) continue;
      const c = getComputedStyle(el).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bgRGB = rgbOf(c); if (bgRGB) break; }
    }
    if (!bgRGB) return;
    const lb = lumOf(bgRGB);

    let fixed = 0;
    for (let i = 0; i < spans.length; i++) {
      const f = rgbOf(getComputedStyle(spans[i]).color);
      if (!f) continue;
      const lf = lumOf(f);
      const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
      if (ratio < 3) { spans[i].style.color = ''; fixed++; }
    }
    if (fixed) DV.Log.info('RTF 颜色适配：' + fixed + ' 处对比度过低，已回退为阅读器配色');
  }

  /* ================= 选择与显示 ================= */
  function active() { return state.files.find(f => f.id === state.activeId) || null; }

  function select(id) {
    const prev = active();
    if (prev && prev.id !== id) {
      // 1) 把阅读位置记在离开的那个文件上（只读也一样记）
      try { prev.scrollTop = els.docScroll.scrollTop; } catch (e) { /* 忽略 */ }
      // 2) 还有没写回的改动就先写回它自己。定时器是全局的，等它到点再切文件
      //    会拿当前文件去写，等于把 B 的内容写进 A 的文件路径。
      clearTimeout(saveTimer);
      if (dirty && canEdit()) saveEdit();
      dirty = false;
    }
    const item = state.files.find(f => f.id === id);
    if (!item) return;
    state.activeId = id;
    state.query = ''; els.docSearch.value = ''; setHits('');
    state.matches = []; state.matchIndex = -1;
    paintDoc(item);
    if (state.query) runSearch(state.query);
    paintMergeBar();
    syncRowClasses();
    updateListHighlight(true);
    applyEditMode();
    saveSession();
    DV.Log.info('打开文件：' + item.name + '（' + (item.encoding || '?') + '，' + DV.fmtBytes(item.bytes || item.size) + '）');
  }

  /** 立即设置滚动位置：临时关掉 scroll-behavior:smooth，避免恢复位置时先滚一段动画 */
  function setScrollTopNow(el, v) {
    try {
      const prev = el.style && el.style.scrollBehavior;
      if (el.style) el.style.scrollBehavior = 'auto';
      el.scrollTop = v;
      if (el.style) el.style.scrollBehavior = prev || '';
    } catch (e) { try { el.scrollTop = v; } catch (e2) { /* 忽略 */ } }
  }

  function paintDoc(item, opts) {
    const k = kindBadge(item);
    // 重绘前的真实位置：写回源文件后的重绘要靠它原地不动
    const liveScrollTop = els.docScroll.scrollTop;
    els.docTitle.textContent = item.name;
    els.docTitle.title = item.path || item.name;
    const mf = DV.Settings.get().metaFields || {};
    const metaParts = [];
    if (mf.path) metaParts.push(item.path || DV.t(DV.KIND[item.kind].label));
    if (mf.type) metaParts.push(DV.t(k.label));
    if (mf.size) metaParts.push(DV.fmtBytes(item.bytes || item.size));
    if (mf.encoding) metaParts.push(item.encoding || '—');
    if (mf.lines && item.lines) metaParts.push(DV.fmtNum(item.lines) + ' ' + DV.t('行'));
    if (mf.chars && item.chars) metaParts.push(DV.fmtNum(item.chars) + ' ' + DV.t('字符'));
    els.docMeta.textContent = metaParts.filter(Boolean).join('  ·  ') || '';
    els.docMeta.hidden = metaParts.length === 0;

    els.sbFile.textContent = item.name;
    els.sbType.textContent = DV.t(k.label);
    els.sbEnc.textContent = item.encoding || '—';
    els.sbSize.textContent = DV.fmtBytes(item.bytes || item.size) +
      (item.lines ? ' · ' + DV.fmtNum(item.lines) + ' ' + DV.t('行') + ' / ' +
        DV.fmtNum(item.chars) + ' ' + DV.t('字符') : '');

    const doc = els.doc;
    doc.className = 'doc';
    doc.removeAttribute('style');

    if (item.error) {
      doc.innerHTML = '<div class="plain" style="color:var(--err)">读取失败：' + DV.esc(item.error) + '</div>';
      return;
    }

    const t0 = performance.now();
    if (item.merged) {
      // 合并文档：渲染时的分段标题开关需要即时生效
      renderMerged(item);
    }
    if (state.raw || item.kind === 'txt' || item.kind === 'code') {
      doc.classList.add('plain');
      if (!state.wrap) doc.classList.add('nowrap');
      doc.textContent = item.text;
    } else {
      doc.classList.add(item.merged ? 'merged' : item.kind === 'rtf' ? 'rtf' : 'md');
      if (!state.wrap) doc.classList.add('nowrap');
      doc.innerHTML = item.html;
    }
    // 字号

    const t1 = performance.now();
    // 文档滑入
    if (DV.Settings.get().anim !== 'off') {
      doc.classList.remove('slide-in'); void doc.offsetWidth; doc.classList.add('slide-in');
    }

    /* 阅读位置：
       - 因写回源文件而重绘（opts.keepScroll）：原地不动，别再跳回顶部
       - 否则按设置决定：开 = 回到该文件上次的位置，关 = 回到顶部 */
    const remember = DV.Settings.get().rememberScroll !== false;
    const target = (opts && opts.keepScroll)
      ? liveScrollTop
      : (remember ? (Number(item.scrollTop) || 0) : 0);
    if (target > 0) {
      setScrollTopNow(els.docScroll, target);
      // 图片/字体排版完成后高度会变，再校正一次
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => { if (active() === item) setScrollTopNow(els.docScroll, target); });
      }
    } else {
      // 从头开始：立即归零，切换文件时不该看到一段滚动动画
      setScrollTopNow(els.docScroll, 0);
    }
    setupReveal();

    // 统计
    const nodes = doc.getElementsByTagName('*').length;
    const words = (item.text.match(/[A-Za-z0-9_\u4e00-\u9fa5]+/g) || []).length;
    const info = Object.assign({}, item.info || {});
    if (item.merged) state.activePart = 0;
    DV.Debug.setDocument({
      '__a': { __group: '文件' },
      '名称': item.name,
      '相对路径': item.path || '—',
      '类型': k.label,
      '大小': DV.fmtBytes(item.bytes || item.size) + ' (' + DV.fmtNum(item.bytes || item.size) + ' B)',
      '编码': { value: item.encoding || '—', cls: 'acc' },
      '行数': DV.fmtNum(item.lines),
      '字符数': DV.fmtNum(item.chars),
      '词/字块数': DV.fmtNum(words),
      '__b': { __group: '解析' },
      '解析耗时': { value: DV.fmtMs(item.parsedAt || 0), cls: (item.parsedAt || 0) > 300 ? 'warn' : 'ok' },
      ...info,
      '__c': { __group: '渲染' },
      'DOM 注入耗时': DV.fmtMs(t1 - t0),
      '生成 DOM 节点': DV.fmtNum(nodes),
      '视图模式': state.raw ? '源码' : '渲染',
      '自动换行': state.wrap ? '开' : '关',
      '字号': DV.Settings.get().size + ' px',
      '__d': { __group: '告警' },
      '警告数': { value: (item.warnings || []).length, cls: (item.warnings || []).length ? 'warn' : 'ok' },
      ...(item.warnings || []).reduce((acc, w, i2) => { acc['warn' + i2] = w; return acc; }, {}),
    });
    DV.Debug.setRender({
      '当前文档': item.name,
      '解析+注入': DV.fmtMs(item.parsedAt + (t1 - t0)),
      'DOM 节点': DV.fmtNum(nodes),
      '视图': state.raw || item.kind === 'txt' || item.kind === 'code' ? '纯文本' : '富文本',
      '滚动高度': DV.fmtNum(els.docScroll.scrollHeight) + ' px',
    });

    window.__DV_LAST = { item, tags: nodes };
  }

  function paintMergeBar() {
    const bar = els.mergeBar;
    if (!bar) return;
    const it = active();
    const on = !!(it && it.merged);
    bar.hidden = !on;
    if (!on) return;
    const n = it.parts.length;
    els.mergeLabel.textContent = it.parts[state.activePart] ? it.parts[state.activePart].name : '拼接文档';
    els.mergeLabel.title = it.parts.map((p, i) => (i + 1) + '. ' + p.name).join('\n');
    els.mergePart.textContent = (state.activePart + 1) + ' / ' + n;
    els.btnMergeSep.textContent = DV.t('标题：{state}', { state: DV.t(state.mergeSep ? '开' : '关') });
    els.btnMergePrev.disabled = state.activePart <= 0;
    els.btnMergeNext.disabled = state.activePart >= n - 1;
  }

  function toggleMergeSep() {
    const it = active();
    if (!it || !it.merged) return;
    state.mergeSep = !state.mergeSep;
    renderMerged(it);
    paintDoc(it);
    if (state.query) runSearch(state.query);
    DV.Log.info('分段标题：' + (state.mergeSep ? '显示' : '隐藏'));
  }

  function closeFile(id) {
    const i = state.files.findIndex(f => f.id === id);
    if (i < 0) return;
    const [f] = state.files.splice(i, 1);
    DV.Log.info('移除文件：' + f.name);
    if (state.activeId === id) {
      state.activeId = null;
      if (state.files.length) select(state.files[Math.max(0, i - 1)].id);
      else showWelcome();
    }
    refreshList();
    saveSession();
  }

  function showWelcome() {
    els.doc.className = 'doc';
    els.doc.style.fontSize = '';
    els.doc.innerHTML = els.welcomeHTML;
    els.docTitle.textContent = '未打开文件';
    els.docMeta.textContent = '把文件拖进窗口，或点下方「打开文件」';
    ['sbFile', 'sbType', 'sbEnc', 'sbSize'].forEach(k => els[k].textContent = '—');
    paintMergeBar();
    DV.Debug.setDocument({});
    wireWelcome();
  }

  function wireWelcome() {
    const b = $('#btnWelcomeOpen');
    if (b) b.addEventListener('click', () => els.fileInput.click());
  }

  /* ================= 搜索 ================= */
  function clearSearch() {
    if (!state.matches.length) { setHits(''); return; }
    const parents = new Set();
    state.matches.forEach(t => { if (t[0].parentNode) parents.add(t[0].parentNode); });
    parents.forEach(p => p.normalize());
    state.matches = [];
    state.matchIndex = -1;
    setHits('');
  }

  function runSearch(term) {
    state.query = term;
    clearSearch();
    if (!term || term.length < 1) { setHits(''); return; }
    const root = els.doc;
    const needle = term.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (/^(SCRIPT|STYLE|MARK|TEXTAREA)$/.test(p.nodeName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    state.matches = [];
    textNodes.forEach(node => {
      const txt = node.nodeValue;
      const low = txt.toLowerCase();
      let from = 0, at;
      const hits = [];
      while ((at = low.indexOf(needle, from)) !== -1) { hits.push(at); from = at + needle.length; if (hits.length > 500) break; }
      if (!hits.length) return;
      const frag = document.createDocumentFragment();
      let cursor = 0;
      hits.forEach(h => {
        if (h > cursor) frag.appendChild(document.createTextNode(txt.slice(cursor, h)));
        const mark = document.createElement('mark');
        mark.className = 'hl';
        mark.textContent = txt.substr(h, term.length);
        frag.appendChild(mark);
        state.matches.push([mark, h]);
        cursor = h + term.length;
      });
      if (cursor < txt.length) frag.appendChild(document.createTextNode(txt.slice(cursor)));
      node.parentNode.replaceChild(frag, node);
    });

    if (state.matches.length) { state.matchIndex = 0; focusMatch(); }
    else setHits('无结果');
  }

  function setHits(t) { els.searchHits.textContent = t == null ? '' : t; }

  function focusMatch() {
    state.matches.forEach(m => m[0].classList.remove('current'));
    const m = state.matches[state.matchIndex];
    if (!m) return;
    m[0].classList.add('current');
    const sc = els.docScroll;
    const node = m[0];
    const target = node.offsetTop - sc.clientHeight / 2 + node.offsetHeight / 2;
    scrollDocTo(Math.max(0, target), 280);
    setHits((state.matchIndex + 1) + ' / ' + state.matches.length);
  }

  function stepMatch(dir) {
    if (!state.matches.length) return;
    state.matchIndex = (state.matchIndex + dir + state.matches.length) % state.matches.length;
    focusMatch();
  }

  /* ================= 会话持久化 ================= */
  function sessionOn() {
    try { return DV.Settings.get().rememberSession !== false; } catch (e) { return true; }
  }

  function saveSession() {
    if (!sessionOn()) return;
    try {
      const list = [];
      let total = 0;
      // 单个文档的记录（拼接文档的每个 part 也用同一种结构）
      const rec = (f) => ({
        name: f.name, path: f.path, fullPath: f.fullPath, size: f.bytes || f.size,
        encoding: f.encoding, kind: f.kind, text: f.text || '',
        scroll: Number(f.scrollTop) || 0,        // 该文件的阅读位置
      });
      state.files.forEach(f => {
        const t = f.text || '';
        if (t.length > MAX_KEEP) return;
        if (total + t.length > MAX_TOTAL) return;
        if (f.merged) {
          // 拼接文档：把各来源一起存下来，恢复后才能重建合并视图（可拆分、分段标题）
          const parts = (f.parts || []).map(rec);
          const sum = parts.reduce((a, p) => a + (p.text || '').length, 0);
          if (!parts.length || sum > MAX_KEEP || total + sum > MAX_TOTAL) return;
          total += sum;
          list.push({
            merged: true, name: f.name, path: f.path, kind: 'merged',
            encoding: f.encoding, lines: f.lines, chars: f.chars, size: f.bytes || f.size,
            parts: parts,
            scroll: Number(f.scrollTop) || 0,
          });
          return;
        }
        total += t.length;
        list.push(rec(f));
      });
      localStorage.setItem('docviewer.session', JSON.stringify({
        v: 1, at: Date.now(), active: active() ? active().name : null, files: list,
        wrap: state.wrap, raw: state.raw,
      }));
    } catch (e) {
      DV.Log.warn('会话保存失败：' + (e && e.name) + '（可能超出 localStorage 配额）');
    }
  }

  /** 首次打开（没有任何本地数据）时放入两份内置说明：英文一份、中文一份 */
  function seedWelcome() {
    const files = DV.WELCOME_FILES || [];
    if (!files.length) return false;
    let had = false;
    try { had = !!localStorage.getItem('docviewer.session') || !!localStorage.getItem('docviewer.settings.v1'); }
    catch (e) { had = false; }
    if (had || state.files.length) return false;

    const added = [];
    files.forEach((f, i) => {
      const text = f.text;
      // 不依赖 File 构造器（测试环境没有）
      const fileObj = (typeof File === 'function')
        ? new File([text], f.name, { type: 'text/markdown' }) : null;
      const item = {
        id: 'welcome' + i + '-' + Date.now().toString(36),
        file: fileObj,
        name: f.name,
        path: f.name,
        size: text.length,
        text: text,
        encoding: 'UTF-8',
        bytes: text.length,
        lines: countLines(text),
        chars: text.length,
        kind: DV.kindOf(f.name),
      };
      renderFile(item);
      state.files.push(item);
      added.push(item);
    });
    refreshList();
    if (added.length) select(added[0].id);
    DV.Log.info('首次打开：已载入内置说明 ' + added.map(x => x.name).join('、'));
    return true;
  }

  /* ================= 就地编辑（可写回源文件） ================= */
  function editable() { return DV.Settings.get().editMode === 'rw'; }
  function nativeBridge() {
    return (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.dv) || null;
  }
  function writablePath(item) {
    return !!(item && item.fullPath && item.fullPath.charAt(0) === '/' && nativeBridge());
  }
  /**
   * 当前能不能编辑：可编辑模式 + 有可写路径 + 不是拼接文档。
   * Markdown 不参与编辑：它保持原来的渲染显示（HTML→MD 会丢格式），
   * 写入功能只支持除 md 以外的文件。
   */
  function canEdit() {
    const it = active();
    if (!it) return false;
    if (it.kind === 'md') return false;
    return !!(editable() && !it.merged && writablePath(it));
  }

  const PLAIN_EDIT_OK = (() => {
    try {
      const d = document.createElement('div');
      d.contentEditable = 'plaintext-only';
      return d.contentEditable === 'plaintext-only';
    } catch (e) { return false; }
  })();

  /** 该文档是否按纯文本渲染（txt / code / 源码视图） */
  function isPlainView(item) {
    if (!item) return true;
    return !!(state.raw || item.kind === 'txt' || item.kind === 'code' ||
      (item.merged && state.raw));
  }

  /** 可编辑容器：RTF 富文本视图直接编辑 DOM；其余用纯文本编辑 */
  function editTarget() {
    const it = active();
    if (!it || !canEdit()) return null;
    if (it.kind === 'rtf' && !isPlainView(it)) return { item: it, plain: false };
    return { item: it, plain: true };
  }

  /** 根据当前状态给 doc 加上 / 去掉 contenteditable */
  function applyEditMode() {
    const doc = els.doc;
    if (!doc) return;
    const tgt = editTarget();
    const wants = !!tgt;
    if (!wants) {
      doc.removeAttribute('contenteditable');
      doc.classList.remove('editing');
      document.body.removeAttribute('data-edit');
      refreshSaveState();
      return;
    }
    const mode = tgt.plain && PLAIN_EDIT_OK ? 'plaintext-only' : 'true';
    const wasOn = doc.getAttribute('contenteditable') != null;
    if (doc.getAttribute('contenteditable') !== mode) doc.setAttribute('contenteditable', mode);
    doc.classList.add('editing');
    doc.spellcheck = false;
    document.body.setAttribute('data-edit', 'on');
    // 刚从只读切到可编辑：把光标送进正文，可以直接开始打字
    if (!wasOn && wantFocus) {
      wantFocus = false;
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { try { doc.focus(); } catch (e) { } });
      else setTimeout(() => { try { doc.focus(); } catch (e) { } }, 0);
    }
    refreshSaveState();
  }

  const AUTOSAVE_MS = 90 * 1000;         // 自动保存间隔：1.5 分钟
  let scrollSaveTimer = 0;               // 滚动后延迟写会话
  let saveTimer = 0, dirty = false, wantFocus = false;

  /** 手动保存（工具栏「保存」/ ⌘S）：只读或没有改动时给出提示，不写文件 */
  function manualSave() {
    if (!canEdit()) {
      DV.toast(DV.t('当前不可编辑：设置里的「编辑」为只读，或这个文件不支持写回'), 'warn', 2800);
      return false;
    }
    if (!dirty) {
      DV.toast(DV.t('没有需要保存的改动'), '', 1600);
      return false;
    }
    clearTimeout(saveTimer);
    return saveEdit();
  }

  function markDirty() {
    dirty = true;
    setSaveState('unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (dirty) saveEdit(); }, AUTOSAVE_MS);   // 停手 1.5 分钟自动保存
  }

  /**
   * 状态栏右下角的保存状态。
   * 可编辑（且能写回）时常显：未保存 / 保存中… / 已保存；
   * 只读或该文件不可写回时隐藏（没什么可说的）。
   */
  function setSaveState(kind) {
    const el = DV.$('#saveState');
    if (!el) return;
    const show = kind || (canEdit() ? 'saved' : '');
    el.hidden = !show;
    el.textContent = show === 'saving' ? DV.t('保存中…')
      : show === 'unsaved' ? DV.t('未保存') : DV.t('已保存');
    el.className = 'sb-item save-state ' + (show || '');
  }

  /** 进入可编辑 / 切换文件后刷新一次状态显示 */
  function refreshSaveState() {
    setSaveState(dirty ? 'unsaved' : (canEdit() ? 'saved' : ''));
  }

  /** 纯文本视图 → 文本（保留换行；<br> 与块级元素都算换行） */
  function domToText(node) {
    let out = '';
    const kids = (node && node.childNodes) || [];
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.nodeType === 3) { out += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      const tag = (n.tagName || '').toLowerCase();
      if (tag === 'br') { out += '\n'; continue; }
      const block = ['div', 'p', 'li'].indexOf(tag) >= 0;
      if (block && out && out.charAt(out.length - 1) !== '\n') out += '\n';
      out += domToText(n);
      if (block && out.charAt(out.length - 1) !== '\n') out += '\n';
    }
    return out;
  }

  /** 保存编辑结果：整份文件写回（RTF 用原文件的前言 + 重新序列化的正文） */
  function saveEdit() {
    const tgt = editTarget();
    if (!tgt) return false;
    const item = tgt.item;
    clearTimeout(saveTimer);
    dirty = false;
    setSaveState('saving');

    let payload;
    if (item.kind === 'rtf' && !tgt.plain) {
      payload = { text: DV.rtf.rebuildSource(item.rawSrc || '', els.doc), encoding: 'utf-8' };
      // RTF 用 ISO-8859-1 写回：snippet 是 ASCII，原有字节保持原样
      payload.encoding = 'latin1';
    } else {
      payload = { text: domToText(els.doc), encoding: item.encoding || 'utf-8' };
    }
    DV.Log.info('写回 ' + item.fullPath + '（' + (payload.encoding) + '，' +
      payload.text.length + ' 字符）');
    try {
      nativeBridge().postMessage(Object.assign({
        action: 'writeFile', path: item.fullPath,
      }, payload));
    } catch (e) {
      setSaveState('');
      DV.toast(DV.t('写入失败') + '：' + (e.message || e), 'err', 4000);
      return false;
    }
    return true;
  }

  /** 原生写完后回传结果 */
  window.__DV_WRITE_RESULT = function (res) {
    if (!res || !res.ok) {
      dirty = true;
      setSaveState('unsaved');
      DV.toast(DV.t('写入失败') + '：' + ((res && res.error) || '?'), 'err', 4200);
      DV.Log.error('写入失败：' + JSON.stringify(res));
      return;
    }
    const item = state.files.find(f => f.fullPath === res.path);
    if (item) {
      /* 只更新数据，绝不重绘文档。
         重绘会把滚动位置弹回顶部、丢掉光标与选区，正在打字的人会直接被打断。
         这里把重新渲染好的 HTML 存进 item.html，等下次真正需要显示时再用。 */
      if (item.kind === 'rtf' && !isPlainView(item)) {
        item.text = DV.rtf.rebuildSource(item.rawSrc || '', els.doc);
        item.rawSrc = item.text;
        renderFile(item);              // 只解析、不落 DOM
      } else {
        item.text = domToText(els.doc);
      }
      item.lines = countLines(item.text);
      item.chars = item.text.length;
      item.bytes = item.text.length;
      syncRowClasses();
      saveSession();                   // 正文变了，顺手把会话里的内容同步一下
    }
    setSaveState('saved');
    DV.Log.ok('已写回源文件：' + res.path);
  };

  function closePanes() {
    try { if (DV.SettingsUI && DV.SettingsUI.isOpen && DV.SettingsUI.isOpen()) DV.SettingsUI.hide(); } catch (e) { }
    try { if (DV.Debug && DV.Debug.visible) DV.Debug.hide(); } catch (e) { }
  }

  /** 原地回到"第一次打开"：清数据 + 复位设置 + 清空列表 + 重新放内置 README（不依赖 reload） */
  function resetToFirstRun() {
    try { DV.Settings.wipeStorage(); } catch (e) { /* 忽略 */ }
    DV.Settings.toDefaults();
    state.files.length = 0;
    state.activeId = null;
    state.selected = [];
    state.filter = '';
    state.query = '';
    state.matches = [];
    state.matchIndex = -1;
    state.raw = false;
    state.wrap = true;
    if (els.listFilter) els.listFilter.value = '';
    if (els.docSearch) els.docSearch.value = '';
    if (els.btnRaw) els.btnRaw.classList.remove('on');
    closePanes();
    applyWrap();
    refreshList();
    seedWelcome();
    // JS 生成的控件文案（主题名 / 字体名 / 分段按钮）也要按新语言重画
    if (DV.SettingsUI && DV.SettingsUI.rebuildForLang) DV.SettingsUI.rebuildForLang();
    else if (DV.SettingsUI && DV.SettingsUI.syncControls) DV.SettingsUI.syncControls();
    DV.Settings.save();
    DV.toast(DV.t('已恢复初始设置'), 'ok', 2000);
    DV.Log.info('已恢复初始设置（清空数据，回到第一次打开）');
  }

  function restoreSession() {
    if (!sessionOn()) { DV.Log.info('记住会话已关闭，跳过恢复'); return false; }
    let raw;
    try { raw = localStorage.getItem('docviewer.session'); } catch (e) { return false; }
    if (!raw) return false;
    let data;
    try { data = JSON.parse(raw); } catch (e) { return false; }
    if (!data || !Array.isArray(data.files) || !data.files.length) return false;

    // 旧版本会话里的拼接文档没有 parts（只有一段拼好的纯文本），
    // 恢复出来只会是一坨源码；不如跳过，提示用户重新拼接。
    const legacyMerged = data.files.filter(f => f && f.kind === 'merged' && !f.merged);

    // 单条记录 → 文档条目
    const toItem = (f, id) => {
      const item = {
        id: id,
        name: f.name,
        path: f.path || '',
        fullPath: f.fullPath || '',        // 恢复后仍要能写回源文件
        size: f.size || (f.text ? f.text.length : 0),
        bytes: f.size || (f.text ? f.text.length : 0),
        kind: f.kind || DV.kindOf(f.name),
        encoding: f.encoding || 'UTF-8（会话恢复）',
        text: f.text || '',
        file: null,
        restored: true,
        scrollTop: Number(f.scroll) || 0,        // 上次读到哪儿
      };
      item.lines = countLines(item.text);
      item.chars = item.text.length;
      renderFile(item);
      return item;
    };

    data.files.forEach(f => {
      if (f && f.merged) {
        // 拼接文档：先还原每个来源，再重建合并视图
        const parts = (f.parts || []).filter(Boolean).map(p => toItem(p, 'f' + (++uid)));
        if (parts.length < 2) {                      // 数据不完整就退回成独立文件
          parts.forEach(p => state.files.push(p));
          return;
        }
        const item = {
          id: 'm' + (++uid),
          name: f.name,
          path: f.path || parts.map(p => p.path || p.name).join('  +  '),
          kind: 'merged',
          merged: true,
          parts: parts,
          bytes: parts.reduce((a, p) => a + (p.bytes || 0), 0),
          size: 0,
          encoding: f.encoding || ('合并视图 · ' + Array.from(new Set(parts.map(p => p.encoding))).join(' / ')),
          lines: parts.reduce((a, p) => a + (p.lines || 0), 0),
          chars: parts.reduce((a, p) => a + (p.chars || 0), 0),
          warnings: [],
          restored: true,
          scrollTop: Number(f.scroll) || 0,
        };
        item.size = item.bytes;
        item.text = parts.map(p => '# ── ' + p.name + ' ──\n' + (p.text || '')).join('\n\n');
        renderMerged(item);                          // 生成分段 HTML，恢复后仍可拆分
        state.files.push(item);
        return;
      }
      if (f && f.kind === 'merged' && !f.merged) return;   // 旧格式拼接文档：跳过
      state.files.push(toItem(f, 'f' + (++uid)));
    });
    state.wrap = data.wrap !== false;
    state.raw = !!data.raw;
    refreshList();
    const tgt = state.files.find(f => f.name === data.active) || state.files[0];
    if (tgt) select(tgt.id);
    if (legacyMerged.length) {
      DV.Log.warn('旧会话里的 ' + legacyMerged.length + ' 个拼接文档缺少来源数据，已跳过（请重新拼接）');
      DV.toast('旧格式的拼接文档已跳过，请重新拼接（本次已修复该问题）', 'warn', 3400);
    }
    if (!state.files.length) {                 // 全被跳过了
      DV.Log.info('会话里没有可恢复的文档');
      return false;
    }
    DV.Log.ok('已从上次会话恢复 ' + state.files.length + ' 个文件');
    DV.toast(DV.t('已恢复上次的 {n} 个文件', { n: state.files.length }), '', 2200);
    return true;
  }

  /* ================= 原生外壳桥 =================
     WKWebView 里 evaluateJavaScript 调用 file input 不算用户手势，文件选择框会被
     拦截，所以原生菜单自己弹 NSOpenPanel，再把路径回传到这里。
     这些路径由外壳的 docviewer:// scheme 直接提供内容，因此可以 fetch。      */
  /**
   * docviewer://local/<路径> —— 逐段做百分号编码。
   * 直接拼中文路径时，WebKit 有时不替我们做规范化，fetch 会失败，
   * 表现就是「路径里带中文的文件打不开」。
   */
  DV.localUrl = function (p) {
    const abs = p.startsWith('/') ? p : '/' + p;
    return 'docviewer://local' + abs.split('/').map(function (seg) {
      try { return encodeURIComponent(decodeURIComponent(seg)); }
      catch (e) { return encodeURIComponent(seg); }
    }).join('/');
  };


window.__DV_NATIVE_FILES = function (paths) {
    if (!Array.isArray(paths) || !paths.length) return;
    const items = paths.map(p => {
      const name = DV.baseName(p);
      return {
        id: 'n' + (++uid), name, path: DV.dirName(p), fullPath: p, size: 0,
        kind: DV.kindOf(name), file: null,
        _fetchUrl: DV.localUrl(p),
      };
    });
    ingestNative(items);
  };

  /** 带超时的 fetch：原生投递过来的路径里可能混着 --w 1100 这类"标志位取值"，
      读不到时 fetch 会一直挂着，把后面真正要打开的文件全堵死。 */
  function fetchWithTimeout(url, ms) {
    if (typeof AbortController !== 'function') return fetch(url);
    const ac = new AbortController();
    const timer = setTimeout(function () { try { ac.abort(); } catch (e) { /* 忽略 */ } }, ms);
    return fetch(url, { signal: ac.signal }).then(
      function (r) { clearTimeout(timer); return r; },
      function (e) { clearTimeout(timer); throw e; });
  }

  async function ingestNative(items) {
    let ok = 0, fail = 0;
    for (const item of items) {
      try {
        const res = await fetchWithTimeout(item._fetchUrl, 4000);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const buf = await res.arrayBuffer();
        const dec = decodeBuffer(buf, /\.rtf$/i.test(item.name) ? 'gbk' : '');
        item.text = dec.text;
        item.encoding = dec.encoding;
        item.bytes = buf.byteLength;
        item.size = buf.byteLength;
        item.lines = countLines(dec.text);
        item.chars = dec.text.length;
        renderFile(item);
        state.files.push(item);
        ok++;
      } catch (e) {
        fail++;
        DV.Log.error('原生选择读取失败 ' + item.name + '：' + e.message);
        try { els.sbHint.textContent = 'FETCH FAIL: ' + e.message + ' | ' + item._fetchUrl; } catch (e2) { }
      }
    }
    if (ok) {
      refreshList();
      const last = state.files[state.files.length - 1];
      if (last) select(last.id);
      DV.Log.ok('原生选择导入 ' + ok + ' 个文件');
      DV.toast(DV.t('已导入 {n} 个文件', { n: ok }), '', 1800);
    }
    if (fail) DV.toast(DV.t('{n} 个文件读取失败，详见 F3 日志', { n: fail }), 'err');
  }

  /* ================= 拖拽导入 ================= */
  let dragDepth = 0;
  function wireDragDrop() {
    const dz = els.dropzone;
    window.addEventListener('dragenter', e => {
      e.preventDefault();
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      dragDepth++;
      dz.classList.add('show');
    });
    window.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', e => {
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) dz.classList.remove('show');
    });
    window.addEventListener('drop', async e => {
      e.preventDefault();
      dragDepth = 0;
      dz.classList.remove('show');
      const files = await collectDropped(e.dataTransfer);
      if (!files.length) { DV.toast('没有可读取的文件', 'warn'); return; }
      ingest(files);
    });
  }

  async function collectDropped(dt) {
    const out = [];
    const items = dt.items ? Array.from(dt.items) : [];
    const entries = items.map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) {
      Array.from(dt.files || []).forEach(f => out.push(makeFileRecord(f)));
      return out;
    }
    for (const entry of entries) await walkEntry(entry, out, '');
    return out;
  }

  function walkEntry(entry, out, prefix) {
    return new Promise(resolve => {
      if (entry.isFile) {
        entry.file(f => {
          out.push(makeFileRecord(f, prefix + f.name));
          resolve();
        }, () => resolve());
        return;
      }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        const all = [];
        const readBatch = () => reader.readEntries(async ents => {
          if (!ents.length) {
            for (const e of all) await walkEntry(e, out, prefix + entry.name + '/');
            resolve();
            return;
          }
          all.push(...ents);
          readBatch();
        }, () => resolve());
        readBatch();
        return;
      }
      resolve();
    });
  }

  /* ================= 导出 ================= */
  function exportHtml() {
    const item = active();
    if (!item) { DV.toast('没有打开的文件', 'warn'); return; }
    const k = kindBadge(item);
    const body = (state.raw || item.kind === 'txt' || item.kind === 'code')
      ? '<pre>' + DV.esc(item.text) + '</pre>'
      : item.html;
    const html = '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8">' +
      '<title>' + DV.esc(item.name) + '</title>' +
      '<style>body{max-width:860px;margin:40px auto;padding:0 20px;font-family:-apple-system,"PingFang SC",sans-serif;' +
      'line-height:1.75;color:#222}pre{background:#f6f8fa;padding:12px;border-radius:8px;overflow:auto}' +
      'code{background:#f6f8fa;padding:.1em .35em;border-radius:4px}' +
      'table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}' +
      'blockquote{border-left:3px solid #8cc63f;margin:1em 0;padding:.3em 1em;background:#fafafa}</style>' +
      '</head><body>\n<h1>' + DV.esc(item.name) + '</h1>\n' + body + '\n</body></html>';
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, item.name.replace(/\.[^.]+$/, '') + '.html');
    DV.Log.ok('已导出 ' + item.name + ' → HTML（' + DV.fmtBytes(blob.size) + '）');
    DV.toast('已导出为 HTML', '', 1800);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ================= 事件绑定 ================= */
  function wire() {
    els.fileList = $('#fileList');
    els.fileBody = $('#listBody');
    els.listHL = $('#listHL');
    els.doc = $('#doc');
    els.docTitle = $('#docTitle');
    els.docMeta = $('#docMeta');
    els.docScroll = $('#docScroll');
    els.fileInput = $('#fileInput');
    els.dirInput = $('#dirInput');
    els.dropzone = $('#dropzone');
    els.statCount = $('#statCount');
    els.statSize = $('#statSize');
    els.searchHits = $('#searchHits');
    els.docSearch = $('#docSearch');
    els.listFilter = $('#listFilter');
    els.btnRaw = $('#btnRaw');
    els.saveState = $('#saveState');
    els.selBar = $('#selBar'); els.selCount = $('#selCount'); els.selHint = $('#selHint');
    els.btnMerge = $('#btnMerge'); els.btnSelAll = $('#btnSelAll'); els.btnSelNone = $('#btnSelNone');
    els.mergeBar = $('#mergeBar'); els.mergeLabel = $('#mergeLabel'); els.mergePart = $('#mergePart');
    els.btnMergePrev = $('#btnMergePrev'); els.btnMergeNext = $('#btnMergeNext');
    els.btnMergeSep = $('#btnMergeSep'); els.btnMergeSplit = $('#btnMergeSplit');
    ['sbFile', 'sbType', 'sbEnc', 'sbSize'].forEach(k => els[k] = document.getElementById(k));
    els.welcomeHTML = els.doc.innerHTML;

    // 图标填充
    const icons = {
      tbLogo: 'book', welcomeMark: 'book', msList: 'search',
      msDoc: 'search', msDrop: 'upload', msDbg: 'bug', msSel: 'layers', msMerge: 'layers',
    };
    for (const id in icons) {
      const n = document.getElementById(id);
      if (n) n.innerHTML = DV.icon(icons[id]);
    }

    /* 打开文件：原生外壳里走系统面板（HTML file input 在 WKWebView 中会被拦），
       浏览器里则用普通 file input */
    const nativePick = (which) => {
      const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.dv;
      if (!bridge) return false;                       // 浏览器环境
      try {
        // 同步发送，保留用户手势
        bridge.postMessage({ action: which === 'dir' ? 'pickFolder' : 'pickFiles' });
        return true;
      } catch (e) {
        DV.Log.warn('原生面板调用失败：' + e.message);
        return false;
      }
    };
    $('#btnOpenFiles').addEventListener('click', () => {
      if (!nativePick('files')) els.fileInput.click();
    });
    $('#btnOpenDir').addEventListener('click', () => {
      if (!nativePick('dir')) els.dirInput.click();
    });
    els.fileInput.addEventListener('change', e => {
      const recs = Array.from(e.target.files).map(f => makeFileRecord(f));
      e.target.value = '';
      ingest(recs);
    });
    els.dirInput.addEventListener('change', e => {
      const recs = Array.from(e.target.files).map(f => makeFileRecord(f, f.webkitRelativePath || f.name));
      e.target.value = '';
      ingest(recs, { showProgress: true });
    });

    /* 清空 */
    $('#btnClear').addEventListener('click', () => {
      if (!state.files.length) return;
      if (!confirm('清空当前打开的全部文件？')) return;
      state.files = []; state.activeId = null;
      refreshList(); showWelcome(); saveSession();
      DV.Log.info('已清空文件列表');
    });

    /* 多选与拼接 */
    els.btnMerge.addEventListener('click', () => mergeSelected());
    els.btnSelAll.addEventListener('click', () => setSelection(filteredFiles().map(f => f.id)));
    els.btnSelNone.addEventListener('click', () => setSelection([]));
    els.btnMergeSep.addEventListener('click', toggleMergeSep);
    els.btnMergeSplit.addEventListener('click', () => {
      const it = active();
      if (it && it.merged) splitMerged(it);
    });
    els.btnMergePrev.addEventListener('click', () => gotoPart(-1));
    els.btnMergeNext.addEventListener('click', () => gotoPart(1));

    /* 列表筛选 */
    $('#listFilter').addEventListener('input', e => { state.filter = e.target.value.trim(); refreshList(); });

    /* 视图切换 */
    const btnRaw = $('#btnRaw');
    btnRaw.addEventListener('click', toggleRaw);

    /* 复制 */
    $('#btnCopy').addEventListener('click', () => {
      const it = active();
      if (!it) return;
      const copyText = it.merged
        ? it.parts.map((p, i) => '# ── ' + (i + 1) + '/' + it.parts.length + ' ' + p.name + ' ──\n' + (p.text || '')).join('\n\n')
        : (it.text || '');
      navigator.clipboard.writeText(copyText).then(
        () => { DV.toast(DV.t('已复制 {n} 个字符', { n: DV.fmtNum(copyText.length) }), '', 1800); DV.Log.ok(DV.t('复制全文：') + it.name); },
        () => DV.toast('复制失败（浏览器限制）', 'err'));
    });

    /* 导出 */
    $('#btnSave').addEventListener('click', manualSave);
    { const ex = $('#setExport'); if (ex) ex.addEventListener('click', exportHtml); }

    /* 解析类设置变化 → 重新解析当前文档（换行处理等） */
    DV.Settings.on((cfg, keys) => {
      if (keys && keys.indexOf('sidebar') >= 0) applySidebar(cfg.sidebar, false);
      if (keys && (keys.indexOf('showTitlebar') >= 0 || keys.indexOf('metaFields') >= 0 ||
                   keys.indexOf('lang') >= 0)) {
        const it2 = active();
        if (it2) paintDoc(it2);
      }
      if (keys && keys.indexOf('editMode') >= 0) { wantFocus = editable(); applyEditMode(); }
      if (keys && keys.indexOf('lang') >= 0) { /* 文案由 rebuildForLang 处理 */ }
      if (keys && keys.indexOf('lang') >= 0 && DV.SettingsUI.rebuildForLang) {
        DV.SettingsUI.rebuildForLang();     // 主题名/字体名/分段按钮等 JS 生成的文案要重画
      }
      if (keys && keys.indexOf('rememberSession') >= 0) {
        if (cfg.rememberSession) saveSession();
        else { try { localStorage.removeItem('docviewer.session'); } catch (e) { } }
      }
      if (keys && keys.indexOf('anim') >= 0) {
        const it2 = active();
        if (it2) { paintDoc(it2); }
      }
      if (!keys || keys.indexOf('rtfSoftWrap') < 0) return;
      const it = active();
      if (it && it.kind === 'rtf') {
        renderFile(it);
        paintDoc(it);
        DV.Log.info('按源换行：' + (cfg.rtfSoftWrap ? '开' : '关') + '，已重新解析 ' + it.name);
      }
    });

    /* 诊断报告 */
    const diagNow = () => {
      const it = active();
      if (!it) { DV.toast('没有打开的文件', 'warn'); return ''; }
      return DV.Debug.emitReport(it);
    };
    const btnDiag = $('#btnDiag');
    if (btnDiag) btnDiag.addEventListener('click', diagNow);
    /* 就地编辑：输入即标记未保存，停手后自动写回 */
    els.doc.addEventListener('input', () => { if (canEdit()) markDirty(); });
    /* 不再「失焦就写回」：点一下别处（工具栏、侧栏）就写文件太突然。
       现在只有两条写回路径：停手 1.5 分钟的自动保存，和工具栏「保存」。 */

    /* 文档内锚点：交给平滑滚动 */
    els.doc.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      e.preventDefault();
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      const target = id && els.doc.querySelector('#' + CSS.escape(id));
      if (target) scrollDocTo(target.offsetTop - els.doc.offsetTop - 12, 340);
    });

    /* 侧栏收起 / 展开 */
    const side = $('#btnSidebar');
    if (side) side.addEventListener('click', toggleSidebar);
    const handle = $('#sideHandle');
    if (handle) handle.addEventListener('click', () => applySidebar(true));

    /* 设置 / 沉浸 */
    $('#btnSettings').addEventListener('click', () => DV.SettingsUI.toggle());
    $('#btnImmersive').addEventListener('click', () => {
      const on = DV.Settings.toggleImmersive();
      DV.SettingsUI.applyImmersive(on);
      $('#btnImmersive').classList.toggle('on', on);
      DV.toast(on ? '已进入沉浸式阅读' : '已退出沉浸式阅读', '', 1600);
    });

    /* 调试：工具栏按钮 / 标题栏 F3 提示 / 快捷键 */
    const btnSettings = $('#btnSettings');
    if (btnSettings) btnSettings.innerHTML = DV.icon('settings');

    const btnDebug = $('#btnDebug');
    if (btnDebug) btnDebug.addEventListener('click', () => DV.Debug.toggle());
    const chip = $('#tbF3');
    if (chip) { chip.style.cursor = 'pointer'; chip.title = 'F3：打开 / 关闭调试面板'; chip.addEventListener('click', () => DV.Debug.toggle()); }

    /* 换行 / 持久化 */
    $('#optWrap').addEventListener('change', e => {
      state.wrap = e.target.checked;
      applyWrap();
      saveSession();
      DV.Log.info('自动换行：' + (state.wrap ? '开' : '关'));
    });
    // 记住会话已移入设置面板（设置项变化在那里处理）

    /* 搜索 */
    let searchTimer = 0;
    els.docSearch.addEventListener('input', e => {
      const v = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(v.trim()), 180);
    });
    /* 搜索框只负责输入；上一处/下一处用旁边的 ↑ ↓ 按钮 */
    $('#btnSearchNext').addEventListener('click', () => stepMatch(1));
    $('#btnSearchPrev').addEventListener('click', () => stepMatch(-1));

    /* 快捷键：只保留 F3。
       之前的无修饰键（N 上一个/下一个文件等）在 contenteditable 里也会触发，
       打字时随手一个 n 就跳到别的文件，所以全部去掉，改为只用界面按钮。 */
    window.addEventListener('keydown', e => {
      if (e.key === 'F3') { e.preventDefault(); DV.Debug.toggle(); }
    });

    /* 滚动态：调试面板里的滚动高度 */
    /* 顶部阅读进度条：随滚动增长，停止滚动后淡出 */
    let scrollIdle = 0;
    const readBar = $('#readBar');
    els.docScroll.addEventListener('scroll', () => {
      if (readBar) {
        const total = els.docScroll.scrollHeight - els.docScroll.clientHeight;
        const p = total > 0 ? Math.min(1, els.docScroll.scrollTop / total) : 0;
        readBar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      }
      document.body.classList.add('scrolling');
      clearTimeout(scrollIdle);
      scrollIdle = setTimeout(() => document.body.classList.remove('scrolling'), 700);
    }, { passive: true });

    els.docScroll.addEventListener('scroll', () => {
      const it = active();
      if (!it) return;
      const pct = els.docScroll.scrollTop / Math.max(1, els.docScroll.scrollHeight - els.docScroll.clientHeight) * 100;
      els.sbHint.textContent = DV.t('滚动') + ' ' + pct.toFixed(0) + '% · ' + DV.t('F3 调试');
      if (DV.Settings.get().rememberScroll !== false) {
        it.scrollTop = els.docScroll.scrollTop;
        clearTimeout(scrollSaveTimer);
        scrollSaveTimer = setTimeout(saveSession, 1200);   // 节流写会话，避免频繁序列化
      }
    }, { passive: true });

    wireDragDrop();
    wireWelcome();
  }

  function step(dir) {
    if (state.files.length < 2) return;
    const i = state.files.findIndex(f => f.id === state.activeId);
    const next = state.files[(i + dir + state.files.length) % state.files.length];
    select(next.id);
  }

  function toggleRaw() {
    const it = active();
    if (!it) { DV.toast('没有打开的文件', 'warn'); return; }
    state.raw = !state.raw;
    $('#btnRaw').classList.toggle('on', state.raw);
    $('#btnRaw').textContent = DV.t(state.raw ? '渲染' : '源码');
    paintDoc(it);
    if (state.query) runSearch(state.query);
    saveSession();
    DV.Log.info('切换视图：' + (state.raw ? '源码' : '渲染'));
  }

  function bumpFont(delta) {
    const cfg = DV.Settings.get();
    DV.Settings.set({ size: Math.max(11, Math.min(30, cfg.size + delta)) });
    DV.SettingsUI.syncControls();
  }

  /* ================= 平滑滚动（由帧调度器驱动） ================= */
  const easeOutCubic = p => 1 - Math.pow(1 - p, 3);

  function smoothScrollTo(el, target, dur) {
    if (!el) return;
    if (DV.Settings.get().anim === 'off') { el.scrollTop = target; return; }
    dur = dur || 360;
    const start = el.scrollTop;
    const dist = target - start;
    if (Math.abs(dist) < 2) { el.scrollTop = target; return; }
    const t0 = performance.now();
    let stop = null;
    stop = DV.frames.on(() => {
      const p = Math.min(1, (performance.now() - t0) / dur);
      el.scrollTop = start + dist * easeOutCubic(p);
      if (p >= 1) { if (stop) stop(); }
    });
  }

  function scrollDocTo(target, dur) { smoothScrollTo(els.docScroll, target, dur); }

  /** 滚动浮现：进入视口的内容块依次淡入上浮 */
  let revealIO = null;
  function setupReveal() {
    if (revealIO) { revealIO.disconnect(); revealIO = null; }
    const anim = DV.Settings.get().anim;
    if (anim === 'off' || typeof IntersectionObserver === 'undefined') return;
    const blocks = Array.prototype.slice.call(els.doc.children, 0, 400);
    if (!blocks.length) return;
    revealIO = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) { en.target.classList.add('in'); revealIO.unobserve(en.target); }
      });
    }, { root: els.docScroll, rootMargin: '0px 0px -6% 0px', threshold: 0.01 });
    blocks.forEach(n => { n.classList.add('reveal'); revealIO.observe(n); });
  }

  /**
   * 侧栏选中项的滑动高亮。
   * 关键：高亮元素必须**常驻**（不随列表重建），否则每次刷新都是新节点，
   * CSS transition 无从触发，看起来就是"跳"而不是"滑"。
   */
  function updateListHighlight(scrollTo) {
    const hl = els.listHL;
    const body = els.fileBody;
    if (!hl || !body) return;
    const anim = DV.Settings.get().anim;
    const cur = body.querySelector('.fitem.active');
    if (!cur) { hl.hidden = true; return; }
    if (anim === 'off') { hl.hidden = true; return; }

    const boxRect = els.fileList.getBoundingClientRect();
    const curRect = cur.getBoundingClientRect();
    if (!curRect.height) { hl.hidden = true; return; }

    const first = hl.hidden;
    hl.hidden = false;
    hl.style.height = curRect.height + 'px';
    const y = curRect.top - boxRect.top + els.fileList.scrollTop;
    if (first) {
      // 首次出现：直接就位，不做滑动，避免从顶部飞过来
      hl.style.transition = 'none';
      hl.style.transform = 'translateY(' + y + 'px)';
      void hl.offsetHeight;
      hl.style.transition = '';
    } else {
      hl.style.transform = 'translateY(' + y + 'px)';
    }

    if (scrollTo) scrollItemIntoView(cur);
  }

  /** 让选中的文件行平滑滑入可视区 */
  function scrollItemIntoView(el) {
    const sc = els.fileList;
    if (!sc || !el) return;
    const top = el.offsetTop;
    const h = el.offsetHeight;
    const viewTop = sc.scrollTop;
    const viewH = sc.clientHeight;
    if (top >= viewTop + 8 && top + h <= viewTop + viewH - 8) return;   // 已在视区内
    const target = Math.max(0, top - viewH / 2 + h / 2);
    smoothScrollTo(sc, target, 320);
  }

  /** 侧栏显示/隐藏：独立开关，立即生效并持久化 */
  function applySidebar(on, persist) {
    const show = on !== false;
    const appEl = document.querySelector('.app');
    if (DV.animOff()) appEl.style.transition = 'none';
    else appEl.style.transition = '';
    appEl.classList.toggle('no-side', !show);
    const handle = document.getElementById('sideHandle');
    if (handle) handle.hidden = show;
    const btn = document.getElementById('btnSidebar');
    if (btn) {
      btn.innerHTML = DV.icon('chevron-left');
      btn.title = '收起侧栏 (Ctrl+B)';
    }
    if (persist !== false) DV.Settings.set({ sidebar: show });
  }

  function toggleSidebar() {
    const on = !document.querySelector('.app').classList.contains('no-side');
    applySidebar(!on);
    DV.Log.info('侧栏：' + (!on ? '已收起' : '已展开'));
  }

  function applyWrap() {
    els.doc.classList.toggle('nowrap', !state.wrap);
    const it = active();
    if (it) paintDoc(it);
  }

  /* ================= 启动 ================= */
  function boot() {
    // 渲染 / 动画统一调度器
    const step = (name, fn) => {
      try { fn(); } catch (e) {
        DV.Log.error('启动步骤「' + name + '」失败：' + (e && e.message));
      }
    };
    step('帧调度器', () => DV.frames.start());
    // 设置：读取 → 应用 → 构建面板
    step('读取设置', () => DV.Settings.load());
    step('应用设置', () => DV.Settings.apply());
    step('事件绑定', () => wire());
    step('设置面板', () => DV.SettingsUI.init());
    step('调试面板', () => DV.Debug.init());
    applySidebar(DV.Settings.get().sidebar !== false, false);
    document.getElementById('btnImmersive').classList.toggle('on', !!DV.Settings.get().immersive);
    DV.SettingsUI.applyImmersive(DV.Settings.get().immersive);

    // 初始统计
    els.statCount.textContent = '0';
    els.statSize.textContent = '0 B';
    $('#tbF3').textContent = DV.t('F3 调试');

    // 环境
    DV.Debug.setEnv({
      'GBK 解码 (TextDecoder)': String(gbkSupported()),
      '启动耗时': DV.fmtMs(T0),
      '版本': APP_VERSION,
      '主题 / 字体': DV.Settings.get().theme + ' / ' + DV.Settings.get().font,
      '帧率上限': (DV.Settings.get().frameRate || '不限') + ' fps',
    });

    DV.Log.info('DocViewer 启动完成，用时 ' + DV.fmtMs(performance.now() - T0) +
      '（主题 ' + DV.Settings.get().theme + '，字体 ' + DV.Settings.get().font +
      '，帧率上限 ' + (DV.Settings.get().frameRate || '不限') + '）');

    // ?lang=en 指定界面语言
    const langParam = /[?&]lang=(zh|en)/.exec(location.search || '');
    if (langParam) {
      DV.Settings.set({ lang: langParam[1] });
      DV.SettingsUI.syncControls();
    }

    // ?edit=rw 直接以可编辑模式打开
    const editParam = /[?&]edit=(ro|rw)/.exec(location.search || '');
    if (editParam) DV.Settings.set({ editMode: editParam[1] });

    // ?theme=blue 指定主题（可直接用链接打开某个配色）
    const thParam = /[?&]theme=([a-z]+)/.exec(location.search || '');
    if (thParam && DV.Settings.THEMES.some(t => t.id === thParam[1])) {
      DV.Settings.set({ theme: thParam[1], colors: {} });
      DV.SettingsUI.syncControls();
    }

    // ?fps=120：临时覆盖帧率上限（用于对比测量 CPU 占用）
    const fpsParam = /[?&]fps=(\d+)/.exec(location.search || '');
    if (fpsParam) {
      DV.Settings.set({ frameRate: parseInt(fpsParam[1], 10) });
      DV.Log.info('URL 参数覆盖帧率上限：' + fpsParam[1] + ' fps');
    }

    const restored = restoreSession();
    if (!restored) seedWelcome();          // 第一次打开：放入内置的 README(EN) 与 README(ZH)
    applyEditMode();
    $('#optWrap').checked = state.wrap;
    if (state.raw) { $('#btnRaw').classList.add('on'); $('#btnRaw').textContent = DV.t('渲染'); }
    applyWrap();

    window.__DV_GBK_OK = gbkSupported();
    window.__DV_READY_MS = performance.now() - T0;
    DV.Debug.setEnv({ 'GBK 解码': String(!!window.__DV_GBK_OK), '就绪耗时': DV.fmtMs(window.__DV_READY_MS) });

    if (!restored) {
      DV.Log.info('未发现历史会话；请打开或拖入文档 / 代码 / 文本文件');
    }

    // #debug：外壳或命令行带上时自动展开调试面板，便于自动化核对
    if (location.hash === '#debug') {
      DV.Debug.show();
      DV.Log.info('通过 #debug 自动打开调试面板');
    }
    // #settings：直接打开设置面板
    if (location.hash === '#settings') {
      DV.SettingsUI.show();
      DV.Log.info('通过 #settings 自动打开设置面板');
    }

    // #diag：自动输出一次诊断报告（便于远程排查）
    if (location.search.indexOf('diag=1') >= 0 || location.hash === '#diag') {
      const it = active();
      DV.Debug.show();
      if (it) setTimeout(() => DV.Debug.emitReport(it), 300);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 暴露给调试
  window.DV.App = { state, select, step, ingest, refreshList, saveSession, closeFile, mergeSelected, splitMerged, setSelection, paintDoc, els,
    autosaveMs: AUTOSAVE_MS, manualSave,
    diag: () => { const it = active(); return it ? DV.Debug.emitReport(it) : ''; },
    seedWelcome, resetToFirstRun, applyEditMode, saveEdit, canEdit, isPlainView, domToText,
    renderFile, restoreSession, saveSession, renderMerged,
    version: APP_VERSION, decodeBuffer, makeHexDecoder, detectRtfCodepage };
})();
