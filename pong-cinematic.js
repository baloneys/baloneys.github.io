// Pong's 60-second in-page trailer. Shot artwork is in pong-cinematic-scenes.js;
// the menu loop and its control are in pong-menu-music.js.
(function () {
  'use strict';
  var G = window.Games, App = window.PongApp;
  if (!G || !App || !App.cinematicKit || !window.PongCinematicScenes) return;
  var SEEN = 'pong_cinematic_seen', LENGTH = 60;
  var Cine = { root: null, stage: null, scenes: null, running: false, raf: 0, t: 0,
    previous: 0, start: 0, hold: null, soundWanted: true, closing: false };
  var Audio = { ctx: null, gain: null, analyser: null, bins: null, buffer: null, source: null,
    on: false, base: 0, offset: 0, level: 0, loading: false };
  function clamp(v) { return Math.max(0, Math.min(1, v)); }
  function span(t, a, b) { return clamp((t - a) / (b - a)); }
  function ease(t) { t = clamp(t); return t * t * (3 - 2 * t); }

  function initAudio() {
    if (Audio.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var shared = window.PongMenuMusic && window.PongMenuMusic.context();
    try { Audio.ctx = shared || new AC(); } catch (e) { return; }
    Audio.gain = Audio.ctx.createGain(); Audio.gain.gain.value = .88;
    Audio.analyser = Audio.ctx.createAnalyser(); Audio.analyser.fftSize = 256;
    Audio.analyser.smoothingTimeConstant = .6;
    Audio.bins = new Uint8Array(Audio.analyser.frequencyBinCount);
    Audio.gain.connect(Audio.analyser); Audio.analyser.connect(Audio.ctx.destination);
    Audio.loading = true;
    fetch('Balcade_Pong_60s_Master.mp3').then(function (r) {
      if (!r.ok) throw new Error('Cinematic soundtrack HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (data) { return Audio.ctx.decodeAudioData(data); })
      .then(function (buffer) { Audio.buffer = buffer; Audio.loading = false; if (Audio.on && Cine.running) startAudio(Cine.t); })
      .catch(function (e) { Audio.loading = false; console.warn('[pong-cinematic]', e); });
  }
  function stopAudio(fade, keepLoop) {
    if (!keepLoop && window.PongMenuMusic) window.PongMenuMusic.cancelCue();
    Audio.on = false;
    if (!Audio.ctx || !Audio.source) return;
    var now = Audio.ctx.currentTime, gain = Audio.gain.gain, source = Audio.source;
    gain.cancelScheduledValues(now); gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + fade);
    try { source.stop(now + fade + .05); } catch (e) {}
    Audio.source = null;
  }
  function startAudio(t) {
    initAudio();
    if (!Audio.ctx) return;
    if (Audio.ctx.state === 'suspended') Audio.ctx.resume();
    if (Audio.source) { try { Audio.source.stop(); } catch (e) {} Audio.source = null; }
    Audio.on = true;
    if (!Audio.buffer) return;
    var ctx = Audio.ctx, at = ctx.currentTime + .06;
    var source = ctx.createBufferSource(); source.buffer = Audio.buffer;
    source.connect(Audio.gain);
    var gain = Audio.gain.gain;
    gain.cancelScheduledValues(ctx.currentTime); gain.setValueAtTime(0, ctx.currentTime);
    gain.linearRampToValueAtTime(.88, at + .2);
    source.start(at, Math.min(t, Math.max(0, Audio.buffer.duration - .1)));
    source.stop(at + Math.max(.1, LENGTH - t) + .06);
    Audio.source = source; Audio.base = at; Audio.offset = t;
    if (window.PongMenuMusic && t < LENGTH) window.PongMenuMusic.cue(at + LENGTH - t);
  }
  function audioTime() {
    if (!Audio.on || !Audio.buffer || !Audio.ctx || Audio.ctx.state !== 'running') return null;
    return Audio.offset + Math.max(0, Audio.ctx.currentTime - Audio.base);
  }
  function audioLevel() {
    if (!Audio.on || !Audio.buffer || !Audio.analyser) return 0;
    Audio.analyser.getByteFrequencyData(Audio.bins);
    var total = 0; for (var i = 1; i < 14; i++) total += Audio.bins[i];
    Audio.level += (total / (13 * 255) - Audio.level) * .24;
    return Audio.level;
  }
  function sound(on) {
    Cine.soundWanted = !!on;
    var button = Cine.root && Cine.root.querySelector('.pong-cine-sound');
    var hint = Cine.root && Cine.root.querySelector('.pong-cine-hint');
    if (button) button.textContent = on ? 'Sound on' : 'Sound off';
    if (hint) hint.hidden = !on || (Audio.ctx && Audio.ctx.state === 'running' && Audio.buffer);
    if (on) startAudio(Cine.t);
    else stopAudio(.15, false);
  }
  function build() {
    var root = document.createElement('div');
    root.className = 'pong-cine'; root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Pong opening cinematic');
    root.innerHTML = '<canvas class="pong-cine-stage" aria-hidden="true"></canvas>' +
      '<div class="pong-cine-bloom" aria-hidden="true"></div><div class="pong-cine-vhs" aria-hidden="true"></div>' +
      '<div class="pong-cine-bar top" aria-hidden="true"></div><div class="pong-cine-bar bottom" aria-hidden="true"></div>' +
      '<div class="pong-cine-ui"><span class="pong-cine-credit">Music: Space Adventure · MintoDog · CC0</span>' +
      '<div class="pong-cine-actions"><button class="pong-cine-hint" type="button">Click for sound</button>' +
      '<button class="pong-cine-sound" type="button">Sound on</button>' +
      '<button class="pong-cine-skip" type="button">Skip cinematic</button></div></div>';
    document.body.appendChild(root);
    Cine.root = root; Cine.stage = root.querySelector('canvas');
    Cine.scenes = window.PongCinematicScenes(Cine.stage, App.cinematicKit());
    root.querySelector('.pong-cine-skip').addEventListener('click', function () { finish(true); });
    root.querySelector('.pong-cine-sound').addEventListener('click', function (e) { e.stopPropagation(); sound(!Cine.soundWanted); });
    root.querySelector('.pong-cine-hint').addEventListener('click', function (e) { e.stopPropagation(); sound(true); });
    root.addEventListener('pointerdown', function () { if (Cine.soundWanted && (!Audio.ctx || Audio.ctx.state !== 'running')) sound(true); });
  }
  function onKey(e) {
    if (!Cine.running) return;
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
    else if (Cine.soundWanted && (!Audio.ctx || Audio.ctx.state !== 'running')) sound(true);
  }
  function frame(now) {
    if (!Cine.running) return;
    var fromAudio = audioTime();
    var next = Cine.hold == null ? (fromAudio == null ? (now - Cine.start) / 1000 : fromAudio) : Cine.hold;
    Cine.t = Math.min(LENGTH, Math.max(0, next));
    var dt = Math.max(.001, Math.min(.033, (now - Cine.previous) / 1000));
    Cine.previous = now;
    Cine.scenes.draw(Cine.t, dt, audioLevel());
    // The actual Pong menu is directly underneath the final dissolve.
    if (Cine.t >= 57.8) {
      Cine.root.classList.add('letting-go');
      Cine.root.style.opacity = String(1 - ease(span(Cine.t, 58.1, 59.95)));
    }
    if (Cine.t >= LENGTH && Cine.hold == null) { finish(false); return; }
    Cine.raf = requestAnimationFrame(frame);
  }
  function play(at) {
    if (Cine.running) return;
    G.Store.set(SEEN, Date.now());
    window.scrollTo(0, 0); build();
    Cine.running = true; Cine.closing = false; Cine.t = Math.max(0, +at || 0);
    Cine.start = performance.now() - Cine.t * 1000; Cine.previous = performance.now(); Cine.hold = null;
    document.documentElement.classList.add('pong-cine-open');
    if (window.PongMenuMusic) window.PongMenuMusic.hold(true);
    document.addEventListener('keydown', onKey, true);
    initAudio(); sound(!(G.Sound && G.Sound.isMuted && G.Sound.isMuted()));
    Cine.root.querySelector('.pong-cine-skip').focus({ preventScroll: true });
    Cine.raf = requestAnimationFrame(frame);
  }
  function finish(skipped) {
    if (!Cine.running || Cine.closing) return;
    Cine.closing = true; Cine.running = false;
    cancelAnimationFrame(Cine.raf);
    stopAudio(skipped ? .22 : .08, !skipped);
    if (window.PongMenuMusic) { window.PongMenuMusic.hold(false); window.PongMenuMusic.startNow(skipped ? 1 : .2); }
    document.removeEventListener('keydown', onKey, true);
    document.documentElement.classList.remove('pong-cine-open');
    var root = Cine.root;
    root.classList.add('closing');
    setTimeout(function () { if (Cine.scenes && Cine.scenes.dispose) Cine.scenes.dispose(); root.remove(); }, skipped ? 350 : 80);
    if (skipped) { var replay = document.getElementById('pongCinematicBtn'); if (replay) replay.focus({ preventScroll: true }); }
  }
  window.PongCinematic = { play: play, skip: function () { finish(true); }, playing: function () { return Cine.running; } };
  var button = document.getElementById('pongCinematicBtn');
  if (button) button.addEventListener('click', function () { play(0); });
  var forced = location.search.match(/[?&]cinematic(?:=(\d+(?:\.\d+)?))?(?:&|$)/);
  if (forced) {
    play(forced[1] || 0);
    var hold = location.search.match(/[?&]hold=(\d+(?:\.\d+)?)/);
    if (hold) setTimeout(function () { Cine.hold = +hold[1]; sound(false); }, Math.max(0, (+hold[1] - (+forced[1] || 0)) * 1000));
  } else if (!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) && !G.Store.get(SEEN, null)) play(0);
})();
