// tetris-menu-music.js: the Tetris menu's ambient music loop.
//
// The loop (Balcade_Menu_Ambient_Seamless_Loop) hooks straight onto the end of the opening cinematic: the cinematic
// borrows this module's AudioContext and cues the loop for its own t = 60 s on the audio clock, so the hand-over
// is gapless. Without the cinematic the loop starts on the menu (on the first click or key if the browser is
// holding audio back). It plays only on the menu screens: starting a game plays a short sound and stops it, and
// coming back to the menu fades it back in. A Music button (bottom left) mutes it and remembers the choice. While
// it plays, its low end drives the page background (TetrisBG energy and pulses).
//
// The loop is decoded once and looped on the audio clock (AudioBufferSourceNode loop, trimmed to LOOP_LEN), which
// is what the track's README asks for: no encoder padding, no gap at the seam.
//
// API (window.TetrisMenuMusic): context(), cue(ctxTime), cancelCue(), hold(on), startNow(fadeSeconds), screen(id),
// level()
(function () {
  'use strict';

  var G = window.Games;
  if (!G) return;
  var LOOP = 'Balcade_Menu_Ambient_Seamless_Loop.ogg', LOOP_FALLBACK = 'Balcade_Menu_Ambient_Loop.mp3', LOOP_LEN = 21.3333;
  var VOLUME = 0.55, STORE = 'tetris_menu_music';
  var CREDIT = 'Music: "runner2088" by wekont (CC BY 4.0), edited into an ambient loop';
  var MENU_SCREENS = { menuPanel: 1, skullsPanel: 1, onlinePanel: 1, lobbyPanel: 1 };

  var M = {
    ctx: null, out: null, music: null, analyser: null, bins: null, buf: null, loading: false,
    src: null, cue: null, pending: null, playing: false, held: false, onMenu: true,
    wanted: G.Store.get(STORE, 'on') !== 'off', btn: null, raf: 0, avg: 0, lvl: 0
  };

  /* ---------- audio ---------- */

  function context() {
    if (M.ctx) return M.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { M.ctx = new AC(); } catch (e) { return null; }
    var ctx = M.ctx;
    M.out = ctx.createGain(); M.out.gain.value = 1;
    M.music = ctx.createGain(); M.music.gain.value = 0;
    M.analyser = ctx.createAnalyser(); M.analyser.fftSize = 256; M.analyser.smoothingTimeConstant = 0.6;
    M.bins = new Uint8Array(M.analyser.frequencyBinCount);
    M.music.connect(M.analyser); M.analyser.connect(M.out); M.out.connect(ctx.destination);
    load();
    return ctx;
  }

  function decode(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(function (ab) { return new Promise(function (ok, no) { M.ctx.decodeAudioData(ab, ok, no); }); });
  }

  function load() {
    if (M.loading || M.buf) return;
    M.loading = true;
    // Ogg is the gapless master; a browser that can't decode it falls back to the MP3 (trimmed to LOOP_LEN anyway).
    decode(LOOP).catch(function () { return decode(LOOP_FALLBACK); }).then(function (b) {
      M.loading = false; M.buf = b;
      if (M.pending != null) { var at = M.pending; M.pending = null; begin(at, 0); }
    }).catch(function (e) { M.loading = false; console.warn('[menu-music]', e); });
  }

  function stopSource(at) {
    if (!M.src) return;
    try { M.src.stop(at || 0); } catch (e) { /* not started yet, or already stopped */ }
    M.src = null;
  }

  // Start the loop at audio-clock time `when`, fading in over `fade` seconds (0 = straight on, as a seamless cue).
  function begin(when, fade) {
    if (!M.ctx || !M.wanted || !M.onMenu || M.held && M.cue == null) return;
    if (!M.buf) { M.pending = when; load(); return; }
    var now = M.ctx.currentTime;
    when = Math.max(when, now + 0.01);
    stopSource(when);
    var s = M.ctx.createBufferSource();
    s.buffer = M.buf; s.loop = true; s.loopStart = 0; s.loopEnd = Math.min(M.buf.duration, LOOP_LEN);
    s.connect(M.music);
    s.start(when);
    M.src = s;
    var g = M.music.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(fade ? 0 : VOLUME, Math.max(now, when - 0.005));
    if (fade) g.linearRampToValueAtTime(VOLUME, when + fade);
    M.playing = true;
    paint();
    tick();
  }

  function stop(fade) {
    M.cue = null; M.pending = null;
    if (!M.ctx || !M.src) { M.playing = false; paint(); calm(); return; }
    var now = M.ctx.currentTime, g = M.music.gain;
    fade = fade == null ? 0.6 : fade;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + fade);
    stopSource(now + fade + 0.05);
    M.playing = false;
    paint();
    calm();
  }

  function startNow(fade) {
    if (!M.wanted || !M.onMenu || M.held) return;
    var ctx = context();
    if (!ctx) return;
    if (ctx.state === 'suspended') { ctx.resume(); armUnlock(); }
    if (M.playing && M.src) return;
    begin(ctx.currentTime + 0.05, fade == null ? 1.5 : fade);
  }

  // Browsers hold audio until the first click or key; start (or resume) the loop then.
  var armed = false;
  function armUnlock() {
    if (armed) return;
    armed = true;
    function go() {
      document.removeEventListener('pointerdown', go, true);
      document.removeEventListener('keydown', go, true);
      armed = false;
      if (!M.ctx) return;
      M.ctx.resume().then(function () { if (!M.playing) startNow(1.5); });
    }
    document.addEventListener('pointerdown', go, true);
    document.addEventListener('keydown', go, true);
  }

  // A short rising "here we go" when a game starts: a pulse sweep and two quick notes (respects the site mute).
  function startSound() {
    if (!M.ctx || M.ctx.state !== 'running' || (G.Sound && G.Sound.isMuted && G.Sound.isMuted())) return;
    var ctx = M.ctx, t = ctx.currentTime + 0.01;
    function tone(type, f0, f1, at, dur, vol) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
      g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(vol, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g); g.connect(M.out); o.start(at); o.stop(at + dur + 0.05);
    }
    tone('sawtooth', 180, 1400, t, 0.35, 0.06);
    tone('square', 660, 660, t + 0.12, 0.12, 0.05);
    tone('square', 990, 990, t + 0.22, 0.25, 0.05);
  }

  /* ---------- the background reacts to the loop ---------- */

  function level() {
    if (!M.analyser || !M.playing) return 0;
    M.analyser.getByteFrequencyData(M.bins);
    var s = 0;
    for (var i = 1; i < 10; i++) s += M.bins[i];
    return s / (9 * 255);
  }

  function tick() {
    if (M.raf) return;
    M.raf = requestAnimationFrame(function step() {
      M.raf = 0;
      if (!M.playing || !M.onMenu) return;
      var BG = window.TetrisBG;
      var l = level();
      M.lvl += (l - M.lvl) * 0.25;
      M.avg += (l - M.avg) * 0.03;
      if (BG && !document.documentElement.classList.contains('cine-open')) {
        BG.setEnergy(Math.min(1, M.lvl * 1.4) * 0.75);
        if (l - M.avg > 0.07) BG.pulse(Math.min(0.5, (l - M.avg) * 3));
      }
      M.raf = requestAnimationFrame(step);
    });
  }

  function calm() {
    if (M.raf) { cancelAnimationFrame(M.raf); M.raf = 0; }
    if (window.TetrisBG && M.onMenu) window.TetrisBG.setEnergy(0);
  }

  /* ---------- the Music button ---------- */

  function paint() {
    if (!M.btn) return;
    M.btn.classList.toggle('off', !M.wanted);
    M.btn.classList.toggle('live', M.playing);
    M.btn.setAttribute('aria-pressed', M.wanted ? 'true' : 'false');
    M.btn.querySelector('.tmm-label').textContent = M.wanted ? 'Music on' : 'Music off';
    M.btn.hidden = !M.onMenu;
  }

  function buildButton() {
    var css = document.createElement('style');
    css.textContent =
      '.tmm-btn{position:fixed;left:16px;bottom:16px;z-index:60;display:flex;align-items:center;gap:10px;padding:10px 16px 10px 12px;' +
      'border-radius:999px;border:1px solid rgba(190,120,255,.55);background:rgba(12,6,26,.78);color:#f7f2ff;cursor:pointer;' +
      'font:700 13px/1 var(--font-family-heading,"JetBrains Mono",monospace);letter-spacing:.04em;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);' +
      'box-shadow:0 0 0 1px rgba(255,47,166,.15),0 10px 30px -12px rgba(157,0,255,.8);transition:background .2s ease,border-color .2s ease}' +
      '.tmm-btn:hover,.tmm-btn:focus-visible{background:rgba(157,0,255,.4);border-color:#ff2fa6;outline:none}' +
      '.tmm-btn[hidden]{display:none}' +
      '.tmm-eq{display:flex;align-items:flex-end;gap:2px;height:14px}' +
      '.tmm-eq i{display:block;width:3px;height:4px;border-radius:1px;background:#ff2fa6}' +
      '.tmm-btn.live .tmm-eq i{animation:tmm-eq .9s ease-in-out infinite}' +
      '.tmm-btn.live .tmm-eq i:nth-child(2){animation-delay:-.3s;background:#28e8ff}.tmm-btn.live .tmm-eq i:nth-child(3){animation-delay:-.6s}' +
      '.tmm-btn.off .tmm-eq i{background:#6d5a8a;height:3px}' +
      '.tmm-btn.off .tmm-label{color:#b9a6dd}' +
      '@keyframes tmm-eq{0%,100%{height:4px}50%{height:14px}}' +
      '@media (prefers-reduced-motion:reduce){.tmm-btn.live .tmm-eq i{animation:none;height:10px}}' +
      'html.cine-open .tmm-btn{display:none}';
    document.head.appendChild(css);
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tmm-btn';
    b.title = CREDIT;
    b.setAttribute('aria-label', 'Menu music (' + CREDIT + ')');
    b.innerHTML = '<span class="tmm-eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="tmm-label"></span>';
    b.addEventListener('click', function () {
      M.wanted = !M.wanted;
      G.Store.set(STORE, M.wanted ? 'on' : 'off');
      if (M.wanted) { M.held = false; startNow(0.8); } else stop(0.5);
      paint();
    });
    document.body.appendChild(b);
    M.btn = b;
    paint();
  }

  /* ---------- API ---------- */

  window.TetrisMenuMusic = {
    context: context,
    // The cinematic: cue the loop for an audio-clock time (its own t = 60 s), so it follows with no gap.
    cue: function (when) { if (!M.wanted) return; M.cue = when; context(); begin(when, 0); },
    cancelCue: function () { if (M.cue != null) stop(0.2); M.cue = null; },
    // Keep quiet while the cinematic plays (unless it has cued us for its last moment).
    hold: function (on) { M.held = !!on; if (on && M.cue == null && M.playing) stop(0.3); },
    startNow: startNow,
    // tetris.js reports every screen change: the menu screens keep the loop; a game stops it with a sound.
    screen: function (id) {
      var menu = !!MENU_SCREENS[id];
      if (menu === M.onMenu) return;
      M.onMenu = menu;
      if (!menu) { if (M.playing) startSound(); stop(0.4); if (window.TetrisBG) window.TetrisBG.setEnergy(0); }
      else startNow(1.8);
      paint();
    },
    level: level
  };

  function init() {
    buildButton();
    // Returning visitors (no cinematic): start on the menu, or as soon as the browser allows audio.
    setTimeout(function () {
      var cine = window.TetrisCinematic && window.TetrisCinematic.playing && window.TetrisCinematic.playing();
      if (!cine && M.onMenu) startNow(2);
    }, 0);
  }

  init();
})();
