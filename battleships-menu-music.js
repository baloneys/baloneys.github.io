// Battleships menu loop, scheduled on the cinematic's audio clock at 60 seconds.
(function () {
  'use strict';
  var G = window.Games;
  if (!G) return;
  var FILE = 'Balcade_Battleships_Seamless_Menu_Loop.ogg';
  var KEY = 'bs_menu_music';
  var M = { ctx: null, buffer: null, promise: null, source: null, gain: null, button: null,
    wanted: G.Store.get(KEY, 'on') !== 'off', held: false, menu: true, cueAt: null };
  function context() {
    if (M.ctx) return M.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { M.ctx = new AC(); M.gain = M.ctx.createGain(); M.gain.gain.value = 0; M.gain.connect(M.ctx.destination); }
    catch (e) { return null; }
    return M.ctx;
  }
  function load() {
    var ctx = context();
    if (!ctx) return Promise.resolve(null);
    if (!M.promise) M.promise = fetch(FILE).then(function (r) {
      if (!r.ok) throw new Error('Menu loop HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (data) { return ctx.decodeAudioData(data); }).then(function (b) { M.buffer = b; return b; })
      .catch(function (e) { console.warn('[battleships-menu-music]', e); return null; });
    return M.promise;
  }
  function paint() {
    if (!M.button) return;
    M.button.hidden = !M.menu;
    M.button.classList.toggle('live', !!M.source && M.wanted);
    M.button.setAttribute('aria-pressed', String(M.wanted));
    M.button.classList.toggle('off', !M.wanted);
    M.button.querySelector('span:last-child').textContent = M.wanted ? 'Music on' : 'Music off';
  }
  function stop(fade) {
    if (!M.source || !M.ctx) return;
    var now = M.ctx.currentTime, end = now + (fade == null ? .25 : fade);
    M.gain.gain.cancelScheduledValues(now);
    M.gain.gain.setValueAtTime(M.gain.gain.value, now);
    M.gain.gain.linearRampToValueAtTime(0, end);
    try { M.source.stop(end + .02); } catch (e) {}
    M.source = null;
    paint();
  }
  function start(when, fade) {
    if (!M.wanted || !M.menu || (M.held && M.cueAt == null)) return;
    var ctx = context(); if (!ctx) return;
    load().then(function (buffer) {
      if (!buffer || !M.wanted || !M.menu || (M.held && M.cueAt == null)) return;
      if (M.source) stop(0);
      var at = Math.max(ctx.currentTime + .025, when);
      var offset = when < at ? (at - when) % buffer.duration : 0;
      var source = ctx.createBufferSource();
      source.buffer = buffer; source.loop = true; source.loopStart = 0; source.loopEnd = buffer.duration;
      source.connect(M.gain); source.start(at, offset);
      M.source = source;
      M.gain.gain.cancelScheduledValues(ctx.currentTime);
      M.gain.gain.setValueAtTime(fade ? 0 : .5, at);
      if (fade) M.gain.gain.linearRampToValueAtTime(.5, at + fade);
      paint();
    });
  }
  function startNow(fade) {
    if (!M.wanted || !M.menu || M.held || M.source) return;
    var ctx = context(); if (!ctx) return;
    ctx.resume();
    start(ctx.currentTime + .04, fade == null ? 1 : fade);
  }
  window.BattleshipsMenuMusic = {
    context: context,
    hold: function (v) { M.held = !!v; if (v && !M.cueAt) stop(.15); },
    cue: function (at) { M.cueAt = at; if (M.wanted) start(at, 0); },
    cancelCue: function () { M.cueAt = null; stop(.12); },
    startNow: startNow,
    screen: function (id) { M.menu = /^(menuPanel|onlinePanel|lobbyPanel)$/.test(id); if (!M.menu) stop(.25); else startNow(1); paint(); }
  };
  // The same Music button as Tetris's and Pong's (tetris-menu-music.js): pill, bottom left, three bouncing bars.
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
    'html.bs-cine-open .tmm-btn{display:none}';
  document.head.appendChild(css);
  var button = document.createElement('button');
  button.type = 'button'; button.className = 'tmm-btn';
  button.title = 'Menu music: Shadow by William Hector (CC BY 4.0), edited for Balcade';
  button.setAttribute('aria-label', 'Menu music (Shadow by William Hector, CC BY 4.0)');
  button.innerHTML = '<span class="tmm-eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="tmm-label">Music on</span>';
  button.addEventListener('click', function () {
    M.wanted = !M.wanted; G.Store.set(KEY, M.wanted ? 'on' : 'off');
    if (M.wanted) { M.held = false; startNow(.5); } else stop(.15);
    paint();
  });
  document.body.appendChild(button); M.button = button; paint();
  load();
  document.addEventListener('pointerdown', function () { if (M.ctx && M.ctx.state === 'suspended') M.ctx.resume(); }, { passive: true });
  setTimeout(function () { if (!(window.BattleshipsCinematic && window.BattleshipsCinematic.playing())) startNow(1); }, 50);
})();
