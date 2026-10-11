/* =====================================================================
   ui-settings.js — 设置面板 + 沉浸式阅读
   面板控件全部根据 DV.Settings 里的元数据生成，改一处即可扩展。
   ===================================================================== */
window.DV = window.DV || {};

DV.SettingsUI = (function () {

  const $ = DV.$;
  let els = {};
  let idleTimer = 0;

  /* ---------------- 控件生成 ---------------- */
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function buildThemes() {
    const box = els.themeGrid;
    box.innerHTML = '';
    DV.Settings.THEMES.forEach(t => {
      const card = el('div', 'theme-card' + (DV.Settings.get().theme === t.id ? ' active' : ''));
      card.dataset.theme = t.id;
      const PREVIEW = {
        dark: ['#17191c', '#24282d'],
        blue: ['#101722', '#1b2637'],
        green: ['#121a14', '#1d2a20'],
        light: ['#f2f3f5', '#ffffff'],
        sepia: ['#ece3d2', '#f6efe0'],
      };
      const ct = DV.Settings.get().customTheme || {};
      const base = t.id === 'custom'
        ? [ct.bg || '#15181c', ct.bg2 || '#1d2126']
        : (PREVIEW[t.id] || PREVIEW.dark);
      const dots = [base[0], base[1], t.id === 'custom' ? (ct.accent || t.accent) : t.accent];
      card.innerHTML =
        '<div class="tc-dots">' + dots.map(c => '<i style="background:' + c + '"></i>').join('') + '</div>' +
        '<b>' + DV.t(t.label) + '</b><small>' + DV.t(t.desc) + '</small>';
      card.addEventListener('click', () => {
        // 换主题 = 所有颜色都换：清空细调色（自定义主题保留自己的取色器值）
        DV.Settings.set({ theme: t.id, colors: {} });
        box.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === t.id));
        syncControls();
        DV.Log.info('切换主题：' + t.label + (t.id === 'custom' ? '（自定义）' : ''));
      });
      box.appendChild(card);
    });
  }

  function buildFonts() {
    const box = els.fontGrid;
    box.innerHTML = '';
    const cur = DV.Settings.get();
    DV.Settings.FONTS.forEach(f => {
      const card = el('div', 'font-card' + (cur.font === f.id ? ' active' : ''));
      card.dataset.font = f.id;
      const stack = f.id === 'custom' ? (cur.fontCustom || '"Songti SC", serif') : (f.stack || 'inherit');
      const useLatin = f.latin || DV.i18n.lang() === 'en';
      const sample = useLatin
        ? 'The quick brown fox jumps over the lazy dog'
        : '天地玄黄 宇宙洪荒 0123456789';
      card.innerHTML = '<b>' + DV.t(f.label) + '</b><small>' + DV.t(f.note) + '</small>' +
        '<div class="fc-sample" style="font-family:' + stack.replace(/"/g, '&quot;') + '">' + sample + '</div>';
      card.addEventListener('click', () => {
        DV.Settings.set({ font: f.id });
        syncControls();
        DV.Log.info('切换字体：' + f.label);
      });
      box.appendChild(card);
    });
  }

  function buildSwatches(target) {
    const box = els['swatch' + target[0].toUpperCase() + target.slice(1)];
    if (!box) return;
    const cur = DV.Settings.get();
    const fallback = getComputedStyle(document.body).getPropertyValue(
      target === 'text' ? '--text' : target === 'accent' ? '--accent' : '--bg').trim();
    const active = cur.colors[target] || '';
    box.innerHTML = '';
    DV.Settings.COLOR_PRESETS[target].forEach(c => {
      const sw = el('div', 'swatch' + (active.toLowerCase() === c.toLowerCase() ? ' active' : ''));
      sw.style.background = c;
      sw.title = c;
      sw.addEventListener('click', () => {
        const colors = Object.assign({}, DV.Settings.get().colors);
        colors[target] = c;
        DV.Settings.set({ colors });
        syncControls();
      });
      box.appendChild(sw);
    });
    // 恢复默认
    const def = el('div', 'swatch');
    def.style.background = fallback || '#888';
    def.style.borderStyle = 'dashed';
    def.title = DV.t('恢复该项目的主题默认色');
    def.innerHTML = '<span>' + DV.t('默认') + '</span>';
    def.addEventListener('click', () => {
      const colors = Object.assign({}, DV.Settings.get().colors);
      delete colors[target];
      DV.Settings.set({ colors });
      syncControls();
    });
    box.appendChild(def);
  }

  function buildMetaGrid() {
    const box = els.metaGrid;
    if (!box) return;
    box.innerHTML = '';
    DV.Settings.META_FIELDS.forEach(f => {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.field = f.id;
      cb.addEventListener('change', () => {
        const mf = Object.assign({}, DV.Settings.get().metaFields);
        mf[f.id] = cb.checked;
        DV.Settings.set({ metaFields: mf });
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(f.label));
      box.appendChild(lab);
    });
  }

  function buildSeg(host, items, current, onPick, key) {
    if (!host) return;
    if (key) host.dataset.key = key;
    host.innerHTML = '';
    items.forEach(it => {
      const v = it.v !== undefined ? it.v : it.id;
      const b = el('button', v === current ? 'active' : '', DV.t(it.label));
      b.dataset.v = String(v);
      b.addEventListener('click', () => {
        onPick(v);
        // 立即更新选中标识（不能只等 syncControls，否则绿色块不会跟着动）
        DV.$$('button', host).forEach(x => x.classList.toggle('active', x === b));
        syncControls();
      });
      host.appendChild(b);
    });
  }

  function buildSegs() {
    const s = DV.Settings.get();
    buildSeg(els.segLang, DV.Settings.LANGS, s.lang || 'zh', v => {
      DV.Settings.set({ lang: v });
      DV.toast(v === 'en' ? 'Language: English' : '语言：中文', '', 1600);
    }, 'lang');
    buildSeg(els.segEdit, DV.Settings.EDIT_MODES, s.editMode || 'ro', v => {
      DV.Settings.set({ editMode: v });
      DV.toast(v === 'rw' ? DV.t('可编辑：可把内容追加回源文件') : DV.t('只读：不会改动任何文件'), '', 2200);
    }, 'editMode');
    buildSeg(els.segAnim, DV.Settings.ANIMS, s.anim, v => DV.Settings.set({ anim: v }), 'anim');
    buildSeg(els.segAnimSpeed, DV.Settings.ANIM_SPEEDS, s.animSpeed || 1,
      v => DV.Settings.set({ animSpeed: v }), 'animSpeed');
    buildSeg(els.segFps, DV.Settings.FRAME_RATES, s.frameRate, v => {
      DV.Settings.set({ frameRate: v });
      if (DV.frames) DV.frames.setFps(v);
    }, 'frameRate');
  }

  function buildAll() {
    buildThemes();
    buildFonts();
    buildSwatches('accent');
    buildSwatches('text');
    buildSwatches('bg');
    buildSegs();
  }

  /** 语言切换后重建所有由 JS 生成的控件文案 */
  function rebuildForLang() {
    buildAll();
    buildMetaGrid();
    syncControls();
  }

  /* ---------------- 同步控件显示 ---------------- */
  function syncControls() {
    const s = DV.Settings.get();
    // 主题
    DV.$$('.theme-card', els.themeGrid).forEach(c => c.classList.toggle('active', c.dataset.theme === s.theme));
    const t = DV.Settings.THEMES.find(x => x.id === s.theme);
    els.setThemeBadge.textContent = t ? DV.t(t.label) : s.theme;
    // 字体
    DV.$$('.font-card', els.fontGrid).forEach(c => c.classList.toggle('active', c.dataset.font === s.font));
    els.fontCustomRow.hidden = s.font !== 'custom';
    if (s.font === 'custom') els.fontCustomInput.value = s.fontCustom || '';
    const stack = DV.Settings.fontStack();
    els.fontPreview.style.fontFamily = stack || '';
    // 滑杆
    els.setSize.value = s.size; els.setSizeVal.textContent = (+s.size).toFixed(s.size % 1 ? 1 : 0);
    els.setLine.value = s.lineHeight; els.setLineVal.textContent = (+s.lineHeight).toFixed(2);
    els.setWidth.value = s.width; els.setWidthVal.textContent = s.width;
    els.setPad.value = s.pad; els.setPadVal.textContent = s.pad;
    els.setImmWidth.value = s.immersiveWidth; els.setImmWidthVal.textContent = s.immersiveWidth;
    // 开关
    els.setImmersive.checked = !!s.immersive;
    els.setSoftWrap.checked = s.rtfSoftWrap !== false;
    els.setRtfFont.checked = s.rtfReaderFont !== false;
    els.setPersist.checked = s.rememberSession !== false;
    els.setScroll.checked = s.rememberScroll !== false;
    els.setShowTitlebar.checked = s.showTitlebar !== false;
    // 所有分段控件（语言 / 动画 / 速度 / 帧率）统一刷新选中标识
    DV.$$('.seg[data-key]').forEach(host => {
      const key = host.dataset.key;
      const cur = String(s[key] == null ? '' : s[key]);
      DV.$$('button', host).forEach(b => b.classList.toggle('active', b.dataset.v === cur));
    });
    const ct = s.customTheme || {};
    els.ctBg.value = ct.bg || '#15181c';
    els.ctBg2.value = ct.bg2 || '#1d2126';
    els.ctText.value = ct.text || '#f2f5f8';
    els.ctAccent.value = ct.accent || '#8cc63f';
    els.customRow.hidden = s.theme !== 'custom';
    const mf = s.metaFields || {};
    DV.$$('input[data-field]', els.metaGrid).forEach(cb => { cb.checked = !!mf[cb.dataset.field]; });
    // 分段
    buildSeg(els.segAnim, DV.Settings.ANIMS, s.anim, v => DV.Settings.set({ anim: v }));
    if (els.segAnimSpeed) {
      buildSeg(els.segAnimSpeed, DV.Settings.ANIM_SPEEDS, s.animSpeed || 1,
        v => DV.Settings.set({ animSpeed: v }));
    }
    buildSeg(els.segFps, DV.Settings.FRAME_RATES.map(f => ({ v: f.v, label: f.label })), s.frameRate,
      v => DV.Settings.set({ frameRate: v }));
    // 色块
    ['accent', 'text', 'bg'].forEach(t2 => {
      const box = els['swatch' + t2[0].toUpperCase() + t2.slice(1)];
      if (box) DV.$$('.swatch', box).forEach(sw => {
        sw.classList.toggle('active', sw.title && sw.title.toLowerCase() === (s.colors[t2] || '').toLowerCase());
      });
    });
    updateFpsNote();
  }

  function updateFpsNote() {
    if (!els.fpsNote || !DV.frames) return;
    const i = DV.frames.info();
    const cap = i.cap ? i.cap + ' fps' : DV.t('不限');
    els.fpsNote.textContent = DV.t('帧率上限 {cap} · 渲染实测 {render} fps · 动画实测 {anim} fps · 平均 {ms} ms/帧{drop}', {
      cap: cap,
      render: i.renderFps.toFixed(0),
      anim: i.animFps.toFixed(0),
      ms: i.frameMs.toFixed(1),
      drop: i.dropped ? DV.t(' · 超时帧 {n}', { n: i.dropped }) : '',
    });
  }

  /* ---------------- 沉浸式阅读 ---------------- */
  function applyImmersive(on) {
    const v = !!on;
    document.body.classList.toggle('immersive', v);
    els.immbar.hidden = !v;
    if (v) {
      wake();
      DV.Log.info('进入沉浸式阅读');
    } else {
      document.body.classList.remove('imm-idle');
      DV.Log.info('退出沉浸式阅读');
    }
  }

  function wake() {
    if (!document.body.classList.contains('immersive')) return;
    document.body.classList.remove('imm-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (DV.Debug.visible || (DV.SettingsUI && DV.SettingsUI.isOpen && DV.SettingsUI.isOpen())) return;
      document.body.classList.add('imm-idle');
    }, 2200);
  }

  let lastScrollTop = -1, lastProgAt = 0;
  function updateProgress() {
    if (!els.immProgress || !document.body.classList.contains('immersive')) return;
    const sc = DV.App && DV.App.els ? DV.App.els.docScroll : null;
    if (!sc) return;
    const t = performance.now();
    // 位置没变就不动；最多 30Hz，避免 240fps 下反复触发滚动布局读取
    if (sc.scrollTop === lastScrollTop && t - lastProgAt < 200) return;
    if (t - lastProgAt < 33) return;
    lastScrollTop = sc.scrollTop; lastProgAt = t;
    const total = sc.scrollHeight - sc.clientHeight;
    const p = total > 0 ? Math.min(1, sc.scrollTop / total) : 0;
    els.immProgress.style.transform = 'scaleX(' + p.toFixed(4) + ')';
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    els = {
      pane: $('#settingspane'),
      themeGrid: $('#themeGrid'), fontGrid: $('#fontGrid'),
      fontCustomRow: $('#fontCustomRow'), fontCustomInput: $('#fontCustomInput'),
      fontPreview: $('#fontPreview'),
      setThemeBadge: $('#setThemeBadge'),
      setSize: $('#setSize'), setSizeVal: $('#setSizeVal'),
      setLine: $('#setLine'), setLineVal: $('#setLineVal'),
      setWidth: $('#setWidth'), setWidthVal: $('#setWidthVal'),
      setPad: $('#setPad'), setPadVal: $('#setPadVal'),
      setImmWidth: $('#setImmWidth'), setImmWidthVal: $('#setImmWidthVal'),
      setImmersive: $('#setImmersive'),
      setSoftWrap: $('#setSoftWrap'), setRtfFont: $('#setRtfFont'),
      segLang: $('#segLang'), segEdit: $('#segEdit'), setWipe: $('#setWipe'), setPersist: $('#setPersist'), setShowTitlebar: $('#setShowTitlebar'), metaGrid: $('#metaGrid'), setScroll: $('#setScroll'),
      customRow: $('#customRow'), ctBg: $('#ctBg'), ctBg2: $('#ctBg2'),
      ctText: $('#ctText'), ctAccent: $('#ctAccent'),
      segAnim: $('#segAnim'), segAnimSpeed: $('#segAnimSpeed'), segFps: $('#segFps'), fpsNote: $('#fpsNote'),
      swatchAccent: $('#swatchAccent'), swatchText: $('#swatchText'), swatchBg: $('#swatchBg'),
      immbar: $('#immbar'), immProgress: $('#immProgress'), immTitle: $('#immTitle'),
    };

    buildAll();
    buildMetaGrid();
    syncControls();

    // 关闭 / 重置
    $('#setClose').addEventListener('click', () => api.hide());
    $('#setReset').addEventListener('click', () => {
      DV.Settings.reset();
      buildAll();
      buildMetaGrid();
      syncControls();
      applyImmersive(false);
      DV.toast(DV.t('已恢复默认设置'), '', 1600);
    });

    // 滑杆
    const bind = (input, valEl, key, fmt) => {
      input.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        valEl.textContent = fmt ? fmt(v) : v;
        DV.Settings.set({ [key]: v });
      });
    };
    bind(els.setSize, els.setSizeVal, 'size', v => v.toFixed(v % 1 ? 1 : 0));
    bind(els.setLine, els.setLineVal, 'lineHeight', v => v.toFixed(2));
    bind(els.setWidth, els.setWidthVal, 'width');
    bind(els.setPad, els.setPadVal, 'pad');
    bind(els.setImmWidth, els.setImmWidthVal, 'immersiveWidth');

    // 自定义字体名
    els.fontCustomInput.addEventListener('input', e => {
      DV.Settings.set({ fontCustom: e.target.value, font: 'custom' });
      els.fontPreview.style.fontFamily = DV.Settings.fontStack() || '';
    });

    // 恢复初始设置（清空全部数据）
    if (els.setWipe) {
      els.setWipe.addEventListener('click', () => {
        if (!window.confirm(DV.t('清空全部设置与会话，回到第一次打开的状态') + '？')) return;
        if (DV.App && DV.App.resetToFirstRun) DV.App.resetToFirstRun();
        else DV.Settings.wipe();
      });
    }

    // 自定义主题取色
    [['ctBg', 'bg'], ['ctBg2', 'bg2'], ['ctText', 'text'], ['ctAccent', 'accent']].forEach(([id, key]) => {
      els[id].addEventListener('input', e => {
        const patch = {};
        patch[key] = e.target.value;
        DV.Settings.set({ theme: 'custom', customTheme: patch });
      });
    });

    // 顶部标题栏显隐
    els.setShowTitlebar.addEventListener('change', e => {
      DV.Settings.set({ showTitlebar: e.target.checked });
      DV.toast(DV.t(e.target.checked ? '已显示顶部标题栏' : '已隐藏顶部标题栏'), '', 1500);
    });

    // 记住会话
    els.setPersist.addEventListener('change', e => {
      DV.Settings.set({ rememberSession: e.target.checked });
      DV.toast(DV.t('记住会话：{state}', { state: DV.t(e.target.checked ? '开' : '关') }), '', 1500);
    });

    // 记住阅读位置
    els.setScroll.addEventListener('change', e => {
      DV.Settings.set({ rememberScroll: e.target.checked });
      DV.toast(DV.t('记住阅读位置：{state}', { state: DV.t(e.target.checked ? '开' : '关') }), '', 1500);
    });

    // RTF 使用阅读器字体
    els.setRtfFont.addEventListener('change', e => {
      DV.Settings.set({ rtfReaderFont: e.target.checked });
      DV.toast(DV.t('RTF 字体：{state}', { state: DV.t(e.target.checked ? '跟随阅读器' : '使用文件自带') }), '', 1600);
    });

    // 工具：调试面板 / 诊断报告
    const dbgBtn = $('#setOpenDebug');
    if (dbgBtn) dbgBtn.addEventListener('click', () => DV.Debug.toggle());
    const diagBtn = $('#setDiag');
    if (diagBtn) diagBtn.addEventListener('click', () => {
      if (DV.App && DV.App.diag) DV.App.diag();
    });

    // 按源换行
    els.setSoftWrap.addEventListener('change', e => {
      DV.Settings.set({ rtfSoftWrap: e.target.checked });
      DV.toast(DV.t('RTF 按源换行：{state}', { state: DV.t(e.target.checked ? '开' : '关') }), '', 1500);
    });

    // 沉浸开关
    els.setImmersive.addEventListener('change', e => {
      DV.Settings.set({ immersive: e.target.checked });
      applyImmersive(e.target.checked);
    });

    // 沉浸控制条
    $('#immExit').addEventListener('click', () => { DV.Settings.set({ immersive: false }); applyImmersive(false); });
    $('#immFont+').addEventListener('click', () => {
      DV.Settings.set({ size: Math.min(30, DV.Settings.get().size + 1) });
      syncControls();
    });
    $('#immFont-').addEventListener('click', () => {
      DV.Settings.set({ size: Math.max(11, DV.Settings.get().size - 1) });
      syncControls();
    });
    $('#immPrev').addEventListener('click', () => { if (DV.App) DV.App.step(-1); });
    $('#immNext').addEventListener('click', () => { if (DV.App) DV.App.step(1); });

    // 鼠标移动唤醒控制条
    window.addEventListener('mousemove', wake, { passive: true });
    window.addEventListener('keydown', wake);

    // 每帧刷新进度与遥测（挂在统一调度器上）
    let noteAt = 0;
    DV.frames.on(() => {
      updateProgress();                       // 内部已节流到 30Hz 且位置没变就跳过
      if (!(els.pane && !els.pane.hidden) || !open) return;
      const t = performance.now();
      if (t - noteAt < 250) return;           // 面板读数 4Hz 足够，避免每帧写 DOM
      noteAt = t;
      updateFpsNote();
    });
  }

  const api = {
    init, syncControls, applyImmersive, wake, updateProgress, rebuildForLang,
    isOpen: () => !!(els.pane && !els.pane.hidden),
    __paneHidden: () => (els.pane ? els.pane.hidden : 'no-pane'),
    show() {
      els.pane.hidden = false;
      DV.$('#btnSettings').classList.add('on');
      syncControls();
      DV.Log.info('打开设置面板');
    },
    hide() {
      els.pane.hidden = true;
      DV.$('#btnSettings').classList.remove('on');
    },
    toggle() { api.isOpen() ? api.hide() : api.show(); },
  };

  return api;
})();
