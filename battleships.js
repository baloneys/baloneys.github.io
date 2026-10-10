// battleships.js: Battleships for kanaris-beans.com. vs CPU and online (PeerJS).
(function () {
  'use strict';

  var G = window.Games;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  // Achievements (battleships-achievements.js), animated backgrounds (battleships-bg.js), and profiles /
  // friends / invites / leaderboard / lobby finder (games-social.js, null when it's off). Each is optional.
  var ACH = window.BattleshipsAchievements || { event: function () {}, open: function () {}, count: function () { return { unlocked: 0, total: 0 }; }, onChange: function () {} };
  var BG = window.BattleshipsBG || null;
  var SOC = window.GameSocial && window.GameSocial.enabled ? window.GameSocial : null;

  var N = 10;
  var FLEET = [
    { id: 'carrier', name: 'Carrier', size: 5 },
    { id: 'battleship', name: 'Battleship', size: 4 },
    { id: 'cruiser', name: 'Cruiser', size: 3 },
    { id: 'submarine', name: 'Submarine', size: 3 },
    { id: 'destroyer', name: 'Destroyer', size: 2 }
  ];
  var LETTERS = 'ABCDEFGHIJ';

  var settings = { mode: null, difficulty: G.Store.get('bs_difficulty', 'normal') };
  var stats = G.Store.get('bs_stats', { wins: 0, losses: 0 });

  var state = null;
  var placing = null;

  /* =================================================================
     Board helpers
     ================================================================= */

  function emptyGrid(v) {
    var g = [];
    for (var r = 0; r < N; r++) g.push(new Array(N).fill(v));
    return g;
  }

  function shipCells(ship) {
    var out = [];
    for (var i = 0; i < ship.size; i++) out.push(ship.horizontal ? [ship.r, ship.c + i] : [ship.r + i, ship.c]);
    return out;
  }

  function fits(ships, ship, ignoreId) {
    var cells = shipCells(ship);
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i][0], c = cells[i][1];
      if (r < 0 || c < 0 || r >= N || c >= N) return false;
    }
    return !ships.some(function (o) {
      if (o.id === ignoreId || o.r == null) return false;
      return shipCells(o).some(function (a) { return cells.some(function (b) { return a[0] === b[0] && a[1] === b[1]; }); });
    });
  }

  function randomFleet() {
    var ships = [];
    FLEET.forEach(function (f) {
      for (var tries = 0; tries < 500; tries++) {
        var s = { id: f.id, name: f.name, size: f.size, horizontal: Math.random() < 0.5, r: Math.floor(Math.random() * N), c: Math.floor(Math.random() * N) };
        if (fits(ships, s)) { ships.push(s); return; }
      }
    });
    return ships;
  }

  function shipAt(ships, r, c) {
    for (var i = 0; i < ships.length; i++) {
      if (ships[i].r == null) continue;
      if (shipCells(ships[i]).some(function (x) { return x[0] === r && x[1] === c; })) return ships[i];
    }
    return null;
  }

  // Resolves a shot against a fleet. shots: grid of null | 'miss' | 'hit'
  function resolveShot(ships, shots, r, c) {
    var ship = shipAt(ships, r, c);
    if (!ship) { shots[r][c] = 'miss'; return { result: 'miss' }; }
    shots[r][c] = 'hit';
    var sunk = shipCells(ship).every(function (x) { return shots[x[0]][x[1]] === 'hit'; });
    var allSunk = ships.every(function (s) { return shipCells(s).every(function (x) { return shots[x[0]][x[1]] === 'hit'; }); });
    return { result: sunk ? 'sunk' : 'hit', ship: sunk ? { id: ship.id, name: ship.name, size: ship.size, r: ship.r, c: ship.c, horizontal: ship.horizontal } : null, win: allSunk };
  }

  /* =================================================================
     CPU
     ================================================================= */

  function cpuPick(ai) {
    var shots = ai.shots;
    function free(r, c) { return r >= 0 && c >= 0 && r < N && c < N && !shots[r][c]; }

    if (settings.difficulty === 'easy') {
      var opts = [];
      for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (free(r, c)) opts.push([r, c]);
      return opts[Math.floor(Math.random() * opts.length)];
    }

    // Normal targets known hits but explores high-probability squares; hard and ultra
    // use the fleet heat map more consistently. Ultra always takes its best square.
    var remaining = FLEET.filter(function (f) { return ai.sunk.indexOf(f.id) === -1; });
    var heat = emptyGrid(0);
    var unsunkHits = [];
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) if (shots[r][c] === 'hit' && !ai.sunkCells[r + ',' + c]) unsunkHits.push([r, c]);

    remaining.forEach(function (f) {
      [true, false].forEach(function (h) {
        for (var r0 = 0; r0 < N; r0++) for (var c0 = 0; c0 < N; c0++) {
          var cells = [], ok = true, covers = 0;
          for (var i = 0; i < f.size; i++) {
            var rr = h ? r0 : r0 + i, cc = h ? c0 + i : c0;
            if (rr >= N || cc >= N) { ok = false; break; }
            var s = shots[rr][cc];
            if (s === 'miss' || (s === 'hit' && ai.sunkCells[rr + ',' + cc])) { ok = false; break; }
            if (s === 'hit') covers++;
            cells.push([rr, cc]);
          }
          if (!ok) continue;
          if (unsunkHits.length && !covers) continue;
          var weight = unsunkHits.length ? 1 + covers * 10 : 1;
          cells.forEach(function (x) { if (!shots[x[0]][x[1]]) heat[x[0]][x[1]] += weight; });
        }
      });
    });

    var bestV = -1, best = [];
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
      if (!free(r, c)) continue;
      var v = heat[r][c] + ((r + c) % 2 === 0 && !unsunkHits.length ? 0.5 : 0);
      if (v > bestV) { bestV = v; best = [[r, c]]; }
      else if (v === bestV) best.push([r, c]);
    }
    if (settings.difficulty === 'ultra') return best[Math.floor(Math.random() * best.length)];
    var candidates = [];
    var tolerance = settings.difficulty === 'normal' ? 0.55 : 0.2;
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
      if (!free(r, c)) continue;
      var score = heat[r][c] + ((r + c) % 2 === 0 && !unsunkHits.length ? 0.5 : 0);
      if (score >= bestV * tolerance) candidates.push({ cell: [r, c], score: Math.max(1, score) });
    }
    var total = candidates.reduce(function (sum, entry) { return sum + entry.score; }, 0);
    var roll = Math.random() * total;
    for (var k = 0; k < candidates.length; k++) {
      roll -= candidates[k].score;
      if (roll <= 0) return candidates[k].cell;
    }
    return best[Math.floor(Math.random() * best.length)];
  }

  /* =================================================================
     Screens + rendering
     ================================================================= */

  var SCREENS = ['menuPanel', 'onlinePanel', 'lobbyPanel', 'placeView', 'battleView'];
  function screen(id) { SCREENS.forEach(function (s) { $('#' + s).classList.toggle('hidden', s !== id); }); }

  function buildGrid(el, onCell) {
    el.textContent = '';
    var corner = document.createElement('div');
    corner.className = 'bs-label';
    el.appendChild(corner);
    for (var c = 0; c < N; c++) { var h = document.createElement('div'); h.className = 'bs-label'; h.textContent = c + 1; el.appendChild(h); }
    for (var r = 0; r < N; r++) {
      var l = document.createElement('div');
      l.className = 'bs-label';
      l.textContent = LETTERS[r];
      el.appendChild(l);
      for (c = 0; c < N; c++) {
        var cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'bs-cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.setAttribute('aria-label', LETTERS[r] + (c + 1));
        if (onCell) cell.addEventListener('click', onCell);
        el.appendChild(cell);
      }
    }
  }

  function cellEl(grid, r, c) { return grid.querySelector('.bs-cell[data-r="' + r + '"][data-c="' + c + '"]'); }

  function paintOwn(grid, ships, shots) {
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var el = cellEl(grid, r, c);
      var ship = shipAt(ships, r, c);
      var shot = shots ? shots[r][c] : null;
      el.className = 'bs-cell' + (ship ? ' ship' : '') + (shot === 'hit' ? ' hit' : shot === 'miss' ? ' miss' : '');
      el.textContent = shot === 'hit' ? '×' : shot === 'miss' ? '•' : '';
    }
    ships.forEach(function (s) {
      if (!shots || !shipCells(s).every(function (x) { return shots[x[0]][x[1]] === 'hit'; })) return;
      shipCells(s).forEach(function (x) { cellEl(grid, x[0], x[1]).classList.add('sunk'); });
    });
  }

  function paintTarget() {
    var grid = $('#enemyGrid');
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var el = cellEl(grid, r, c);
      var s = state.myShots[r][c];
      el.className = 'bs-cell target' + (s === 'hit' ? ' hit' : s === 'miss' ? ' miss' : '') + (state.enemySunkCells[r + ',' + c] ? ' sunk' : '');
      el.textContent = s === 'hit' ? '×' : s === 'miss' ? '•' : '';
      el.disabled = !!s || !state.myTurn || state.over;
    }
    grid.classList.toggle('your-turn', state.myTurn && !state.over);
  }

  function renderFleetStatus(el, sunkIds) {
    el.textContent = '';
    FLEET.forEach(function (f) {
      var li = document.createElement('li');
      li.className = sunkIds.indexOf(f.id) !== -1 ? 'down' : '';
      var name = document.createElement('span');
      name.textContent = f.name;
      var pips = document.createElement('span');
      pips.className = 'pips';
      pips.textContent = new Array(f.size + 1).join('■');
      li.appendChild(name);
      li.appendChild(pips);
      el.appendChild(li);
    });
  }

  function setTurnText() {
    var t = $('#turnText');
    if (state.over) return;
    t.textContent = state.myTurn ? 'Your turn · pick a square to fire at' : (settings.mode === 'cpu' ? 'CPU is aiming…' : 'Waiting for your opponent…');
    t.classList.toggle('mine', state.myTurn);
  }

  function log(text) {
    var li = document.createElement('li');
    li.textContent = text;
    var logEl = $('#battleLog');
    logEl.insertBefore(li, logEl.firstChild);
    while (logEl.children.length > 8) logEl.lastChild.remove();
  }

  /* =================================================================
     Placement
     ================================================================= */

  function startPlacement(mode) {
    settings.mode = mode;
    placing = { ships: FLEET.map(function (f) { return { id: f.id, name: f.name, size: f.size, horizontal: true, r: null, c: null }; }), selected: 'carrier', horizontal: true, hover: null };
    buildGrid($('#placeGrid'), onPlaceClick);
    var grid = $('#placeGrid');
    grid.addEventListener('mouseover', function (e) {
      var cell = e.target.closest('.bs-cell');
      placing.hover = cell ? [+cell.dataset.r, +cell.dataset.c] : null;
      paintPlacement();
    });
    grid.addEventListener('mouseleave', function () { placing.hover = null; paintPlacement(); });
    $('#placeStatus').textContent = settings.mode === 'online' ? '' : 'Place your fleet, then start the battle.';
    renderShipPicker();
    paintPlacement();
    screen('placeView');
  }

  function renderShipPicker() {
    var box = $('#shipPicker');
    box.textContent = '';
    placing.ships.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ship-pick' + (placing.selected === s.id ? ' active' : '') + (s.r != null ? ' placed' : '');
      b.innerHTML = '<span></span><span class="pips"></span>';
      b.firstChild.textContent = s.name;
      b.lastChild.textContent = new Array(s.size + 1).join('■');
      b.addEventListener('click', function () { placing.selected = s.id; renderShipPicker(); paintPlacement(); });
      box.appendChild(b);
    });
    var done = placing.ships.every(function (s) { return s.r != null; });
    $('#readyFleet').disabled = !done;
    $('#rotateBtn').textContent = placing.horizontal ? '↔ Horizontal' : '↕ Vertical';
  }

  function selectedShip() { return placing.ships.filter(function (s) { return s.id === placing.selected; })[0]; }

  function onPlaceClick(e) {
    var r = +e.currentTarget.dataset.r, c = +e.currentTarget.dataset.c;
    var existing = shipAt(placing.ships, r, c);
    if (existing && existing.id !== placing.selected) {
      // Clicking a placed ship picks it up.
      placing.selected = existing.id;
      placing.horizontal = existing.horizontal;
      existing.r = existing.c = null;
      renderShipPicker();
      paintPlacement();
      return;
    }
    var s = selectedShip();
    if (!s) return;
    var candidate = { id: s.id, size: s.size, horizontal: placing.horizontal, r: r, c: c };
    if (!fits(placing.ships, candidate, s.id)) { G.Sound.beep(160, 0.08, 'square', 0.03); return; }
    s.r = r; s.c = c; s.horizontal = placing.horizontal;
    G.Sound.beep(520, 0.05, 'triangle', 0.04);
    var next = placing.ships.filter(function (x) { return x.r == null; })[0];
    placing.selected = next ? next.id : null;
    renderShipPicker();
    paintPlacement();
  }

  function paintPlacement() {
    var grid = $('#placeGrid');
    paintOwn(grid, placing.ships, null);
    var s = selectedShip();
    if (!s || !placing.hover) return;
    var candidate = { id: s.id, size: s.size, horizontal: placing.horizontal, r: placing.hover[0], c: placing.hover[1] };
    var ok = fits(placing.ships, candidate, s.id);
    shipCells(candidate).forEach(function (x) {
      var el = x[0] < N && x[1] < N ? cellEl(grid, x[0], x[1]) : null;
      if (el) el.classList.add(ok ? 'preview' : 'preview-bad');
    });
  }

  function rotatePlacement() {
    placing.horizontal = !placing.horizontal;
    renderShipPicker();
    paintPlacement();
  }

  function randomPlacement() {
    placing.ships = randomFleet();
    placing.selected = null;
    renderShipPicker();
    paintPlacement();
  }

  /* =================================================================
     Battle
     ================================================================= */

  function newBattleState() {
    return {
      myShips: placing.ships.map(function (s) { return Object.assign({}, s); }),
      myShots: emptyGrid(null),       // my shots at the enemy
      enemyShots: emptyGrid(null),    // enemy shots at me
      enemySunk: [],
      enemySunkCells: {},
      mySunk: [],
      myTurn: true,
      over: false,
      shots: 0,
      hits: 0,
      ai: null,
      pendingShot: null,
      // for achievements, the leaderboard and the background
      streak: 0, enemyHits: 0, startedAt: performance.now(), reported: false
    };
  }

  function beginBattle(firstIsMe) {
    state = state || newBattleState();
    state.myTurn = firstIsMe;
    buildGrid($('#enemyGrid'), onFire);
    buildGrid($('#ownGrid'), null);
    $('#battleLog').textContent = '';
    var lbl = $('#enemyLabel');
    lbl.textContent = '';
    if (settings.mode === 'online' && net.them) lbl.appendChild(G.Profile.avatar(net.them, 22));
    if (settings.mode === 'cpu') lbl.appendChild(document.createTextNode('CPU waters'));
    else {
      var themName = document.createElement('span');
      themName.textContent = net.them ? net.them.name : 'Opponent';
      if (SOC && net.them && net.them.card) SOC.decorateName(themName, net.them.card);
      lbl.appendChild(themName);
      lbl.appendChild(document.createTextNode('\'s waters'));
    }
    var mine = $('#myLabel');
    mine.textContent = '';
    mine.appendChild(G.Profile.avatar(G.Profile.get(), 22));
    var myName = document.createElement('span');
    myName.textContent = 'Your fleet';
    if (SOC && SOC.card()) SOC.decorateName(myName, SOC.card());
    mine.appendChild(myName);
    paintTarget();
    paintOwn($('#ownGrid'), state.myShips, state.enemyShots);
    renderFleetStatus($('#enemyFleet'), state.enemySunk);
    renderFleetStatus($('#myFleet'), state.mySunk);
    G.hide($('#overlay'));
    setTurnText();
    screen('battleView');
    var page = $('.game-page');
    if (page) page.classList.add('playing');
    if (BG) { BG.scene(0); BG.energy(0); BG.balance(0); BG.focus($('#enemyGrid')); }
    if (SOC && settings.mode === 'online') SOC.lobbyChanged();
    if (!state.myTurn && settings.mode === 'cpu') setTimeout(cpuTurn, 700);
  }

  // The background follows the fight: a ripple from every shot, a flash on hits, and a new scene whenever a
  // ship goes down (chosen from the number sunk, so both players see the same scene).
  function bgShot(grid, r, c, res) {
    if (!BG) return;
    var cell = cellEl(grid, r, c);
    BG.focus(cell);
    BG.hit(cell, res.result === 'miss' ? 0.5 : 1.5);
    if (res.result === 'sunk') {
      var sunk = state.enemySunk.length + state.mySunk.length;
      BG.flash(1);
      BG.scene(sunk);
      BG.energy(sunk / 10);
      BG.balance((state.enemySunk.length - state.mySunk.length) / 5);
    }
  }

  function startCpuBattle() {
    state = newBattleState();
    state.enemyShips = randomFleet();
    state.ai = { shots: emptyGrid(null), sunk: [], sunkCells: {} };
    beginBattle(Math.random() < 0.5);
    log(state.myTurn ? 'You fire first.' : 'CPU fires first.');
  }

  function onFire(e) {
    if (!state || !state.myTurn || state.over || state.pendingShot) return;
    var r = +e.currentTarget.dataset.r, c = +e.currentTarget.dataset.c;
    if (state.myShots[r][c]) return;
    if (settings.mode === 'cpu') {
      applyMyShot(r, c, resolveShot(state.enemyShips, state.myShots, r, c));
    } else {
      state.pendingShot = [r, c];
      state.myTurn = false;
      paintTarget();
      $('#turnText').textContent = 'Firing…';
      netSend({ t: 'fire', r: r, c: c });
    }
  }

  function applyMyShot(r, c, res) {
    state.shots++;
    state.myShots[r][c] = res.result === 'miss' ? 'miss' : 'hit';
    var coord = LETTERS[r] + (c + 1);
    if (res.result === 'miss') {
      log('You fired at ' + coord + ': miss.');
      G.Sound.beep(220, 0.12, 'sine', 0.05);
    } else {
      state.hits++;
      if (res.result === 'sunk') {
        var firstSink = !state.enemySunk.length;
        state.enemySunk.push(res.ship.id);
        shipCells(res.ship).forEach(function (x) { state.enemySunkCells[x[0] + ',' + x[1]] = true; });
        log('You sank their ' + res.ship.name + '!');
        G.banner('You sank their ' + res.ship.name + '!');
        G.Sound.beep(880, 0.3, 'triangle', 0.07);
      } else {
        log('You fired at ' + coord + ': hit!');
        G.Sound.beep(660, 0.1, 'square', 0.05);
      }
    }
    state.streak = res.result === 'miss' ? 0 : state.streak + 1;
    ACH.event('shot', { hit: res.result !== 'miss', sunk: res.result === 'sunk' ? res.ship.id : null, streak: state.streak, firstSink: res.result === 'sunk' && firstSink });
    bgShot($('#enemyGrid'), r, c, res);
    // Hits keep the turn; misses pass it.
    state.myTurn = res.result !== 'miss';
    renderFleetStatus($('#enemyFleet'), state.enemySunk);
    if (res.win) return gameOver(true);
    paintTarget();
    setTurnText();
    if (!state.myTurn && settings.mode === 'cpu') setTimeout(cpuTurn, 650 + Math.random() * 400);
  }

  function cpuTurn() {
    if (!state || state.over || state.myTurn) return;
    var pick = cpuPick(state.ai);
    var res = resolveShot(state.myShips, state.ai.shots, pick[0], pick[1]);
    if (res.result === 'sunk') {
      state.ai.sunk.push(res.ship.id);
      shipCells(res.ship).forEach(function (x) { state.ai.sunkCells[x[0] + ',' + x[1]] = true; });
    }
    applyEnemyShot(pick[0], pick[1], res);
  }

  function applyEnemyShot(r, c, res) {
    state.enemyShots[r][c] = res.result === 'miss' ? 'miss' : 'hit';
    var who = settings.mode === 'cpu' ? 'CPU' : (net.them ? net.them.name : 'Opponent');
    var coord = LETTERS[r] + (c + 1);
    if (res.result === 'miss') {
      log(who + ' fired at ' + coord + ': miss.');
      G.Sound.beep(200, 0.1, 'sine', 0.04);
    } else if (res.result === 'sunk') {
      state.mySunk.push(res.ship.id);
      log(who + ' sank your ' + res.ship.name + '.');
      G.banner('Your ' + res.ship.name + ' was sunk');
      G.Sound.beep(140, 0.35, 'sawtooth', 0.06);
    } else {
      log(who + ' fired at ' + coord + ': hit.');
      G.Sound.beep(300, 0.1, 'square', 0.05);
    }
    if (res.result !== 'miss') state.enemyHits++;
    var cell = cellEl($('#ownGrid'), r, c);
    paintOwn($('#ownGrid'), state.myShips, state.enemyShots);
    if (cell) { cell.classList.add('flash'); }
    bgShot($('#ownGrid'), r, c, res);
    renderFleetStatus($('#myFleet'), state.mySunk);
    if (res.win) return gameOver(false);
    state.myTurn = res.result === 'miss';
    paintTarget();
    setTurnText();
    if (!state.myTurn && settings.mode === 'cpu') setTimeout(cpuTurn, 650 + Math.random() * 400);
  }

  function gameOver(won) {
    state.over = true;
    paintTarget();
    if (won) stats.wins++; else stats.losses++;
    G.Store.set('bs_stats', stats);
    var acc = state.shots ? Math.round(state.hits / state.shots * 100) : 0;
    $('#turnText').textContent = won ? 'Victory!' : 'Defeat';
    $('#overlayTitle').textContent = won ? 'Victory!' : 'Your fleet was sunk';
    $('#overlayText').textContent = state.shots + ' shots · ' + acc + '% accuracy · record ' + stats.wins + 'W ' + stats.losses + 'L';
    G.show($('#overlay'));
    G.Sound.beep(won ? 660 : 180, 0.5, 'triangle', 0.07);
    reportBattle(won, acc);
    if (settings.mode === 'online') {
      if (!won) revealEnemy();
    } else {
      revealCpu();
    }
  }

  // Once per battle: achievements, and for the leaderboard a run with shots, accuracy and ships lost.
  function reportBattle(won, acc) {
    if (state.reported) return;
    state.reported = true;
    var d = { mode: settings.mode, won: won, difficulty: settings.difficulty, shots: state.shots, accuracy: acc, shipsLost: state.mySunk.length, enemyHits: state.enemyHits };
    ACH.event('battle', d);
    if (BG) BG.flash(1);
    if (SOC) SOC.battleshipsFinished({ online: settings.mode === 'online', won: won, shots: d.shots, accuracy: acc, shipsLost: d.shipsLost, enemyHits: d.enemyHits,
      elapsed: (performance.now() - state.startedAt) / 1000, difficulty: settings.difficulty, opponent: net.them ? net.them.name : '' });
  }

  function revealCpu() {
    var grid = $('#enemyGrid');
    state.enemyShips.forEach(function (s) {
      shipCells(s).forEach(function (x) { cellEl(grid, x[0], x[1]).classList.add('reveal'); });
    });
  }

  function revealEnemy() { netSend({ t: 'reveal-req' }); }

  /* =================================================================
     Online
     ================================================================= */

  var net = { role: null, session: null, myReady: false, theirReady: false, theirFleetReady: false, myFleetReady: false, iStart: null, them: null };

  function netSend(msg) {
    if (!net.session) return;
    if (net.role === 'host') net.session.broadcast(msg);
    else net.session.send(msg);
  }

  function onNet(d) {
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'hi':
      case 'hello':
        net.them = G.Profile.sanitize(d.profile);
        net.them.card = SOC ? SOC.cleanCard(d.card) : null;
        renderLobby();
        break;
      case 'ready':
        net.theirReady = !!d.v;
        renderLobby();
        hostMaybeBegin();
        break;
      case 'place':
        net.myFleetReady = false;
        net.theirFleetReady = false;
        startPlacement('online');
        break;
      case 'fleet':
        net.theirFleetReady = true;
        maybeBattle();
        break;
      case 'go':
        net.iStart = !d.hostFirst;
        startOnlineBattle();
        break;
      case 'fire':
        if (!state || state.myTurn || state.over) return;
        var r = d.r | 0, c = d.c | 0;
        if (r < 0 || c < 0 || r >= N || c >= N || state.enemyShots[r][c]) return;
        var res = resolveShot(state.myShips, state.enemyShots, r, c);
        state.enemyShots[r][c] = null;       // applyEnemyShot records it
        netSend({ t: 'result', r: r, c: c, res: res });
        applyEnemyShot(r, c, res);
        break;
      case 'result':
        if (!state || !state.pendingShot) return;
        state.pendingShot = null;
        applyMyShot(d.r | 0, d.c | 0, d.res || { result: 'miss' });
        break;
      case 'reveal-req':
        netSend({ t: 'reveal', ships: state ? state.myShips : [] });
        break;
      case 'reveal':
        var grid = $('#enemyGrid');
        (d.ships || []).forEach(function (s) {
          if (typeof s.r !== 'number') return;
          shipCells({ r: s.r, c: s.c, size: Math.min(5, s.size | 0), horizontal: !!s.horizontal }).forEach(function (x) {
            var el = x[0] < N && x[1] < N ? cellEl(grid, x[0], x[1]) : null;
            if (el) el.classList.add('reveal');
          });
        });
        break;
      case 'rematch':
        net.theirReady = true;
        $('#overlayText').textContent = 'Opponent wants a rematch!';
        hostMaybeBegin();
        break;
    }
  }

  function hostMaybeBegin() {
    if (net.role !== 'host' || !net.myReady || !net.theirReady) return;
    net.myReady = net.theirReady = false;
    net.myFleetReady = net.theirFleetReady = false;
    netSend({ t: 'place' });
    startPlacement('online');
  }

  function fleetReadyOnline() {
    net.myFleetReady = true;
    $('#placeStatus').textContent = 'Fleet ready · waiting for your opponent…';
    $('#readyFleet').disabled = true;
    netSend({ t: 'fleet' });
    maybeBattle();
  }

  function maybeBattle() {
    if (net.role !== 'host' || !net.myFleetReady || !net.theirFleetReady) return;
    var hostFirst = Math.random() < 0.5;
    net.iStart = hostFirst;
    netSend({ t: 'go', hostFirst: hostFirst });
    startOnlineBattle();
  }

  function startOnlineBattle() {
    state = newBattleState();
    beginBattle(net.iStart);
    log(net.iStart ? 'You fire first.' : 'Your opponent fires first.');
  }

  function renderLobby() {
    var list = $('#lobbyPlayers');
    list.textContent = '';
    var me = G.Profile.get();
    var connected = net.role === 'guest' || !!(net.session && net.session.conns && net.session.conns.length);
    function st(r) { return r ? ['✓ Ready', 'ready'] : ['Not ready', 'waiting']; }
    var mine = st(net.myReady), theirs = st(net.theirReady);
    var themName = net.them ? net.them.name : (net.role === 'host' ? 'Opponent' : 'Host');
    var myRow = G.lobbyRow(me, me.name + (net.role === 'host' ? ' (host) · you' : ' · you'), mine[0], mine[1]);
    var theirRow = connected ? G.lobbyRow(net.them, themName + (net.role === 'host' ? '' : ' (host)'), theirs[0], theirs[1]) : G.lobbyRow(null, 'Waiting for opponent…', '', 'waiting');
    if (SOC) {
      if (SOC.card()) SOC.decorateName(myRow.querySelector('.lobby-who > span:not(.avatar)'), SOC.card());
      if (connected && net.them && net.them.card) SOC.decorateName(theirRow.querySelector('.lobby-who > span:not(.avatar)'), net.them.card);
    }
    if (net.role === 'host') { list.appendChild(myRow); list.appendChild(theirRow); }
    else { list.appendChild(theirRow); list.appendChild(myRow); }
    $('#readyBtn').disabled = !connected;
    $('#readyBtn').textContent = net.myReady ? 'Not ready' : 'Ready';
    if (SOC) SOC.lobbyChanged();
  }

  function createLobby() {
    net.role = 'host';
    net.myReady = net.theirReady = false;
    setNotice('Creating lobby…');
    net.session = G.Net.host('battleships', {
      maxGuests: 1,
      onReady: function (code) {
        net.code = code;
        $('#lobbyCode').textContent = code;
        G.show($('#lobbyCodeBox'));
        screen('lobbyPanel');
        renderLobby();
      },
      onJoin: function (conn) { net.session.send(conn, { t: 'hello', profile: G.Profile.get(), card: SOC ? SOC.card() : null }); G.Sound.beep(660, 0.1, 'triangle'); renderLobby(); },
      onData: function (conn, d) { onNet(d); },
      onLeave: opponentLeft,
      onError: netError
    });
  }

  function joinLobby() {
    var code = G.cleanCode($('#joinCode').value);
    if (code.length !== 5) return netError('Lobby codes are 5 characters.');
    net.role = 'guest';
    net.code = code;
    net.myReady = net.theirReady = false;
    setNotice('Connecting…');
    net.session = G.Net.join('battleships', code, {
      onOpen: function () { net.session.send({ t: 'hi', profile: G.Profile.get(), card: SOC ? SOC.card() : null }); G.hide($('#lobbyCodeBox')); screen('lobbyPanel'); renderLobby(); },
      onData: onNet,
      onClose: opponentLeft,
      onError: netError
    });
  }

  function opponentLeft() {
    if (!net.session) return;
    if (net.role === 'host' && !$('#lobbyPanel').classList.contains('hidden')) {
      net.theirReady = false;
      net.them = null;
      renderLobby();
      G.banner('Opponent left');
      return;
    }
    net.session.close();
    net.session = null;
    if (state && !state.over) {
      state.over = true;
      $('#overlayTitle').textContent = 'Opponent left';
      $('#overlayText').textContent = 'The connection closed.';
      G.show($('#overlay'));
    } else {
      netError('Lost connection to your opponent.');
    }
  }

  function setNotice(msg, err) {
    $('#onlineNotice').textContent = msg;
    $('#onlineNotice').className = 'notice' + (err ? ' error' : '');
  }

  function netError(msg) {
    setNotice(msg, true);
    if (net.session) { net.session.close(); net.session = null; }
    screen('onlinePanel');
  }

  function toMenu() {
    if (net.session) { net.session.close(); net.session = null; }
    net.role = null;
    net.code = null;
    net.them = null;
    state = null;
    var page = $('.game-page');
    if (page) page.classList.remove('playing');
    renderStats();
    screen('menuPanel');
    if (SOC) SOC.lobbyChanged();
  }

  function renderStats() {
    $('#menuStats').textContent = stats.wins || stats.losses ? 'Your record: ' + stats.wins + ' wins · ' + stats.losses + ' losses' : '';
  }

  /* =================================================================
     Wiring
     ================================================================= */

  function init() {
    renderStats();
    G.chips($('#difficultyChips'), settings.difficulty, function (v) { settings.difficulty = v; G.Store.set('bs_difficulty', v); });

    $('#modeCpu').addEventListener('click', function () { startPlacement('cpu'); });
    $('#modeOnline').addEventListener('click', function () {
      setNotice(G.Net.available() ? 'Play a friend: one of you creates a lobby, the other joins with the code.' : 'Online play couldn\'t load on this network.', !G.Net.available());
      screen('onlinePanel');
    });
    $('#createLobby').addEventListener('click', createLobby);
    $('#joinForm').addEventListener('submit', function (e) { e.preventDefault(); joinLobby(); });
    $('#onlineBack').addEventListener('click', function () { screen('menuPanel'); });
    $('#lobbyCode').addEventListener('click', function () { G.copyText($('#lobbyCode').textContent); });
    $('#readyBtn').addEventListener('click', function () {
      net.myReady = !net.myReady;
      netSend({ t: 'ready', v: net.myReady });
      renderLobby();
      hostMaybeBegin();
    });
    $('#lobbyLeave').addEventListener('click', toMenu);

    $('#rotateBtn').addEventListener('click', rotatePlacement);
    $('#randomBtn').addEventListener('click', randomPlacement);
    $('#clearBtn').addEventListener('click', function () {
      placing.ships.forEach(function (s) { s.r = s.c = null; });
      placing.selected = 'carrier';
      renderShipPicker();
      paintPlacement();
    });
    $('#readyFleet').addEventListener('click', function () {
      if (settings.mode === 'cpu') startCpuBattle();
      else fleetReadyOnline();
    });
    $('#placeBack').addEventListener('click', toMenu);
    document.addEventListener('keydown', function (e) {
      if (!$('#placeView').classList.contains('hidden') && (e.key === 'r' || e.key === 'R') && !e.target.closest('input')) rotatePlacement();
    });

    $('#againBtn').addEventListener('click', function () {
      if (settings.mode === 'cpu') return startPlacement('cpu');
      if (!net.session) return toMenu();
      net.myReady = true;
      netSend({ t: 'rematch' });
      $('#overlayText').textContent = 'Waiting for your opponent…';
      if (net.role === 'guest') netSend({ t: 'ready', v: true });
      hostMaybeBegin();
    });
    $('#menuBtn').addEventListener('click', toMenu);
    $('#quitBtn').addEventListener('click', toMenu);
    G.Sound.bindButton($('#soundBtn'));
    if (BG) { BG.mount($('.game-page')); BG.scene(Math.floor(Math.random() * 5)); }
    mountProfileEditor();
    $('#achBtn').addEventListener('click', function () { ACH.open(); });
    $('#hudAch').addEventListener('click', function () { ACH.open(); });
    var paintAch = function () { var c = ACH.count(); $('#achCount').textContent = c.unlocked + '/' + c.total; };
    ACH.onChange(paintAch);
    paintAch();
    ['#shuffleBg', '#hudShuffleBg'].forEach(function (id) { $(id).addEventListener('click', function () { if (BG) BG.shuffle(); }); });
    screen('menuPanel');
    joinFromLink();
  }

  // The name/picture editor on the Online panel; changes reach the lobby and the social profile.
  function mountProfileEditor() {
    G.Profile.mount($('#profileEditor'), function () {
      if (net.session && !state) { netSend({ t: net.role === 'host' ? 'hello' : 'hi', profile: G.Profile.get(), card: SOC ? SOC.card() : null }); renderLobby(); }
      if (SOC) SOC.localProfileChanged(G.Profile.get());
    });
  }

  // For games-social.js: join by code (invite links, the lobby finder, the bell) and read the current lobby.
  window.GameApp = window.BattleshipsApp = {
    join: function (code) {
      code = G.cleanCode(code);
      if (code.length !== 5) return;
      if (state && !state.over && settings.mode === 'online') { G.banner('Finish or leave this battle first'); return; }
      if (net.session && net.code === code) return;
      toMenu();
      screen('onlinePanel');
      $('#joinCode').value = code;
      joinLobby();
    },
    lobby: function () {
      if (!net.session || !net.role || !net.code) return null;
      var connected = net.role === 'guest' || !!(net.session.conns && net.session.conns.length);
      return { code: net.code, role: net.role, count: connected ? 2 : 1, max: 2, rules: 'Classic fleet · hits keep your turn', inGame: !!(state && !state.over) };
    },
    pause: function () {},
    profileChanged: function () { mountProfileEditor(); if (net.session && !state) renderLobby(); }
  };

  // Invite links (battleships?join=CODE) open straight into that lobby; the parameter is then removed.
  function joinFromLink() {
    var m = location.search.match(/[?&]join=([A-Za-z0-9]{5})(?:&|$)/);
    if (!m) return;
    var rest = location.search.replace(/^\?/, '').split('&').filter(function (kv) { return kv && !/^join=/.test(kv); }).join('&');
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    window.GameApp.join(m[1]);
  }

  init();
})();
