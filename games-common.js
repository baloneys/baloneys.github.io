// games-common.js: shared helpers for Pong, Tetris and Battleships.
// Online play is peer-to-peer over PeerJS (loaded by each game page).
(function () {
  'use strict';

  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function randomCode(len) {
    var out = '';
    var buf = new Uint32Array(len || 5);
    crypto.getRandomValues(buf);
    for (var i = 0; i < buf.length; i++) out += CODE_CHARS[buf[i] % CODE_CHARS.length];
    return out;
  }

  function cleanCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  /* ---------- storage ---------- */

  var Store = {
    get: function (key, fallback) {
      try {
        var v = localStorage.getItem('games_' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem('games_' + key, JSON.stringify(value)); } catch (e) {}
    }
  };

  /* ---------- sound ---------- */

  var audioCtx = null;
  var muted = Store.get('muted', false);

  // 8-bit sound, NES style: pulse waves with a chunky duty cycle, a triangle channel,
  // a noise channel, pitches snapped to real notes, and volume stepped at 60 Hz.
  var pulseWaves = {};
  var noiseBuffer = null;

  function ctxReady() {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function pulseWave(duty) {
    if (pulseWaves[duty]) return pulseWaves[duty];
    var n = 64, real = new Float32Array(n), imag = new Float32Array(n);
    // Fourier series of a pulse wave with the given duty cycle
    for (var k = 1; k < n; k++) real[k] = (4 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    pulseWaves[duty] = audioCtx.createPeriodicWave(real, imag);
    return pulseWaves[duty];
  }

  function noise() {
    if (noiseBuffer) return noiseBuffer;
    // Low-rate, 1-bit-ish noise like the NES noise channel
    var len = audioCtx.sampleRate, buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate), d = buf.getChannelData(0);
    var hold = 0, v = 0;
    for (var i = 0; i < len; i++) {
      if (hold-- <= 0) { v = Math.random() < 0.5 ? -1 : 1; hold = 6; }
      d[i] = v;
    }
    noiseBuffer = buf;
    return buf;
  }

  function snap(freq) {
    var n = Math.round(12 * Math.log2(freq / 440));
    return 440 * Math.pow(2, n / 12);
  }

  // Volume envelope in 16 steps, updated every 1/60 s.
  function stepEnvelope(gain, t0, dur, vol) {
    var frames = Math.max(1, Math.round(dur * 60));
    for (var f = 0; f <= frames; f++) {
      var level = Math.round(15 * (1 - f / frames)) / 15;
      gain.gain.setValueAtTime(vol * level, t0 + f / 60);
    }
    gain.gain.setValueAtTime(0, t0 + dur + 1 / 60);
  }

  function tone(freq, t0, dur, wave, vol) {
    var o = audioCtx.createOscillator(), g = audioCtx.createGain();
    if (wave === 'triangle') o.type = 'triangle';
    else o.setPeriodicWave(pulseWave(wave === 'pulse12' ? 0.125 : wave === 'pulse50' ? 0.5 : 0.25));
    o.frequency.setValueAtTime(snap(freq), t0);
    stepEnvelope(g, t0, dur, vol);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  function noiseBurst(t0, dur, vol) {
    var src = audioCtx.createBufferSource(), g = audioCtx.createGain();
    src.buffer = noise();
    stepEnvelope(g, t0, dur, vol);
    src.connect(g);
    g.connect(audioCtx.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // Same signature the games already use; `type` picks the 8-bit voice.
  function beep(freq, dur, type, vol) {
    if (muted) return;
    try {
      ctxReady();
      var t0 = audioCtx.currentTime + 0.005;
      dur = dur || 0.08;
      vol = (vol == null ? 0.05 : vol) * 1.4;
      if (type === 'sawtooth') {
        // crunchy loss / explosion: noise plus a falling pulse
        noiseBurst(t0, dur, vol);
        var o = tone(freq, t0, dur, 'pulse12', vol * 0.6);
        o.frequency.setValueAtTime(snap(freq), t0);
        for (var f = 1; f <= Math.round(dur * 60); f++) o.frequency.setValueAtTime(snap(freq * Math.pow(0.94, f)), t0 + f / 60);
        return;
      }
      var wave = type === 'triangle' ? 'triangle' : type === 'sine' ? 'pulse50' : 'pulse25';
      if (dur >= 0.2) {
        // longer sounds become a quick major arpeggio
        var steps = [1, 1.26, 1.5, 2], each = dur / 4;
        steps.forEach(function (k, i) { tone(freq * k, t0 + i * each, each, wave, vol); });
      } else {
        tone(freq, t0, dur, wave, vol);
      }
    } catch (e) {}
  }

  var Sound = {
    beep: beep,
    isMuted: function () { return muted; },
    toggle: function () { muted = !muted; Store.set('muted', muted); return muted; },
    bindButton: function (btn) {
      function paint() { btn.textContent = muted ? 'Sound off' : 'Sound on'; }
      paint();
      btn.addEventListener('click', function () { Sound.toggle(); paint(); });
    }
  };


  /* ---------- images ---------- */

  // Reads an image file into a data URL, resized so its longest side is `max`.
  // square: centre-crop to a square. keepGif: pass animated GIFs through untouched (size-limited).
  function readImageFile(file, max, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('That file isn\'t an image'));
      if (file.type === 'image/gif' && opts.keepGif) {
        if (file.size > (opts.maxGifBytes || 900 * 1024)) return reject(new Error('GIFs can be up to ' + Math.round((opts.maxGifBytes || 900 * 1024) / 1024) + ' KB'));
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { reject(new Error('Couldn\'t read that file')); };
        return fr.readAsDataURL(file);
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'), ctx = c.getContext('2d');
        if (opts.square) {
          var s = Math.min(img.width, img.height);
          c.width = c.height = Math.min(max, s);
          ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, c.width, c.height);
        } else {
          var k = Math.min(1, max / Math.max(img.width, img.height));
          c.width = Math.max(1, Math.round(img.width * k));
          c.height = Math.max(1, Math.round(img.height * k));
          ctx.drawImage(img, 0, 0, c.width, c.height);
        }
        URL.revokeObjectURL(url);
        resolve(opts.png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Couldn\'t read that image')); };
      img.src = url;
    });
  }

  function pickFile(accept) {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || 'image/*';
      input.onchange = function () { resolve(input.files && input.files[0]); };
      input.click();
    });
  }

  /* ---------- player profile (name + picture), shared by all games ---------- */

  var AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

  var Profile = {
    sanitize: function (p) {
      p = p || {};
      var name = String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 16);
      var avatar = typeof p.avatar === 'string' && p.avatar.length < 40000 && AVATAR_RE.test(p.avatar) ? p.avatar : null;
      return { name: name || 'Player', avatar: avatar };
    },
    // Each tab keeps its own copy, so two open tabs don't overwrite each other mid-game.
    get: function () { if (!Profile._cur) Profile._cur = Profile.sanitize(Store.get('profile', {})); return Profile._cur; },
    set: function (p) { Profile._cur = Profile.sanitize(p); Store.set('profile', Profile._cur); },

    // A round avatar element: the picture, or the first letter of the name.
    avatar: function (p, size) {
      p = Profile.sanitize(p);
      var el = document.createElement('span');
      el.className = 'avatar';
      if (size) { el.style.width = el.style.height = size + 'px'; el.style.fontSize = Math.round(size * 0.42) + 'px'; }
      if (p.avatar) {
        var img = document.createElement('img');
        img.src = p.avatar;
        img.alt = '';
        el.appendChild(img);
      } else {
        el.textContent = p.name.charAt(0).toUpperCase();
      }
      return el;
    },

    // Name + picture editor for the online "join" panels.
    mount: function (container, onChange) {
      container.textContent = '';
      container.className = 'profile-editor';
      var p = Object.assign({}, Profile.get());

      var pic = document.createElement('button');
      pic.type = 'button';
      pic.className = 'profile-pic';
      pic.title = 'Choose a profile picture';

      var side = document.createElement('div');
      side.className = 'profile-fields';
      var label = document.createElement('label');
      label.className = 'option-label';
      label.textContent = 'Your name and picture';
      var name = document.createElement('input');
      name.className = 'text-input';
      name.maxLength = 16;
      name.placeholder = 'Player';
      name.value = p.name === 'Player' ? '' : p.name;
      name.setAttribute('aria-label', 'Your name');
      var row = document.createElement('div');
      row.className = 'profile-actions';
      var upload = document.createElement('button');
      upload.type = 'button';
      upload.className = 'btn btn-sm btn-outline';
      upload.textContent = 'Upload picture';
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-sm btn-outline';
      remove.textContent = 'Remove';
      row.appendChild(upload);
      row.appendChild(remove);
      side.appendChild(label);
      side.appendChild(name);
      side.appendChild(row);
      container.appendChild(pic);
      container.appendChild(side);

      function paint() {
        pic.textContent = '';
        pic.appendChild(Profile.avatar(p, 64));
        remove.classList.toggle('hidden', !p.avatar);
      }
      function save() { Profile.set(p); p = Object.assign({}, Profile.get()); paint(); if (onChange) onChange(Profile.get()); }
      function choose() {
        pickFile('image/*').then(function (file) {
          if (!file) return;
          return readImageFile(file, 96, { square: true }).then(function (data) { p.avatar = data; save(); });
        }).catch(function (err) { banner(err.message); });
      }
      pic.addEventListener('click', choose);
      upload.addEventListener('click', choose);
      remove.addEventListener('click', function () { p.avatar = null; save(); });
      name.addEventListener('input', function () { p.name = name.value; Profile.set(p); if (onChange) onChange(Profile.get()); paint(); });
      paint();
    }
  };

  // A lobby row: avatar, name, status text.
  function lobbyRow(profile, label, status, statusClass) {
    var li = document.createElement('li');
    var who = document.createElement('span');
    who.className = 'lobby-who';
    if (profile) who.appendChild(Profile.avatar(profile, 28));
    var n = document.createElement('span');
    n.textContent = label;
    who.appendChild(n);
    var st = document.createElement('span');
    st.className = statusClass || 'waiting';
    st.textContent = status || '';
    li.appendChild(who);
    li.appendChild(st);
    return li;
  }

  /* ---------- UI helpers ---------- */

  function banner(text) {
    var b = document.createElement('div');
    b.className = 'toast-banner';
    b.textContent = text;
    document.body.appendChild(b);
    setTimeout(function () { b.remove(); }, 1900);
  }

  // Chip groups: <div data-chips="name"><button class="chip" data-value="…">
  function chips(container, initial, onChange) {
    var buttons = Array.prototype.slice.call(container.querySelectorAll('.chip'));
    var value = initial;
    function paint() { buttons.forEach(function (b) { b.classList.toggle('active', b.dataset.value === String(value)); }); }
    buttons.forEach(function (b) {
      b.type = 'button';
      b.addEventListener('click', function () {
        value = b.dataset.value;
        paint();
        if (onChange) onChange(value);
      });
    });
    paint();
    return { get: function () { return value; }, set: function (v) { value = String(v); paint(); } };
  }

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function copyText(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { banner('Copied ' + text); }, function () {});
  }

  /* ---------- networking ---------- */

  function peerErrorText(err) {
    var t = err && err.type;
    if (t === 'peer-unavailable') return 'No lobby with that code. Check it and try again.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Couldn\'t reach the matchmaking server. Your network may block it.';
    if (t === 'browser-incompatible') return 'This browser doesn\'t support online play.';
    return (err && err.message) || 'Connection error';
  }

  function peerAvailable() { return typeof window.Peer === 'function'; }

  // Close connections when the tab goes away so the other side finds out straight away.
  var liveSessions = [];
  window.addEventListener('pagehide', function () {
    liveSessions.forEach(function (s) { try { s.close(); } catch (e) {} });
  });
  function track(session) {
    liveSessions.push(session);
    var close = session.close;
    session.close = function () {
      var i = liveSessions.indexOf(session);
      if (i !== -1) liveSessions.splice(i, 1);
      close();
    };
    return session;
  }

  // Host a lobby. Each guest gets its own DataConnection.
  function host(game, h) {
    if (!peerAvailable()) { h.onError && h.onError('Online play couldn\'t load on this network.'); return null; }
    var session = { peer: null, conns: [], code: null, closed: false };
    var attempts = 0;

    function start() {
      session.code = randomCode(5);
      var peer = new Peer('baloneys-' + game + '-' + session.code);
      session.peer = peer;
      peer.on('open', function () { h.onReady && h.onReady(session.code); });
      peer.on('connection', function (conn) {
        if (h.maxGuests && session.conns.length >= h.maxGuests) {
          conn.on('open', function () { conn.send({ t: 'full' }); setTimeout(function () { conn.close(); }, 300); });
          return;
        }
        conn.on('open', function () {
          session.conns.push(conn);
          h.onJoin && h.onJoin(conn);
        });
        conn.on('data', function (d) { h.onData && h.onData(conn, d); });
        conn.on('close', function () {
          var i = session.conns.indexOf(conn);
          if (i !== -1) session.conns.splice(i, 1);
          if (!session.closed) h.onLeave && h.onLeave(conn);
        });
        conn.on('error', function () {});
      });
      peer.on('error', function (err) {
        if (err && err.type === 'unavailable-id' && attempts++ < 4) { peer.destroy(); start(); return; }
        h.onError && h.onError(peerErrorText(err));
      });
    }

    start();
    session.send = function (conn, msg) { if (conn && conn.open) conn.send(msg); };
    session.broadcast = function (msg, except) {
      session.conns.forEach(function (c) { if (c !== except && c.open) c.send(msg); });
    };
    session.close = function () {
      session.closed = true;
      session.conns.forEach(function (c) { try { c.close(); } catch (e) {} });
      if (session.peer) session.peer.destroy();
    };
    return track(session);
  }

  // Join a lobby by code.
  function join(game, code, h) {
    if (!peerAvailable()) { h.onError && h.onError('Online play couldn\'t load on this network.'); return null; }
    var session = { peer: new Peer(), conn: null, closed: false };
    var timer = setTimeout(function () {
      if (!session.conn || !session.conn.open) { h.onError && h.onError('Couldn\'t connect. Check the code and try again.'); session.close(); }
    }, 12000);

    session.peer.on('open', function () {
      var conn = session.peer.connect('baloneys-' + game + '-' + cleanCode(code), { reliable: true });
      session.conn = conn;
      conn.on('open', function () { clearTimeout(timer); h.onOpen && h.onOpen(conn); });
      conn.on('data', function (d) {
        if (d && d.t === 'full') { h.onError && h.onError('That lobby is full.'); session.close(); return; }
        h.onData && h.onData(d);
      });
      conn.on('close', function () { if (!session.closed) h.onClose && h.onClose(); });
      conn.on('error', function () {});
    });
    session.peer.on('error', function (err) { clearTimeout(timer); h.onError && h.onError(peerErrorText(err)); });

    session.send = function (msg) { if (session.conn && session.conn.open) session.conn.send(msg); };
    session.close = function () {
      session.closed = true;
      clearTimeout(timer);
      try { if (session.conn) session.conn.close(); } catch (e) {}
      if (session.peer) session.peer.destroy();
    };
    return track(session);
  }

  /* ---------- easter egg (Pong + Tetris) ---------- */

  function chatEasterEgg() {
    var clicks = [];
    document.addEventListener('click', function (e) {
      if (e.target.closest('a, button, input, select, textarea, label, canvas, .stage, .panel, [contenteditable], .navigation-mobile-overlay')) return;
      var now = Date.now();
      clicks = clicks.filter(function (t) { return now - t < 800; }).concat(now);
      if (clicks.length >= 3) window.location.href = '/chat';
    });
  }

  window.Games = {
    Store: Store,
    Profile: Profile,
    lobbyRow: lobbyRow,
    readImageFile: readImageFile,
    pickFile: pickFile,
    Sound: Sound,
    banner: banner,
    chips: chips,
    show: show,
    hide: hide,
    copyText: copyText,
    cleanCode: cleanCode,
    Net: { host: host, join: join, available: peerAvailable },
    chatEasterEgg: chatEasterEgg
  };
})();
