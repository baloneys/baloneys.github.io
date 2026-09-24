// tetris.js: Tetris for kanaris-beans.com. Solo marathon, local versus, online (2–4 players, PeerJS).
(function () {
  'use strict';

  var G = window.Games;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* =================================================================
     Rules
     ================================================================= */

  var COLS = 10, ROWS = 20, CELL = 28, SIDE = 4;   // side panels are 4 cells wide
  var GARBAGE = 8;

  var BASE = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]]
  };
  var TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  var TYPE_ID = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };

  function rotateCW(m) {
    var n = m.length, out = [];
    for (var y = 0; y < n; y++) { out.push([]); for (var x = 0; x < n; x++) out[y][x] = m[n - 1 - x][y]; }
    return out;
  }

  // All four SRS rotation states, precomputed.
  var SHAPES = {};
  TYPES.forEach(function (t) {
    var s = [BASE[t]];
    for (var i = 1; i < 4; i++) s.push(rotateCW(s[i - 1]));
    SHAPES[t] = s;
  });

  // SRS wall kicks, (x, y) with y pointing up as in the guideline tables.
  var KICKS = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
  };
  var KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
  };

  var SKINS = [
    { name: 'Purple Dream', bottom: '#1e1b4b', top: '#c77dff' },
    { name: 'Ocean Blue', bottom: '#0c4a6e', top: '#38bdf8' },
    { name: 'Fire Red', bottom: '#7f1d1d', top: '#f87171' },
    { name: 'Neon Pink', bottom: '#500724', top: '#ff4fa3' },
    { name: 'Moonlight', bottom: '#27272a', top: '#e4e4e7' }
  ];

  var LINE_POINTS = [0, 100, 300, 500, 800];
  var ATTACK = [0, 0, 1, 2, 4];
  var LOCK_DELAY = 0.5, MAX_RESETS = 15;
  var DAS = 0.15, ARR = 0.04, SOFT_RATE = 0.035;

  function gravity(level) {
    return Math.max(0.02, Math.pow(0.8 - (level - 1) * 0.007, level - 1));
  }

  function mix(a, b, t) {
    var pa = [1, 3, 5].map(function (i) { return parseInt(a.substr(i, 2), 16); });
    var pb = [1, 3, 5].map(function (i) { return parseInt(b.substr(i, 2), 16); });
    return '#' + pa.map(function (v, i) { return Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0'); }).join('');
  }

  /* =================================================================
     Player
     ================================================================= */

  function Player(opts) {
    this.id = opts.id;
    this.name = opts.name;
    this.skin = opts.skin || 0;
    this.local = opts.local;          // controlled on this device
    this.controls = opts.controls;    // key map for local players
    this.lives = opts.lives;
    this.reset(true);
  }

  Player.prototype.reset = function (full) {
    this.board = [];
    for (var r = 0; r < ROWS; r++) this.board.push(new Array(COLS).fill(0));
    this.bag = [];
    this.queue = [];
    this.hold = null;
    this.canHold = true;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.fall = 0;
    this.combo = -1;
    this.b2b = false;
    this.incoming = 0;
    this.flash = 0;
    if (full) {
      this.score = 0;
      this.lines = 0;
      this.level = 1;
      this.alive = true;
      this.losses = 0;
    }
    this.fillQueue();
    this.spawn();
  };

  Player.prototype.fillQueue = function () {
    while (this.queue.length < 6) {
      if (!this.bag.length) {
        this.bag = TYPES.slice();
        for (var i = this.bag.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = this.bag[i]; this.bag[i] = this.bag[j]; this.bag[j] = t;
        }
      }
      this.queue.push(this.bag.pop());
    }
  };

  Player.prototype.spawn = function (type) {
    type = type || this.queue.shift();
    this.fillQueue();
    var size = SHAPES[type][0].length;
    this.piece = { type: type, rot: 0, x: Math.floor((COLS - size) / 2), y: type === 'I' ? -1 : 0 };
    this.lockTimer = 0;
    this.lockResets = 0;
    this.fall = 0;
    if (this.collides(this.piece.x, this.piece.y, 0)) {
      this.piece.y -= 1;
      if (this.collides(this.piece.x, this.piece.y, 0)) return false;
    }
    return true;
  };

  Player.prototype.cells = function (x, y, rot, type) {
    var m = SHAPES[type || this.piece.type][rot], out = [];
    for (var r = 0; r < m.length; r++) for (var c = 0; c < m.length; c++) if (m[r][c]) out.push([x + c, y + r]);
    return out;
  };

  Player.prototype.collides = function (x, y, rot) {
    var cs = this.cells(x, y, rot);
    for (var i = 0; i < cs.length; i++) {
      var cx = cs[i][0], cy = cs[i][1];
      if (cx < 0 || cx >= COLS || cy >= ROWS) return true;
      if (cy >= 0 && this.board[cy][cx]) return true;
    }
    return false;
  };

  Player.prototype.grounded = function () { return this.collides(this.piece.x, this.piece.y + 1, this.piece.rot); };

  Player.prototype.touched = function () {
    // Moving or rotating on the ground resets lock delay, up to a limit.
    if (this.grounded() && this.lockResets < MAX_RESETS) { this.lockTimer = 0; this.lockResets++; }
  };

  Player.prototype.move = function (dx) {
    if (!this.collides(this.piece.x + dx, this.piece.y, this.piece.rot)) {
      this.piece.x += dx;
      this.touched();
      return true;
    }
    return false;
  };

  Player.prototype.rotate = function (dir) {
    var p = this.piece;
    if (p.type === 'O') return;
    var to = (p.rot + dir + 4) % 4;
    var table = p.type === 'I' ? KICKS_I : KICKS;
    var kicks = table[p.rot + '>' + to];
    for (var i = 0; i < kicks.length; i++) {
      var nx = p.x + kicks[i][0], ny = p.y - kicks[i][1];
      if (!this.collides(nx, ny, to)) {
        p.x = nx; p.y = ny; p.rot = to;
        this.touched();
        G.Sound.beep(700, 0.03, 'square', 0.025);
        return;
      }
    }
  };

  Player.prototype.softDrop = function () {
    if (!this.grounded()) { this.piece.y++; this.score += 1; this.fall = 0; return true; }
    return false;
  };

  Player.prototype.ghostY = function () {
    var y = this.piece.y;
    while (!this.collides(this.piece.x, y + 1, this.piece.rot)) y++;
    return y;
  };

  Player.prototype.hardDrop = function () {
    var gy = this.ghostY();
    this.score += (gy - this.piece.y) * 2;
    this.piece.y = gy;
    return this.lock();
  };

  Player.prototype.holdPiece = function () {
    if (!this.canHold) return;
    var cur = this.piece.type;
    if (this.hold) {
      var h = this.hold;
      this.hold = cur;
      this.spawn(h);
    } else {
      this.hold = cur;
      this.spawn();
    }
    this.canHold = false;
    G.Sound.beep(520, 0.04, 'triangle', 0.03);
  };

  // Returns { cleared, attack, toppedOut }
  Player.prototype.lock = function () {
    var id = TYPE_ID[this.piece.type];
    var self = this;
    var above = false;
    this.cells(this.piece.x, this.piece.y, this.piece.rot).forEach(function (c) {
      if (c[1] < 0) above = true;
      else self.board[c[1]][c[0]] = id;
    });

    var cleared = 0;
    for (var r = ROWS - 1; r >= 0; r--) {
      if (this.board[r].every(function (v) { return v; })) {
        this.board.splice(r, 1);
        this.board.unshift(new Array(COLS).fill(0));
        cleared++;
        r++;
      }
    }

    var attack = 0;
    if (cleared) {
      this.combo++;
      var tetris = cleared === 4;
      var pts = LINE_POINTS[cleared] * this.level;
      if (tetris && this.b2b) pts = Math.floor(pts * 1.5);
      pts += 50 * Math.max(0, this.combo) * this.level;
      this.score += pts;
      attack = ATTACK[cleared] + (tetris && this.b2b ? 1 : 0) + Math.floor(Math.max(0, this.combo) / 2);
      this.b2b = tetris;
      this.lines += cleared;
      this.level = Math.floor(this.lines / 10) + 1;
      this.flash = 0.25;
      // Outgoing attack cancels garbage that's waiting for us first.
      var cancel = Math.min(attack, this.incoming);
      this.incoming -= cancel;
      attack -= cancel;
      G.Sound.beep(tetris ? 988 : 660 + cleared * 60, tetris ? 0.3 : 0.12, 'triangle', 0.06);
    } else {
      this.combo = -1;
      if (this.incoming) this.addGarbage(this.incoming);
      this.incoming = 0;
      G.Sound.beep(160, 0.03, 'square', 0.02);
    }

    this.canHold = true;
    var ok = this.spawn() && !above;
    return { cleared: cleared, attack: attack, toppedOut: !ok };
  };

  Player.prototype.addGarbage = function (n) {
    var hole = Math.floor(Math.random() * COLS);
    for (var i = 0; i < n; i++) {
      this.board.shift();
      var row = new Array(COLS).fill(GARBAGE);
      row[hole] = 0;
      this.board.push(row);
    }
    if (this.piece && this.collides(this.piece.x, this.piece.y, this.piece.rot)) this.piece.y = Math.max(-2, this.piece.y - n);
  };

  // Compact state for online sync
  Player.prototype.pack = function () {
    return {
      b: this.board.map(function (r) { return r.join(''); }).join(''),
      p: this.piece ? [this.piece.type, this.piece.rot, this.piece.x, this.piece.y] : null,
      h: this.hold,
      q: this.queue.slice(0, 5),
      s: this.score, l: this.lines, v: this.level, lv: this.lives, lo: this.losses, a: this.alive, i: this.incoming, sk: this.skin
    };
  };

  Player.prototype.unpack = function (d) {
    if (!d || typeof d.b !== 'string' || d.b.length !== COLS * ROWS) return;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) this.board[r][c] = +d.b[r * COLS + c] || 0;
    this.piece = d.p && SHAPES[d.p[0]] ? { type: d.p[0], rot: d.p[1] & 3, x: +d.p[2], y: +d.p[3] } : null;
    this.hold = SHAPES[d.h] ? d.h : null;
    this.queue = (d.q || []).filter(function (t) { return SHAPES[t]; });
    this.score = +d.s || 0; this.lines = +d.l || 0; this.level = +d.v || 1;
    this.losses = +d.lo || 0; this.alive = d.a !== false; this.incoming = +d.i || 0;
    this.skin = SKINS[d.sk] ? d.sk : 0;
  };

  /* =================================================================
     Game state
     ================================================================= */

  var settings = {
    mode: null,
    lives: G.Store.get('tetris_lives', '3'),
    skin: G.Store.get('tetris_skin', 0),
    name: G.Store.get('tetris_name', '')
  };

  var game = null;
  var raf = null, last = 0;
  var held = {};
  var best = G.Store.get('tetris_best', 0);

  var KEYS_SOLO = { left: ['arrowleft', 'a'], right: ['arrowright', 'd'], soft: ['arrowdown', 's'], cw: ['arrowup', 'w', 'x'], ccw: ['z', 'control'], hard: [' '], hold: ['c', 'shift'] };
  var KEYS_P1 = { left: ['a'], right: ['d'], soft: ['s'], cw: ['w'], ccw: ['r'], hard: ['q'], hold: ['e'] };
  var KEYS_P2 = { left: ['arrowleft'], right: ['arrowright'], soft: ['arrowdown'], cw: ['arrowup'], ccw: ['/'], hard: [' '], hold: ['enter'] };

  function livesValue() { return settings.lives === 'inf' ? Infinity : parseInt(settings.lives, 10); }

  /* ---------- screens ---------- */

  var SCREENS = ['menuPanel', 'onlinePanel', 'lobbyPanel', 'gameView'];
  function screen(id) { SCREENS.forEach(function (s) { $('#' + s).classList.toggle('hidden', s !== id); }); }

  function startGame(mode, players) {
    settings.mode = mode;
    game = { mode: mode, players: players, over: false, paused: false, startedAt: performance.now() };
    buildBoards();
    screen('gameView');
    hideOverlay();
    $('#help').innerHTML = helpText();
    $('#pauseBtn').classList.toggle('hidden', mode === 'online');
    G.show($('#touchPad'));
    $('#touchPad').classList.toggle('hidden', mode === 'local');
    last = performance.now();
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function helpText() {
    if (settings.mode === 'local') {
      return 'Left player: <kbd>A</kbd>/<kbd>D</kbd> move · <kbd>S</kbd> soft drop · <kbd>W</kbd> rotate · <kbd>Q</kbd> hard drop · <kbd>E</kbd> hold<br>' +
        'Right player: <kbd>←</kbd>/<kbd>→</kbd> move · <kbd>↓</kbd> soft drop · <kbd>↑</kbd> rotate · <kbd>Space</kbd> hard drop · <kbd>Enter</kbd> hold · <kbd>P</kbd> pause';
    }
    return '<kbd>←</kbd>/<kbd>→</kbd> move · <kbd>↓</kbd> soft drop · <kbd>↑</kbd>/<kbd>X</kbd> rotate · <kbd>Z</kbd> rotate back · <kbd>Space</kbd> hard drop · <kbd>C</kbd> hold' +
      (settings.mode === 'online' ? '' : ' · <kbd>P</kbd> pause');
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    held = {};
  }

  function quitToMenu() {
    stop();
    if (net.session) { net.session.close(); net.session = null; }
    net.role = null;
    game = null;
    renderMenuBest();
    screen('menuPanel');
  }

  /* ---------- boards ---------- */

  function buildBoards() {
    var wrap = $('#boards');
    wrap.textContent = '';
    wrap.className = 'boards n' + game.players.length;
    game.players.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'board-card' + (p.local ? ' mine' : '');
      var head = document.createElement('div');
      head.className = 'board-head';
      head.innerHTML = '<span class="board-name"></span><span class="board-lives"></span>';
      head.querySelector('.board-name').textContent = p.name;
      var cv = document.createElement('canvas');
      cv.width = (COLS + SIDE * 2) * CELL;
      cv.height = ROWS * CELL;
      var stats = document.createElement('div');
      stats.className = 'board-stats';
      card.appendChild(head);
      card.appendChild(cv);
      card.appendChild(stats);
      wrap.appendChild(card);
      p.ui = { card: card, canvas: cv, ctx: cv.getContext('2d'), stats: stats, lives: head.querySelector('.board-lives') };
    });
  }

  /* ---------- overlay ---------- */

  function overlay(title, text, buttons) {
    $('#overlayTitle').textContent = title;
    $('#overlayText').textContent = text || '';
    var box = $('#overlayActions');
    box.textContent = '';
    (buttons || []).forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ' + (b.primary ? 'btn-primary' : 'btn-outline');
      btn.textContent = b.label;
      btn.addEventListener('click', b.onClick);
      box.appendChild(btn);
    });
    G.show($('#overlay'));
  }

  function hideOverlay() { G.hide($('#overlay')); }

  function setPaused(p) {
    if (!game || game.over || game.mode === 'online') return;
    game.paused = p;
    held = {};
    if (p) overlay('Paused', 'Press P to resume', [
      { label: 'Resume', primary: true, onClick: function () { setPaused(false); } },
      { label: 'Quit', onClick: quitToMenu }
    ]);
    else { hideOverlay(); last = performance.now(); }
  }

  /* ---------- loop ---------- */

  function loop(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (game && !game.paused && !game.over) {
      game.players.forEach(function (p) { if (p.local && p.alive) stepPlayer(p, dt); });
      if (game.mode === 'online') netTick(now);
    }
    if (game) game.players.forEach(drawPlayer);
    raf = requestAnimationFrame(loop);
  }

  function pressed(p, action) {
    var list = p.controls[action];
    for (var i = 0; i < list.length; i++) if (held[list[i]]) return held[list[i]];
    return null;
  }

  function stepPlayer(p, dt) {
    // Auto-repeat for held left/right and soft drop.
    ['left', 'right'].forEach(function (dir) {
      var h = pressed(p, dir);
      if (!h) return;
      h.t += dt;
      if (h.t >= DAS) {
        h.r = (h.r || 0) + dt;
        while (h.r >= ARR) { h.r -= ARR; p.move(dir === 'left' ? -1 : 1); }
      }
    });
    var soft = pressed(p, 'soft');
    if (soft) {
      soft.r = (soft.r || 0) + dt;
      while (soft.r >= SOFT_RATE) { soft.r -= SOFT_RATE; p.softDrop(); }
    }

    if (p.grounded()) {
      p.lockTimer += dt;
      if (p.lockTimer >= LOCK_DELAY) afterLock(p, p.lock());
    } else {
      p.fall += dt;
      var g = gravity(p.level);
      while (p.fall >= g) {
        p.fall -= g;
        if (!p.grounded()) p.piece.y++;
        else break;
      }
    }
    if (p.flash) p.flash = Math.max(0, p.flash - dt);
  }

  function afterLock(p, res) {
    if (res.cleared === 4) announce(p.name + ' got a TETRIS!');
    if (res.attack) sendAttack(p, res.attack);
    if (res.toppedOut) toppedOut(p);
    if (game.mode === 'online') net.dirty = true;
  }

  function announce(text) {
    G.banner(text);
    if (game && game.mode === 'online') netSend({ t: 'ann', text: text });
  }

  function sendAttack(from, n) {
    if (game.mode === 'solo') return;
    var targets = game.players.filter(function (q) { return q !== from && q.alive; });
    if (!targets.length) return;
    var target = targets[Math.floor(Math.random() * targets.length)];
    if (game.mode === 'online') {
      netSend({ t: 'atk', to: target.id, n: n });
      if (target.local) target.incoming += n;
    } else {
      target.incoming += n;
    }
  }

  function toppedOut(p) {
    G.Sound.beep(140, 0.4, 'sawtooth', 0.06);
    if (game.mode === 'solo') return endSolo();
    p.losses++;
    if (p.losses >= p.lives) {
      p.alive = false;
      p.piece = null;
      G.banner(p.name + ' is out!');
    } else {
      var s = p.score;
      p.reset(false);
      p.score = Math.max(0, s - 1000);
      G.banner(p.name + ' lost a life');
    }
    if (game.mode === 'local') checkWinner();
  }

  function checkWinner() {
    var alive = game.players.filter(function (p) { return p.alive; });
    if (alive.length > 1) return;
    var winner = alive[0] || game.players.slice().sort(function (a, b) { return b.score - a.score; })[0];
    finishVersus(winner.name);
  }

  function finishVersus(winnerName, fromNet) {
    game.over = true;
    var scores = game.players.map(function (p) { return p.name + ': ' + p.score; }).join(' · ');
    G.Sound.beep(660, 0.5, 'triangle', 0.07);
    if (game.mode === 'online' && net.role === 'host' && !fromNet) netSend({ t: 'over', winner: winnerName });
    var buttons = [{ label: 'Menu', onClick: quitToMenu }];
    if (game.mode === 'local') buttons.unshift({ label: 'Play again', primary: true, onClick: function () { startLocal(); } });
    if (game.mode === 'online') buttons.unshift({ label: 'Back to lobby', primary: true, onClick: backToLobby });
    overlay(winnerName + ' wins!', scores, buttons);
  }

  function endSolo() {
    var p = game.players[0];
    game.over = true;
    var isBest = p.score > best;
    if (isBest) { best = p.score; G.Store.set('tetris_best', best); }
    overlay(isBest ? 'New best!' : 'Game over', p.score + ' points · ' + p.lines + ' lines · level ' + p.level + (isBest ? '' : ' · best ' + best), [
      { label: 'Play again', primary: true, onClick: startSolo },
      { label: 'Menu', onClick: quitToMenu }
    ]);
  }

  /* ---------- drawing ---------- */

  function blockColor(p, row) {
    var s = SKINS[p.skin] || SKINS[0];
    return mix(s.bottom, s.top, 1 - row / ROWS);
  }

  function drawBlock(ctx, x, y, size, color, alpha) {
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x + 3, y + 3, size - 6, Math.max(2, size * 0.18));
    ctx.globalAlpha = 1;
  }

  function drawMini(ctx, type, cx, cy, size, color) {
    var m = SHAPES[type][0];
    var minR = 9, maxR = -1, minC = 9, maxC = -1;
    for (var r = 0; r < m.length; r++) for (var c = 0; c < m.length; c++) if (m[r][c]) {
      minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c);
    }
    var w = (maxC - minC + 1) * size, h = (maxR - minR + 1) * size;
    for (r = minR; r <= maxR; r++) for (c = minC; c <= maxC; c++) if (m[r][c]) {
      drawBlock(ctx, cx - w / 2 + (c - minC) * size, cy - h / 2 + (r - minR) * size, size, color);
    }
  }

  function drawPlayer(p) {
    if (!p.ui) return;
    var ctx = p.ui.ctx, ox = SIDE * CELL;
    var W = p.ui.canvas.width, H = p.ui.canvas.height;
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, W, H);

    // side panels
    ctx.fillStyle = '#0d0a12';
    ctx.fillRect(0, 0, ox, H);
    ctx.fillRect(ox + COLS * CELL, 0, SIDE * CELL, H);
    ctx.fillStyle = '#8a7fa8';
    ctx.font = '700 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('HOLD', ox / 2, 22);
    ctx.fillText('NEXT', ox + COLS * CELL + ox / 2, 22);
    if (p.hold) drawMini(ctx, p.hold, ox / 2, 64, 20, p.canHold ? blockColor(p, 6) : '#3a3350');
    p.queue.slice(0, 5).forEach(function (t, i) {
      drawMini(ctx, t, ox + COLS * CELL + ox / 2, 64 + i * 66, i === 0 ? 20 : 16, blockColor(p, 6 + i));
    });

    // incoming garbage meter
    if (p.incoming) {
      var mh = Math.min(ROWS, p.incoming) * CELL;
      ctx.fillStyle = '#e60065';
      ctx.fillRect(ox - 6, H - mh, 4, mh);
    }

    // grid
    ctx.strokeStyle = 'rgba(157, 0, 255, 0.07)';
    ctx.lineWidth = 1;
    for (var c = 1; c < COLS; c++) { ctx.beginPath(); ctx.moveTo(ox + c * CELL + 0.5, 0); ctx.lineTo(ox + c * CELL + 0.5, H); ctx.stroke(); }
    for (var r = 1; r < ROWS; r++) { ctx.beginPath(); ctx.moveTo(ox, r * CELL + 0.5); ctx.lineTo(ox + COLS * CELL, r * CELL + 0.5); ctx.stroke(); }

    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      var v = p.board[r][c];
      if (v) drawBlock(ctx, ox + c * CELL, r * CELL, CELL, v === GARBAGE ? '#3a3350' : blockColor(p, r));
    }

    if (p.piece && p.alive) {
      var gy = p.ghostY();
      p.cells(p.piece.x, gy, p.piece.rot).forEach(function (cell) {
        if (cell[1] < 0) return;
        ctx.strokeStyle = 'rgba(199, 125, 255, 0.55)';
        ctx.lineWidth = 2;
        ctx.strokeRect(ox + cell[0] * CELL + 3, cell[1] * CELL + 3, CELL - 6, CELL - 6);
      });
      p.cells(p.piece.x, p.piece.y, p.piece.rot).forEach(function (cell) {
        if (cell[1] < 0) return;
        ctx.shadowBlur = 12;
        ctx.shadowColor = blockColor(p, cell[1]);
        drawBlock(ctx, ox + cell[0] * CELL, cell[1] * CELL, CELL, blockColor(p, cell[1]));
        ctx.shadowBlur = 0;
      });
    }

    if (p.flash) {
      ctx.fillStyle = 'rgba(199, 125, 255,' + p.flash + ')';
      ctx.fillRect(ox, 0, COLS * CELL, H);
    }

    ctx.strokeStyle = 'rgba(157, 0, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 1, 1, COLS * CELL - 2, H - 2);

    if (!p.alive) {
      ctx.fillStyle = 'rgba(5,5,5,0.75)';
      ctx.fillRect(ox, 0, COLS * CELL, H);
      ctx.fillStyle = '#ff9ac8';
      ctx.font = '800 28px "JetBrains Mono", monospace';
      ctx.fillText('OUT', ox + COLS * CELL / 2, H / 2);
    }

    var lives = p.lives === Infinity || game.mode === 'solo' ? '' : new Array(Math.max(0, p.lives - p.losses) + 1).join('♥ ');
    p.ui.lives.textContent = lives;
    p.ui.stats.textContent = p.score + ' pts · ' + p.lines + ' lines · lvl ' + p.level;
  }

  /* ---------- input ---------- */

  function keyName(e) { return e.key === ' ' ? ' ' : e.key.toLowerCase(); }

  function actionFor(p, k) {
    for (var a in p.controls) if (p.controls[a].indexOf(k) !== -1) return a;
    return null;
  }

  function doAction(p, a) {
    if (!p.alive || !p.piece) return;
    if (a === 'left') p.move(-1);
    else if (a === 'right') p.move(1);
    else if (a === 'soft') p.softDrop();
    else if (a === 'cw') p.rotate(1);
    else if (a === 'ccw') p.rotate(-1);
    else if (a === 'hard') afterLock(p, p.hardDrop());
    else if (a === 'hold') p.holdPiece();
    if (game.mode === 'online') net.dirty = true;
  }

  document.addEventListener('keydown', function (e) {
    if (!game || $('#gameView').classList.contains('hidden') || e.target.closest('input, textarea')) return;
    var k = keyName(e);
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) !== -1) e.preventDefault();
    if ((k === 'p' || k === 'escape') && !game.over) { setPaused(!game.paused); return; }
    if (game.paused || game.over || e.repeat) return;
    game.players.forEach(function (p) {
      if (!p.local) return;
      var a = actionFor(p, k);
      if (!a) return;
      held[k] = { t: 0, r: 0 };
      doAction(p, a);
    });
  });

  document.addEventListener('keyup', function (e) { delete held[keyName(e)]; });
  window.addEventListener('blur', function () {
    held = {};
    if (game && !game.over && game.mode !== 'online' && !game.paused) setPaused(true);
  });

  // Touch pad: tap to act, hold left/right/down to repeat.
  function bindTouch() {
    var repeatTimer = null;
    $('#touchPad').addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn || !game) return;
      e.preventDefault();
      var me = game.players.filter(function (p) { return p.local; })[0];
      if (!me || game.paused || game.over) return;
      var a = btn.dataset.act;
      doAction(me, a);
      if (a === 'left' || a === 'right' || a === 'soft') {
        clearInterval(repeatTimer);
        var start = Date.now();
        repeatTimer = setInterval(function () { if (Date.now() - start > 170) doAction(me, a); }, 50);
      }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      $('#touchPad').addEventListener(ev, function () { clearInterval(repeatTimer); });
    });
  }

  /* =================================================================
     Modes
     ================================================================= */

  function startSolo() {
    var p = new Player({ id: 'me', name: 'You', skin: settings.skin, local: true, controls: KEYS_SOLO, lives: 1 });
    startGame('solo', [p]);
  }

  function startLocal() {
    var lives = livesValue();
    var a = new Player({ id: 'p1', name: 'Player 1', skin: settings.skin, local: true, controls: KEYS_P1, lives: lives });
    var b = new Player({ id: 'p2', name: 'Player 2', skin: (settings.skin + 1) % SKINS.length, local: true, controls: KEYS_P2, lives: lives });
    startGame('local', [a, b]);
  }

  /* =================================================================
     Online (host relays everything; up to 4 players)
     ================================================================= */

  var net = { role: null, session: null, lobby: [], mySlot: null, myReady: false, dirty: false, lastSend: 0 };

  function myName() {
    var n = ($('#playerName').value || '').trim().slice(0, 16);
    return n || 'Player';
  }

  function netSend(msg) {
    if (!net.session) return;
    if (net.role === 'host') { hostHandle(null, msg, true); net.session.broadcast(msg); }
    else net.session.send(msg);
  }

  function lobbyEntry(slot) { return net.lobby.filter(function (x) { return x.slot === slot; })[0]; }

  function hostBroadcastLobby() {
    net.session.conns.forEach(function (c) {
      net.session.send(c, { t: 'lobby', players: net.lobby.map(strip), lives: settings.lives, you: c.slot });
    });
    renderLobby();
  }

  function strip(x) { return { slot: x.slot, name: x.name, ready: x.ready, skin: x.skin }; }

  function createLobby() {
    settings.name = myName();
    G.Store.set('tetris_name', settings.name);
    net.role = 'host';
    net.mySlot = 1;
    net.lobby = [{ slot: 1, name: settings.name, ready: false, skin: settings.skin }];
    setOnlineNotice('Creating lobby…');
    net.session = G.Net.host('tetris', {
      maxGuests: 3,
      onReady: function (code) {
        $('#lobbyCode').textContent = code;
        G.show($('#lobbyCodeBox'));
        screen('lobbyPanel');
        renderLobby();
      },
      onJoin: function (conn) {
        var used = net.lobby.map(function (x) { return x.slot; });
        conn.slot = [2, 3, 4].filter(function (s) { return used.indexOf(s) === -1; })[0];
        net.lobby.push({ slot: conn.slot, name: 'Player ' + conn.slot, ready: false, skin: 0 });
        G.Sound.beep(660, 0.1, 'triangle');
        hostBroadcastLobby();
      },
      onData: function (conn, d) { hostHandle(conn, d, false); },
      onLeave: function (conn) {
        net.lobby = net.lobby.filter(function (x) { return x.slot !== conn.slot; });
        if (game && !game.over) {
          var p = findPlayer(conn.slot);
          if (p && p.alive) { p.alive = false; G.banner(p.name + ' disconnected'); hostCheckOnline(); }
        } else if (net.session) hostBroadcastLobby();
      },
      onError: netError
    });
  }

  function joinLobby() {
    var code = G.cleanCode($('#joinCode').value);
    if (code.length !== 5) return netError('Lobby codes are 5 characters.');
    settings.name = myName();
    G.Store.set('tetris_name', settings.name);
    net.role = 'guest';
    setOnlineNotice('Connecting…');
    net.session = G.Net.join('tetris', code, {
      onOpen: function () {
        net.session.send({ t: 'hi', name: settings.name, skin: settings.skin });
        G.hide($('#lobbyCodeBox'));
        screen('lobbyPanel');
      },
      onData: guestHandle,
      onClose: function () {
        if (!net.session) return;
        net.session.close();
        net.session = null;
        if (game && !game.over) {
          game.over = true;
          overlay('Host left', 'The game ended.', [{ label: 'Menu', primary: true, onClick: quitToMenu }]);
        } else {
          screen('onlinePanel');
          netError('The host closed the lobby.');
        }
      },
      onError: netError
    });
  }

  // Host: handles messages from guests (conn set) and its own outgoing messages (local = true).
  function hostHandle(conn, d, local) {
    if (!d || typeof d !== 'object') return;
    var slot = local ? 1 : conn && conn.slot;
    var entry = lobbyEntry(slot);
    switch (d.t) {
      case 'hi':
        if (entry) { entry.name = String(d.name || 'Player').slice(0, 16); entry.skin = SKINS[d.skin] ? d.skin : 0; hostBroadcastLobby(); }
        break;
      case 'ready':
        if (entry) { entry.ready = !!d.v; hostBroadcastLobby(); }
        break;
      case 'st':
        if (!local && game) {
          var p = findPlayer(slot);
          if (p) { p.unpack(d.s); hostCheckOnline(); }
          net.session.broadcast({ t: 'st', slot: slot, s: d.s }, conn);
        }
        break;
      case 'atk':
        if (!local) {
          net.session.conns.forEach(function (c) { if (c.slot === d.to) net.session.send(c, { t: 'atk', to: d.to, n: d.n }); });
          var target = findPlayer(d.to);
          if (target && target.local) target.incoming += Math.min(10, +d.n || 0);
        }
        break;
      case 'ann':
        if (!local) { G.banner(String(d.text).slice(0, 60)); net.session.broadcast({ t: 'ann', text: d.text }, conn); }
        break;
    }
  }

  function guestHandle(d) {
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'lobby':
        net.lobby = d.players || [];
        net.mySlot = d.you;
        settings.lives = String(d.lives);
        renderLobby();
        break;
      case 'start':
        beginOnline(d.players, d.lives);
        break;
      case 'st':
        var p = findPlayer(d.slot);
        if (p && !p.local) p.unpack(d.s);
        break;
      case 'atk':
        var me = findPlayer(net.mySlot);
        if (me && d.to === net.mySlot) me.incoming += Math.min(10, +d.n || 0);
        break;
      case 'ann':
        G.banner(String(d.text).slice(0, 60));
        break;
      case 'over':
        if (game) finishVersus(String(d.winner), true);
        break;
    }
  }

  function findPlayer(slot) {
    return game ? game.players.filter(function (p) { return p.id === slot; })[0] : null;
  }

  function hostStartIfReady() {
    if (net.role !== 'host') return;
    if (net.lobby.length < 2) { G.banner('Need at least 2 players'); return; }
    if (!net.lobby.every(function (x) { return x.ready; })) { G.banner('Everyone needs to be ready'); return; }
    var players = net.lobby.map(strip);
    var msg = { t: 'start', players: players, lives: settings.lives };
    net.session.broadcast(msg);
    beginOnline(players, settings.lives);
  }

  function beginOnline(list, lives) {
    settings.lives = String(lives);
    var lv = livesValue();
    var players = list.slice().sort(function (a, b) { return a.slot - b.slot; }).map(function (x) {
      var mine = x.slot === net.mySlot;
      return new Player({ id: x.slot, name: mine ? x.name + ' (you)' : x.name, skin: x.skin || 0, local: mine, controls: KEYS_SOLO, lives: lv });
    });
    net.lobby.forEach(function (x) { x.ready = false; });
    net.myReady = false;
    startGame('online', players);
  }

  function netTick(now) {
    var me = findPlayer(net.mySlot);
    if (!me) return;
    if (now - net.lastSend > (net.dirty ? 60 : 250)) {
      net.lastSend = now;
      net.dirty = false;
      var s = me.pack();
      if (net.role === 'host') { net.session.broadcast({ t: 'st', slot: net.mySlot, s: s }); hostCheckOnline(); }
      else net.session.send({ t: 'st', s: s });
    }
  }

  function hostCheckOnline() {
    if (net.role !== 'host' || !game || game.over) return;
    var alive = game.players.filter(function (p) { return p.alive; });
    if (alive.length <= 1 && game.players.length > 1) {
      var winner = alive[0] || game.players.slice().sort(function (a, b) { return b.score - a.score; })[0];
      finishVersus(winner.name.replace(' (you)', ''));
    }
  }

  function backToLobby() {
    stop();
    game = null;
    if (!net.session) return quitToMenu();
    screen('lobbyPanel');
    renderLobby();
  }

  function renderLobby() {
    var list = $('#lobbyPlayers');
    list.textContent = '';
    net.lobby.slice().sort(function (a, b) { return a.slot - b.slot; }).forEach(function (x) {
      var li = document.createElement('li');
      var a = document.createElement('span');
      a.textContent = x.name + (x.slot === 1 ? ' (host)' : '') + (x.slot === net.mySlot ? ' · you' : '');
      var b = document.createElement('span');
      b.className = x.ready ? 'ready' : 'waiting';
      b.textContent = x.ready ? '✓ Ready' : 'Not ready';
      li.appendChild(a); li.appendChild(b);
      list.appendChild(li);
    });
    for (var i = net.lobby.length; i < 4; i++) {
      var empty = document.createElement('li');
      empty.innerHTML = '<span class="waiting">Open slot</span><span></span>';
      list.appendChild(empty);
    }
    var mine = lobbyEntry(net.mySlot);
    net.myReady = !!(mine && mine.ready);
    $('#readyBtn').textContent = net.myReady ? 'Not ready' : 'Ready';
    $('#startBtn').classList.toggle('hidden', net.role !== 'host');
    $('#lobbyLivesRow').classList.toggle('hidden', net.role !== 'host');
    $('#lobbyLivesText').textContent = 'Lives: ' + (settings.lives === 'inf' ? '∞' : settings.lives);
  }

  function setOnlineNotice(msg, err) {
    $('#onlineNotice').textContent = msg;
    $('#onlineNotice').className = 'notice' + (err ? ' error' : '');
  }

  function netError(msg) {
    setOnlineNotice(msg, true);
    if (net.session) { net.session.close(); net.session = null; }
    stop();
    game = null;
    screen('onlinePanel');
  }

  /* =================================================================
     Menu wiring
     ================================================================= */

  function renderMenuBest() { $('#menuBest').textContent = best ? 'Best solo score: ' + best : ''; }

  function renderSkins() {
    var row = $('#skinRow');
    row.textContent = '';
    SKINS.forEach(function (s, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'skin-btn' + (i === settings.skin ? ' active' : '');
      b.title = s.name;
      b.style.background = 'linear-gradient(to top, ' + s.bottom + ', ' + s.top + ')';
      b.addEventListener('click', function () {
        settings.skin = i;
        G.Store.set('tetris_skin', i);
        renderSkins();
      });
      row.appendChild(b);
    });
  }

  function init() {
    renderSkins();
    renderMenuBest();
    $('#playerName').value = settings.name;

    G.chips($('#livesChips'), settings.lives, function (v) { settings.lives = v; G.Store.set('tetris_lives', v); });
    var lobbyLives = G.chips($('#lobbyLivesChips'), settings.lives, function (v) {
      settings.lives = v;
      if (net.role === 'host' && net.session) hostBroadcastLobby();
    });

    $('#modeSolo').addEventListener('click', startSolo);
    $('#modeLocal').addEventListener('click', startLocal);
    $('#modeOnline').addEventListener('click', function () {
      setOnlineNotice(G.Net.available() ? 'Play with up to 4 people. Clearing lines sends garbage to your opponents.' : 'Online play couldn\'t load on this network.', !G.Net.available());
      screen('onlinePanel');
    });
    $('#createLobby').addEventListener('click', function () { lobbyLives.set(settings.lives); createLobby(); });
    $('#joinForm').addEventListener('submit', function (e) { e.preventDefault(); joinLobby(); });
    $('#onlineBack').addEventListener('click', function () { screen('menuPanel'); });
    $('#lobbyCode').addEventListener('click', function () { G.copyText($('#lobbyCode').textContent); });
    $('#readyBtn').addEventListener('click', function () {
      net.myReady = !net.myReady;
      if (net.role === 'host') { var me = lobbyEntry(1); if (me) me.ready = net.myReady; hostBroadcastLobby(); }
      else net.session.send({ t: 'ready', v: net.myReady });
      renderLobby();
    });
    $('#startBtn').addEventListener('click', hostStartIfReady);
    $('#lobbyLeave').addEventListener('click', quitToMenu);
    $('#pauseBtn').addEventListener('click', function () { if (game) setPaused(!game.paused); });
    $('#quitBtn').addEventListener('click', quitToMenu);
    G.Sound.bindButton($('#soundBtn'));
    bindTouch();
    G.chatEasterEgg();
    screen('menuPanel');
  }

  init();
})();
