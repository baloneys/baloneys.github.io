// tetris-achievements.js: achievements for Tetris, saved in this browser (localStorage via Games.Store).
//
// tetris.js reports what happens (Achievements.event(name, data)); this file decides what unlocks, keeps
// lifetime counters for the progress ones, shows a glass toast with a bar that fills while it is up (hover pauses
// it, a click opens the browser), and draws a browser of every achievement with progress and unlock dates.
// Icons are tiny pixel-art bitmaps drawn once to data URLs, tinted by tier (bronze, silver, gold, platinum).
//
// API (window.TetrisAchievements): event(name, data), open(), count() -> {unlocked, total}, onChange(fn)
(function () {
  'use strict';

  var G = window.Games;
  var STORE_UNLOCKS = 'tetris_achievements', STORE_STATS = 'tetris_ach_stats';

  // 8x8 pixel icons, one number per row, leftmost pixel = bit 7.
  var GLYPH = {
    trophy: [126, 255, 189, 126, 60, 24, 60, 126],
    line: [0, 0, 255, 255, 0, 0, 0, 0],
    tetris: [255, 0, 255, 0, 255, 0, 255, 0],
    flame: [16, 48, 56, 122, 126, 255, 255, 126],
    clock: [60, 66, 145, 145, 157, 129, 66, 60],
    flag: [254, 252, 254, 128, 128, 128, 128, 128],
    crown: [0, 165, 189, 255, 255, 126, 0, 0],
    skull: [60, 126, 219, 219, 126, 36, 60, 90],
    bomb: [6, 8, 60, 126, 126, 126, 126, 60],
    star: [24, 24, 255, 126, 60, 126, 102, 195],
    quake: [0, 0, 0, 255, 0, 255, 189, 165],
    ice: [255, 129, 181, 153, 153, 173, 129, 255],
    shell: [24, 60, 90, 255, 189, 255, 66, 0],
    heart: [102, 255, 255, 255, 126, 60, 24, 0],
    bolt: [12, 24, 48, 126, 12, 24, 48, 32],
    shovel: [24, 24, 24, 24, 60, 126, 126, 60],
    sparkle: [16, 84, 56, 254, 56, 84, 16, 0],
    moon: [60, 112, 224, 224, 224, 112, 60, 0],
    cake: [36, 36, 0, 126, 255, 129, 255, 0],
    pad: [0, 126, 255, 219, 255, 165, 0, 0],
    hourglass: [126, 66, 36, 24, 24, 36, 90, 126],
    sword: [1, 2, 4, 72, 48, 48, 72, 128],
    chain: [102, 153, 153, 102, 102, 153, 153, 102],
    gem: [60, 126, 255, 126, 60, 24, 0, 0],
    rocket: [24, 60, 60, 60, 126, 255, 165, 36],
    lock: [60, 66, 66, 255, 231, 231, 255, 0]
  };

  var TIERS = {
    bronze: { name: 'Bronze', a: '#f0a36b', b: '#8a4a22', glow: 'rgba(240,150,90,0.55)' },
    silver: { name: 'Silver', a: '#eef3ff', b: '#7d88a6', glow: 'rgba(210,225,255,0.5)' },
    gold: { name: 'Gold', a: '#ffe27a', b: '#c07d10', glow: 'rgba(255,205,80,0.6)' },
    platinum: { name: 'Platinum', a: '#e6d2ff', b: '#7b3cff', glow: 'rgba(185,130,255,0.7)' }
  };

  var CATEGORIES = [
    { id: 'basics', name: 'Getting started' },
    { id: 'score', name: 'Score and levels' },
    { id: 'lifetime', name: 'Lifetime' },
    { id: 'streak', name: 'Streaks' },
    { id: 'modes', name: 'Game types' },
    { id: 'skulls', name: 'Skulls and power-ups' },
    { id: 'versus', name: 'Versus' }
  ];

  // goal + stat: a lifetime counter with a progress bar. secret: name and description hidden until unlocked.
  var LIST = [
    { id: 'first_clear', cat: 'basics', tier: 'bronze', icon: 'line', name: 'First Blood', desc: 'Clear your first line.' },
    { id: 'first_tetris', cat: 'basics', tier: 'bronze', icon: 'tetris', name: 'Tetris!', desc: 'Clear four lines with one piece.' },
    { id: 'b2b', cat: 'basics', tier: 'silver', icon: 'chain', name: 'Back to Back', desc: 'Score two Tetrises in a row.' },
    { id: 'combo5', cat: 'basics', tier: 'silver', icon: 'chain', name: 'Combo Chain', desc: 'Keep a combo going for 5 pieces.' },
    { id: 'perfect', cat: 'basics', tier: 'gold', icon: 'sparkle', name: 'Clean Slate', desc: 'Clear lines and leave the well completely empty.' },
    { id: 'score10k', cat: 'score', tier: 'bronze', icon: 'star', name: 'Five Digits', desc: 'Score 10,000 points in one game.' },
    { id: 'score100k', cat: 'score', tier: 'gold', icon: 'gem', name: 'Six Digits', desc: 'Score 100,000 points in one game.' },
    { id: 'level10', cat: 'score', tier: 'silver', icon: 'rocket', name: 'Double Digits', desc: 'Reach level 10.' },
    { id: 'level20', cat: 'score', tier: 'gold', icon: 'rocket', name: 'Terminal Velocity', desc: 'Reach level 20.' },
    { id: 'lines100', cat: 'lifetime', tier: 'bronze', icon: 'line', name: 'Century', desc: 'Clear 100 lines in total.', stat: 'lines', goal: 100 },
    { id: 'lines1000', cat: 'lifetime', tier: 'gold', icon: 'line', name: 'Line Cook', desc: 'Clear 1,000 lines in total.', stat: 'lines', goal: 1000 },
    { id: 'tetris50', cat: 'lifetime', tier: 'silver', icon: 'tetris', name: 'Tetris Enthusiast', desc: 'Score 50 Tetrises in total.', stat: 'tetrises', goal: 50 },
    { id: 'games25', cat: 'lifetime', tier: 'bronze', icon: 'pad', name: 'Regular', desc: 'Finish 25 games.', stat: 'games', goal: 25 },
    { id: 'games100', cat: 'lifetime', tier: 'silver', icon: 'pad', name: 'Furniture', desc: 'Finish 100 games.', stat: 'games', goal: 100 },
    { id: 'streak5', cat: 'streak', tier: 'bronze', icon: 'flame', name: 'Warming Up', desc: 'Reach a 5x streak.' },
    { id: 'streak10', cat: 'streak', tier: 'silver', icon: 'flame', name: 'On Fire', desc: 'Reach a 10x streak and set the stack alight.' },
    { id: 'streak20', cat: 'streak', tier: 'gold', icon: 'flame', name: 'Rainbow Road', desc: 'Reach a 20x streak and burn the whole well.' },
    { id: 'streak30', cat: 'streak', tier: 'platinum', icon: 'bolt', name: 'Overdrive', desc: 'Reach a 30x streak.' },
    { id: 'streak50', cat: 'streak', tier: 'platinum', icon: 'sparkle', name: 'Supernova', desc: 'Reach a 50x streak.', secret: true },
    { id: 'sprint', cat: 'modes', tier: 'bronze', icon: 'flag', name: 'Sprinter', desc: 'Finish Sprint 40.' },
    { id: 'sprint60', cat: 'modes', tier: 'gold', icon: 'hourglass', name: 'Speed Demon', desc: 'Finish Sprint 40 in under a minute.' },
    { id: 'ultra30k', cat: 'modes', tier: 'silver', icon: 'clock', name: 'Ultra Instinct', desc: 'Score 30,000 in Ultra 2:00.' },
    { id: 'dig', cat: 'modes', tier: 'bronze', icon: 'shovel', name: 'Excavator', desc: 'Finish Dig.' },
    { id: 'dig45', cat: 'modes', tier: 'gold', icon: 'shovel', name: 'Mole', desc: 'Finish Dig in under 45 seconds.' },
    { id: 'survival3', cat: 'modes', tier: 'silver', icon: 'heart', name: 'Survivor', desc: 'Last 3 minutes in Survival.' },
    { id: 'skull1', cat: 'skulls', tier: 'bronze', icon: 'skull', name: 'Skull Collector', desc: 'Play a game with a skull on.' },
    { id: 'skull5', cat: 'skulls', tier: 'silver', icon: 'skull', name: 'Iron Will', desc: 'Play with 5 or more skulls at once.' },
    { id: 'mult3', cat: 'skulls', tier: 'gold', icon: 'crown', name: 'Triple Threat', desc: 'Play at a ×3 score multiplier or higher.' },
    { id: 'lightsout10', cat: 'skulls', tier: 'silver', icon: 'moon', name: 'In the Dark', desc: 'Clear 10 lines in one game with Lights Out.' },
    { id: 'birthday', cat: 'skulls', tier: 'bronze', icon: 'cake', name: 'Party Animal', desc: 'Clear a line at a Block Birthday Party.', secret: true },
    { id: 'secondwind', cat: 'skulls', tier: 'bronze', icon: 'heart', name: 'Not Today', desc: 'Get saved by Second Wind.', secret: true },
    { id: 'bomb', cat: 'skulls', tier: 'bronze', icon: 'bomb', name: 'Demolition', desc: 'Set off a Bomb.' },
    { id: 'starbomb', cat: 'skulls', tier: 'bronze', icon: 'star', name: 'Shooting Star', desc: 'Set off a Star Bomb.' },
    { id: 'quake', cat: 'skulls', tier: 'bronze', icon: 'quake', name: 'Earthshaker', desc: 'Trigger a Quake.' },
    { id: 'vs_win', cat: 'versus', tier: 'silver', icon: 'sword', name: 'Victor', desc: 'Win an online match.' },
    { id: 'vs_win5', cat: 'versus', tier: 'gold', icon: 'trophy', name: 'Champion', desc: 'Win 5 online matches.', stat: 'wins', goal: 5 },
    { id: 'elim_win', cat: 'versus', tier: 'gold', icon: 'crown', name: 'Last One Standing', desc: 'Win an online Elimination match.' },
    { id: 'freeze', cat: 'versus', tier: 'bronze', icon: 'ice', name: 'Cold Shoulder', desc: 'Freeze an opponent.' },
    { id: 'shell', cat: 'versus', tier: 'bronze', icon: 'shell', name: 'Blue Shell', desc: 'Hit the leader with a Blue Shell.' }
  ];
  var BY_ID = {};
  LIST.forEach(function (a) { BY_ID[a.id] = a; });

  var unlocks = G.Store.get(STORE_UNLOCKS, {}) || {};   // id -> unlock time (ms)
  var stats = G.Store.get(STORE_STATS, {}) || {};       // lifetime counters
  var listeners = [];

  /* ---------- icons ---------- */

  var iconCache = {};
  function hexRgb(h) { return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }

  // 10x10 canvas: the glyph with a vertical tier gradient and a one-pixel dark outline, as a data URL.
  function iconUrl(glyph, tier, locked) {
    var key = glyph + tier + (locked ? 'L' : '');
    if (iconCache[key]) return iconCache[key];
    var bits = GLYPH[glyph] || GLYPH.trophy, t = TIERS[tier] || TIERS.bronze;
    var cv = document.createElement('canvas');
    cv.width = 10; cv.height = 10;
    var ctx = cv.getContext('2d'), img = ctx.createImageData(10, 10);
    var a = hexRgb(t.a), b = hexRgb(t.b);
    function on(x, y) { return x >= 0 && x < 8 && y >= 0 && y < 8 && (bits[y] & (128 >> x)); }
    for (var y = 0; y < 10; y++) for (var x = 0; x < 10; x++) {
      var gx = x - 1, gy = y - 1, i = (y * 10 + x) * 4, rgb = null, alpha = 255;
      if (on(gx, gy)) {
        var k = gy / 7;
        rgb = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
        if (gy === 0 || !on(gx, gy - 1)) rgb = [Math.min(255, rgb[0] + 40), Math.min(255, rgb[1] + 40), Math.min(255, rgb[2] + 40)];
        if (locked) { var g = (rgb[0] + rgb[1] + rgb[2]) / 3 * 0.45; rgb = [g, g, g + 8]; }
      } else if (on(gx + 1, gy) || on(gx - 1, gy) || on(gx, gy + 1) || on(gx, gy - 1)) {
        rgb = [18, 10, 30];
      }
      if (rgb) { img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = alpha; }
    }
    ctx.putImageData(img, 0, 0);
    iconCache[key] = cv.toDataURL();
    return iconCache[key];
  }

  function badge(a, locked, size) {
    var el = document.createElement('span');
    el.className = 'ach-badge tier-' + a.tier + (locked ? ' locked' : '');
    if (size) el.style.setProperty('--ach-size', size + 'px');
    var img = document.createElement('img');
    img.alt = '';
    img.src = iconUrl(locked && a.secret ? 'lock' : a.icon, a.tier, locked);
    el.appendChild(img);
    return el;
  }

  /* ---------- unlocking ---------- */

  function save() { G.Store.set(STORE_UNLOCKS, unlocks); G.Store.set(STORE_STATS, stats); }

  function unlock(id) {
    if (unlocks[id] || !BY_ID[id]) return;
    unlocks[id] = Date.now();
    save();
    queueToast(BY_ID[id]);
    listeners.forEach(function (fn) { try { fn(); } catch (e) { /* listener errors never block unlocks */ } });
  }

  function addStat(name, n) {
    stats[name] = (stats[name] || 0) + n;
    LIST.forEach(function (a) { if (a.stat === name && stats[name] >= a.goal) unlock(a.id); });
    save();
  }

  function gameInfo(d) { return d || {}; }

  // Everything tetris.js reports. Only local players' events arrive here.
  var HANDLERS = {
    // a piece locked: { cleared, tetris, b2b, combo, perfect, score, level, streak, powers[], lightsOut, birthday, lightsLines }
    lock: function (d) {
      if (d.cleared > 0) unlock('first_clear');
      if (d.tetris) { unlock('first_tetris'); addStat('tetrises', 1); }
      if (d.b2b) unlock('b2b');
      if (d.combo >= 5) unlock('combo5');
      if (d.perfect) unlock('perfect');
      if (d.cleared > 0) addStat('lines', d.cleared);
      if (d.score >= 10000) unlock('score10k');
      if (d.score >= 100000) unlock('score100k');
      if (d.level >= 10) unlock('level10');
      if (d.level >= 20) unlock('level20');
      if (d.streak >= 5) unlock('streak5');
      if (d.streak >= 10) unlock('streak10');
      if (d.streak >= 20) unlock('streak20');
      if (d.streak >= 30) unlock('streak30');
      if (d.streak >= 50) unlock('streak50');
      (d.powers || []).forEach(function (k) {
        if (k === 'bomb') unlock('bomb');
        else if (k === 'starbomb') unlock('starbomb');
        else if (k === 'quake') unlock('quake');
      });
      if (d.birthday && d.cleared > 0) unlock('birthday');
      if (d.lightsLines >= 10) unlock('lightsout10');
    },
    // a game started: { skulls, multiplier }
    start: function (d) {
      d = gameInfo(d);
      if (d.skulls >= 1) unlock('skull1');
      if (d.skulls >= 5) unlock('skull5');
      if (d.multiplier >= 3) unlock('mult3');
    },
    // a solo game finished: { finish: 'sprint'|'dig'|'time'|null, gameType, elapsed, score }
    solo: function (d) {
      d = gameInfo(d);
      addStat('games', 1);
      if (d.finish === 'sprint') { unlock('sprint'); if (d.elapsed < 60) unlock('sprint60'); }
      if (d.finish === 'dig') { unlock('dig'); if (d.elapsed < 45) unlock('dig45'); }
      if (d.gameType === 'ultra' && d.score >= 30000) unlock('ultra30k');
      if (d.gameType === 'survival' && d.elapsed >= 180) unlock('survival3');
    },
    // still alive in Survival: { elapsed }
    survival: function (d) { if (d && d.elapsed >= 180) unlock('survival3'); },
    // a versus round finished for us: { won, online, elimination }
    versus: function (d) {
      d = gameInfo(d);
      addStat('games', 1);
      if (d.won && d.online) { unlock('vs_win'); addStat('wins', 1); if (d.elimination) unlock('elim_win'); }
    },
    freeze: function () { unlock('freeze'); },
    shell: function () { unlock('shell'); },
    secondwind: function () { unlock('secondwind'); }
  };

  function event(name, data) {
    var h = HANDLERS[name];
    if (h) { try { h(data || {}); } catch (e) { if (window.console) console.warn('[achievements]', e); } }
  }

  /* ---------- toast ---------- */

  var TOAST_MS = 5600;
  var queue = [], showing = false, stack = null;

  function queueToast(a) { queue.push(a); if (!showing) nextToast(); }

  function nextToast() {
    var a = queue.shift();
    if (!a) { showing = false; return; }
    showing = true;
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'ach-toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    var t = document.createElement('button');
    t.type = 'button';
    t.className = 'ach-toast tier-' + a.tier;
    t.setAttribute('aria-label', 'Achievement unlocked: ' + a.name + '. Open achievements');
    t.style.setProperty('--ach-ms', TOAST_MS + 'ms');
    t.appendChild(badge(a, false, 56));
    var text = document.createElement('span');
    text.className = 'ach-toast-text';
    text.innerHTML = '<span class="ach-kicker"></span><strong></strong><span class="ach-desc"></span>';
    text.querySelector('.ach-kicker').textContent = 'Achievement unlocked · ' + TIERS[a.tier].name;
    text.querySelector('strong').textContent = a.name;
    text.querySelector('.ach-desc').textContent = a.desc;
    t.appendChild(text);
    var bar = document.createElement('span');
    bar.className = 'ach-toast-bar';
    bar.innerHTML = '<span></span>';
    t.appendChild(bar);
    stack.appendChild(t);
    if (G.Sound && G.Sound.beep) { G.Sound.beep(880, 0.08, 'triangle', 0.05); setTimeout(function () { G.Sound.beep(1320, 0.14, 'triangle', 0.05); }, 90); }

    var done = false;
    function dismiss() {
      if (done) return;
      done = true;
      t.classList.add('leaving');
      setTimeout(function () { t.remove(); nextToast(); }, 320);
    }
    // the bar fills while the toast is up (paused on hover / focus); when it is full the toast leaves
    bar.firstChild.addEventListener('animationend', dismiss);
    t.addEventListener('click', function () { dismiss(); open(a.id); });
  }

  /* ---------- browser ---------- */

  var modal = null, filter = 'all', lastFocus = null;

  function fmtDate(ms) {
    try { return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return ''; }
  }

  function count() {
    var n = 0;
    LIST.forEach(function (a) { if (unlocks[a.id]) n++; });
    return { unlocked: n, total: LIST.length };
  }

  function buildModal() {
    modal = document.createElement('div');
    modal.className = 'ach-modal hidden';
    modal.innerHTML =
      '<div class="ach-backdrop" data-close></div>' +
      '<section class="ach-panel" role="dialog" aria-modal="true" aria-labelledby="achTitle">' +
      '  <header class="ach-head">' +
      '    <div class="ach-ring"><span class="ach-ring-num"></span></div>' +
      '    <div class="ach-head-text"><h2 id="achTitle">Achievements</h2><p class="ach-sub"></p><div class="ach-tiers"></div></div>' +
      '    <button class="ach-close" type="button" aria-label="Close" data-close>×</button>' +
      '  </header>' +
      '  <nav class="ach-filters" role="tablist"></nav>' +
      '  <div class="ach-body"></div>' +
      '</section>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) close(); });
    var nav = modal.querySelector('.ach-filters');
    [['all', 'All'], ['unlocked', 'Unlocked'], ['locked', 'Locked']].forEach(function (f) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.value = f[0];
      b.textContent = f[1];
      b.setAttribute('role', 'tab');
      b.addEventListener('click', function () { filter = f[0]; render(); });
      nav.appendChild(b);
    });
  }

  function render(highlight) {
    var c = count(), pct = Math.round(c.unlocked / c.total * 100);
    modal.querySelector('.ach-ring').style.setProperty('--ach-pct', pct);
    modal.querySelector('.ach-ring-num').textContent = pct + '%';
    modal.querySelector('.ach-sub').textContent = c.unlocked + ' of ' + c.total + ' unlocked · saved in this browser';
    var tiers = modal.querySelector('.ach-tiers');
    tiers.textContent = '';
    Object.keys(TIERS).forEach(function (k) {
      var have = 0, all = 0;
      LIST.forEach(function (a) { if (a.tier === k) { all++; if (unlocks[a.id]) have++; } });
      var s = document.createElement('span');
      s.className = 'ach-tier-count tier-' + k;
      s.innerHTML = '<i></i>';
      s.appendChild(document.createTextNode(TIERS[k].name + ' ' + have + '/' + all));
      tiers.appendChild(s);
    });
    Array.prototype.forEach.call(modal.querySelectorAll('.ach-filters .chip'), function (b) {
      b.classList.toggle('active', b.dataset.value === filter);
      b.setAttribute('aria-selected', b.dataset.value === filter ? 'true' : 'false');
    });
    var body = modal.querySelector('.ach-body');
    body.textContent = '';
    var n = 0, target = null;
    CATEGORIES.forEach(function (cat) {
      var items = LIST.filter(function (a) {
        if (a.cat !== cat.id) return false;
        if (filter === 'unlocked') return !!unlocks[a.id];
        if (filter === 'locked') return !unlocks[a.id];
        return true;
      });
      if (!items.length) return;
      var h = document.createElement('h3');
      h.className = 'ach-cat';
      var have = items.filter(function (a) { return unlocks[a.id]; }).length;
      h.textContent = cat.name;
      var hc = document.createElement('span'); hc.textContent = have + '/' + items.length; h.appendChild(hc);
      body.appendChild(h);
      var grid = document.createElement('div');
      grid.className = 'ach-grid';
      items.forEach(function (a) {
        var got = !!unlocks[a.id], hidden = a.secret && !got;
        var card = document.createElement('article');
        card.className = 'ach-card tier-' + a.tier + (got ? ' got' : ' locked');
        card.style.setProperty('--ach-i', n++);
        card.appendChild(badge(a, !got, 52));
        var t = document.createElement('div');
        t.className = 'ach-card-text';
        var nm = document.createElement('strong'); nm.textContent = hidden ? 'Secret achievement' : a.name;
        var ds = document.createElement('p'); ds.textContent = hidden ? 'Keep playing to discover this one.' : a.desc;
        t.appendChild(nm); t.appendChild(ds);
        if (a.stat && !got) {
          var v = Math.min(a.goal, stats[a.stat] || 0);
          var pr = document.createElement('div');
          pr.className = 'ach-progress';
          pr.innerHTML = '<span><i></i></span><em></em>';
          pr.querySelector('i').style.width = (v / a.goal * 100) + '%';
          pr.querySelector('em').textContent = v.toLocaleString() + ' / ' + a.goal.toLocaleString();
          t.appendChild(pr);
        }
        var meta = document.createElement('span');
        meta.className = 'ach-meta';
        meta.textContent = got ? TIERS[a.tier].name + ' · ' + fmtDate(unlocks[a.id]) : TIERS[a.tier].name;
        t.appendChild(meta);
        card.appendChild(t);
        if (highlight === a.id) { card.classList.add('focus'); target = card; }
        grid.appendChild(card);
      });
      body.appendChild(grid);
    });
    if (!n) {
      var empty = document.createElement('p');
      empty.className = 'ach-empty';
      empty.textContent = filter === 'unlocked' ? 'Nothing unlocked yet. Your first line clear is a good start.' : 'Everything is unlocked. Legend.';
      body.appendChild(empty);
    }
    if (target) setTimeout(function () { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 60);
  }

  var openListeners = [];

  function open(highlightId) {
    openListeners.forEach(function (fn) { try { fn(); } catch (e) { /* never block opening */ } });
    if (!modal) buildModal();
    lastFocus = document.activeElement;
    if (highlightId) filter = 'all';
    render(highlightId);
    modal.classList.remove('hidden');
    document.documentElement.classList.add('ach-open');
    var closeBtn = modal.querySelector('.ach-close');
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    if (!modal) return;
    modal.classList.add('hidden');
    document.documentElement.classList.remove('ach-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  window.TetrisAchievements = {
    event: event,
    open: open,
    count: count,
    onChange: function (fn) { listeners.push(fn); },
    onOpen: function (fn) { openListeners.push(fn); }
  };
})();
