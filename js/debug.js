/* =====================================================================
   debug.js — F3 调试面板
   性能（帧率曲线 / 调度探针）、文档信息、运行环境、运行日志
   帧的计数与节流交给 frames.js（全局帧率上限），这里只消费统计。
   ===================================================================== */
window.DV = window.DV || {};

DV.debugEnabled = false;

DV.Debug = (function () {

  const HIST = 240;                 // 采样点数（高帧率下也覆盖足够长时间窗）
  const hist = new Float32Array(HIST);
  const FPS_MAX = 260;              // 图表纵轴默认上限（只是刻度，不限制帧率）
  const DOM_HZ = 10;                // KV / DOM 面板最高刷新频率
  const CHART_HZ = 20;              // 曲线最高重绘频率
  const PROBE_BURST = 64;           // 探针每批次数（每批后交还控制权）
  const PROBE_TPS_BUDGET = 40000;   // 受控模式目标吞吐：约 40k 次/秒，占用很低

  let histLen = 0, histPos = 0;
  let renderFps = 0, animFps = 0, frameMs = 0;
  let lastPaint = 0, lastChart = 0;
  let visible = false, running = false;
  let _refresh = 0;                 // 采样到的显示器刷新率

  // 高帧率探针：只测「主线程不渲染时每秒能处理多少任务」，不产生画面
  let probeOn = true, probeMax = false;
  let probe = 0, probeTps = 0, probeLastT = 0;

  let docKv = {}, envExtra = {}, renderStats = {};
  const N = {};
  const now = () => (performance.now ? performance.now() : Date.now());

  /* ---------------- KV 渲染 ---------------- */
  const TV = (t) => (DV.i18n && DV.i18n.translateValue ? DV.i18n.translateValue(t) : t);

  function kvHtml(obj) {
    let h = '';
    for (const k in obj) {
      const v = obj[k];
      if (v && typeof v === 'object' && v.__group) {
        h += '<div class="group-title">' + DV.esc(TV(v.__group)) + '</div>'; continue;
      }
      if (v && typeof v === 'object' && v.__hint) {
        h += '<div class="row"><span class="v dim">' + DV.esc(TV(v.__hint)) + '</span></div>'; continue;
      }
      const cls = (v && typeof v === 'object' && v.cls) ? v.cls : '';
      const val = (v && typeof v === 'object') ? (v.value == null ? '—' : v.value) : (v == null ? '—' : v);
      h += '<div class="row"><span class="k">' + DV.esc(TV(k)) + '</span>' +
        '<span class="v ' + cls + '">' + DV.esc(String(val)) + '</span></div>';
    }
    return h || '<div class="row"><span class="v dim">暂无数据</span></div>';
  }

  function cacheNodes() {
    N.docKv = DV.$('#docKv'); N.perfKv = DV.$('#perfKv'); N.envKv = DV.$('#envKv');
    N.fpsNow = DV.$('#fpsNow'); N.frameMs = DV.$('#frameMs'); N.tbFps = DV.$('#tbFps');
    N.metric = DV.$('#dbgMetric');
    N.log = DV.$('#dbgLog'); N.autoScroll = DV.$('#logAutoScroll');
  }

  function paint() {
    if (!N.docKv) cacheNodes();
    if (!N.docKv) return;
    N.docKv.innerHTML = kvHtml(docKv);
    N.perfKv.innerHTML = kvHtml(perfObj());
    N.envKv.innerHTML = kvHtml(envObj());
    drawGraph();                       // 曲线是画在 canvas 上的，不随 innerHTML 更新
    drawGraph();
    if (N.fpsNow) N.fpsNow.textContent = animFps.toFixed(1);
    if (N.frameMs) N.frameMs.textContent = frameMs.toFixed(2);
  }

  /* ---------------- 性能数据 ---------------- */
  function perfObj() {
    const info = DV.frames ? DV.frames.info() : { renderFps, animFps, frameMs, cap: 0, dropped: 0 };
    const cap = info.cap;
    const o = {};
    o['__fx'] = { __group: '界面动效' };
    const hl = document.getElementById('listHL');
    o['滑动高亮过渡'] = hl ? getComputedStyle(hl).transitionDuration : '—';
    o['滑动高亮位移'] = hl && hl.style.transform ? hl.style.transform : '—';
    o['高亮可见'] = hl ? (hl.hidden ? '否' : '是') : '—';
    o['动效强度 / 速度'] = (DV.Settings ? DV.Settings.get().anim + ' / x' + (DV.Settings.get().animSpeed || 1) : '—');
    const csBody = getComputedStyle(document.body);
    if (DV.Settings) {
      const it = (DV.App && DV.App.state) ? DV.App.state.files.find(f => f.id === DV.App.state.activeId) : null;
      const bar = document.getElementById('editBar');
      const barBox = bar ? bar.getBoundingClientRect() : null;
      o['编辑模式 / 可写'] = DV.Settings.get().editMode + ' / ' +
        (it && it.fullPath ? it.fullPath : '不可写');
      o['编辑条'] = bar ? (bar.hidden ? '隐藏' : '显示 ' + Math.round(barBox.width) + 'x' + Math.round(barBox.height)) : '无元素';
      o['追加按钮'] = (function () { var b = document.getElementById('btnAppend');
        return b ? (b.hidden ? '隐藏' : '显示') : '无元素'; })();
    }
    o['当前主题'] = (DV.Settings ? DV.Settings.get().theme : '—') +
      ' · 底色 ' + csBody.backgroundColor + ' · 强调 ' + csBody.getPropertyValue('--accent').trim();
    const row = document.querySelector('.fitem');
    if (row) {
      const csRow = getComputedStyle(row);
      const ic = row.querySelector('.ficon');
      const meta = row.querySelector('.fmeta');
      o['文件行对齐'] = csRow.alignItems;
      if (ic && meta) {
        o['图标/文字块高度'] = ic.getBoundingClientRect().height.toFixed(1) + ' / ' +
          meta.getBoundingClientRect().height.toFixed(1) + ' px';
        o['图标中心偏移'] = (ic.getBoundingClientRect().top + ic.getBoundingClientRect().height / 2 -
          (meta.getBoundingClientRect().top + meta.getBoundingClientRect().height / 2)).toFixed(2) + ' px';
      }
    }
    const docEl = document.querySelector('.doc');
    if (docEl) {
      o['文档文字色'] = getComputedStyle(docEl).color;
      o['--doc-color'] = getComputedStyle(document.body).getPropertyValue('--doc-color').trim() || '(未设置)';
      const inner = docEl.querySelector('span,p');
      if (inner) o['首段文字色'] = getComputedStyle(inner).color + ' / 行内: ' + (inner.getAttribute('style') || '无');
    }
    const sb = document.querySelector('.sidebar');
    if (sb) {
      const csb = getComputedStyle(sb);
      o['侧栏宽度'] = sb.getBoundingClientRect().width.toFixed(2) + ' px';
      o['侧栏过渡'] = csb.transitionProperty + ' / ' + csb.transitionDuration;
      o['侧栏状态'] = document.querySelector('.app').classList.contains('no-side') ? '已收起' : '展开';
    }
    const sp = document.getElementById('settingspane');
    if (sp && !sp.hidden) {
      const csp = getComputedStyle(sp);
      o['设置面板宽度'] = sp.getBoundingClientRect().width.toFixed(2) + ' px';
      o['设置面板过渡'] = csp.transitionProperty + ' / ' + csp.transitionDuration;
    }
    const cs2 = getComputedStyle(document.documentElement);
    o['--dur-base'] = cs2.getPropertyValue('--dur-base').trim() || '—';
    o['--anim-speed'] = cs2.getPropertyValue('--anim-speed').trim() || '—';


    o['帧率上限'] = cap ? { value: cap + ' fps', cls: 'acc' } : '不限';
    o['动画帧率'] = {
      value: info.animFps.toFixed(1) + ' fps',
      cls: cap ? (info.animFps >= cap * 0.88 ? 'ok' : info.animFps >= cap * 0.6 ? 'warn' : 'err') : 'ok',
    };
    o['时间步进'] = info.effectiveInterval + ' ms/帧';
    o['画面帧率(显示器)'] = { value: info.renderFps.toFixed(1) + ' fps', cls: 'ok' };
    o['平均帧间隔'] = DV.fmtMs(info.frameMs);
    const ref = _refresh > 0 ? _refresh : 60;
    const lag = Math.max(0, ref - info.renderFps);
    o['相对刷新率掉帧'] = info.renderFps > 0
      ? { value: DV.fmtNum(Math.round(lag)) + ' fps', cls: lag > ref * 0.25 ? 'warn' : 'ok' }
      : '—';
    o['采样点数'] = histLen + ' / ' + HIST;
    o['显示器刷新上限'] = refreshHint();
    o['说明'] = { __hint: '动画帧率可超过 60；画面仍按屏幕刷新率显示。' };

    o['__0'] = { __group: '调度吞吐（探针，不渲染画面）' };
    o['探针状态'] = !probeOn
      ? { value: '已关闭', cls: 'ok' }
      : (probeMax ? { value: '放开模式（跑满 CPU）', cls: 'err' } : { value: '受控模式（低占用）', cls: 'ok' });
    o['每秒调度次数'] = probeOn ? { value: DV.fmtNum(Math.round(probeTps)) + ' 次/秒', cls: 'acc' } : '—';
    o['探针 CPU 预算'] = probeMax ? '不限制' : DV.fmtNum(PROBE_TPS_BUDGET) + ' 次/秒';

    o['__1'] = { __group: '渲染与动画' };
    for (const k in renderStats) o[k] = renderStats[k];
    o['动画强度'] = (DV.Settings ? DV.Settings.get().anim : '—');

    o['__2'] = { __group: '内存 / 计时' };
    const mem = performance.memory;
    if (mem) {
      o['JS 堆已用'] = DV.fmtBytes(mem.usedJSHeapSize);
      o['JS 堆总量'] = DV.fmtBytes(mem.totalJSHeapSize);
      o['堆上限'] = DV.fmtBytes(mem.jsHeapSizeLimit);
      const pct = mem.usedJSHeapSize / mem.jsHeapSizeLimit * 100;
      o['堆占用率'] = { value: pct.toFixed(1) + ' %', cls: pct > 80 ? 'warn' : 'ok' };
    } else {
      o['JS 堆'] = { value: '此浏览器不支持 performance.memory', cls: 'warn' };
    }
    o['页面存活'] = DV.fmtDuration(performance.now() / 1000);
    o['DOM 节点数'] = DV.fmtNum(document.getElementsByTagName('*').length);
    return o;
  }

  /* ---------------- 环境数据 ---------------- */
  function envObj() {
    const n = navigator, sc = screen;
    const o = {};
    o['__a'] = { __group: '浏览器' };
    o['User Agent'] = n.userAgent;
    o['语言'] = (n.language || '') + ' → ' + (n.languages || []).join(', ');
    o['平台'] = n.platform || '—';
    o['CPU 线程'] = n.hardwareConcurrency || '—';
    o['设备内存'] = (n.deviceMemory ? n.deviceMemory + ' GB' : '—');
    o['Cookie 启用'] = String(n.cookieEnabled);
    o['在线状态'] = n.onLine ? '在线' : '离线';

    o['__b'] = { __group: '显示' };
    o['窗口尺寸'] = window.innerWidth + ' × ' + window.innerHeight;
    o['屏幕尺寸'] = sc.width + ' × ' + sc.height;
    o['可用区域'] = sc.availWidth + ' × ' + sc.availHeight;
    o['设备像素比'] = String(window.devicePixelRatio);
    o['色深'] = sc.colorDepth + ' bit';
    o['显示器刷新率'] = refreshHint();
    o['主题'] = (document.body.getAttribute('data-theme') || 'dark');

    o['__c'] = { __group: '功能支持' };
    o['File API'] = String(typeof FileReader !== 'undefined');
    o['TextDecoder'] = String(typeof TextDecoder !== 'undefined');
    o['GBK 解码'] = String(!!window.__DV_GBK_OK);
    o['localStorage'] = storageInfo();
    o['ResizeObserver'] = String(typeof ResizeObserver !== 'undefined');
    o['WebAssembly'] = String(typeof WebAssembly !== 'undefined');
    o['OffscreenCanvas'] = String(typeof OffscreenCanvas !== 'undefined');
    o['prefers-reduced-motion'] =
      String(window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : '—');

    o['__d'] = { __group: '页面与设置' };
    o['文档标题'] = document.title;
    o['URL'] = location.href;
    o['本地文件模式'] = {
      value: location.protocol === 'file:' ? '是 (file://)' : '否',
      cls: location.protocol === 'file:' ? 'warn' : '',
    };
    if (DV.Settings) {
      const s = DV.Settings.get();
      o['主题 / 字体'] = s.theme + ' / ' + s.font;
      o['排版'] = s.size + 'px / 行高 ' + s.lineHeight + ' / 行宽 ' + s.width + 'px';
      o['沉浸式阅读'] = s.immersive ? '开启' : '关闭';
      o['自定义颜色'] = Object.keys(s.colors || {}).join(', ') || '无';
    }
    o['就绪耗时'] = (window.__DV_READY_MS != null ? DV.fmtMs(window.__DV_READY_MS) : '—');
    o['__e'] = { __group: '扩展信息' };
    for (const k in envExtra) o[k] = envExtra[k];
    return o;
  }

  function storageInfo() {
    try {
      const a = (localStorage.getItem('docviewer.session') || '').length;
      const b = (localStorage.getItem('docviewer.settings.v1') || '').length;
      return '可用 · 会话 ' + DV.fmtBytes(a) + ' · 设置 ' + DV.fmtBytes(b);
    } catch (e) { return '不可用 (' + e.name + ')'; }
  }

  /** 用 rAF 采样一次刷新率 */
  function refreshHint() { return _refresh > 0 ? _refresh.toFixed(0) + ' Hz' : '采样中…'; }
  function sampleRefresh() {
    let n = 0;
    const t0 = now();
    const step = () => {
      n++;
      const dt = now() - t0;
      if (dt >= 500) { _refresh = n * 1000 / dt; return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------------- 高帧率探针 ---------------- */
  function probeLoop() {
    if (!running || !probeOn) return;
    const t0 = now();
    for (let k = 0; k < PROBE_BURST; k++) probe++;
    const batchMs = now() - t0;
    if (probeLastT === 0) probeLastT = t0;
    const elapsed = t0 - probeLastT;
    if (elapsed >= 1000) {
      probeTps = probe * 1000 / elapsed;
      probe = 0; probeLastT = t0;
    }
    if (probeMax) setTimeout(probeLoop, 0);
    else setTimeout(probeLoop, Math.max(0, Math.round(PROBE_BURST * 1000 / PROBE_TPS_BUDGET - batchMs)));
  }

  function setProbe(on, max) {
    probeOn = !!on;
    if (max !== undefined) probeMax = !!max;
    if (probeOn) { probe = 0; probeLastT = 0; setTimeout(probeLoop, 0); }
    else probeTps = 0;
    DV.Log.info('高帧率探针：' + (probeOn ? (probeMax ? '已开启 · 放开模式（会跑满 CPU）' : '已开启 · 受控模式') : '已关闭'));
  }

  /* ---------------- 每帧回调（由 frames.js 驱动） ---------------- */
  let histT = 0, lastTextAt = 0;
  function onFrame() {
    if (!DV.frames) return;
    const info = DV.frames.info();
    renderFps = info.renderFps;
    animFps = info.animFps;
    frameMs = info.frameMs;
    // 文本写入必须节流：每帧写 textContent 会触发样式重算，240fps 下能把 CPU 拉高
    const tsNow = now();
    if (tsNow - lastTextAt >= 250) {
      lastTextAt = tsNow;
      if (N.tbFps) N.tbFps.textContent = renderFps.toFixed(0) + ' fps';
      if (N.fpsNow && visible) N.fpsNow.textContent = animFps.toFixed(1);
      if (N.metric) {
        N.metric.textContent = animFps.toFixed(0) + '/' + (info.cap || '∞') + ' fps' +
          (probeOn ? ' · ' + DV.fmtNum(Math.round(probeTps)) + ' 调度' : '');
      }
    }
    // 曲线：每 100ms 采一点，避免高帧率把曲线刷爆
    const ts = now();
    if (ts - histT >= 100) {
      histT = ts;
      hist[histPos] = animFps;
      histPos = (histPos + 1) % HIST;
      if (histLen < HIST) histLen++;
      window.__DV_SAMPLES = histLen;        // 供外部诊断查询
      window.__DV_ANIM_FPS = animFps;
    }
    if (visible) {
      if (ts - lastPaint >= 1000 / DOM_HZ) { lastPaint = ts; refresh(); }
      else if (ts - lastChart >= 1000 / CHART_HZ) { lastChart = ts; drawGraph(); }
    }
  }

  /* ---------------- FPS 曲线 ---------------- */
  function drawGraph() {
    const cv = DV.$('#fpsCanvas');
    if (!cv || !cv.getContext) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 300, h = 76;
    if (cv.width !== Math.floor(w * dpr)) {
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
    }
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const cs = getComputedStyle(document.body);
    const accent = cs.getPropertyValue('--accent').trim() || '#8cc63f';
    const lineC = cs.getPropertyValue('--line').trim() || '#333';

    const cap = DV.frames ? DV.frames.getFps() : 0;
    const top = cap > 0 ? Math.max(cap * 1.15, 30) : FPS_MAX;

    g.strokeStyle = lineC; g.lineWidth = 1;
    g.beginPath();
    for (let k = 1; k <= 3; k++) { const y = h * k / 4; g.moveTo(0, y); g.lineTo(w, y); }
    g.stroke();
    g.fillStyle = lineC;
    g.font = '9px ui-monospace, monospace';
    g.fillText(String(Math.round(top)), 3, 9);
    g.fillText(String(Math.round(top / 2)), 3, h / 2 - 2);
    g.fillText('0', 3, h - 3);

    if (cap > 0) {                       // 帧率上限参考线
      const y = h - Math.min(cap, top) / top * h;
      g.strokeStyle = accent + '77';
      g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      g.setLineDash([]);
    }

    if (histLen < 2) return;
    const n = histLen;
    const xOf = k => (k / (HIST - 1)) * w;
    const yOf = v => h - Math.min(v, top) / top * h;

    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, accent + '66');
    grad.addColorStop(1, accent + '05');
    g.beginPath();
    g.moveTo(xOf(0), h);
    for (let k = 0; k < n; k++) {
      const idx = (histPos - n + k + HIST * 2) % HIST;
      g.lineTo(xOf(k), yOf(hist[idx]));
    }
    g.lineTo(xOf(n - 1), h);
    g.closePath();
    g.fillStyle = grad;
    g.fill();

    g.beginPath();
    for (let k = 0; k < n; k++) {
      const idx = (histPos - n + k + HIST * 2) % HIST;
      const x = xOf(k), y = yOf(hist[idx]);
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.strokeStyle = accent;
    g.lineWidth = 1.6;
    g.stroke();
  }

  function refresh() {
    if (!visible) return;
    paint();
    paintLog();
  }

  /* ---------------- 日志 ---------------- */
  let logDirty = false;
  function paintLog() {
    const box = N.log || (N.log = DV.$('#dbgLog'));
    if (!box) return;
    const list = DV.Log.entries;
    if (!list.length) { box.innerHTML = '<div class="log-empty">暂无日志</div>'; return; }
    box.innerHTML = list.slice(-300).map(e =>
      '<div class="logline ' + e.level + '">' +
      '<span class="lt">' + DV.fmtTime(e.t) + '</span>' +
      '<span class="lm">' + DV.esc(e.msg) + '</span></div>').join('');
    if (!N.autoScroll) N.autoScroll = DV.$('#logAutoScroll');
    if (!N.autoScroll || N.autoScroll.checked) box.scrollTop = box.scrollHeight;
  }

  /* ---------------- 公开 API ---------------- */
  const api = {
    init() {
      cacheNodes();
      const safe = (name, fn) => { try { fn(); } catch (e) { DV.Log.warn('调试面板初始化 ' + name + ' 失败：' + e.message); } };
      const close = DV.$('#dbgClose');
      if (close) close.addEventListener('click', () => api.hide());

      safe('tab', () => DV.$$('.dbg-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          DV.$$('.dbg-tab').forEach(t => t.classList.toggle('active', t === tab));
          DV.$$('.dbg-page').forEach(p => {
            if (p.dataset.page) p.classList.toggle('active', p.dataset.page === tab.dataset.tab);
          });
          paint(); paintLog();
        });
      }));

      const rp = DV.$('#dbgResetPerf');
      if (rp) rp.addEventListener('click', () => {
        histLen = 0; histPos = 0;
        refresh();
        DV.toast('性能统计已重置', '', 1400);
      });

      const lc = DV.$('#logClear');
      if (lc) lc.addEventListener('click', () => { DV.Log.clear(); paintLog(); });
      const lcp = DV.$('#logCopy');
      if (lcp) lcp.addEventListener('click', () => {
        const txt = DV.Log.entries.map(e =>
          '[' + DV.fmtTime(e.t) + '] ' + e.level.toUpperCase() + ' ' + e.msg).join('\n');
        navigator.clipboard.writeText(txt).then(
          () => DV.toast('日志已复制', '', 1400),
          () => DV.toast('复制失败', 'err'));
      });

      DV.Log.subscribe(() => { logDirty = true; });
      setInterval(() => { if (visible && logDirty) { logDirty = false; paintLog(); } }, 600);

      const cbProbe = DV.$('#dbgProbe');
      const cbMax = DV.$('#dbgProbeMax');
      if (cbProbe) {
        cbProbe.checked = probeOn;
        cbProbe.addEventListener('change', e => setProbe(e.target.checked, cbMax && cbMax.checked));
      }
      if (cbMax) cbMax.addEventListener('change', e => { if (probeOn) setProbe(true, e.target.checked); });

      running = true;
      // 主通道：挂在统一帧调度器上（受帧率上限约束）
      if (DV.frames) DV.frames.on(onFrame);
      // 兜底通道：即使帧调度器出问题，曲线与读数也能持续更新
      onFrame();
      setInterval(onFrame, 250);
      sampleRefresh();
      setProbe(probeOn, false);
      window.addEventListener('resize', () => { if (visible) drawGraph(); });
    },

    show() {
      visible = true;
      DV.debugEnabled = true;
      DV.openPane(DV.$('#debugpane'));
      const b = DV.$('#btnDebug');
      if (b) b.classList.add('on');
      refresh();
      DV.Log.info('调试面板已打开 (F3)');
    },
    hide() {
      visible = false;
      DV.debugEnabled = false;
      DV.closePane(DV.$('#debugpane'));
      const b = DV.$('#btnDebug');
      if (b) b.classList.remove('on');
      DV.Log.info('调试面板已关闭 (F3)');
    },
    toggle() { visible ? api.hide() : api.show(); },
    get visible() { return visible; },

    setDocument(info) { docKv = info || {}; if (visible) paint(); },
    setRender(stats) { renderStats = stats || {}; if (visible) paint(); },
    setEnv(extra) { Object.assign(envExtra, extra || {}); if (visible) paint(); },

    fps: () => (DV.frames ? DV.frames.info().animFps : animFps),
    renderFps: () => (DV.frames ? DV.frames.info().renderFps : renderFps),
    tps: () => (probeOn ? probeTps : 0),
    setProbe,
    isProbeOn: () => probeOn,
    refreshRate: () => _refresh,
    stats: () => {
      const i = DV.frames ? DV.frames.info()
        : { renderFps, animFps, frameMs, cap: 0, dropped: 0, totalFrames: 0, totalAnimFrames: 0 };
      return {
        fps: i.animFps, renderFps: i.renderFps, cap: i.cap, frameMs: i.frameMs,
        totalFrames: i.totalFrames, totalAnimFrames: i.totalAnimFrames, dropped: i.dropped,
        samples: histLen, probeOn, probeMax, tps: probeOn ? probeTps : 0, refreshRate: _refresh,
      };
    },

    log: (msg) => DV.Log.info(msg),

    /**
     * 生成可粘贴的诊断报告：编码、换行来源、内容完整性、样式与列表统计。
     * 文本类问题（换行丢失 / 乱码 / 内容缺失）都能从这份报告里定位。
     */
    report(item) {
      const L = [];
      const line = (k, v) => L.push('  ' + String(k).padEnd(22, ' ') + v);
      L.push('===== DocViewer 诊断报告 =====');
      L.push('时间: ' + new Date().toLocaleString());
      L.push('版本: ' + (DV.App && DV.App.version || '?'));
      L.push('UA: ' + navigator.userAgent);
      L.push('设置: ' + JSON.stringify(DV.Settings ? DV.Settings.get() : {}));
      L.push('帧率: ' + (DV.frames ? JSON.stringify(DV.frames.info()) : '—'));
      if (item) {
        L.push('');
        L.push('[文件]');
        line('名称', item.name);
        line('大小', DV.fmtBytes(item.bytes || item.size));
        line('识别编码', item.encoding || '—');
        line('类型', item.kind + (item.merged ? ' (拼接)' : ''));
        L.push('');
        L.push('[换行来源]  ← 换行"没效果"看这里');
        const raw = item.text || '';
        const nl = (raw.match(/\n/g) || []).length;
        const BS = String.fromCharCode(92);
        const parN = (raw.match(new RegExp(BS + 'par(?![a-zA-Z])', 'g')) || []).length;
        const lineN = (raw.match(new RegExp(BS + 'line(?![a-zA-Z])', 'g')) || []).length;
        const sectN = (raw.match(new RegExp(BS + 'sect(?![a-zA-Z])', 'g')) || []).length;
        const mdNl = item.kind === 'md' || item.kind === 'txt' || item.kind === 'code';
        line('源文件裸换行', nl + ' 个' + (mdNl ? '（文本类文件按原样保留）'
          : (DV.Settings.get().rtfSoftWrap !== false ? '（已按换行处理）' : '，⚠️ 未开启"按源换行"）')));
        line('源文件 \\par', parN + ' 个');
        line('源文件 \\line', lineN + ' 个');
        line('源文件 \\sect', sectN + ' 个');
        if (item.info) {
          if (!(item.info['硬换行 (\\par)'] > 0) && !item.info['软换行 (<br>)'])
            L.push('  ⚠️ 没有检测到任何换行 —— 该 RTF 可能整篇只有一个段落');
          line('硬换行(\\par)', item.info['硬换行 (\\par)'] || '—');
          line('软换行(<br>)', item.info['软换行 (<br>)'] || '—');
          line('软分段(空行)', item.info['软分段 (空行)'] || '—');
        }
        L.push('');
        L.push('[渲染结果]');
        const html = item.html || '';
        const plain = html.replace(/<[^>]*>/g, '');
        line('HTML 长度', html.length);
        line('段落 <p>', String((html.match(/<p /g) || []).length));
        line('换行 <br>', String((html.match(/<br>/g) || []).length));
        line('列表项 <li>', String((html.match(/<li/g) || []).length));
        line('最长段落', Math.max(0, ...plain.split(/</).map(x => x.length)) + ' 字符');
        line('替换符 U+FFFD', String((plain.match(/\uFFFD/g) || []).length) + ((/\uFFFD/.test(plain)) ? '  ← 乱码' : ''));
        line('汉字数', String((plain.match(/[\u4e00-\u9fa5]/g) || []).length));
        const rc = (raw.match(/[\u4e00-\u9fa5]/g) || []).length;
        line('源文汉字数', String(rc) + (rc && Math.abs(rc - (plain.match(/[\u4e00-\u9fa5]/g) || []).length) > rc * 0.05 ? '  ← 有丢失' : ''));
        if (item.parsedAt != null) line('解析耗时', DV.fmtMs(item.parsedAt));
        if (item.warnings && item.warnings.length) {
          L.push('');
          L.push('[告警]');
          item.warnings.forEach(w => L.push('  - ' + w));
        }
        L.push('');
        L.push('[正文开头 200 字]');
        L.push('  ' + plain.slice(0, 200).replace(/\n/g, '⏎'));
      }
      L.push('');
      L.push('[最近日志]');
      DV.Log.entries.slice(-25).forEach(e => L.push('  [' + e.level + '] ' + DV.fmtTime(e.t) + ' ' + e.msg));
      return L.join('\n');
    },

    /** 输出到日志 + 复制到剪贴板 */
    emitReport(item) {
      const txt = api.report(item);
      DV.Log.entries.length = 0;
      txt.split('\n').slice(-400).forEach(l => DV.Log.info(l));
      paintLog();
      let copied = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt);
          copied = true;
        }
      } catch (e) { copied = false; }
      DV.toast(copied ? '诊断报告已复制到剪贴板（也写进日志页）' : '诊断报告已写入日志页', '', 2600);
      return txt;
    },
    __kvHtml: kvHtml,
    __envObj: envObj,
    __envKv: envObj,
    __perfObj: perfObj,
  };

  return api;
})();
