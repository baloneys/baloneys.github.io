// games-achievements.js: the achievements engine shared by Tetris and Pong (saved in this browser via
// Games.Store, and synced to the player's profile by games-social.js when that's on).
//
// Each game describes its achievements and how its events unlock them, then calls
// GameAchievements.create(cfg). The engine keeps lifetime counters for the progress ones, shows a glass toast
// with a bar that fills while it is up (hover pauses it, a click opens the browser), and draws a browser of
// every achievement with progress and unlock dates. Icons are tiny pixel-art bitmaps drawn once to data URLs,
// tinted by tier.
//
// cfg: { game, storeUnlocks, storeStats, categories, list, emptyText, handlers(api) -> { eventName: fn(data) } }
//   api: { unlock(id), addStat(name, n), stats() }
// Returns: event(name, data), open(), count(), onChange(fn), onOpen(fn), list(), get(id), tiers, badge(id, size,
//   locked), onUnlock(fn), importUnlocks({ id: time }) (unlocks from the profile, no toast or reward), setSynced(on)
(function () {
  'use strict';

  var G = window.Games;

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

  // All in the site's purple; higher tiers are lighter and glow more.
  var TIERS = {
    bronze: { name: 'Bronze', a: '#c9a2ff', b: '#5b2aa8', glow: 'rgba(160,100,255,0.4)' },
    silver: { name: 'Silver', a: '#dcc4ff', b: '#6c35c8', glow: 'rgba(175,115,255,0.5)' },
    gold: { name: 'Gold', a: '#ecdcff', b: '#7d3cff', glow: 'rgba(190,130,255,0.6)' },
    platinum: { name: 'Platinum', a: '#ffffff', b: '#9b4dff', glow: 'rgba(205,150,255,0.75)' }
  };

  function create(cfg) {
    var STORE_UNLOCKS = cfg.storeUnlocks, STORE_STATS = cfg.storeStats;
    var CATEGORIES = cfg.categories, LIST = cfg.list, synced = false;

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
      unlockListeners.forEach(function (fn) { try { fn(BY_ID[id]); } catch (e) { /* listener errors never block unlocks */ } });
    }
    var unlockListeners = [];

    function addStat(name, n) {
      stats[name] = (stats[name] || 0) + n;
      LIST.forEach(function (a) { if (a.stat === name && stats[name] >= a.goal) unlock(a.id); });
      save();
    }

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
      modal.querySelector('.ach-sub').textContent = c.unlocked + ' of ' + c.total + ' unlocked · ' + (synced ? 'synced to your profile' : 'saved in this browser');
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
        empty.textContent = filter === 'unlocked' ? cfg.emptyText : 'Everything is unlocked. Legend.';
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


    var HANDLERS = cfg.handlers({ unlock: unlock, addStat: addStat, stats: function () { return stats; } });

    // Unlocks that came from the player's profile (earned on another device or browser): recorded quietly,
    // no toast and no reward, since they were rewarded when first earned.
    function importUnlocks(map) {
      var added = 0;
      Object.keys(map || {}).forEach(function (id) {
        if (BY_ID[id] && !unlocks[id]) { unlocks[id] = +map[id] || Date.now(); added++; }
      });
      if (!added) return 0;
      save();
      listeners.forEach(function (fn) { try { fn(); } catch (e) { /* never block */ } });
      return added;
    }

    return {
      game: cfg.game,
      event: event,
      open: open,
      count: count,
      onChange: function (fn) { listeners.push(fn); },
      onOpen: function (fn) { openListeners.push(fn); },
      // For player profiles (games-social.js): every achievement with its unlock time (0 if locked),
      // its pixel badge, and a callback per new unlock (used to grant XP and points).
      list: function () { return LIST.map(function (a) { return Object.assign({ unlocked: unlocks[a.id] || 0 }, a); }); },
      get: function (id) { return BY_ID[id] || null; },
      tiers: TIERS,
      badge: function (id, size, locked) { return BY_ID[id] ? badge(BY_ID[id], !!locked, size) : document.createElement('span'); },
      onUnlock: function (fn) { unlockListeners.push(fn); },
      importUnlocks: importUnlocks,
      setSynced: function (on) { synced = !!on; }
    };
  }

  window.GameAchievements = { create: create, TIERS: TIERS, GLYPH: GLYPH };
})();
