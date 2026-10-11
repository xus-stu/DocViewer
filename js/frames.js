/* =====================================================================
   frames.js — 渲染 / 动画调度器
   =====================================================================
   为什么不能只用 requestAnimationFrame：
     rAF 被浏览器锁在显示器刷新率上（普通屏 60Hz、ProMotion 120Hz），
     所以「帧率上限 120/180/240」在 rAF 下永远达不到 —— 只能往下限、不能往上走。
   这里把两件事拆开：
     · 渲染帧率 —— 仍用 rAF 采样，代表「显示器每秒真正显示多少张画面」
     · 动画帧率 —— 用 setTimeout 按 1000/cap 的间隔驱动，能真正跑到 120/180/240
   注意屏幕物理上仍只显示刷新率那么多张（60Hz 屏就是 60 张/秒），
   高于刷新率的部分体现为更细的时间步进（更平滑的缓动、更密的采样）。
   ===================================================================== */
window.DV = window.DV || {};

DV.frames = (function () {

  const MIN_INTERVAL = 3;          // 最小间隔（ms）：再快没意义，还会吃 CPU
  const MAX_INTERVAL = 1000;

  const listeners = new Set();     // fn(dt, info)
  let cap = 240;                   // 0 = 不限（跟随 vsync）
  let running = false;

  let rafSample = 0, rafVsync = 0, timerId = 0, nextDeadline = 0;
  let lastAnimTs = 0;

  /* 统计 */
  let tickCount = 0, animFps = 0;
  let renderCount = 0, renderFps = 0;
  let frameMs = 0, lastRenderTs = 0, dropped = 0;
  let framesTotal = 0, animsTotal = 0;
  let sampleAt = 0;

  const now = () => (performance.now ? performance.now() : Date.now());
  const interval = () => (cap > 0 ? Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, 1000 / cap)) : 0);

  function info() {
    return {
      cap,
      renderFps: +renderFps.toFixed(1),
      animFps: +animFps.toFixed(1),
      frameMs: +frameMs.toFixed(2),
      dropped,
      totalFrames: framesTotal,
      totalAnimFrames: animsTotal,
      effectiveInterval: +interval().toFixed(2),
    };
  }

  /** 一次动画帧：把最新状态交给所有订阅者 */
  function fire(t) {
    const dt = lastAnimTs ? t - lastAnimTs : (cap > 0 ? interval() : 16.7);
    lastAnimTs = t;
    tickCount++; animsTotal++;
    listeners.forEach(fn => {
      try { fn(dt, info()); } catch (e) { DV.Log.error('动画回调异常：' + e.message); }
    });
    rollStats(t);
  }

  /* ---- rAF 采样：只测显示器刷新率与渲染帧数，不驱动动画 ---- */
  function sampleLoop() {
    if (!running) return;
    rafSample = requestAnimationFrame(sampleLoop);
    const t = now();
    renderCount++; framesTotal++;
    if (lastRenderTs) {
      const dt = t - lastRenderTs;
      if (dt > 0 && dt < 2000) {
        frameMs = frameMs ? frameMs * 0.9 + dt * 0.1 : dt;
        if (dt > 25) dropped++;
      }
    }
    lastRenderTs = t;
    rollStats(t);
  }

  function rollStats(t) {
    if (!sampleAt) { sampleAt = t; return; }
    const el = t - sampleAt;
    if (el < 500) return;
    animFps = tickCount * 1000 / el;
    renderFps = renderCount * 1000 / el;
    tickCount = 0; renderCount = 0; sampleAt = t;
  }

  /* ---- 调度 ---- */
  function schedule() {
    if (!running) return;
    if (cap <= 0) {                                   // 不限：跟随 vsync
      timerId = 0;
      rafVsync = requestAnimationFrame(onVsync);
      return;
    }
    const iv = interval();
    const t = now();
    if (!nextDeadline || nextDeadline < t) nextDeadline = t + iv;
    timerId = setTimeout(onTimer, Math.max(0, nextDeadline - t));
  }

  function onTimer() {
    const t = now();
    const iv = interval();
    nextDeadline += iv;
    // 落后超过两帧就重新对齐，避免连续追帧把 CPU 拉满
    if (nextDeadline < t - iv * 2) nextDeadline = t + iv;
    fire(t);
    schedule();
  }

  function onVsync() {
    fire(now());
    schedule();
  }

  function restart() {
    clearTimeout(timerId); timerId = 0;
    nextDeadline = 0; lastAnimTs = 0;
    schedule();
  }

  return {
    start() {
      if (running) return;
      running = true;
      sampleAt = 0;
      rafSample = requestAnimationFrame(sampleLoop);
      schedule();
    },
    stop() {
      running = false;
      clearTimeout(timerId); timerId = 0;
      if (rafSample) cancelAnimationFrame(rafSample);
      if (rafVsync) cancelAnimationFrame(rafVsync);
    },

    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    off(fn) { listeners.delete(fn); },

    /** 帧率上限：30 / 60 / 120 / 180 / 240；0 = 不限（跟随 vsync） */
    setFps(v) {
      const next = Math.max(0, Number(v) || 0);
      cap = next;
      if (running) restart();
      if (DV.debugEnabled) {
        DV.Log.info('动画帧率上限：' + (cap ? cap + ' fps（间隔 ' + interval().toFixed(2) + ' ms）' : '不限'));
      }
      if (cap > 60) {
        DV.Log.info('提示：' + cap + ' fps 下时间步进更细（缓动更平滑），但 60Hz 屏幕每秒仍只显示约 60 张画面');
      }
    },
    getFps: () => cap,
    interval,
    info,
  };
})();
