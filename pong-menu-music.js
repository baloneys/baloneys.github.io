// Menu soundtrack and the sample-clock hand-off from the Pong cinematic.
// The decoded Ogg loops without encoder padding; gameplay never owns this audio source.
(function () {
  'use strict';
  var G = window.Games;
  if (!G) return;
  var FILE = 'Balcade_Pong_Menu_Seamless_Loop.ogg';
  var LENGTH = 13.7142857, VOLUME = 0.54, KEY = 'pong_menu_music';
  var MENUS = { menuPanel: 1, onlinePanel: 1, lobbyPanel: 1 };
  var M = { ctx: null, gain: null, analyser: null, bins: null, buffer: null, loading: false,
    source: null, pending: null, cueAt: null, playing: false, held: false, onMenu: true,
    wanted: G.Store.get(KEY, 'on') !== 'off', button: null, raf: 0, level: 0, average: 0 };

  function decode() {
    if (M.loading || M.buffer || !M.ctx) return;
    M.loading = true;
    fetch(FILE).then(function (r) { if (!r.ok) throw new Error('Menu loop HTTP ' + r.status); return r.arrayBuffer(); })
      .then(function (data) { return M.ctx.decodeAudioData(data); })
      .then(function (buffer) {
        M.buffer = buffer; M.loading = false;
        if (M.pending) { var pending = M.pending; M.pending = null; begin(pending.when, pending.fade); }
      }).catch(function (e) { M.loading = false; console.warn('[pong-menu-music]', e); });
  }
  function context() {
    if (M.ctx) return M.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { M.ctx = new AC(); } catch (e) { return null; }
    M.gain = M.ctx.createGain(); M.gain.gain.value = 0;
    M.analyser = M.ctx.createAnalyser(); M.analyser.fftSize = 256;
    M.analyser.smoothingTimeConstant = 0.65;
    M.bins = new Uint8Array(M.analyser.frequencyBinCount);
    M.gain.connect(M.analyser); M.analyser.connect(M.ctx.destination);
    decode();
    return M.ctx;
  }
  function paint() {
    if (!M.button) return;
    M.button.hidden = !M.onMenu;
    M.button.classList.toggle('live', M.playing && M.wanted);
    M.button.classList.toggle('off', !M.wanted);
    M.button.setAttribute('aria-pressed', String(M.wanted));
    M.button.querySelector('span:last-child').textContent = M.wanted ? 'Music on' : 'Music off';
  }
  function begin(when, fade) {
    if (!M.wanted || !M.onMenu || (M.held && M.cueAt == null)) return;
    var ctx = context();
    if (!ctx) return;
    if (!M.buffer) { M.pending = { when: when, fade: fade }; decode(); return; }
    var now = ctx.currentTime;
    // A late decode resumes at the corresponding point in the loop, keeping the cue's phase.
    var offset = M.cueAt != null && when < now ? (now - when) % LENGTH : 0;
    when = Math.max(when, now + 0.025);
    if (M.source) { try { M.source.stop(when); } catch (e) {} }
    var source = ctx.createBufferSource();
    source.buffer = M.buffer; source.loop = true; source.loopStart = 0;
    source.loopEnd = Math.min(LENGTH, M.buffer.duration);
    source.connect(M.gain); source.start(when, offset);
    M.source = source; M.playing = true;
    var gain = M.gain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(fade ? 0 : VOLUME, Math.max(now, when - 0.005));
    if (fade) gain.linearRampToValueAtTime(VOLUME, when + fade);
    paint(); tick();
  }
  function stop(fade) {
    M.pending = null; M.cueAt = null;
    if (M.ctx && M.source) {
      var now = M.ctx.currentTime, gain = M.gain.gain;
      fade = fade == null ? 0.35 : fade;
      gain.cancelScheduledValues(now); gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0, now + fade);
      try { M.source.stop(now + fade + 0.04); } catch (e) {}
      M.source = null;
    }
    M.playing = false;
    if (M.raf) cancelAnimationFrame(M.raf);
    M.raf = 0; M.level = 0;
    if (window.PongBG && M.onMenu) window.PongBG.rally(0);
    paint();
  }
  var armed = false;
  function armUnlock() {
    if (armed) return;
    armed = true;
    function unlock() {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      armed = false;
      if (M.ctx) M.ctx.resume().then(function () { if (!M.playing) startNow(1); });
    }
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
  }
  function startNow(fade) {
    if (!M.wanted || !M.onMenu || M.held) return;
    var ctx = context();
    if (!ctx) return;
    if (ctx.state === 'suspended') { ctx.resume(); armUnlock(); }
    if (!M.playing) begin(ctx.currentTime + 0.06, fade == null ? 1.4 : fade);
  }
  function startSound() {
    if (G.Sound && G.Sound.isMuted && G.Sound.isMuted()) return;
    var ctx = context(); if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    var at = ctx.currentTime + 0.035;
    [330, 660, 990].forEach(function (frequency, i) {
      var osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = i ? 'square' : 'sawtooth';
      osc.frequency.setValueAtTime(frequency, at + i * 0.09);
      osc.frequency.exponentialRampToValueAtTime(frequency * 1.4, at + i * 0.09 + 0.2);
      gain.gain.setValueAtTime(0.0001, at + i * 0.09);
      gain.gain.linearRampToValueAtTime(0.04, at + i * 0.09 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.09 + 0.22);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(at + i * 0.09); osc.stop(at + i * 0.09 + 0.23);
    });
  }
  function tick() {
    if (M.raf) return;
    M.raf = requestAnimationFrame(function frame() {
      M.raf = 0;
      if (!M.playing || !M.onMenu) return;
      M.analyser.getByteFrequencyData(M.bins);
      var sum = 0;
      for (var i = 1; i < 12; i++) sum += M.bins[i];
      var value = sum / (11 * 255);
      M.level += (value - M.level) * 0.22;
      M.average += (value - M.average) * 0.025;
      var BG = window.PongBG;
      if (BG && !document.documentElement.classList.contains('pong-cine-open')) {
        BG.rally(Math.round(M.level * 42));
        if (value - M.average > 0.13) BG.point();
      }
      M.raf = requestAnimationFrame(frame);
    });
  }
  function buildButton() {
    var button = document.createElement('button');
    button.className = 'pong-music-btn'; button.type = 'button';
    button.title = 'Menu music — Space Adventure by MintoDog (CC0)';
    button.setAttribute('aria-label', 'Pong menu music');
    button.innerHTML = '<span class="pong-music-eq" aria-hidden="true">▮▮▮</span><span></span>';
    button.addEventListener('click', function () {
      M.wanted = !M.wanted;
      G.Store.set(KEY, M.wanted ? 'on' : 'off');
      if (M.wanted) { M.held = false; startNow(0.7); } else stop(0.35);
      paint();
    });
    document.body.appendChild(button); M.button = button; paint();
  }
  window.PongMenuMusic = {
    context: context,
    cue: function (when) { if (!M.wanted) return; M.cueAt = when; context(); begin(when, 0); },
    cancelCue: function () { if (M.cueAt != null) stop(0.15); M.cueAt = null; },
    hold: function (held) { M.held = !!held; if (held && M.cueAt == null && M.playing) stop(0.3); },
    startNow: startNow,
    screen: function (id) {
      var menu = !!MENUS[id];
      if (menu === M.onMenu) return;
      M.onMenu = menu;
      if (!menu) { if (id === 'gameView') startSound(); stop(0.35); }
      else startNow(1.5);
      paint();
    }
  };
  buildButton();
  context(); // preload before the 60-second cue
  setTimeout(function () {
    if (!(window.PongCinematic && window.PongCinematic.playing())) startNow(1.5);
  }, 0);
})();
