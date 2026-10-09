// tetris.js: Tetris for kanaris-beans.com. Solo (5 game types), local versus, online (2–4 players, PeerJS).
// Ported features from the VRChat world (Kanaris Tetris): line-clear streaks with glow and fire, 24 Halo-style
// skulls (modifiers, power-up blocks, versus attacks) that move a score multiplier, game types (Marathon,
// Sprint 40, Ultra 2:00, Dig, Survival), versus rules (Last Standing, Elimination), host tools (kick, end game,
// rules lock), random versus colours, and an animated background that reacts to play (tetris-bg.js).
(function () {
  'use strict';

  var G = window.Games;
  var BG = window.TetrisBG || null;
  var ACH = window.TetrisAchievements || { event: function () {}, open: function () {}, count: function () { return { unlocked: 0, total: 0 }; }, onChange: function () {} };
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* =================================================================
     Rules
     ================================================================= */

  var COLS = 10, ROWS = 20, CELL = 28, SIDE = 4;   // side panels are 4 cells wide
  var GARBAGE = 8, CELL_POWER = 9;                  // board: 1-7 pieces, 8 garbage, 9+ power-up blocks

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

  // Neon purple → blue palettes (bottom of the well → top).
  var PALETTES = [
    { name: 'Violet', bottom: '#1c0638', top: '#c77dff' },
    { name: 'Ultraviolet', bottom: '#24063f', top: '#a020ff' },
    { name: 'Indigo', bottom: '#140b4a', top: '#7c6cff' },
    { name: 'Plasma', bottom: '#2a0a52', top: '#4cc9ff' },
    { name: 'Cobalt', bottom: '#06123f', top: '#3d8bff' }
  ];

  var HEX_RE = /^#[0-9a-f]{6}$/i;

  function customPalette(hex, bottom) {
    hex = HEX_RE.test(hex || '') ? hex : '#9d00ff';
    return { name: 'Custom', bottom: HEX_RE.test(bottom || '') ? bottom : mix('#07040c', hex, 0.3), top: hex };
  }

  function safePalette(p) {
    return p && HEX_RE.test(p.bottom || '') && HEX_RE.test(p.top || '') ? { bottom: p.bottom, top: p.top } : PALETTES[0];
  }

  // Versus rounds deal everyone a random colour (bright top, deep bottom, one hue) so boards are easy to tell apart.
  function randomPalette() {
    return customPalette(hsvHex(Math.random() * 360, 0.55 + Math.random() * 0.3, 1));
  }

  var LINE_POINTS = [0, 100, 300, 500, 800];
  var ATTACK = [0, 0, 1, 2, 4];
  var LOCK_DELAY = 0.5, MAX_RESETS = 15;
  var DAS = 0.15, ARR = 0.04, SOFT_RATE = 0.035;

  // Website timing: first clear arms 12 seconds; each clear adds 2 seconds to the refill
  // window up to 30 seconds. A Tetris grants 35 seconds. Non-clearing pieces do not break it.
  var STREAK = { WINDOW: 12, STEP: 2, MAX: 30, TETRIS: 35, MIN: 2, STRONG: 5, FIRE: 10, BORDER: 20, LIGHTNING: 50 };
  var reducedEffects = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Power-ups (blocks that ride on pieces; fire when their row clears).
  var PU = { NONE: 0, STREAK: 1, BOMB: 2, SLOW: 3, DOUBLE: 4, FREEZE: 5, SHELL: 6, CURSE: 7, SKULL: 8, QUAKE: 9, STAR_BOMB: 10 };
  var POWER_CHANCE = 0.12;
  var SLOW_SECONDS = 10, SLOW_FACTOR = 2.5, DOUBLE_SECONDS = 15, STREAK_POWER_MAX = 50;
  var FREEZE_SECONDS = 3.5, HASTE_SECONDS = 8, HASTE_FACTOR = 3, SHELL_LINES = 3, QUAKE_ROWS = 2, STAR_JUNK = 6;

  // Game types (solo; versus always plays Marathon rules) and versus rules.
  var GT = { MARATHON: 'marathon', SPRINT: 'sprint', ULTRA: 'ultra', DIG: 'dig', SURVIVAL: 'survival' };
  var GT_INFO = {
    marathon: 'Marathon: the classic, speeds up every 10 lines',
    sprint: 'Sprint 40: clear 40 lines as fast as you can',
    ultra: 'Ultra 2:00: the best score you can make in two minutes',
    dig: 'Dig: clear 10 rows of garbage as fast as you can',
    survival: 'Survival: garbage rises from below, faster and faster'
  };
  var SPRINT_LINES = 40, ULTRA_SECONDS = 120, DIG_ROWS = 10, ELIM_INTERVAL = 180;
  var STORM_INTERVAL = 20, FUSE_SECONDS = 15, HEAVY_LEVELS = 4, CRUISE_LEVEL = 8, HAIR_LOCK = 0.1;

  // The 24 skulls, in the same order as the VRChat world (icons: tetris-skulls.png, made by the world's
  // Tools/skull_icons.py). Hard skulls raise the score multiplier, easy ones lower it.
  var SKULLS = [
    { id: 'relaxed', name: 'Relaxing', cat: 'mod', eff: -0.5, body: 'Drop speed never rises, all game long.' },
    { id: 'secondWind', name: 'Second Wind', cat: 'mod', eff: -0.5, body: 'Your first solo top-out wipes the top of the well instead of ending the game.' },
    { id: 'softLanding', name: 'Soft Landing', cat: 'mod', eff: -0.25, body: 'Pieces wait twice as long before they lock, so you can slide them into place.' },
    { id: 'luckyI', name: 'Lucky I', cat: 'mod', eff: -0.25, body: 'Every bag of pieces holds two I pieces instead of one.' },
    { id: 'cruise', name: 'Cruise Control', cat: 'mod', eff: -0.25, body: 'The drop speed stops rising at level 8. Scoring still climbs.' },
    { id: 'noGhost', name: 'No Ghost', cat: 'mod', eff: 0.25, body: 'No landing preview under your piece.' },
    { id: 'noHold', name: 'No Hold', cat: 'mod', eff: 0.25, body: 'The hold slot is disabled.' },
    { id: 'blind', name: 'Blind', cat: 'mod', eff: 0.5, body: 'The NEXT pieces are hidden.' },
    { id: 'heavy', name: 'Heavy', cat: 'mod', eff: 0.5, body: 'Pieces fall as if you were four levels higher.' },
    { id: 'hairTrigger', name: 'Hair Trigger', cat: 'mod', eff: 0.5, body: 'Pieces lock almost the moment they land. No last-second slides.' },
    { id: 'mirror', name: 'Mirror', cat: 'mod', eff: 0.5, body: 'Left and right are swapped.' },
    { id: 'fuse', name: 'Fuse', cat: 'mod', eff: 0.5, body: 'Go 15 seconds without clearing a line and a garbage row rises.' },
    { id: 'storm', name: 'Thunderstorm', cat: 'mod', eff: 0.75, body: 'A garbage row rises from below every 20 seconds.' },
    { id: 'lightsOut', name: 'Lights Out', cat: 'mod', eff: 1, body: 'Your stack fades into the dark a moment after every lock. Remember where things are.' },
    { id: 'birthday', name: 'Birthday Party', cat: 'mod', eff: 0, body: 'Block Birthday Party: every line clear bursts into confetti. Purely for fun.' },
    { id: 'pStreak', name: 'Long Streak', cat: 'power', kind: PU.STREAK, eff: -0.1, body: 'Drops with pieces. Clear its line to double your streak timer.' },
    { id: 'pSlow', name: 'Slow Time', cat: 'power', kind: PU.SLOW, eff: -0.25, body: 'Drops with pieces. Clear its line and pieces fall 2.5x slower for 10 seconds.' },
    { id: 'pDouble', name: 'Double Score', cat: 'power', kind: PU.DOUBLE, eff: -0.1, body: 'Drops with pieces. Clear its line for double points for 15 seconds.' },
    { id: 'pQuake', name: 'Quake', cat: 'power', kind: PU.QUAKE, eff: -0.25, body: 'Drops with pieces. Clear its line and the bottom two rows drop out.' },
    { id: 'pBomb', name: 'Bomb', cat: 'power', kind: PU.BOMB, eff: 0.25, body: 'Drops with pieces. Its blast clears its row and its whole column, tearing up your stack.' },
    { id: 'pStarBomb', name: 'Star Bomb', cat: 'power', kind: PU.STAR_BOMB, eff: 0.5, body: 'Drops with pieces. When its line clears it scatters six junk blocks over your stack.' },
    { id: 'pFreeze', name: 'Freeze', cat: 'attack', kind: PU.FREEZE, eff: 0, body: 'Versus only. Clear its line to freeze a random opponent for 3.5 seconds.' },
    { id: 'pShell', name: 'Blue Shell', cat: 'attack', kind: PU.SHELL, eff: 0, body: 'Versus only. Clear its line to hit the leader with 3 garbage rows.' },
    { id: 'pCurse', name: 'Curse', cat: 'attack', kind: PU.CURSE, eff: 0, body: 'Versus only. Plants a skull in an opponent\'s next piece; when it lands they get Haste.' },
    // Website-only (not in the VRChat world yet), so it sits at the end of the icon strip.
    { id: 'noStreaks', name: 'Snuffed Out', cat: 'mod', eff: 0, body: 'Streaks never start: no streak timer, fire, outlines or streak badge. A calm, clean board.' }
  ];
  var SKULL_BY_ID = {};
  SKULLS.forEach(function (s, i) { s.index = i; SKULL_BY_ID[s.id] = s; });

  function cleanSkulls(list) {
    var seen = {};
    return (Array.isArray(list) ? list : []).filter(function (id) {
      if (!SKULL_BY_ID[id] || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  function multiplierOf(skulls) {
    var m = 1;
    skulls.forEach(function (id) { m += SKULL_BY_ID[id].eff; });
    return Math.max(0.25, Math.round(m * 100) / 100);
  }

  function effText(e) {
    if (Math.abs(e) < 0.001) return '±0×';
    return (e > 0 ? '+' : '−') + Math.round(Math.abs(e) * 100) / 100 + '×';
  }

  function gravity(level) {
    return Math.max(0.02, Math.pow(0.8 - (level - 1) * 0.007, level - 1));
  }

  function mix(a, b, t) {
    var pa = [1, 3, 5].map(function (i) { return parseInt(a.substr(i, 2), 16); });
    var pb = [1, 3, 5].map(function (i) { return parseInt(b.substr(i, 2), 16); });
    return '#' + pa.map(function (v, i) { return Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0'); }).join('');
  }

  function hsvHex(h, s, v) {
    var f = function (n) {
      var k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return '#' + [f(5), f(3), f(1)].map(function (x) { return Math.round(x * 255).toString(16).padStart(2, '0'); }).join('');
  }

  // Fire colour by streak (mirrors the VRChat board shader): 10x red → 18x violet → white-hot, then from 20x the
  // rainbow R O Y G B V up to 29x, and a very light purple from 30x.
  function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function fireSpectrum(clears) {
    var c;
    if (clears >= 30) return [0.86, 0.76, 1];
    if (clears >= STREAK.BORDER) {
      var t = (clears - STREAK.BORDER) / 9 * 5;
      c = lerp3([1, 0.12, 0.08], [1, 0.5, 0.05], clamp01(t));
      c = lerp3(c, [1, 0.9, 0.12], clamp01(t - 1));
      c = lerp3(c, [0.2, 0.95, 0.3], clamp01(t - 2));
      c = lerp3(c, [0.2, 0.5, 1], clamp01(t - 3));
      return lerp3(c, [0.62, 0.2, 1], clamp01(t - 4));
    }
    var k = Math.max(0, Math.min(5, (clears - 10) * 0.5));
    c = lerp3([1, 0.1, 0.02], [1, 0.42, 0.02], clamp01(k));
    c = lerp3(c, [1, 0.86, 0.12], clamp01(k - 1));
    c = lerp3(c, [0.18, 0.45, 1], clamp01(k - 2));
    c = lerp3(c, [0.66, 0.14, 1], clamp01(k - 3));
    return lerp3(c, [0.96, 0.92, 1], clamp01(k - 4));
  }
  function rgb(c, a) { return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (a == null ? 1 : a) + ')'; }

  /* =================================================================
     Player
     ================================================================= */

  function Player(opts) {
    this.id = opts.id;
    this.name = opts.name;
    this.palette = safePalette(opts.palette);
    this.avatar = opts.avatar || null;
    this.local = opts.local;          // controlled on this device
    this.controls = opts.controls;    // key map for local players
    this.lives = opts.lives;
    this.versus = !!opts.versus;
    this.gameType = this.versus ? GT.MARATHON : (opts.gameType || GT.MARATHON);
    this.skulls = cleanSkulls(opts.skulls);
    var f = {};
    this.skulls.forEach(function (id) { f[id] = true; });
    this.f = f;
    this.powerKinds = this.skulls.map(function (id) { return SKULL_BY_ID[id]; })
      .filter(function (s) { return s.kind && (s.cat !== 'attack' || opts.versus); })
      .map(function (s) { return s.kind; });
    this.multiplier = multiplierOf(this.skulls);
    this.reset(true);
  }

  Player.prototype.reset = function (full) {
    this.board = [];
    for (var r = 0; r < ROWS; r++) this.board.push(new Array(COLS).fill(0));
    this.bag = [];
    this.queue = [];
    this.hold = null;
    this.holdPower = null;
    this.canHold = true;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.fall = 0;
    this.combo = -1;
    this.b2b = false;
    this.incoming = 0;
    this.flash = 0;
    this.slow = 0; this.double = 0; this.frozen = 0; this.haste = 0;
    this.pendingCurses = 0;
    this.streak = 0; this.streakLines = 0; this.streakLeft = 0;
    this.lockedAt = 0;
    this.fx = [];        // power glows and confetti: { cells, kind, t }
    this.junk = null;    // star bomb fly-in
    if (full) {
      this.score = 0;
      this.lines = 0;
      this.level = 1;
      this.alive = true;
      this.losses = 0;
      this.elapsed = 0;
      this.stormClock = 0; this.survivalClock = 0; this.fuseClock = 0;
      this.secondWindUsed = false;
      this.finish = null;
      this.eliminated = false;
      if (this.gameType === GT.DIG) this.fillDig();
    }
    this.fillQueue();
    this.spawn();
  };

  Player.prototype.fillQueue = function () {
    while (this.queue.length < 6) {
      if (!this.bag.length) {
        this.bag = TYPES.slice();
        if (this.f.luckyI) this.bag.push('I'); // Lucky I: two I pieces per bag
        for (var i = this.bag.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = this.bag[i]; this.bag[i] = this.bag[j]; this.bag[j] = t;
        }
      }
      this.queue.push(this.bag.pop());
    }
  };

  Player.prototype.spawn = function (type, power) {
    var fromQueue = !type;
    type = type || this.queue.shift();
    this.fillQueue();
    var size = SHAPES[type][0].length;
    this.piece = { type: type, rot: 0, x: Math.floor((COLS - size) / 2), y: type === 'I' ? -1 : 0, power: 0, powerCell: 0 };
    if (power) { this.piece.power = power.kind; this.piece.powerCell = power.cell; }
    else if (fromQueue && this.pendingCurses > 0) {
      this.pendingCurses--;
      this.piece.power = PU.SKULL; this.piece.powerCell = Math.floor(Math.random() * 4);
    } else if (fromQueue && this.powerKinds.length && Math.random() < POWER_CHANCE) {
      this.piece.power = this.powerKinds[Math.floor(Math.random() * this.powerKinds.length)];
      this.piece.powerCell = Math.floor(Math.random() * 4);
    }
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

  Player.prototype.lockDelay = function () {
    if (this.f.hairTrigger) return HAIR_LOCK;
    return this.f.softLanding ? LOCK_DELAY * 2 : LOCK_DELAY;
  };

  Player.prototype.gravityLevel = function () {
    var lvl = this.f.relaxed ? 1 : (this.f.heavy ? this.level + HEAVY_LEVELS : this.level);
    return this.f.cruise ? Math.min(lvl, CRUISE_LEVEL) : lvl;
  };

  Player.prototype.move = function (dx) {
    if (this.f.mirror) dx = -dx; // Mirror skull: left and right swapped for every input
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
    if (!this.canHold || this.f.noHold) return;
    var cur = this.piece.type, curPower = this.piece.power ? { kind: this.piece.power, cell: this.piece.powerCell } : null;
    if (this.hold) {
      var h = this.hold, hp = this.holdPower;
      this.hold = cur; this.holdPower = curPower;
      this.spawn(h, hp);
    } else {
      this.hold = cur; this.holdPower = curPower;
      this.spawn();
    }
    this.canHold = false;
    G.Sound.beep(520, 0.04, 'triangle', 0.03);
  };

  // Returns { cleared, attack, toppedOut, tetris, levelUp, out: { freeze, shell, curse } }
  Player.prototype.lock = function () {
    var id = TYPE_ID[this.piece.type];
    var self = this, piece = this.piece;
    var above = false;
    this.cells(piece.x, piece.y, piece.rot).forEach(function (c, i) {
      if (c[1] < 0) { above = true; return; }
      if (piece.power === PU.SKULL && i === piece.powerCell) self.board[c[1]][c[0]] = GARBAGE;
      else self.board[c[1]][c[0]] = piece.power && i === piece.powerCell ? CELL_POWER + piece.power - 1 : id;
    });
    this.lockedAt = performance.now();

    // Power-ups fire when their row clears.
    var full = [], powers = [];
    for (var r = 0; r < ROWS; r++) {
      if (!this.board[r].every(function (v) { return v; })) continue;
      full.push(r);
      for (var c = 0; c < COLS; c++) {
        var v = this.board[r][c];
        if (v >= CELL_POWER) powers.push({ kind: v - CELL_POWER + 1, row: r, col: c });
      }
    }
    var fullSet = {};
    full.forEach(function (row) { fullSet[row] = true; });
    var bombs = 0, boosts = 0, quakes = 0, stars = 0, out = { freeze: 0, shell: 0, curse: 0 };
    var fxCells = [];
    powers.forEach(function (p) {
      if (p.kind === PU.BOMB) {
        bombs++;
        for (var rr = 0; rr < ROWS; rr++) { if (!fullSet[rr]) self.board[rr][p.col] = 0; fxCells.push([rr, p.col]); }
      } else if (p.kind === PU.STREAK) boosts++;
      else if (p.kind === PU.QUAKE) quakes++;
      else if (p.kind === PU.STAR_BOMB) stars++;
      else if (p.kind === PU.SLOW) self.slow = SLOW_SECONDS;
      else if (p.kind === PU.DOUBLE) self.double = DOUBLE_SECONDS;
      else if (p.kind === PU.FREEZE) out.freeze++;
      else if (p.kind === PU.SHELL) out.shell++;
      else if (p.kind === PU.CURSE) out.curse++;
      for (var cc = 0; cc < COLS; cc++) fxCells.push([p.row, cc]);
    });
    var now = performance.now();
    if (powers.length) this.fx.push({ cells: fxCells, kind: powers[0].kind, t: now });
    if (this.f.birthday && full.length) {
      var conf = [];
      full.forEach(function (row) { for (var cx = 0; cx < COLS; cx++) conf.push([row, cx]); });
      this.fx.push({ cells: conf, kind: 'confetti', t: now });
    }

    var rowsCleared = 0;
    for (r = ROWS - 1; r >= 0; r--) {
      if (this.board[r].every(function (v) { return v; })) {
        this.board.splice(r, 1);
        this.board.unshift(new Array(COLS).fill(0));
        rowsCleared++;
        r++;
      }
    }
    var cleared = rowsCleared + bombs;
    var wasB2b = this.b2b;
    for (var q = 0; q < quakes * QUAKE_ROWS; q++) { this.board.pop(); this.board.unshift(new Array(COLS).fill(0)); cleared++; }
    if (stars) {
      var star = powers.filter(function (p) { return p.kind === PU.STAR_BOMB; })[0];
      this.scatterJunk(stars * STAR_JUNK, star.row, star.col);
    }

    var attack = 0, tetris = rowsCleared === 4, levelUp = false;
    if (cleared) {
      this.combo++;
      var pts = LINE_POINTS[Math.min(4, cleared)] * this.level;
      if (this.double > 0) pts *= 2;
      pts = Math.round(pts * this.multiplier);
      if (tetris && this.b2b) pts = Math.floor(pts * 1.5);
      pts += 50 * Math.max(0, this.combo) * this.level;
      this.score += pts;
      attack = ATTACK[Math.min(4, cleared)] + (tetris && this.b2b ? 1 : 0) + Math.floor(Math.max(0, this.combo) / 2);
      this.b2b = tetris;
      this.lines += cleared;
      var before = this.level;
      this.level = Math.floor(this.lines / 10) + 1;
      levelUp = this.level > before;
      this.flash = 0.25;
      this.fuseClock = 0;
      // Outgoing attack cancels garbage that's waiting for us first.
      var cancel = Math.min(attack, this.incoming);
      this.incoming -= cancel;
      attack -= cancel;
      G.Sound.beep(tetris ? 988 : 660 + Math.min(4, cleared) * 60, tetris ? 0.3 : 0.12, 'triangle', 0.06);
      this.recordStreak(cleared);
      if (!reducedEffects && full.length) this.fx.push({ kind: 'clear', rows: full.slice(), streak: this.streak, t: now });
      for (var b = 0; b < boosts; b++) this.streakLeft = Math.min(STREAK_POWER_MAX, this.streakLeft * 2);
    } else {
      this.combo = -1;
      if (this.incoming) this.addGarbage(this.incoming);
      this.incoming = 0;
      G.Sound.beep(160, 0.03, 'square', 0.02);
    }
    if (piece.power === PU.SKULL) this.haste = HASTE_SECONDS; // the curse lands on us

    this.canHold = true;
    var ok = this.spawn() && !above;
    if (this.f.lightsOut) this.lightsLines = (this.lightsLines || 0) + cleared;
    var empty = this.board.every(function (row) { return row.every(function (v) { return !v; }); });
    var fired = powers.map(function (p) { return p.kind === PU.BOMB ? 'bomb' : p.kind === PU.STAR_BOMB ? 'starbomb' : p.kind === PU.QUAKE ? 'quake' : ''; });
    return { cleared: cleared, attack: attack, toppedOut: !ok, tetris: tetris, levelUp: levelUp, out: out,
      b2b: tetris && wasB2b, perfect: cleared > 0 && empty, powers: fired };
  };

  Player.prototype.recordStreak = function (cleared) {
    if (this.f.noStreaks) return;
    if (this.streakLeft <= 0) { this.streak = 0; this.streakLines = 0; }
    this.streak = Math.min(99, this.streak + 1);
    this.streakLines += cleared;
    var win = cleared >= 4 ? STREAK.TETRIS : Math.min(STREAK.MAX, STREAK.WINDOW + STREAK.STEP * (this.streak - 1));
    this.streakLeft = Math.max(this.streakLeft, win);
  };

  Player.prototype.heatTier = function () {
    if (this.streakLeft <= 0 || this.streak < STREAK.MIN) return 0;
    return this.streak >= STREAK.FIRE ? 3 : this.streak >= STREAK.STRONG ? 2 : 1;
  };

  // Star Bomb: junk lands on top of random columns; each one flies in from the bomb (drawn by drawJunk).
  Player.prototype.scatterJunk = function (n, fromRow, fromCol) {
    var land = [];
    for (var i = 0; i < n; i++) {
      var c = Math.floor(Math.random() * COLS), top = ROWS;
      for (var r = 0; r < ROWS; r++) if (this.board[r][c]) { top = r; break; }
      if (top - 1 < 3) continue;
      this.board[top - 1][c] = GARBAGE;
      land.push([top - 1, c]);
    }
    if (land.length) this.junk = { from: [fromRow, fromCol], land: land, t: performance.now() };
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

  // One garbage row from below (Thunderstorm, Fuse, Survival). Returns true if it topped us out.
  Player.prototype.riseGarbage = function () {
    var topBlocked = this.board[0].some(function (v) { return v; });
    this.addGarbage(1);
    return topBlocked || !!(this.piece && this.collides(this.piece.x, this.piece.y, this.piece.rot));
  };

  Player.prototype.fillDig = function () {
    var last = -1;
    for (var r = ROWS - DIG_ROWS; r < ROWS; r++) {
      var hole = Math.floor(Math.random() * COLS);
      if (hole === last) hole = (hole + 1 + Math.floor(Math.random() * (COLS - 1))) % COLS;
      last = hole;
      for (var c = 0; c < COLS; c++) this.board[r][c] = c === hole ? 0 : GARBAGE;
    }
  };

  Player.prototype.garbageRows = function () {
    return this.board.filter(function (row) { return row.indexOf(GARBAGE) !== -1; }).length;
  };

  // Compact state for online sync (one base-36 character per cell: power blocks go above 9).
  Player.prototype.pack = function () {
    return {
      b: this.board.map(function (r) { return r.map(function (v) { return v.toString(36); }).join(''); }).join(''),
      p: this.piece ? [this.piece.type, this.piece.rot, this.piece.x, this.piece.y, this.piece.power, this.piece.powerCell] : null,
      h: this.hold,
      q: this.queue.slice(0, 5),
      s: this.score, l: this.lines, v: this.level, lv: this.lives, lo: this.losses, a: this.alive, i: this.incoming,
      pal: [this.palette.bottom, this.palette.top],
      k: [this.streak, Math.round(this.streakLeft * 10), Math.round(this.slow * 10), Math.round(this.double * 10),
        Math.round(this.frozen * 10), Math.round(this.haste * 10)],
      e: this.eliminated ? 1 : 0
    };
  };

  Player.prototype.unpack = function (d) {
    if (!d || typeof d.b !== 'string' || d.b.length !== COLS * ROWS) return;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) this.board[r][c] = parseInt(d.b[r * COLS + c], 36) || 0;
    this.piece = d.p && SHAPES[d.p[0]] ? { type: d.p[0], rot: d.p[1] & 3, x: +d.p[2], y: +d.p[3], power: +d.p[4] || 0, powerCell: +d.p[5] || 0 } : null;
    this.hold = SHAPES[d.h] ? d.h : null;
    this.queue = (d.q || []).filter(function (t) { return SHAPES[t]; });
    this.score = +d.s || 0; this.lines = +d.l || 0; this.level = +d.v || 1;
    this.losses = +d.lo || 0; this.alive = d.a !== false; this.incoming = +d.i || 0;
    this.eliminated = !!d.e;
    if (Array.isArray(d.k)) {
      this.streak = +d.k[0] || 0; this.streakLeft = (+d.k[1] || 0) / 10; this.slow = (+d.k[2] || 0) / 10;
      this.double = (+d.k[3] || 0) / 10; this.frozen = (+d.k[4] || 0) / 10; this.haste = (+d.k[5] || 0) / 10;
    }
    if (Array.isArray(d.pal)) this.palette = safePalette({ bottom: d.pal[0], top: d.pal[1] });
  };

  /* =================================================================
     Game state
     ================================================================= */

  var settings = {
    mode: null,
    lives: G.Store.get('tetris_lives', '3'),
    colour: G.Store.get('tetris_colour', '0'),        // '0'–'4' or 'custom'
    customHex: G.Store.get('tetris_custom_hex', '#b026ff'),
    customBottomHex: G.Store.get('tetris_custom_bottom', null),
    gameType: G.Store.get('tetris_game_type', GT.MARATHON),
    versusType: G.Store.get('tetris_versus_type', 'last'),  // 'last' (Last Standing) or 'elim' (Elimination)
    skulls: cleanSkulls(G.Store.get('tetris_skulls', [])),
    // Display only: the fire / lightning outline around the well and the overdrive sparks beside it.
    streakOutlines: G.Store.get('tetris_streak_outlines', 'on'),
    // vs CPU opponents: [{ name, level }], 1-3 of them
    cpuRoster: (function () {
      var r = G.Store.get('tetris_cpu_roster', null);
      if (!Array.isArray(r) || !r.length) r = [{ name: '', level: G.Store.get('tetris_cpu_level', 'normal') }];
      return r.slice(0, 3).map(function (x) { return { name: String((x && x.name) || '').slice(0, 20), level: (x && x.level) || 'normal' }; });
    })()
  };
  if (!GT_INFO[settings.gameType]) settings.gameType = GT.MARATHON;
  if (settings.versusType !== 'elim') settings.versusType = 'last';

  var game = null;
  var raf = null, last = 0;
  var held = {};
  // Personal bests: ranked ladders (no skulls) for Marathon and Ultra; best times for Sprint and Dig.
  var best = G.Store.get('tetris_best', 0);
  var bests = G.Store.get('tetris_bests', {}) || {};

  var KEYS_SOLO = { left: ['arrowleft', 'a'], right: ['arrowright', 'd'], soft: ['arrowdown', 's'], cw: ['arrowup', 'w', 'x'], ccw: ['z', 'control'], hard: [' '], hold: ['c', 'shift'] };
  var KEYS_P1 = { left: ['a'], right: ['d'], soft: ['s'], cw: ['w'], ccw: ['r'], hard: ['q'], hold: ['e'] };
  var KEYS_P2 = { left: ['arrowleft'], right: ['arrowright'], soft: ['arrowdown'], cw: ['arrowup'], ccw: ['/'], hard: [' '], hold: ['enter'] };

  // A player on this device who is a person (not a CPU): achievements, background energy, touch pad, "mine".
  function isHuman(p) { return p.local && !p.cpu; }

  function livesValue(v) { v = v == null ? settings.lives : v; return v === 'inf' ? Infinity : parseInt(v, 10); }

  /* ---------- screens ---------- */

  var SCREENS = ['menuPanel', 'skullsPanel', 'onlinePanel', 'lobbyPanel', 'gameView'];
  var currentScreen = 'menuPanel';
  function screen(id) {
    currentScreen = id;
    SCREENS.forEach(function (s) { $('#' + s).classList.toggle('hidden', s !== id); });
    var page = $('.game-page');
    if (page) page.classList.toggle('playing', id === 'gameView');
  }

  function startGame(mode, players) {
    settings.mode = mode;
    game = {
      mode: mode, players: players, over: false, paused: false, startedAt: performance.now(),
      versusType: players[0].versus ? (mode === 'online' ? net.cfg.vt : settings.versusType) : null,
      elimStart: performance.now(), elimCuts: 0
    };
    buildBoards();
    screen('gameView');
    hideOverlay();
    $('#help').innerHTML = helpText();
    players.forEach(function (p) { if (isHuman(p)) ACH.event('start', { skulls: p.skulls.length, multiplier: p.multiplier }); });
    $('#pauseBtn').classList.toggle('hidden', mode === 'online');
    $('#endBtn').classList.toggle('hidden', !(mode === 'online' && net.role === 'host'));
    G.show($('#touchPad'));
    $('#touchPad').classList.toggle('hidden', mode === 'local');
    $('#help').innerHTML = helpText();
    if (BG) {
      BG.setThemes(themesFor(players.filter(function (p) { return p.local; })[0] || players[0]), mode === 'online');
      if (mode === 'online' && net.bg) BG.show(net.bg.p, net.bg.s, net.bg.th);
    }
    last = performance.now();
    if (!raf) raf = requestAnimationFrame(loop);
  }

  // Themed backgrounds for what's being played (bits match tetris-bg.js / the VRChat world).
  function themesFor(p) {
    if (!BG || !p) return 0;
    var T = BG.TH, m = 0;
    if (p.gameType === GT.DIG || p.powerKinds.indexOf(PU.QUAKE) !== -1) m |= T.STRATA;
    if (p.gameType === GT.SURVIVAL || p.f.storm || p.f.fuse) m |= T.STORM;
    if (p.gameType === GT.SPRINT) m |= T.WARP;
    if (p.gameType === GT.ULTRA) m |= T.CLOCK;
    if (p.f.birthday) m |= T.PARTY;
    if (p.powerKinds.indexOf(PU.STAR_BOMB) !== -1) m |= T.STARS;
    if (p.f.lightsOut || p.f.blind) m |= T.FOG;
    if (p.f.mirror) m |= T.KALEIDO;
    return m;
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
    if (BG) { BG.setEnergy(0); BG.setPressure(0); BG.setDanger(0); }
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
      card.className = 'board-card' + (isHuman(p) ? ' mine' : '') + (p.cpu ? ' cpu' : '');
      var head = document.createElement('div');
      head.className = 'board-head';
      head.innerHTML = '<span class="board-name"></span><span class="board-lives"></span>';
      var nameEl = head.querySelector('.board-name');
      if (p.avatar) nameEl.appendChild(G.Profile.avatar({ name: p.name, avatar: p.avatar }, 22));
      var nameText = document.createElement('span');
      nameText.className = 'board-name-text';
      nameText.textContent = p.name;
      nameText.title = p.name;
      nameEl.appendChild(nameText);
      var cv = document.createElement('canvas');
      cv.width = (COLS + SIDE * 2) * CELL;
      cv.height = ROWS * CELL;
      var timers = document.createElement('div');
      timers.className = 'hud-timers';
      var stats = document.createElement('div');
      stats.className = 'board-stats';
      card.appendChild(head);
      card.appendChild(timers);
      card.appendChild(cv);
      card.appendChild(stats);
      wrap.appendChild(card);
      p.ui = { card: card, canvas: cv, ctx: cv.getContext('2d'), stats: stats, timers: timers, lives: head.querySelector('.board-lives'), shownTimers: '' };
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
      game.players.forEach(function (p) { if (p.cpu && p.local && p.alive) Cpu.tick(p, dt); });
      game.players.forEach(function (p) { if (p.local && p.alive && game && !game.over) stepPlayer(p, dt); });
      game.players.forEach(function (p) { if (!p.local) tickRemote(p, dt); });
      if (game && !game.over && game.versusType === 'elim') tickElimination(now);
      if (game && game.mode === 'online') netTick(now);
    }
    if (game) {
      game.players.forEach(drawPlayer);
      feedBackground();
    }
    raf = requestAnimationFrame(loop);
  }

  // Local streaks and incoming hazards drive the background without changing shared pattern choices.
  function feedBackground() {
    if (!BG) return;
    var top = 0, pressure = 0;
    game.players.forEach(function (p) {
      if (!isHuman(p) || !p.alive) return;
      if (p.streakLeft > 0 && p.streak >= STREAK.MIN) top = Math.max(top, p.streak);
      pressure = Math.max(pressure, Math.min(1, p.incoming / 8), p.frozen > 0 ? 0.75 : 0);
    });
    BG.setEnergy(top ? Math.pow(Math.min(1, top / 38), 0.8) : 0);
    BG.setPressure(pressure);
  }

  // Remote boards only receive timers when their owner sends a snapshot, so count them down here.
  function tickRemote(p, dt) {
    if (p.streakLeft > 0) p.streakLeft = Math.max(0, p.streakLeft - dt);
    p.slow = Math.max(0, p.slow - dt); p.double = Math.max(0, p.double - dt);
    p.frozen = Math.max(0, p.frozen - dt); p.haste = Math.max(0, p.haste - dt);
  }

  function pressed(p, action) {
    var list = p.controls[action];
    for (var i = 0; i < list.length; i++) if (held[list[i]]) return held[list[i]];
    return null;
  }

  function stepPlayer(p, dt) {
    // clocks: game time, power-up timers, streak window, skull hazards
    p.elapsed += dt;
    if (p.gameType === GT.SURVIVAL && p.elapsed >= 180 && !p.survivalAch) { p.survivalAch = true; ACH.event('survival', { elapsed: p.elapsed }); }
    p.slow = Math.max(0, p.slow - dt);
    p.double = Math.max(0, p.double - dt);
    p.haste = Math.max(0, p.haste - dt);
    if (p.streakLeft > 0) { p.streakLeft = Math.max(0, p.streakLeft - dt); if (!p.streakLeft) { p.streak = 0; p.streakLines = 0; } }
    if (p.f.storm) { p.stormClock += dt; if (p.stormClock >= STORM_INTERVAL) { p.stormClock -= STORM_INTERVAL; if (p.riseGarbage()) return toppedOut(p); } }
    if (p.f.fuse) { p.fuseClock += dt; if (p.fuseClock >= FUSE_SECONDS) { p.fuseClock = 0; if (p.riseGarbage()) return toppedOut(p); } }
    if (p.gameType === GT.SURVIVAL) {
      p.survivalClock += dt;
      var interval = Math.max(4, 10 - p.elapsed / 30);
      if (p.survivalClock >= interval) { p.survivalClock -= interval; if (p.riseGarbage()) return toppedOut(p); }
    }
    if (p.gameType === GT.ULTRA && p.elapsed >= ULTRA_SECONDS) { p.elapsed = ULTRA_SECONDS; p.finish = 'time'; return endSolo(); }
    if (p.frozen > 0) { p.frozen = Math.max(0, p.frozen - dt); return; } // frozen by an opponent: no moves, no gravity

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
    if (!p.piece) return;

    if (p.grounded()) {
      p.lockTimer += dt;
      if (p.lockTimer >= p.lockDelay()) afterLock(p, p.lock());
    } else {
      p.fall += dt;
      var g = gravity(p.gravityLevel());
      if (p.slow > 0) g *= SLOW_FACTOR;
      if (p.haste > 0) g /= HASTE_FACTOR;
      while (p.fall >= g) {
        p.fall -= g;
        if (!p.grounded()) p.piece.y++;
        else break;
      }
    }
    if (p.flash) p.flash = Math.max(0, p.flash - dt);
  }

  function afterLock(p, res) {
    if (res.tetris) announce(p.name + ' got a TETRIS!');
    if (isHuman(p)) ACH.event('lock', { cleared: res.cleared, tetris: res.tetris, b2b: res.b2b, combo: p.combo, perfect: res.perfect,
      score: p.score, level: p.level, streak: p.streakLeft > 0 ? p.streak : 0, powers: res.powers,
      birthday: !!p.f.birthday, lightsLines: p.lightsLines || 0 });
    if (isHuman(p) && BG) {
      if (res.cleared) {
        BG.pulse(res.tetris ? 0.8 : 0.3 + Math.min(4, res.cleared) * 0.1);
        BG.impact(res.tetris ? 1 : 0.45 + Math.min(4, res.cleared) * 0.1);
      }
      if (res.tetris || res.levelUp) {
        var look = BG.milestone();
        if (look && game.mode === 'online') netSend({ t: 'bg', p: look.p, s: look.s, th: look.th });
      }
    }
    if (res.attack) sendAttack(p, res.attack);
    sendPowerAttacks(p, res.out);
    if (res.toppedOut) return toppedOut(p);
    if (!p.versus && p.gameType === GT.SPRINT && p.lines >= SPRINT_LINES) { p.finish = 'sprint'; return endSolo(); }
    if (!p.versus && p.gameType === GT.DIG && !p.garbageRows()) { p.finish = 'dig'; return endSolo(); }
    if (game.mode === 'online') net.dirty = true;
  }

  function announce(text) {
    G.banner(text);
    if (game && game.mode === 'online') netSend({ t: 'ann', text: text });
  }

  function opponents(from) { return game.players.filter(function (q) { return q !== from && q.alive; }); }

  function sendAttack(from, n, to) {
    if (game.mode === 'solo') return;
    var targets = opponents(from);
    if (!targets.length) return;
    var target = to || targets[Math.floor(Math.random() * targets.length)];
    if (game.mode === 'online') {
      netSend({ t: 'atk', to: target.id, n: n });
      if (target.local) target.incoming += n;
    } else {
      target.incoming += n;
    }
  }

  // Versus attack power-ups: Freeze and Curse hit a random opponent, the Blue Shell hits the leader.
  function sendPowerAttacks(from, out) {
    if (!out || game.mode === 'solo' || !(out.freeze || out.shell || out.curse)) return;
    var i, targets = opponents(from);
    if (!targets.length) return;
    function hex(kind) {
      var t = targets[Math.floor(Math.random() * targets.length)];
      if (game.mode === 'online') netSend({ t: 'hex', to: t.id, k: kind });
      if (game.mode !== 'online' || t.local) receiveHex(t, kind);
    }
    for (i = 0; i < out.freeze; i++) hex('freeze');
    if (isHuman(from) && out.freeze) ACH.event('freeze');
    if (isHuman(from) && out.shell) ACH.event('shell');
    for (i = 0; i < out.curse; i++) hex('curse');
    for (i = 0; i < out.shell; i++) {
      var leader = targets.slice().sort(function (a, b) { return b.score - a.score; })[0];
      sendAttack(from, SHELL_LINES, leader);
      G.banner(leader.name + ' got hit by a Blue Shell!');
    }
  }

  function receiveHex(p, kind) {
    if (kind === 'freeze') { p.frozen = FREEZE_SECONDS; held = {}; }
    else if (kind === 'curse') p.pendingCurses++;
  }

  function toppedOut(p) {
    G.Sound.beep(140, 0.4, 'sawtooth', 0.06);
    p.streak = 0; p.streakLeft = 0;
    if (!p.versus && p.f.secondWind && !p.secondWindUsed) {
      // Second Wind: the top of the well is wiped once and play carries on.
      p.secondWindUsed = true;
      for (var r = 0; r < 12; r++) p.board[r].fill(0);
      p.spawn();
      p.flash = 0.6;
      G.banner('Second wind!');
      if (isHuman(p)) ACH.event('secondwind');
      return;
    }
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
    if (game.mode === 'local' || game.mode === 'cpu') checkWinner();
    if (game.mode === 'online') { net.dirty = true; hostCheckOnline(); }
  }

  /* ---------- elimination ---------- */

  // Every ELIM_INTERVAL seconds the lowest score still in is cut; topping out is also out (one life).
  // Local versus decides here; online, the host decides and sends 'cut'.
  function tickElimination(now) {
    var elapsed = (now - game.elimStart) / 1000;
    var due = Math.floor(elapsed / ELIM_INTERVAL), left = ELIM_INTERVAL - (elapsed - due * ELIM_INTERVAL);
    var alive = game.players.filter(function (p) { return p.alive; });
    var lowest = alive.slice().sort(function (a, b) { return a.score - b.score; })[0];
    var decide = game.mode !== 'online' || net.role === 'host';
    if (decide && due > game.elimCuts && alive.length > 1 && lowest) {
      game.elimCuts = due;
      if (game.mode === 'online') netSend({ t: 'cut', slot: lowest.id });
      eliminate(lowest);
      return;
    }
    var urgent = left <= 30;
    game.players.forEach(function (p) {
      var danger = alive.length > 1 && p === lowest;
      p.ui.card.classList.toggle('danger', danger && urgent);
      p.dangerText = p.alive ? (danger ? 'DANGER ' : 'CUT IN ') + clock(left) : '';
    });
    if (BG) {
      var mine = game.players.filter(function (p) { return p.local && p === lowest; });
      BG.setDanger(mine.length && urgent && alive.length > 1 ? 1 - left / 30 : 0);
    }
  }

  function eliminate(p) {
    if (!p || !p.alive || !game) return;
    p.alive = false;
    p.eliminated = true;
    p.piece = null;
    p.dangerText = '';
    G.banner(p.name + ' was eliminated!');
    if (game.mode === 'local' || game.mode === 'cpu') checkWinner();
    if (game.mode === 'online') { net.dirty = true; hostCheckOnline(); }
  }

  function checkWinner() {
    var alive = game.players.filter(function (p) { return p.alive; });
    if (alive.length > 1) return;
    var winner = alive[0] || game.players.slice().sort(function (a, b) { return b.score - a.score; })[0];
    finishVersus(winner.name);
  }

  function finishVersus(winnerName, fromNet) {
    if (!game) return;
    if (!game.reported) {
      game.reported = true;
      var me = game.players.filter(isHuman)[0];
      if (me) ACH.event('versus', { online: game.mode === 'online', elimination: game.versusType === 'elim',
        won: game.mode === 'online' && !!winnerName && me.name.replace(' (you)', '') === winnerName });
    }
    game.over = true;
    game.players.forEach(function (p) { if (p.ui) p.ui.card.classList.remove('danger'); });
    var scores = game.players.map(function (p) { return p.name + ': ' + p.score; }).join(' · ');
    G.Sound.beep(660, 0.5, 'triangle', 0.07);
    if (BG) BG.setDanger(0);
    if (game.mode === 'online' && net.role === 'host' && !fromNet) netSend({ t: 'over', winner: winnerName });
    var buttons = [{ label: 'Menu', onClick: quitToMenu }];
    if (game.mode === 'local') buttons.unshift({ label: 'Play again', primary: true, onClick: function () { startLocal(); } });
    if (game.mode === 'cpu') { var watch = game.spectate; buttons.unshift({ label: watch ? 'Watch again' : 'Play again', primary: true, onClick: function () { startCpu(watch); } }); }
    if (game.mode === 'online') buttons.unshift({ label: 'Back to lobby', primary: true, onClick: backToLobby });
    overlay(winnerName ? winnerName + ' wins!' : 'Game ended', scores, buttons);
  }

  function clock(seconds, tenths) {
    var whole = Math.floor(seconds);
    var s = Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
    return tenths ? s + '.' + Math.floor(seconds * 10) % 10 : s;
  }

  // Solo results: Marathon and Ultra with no skulls are ranked; Sprint and Dig keep a best time.
  function endSolo() {
    var p = game.players[0];
    game.over = true;
    ACH.event('solo', { finish: p.finish, gameType: p.gameType, elapsed: p.elapsed, score: p.score });
    var ranked = !p.skulls.length;
    var title = 'Game over', text, isBest = false;
    if (p.finish === 'sprint' || p.finish === 'dig') {
      var key = p.finish + (ranked ? '' : '_skulls');
      isBest = !bests[key] || p.elapsed < bests[key];
      if (isBest) { bests[key] = Math.round(p.elapsed * 10) / 10; G.Store.set('tetris_bests', bests); }
      title = isBest ? 'New best time!' : (p.finish === 'sprint' ? '40 lines!' : 'Dug out!');
      text = clock(p.elapsed, true) + (isBest ? '' : ' · best ' + clock(bests[key], true));
    } else {
      if (p.gameType === GT.ULTRA && ranked) {
        isBest = p.score > (bests.ultra || 0);
        if (isBest) { bests.ultra = p.score; G.Store.set('tetris_bests', bests); }
        title = isBest ? 'New best!' : 'Time!';
      } else if (p.gameType === GT.ULTRA) {
        title = 'Time!';
      } else if (p.gameType === GT.MARATHON && ranked) {
        isBest = p.score > best;
        if (isBest) { best = p.score; G.Store.set('tetris_best', best); }
        title = isBest ? 'New best!' : 'Game over';
      }
      text = p.score + ' points · ' + p.lines + ' lines · level ' + p.level;
      if (p.gameType === GT.MARATHON && ranked && !isBest) text += ' · best ' + best;
      if (!ranked) text += ' · ×' + p.multiplier + ' skulls (unranked)';
    }
    overlay(title, text, [
      { label: 'Play again', primary: true, onClick: startSolo },
      { label: 'Menu', onClick: quitToMenu }
    ]);
  }

  /* ---------- drawing ---------- */

  // 8x8 power-up icons (one row per number, leftmost pixel = bit 7), same as the VRChat board shader.
  var ICONS = {
    1: [126, 66, 36, 24, 24, 36, 90, 126], 2: [6, 8, 60, 126, 126, 126, 126, 60], 3: [24, 90, 60, 219, 219, 60, 90, 24],
    4: [24, 24, 255, 126, 60, 126, 102, 195], 5: [255, 129, 181, 153, 153, 173, 129, 255], 6: [24, 60, 90, 255, 189, 255, 66, 0],
    7: [60, 126, 219, 219, 126, 36, 60, 90], 8: [60, 126, 219, 219, 126, 36, 60, 90], 9: [0, 0, 0, 255, 0, 255, 189, 165],
    10: [8, 4, 60, 126, 106, 126, 126, 60]
  };
  var POWER_COLOUR = { 1: '#66f2ff', 2: '#ff9933', 3: '#9ecbff', 4: '#ffd640', 5: '#c7f7ff', 6: '#4d80ff', 7: '#b8ff4d', 8: '#b8ff4d', 9: '#d99a59', 10: '#ff5999' };

  function blockColor(p, row) {
    return mix(p.palette.bottom, p.palette.top, 1 - row / ROWS);
  }

  // Cache the two-colour vertical fill for each well row. A block has its own top-to-bottom gradient
  // while the board-wide palette still changes by row, matching the world's 0.65 block shading.
  function blockFill(p, row) {
    var key = p.palette.bottom + '/' + p.palette.top;
    if (p.ui.gradientKey !== key) {
      p.ui.gradientKey = key;
      p.ui.gradients = [];
      for (var r = 0; r < ROWS; r++) {
        var base = blockColor(p, r);
        var fill = p.ui.ctx.createLinearGradient(0, r * CELL + 1, 0, (r + 1) * CELL - 1);
        fill.addColorStop(0, mix(base, p.palette.top, 0.65));
        fill.addColorStop(1, mix(base, p.palette.bottom, 0.65));
        p.ui.gradients.push(fill);
      }
    }
    return p.ui.gradients[row];
  }

  function drawBlock(ctx, x, y, size, color, alpha) {
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x + 3, y + 3, size - 6, Math.max(2, size * 0.18));
    ctx.globalAlpha = 1;
  }

  function drawPowerIcon(ctx, x, y, size, kind, now) {
    var bomb = kind === PU.BOMB;
    ctx.fillStyle = bomb ? '#ff8c1f' : '#0f0c24';
    ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
    var bits = ICONS[kind] || ICONS[1], px = (size - 6) / 8;
    ctx.fillStyle = bomb ? '#140f1a' : POWER_COLOUR[kind];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      if (bits[r] & (128 >> c)) ctx.fillRect(x + 3 + c * px, y + 3 + r * px, Math.ceil(px), Math.ceil(px));
    }
    var pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now / 1000 * 6));
    ctx.strokeStyle = POWER_COLOUR[kind];
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
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
    var ctx = p.ui.ctx, ox = SIDE * CELL, now = performance.now();
    var W = p.ui.canvas.width, H = p.ui.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(4, 5, 12, 0.92)';
    ctx.fillRect(ox, 0, COLS * CELL, H);

    // side panels
    ctx.fillStyle = 'rgba(14, 10, 26, 0.66)';
    ctx.fillRect(0, 0, ox, H);
    ctx.fillRect(ox + COLS * CELL, 0, SIDE * CELL, H);
    ctx.fillStyle = '#8a7fa8';
    ctx.font = '700 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(p.f.noHold ? 'NO HOLD' : 'HOLD', ox / 2, 22);
    ctx.fillText(p.f.blind ? 'BLIND' : 'NEXT', ox + COLS * CELL + ox / 2, 22);
    if (p.hold) drawMini(ctx, p.hold, ox / 2, 64, 20, p.canHold ? blockColor(p, 6) : '#3a3350');
    if (!p.f.blind) p.queue.slice(0, 5).forEach(function (t, i) {
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

    // Lights Out: the stack shows for a second after each lock, then fades into the dark.
    var vis = 1;
    if (p.f.lightsOut && p.local && p.alive && game && !game.over) vis = 1 - clamp01((now - p.lockedAt - 1000) / 900);

    var tier = p.heatTier(), heat = tier >= 3 ? fireSpectrum(p.streak) : [0.66, 0.52, 1];
    // At 20x the stack burns in the current background highlight, including palette transitions.
    if (tier >= 3 && p.streak >= STREAK.BORDER && BG && BG.sceneColor) heat = BG.sceneColor() || heat;
    var flying = junkInFlight(p, now);
    if (vis > 0.01) {
      var blur = tier === 1 ? 8 : 14;
      if (tier) { ctx.shadowColor = rgb(heat, tier === 1 ? 0.45 : 0.75); ctx.shadowBlur = blur; }
      for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        var v = p.board[r][c];
        if (!v || (flying && flying[r * COLS + c])) continue;
        drawBlock(ctx, ox + c * CELL, r * CELL, CELL, v === GARBAGE ? '#3a3350' : blockFill(p, r), vis);
        if (v >= CELL_POWER && vis > 0.5) {
          ctx.shadowBlur = 0;
          drawPowerIcon(ctx, ox + c * CELL, r * CELL, CELL, v - CELL_POWER + 1, now);
          if (tier) ctx.shadowBlur = blur;
        }
      }
      ctx.shadowBlur = 0;
      if (tier >= 3) drawFlames(ctx, p, ox, now, heat, vis);
      if (p.alive && p.streakLeft > 0 && p.streak >= STREAK.BORDER) drawLineFlames(ctx, p, ox, now, heat, vis);
    }

    if (p.frozen > 0) { ctx.fillStyle = 'rgba(180, 230, 255, 0.28)'; ctx.fillRect(ox, 0, COLS * CELL, H); }

    drawFx(ctx, p, ox, now);
    drawJunk(ctx, p, ox, now);

    if (p.flash) {
      ctx.fillStyle = 'rgba(199, 125, 255,' + p.flash + ')';
      ctx.fillRect(ox, 0, COLS * CELL, H);
    }

    ctx.strokeStyle = 'rgba(157, 0, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 1, 1, COLS * CELL - 2, H - 2);
    var outlines = settings.streakOutlines !== 'off' && p.streakLeft > 0 && p.alive;
    if (outlines && p.streak >= STREAK.LIGHTNING) drawBorderLightning(ctx, ox, H, now, heat, p.streak);
    else if (outlines && p.streak >= STREAK.BORDER) drawBorderFire(ctx, ox, H, now, heat, p.streak);
    if (outlines && p.streak >= 30) drawOverdrive(ctx, p, ox, H, now, heat);
    if (p.piece && p.alive && tier >= 3) drawDropLane(ctx, p, ox);
    if (p.piece && p.alive && !p.f.noGhost) drawGhost(ctx, p, ox, now);
    if (p.piece && p.alive) drawActivePiece(ctx, p, ox, now, tier >= 3);
    if (p.streakLeft > 0 && p.streak >= STREAK.MIN && p.alive) drawStreakBadge(ctx, p, ox, now, tier >= 3 ? heat : [0.78, 0.6, 1]);

    if (!p.alive) {
      ctx.fillStyle = 'rgba(5,5,5,0.75)';
      ctx.fillRect(ox, 0, COLS * CELL, H);
      ctx.fillStyle = '#ff9ac8';
      ctx.font = '800 28px "JetBrains Mono", monospace';
      ctx.fillText(p.eliminated ? 'ELIMINATED' : 'OUT', ox + COLS * CELL / 2, H / 2);
    }
    p.ui.card.classList.toggle('out', !p.alive);

    var lives = p.dangerText || (p.lives === Infinity || !p.versus || p.lives <= 1 ? '' : new Array(Math.max(0, p.lives - p.losses) + 1).join('♥ '));
    if (p.ui.lives.textContent !== lives) p.ui.lives.textContent = lives;
    var stats = statsLine(p);
    if (p.ui.stats.textContent !== stats) p.ui.stats.textContent = stats;
    var timers = timersLine(p);
    if (p.ui.shownTimers !== timers) { p.ui.shownTimers = timers; p.ui.timers.innerHTML = timers; }
  }

  function statsLine(p) {
    var t = p.gameType, line;
    if (t === GT.DIG) line = p.garbageRows() + ' garbage rows left · ' + clock(p.elapsed, true);
    else if (t === GT.SURVIVAL) line = 'survived ' + clock(p.elapsed) + ' · ' + p.score + ' pts';
    else if (t === GT.SPRINT) line = Math.min(p.lines, SPRINT_LINES) + '/' + SPRINT_LINES + ' lines · ' + clock(p.elapsed, true);
    else if (t === GT.ULTRA) line = p.score + ' pts · ' + clock(Math.max(0, ULTRA_SECONDS - p.elapsed)) + ' left';
    else line = p.score + ' pts · ' + p.lines + ' lines · lvl ' + p.level;
    if (Math.abs(p.multiplier - 1) > 0.01) line += ' · ×' + p.multiplier;
    if (p.f.fuse && p.alive && p.local) line += ' · fuse ' + Math.ceil(FUSE_SECONDS - p.fuseClock) + 's';
    return line;
  }

  function timersLine(p) {
    var out = [];
    if (p.frozen > 0) out.push('<span style="color:#c7f7ff">frozen ' + Math.ceil(p.frozen) + 's</span>');
    if (p.haste > 0) out.push('<span style="color:#b8ff4d">haste ' + Math.ceil(p.haste) + 's</span>');
    if (p.slow > 0) out.push('<span style="color:#9ecbff">slow ' + Math.ceil(p.slow) + 's</span>');
    if (p.double > 0) out.push('<span style="color:#ffd640">2× ' + Math.ceil(p.double) + 's</span>');
    return out.join('');
  }

  // Pixel flames rise off each column from 10x; at 20x they take the scene highlight.
  function drawFlames(ctx, p, ox, now, heat, alpha) {
    var px = 4, t = Math.floor(now / 70), intensity = 0.8 + clamp01((p.streak - STREAK.FIRE) / 30) * 0.5;
    for (var c = 0; c < COLS; c++) {
      var top = -1;
      for (var r = 0; r < ROWS; r++) if (p.board[r][c]) { top = r; break; }
      if (top < 0) continue;
      for (var k = 0; k < 7; k++) {
        var n1 = Math.sin(c * 4.7 + k * 2.3 + t * 0.9) * 0.5 + 0.5, n2 = Math.sin(c * 2.1 - k * 1.7 + t * 1.3) * 0.5 + 0.5;
        var h = Math.max(px, Math.floor((0.25 + 0.6 * n1 * (0.5 + 0.5 * n2)) * CELL * intensity / px) * px);
        var x = ox + c * CELL + k * px, y = top * CELL - h;
        var grad = ctx.createLinearGradient(0, y, 0, top * CELL);
        grad.addColorStop(0, rgb(heat, 0));
        grad.addColorStop(0.45, rgb(heat, 0.42 * alpha));
        grad.addColorStop(1, rgb(lerp3(heat, [1, 1, 1], 0.5), 0.7 * alpha));
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, px, h);
      }
    }
  }

  // 20x+: every exposed block face (open cell above it) gives off small pixel flames. They used to rise off every
  // row to ~1 cell tall, which buried the stack and the landing spot; now they stay low and only on open edges.
  function drawLineFlames(ctx, p, ox, now, col, alpha) {
    var t = Math.floor(now / 65), power = clamp01((p.streak - STREAK.BORDER) / 25);
    var height = 6 + power * 8, width = CELL / 3;
    var outer = rgb(col, 0.65), core = rgb(lerp3(col, [1, 1, 1], 0.55), 0.8);
    ctx.save();
    ctx.globalAlpha = alpha * (0.35 + power * 0.25);
    ctx.shadowColor = rgb(col, 0.8);
    ctx.shadowBlur = 4 + power * 6;
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      if (!p.board[r][c] || (r > 0 && p.board[r - 1][c])) continue;
      for (var k = 0; k < 3; k++) {
        var flicker = Math.sin(r * 3.7 + c * 7.1 + k * 2.9 + t * 0.8) * 0.5 + 0.5;
        var h = Math.round((0.35 + flicker * 0.65) * height / 3) * 3;
        var x = ox + c * CELL + k * width, y = r * CELL - h;
        ctx.fillStyle = outer;
        ctx.fillRect(x, y, width, h);
        ctx.fillStyle = core;
        ctx.fillRect(x + width / 3, y + h * 0.45, width / 3, h * 0.55);
      }
    }
    ctx.restore();
  }

  // Fire around the whole well, growing with the streak and matching the scene colour.
  function drawBorderFire(ctx, ox, H, now, col, streak) {
    var px = 4, t = Math.floor(now / 70), w = COLS * CELL, power = clamp01((streak - STREAK.BORDER) / 25);
    ctx.save();
    ctx.shadowColor = rgb(col, 0.8);
    ctx.shadowBlur = 18 + power * 18;
    ctx.strokeStyle = rgb(col, 0.6 + 0.3 * Math.sin(now / 160));
    ctx.lineWidth = 3;
    ctx.strokeRect(ox + 2, 2, w - 4, H - 4);
    ctx.restore();
    for (var i = 0; i < w / px; i++) {
      var hb = (0.4 + 1.1 * (Math.sin(i * 4.7 + t * 0.9) * 0.5 + 0.5)) * (4 + power * 6);
      ctx.fillStyle = rgb(lerp3(col, [1, 1, 1], 0.35), 0.6);
      ctx.fillRect(ox + i * px, H - hb, px, hb);
    }
    // Side flames lick outward, away from the well, so they never hide the edge columns.
    for (var j = 0; j < H / px; j++) {
      var hs = (0.3 + 0.8 * (Math.sin(j * 3.1 - t * 1.1) * 0.5 + 0.5)) * (6 + power * 10);
      ctx.fillStyle = rgb(col, 0.5);
      ctx.fillRect(ox - hs, j * px, hs, px);
      ctx.fillRect(ox + w, j * px, hs, px);
    }
  }

  // 50x+: the fire outline becomes crackling lightning. Bolts crawl along the well's edge and fork outward;
  // nothing reaches more than a few pixels inside the well.
  function boltNoise(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function perimeterPoint(s, ox, w, H) {
    var P = 2 * (w + H);
    s = ((s % P) + P) % P;
    if (s < w) return [ox + s, 1, 0, -1];
    if (s < w + H) return [ox + w - 1, s - w, 1, 0];
    if (s < 2 * w + H) return [ox + w - (s - w - H), H - 1, 0, 1];
    return [ox + 1, H - (s - 2 * w - H), -1, 0];
  }
  function drawBorderLightning(ctx, ox, H, now, col, streak) {
    var w = COLS * CELL, P = 2 * (w + H), power = clamp01((streak - STREAK.LIGHTNING) / 30);
    var frame = reducedEffects ? 0 : Math.floor(now / 75), bolts = 5 + Math.round(power * 3);
    var core = lerp3(col, [1, 1, 1], 0.75);
    ctx.save();
    // steady electric rim underneath the bolts
    ctx.shadowColor = rgb(col, 0.9);
    ctx.shadowBlur = 14 + power * 10;
    ctx.strokeStyle = rgb(col, 0.45 + 0.25 * Math.sin(now / 90));
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 1.5, 1.5, w - 3, H - 3);
    ctx.lineJoin = 'miter';
    for (var b = 0; b < bolts; b++) {
      var seed = frame * 13 + b * 7.3;
      if (boltNoise(seed + 0.5) < 0.18) continue; // flicker: some bolts skip a frame
      var start = boltNoise(seed) * P, len = (0.12 + boltNoise(seed + 1) * 0.16) * P, steps = Math.max(4, Math.round(len / 14));
      var pts = [];
      for (var k = 0; k <= steps; k++) {
        var q = perimeterPoint(start + len * k / steps, ox, w, H), out = (k === 0 || k === steps) ? 0 : (boltNoise(seed + k * 3.1) * 9 - 2);
        pts.push([q[0] + q[2] * out, q[1] + q[3] * out]);
      }
      for (var pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        pts.forEach(function (pt, i) { if (i) ctx.lineTo(pt[0], pt[1]); else ctx.moveTo(pt[0], pt[1]); });
        ctx.strokeStyle = pass ? rgb(core, 0.95) : rgb(col, 0.7);
        ctx.lineWidth = pass ? 1.5 : 4;
        ctx.shadowBlur = pass ? 6 : 16;
        ctx.stroke();
      }
      // one fork jumping outward from the middle of the bolt
      var mid = pts[Math.floor(pts.length / 2)], mq = perimeterPoint(start + len / 2, ox, w, H), fx = mid[0], fy = mid[1];
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      for (var f = 1; f <= 3; f++) {
        var reach = f * (6 + power * 6), side = (boltNoise(seed + f * 5.7) - 0.5) * 14;
        fx = mid[0] + mq[2] * reach + mq[3] * side;
        fy = mid[1] + mq[3] * reach + mq[2] * side;
        ctx.lineTo(fx, fy);
      }
      ctx.strokeStyle = rgb(core, 0.7);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  // On fire, the falling piece's columns get a darker lane down to its landing spot, so it reads through the glow.
  function drawDropLane(ctx, p, ox) {
    var cells = p.cells(p.piece.x, p.piece.y, p.piece.rot), minC = COLS, maxC = -1, top = ROWS;
    cells.forEach(function (c) { minC = Math.min(minC, c[0]); maxC = Math.max(maxC, c[0]); top = Math.min(top, c[1]); });
    var gy = p.ghostY();
    var bottom = 0;
    p.cells(p.piece.x, gy, p.piece.rot).forEach(function (c) { bottom = Math.max(bottom, c[1] + 1); });
    top = Math.max(0, top);
    if (bottom <= top) return;
    var x = ox + minC * CELL, wd = (maxC - minC + 1) * CELL;
    var g = ctx.createLinearGradient(0, top * CELL, 0, bottom * CELL);
    g.addColorStop(0, 'rgba(4,2,10,0.12)');
    g.addColorStop(1, 'rgba(4,2,10,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(x, top * CELL, wd, (bottom - top) * CELL);
  }

  // The falling piece is drawn last, over every streak effect, with a dark rim so it stays crisp on bright fire.
  function drawActivePiece(ctx, p, ox, now, onFire) {
    var cells = p.cells(p.piece.x, p.piece.y, p.piece.rot);
    if (onFire) {
      ctx.save();
      ctx.strokeStyle = 'rgba(6,3,14,0.85)';
      ctx.lineWidth = 3;
      cells.forEach(function (cell) { if (cell[1] >= 0) ctx.strokeRect(ox + cell[0] * CELL + 0.5, cell[1] * CELL + 0.5, CELL - 1, CELL - 1); });
      ctx.restore();
    }
    cells.forEach(function (cell, i) {
      if (cell[1] < 0) return;
      ctx.shadowBlur = 12;
      ctx.shadowColor = blockColor(p, cell[1]);
      drawBlock(ctx, ox + cell[0] * CELL, cell[1] * CELL, CELL, blockFill(p, cell[1]));
      ctx.shadowBlur = 0;
      if (p.piece.power && i === p.piece.powerCell) drawPowerIcon(ctx, ox + cell[0] * CELL, cell[1] * CELL, CELL, p.piece.power, now);
    });
    ctx.globalAlpha = 1;
  }

  // Extreme streak effects stay beside the well so they never cover the landing area.
  function drawOverdrive(ctx, p, ox, H, now, col) {
    var power = clamp01((p.streak - 30) / 40), t = reducedEffects ? 0 : now / 1000;
    var width = COLS * CELL, count = 12 + Math.floor(power * 20);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 95, ox, H - 95); ctx.rect(ox + width, 95, ox, H - 95); ctx.clip();
    ctx.shadowColor = rgb(col, 0.8);
    ctx.shadowBlur = 8 + power * 12;
    for (var i = 0; i < count; i++) {
      var seed = (i * 0.6180339) % 1;
      var rise = (seed + t * (0.08 + power * 0.09)) % 1;
      var side = i % 2 ? ox + width : ox;
      var drift = 8 + seed * 35 + Math.sin(t * 1.7 + i) * 6;
      var x = side + (i % 2 ? drift : -drift), y = H - rise * (H - 90);
      ctx.fillStyle = rgb(col, Math.sin(rise * Math.PI) * (0.35 + power * 0.45));
      ctx.fillRect(x, y, 3 + power * 3, 5 + power * 10);
    }
    if (p.streak >= 50) {
      ctx.strokeStyle = rgb(col, 0.28 + power * 0.2); ctx.lineWidth = 2;
      for (var j = 0; j < 4; j++) {
        var phase = (t * 0.18 + j / 4) % 1, spread = 6 + phase * 45;
        ctx.globalAlpha = 1 - phase;
        ctx.strokeRect(ox - spread, 100 - spread, width + spread * 2, H - 100 + spread * 2);
      }
    }
    ctx.restore();
  }

  // Landing preview, drawn after the stack, flames, glow and border fire so it always reads: a dark backing line
  // for contrast, a faint fill, and a bright pulsing outline in the piece's colour.
  function drawGhost(ctx, p, ox, now) {
    var gy = p.ghostY();
    if (gy === p.piece.y) return;
    var cells = p.cells(p.piece.x, gy, p.piece.rot).filter(function (c) { return c[1] >= 0; });
    var col = blockColor(p, Math.max(0, Math.min(ROWS - 1, gy + 1)));
    var pulse = 0.75 + 0.25 * Math.sin(now / 1000 * 5);
    ctx.save();
    cells.forEach(function (c) {
      var x = ox + c[0] * CELL, y = c[1] * CELL;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
      ctx.strokeStyle = 'rgba(5, 3, 12, 0.85)';
      ctx.lineWidth = 5;
      ctx.strokeRect(x + 3.5, y + 3.5, CELL - 7, CELL - 7);
    });
    ctx.shadowColor = col;
    ctx.shadowBlur = 10;
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = mix(col, '#ffffff', 0.55);
    ctx.lineWidth = 2;
    cells.forEach(function (c) { ctx.strokeRect(ox + c[0] * CELL + 3.5, c[1] * CELL + 3.5, CELL - 7, CELL - 7); });
    ctx.restore();
  }

  // Floating "STREAK / 12x" badge over the top of the well, popping when the count rises.
  function drawStreakBadge(ctx, p, ox, now, col) {
    if (p.shownStreak !== p.streak) { p.shownStreak = p.streak; p.streakPop = now; }
    var t = reducedEffects ? 0 : now / 1000, pop = reducedEffects ? 0 : Math.max(0, 1 - (now - (p.streakPop || 0)) / 400);
    var urgency = 1 - clamp01(p.streakLeft / 5);
    var scale = 1 + Math.sin(t * (2 + urgency * 6)) * (0.03 + urgency * 0.06) + pop * pop * 0.45;
    var x = ox + COLS * CELL / 2 + Math.sin(t * 1.3) * 10, y = 70 + Math.sin(t * 1.9 + 0.7) * 8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((Math.sin(t * 1.1) * 7 - pop * 6) * Math.PI / 180);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.shadowColor = rgb(col, 0.9);
    ctx.shadowBlur = 16;
    ctx.fillStyle = rgb(lerp3(col, [1, 1, 1], 0.15));
    ctx.font = '800 13px "JetBrains Mono", monospace';
    ctx.fillText(p.streak >= 50 ? 'SUPERNOVA' : p.streak >= 30 ? 'OVERDRIVE' : 'STREAK', 0, -22);
    ctx.font = '800 38px "JetBrains Mono", monospace';
    ctx.fillText(p.streak + 'x', 0, 12);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(-46, 24, 92, 4);
    ctx.fillStyle = rgb(col);
    ctx.fillRect(-46, 24, 92 * clamp01(p.streakLeft / Math.max(STREAK.TETRIS, p.streakLeft)), 4);
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(245,240,255,0.85)';
    ctx.fillText(Math.ceil(p.streakLeft) + 's', 0, 42);
    ctx.restore();
  }

  // Power glow (row, and a bomb's column) and Birthday Party confetti.
  function drawFx(ctx, p, ox, now) {
    p.fx = p.fx.filter(function (f) { return now - f.t < 900; });
    p.fx.forEach(function (f) {
      var t = (now - f.t) / 750;
      if (t > 1) return;
      if (f.kind === 'clear') {
        var col = BG && BG.sceneColor ? BG.sceneColor() : null;
        col = col || [0.78, 0.6, 1];
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.65;
        ctx.fillStyle = rgb(col);
        f.rows.forEach(function (row) {
          var y = (row + 0.5) * CELL;
          ctx.fillRect(ox, y - 2, COLS * CELL, 4 * (1 - t));
          for (var n = 0; n < 12; n++) {
            var seed = ((n * 17 + row * 11) % 31) / 31;
            var x = ox + (n + 0.5) / 12 * COLS * CELL;
            ctx.fillRect(x + (seed - 0.5) * t * 45, y - t * (18 + seed * 35), 3, 3);
          }
        });
        ctx.restore();
        return;
      }
      if (f.kind === 'confetti') {
        f.cells.forEach(function (cell) {
          for (var n = 0; n < 3; n++) {
            var seed = (cell[0] * 13 + cell[1] * 7 + n * 31) % 97 / 97;
            var x = ox + (cell[1] + 0.5 + (seed - 0.5) * 1.6 * t) * CELL;
            var y = (cell[0] + 0.4 - t * 1.6 + t * t * 1.1) * CELL;
            ctx.fillStyle = hsvHex((seed * 360 + n * 90) % 360, 0.8, 1);
            ctx.globalAlpha = 1 - t;
            ctx.fillRect(x, y, 5, 5);
          }
        });
        ctx.globalAlpha = 1;
        return;
      }
      ctx.fillStyle = POWER_COLOUR[f.kind] || '#fff';
      ctx.globalAlpha = (1 - t) * (1 - t) * 0.85;
      f.cells.forEach(function (cell) { ctx.fillRect(ox + cell[1] * CELL, cell[0] * CELL, CELL, CELL); });
      ctx.globalAlpha = 1;
    });
  }

  // Star Bomb fly-in: each junk block pops out of the bomb in front of the stack, swells, arcs to its landing
  // spot shrinking back to size, then lands in a burst of pixels (timings match the VRChat world).
  var JUNK_STAGGER = 70, JUNK_LAND = 850, JUNK_BURST = 600;
  function junkInFlight(p, now) {
    if (!p.junk) return null;
    var map = null;
    p.junk.land.forEach(function (cell, n) {
      if (now - p.junk.t < n * JUNK_STAGGER + JUNK_LAND) { map = map || {}; map[cell[0] * COLS + cell[1]] = true; }
    });
    return map;
  }

  function drawJunk(ctx, p, ox, now) {
    if (!p.junk) return;
    var j = p.junk, total = (j.land.length - 1) * JUNK_STAGGER + JUNK_LAND + JUNK_BURST;
    if (now - j.t > total) { p.junk = null; return; }
    var fx = ox + (j.from[1] + 0.5) * CELL, fy = (j.from[0] + 0.5) * CELL;
    j.land.forEach(function (cell, n) {
      var t = (now - j.t - n * JUNK_STAGGER) / 1000;
      if (t < 0) return;
      var tx = ox + (cell[1] + 0.5) * CELL, ty = (cell[0] + 0.5) * CELL;
      var seed = ((n + 1) * 0.618) % 1;
      if (t < 0.85) {
        var dx = tx - fx + (seed - 0.5) * 2 * CELL, dy = -1.6 * CELL, len = Math.sqrt(dx * dx + dy * dy) || 1;
        var popX = fx + dx / len * 1.5 * CELL, popY = fy + dy / len * 1.5 * CELL;
        var x, y, s, glow;
        if (t < 0.3) {
          var u = t / 0.3, e = 1 - Math.pow(1 - u, 3), k = u - 1;
          x = fx + (popX - fx) * e; y = fy + (popY - fy) * e; s = 0.2 + 1.55 * (1 + 2.70158 * k * k * k + 1.70158 * k * k); glow = 1;
        } else if (t < 0.45) {
          var u2 = (t - 0.3) / 0.15;
          x = popX; y = popY - Math.sin(u2 * Math.PI) * 0.12 * CELL; s = 1.75 - 0.45 * u2; glow = 1 - u2 * 0.3;
        } else {
          var u3 = (t - 0.45) / 0.4;
          x = popX + (tx - popX) * u3; y = popY + (ty - popY) * u3 * u3 - 4 * u3 * (1 - u3) * 0.6 * CELL; s = 1.3 - 0.3 * u3; glow = 0.7 * (1 - u3) + 0.15;
        }
        var size = CELL * s;
        ctx.save();
        ctx.shadowColor = 'rgba(255, 90, 155, ' + glow + ')';
        ctx.shadowBlur = 18 * glow;
        drawBlock(ctx, x - size / 2, y - size / 2, size, t < 0.12 ? '#ffffff' : '#4c4468');
        ctx.strokeStyle = 'rgba(255, 90, 155, ' + glow * 0.85 + ')';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - size / 2, y - size / 2, size, size);
        ctx.restore();
      } else {
        var tt = t - 0.85, fade = Math.max(0, 1 - tt / 0.6);
        if (fade <= 0) return;
        var ring = Math.max(0, 1 - tt / 0.2), rr = (0.5 + tt * 2.5) * CELL;
        if (ring) { ctx.strokeStyle = 'rgba(255, 220, 240, ' + ring + ')'; ctx.lineWidth = 2; ctx.strokeRect(tx - rr, ty - rr, rr * 2, rr * 2); }
        for (var k2 = 0; k2 < 10; k2++) {
          var hk = Math.abs(Math.sin((k2 + 1) * 12.7 + seed * 57)) % 1, ang = (k2 + hk * 0.8) * 0.628, sp = (2.2 + hk * 2.5) * CELL;
          var px = tx + Math.cos(ang) * 0.45 * CELL + Math.cos(ang) * sp * tt;
          var py = ty + 0.3 * CELL - (Math.abs(Math.sin(ang)) * sp * 0.8 + 1.5 * CELL) * tt + 7 * CELL * tt * tt;
          ctx.globalAlpha = fade;
          ctx.fillStyle = k2 % 3 === 0 ? '#ffffff' : (k2 % 3 === 1 ? '#ff5999' : '#9e8cd9');
          ctx.fillRect(px, py, 4, 4);
        }
        ctx.globalAlpha = 1;
      }
    });
  }

  /* ---------- input ---------- */

  function keyName(e) { return e.key === ' ' ? ' ' : e.key.toLowerCase(); }

  function actionFor(p, k) {
    for (var a in p.controls) if (p.controls[a].indexOf(k) !== -1) return a;
    return null;
  }

  function doAction(p, a) {
    if (!p.alive || !p.piece || p.frozen > 0) return;
    if (a === 'left') p.move(-1);
    else if (a === 'right') p.move(1);
    else if (a === 'soft') p.softDrop();
    else if (a === 'cw') p.rotate(1);
    else if (a === 'ccw') p.rotate(-1);
    else if (a === 'hard') { if (BG && p.local) BG.impact(0.48); afterLock(p, p.hardDrop()); }
    else if (a === 'hold') p.holdPiece();
    if (game && game.mode === 'online') net.dirty = true;
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
      var me = game.players.filter(isHuman)[0];
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
    var p = new Player({ id: 'me', name: 'You', palette: myPalette(), local: true, controls: KEYS_SOLO, lives: 1,
      gameType: settings.gameType, skulls: settings.skulls });
    startGame('solo', [p]);
  }

  // Local versus: both players get a random colour each round. Elimination has no lives.
  function startLocal() {
    var lives = settings.versusType === 'elim' ? 1 : livesValue();
    var opts = { local: true, lives: lives, versus: true, skulls: settings.skulls };
    var a = new Player(Object.assign({ id: 'p1', name: 'Player 1', palette: roundPalette(), controls: KEYS_P1 }, opts));
    var b = new Player(Object.assign({ id: 'p2', name: 'Player 2', palette: randomPalette(), controls: KEYS_P2 }, opts));
    startGame('local', [a, b]);
  }

  // Versus CPU: you against 1-3 computer players at the chosen difficulty, each with a random colour.
  // spectate: the Konami code on the menu. Your seat goes to a CPU too, and the vs CPU roster is padded to at
  // least three bots, so you watch a CPU vs CPU vs CPU match with your rules, skulls and roster.
  function startCpu(spectate) {
    var lives = settings.versusType === 'elim' ? 1 : livesValue();
    var opts = { lives: lives, versus: true, skulls: settings.skulls };
    var players = [], roster = settings.cpuRoster.slice();
    if (spectate) {
      while (roster.length < 3) roster.push({ name: '', level: 'normal' });
    } else {
      players.push(new Player(Object.assign({ id: 'me', name: 'You', palette: roundPalette(), local: true, controls: KEYS_SOLO }, opts)));
    }
    roster.forEach(function (c, i) {
      var bot = new Player(Object.assign({ id: 'cpu' + i, name: Cpu.name(c.level, i, c.name), palette: randomPalette(), local: true, controls: Cpu.NO_KEYS }, opts));
      bot.cpu = Cpu.brain(c.level);
      players.push(bot);
    });
    startGame('cpu', players);
    game.spectate = !!spectate;
  }

  var KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  var konamiAt = 0;
  document.addEventListener('keydown', function (e) {
    var menu = $('#menuPanel');
    if (game || !menu || menu.classList.contains('hidden') || e.target.closest('input, textarea, select')) { konamiAt = 0; return; }
    var k = (e.key || '').toLowerCase();
    konamiAt = k === KONAMI[konamiAt] ? konamiAt + 1 : (k === KONAMI[0] ? 1 : 0);
    if (konamiAt === KONAMI.length) {
      konamiAt = 0;
      G.Sound.beep(1318, 0.18, 'square', 0.05);
      startCpu(true);
    }
  });

  /* =================================================================
     CPU opponents
     ================================================================= */

  // A placement-search bot. For the current piece (and the hold piece, from Normal up) it tries every rotation and
  // column, drops it, clears lines on a copy of the board and scores the result: Pierre Dellacherie's weights
  // (landing height, rows cleared, row and column transitions, holes, wells). Insane also looks one piece ahead.
  // It then plays the chosen placement with human-like timing: a pause to "think", then one input at a time.
  // Lower levels think slower, press slower, sometimes pick a worse spot and don't use hold.
  var Cpu = (function () {
    // Normal is tuned to an average player (about 40 pieces a minute, the odd misplacement, little hold use).
    // Ultra hard is the ceiling: quick and tidy, but still beatable.
    var LEVELS = {
      easy: { label: 'Easy', think: 1.1, step: 0.3, mistake: 0.38, noise: 2.2, hold: false, hard: false, look: false },
      normal: { label: 'Normal', think: 0.75, step: 0.2, mistake: 0.22, noise: 1.4, hold: false, hard: true, look: false },
      hard: { label: 'Hard', think: 0.48, step: 0.14, mistake: 0.15, noise: 1.0, hold: true, hard: true, look: false },
      ultra: { label: 'Ultra hard', think: 0.3, step: 0.1, mistake: 0.12, noise: 0.8, hold: true, hard: true, look: false }
    };
    function levelOf(key) { return key === 'insane' ? 'ultra' : (LEVELS[key] ? key : 'normal'); }
    var NO_KEYS = { left: [], right: [], soft: [], cw: [], ccw: [], hard: [], hold: [] };
    var NAMES = ['Blocky', 'Tess', 'Gridlock', 'Spin', 'Cobalt', 'Nova'];

    function cellsOf(type, rot, x, y) {
      var m = SHAPES[type][rot], out = [];
      for (var r = 0; r < m.length; r++) for (var c = 0; c < m.length; c++) if (m[r][c]) out.push([x + c, y + r]);
      return out;
    }

    function fits(board, cells) {
      for (var i = 0; i < cells.length; i++) {
        var x = cells[i][0], y = cells[i][1];
        if (x < 0 || x >= COLS || y >= ROWS) return false;
        if (y >= 0 && board[y][x]) return false;
      }
      return true;
    }

    // Every reachable-from-above placement of a piece: { rot, x, y, board (after clears), cleared, cells }.
    function placements(board, type) {
      var out = [], rots = type === 'O' ? 1 : (type === 'I' || type === 'S' || type === 'Z' ? 2 : 4);
      for (var rot = 0; rot < rots; rot++) {
        for (var x = -2; x < COLS; x++) {
          var y = -2;
          if (!fits(board, cellsOf(type, rot, x, y))) continue;
          while (fits(board, cellsOf(type, rot, x, y + 1))) y++;
          var cells = cellsOf(type, rot, x, y);
          if (cells.some(function (c) { return c[1] < 0; })) continue;
          var b = board.map(function (row) { return row.slice(); });
          cells.forEach(function (c) { b[c[1]][c[0]] = 1; });
          var cleared = 0;
          for (var r = ROWS - 1; r >= 0; r--) {
            if (b[r].every(function (v) { return v; })) { b.splice(r, 1); b.unshift(new Array(COLS).fill(0)); cleared++; r++; }
          }
          out.push({ rot: rot, x: x, y: y, board: b, cleared: cleared, cells: cells });
        }
      }
      return out;
    }

    function score(pl) {
      var b = pl.board, rowT = 0, colT = 0, holes = 0, wells = 0, r, c;
      var land = 0;
      pl.cells.forEach(function (cell) { land += ROWS - cell[1]; });
      land /= pl.cells.length;
      for (r = 0; r < ROWS; r++) {
        var prev = 1;
        for (c = 0; c < COLS; c++) { var f = b[r][c] ? 1 : 0; if (f !== prev) rowT++; prev = f; }
        if (!prev) rowT++;
      }
      for (c = 0; c < COLS; c++) {
        var above = 0, seen = false;
        for (r = 0; r < ROWS; r++) {
          var v = b[r][c] ? 1 : 0;
          if (v !== above) colT++;
          above = v;
          if (v) seen = true; else if (seen) holes++;
        }
        if (!above) colT++;
        var depth = 0;
        for (r = 0; r < ROWS; r++) {
          var left = c === 0 || b[r][c - 1], right = c === COLS - 1 || b[r][c + 1];
          if (!b[r][c] && left && right) { depth++; wells += depth; } else depth = 0;
        }
      }
      return -4.5 * land + 3.42 * pl.cleared - 3.22 * rowT - 9.35 * colT - 7.9 * holes - 3.39 * wells;
    }

    // Best plan for this player now: { hold, rot, x }.
    function plan(p, lv) {
      var options = [];
      function consider(type, viaHold, nextType) {
        placements(p.board, type).forEach(function (pl) {
          var v = score(pl);
          if (lv.look && nextType) {
            var bestNext = -Infinity;
            placements(pl.board, nextType).forEach(function (n) { bestNext = Math.max(bestNext, score(n)); });
            if (bestNext > -Infinity) v = v * 0.5 + bestNext * 0.5;
          }
          if (lv.noise) v += (Math.random() - 0.5) * lv.noise * 10;
          options.push({ hold: viaHold, rot: pl.rot, x: pl.x, v: v });
        });
      }
      consider(p.piece.type, false, p.queue[0]);
      if (lv.hold && p.canHold && !p.f.noHold) {
        var alt = p.hold || p.queue[0];
        if (alt && alt !== p.piece.type) consider(alt, true, p.hold ? p.queue[0] : p.queue[1]);
      }
      if (!options.length) return { hold: false, rot: p.piece.rot, x: p.piece.x };
      options.sort(function (a, b) { return b.v - a.v; });
      var pick = 0;
      if (lv.mistake && Math.random() < lv.mistake) pick = Math.min(options.length - 1, 1 + Math.floor(Math.random() * 4));
      return options[pick];
    }

    function brain(level) {
      level = levelOf(level);
      var lv = LEVELS[level];
      return { level: level, lv: lv, plan: null, pieceKey: '', wait: lv.think };
    }

    // One input every lv.step seconds: hold, then rotate, then slide, then drop.
    function tick(p, dt) {
      var b = p.cpu, lv = b.lv;
      if (!p.piece || p.frozen > 0) return;
      var key = p.lockedAt + ':' + p.piece.type + ':' + (p.hold || '');
      if (key !== b.pieceKey) { b.pieceKey = key; b.plan = null; b.wait = lv.think * (0.7 + Math.random() * 0.6); }
      b.wait -= dt;
      if (b.wait > 0) return;
      if (!b.plan) b.plan = plan(p, lv);
      var pl = b.plan;
      b.wait = lv.step * (0.75 + Math.random() * 0.5);
      if (pl.hold) { pl.hold = false; p.holdPiece(); b.pieceKey = p.lockedAt + ':' + p.piece.type + ':' + (p.hold || ''); return; }
      if (p.piece.rot !== pl.rot) {
        var cw = (pl.rot - p.piece.rot + 4) % 4;
        p.rotate(cw === 3 ? -1 : 1);
        if (p.piece.rot !== pl.rot && cw !== 3 && cw !== 1) return; // half-turn: keep rotating next step
        return;
      }
      var mirror = p.f.mirror ? -1 : 1; // Mirror skull flips the CPU's moves too, so it has to press the other way
      if (p.piece.x !== pl.x) {
        var dir = pl.x > p.piece.x ? 1 : -1;
        if (!p.move(dir * mirror)) b.plan = { hold: false, rot: p.piece.rot, x: p.piece.x }; // blocked: settle here
        return;
      }
      if (lv.hard) afterLock(p, p.hardDrop());
      else p.softDrop();
    }

    // A CPU's shown name: the player's choice (cleaned up), or a default, tagged with its difficulty.
    function name(level, i, custom) {
      var base = String(custom || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || NAMES[i % NAMES.length];
      return base + ' · ' + LEVELS[levelOf(level)].label + ' CPU';
    }

    return { LEVELS: LEVELS, NO_KEYS: NO_KEYS, brain: brain, tick: tick, name: name, levelOf: levelOf, NAMES: NAMES };
  })();

  /* =================================================================
     Online (host relays everything; up to 4 players)
     ================================================================= */

  // cfg: the lobby's rules, owned by the host. locked: only the host may change them; unlocked: anyone may.
  var net = { role: null, session: null, lobby: [], mySlot: null, myReady: false, dirty: false, lastSend: 0,
    cfg: { lives: settings.lives, vt: 'last', skulls: [], locked: true }, bg: null, kicked: false };

  function myPalette() {
    return settings.colour === 'custom' ? customPalette(settings.customHex, settings.customBottomHex) : (PALETTES[+settings.colour] || PALETTES[0]);
  }

  // A custom colour is a deliberate choice, so it survives the random colours handed out each round.
  function roundPalette() {
    return settings.colour === 'custom' ? myPalette() : randomPalette();
  }

  function myEntry(slot) {
    var pr = G.Profile.get(), pal = myPalette();
    return { slot: slot, name: pr.name, avatar: pr.avatar, ready: false, pal: [pal.bottom, pal.top], fixed: settings.colour === 'custom' };
  }

  function netSend(msg) {
    if (!net.session) return;
    if (net.role === 'host') { hostHandle(null, msg, true); net.session.broadcast(msg); }
    else net.session.send(msg);
  }

  function lobbyEntry(slot) { return net.lobby.filter(function (x) { return x.slot === slot; })[0]; }

  function hostBroadcastLobby() {
    net.session.conns.forEach(function (c) {
      net.session.send(c, { t: 'lobby', players: net.lobby.map(strip), cfg: net.cfg, you: c.slot, bg: net.bg });
    });
    renderLobby();
  }

  function strip(x) { return { slot: x.slot, name: x.name, avatar: x.avatar, ready: x.ready, pal: x.pal, cpu: x.cpu || null, fixed: !!x.fixed }; }

  // Host: fill an empty slot with a CPU at the chosen difficulty (the host's browser plays it).
  function hostAddCpu(level, customName, quiet) {
    if (net.role !== 'host' || game) return false;
    var used = net.lobby.map(function (x) { return x.slot; });
    var slot = [2, 3, 4].filter(function (n) { return used.indexOf(n) === -1; })[0];
    if (!slot) { if (!quiet) G.banner('The lobby is full'); return false; }
    var cpus = net.lobby.filter(function (x) { return x.cpu; }).length;
    level = Cpu.levelOf(level);
    net.lobby.push({ slot: slot, name: Cpu.name(level, cpus, customName), avatar: null, ready: true, cpu: level, pal: [PALETTES[0].bottom, PALETTES[0].top] });
    if (!quiet) hostBroadcastLobby();
    return true;
  }

  // Host: every empty slot gets a CPU at the chosen difficulty.
  function hostFillCpus(level) {
    var added = 0;
    while (hostAddCpu(level, '', true)) added++;
    if (added) hostBroadcastLobby(); else G.banner('The lobby is full');
  }

  function canEditCfg() { return net.role === 'host' || !net.cfg.locked; }

  // Changing lobby rules: the host applies directly; a guest asks the host (allowed only when unlocked).
  function changeCfg(patch) {
    if (!net.session) return;
    if (net.role === 'host') { applyCfg(patch); hostBroadcastLobby(); }
    else if (!net.cfg.locked) net.session.send({ t: 'set', cfg: patch });
  }

  function applyCfg(patch) {
    if (!patch) return;
    if (patch.lives != null && ['1', '3', '5', 'inf'].indexOf(String(patch.lives)) !== -1) net.cfg.lives = String(patch.lives);
    if (patch.vt === 'last' || patch.vt === 'elim') net.cfg.vt = patch.vt;
    if (patch.skulls) net.cfg.skulls = cleanSkulls(patch.skulls);
    if (typeof patch.locked === 'boolean') net.cfg.locked = patch.locked;
  }

  function createLobby() {
    net.role = 'host';
    net.mySlot = 1;
    net.lobby = [myEntry(1)];
    net.cfg = { lives: settings.lives, vt: settings.versusType, skulls: settings.skulls.slice(), locked: true };
    net.bg = BG ? BG.shuffle() : null;
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
        if (!conn.slot) { net.session.send(conn, { t: 'full' }); setTimeout(function () { try { conn.close(); } catch (e) { /* closed */ } }, 300); return; }
        net.lobby.push({ slot: conn.slot, name: 'Player ' + conn.slot, avatar: null, ready: false, pal: [PALETTES[0].bottom, PALETTES[0].top] });
        G.Sound.beep(660, 0.1, 'triangle');
        hostBroadcastLobby();
      },
      onData: function (conn, d) { hostHandle(conn, d, false); },
      onLeave: function (conn) {
        net.lobby = net.lobby.filter(function (x) { return x.slot !== conn.slot; });
        if (game && !game.over) {
          var p = findPlayer(conn.slot);
          if (p && p.alive) { p.alive = false; G.banner(p.name + ' left'); hostCheckOnline(); }
        } else if (net.session) hostBroadcastLobby();
      },
      onError: netError
    });
  }

  function joinLobby() {
    var code = G.cleanCode($('#joinCode').value);
    if (code.length !== 5) return netError('Lobby codes are 5 characters.');
    net.role = 'guest';
    net.kicked = false;
    setOnlineNotice('Connecting…');
    net.session = G.Net.join('tetris', code, {
      onOpen: function () {
        var me = myEntry(0);
        net.session.send({ t: 'hi', profile: G.Profile.get(), pal: me.pal, fixed: me.fixed });
        G.hide($('#lobbyCodeBox'));
        screen('lobbyPanel');
      },
      onData: guestHandle,
      onClose: function () {
        if (!net.session) return;
        net.session.close();
        net.session = null;
        if (net.kicked) { net.kicked = false; stop(); game = null; return netError('The host removed you from the lobby.'); }
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
        if (entry) {
          var pr = G.Profile.sanitize(d.profile);
          entry.name = pr.name;
          entry.avatar = pr.avatar;
          var pal = Array.isArray(d.pal) ? safePalette({ bottom: d.pal[0], top: d.pal[1] }) : PALETTES[0];
          entry.pal = [pal.bottom, pal.top];
          entry.fixed = !!d.fixed;
          hostBroadcastLobby();
        }
        break;
      case 'ready':
        if (entry) { entry.ready = !!d.v; hostBroadcastLobby(); }
        break;
      case 'set':
        // a guest's rule change, only while the host has the rules unlocked (and never the lock itself)
        if (!local && !net.cfg.locked && !game && d.cfg && typeof d.cfg === 'object') {
          applyCfg({ lives: d.cfg.lives, vt: d.cfg.vt, skulls: d.cfg.skulls });
          hostBroadcastLobby();
        }
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
      case 'hex':
        if (!local) {
          net.session.conns.forEach(function (c) { if (c.slot === d.to) net.session.send(c, { t: 'hex', to: d.to, k: d.k }); });
          var victim = findPlayer(d.to);
          if (victim && victim.local) receiveHex(victim, d.k);
        }
        break;
      case 'bg':
        net.bg = { p: +d.p || 0, s: +d.s || 1, th: !!d.th };
        if (!local) { if (BG) BG.show(net.bg.p, net.bg.s, net.bg.th); net.session.broadcast({ t: 'bg', p: net.bg.p, s: net.bg.s, th: net.bg.th }, conn); }
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
        applyCfg(d.cfg);
        if (d.bg && (!net.bg || net.bg.s !== d.bg.s)) { net.bg = d.bg; if (BG) BG.show(d.bg.p, d.bg.s, d.bg.th); }
        renderLobby();
        break;
      case 'start':
        applyCfg(d.cfg);
        beginOnline(d.players);
        break;
      case 'st':
        var p = findPlayer(d.slot);
        if (p && !p.local) p.unpack(d.s);
        break;
      case 'atk':
        var me = findPlayer(net.mySlot);
        if (me && d.to === net.mySlot) me.incoming += Math.min(10, +d.n || 0);
        break;
      case 'hex':
        var mine = findPlayer(net.mySlot);
        if (mine && d.to === net.mySlot) receiveHex(mine, d.k);
        break;
      case 'cut':
        if (game) eliminate(findPlayer(d.slot));
        break;
      case 'bg':
        net.bg = { p: +d.p || 0, s: +d.s || 1, th: !!d.th };
        if (BG) BG.show(net.bg.p, net.bg.s, net.bg.th);
        break;
      case 'kick':
        net.kicked = true;
        break;
      case 'full':
        net.kicked = false;
        setOnlineNotice('That lobby is full.', true);
        break;
      case 'end':
        if (game && !game.over) finishVersus('', true);
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

  // Start: every player is dealt a random colour for the round.
  function hostStartIfReady() {
    if (net.role !== 'host') return;
    if (net.lobby.length < 2) { G.banner('Need at least 2 players'); return; }
    if (!net.lobby.every(function (x) { return x.ready; })) { G.banner('Everyone needs to be ready'); return; }
    var players = net.lobby.map(function (x) {
      var s = strip(x);
      if (!(s.fixed && Array.isArray(s.pal))) { var pal = randomPalette(); s.pal = [pal.bottom, pal.top]; }
      return s;
    });
    var msg = { t: 'start', players: players, cfg: net.cfg };
    net.session.broadcast(msg);
    beginOnline(players);
  }

  function beginOnline(list) {
    var lv = net.cfg.vt === 'elim' ? 1 : livesValue(net.cfg.lives);
    var players = list.slice().sort(function (a, b) { return a.slot - b.slot; }).map(function (x) {
      var mine = x.slot === net.mySlot;
      var pal = Array.isArray(x.pal) ? { bottom: x.pal[0], top: x.pal[1] } : null;
      if (x.cpu) {
        // CPU slots are simulated by the host and arrive on everyone else as normal snapshots
        var bot = new Player({ id: x.slot, name: String(x.name || 'CPU').slice(0, 40), palette: pal, local: net.role === 'host',
          controls: Cpu.NO_KEYS, lives: lv, versus: true, skulls: net.cfg.skulls });
        if (net.role === 'host') bot.cpu = Cpu.brain(x.cpu);
        return bot;
      }
      var pr = G.Profile.sanitize({ name: x.name, avatar: x.avatar });
      return new Player({ id: x.slot, name: mine ? pr.name + ' (you)' : pr.name, avatar: pr.avatar, palette: pal, local: mine,
        controls: KEYS_SOLO, lives: lv, versus: true, skulls: net.cfg.skulls });
    });
    net.lobby.forEach(function (x) { x.ready = !!x.cpu; });
    net.myReady = false;
    startGame('online', players);
  }

  // Host: end the round for everyone; everyone gets the results with "Back to lobby".
  function hostEndGame() {
    if (net.role !== 'host' || !game || game.over) return;
    net.session.broadcast({ t: 'end' });
    finishVersus('', true);
  }

  function hostKick(slot) {
    if (net.role !== 'host' || slot === 1 || !net.session) return;
    var entry = lobbyEntry(slot);
    if (entry && entry.cpu) { net.lobby = net.lobby.filter(function (x) { return x.slot !== slot; }); hostBroadcastLobby(); return; }
    var conn = net.session.conns.filter(function (c) { return c.slot === slot; })[0];
    if (!conn) return;
    net.session.send(conn, { t: 'kick' });
    setTimeout(function () { try { conn.close(); } catch (e) { /* already closed */ } }, 150);
  }

  function netTick(now) {
    var me = findPlayer(net.mySlot);
    if (!me) return;
    if (now - net.lastSend > (net.dirty ? 60 : 250)) {
      net.lastSend = now;
      net.dirty = false;
      var s = me.pack();
      if (net.role === 'host') {
        net.session.broadcast({ t: 'st', slot: net.mySlot, s: s });
        // the host also publishes the CPUs it runs
        game.players.forEach(function (p) { if (p.cpu && p.local) net.session.broadcast({ t: 'st', slot: p.id, s: p.pack() }); });
        hostCheckOnline();
      } else net.session.send({ t: 'st', s: s });
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
      var pr = G.Profile.sanitize({ name: x.name, avatar: x.avatar });
      var li = G.lobbyRow(pr, pr.name + (x.slot === 1 ? ' (host)' : '') + (x.slot === net.mySlot ? ' · you' : ''), x.ready ? '✓ Ready' : 'Not ready', x.ready ? 'ready' : 'waiting');
      if (Array.isArray(x.pal)) {
        var sw = document.createElement('span');
        sw.className = 'lobby-swatch';
        sw.style.background = 'linear-gradient(to top, ' + safePalette({ bottom: x.pal[0], top: x.pal[1] }).bottom + ', ' + safePalette({ bottom: x.pal[0], top: x.pal[1] }).top + ')';
        li.firstChild.appendChild(sw);
      }
      if (net.role === 'host' && x.slot !== 1) {
        var kick = document.createElement('button');
        kick.type = 'button';
        kick.className = 'lobby-kick';
        kick.textContent = x.cpu ? 'Remove' : 'Kick';
        kick.addEventListener('click', function () { hostKick(x.slot); });
        li.firstChild.appendChild(kick);
      }
      list.appendChild(li);
    });
    for (var i = net.lobby.length; i < 4; i++) {
      list.appendChild(G.lobbyRow(null, 'Open slot', '', 'waiting'));
    }
    var mine = lobbyEntry(net.mySlot);
    net.myReady = !!(mine && mine.ready);
    $('#readyBtn').textContent = net.myReady ? 'Not ready' : 'Ready';
    $('#startBtn').classList.toggle('hidden', net.role !== 'host');
    $('#cpuAddRow').classList.toggle('hidden', net.role !== 'host' || net.lobby.length >= 4);
    var editable = canEditCfg(), elim = net.cfg.vt === 'elim';
    $('#lobbyLivesRow').classList.toggle('hidden', elim);
    if (lobbyChips.lives) lobbyChips.lives.set(net.cfg.lives);
    if (lobbyChips.vt) lobbyChips.vt.set(net.cfg.vt);
    Array.prototype.forEach.call(document.querySelectorAll('#lobbyRules .chip'), function (b) { b.disabled = !editable; });
    $('#lobbyLivesText').textContent = (elim ? 'Elimination: top out and you\'re out; every 3:00 the lowest score is cut'
      : 'Last Standing · lives: ' + (net.cfg.lives === 'inf' ? '∞' : net.cfg.lives)) +
      (editable ? '' : ' · only the host can change the rules');
    $('#lockBtn').classList.toggle('hidden', net.role !== 'host');
    $('#lockBtn').textContent = net.cfg.locked ? 'Rules: host only' : 'Rules: everyone';
    renderSkullSummary($('#lobbySkulls'), net.cfg.skulls);
    $('#lobbySkullsBtn').disabled = !editable;
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
     Skulls
     ================================================================= */

  // The skulls page edits either your own skulls (solo / local versus) or the online lobby's (host, or anyone
  // when the host has unlocked the rules).
  var skullsTarget = 'menu', skullsSelected = 0, skullsReturn = 'menuPanel';

  function iconEl(index) {
    var s = document.createElement('span');
    s.className = 'skull-icon';
    s.style.backgroundPosition = (index / (SKULLS.length - 1) * 100) + '% 0';
    s.setAttribute('aria-hidden', 'true');
    return s;
  }

  function activeSkulls() { return skullsTarget === 'lobby' ? net.cfg.skulls : settings.skulls; }

  function setActiveSkulls(list) {
    list = cleanSkulls(list);
    if (skullsTarget === 'lobby') { if (net.role === 'host') net.cfg.skulls = list; changeCfg({ skulls: list }); }
    else { settings.skulls = list; G.Store.set('tetris_skulls', list); }
  }

  function openSkulls(target) {
    skullsTarget = target;
    skullsReturn = currentScreen;
    renderSkullsPage();
    screen('skullsPanel');
  }

  function renderSkullsPage() {
    var on = activeSkulls();
    var groups = { mod: $('#skullsMods'), power: $('#skullsPowers'), attack: $('#skullsAttacks') };
    Object.keys(groups).forEach(function (k) { groups[k].textContent = ''; });
    SKULLS.forEach(function (s, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'skull-card' + (on.indexOf(s.id) !== -1 ? ' on' : '');
      b.setAttribute('aria-pressed', on.indexOf(s.id) !== -1 ? 'true' : 'false');
      b.appendChild(iconEl(i));
      var n = document.createElement('span'); n.textContent = s.name; b.appendChild(n);
      var d = document.createElement('span'); d.className = 'skull-delta'; d.textContent = effText(s.eff); b.appendChild(d);
      b.addEventListener('mouseenter', function () { skullsSelected = i; renderSkullDetail(); });
      b.addEventListener('focus', function () { skullsSelected = i; renderSkullDetail(); });
      b.addEventListener('click', function () {
        skullsSelected = i;
        var list = activeSkulls().slice(), at = list.indexOf(s.id);
        if (at === -1) list.push(s.id); else list.splice(at, 1);
        setActiveSkulls(list);
        renderSkullsPage();
      });
      groups[s.cat].appendChild(b);
    });
    renderSkullDetail();
    var m = multiplierOf(on);
    var el = $('#skullsMultiplier');
    el.textContent = 'Score multiplier ×' + m;
    el.className = 'multiplier' + (m > 1 ? ' up' : m < 1 ? ' down' : '');
  }

  function renderSkullDetail() {
    var s = SKULLS[skullsSelected], on = activeSkulls().indexOf(s.id) !== -1;
    var box = $('#skullDetail');
    box.textContent = '';
    box.appendChild(iconEl(skullsSelected));
    var cat = document.createElement('div');
    cat.className = 'cat ' + s.cat;
    cat.textContent = s.cat === 'mod' ? 'Modifier' : s.cat === 'power' ? 'Power-up' : 'Versus attack';
    var h = document.createElement('h3'); h.textContent = s.name;
    var p = document.createElement('p'); p.textContent = s.body;
    var e = document.createElement('div');
    e.className = 'eff multiplier' + (s.eff > 0 ? ' up' : s.eff < 0 ? ' down' : '');
    e.textContent = 'Score multiplier ' + effText(s.eff) + (on ? ' · ON' : ' · OFF');
    [cat, h, p, e].forEach(function (x) { box.appendChild(x); });
  }

  function renderSkullSummary(el, list) {
    el.textContent = '';
    if (!list.length) {
      var none = document.createElement('span');
      none.className = 'type-note';
      none.textContent = 'No skulls · classic rules · ranked';
      el.appendChild(none);
      return;
    }
    list.forEach(function (id) { var ic = iconEl(SKULL_BY_ID[id].index); ic.title = SKULL_BY_ID[id].name; el.appendChild(ic); });
    var m = multiplierOf(list), mt = document.createElement('span');
    mt.className = 'multiplier' + (m > 1 ? ' up' : m < 1 ? ' down' : '');
    mt.textContent = '×' + m;
    el.appendChild(mt);
  }

  /* =================================================================
     Menu wiring
     ================================================================= */

  function renderMenuBest() {
    var parts = [];
    if (best) parts.push('Marathon best ' + best);
    if (bests.ultra) parts.push('Ultra best ' + bests.ultra);
    if (bests.sprint) parts.push('Sprint best ' + clock(bests.sprint, true));
    if (bests.dig) parts.push('Dig best ' + clock(bests.dig, true));
    $('#menuBest').textContent = parts.join(' · ');
    $('#gameTypeNote').textContent = GT_INFO[settings.gameType] + (settings.skulls.length ? ' · skulls on: unranked' : '');
    renderSkullSummary($('#menuSkulls'), settings.skulls);
    $('#livesChips').classList.toggle('hidden', settings.versusType === 'elim');
  }

  function renderSkins() {
    var row = $('#skinRow');
    row.textContent = '';
    PALETTES.forEach(function (pal, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'skin-btn' + (settings.colour === String(i) ? ' active' : '');
      b.title = pal.name;
      b.setAttribute('aria-label', pal.name);
      b.style.background = 'linear-gradient(to top, ' + pal.bottom + ', ' + pal.top + ')';
      b.addEventListener('click', function () {
        settings.colour = String(i);
        G.Store.set('tetris_colour', settings.colour);
        G.hide($('#colourPicker'));
        renderSkins();
      });
      row.appendChild(b);
    });
    var c = customPalette(settings.customHex, settings.customBottomHex);
    var cb = document.createElement('button');
    cb.type = 'button';
    cb.className = 'skin-btn custom-colour' + (settings.colour === 'custom' ? ' active' : '');
    cb.title = 'Custom colour';
    cb.setAttribute('aria-label', 'Custom colour');
    cb.style.background = 'linear-gradient(to top, ' + c.bottom + ', ' + c.top + ')';
    cb.innerHTML = '<span class="custom-plus">+</span>';
    cb.addEventListener('click', function () {
      settings.colour = 'custom';
      G.Store.set('tetris_colour', 'custom');
      renderSkins();
      G.show($('#colourPicker'));
      Picker.set('top');
    });
    row.appendChild(cb);
  }

  /* ---------- custom colour picker (HSV) ---------- */

  var Picker = (function () {
    var h = 280, sat = 1, val = 1, stop = 'top';

    function hexToHsv(hex) {
      var r = parseInt(hex.substr(1, 2), 16) / 255, g = parseInt(hex.substr(3, 2), 16) / 255, b = parseInt(hex.substr(5, 2), 16) / 255;
      var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, hh = 0;
      if (d) {
        if (max === r) hh = ((g - b) / d) % 6;
        else if (max === g) hh = (b - r) / d + 2;
        else hh = (r - g) / d + 4;
        hh *= 60;
        if (hh < 0) hh += 360;
      }
      return { h: hh, s: max ? d / max : 0, v: max };
    }

    function selectedHex() {
      var pal = customPalette(settings.customHex, settings.customBottomHex);
      return stop === 'bottom' ? pal.bottom : pal.top;
    }

    function controls() {
      var hex = selectedHex(), pal = customPalette(settings.customHex, settings.customBottomHex);
      $('#cpArea').style.background = 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(' + h + ', 100%, 50%))';
      $('#cpThumb').style.left = (sat * 100) + '%';
      $('#cpThumb').style.top = ((1 - val) * 100) + '%';
      $('#cpThumb').style.background = hex;
      $('#cpHueThumb').style.left = (h / 360 * 100) + '%';
      $('#cpHueThumb').style.background = 'hsl(' + h + ', 100%, 50%)';
      $('#cpHex').value = hex;
      $('#cpHex').setAttribute('aria-label', (stop === 'top' ? 'Top' : 'Bottom') + ' gradient colour hex');
      $('#cpPreview').style.background = 'linear-gradient(to top, ' + pal.bottom + ', ' + pal.top + ')';
      [['top', '#cpTopStop', pal.top], ['bottom', '#cpBottomStop', pal.bottom]].forEach(function (part) {
        var button = $(part[1]), active = stop === part[0];
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
        button.querySelector('.cp-stop-swatch').style.background = part[2];
      });
      var cb = document.querySelector('.custom-colour');
      if (cb) cb.style.background = $('#cpPreview').style.background;
    }

    function paint() {
      var hex = hsvHex(h, sat, val);
      if (stop === 'bottom') {
        settings.customBottomHex = hex;
        G.Store.set('tetris_custom_bottom', hex);
      } else {
        settings.customHex = hex;
        G.Store.set('tetris_custom_hex', hex);
      }
      controls();
    }

    function setStop(which) {
      stop = which === 'bottom' ? 'bottom' : 'top';
      // Keep the old one-colour appearance until Bottom is selected for editing.
      if (stop === 'bottom' && !HEX_RE.test(settings.customBottomHex || '')) {
        settings.customBottomHex = customPalette(settings.customHex).bottom;
        G.Store.set('tetris_custom_bottom', settings.customBottomHex);
      }
      var hsv = hexToHsv(selectedHex());
      h = hsv.h; sat = hsv.s; val = hsv.v;
      controls();
    }

    function drag(el, onMove) {
      el.addEventListener('pointerdown', function (e) {
        el.setPointerCapture(e.pointerId);
        onMove(e);
        function move(ev) { onMove(ev); }
        function up() { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); }
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      });
    }

    function frac(e, el) {
      var r = el.getBoundingClientRect();
      return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
    }

    function init() {
      $('#cpTopStop').addEventListener('click', function () { setStop('top'); });
      $('#cpBottomStop').addEventListener('click', function () { setStop('bottom'); });
      drag($('#cpArea'), function (e) { var f = frac(e, $('#cpArea')); sat = f.x; val = 1 - f.y; paint(); });
      drag($('#cpHue'), function (e) { h = frac(e, $('#cpHue')).x * 360; paint(); });
      $('#cpHex').addEventListener('input', function () {
        var v = $('#cpHex').value.trim();
        if (!/^#/.test(v)) v = '#' + v;
        if (HEX_RE.test(v)) { var hsv = hexToHsv(v.toLowerCase()); h = hsv.h; sat = hsv.s; val = hsv.v; paint(); }
      });
      $('#cpDone').addEventListener('click', function () { G.hide($('#colourPicker')); renderSkins(); });
    }

    return { init: init, set: setStop };
  })();

  // Shuffle: the next background on a random hue. Online, everyone in the lobby gets the same one.
  function shuffleBackground() {
    if (!BG) return;
    var pick = BG.shuffle();
    if (net.session) netSend({ t: 'bg', p: pick.p, s: pick.s });
  }

  var lobbyChips = {};

  /* ---------- vs CPU roster (menu) ---------- */

  function saveCpuRoster() { G.Store.set('tetris_cpu_roster', settings.cpuRoster); }

  // One row per opponent: name, difficulty, remove. Up to three.
  function renderCpuRoster() {
    var box = $('#cpuRoster');
    box.textContent = '';
    settings.cpuRoster.forEach(function (c, i) {
      var row = document.createElement('div');
      row.className = 'cpu-row';
      var tag = document.createElement('span');
      tag.className = 'cpu-row-tag';
      tag.textContent = 'CPU ' + (i + 1);
      var name = document.createElement('input');
      name.className = 'text-input';
      name.maxLength = 20;
      name.placeholder = Cpu.NAMES[i % Cpu.NAMES.length];
      name.value = c.name;
      name.setAttribute('aria-label', 'Name for CPU ' + (i + 1));
      name.addEventListener('input', function () { c.name = name.value.slice(0, 20); saveCpuRoster(); });
      var lvl = document.createElement('select');
      lvl.className = 'text-input';
      lvl.setAttribute('aria-label', 'Difficulty for CPU ' + (i + 1));
      Object.keys(Cpu.LEVELS).forEach(function (k) {
        var o = document.createElement('option');
        o.value = k;
        o.textContent = Cpu.LEVELS[k].label;
        if (Cpu.levelOf(c.level) === k) o.selected = true;
        lvl.appendChild(o);
      });
      lvl.addEventListener('change', function () { c.level = lvl.value; saveCpuRoster(); });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'cpu-row-del';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Remove CPU ' + (i + 1));
      del.disabled = settings.cpuRoster.length <= 1;
      del.addEventListener('click', function () { settings.cpuRoster.splice(i, 1); saveCpuRoster(); renderCpuRoster(); });
      [tag, name, lvl, del].forEach(function (x) { row.appendChild(x); });
      box.appendChild(row);
    });
    $('#cpuAddOpponent').classList.toggle('hidden', settings.cpuRoster.length >= 3);
    $('#modeCpu').querySelector('span').textContent = 'You against ' + settings.cpuRoster.length + ' computer player' + (settings.cpuRoster.length > 1 ? 's' : '');
  }

  function init() {
    if (BG) BG.mount($('.game-page'));
    renderSkins();
    Picker.init();
    renderMenuBest();
    G.Profile.mount($('#profileEditor'), function () {
      if (net.role === 'host' && net.session) {
        var me = lobbyEntry(1), pr = G.Profile.get();
        if (me) { me.name = pr.name; me.avatar = pr.avatar; hostBroadcastLobby(); }
      }
    });

    G.chips($('#livesChips'), settings.lives, function (v) { settings.lives = v; G.Store.set('tetris_lives', v); });
    G.chips($('#streakOutlineChips'), settings.streakOutlines, function (v) { settings.streakOutlines = v; G.Store.set('tetris_streak_outlines', v); });
    G.chips($('#gameTypeChips'), settings.gameType, function (v) { settings.gameType = v; G.Store.set('tetris_game_type', v); renderMenuBest(); });
    G.chips($('#versusTypeChips'), settings.versusType, function (v) { settings.versusType = v; G.Store.set('tetris_versus_type', v); renderMenuBest(); });
    lobbyChips.lives = G.chips($('#lobbyLivesChips'), net.cfg.lives, function (v) { if (canEditCfg()) changeCfg({ lives: v }); else renderLobby(); });
    lobbyChips.vt = G.chips($('#lobbyVersusChips'), net.cfg.vt, function (v) { if (canEditCfg()) changeCfg({ vt: v }); else renderLobby(); });

    $('#modeSolo').addEventListener('click', startSolo);
    $('#modeLocal').addEventListener('click', startLocal);
    $('#modeOnline').addEventListener('click', function () {
      setOnlineNotice(G.Net.available() ? 'Play with up to 4 people. Clearing lines sends garbage to your opponents.' : 'Online play couldn\'t load on this network.', !G.Net.available());
      screen('onlinePanel');
    });
    $('#skullsBtn').addEventListener('click', function () { openSkulls('menu'); });
    $('#lobbySkullsBtn').addEventListener('click', function () { if (canEditCfg()) openSkulls('lobby'); });
    $('#skullsDone').addEventListener('click', function () {
      screen(skullsReturn);
      if (skullsReturn === 'lobbyPanel') renderLobby(); else renderMenuBest();
    });
    $('#skullsClear').addEventListener('click', function () { setActiveSkulls([]); renderSkullsPage(); });
    $('#lockBtn').addEventListener('click', function () { if (net.role === 'host') changeCfg({ locked: !net.cfg.locked }); });
    $('#shuffleBg').addEventListener('click', shuffleBackground);
    $('#lobbyShuffleBg').addEventListener('click', shuffleBackground);
    $('#hudShuffleBg').addEventListener('click', shuffleBackground);
    $('#achBtn').addEventListener('click', function () { ACH.open(); });
    $('#hudAch').addEventListener('click', function () { ACH.open(); });
    if (ACH.onOpen) ACH.onOpen(function () { if (game && !game.over && !game.paused && game.mode !== 'online') setPaused(true); });
    $('#modeCpu').addEventListener('click', function () { startCpu(false); });
    renderCpuRoster();
    $('#cpuAddOpponent').addEventListener('click', function () {
      if (settings.cpuRoster.length >= 3) return;
      var last = settings.cpuRoster[settings.cpuRoster.length - 1];
      settings.cpuRoster.push({ name: '', level: last ? last.level : 'normal' });
      saveCpuRoster();
      renderCpuRoster();
    });
    $('#addCpuBtn').addEventListener('click', function () {
      if (hostAddCpu($('#addCpuLevel').value, $('#addCpuName').value)) $('#addCpuName').value = '';
    });
    $('#fillCpuBtn').addEventListener('click', function () { hostFillCpus($('#addCpuLevel').value); });
    var paintAch = function () { var c = ACH.count(); $('#achCount').textContent = c.unlocked + '/' + c.total; };
    ACH.onChange(paintAch);
    paintAch();
    $('#endBtn').addEventListener('click', hostEndGame);
    $('#createLobby').addEventListener('click', createLobby);
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

  // Testing aid, only with ?debug in the URL: lets the console inspect and poke the running game.
  if (/[?&]debug\b/.test(location.search)) window.TetrisDebug = {
    game: function () { return game; }, PU: PU, bg: BG,
    // simulate `seconds` of play at 60 steps a second without drawing (for testing in a background tab)
    advance: function (seconds) {
      for (var k = 0; k < seconds * 60 && game && !game.over && !game.paused; k++) {
        var dt = 1 / 60;
        game.players.forEach(function (p) { if (p.cpu && p.local && p.alive) Cpu.tick(p, dt); });
        game.players.forEach(function (p) { if (p.local && p.alive && game && !game.over) stepPlayer(p, dt); });
      }
      return game && game.players.map(function (p) { return p.name + ': ' + p.lines + ' lines ' + p.score + ' pts ' + (p.alive ? 'in' : 'out'); });
    }
  };
})();
