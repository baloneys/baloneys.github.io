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

  function beep(freq, dur, type, vol) {
    if (muted) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      g.gain.value = vol == null ? 0.05 : vol;
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + (dur || 0.08));
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + (dur || 0.08));
    } catch (e) {}
  }

  var Sound = {
    beep: beep,
    isMuted: function () { return muted; },
    toggle: function () { muted = !muted; Store.set('muted', muted); return muted; },
    bindButton: function (btn) {
      function paint() { btn.textContent = muted ? '🔇 Sound off' : '🔊 Sound on'; }
      paint();
      btn.addEventListener('click', function () { Sound.toggle(); paint(); });
    }
  };

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
