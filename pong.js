// pong.js: Pong for kanaris-beans.com. vs CPU, local 2-player, and online (PeerJS).
(function () {
  'use strict';

  var G = window.Games;
  var $ = function (s) { return document.querySelector(s); };

  /* ---------- constants ---------- */

  var W = 800, H = 500;
  var PW = 14, PH = 90, PX = 24;
  var PADDLE_SPEED = 520;          // px / second
  var BALL_R = 8;
  var BALL_START = 380, BALL_STEP = 22, BALL_MAX = 950;
  var MAX_ANGLE = Math.PI / 3;     // 60° off horizontal at the paddle edge
  var NET_HZ = 30;

  var CPU = {
    easy: { speed: 0.55, error: 60, react: 0.35 },
    normal: { speed: 0.8, error: 26, react: 0.18 },
    hard: { speed: 1.0, error: 6, react: 0.05 }
  };

  var BUILTIN = ['classic', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'];
  var GIPHY_KEY = 'GlVGYHkr3WSBnllca54iNt0yFbjz7L65';

  /* ---------- state ---------- */

  var canvas = $('#pongCanvas');
  var ctx = canvas.getContext('2d');
  canvas.width = W;
  canvas.height = H;

  var settings = {
    mode: null,                                     // 'cpu' | 'local' | 'online'
    difficulty: G.Store.get('pong_difficulty', 'normal'),
    target: G.Store.get('pong_target', '7'),        // '5' | '7' | '11' | 'inf'
    skin: (function (v) { return typeof v === 'number' ? (v ? 'b' + v : 'classic') : (v || 'classic'); })(G.Store.get('pong_skin', 'classic'))
  };

  var net = { role: null, session: null, conn: null, myReady: false, theirReady: false, lastSend: 0, lastPad: null, them: null };

  var game = null;
  var raf = null;
  var keys = {};
  var pointers = {};
  var skinImages = {};
  var customBalls = G.Store.get('pong_custom_balls', []);
  var sprite = null;
  var best = G.Store.get('pong_best_rally', 0);

  function newGame() {
    return {
      p1: { y: H / 2 - PH / 2, vy: 0, target: null },
      p2: { y: H / 2 - PH / 2, vy: 0, target: null },
      ball: { x: W / 2, y: H / 2, dx: 0, dy: 0, speed: BALL_START },
      score: [0, 0],
      rally: 0,
      serveTimer: 1.2,
      serveDir: Math.random() < 0.5 ? -1 : 1,
      paused: false,
      over: false,
      trail: [],
      particles: [],
      shake: 0,
      niceUntil: 0,
      cpuAim: H / 2,
      cpuThink: 0
    };
  }

  /* ---------- ball skins ---------- */
  // A skin is 'classic', a built-in 'b1'…'b9' (ball1.png / .gif on the site),
  // or a custom one: { id, kind: 'image' | 'gif' | 'emoji', src | emoji }.

  function loadSkins() {
    for (var i = 1; i <= 9; i++) {
      (function (n) {
        var img = new Image();
        img.onerror = function () { img.onerror = null; img.src = 'ball' + n + '.gif'; };
        img.src = 'ball' + n + '.png';
        skinImages['b' + n] = img;
      })(i);
    }
  }

  function skinInfo(id) {
    if (!id || id === 'classic') return { kind: 'classic' };
    if (skinImages[id]) return { kind: 'image', src: skinImages[id].src };
    var c = customBalls.filter(function (x) { return x.id === id; })[0];
    return c ? c : { kind: 'classic' };
  }

  function saveCustom() {
    try { localStorage.setItem('games_pong_custom_balls', JSON.stringify(customBalls)); }
    catch (e) { G.banner('Browser storage is full · remove a custom ball first'); return false; }
    return true;
  }

  function addCustom(ball) {
    ball.id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    customBalls.unshift(ball);
    if (customBalls.length > 16) customBalls.length = 16;
    if (!saveCustom()) { customBalls.shift(); return; }
    selectSkin(ball.id);
  }

  function selectSkin(id) {
    settings.skin = id;
    G.Store.set('pong_skin', id);
    renderSkinPicker();
    syncSprite();
  }

  function skinButton(id, info, removable) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'skin-btn' + (id === settings.skin ? ' active' : '') + (removable ? ' custom' : '');
    b.title = info.kind === 'classic' ? 'Classic' : info.kind === 'emoji' ? info.emoji : 'Ball';
    if (info.kind === 'classic') {
      var dot = document.createElement('span');
      dot.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#f3e6ff;box-shadow:0 0 10px #9d00ff';
      b.appendChild(dot);
    } else if (info.kind === 'emoji') {
      var e = document.createElement('span');
      e.className = 'emoji-ball';
      e.textContent = info.emoji;
      b.appendChild(e);
    } else {
      var img = document.createElement('img');
      img.alt = '';
      img.src = info.src;
      b.appendChild(img);
    }
    b.addEventListener('click', function () { selectSkin(id); });
    if (removable) {
      var x = document.createElement('span');
      x.className = 'skin-remove';
      x.textContent = '×';
      x.title = 'Remove';
      x.addEventListener('click', function (ev) {
        ev.stopPropagation();
        customBalls = customBalls.filter(function (c) { return c.id !== id; });
        saveCustom();
        if (settings.skin === id) selectSkin('classic'); else renderSkinPicker();
      });
      b.appendChild(x);
    }
    return b;
  }

  function renderSkinPicker() {
    var row = $('#skinRow');
    row.textContent = '';
    BUILTIN.forEach(function (id) { row.appendChild(skinButton(id, skinInfo(id), false)); });
    customBalls.forEach(function (c) { row.appendChild(skinButton(c.id, c, true)); });
  }

  function firstEmoji(text) {
    text = String(text || '').trim();
    if (!text) return null;
    var first = text;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      var seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)[Symbol.iterator]().next();
      first = seg.value ? seg.value.segment : text;
    } else {
      first = Array.from(text).slice(0, 2).join('');
    }
    try { if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(first)) return null; } catch (e) {}
    return first;
  }

  function uploadBall() {
    G.pickFile('image/*').then(function (file) {
      if (!file) return;
      var gif = file.type === 'image/gif';
      return G.readImageFile(file, 128, { keepGif: true, png: true, maxGifBytes: 900 * 1024 }).then(function (data) {
        addCustom({ kind: gif ? 'gif' : 'image', src: data });
      });
    }).catch(function (err) { G.banner(err.message); });
  }

  var gifTimer = null;
  function searchGifs() {
    clearTimeout(gifTimer);
    gifTimer = setTimeout(function () {
      var q = $('#gifSearch').value.trim();
      var box = $('#gifResults');
      box.textContent = 'Loading…';
      var url = 'https://api.giphy.com/v1/' + (q ? 'gifs/search?q=' + encodeURIComponent(q) + '&' : 'gifs/trending?') +
        'api_key=' + GIPHY_KEY + '&limit=24&rating=pg';
      fetch(url).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (data) {
        box.textContent = '';
        (data.data || []).forEach(function (gif) {
          var still = gif.images && gif.images.fixed_width_small && gif.images.fixed_width_small.url;
          var src = gif.images && gif.images.fixed_height_small && gif.images.fixed_height_small.url;
          if (!/^https:\/\/[a-z0-9.]*giphy\.com\//.test(src || '')) return;
          var b = document.createElement('button');
          b.type = 'button';
          b.title = gif.title || 'GIF';
          var img = document.createElement('img');
          img.src = still || src;
          img.alt = gif.title || '';
          img.loading = 'lazy';
          b.appendChild(img);
          b.addEventListener('click', function () {
            addCustom({ kind: 'gif', src: src });
            G.hide($('#gifPanel'));
          });
          box.appendChild(b);
        });
        if (!box.children.length) box.textContent = 'No GIFs found.';
      }).catch(function () { box.textContent = 'Couldn\'t reach Giphy right now.'; });
    }, 300);
  }

  // Image and GIF balls are drawn as a real <img> over the canvas so GIFs animate.
  function syncSprite() {
    var info = skinInfo(settings.skin);
    var stage = canvas.parentElement;
    if (sprite) { sprite.remove(); sprite = null; }
    if (info.kind === 'image' || info.kind === 'gif') {
      sprite = document.createElement('img');
      sprite.className = 'ball-sprite';
      sprite.alt = '';
      sprite.src = info.src;
      if (info.src === (skinImages[settings.skin] || {}).src && /\.png$/.test(info.src)) {
        sprite.onerror = function () { sprite.onerror = null; sprite.src = info.src.replace(/\.png$/, '.gif'); };
      }
      stage.appendChild(sprite);
    }
  }

  function placeSprite(b) {
    if (!sprite) return;
    var scale = canvas.clientWidth / W;
    var size = BALL_R * 3.4 * scale;
    sprite.style.width = sprite.style.height = size + 'px';
    sprite.style.transform = 'translate(' + (b.x * scale - size / 2) + 'px,' + (b.y * scale - size / 2) + 'px)';
  }

  /* ---------- screens ---------- */

  var screens = ['menuPanel', 'onlinePanel', 'lobbyPanel', 'gameView'];
  function screen(id) {
    screens.forEach(function (s) { $('#' + s).classList.toggle('hidden', s !== id); });
  }

  function names() {
    if (settings.mode === 'cpu') return ['You', 'CPU'];
    if (settings.mode === 'online') {
      var them = net.them ? net.them.name : 'Opponent';
      return net.role === 'host' ? ['You', them] : [them, 'You'];
    }
    return ['Player 1', 'Player 2'];
  }

  function profiles() {
    var me = G.Profile.get();
    if (settings.mode === 'cpu') return [me, null];
    if (settings.mode === 'online') return net.role === 'host' ? [me, net.them] : [net.them, me];
    return [null, null];
  }

  function hudName(el, name, profile) {
    el.textContent = '';
    if (profile) el.appendChild(G.Profile.avatar(profile, 20));
    el.appendChild(document.createTextNode(name));
  }

  function targetScore() { return settings.target === 'inf' ? Infinity : parseInt(settings.target, 10); }

  function startMatch(mode) {
    settings.mode = mode;
    game = newGame();
    screen('gameView');
    var n = names();
    var pr = profiles();
    hudName($('#name1'), n[0], pr[0]);
    hudName($('#name2'), n[1], pr[1]);
    syncSprite();
    $('#targetLabel').textContent = settings.target === 'inf' ? 'Endless' : 'First to ' + settings.target;
    $('#help').innerHTML = helpText();
    hideOverlay();
    updateHud();
    stopLoop();
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function helpText() {
    if (settings.mode === 'local') return 'Left: <kbd>W</kbd>/<kbd>S</kbd> · Right: <kbd>↑</kbd>/<kbd>↓</kbd> · Touch: drag on your half · <kbd>P</kbd> pause';
    return 'Move: <kbd>W</kbd>/<kbd>S</kbd> or <kbd>↑</kbd>/<kbd>↓</kbd> or drag / move the mouse · <kbd>P</kbd> pause';
  }

  function quitToMenu() {
    stopLoop();
    if (sprite) { sprite.remove(); sprite = null; }
    if (net.session) { net.session.close(); net.session = null; }
    net.role = null;
    net.them = null;
    game = null;
    screen('menuPanel');
  }

  /* ---------- overlay ---------- */

  function overlay(title, text, buttons) {
    var o = $('#overlay');
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
    G.show(o);
  }

  function hideOverlay() { G.hide($('#overlay')); }

  function setPaused(p, fromNet) {
    if (!game || game.over) return;
    game.paused = p;
    if (p) {
      overlay('Paused', settings.mode === 'online' ? 'Either player can resume' : 'Press P to resume', [
        { label: 'Resume', primary: true, onClick: function () { setPaused(false); } },
        { label: 'Quit', onClick: quitToMenu }
      ]);
    } else {
      hideOverlay();
      last = performance.now();
    }
    if (settings.mode === 'online' && !fromNet) sendNet({ t: 'pause', v: p });
  }

  /* ---------- loop ---------- */

  var last = 0;

  function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = null; }

  function loop(now) {
    var dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (game && !game.paused) {
      if (settings.mode === 'online' && net.role === 'guest') guestUpdate(dt);
      else update(dt);
    }
    if (game) draw(now);
    raf = requestAnimationFrame(loop);
  }

  function movePaddle(p, dir, dt) {
    if (p.target != null) {
      var centre = p.y + PH / 2;
      var diff = p.target - centre;
      var step = PADDLE_SPEED * 1.4 * dt;
      p.vy = Math.abs(diff) < 2 ? 0 : Math.sign(diff) * Math.min(Math.abs(diff), step) / dt;
      p.y += Math.sign(diff) * Math.min(Math.abs(diff), step);
    } else {
      p.vy = dir * PADDLE_SPEED;
      p.y += p.vy * dt;
    }
    p.y = Math.max(0, Math.min(H - PH, p.y));
  }

  function keyDir(up, down) {
    var d = 0;
    up.forEach(function (k) { if (keys[k]) d -= 1; });
    down.forEach(function (k) { if (keys[k]) d += 1; });
    return Math.max(-1, Math.min(1, d));
  }

  function update(dt) {
    var g = game;
    var both = ['w', 'arrowup'], bothDown = ['s', 'arrowdown'];

    if (settings.mode === 'local') {
      movePaddle(g.p1, keyDir(['w'], ['s']), dt);
      movePaddle(g.p2, keyDir(['arrowup'], ['arrowdown']), dt);
    } else if (settings.mode === 'cpu') {
      movePaddle(g.p1, keyDir(both, bothDown), dt);
      cpuMove(dt);
    } else {
      // online host: left paddle is mine, right paddle comes from the guest
      movePaddle(g.p1, keyDir(both, bothDown), dt);
    }

    if (g.over) return;

    if (g.serveTimer > 0) {
      g.serveTimer -= dt;
      g.ball.x = W / 2;
      g.ball.y = H / 2;
      if (g.serveTimer <= 0) serve();
    } else {
      stepBall(dt);
    }

    updateEffects(dt);
    if (settings.mode === 'online') hostSend();
  }

  function serve() {
    var g = game;
    var angle = (Math.random() * 0.8 - 0.4);
    g.ball.speed = BALL_START;
    g.ball.dx = Math.cos(angle) * BALL_START * g.serveDir;
    g.ball.dy = Math.sin(angle) * BALL_START;
    g.rally = 0;
    G.Sound.beep(520, 0.06, 'triangle');
  }

  function stepBall(dt) {
    var g = game, b = g.ball;
    // Sub-step so fast balls can't skip through a paddle.
    var steps = Math.max(1, Math.ceil(Math.hypot(b.dx, b.dy) * dt / (BALL_R * 0.8)));
    var h = dt / steps;
    for (var i = 0; i < steps; i++) {
      b.x += b.dx * h;
      b.y += b.dy * h;

      if (b.y - BALL_R < 0) { b.y = BALL_R; b.dy = Math.abs(b.dy); wallHit(); }
      else if (b.y + BALL_R > H) { b.y = H - BALL_R; b.dy = -Math.abs(b.dy); wallHit(); }

      if (b.dx < 0 && paddleHit(g.p1, PX + PW, 1)) continue;
      if (b.dx > 0 && paddleHit(g.p2, W - PX - PW, -1)) continue;

      if (b.x + BALL_R < 0) return point(1);
      if (b.x - BALL_R > W) return point(0);
    }
    g.trail.push({ x: b.x, y: b.y });
    if (g.trail.length > 14) g.trail.shift();
  }

  function paddleHit(p, face, dir) {
    var b = game.ball;
    var crossing = dir === 1 ? (b.x - BALL_R <= face && b.x - BALL_R >= face - PW - BALL_R)
                             : (b.x + BALL_R >= face && b.x + BALL_R <= face + PW + BALL_R);
    if (!crossing) return false;
    if (b.y + BALL_R < p.y || b.y - BALL_R > p.y + PH) return false;

    var rel = Math.max(-1, Math.min(1, (b.y - (p.y + PH / 2)) / (PH / 2)));
    var angle = rel * MAX_ANGLE + (p.vy / PADDLE_SPEED) * 0.12;
    b.speed = Math.min(BALL_MAX, b.speed + BALL_STEP);
    b.dx = Math.cos(angle) * b.speed * dir;
    b.dy = Math.sin(angle) * b.speed;
    b.x = dir === 1 ? face + BALL_R : face - BALL_R;

    game.rally++;
    if (game.rally > best) { best = game.rally; G.Store.set('pong_best_rally', best); }
    if (game.rally === 69) { game.niceUntil = performance.now() + 2500; G.Sound.beep(880, 0.3, 'sine', 0.08); }
    burst(b.x, b.y, dir === 1 ? '#c77dff' : '#ff6fae');
    game.shake = Math.min(6, 2 + b.speed / 250);
    G.Sound.beep(dir === 1 ? 440 : 392, 0.05);
    updateHud();
    return true;
  }

  function wallHit() { G.Sound.beep(300, 0.03, 'square', 0.03); }

  function point(side) {
    var g = game;
    g.score[side]++;
    g.serveDir = side === 0 ? 1 : -1;      // serve towards the player who conceded
    g.serveTimer = 1.0;
    g.trail = [];
    g.ball.dx = g.ball.dy = 0;
    burst(side === 0 ? W - 10 : 10, g.ball.y, '#e60065', 26);
    G.Sound.beep(180, 0.25, 'sawtooth', 0.05);
    updateHud();
    if (g.score[side] >= targetScore()) finish(side);
  }

  function finish(side) {
    var g = game;
    g.over = true;
    var n = names();
    var youWon = settings.mode === 'cpu' ? side === 0 : settings.mode === 'online' ? (net.role === 'host' ? side === 0 : side === 1) : null;
    var title = youWon === null ? n[side] + ' wins!' : youWon ? 'You win!' : settings.mode === 'cpu' ? 'CPU wins' : 'You lose';
    G.Sound.beep(youWon === false ? 200 : 660, 0.4, 'triangle', 0.07);
    if (settings.mode === 'online' && net.role === 'host') sendNet({ t: 'over', side: side, score: g.score });
    showFinish(title);
  }

  function showFinish(title) {
    var g = game;
    overlay(title, g.score[0] + ' – ' + g.score[1] + ' · best rally ' + best, [
      { label: 'Rematch', primary: true, onClick: rematch },
      { label: 'Menu', onClick: quitToMenu }
    ]);
  }

  function rematch() {
    if (settings.mode === 'online') {
      if (!net.session) return quitToMenu();
      sendNet({ t: 'rematch' });
      net.myReady = true;
      $('#overlayText').textContent = 'Waiting for your opponent…';
      maybeStartOnline();
      return;
    }
    startMatch(settings.mode);
  }

  /* ---------- CPU ---------- */

  function predictY(b, targetX) {
    // Follow the ball's path, including wall bounces, to where it reaches targetX.
    var x = b.x, y = b.y, dx = b.dx, dy = b.dy;
    if ((targetX - x) * dx <= 0) return H / 2;
    var t = (targetX - x) / dx;
    y += dy * t;
    var span = H - 2 * BALL_R;
    y -= BALL_R;
    y = ((y % (2 * span)) + 2 * span) % (2 * span);
    if (y > span) y = 2 * span - y;
    return y + BALL_R;
  }

  function cpuMove(dt) {
    var g = game, c = CPU[settings.difficulty] || CPU.normal;
    g.cpuThink -= dt;
    if (g.cpuThink <= 0) {
      g.cpuThink = c.react;
      var b = g.ball;
      g.cpuAim = b.dx > 0 ? predictY(b, W - PX - PW) + (Math.random() * 2 - 1) * c.error : H / 2 + (b.y - H / 2) * 0.3;
    }
    var centre = g.p2.y + PH / 2;
    var diff = g.cpuAim - centre;
    var maxStep = PADDLE_SPEED * c.speed * dt;
    var step = Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
    g.p2.vy = step / dt;
    g.p2.y = Math.max(0, Math.min(H - PH, g.p2.y + step));
  }

  /* ---------- effects ---------- */

  function burst(x, y, color, n) {
    for (var i = 0; i < (n || 14); i++) {
      var a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 220;
      game.particles.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.3, color: color });
    }
  }

  function updateEffects(dt) {
    var g = game;
    g.particles = g.particles.filter(function (p) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      return p.life > 0;
    });
    g.shake = Math.max(0, g.shake - dt * 30);
  }

  /* ---------- drawing ---------- */

  function draw(now) {
    var g = game;
    ctx.save();
    if (g.shake) ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);

    ctx.fillStyle = '#050505';
    ctx.fillRect(-10, -10, W + 20, H + 20);

    // score watermark
    ctx.fillStyle = 'rgba(157, 0, 255, 0.10)';
    ctx.font = '800 140px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(g.score[0], W * 0.25, H / 2);
    ctx.fillText(g.score[1], W * 0.75, H / 2);

    // net
    ctx.strokeStyle = 'rgba(157, 0, 255, 0.28)';
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 14]);
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // paddles
    paddle(PX, g.p1.y, '#9d00ff');
    paddle(W - PX - PW, g.p2.y, '#e60065');

    // trail (classic ball only; it would cover custom balls)
    if (skinInfo(settings.skin).kind === 'classic') g.trail.forEach(function (t, i) {
      ctx.fillStyle = 'rgba(199, 125, 255,' + (i / g.trail.length) * 0.35 + ')';
      ctx.beginPath();
      ctx.arc(t.x, t.y, BALL_R * (0.4 + 0.6 * i / g.trail.length), 0, Math.PI * 2);
      ctx.fill();
    });

    // particles
    g.particles.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, p.life * 1.6);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    });
    ctx.globalAlpha = 1;

    // ball
    var b = g.ball, info = skinInfo(settings.skin);
    if (sprite) {
      placeSprite(b);
    } else if (info.kind === 'emoji') {
      ctx.font = Math.round(BALL_R * 4) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.emoji, b.x, b.y + 1);
    } else {
      ctx.shadowBlur = 16;
      ctx.shadowColor = '#c77dff';
      ctx.fillStyle = '#f3e6ff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // serve countdown
    if (g.serveTimer > 0 && !g.over) {
      ctx.fillStyle = 'rgba(247, 242, 255, 0.85)';
      ctx.font = '700 22px "JetBrains Mono", monospace';
      ctx.fillText(g.score[0] + g.score[1] === 0 ? 'ready' : 'serve', W / 2, H / 2 - 40);
    }

    if (now < g.niceUntil) {
      ctx.font = '800 96px "JetBrains Mono", monospace';
      ctx.shadowBlur = 24;
      ctx.shadowColor = '#9d00ff';
      ctx.fillStyle = '#c77dff';
      ctx.fillText('nice', W / 2, H / 2);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  function paddle(x, y, color) {
    ctx.shadowBlur = 14;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    roundRect(x, y, PW, PH, 5);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function updateHud() {
    if (!game) return;
    $('#score1').textContent = game.score[0];
    $('#score2').textContent = game.score[1];
    $('#rally').textContent = game.rally;
    $('#best').textContent = best;
  }

  /* ---------- input ---------- */

  document.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    if (game && ['arrowup', 'arrowdown', ' '].indexOf(k) !== -1 && !$('#gameView').classList.contains('hidden')) e.preventDefault();
    if (e.target.closest('input, textarea')) return;
    keys[k] = true;
    if ((k === 'p' || k === 'escape') && game && !game.over && !$('#gameView').classList.contains('hidden')) setPaused(!game.paused);
  });
  document.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', function () {
    keys = {};
    if (game && !game.over && settings.mode !== 'online' && !game.paused) setPaused(true);
  });

  function stageY(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }

  function pointerPaddle(x) {
    if (settings.mode === 'local') return x < W / 2 ? game.p1 : game.p2;
    if (settings.mode === 'online' && net.role === 'guest') return game.p2;
    return game.p1;
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (!game) return;
    var p = stageY(e);
    pointers[e.pointerId] = pointerPaddle(p.x);
    pointers[e.pointerId].target = p.y;
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!game) return;
    var p = stageY(e);
    if (e.pointerType === 'mouse' && settings.mode !== 'local') {
      pointerPaddle(p.x).target = p.y;
      return;
    }
    if (pointers[e.pointerId]) pointers[e.pointerId].target = p.y;
  });
  function releasePointer(e) {
    if (pointers[e.pointerId]) {
      if (e.pointerType !== 'mouse') pointers[e.pointerId].target = null;
      delete pointers[e.pointerId];
    }
  }
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('pointerleave', function (e) {
    if (e.pointerType === 'mouse' && game) { game.p1.target = null; game.p2.target = null; }
  });

  // Keyboard input overrides a stale mouse target.
  document.addEventListener('keydown', function (e) {
    if (!game) return;
    if (['w', 's', 'arrowup', 'arrowdown'].indexOf(e.key.toLowerCase()) !== -1) {
      if (settings.mode === 'local') {
        if (e.key.toLowerCase() === 'w' || e.key.toLowerCase() === 's') game.p1.target = null;
        else game.p2.target = null;
      } else {
        game.p1.target = null;
        game.p2.target = null;
      }
    }
  });

  /* ---------- online ---------- */

  function sendNet(msg) {
    if (!net.session) return;
    if (net.role === 'host') net.session.broadcast(msg);
    else net.session.send(msg);
  }

  function hostSend() {
    var now = performance.now();
    if (now - net.lastSend < 1000 / NET_HZ) return;
    net.lastSend = now;
    var g = game;
    sendNet({ t: 's', b: [g.ball.x, g.ball.y, g.ball.dx, g.ball.dy], p: g.p1.y, sc: g.score, r: g.rally, sv: g.serveTimer > 0 ? 1 : 0 });
  }

  function guestUpdate(dt) {
    var g = game;
    movePaddle(g.p2, keyDir(['w', 'arrowup'], ['s', 'arrowdown']), dt);
    // Extrapolate the ball between host updates so it moves smoothly.
    if (!g.over && (g.ball.dx || g.ball.dy)) {
      g.ball.x += g.ball.dx * dt;
      g.ball.y += g.ball.dy * dt;
      if (g.ball.y < BALL_R) { g.ball.y = BALL_R; g.ball.dy = Math.abs(g.ball.dy); }
      if (g.ball.y > H - BALL_R) { g.ball.y = H - BALL_R; g.ball.dy = -Math.abs(g.ball.dy); }
      g.trail.push({ x: g.ball.x, y: g.ball.y });
      if (g.trail.length > 14) g.trail.shift();
    }
    updateEffects(dt);
    var now = performance.now();
    if (now - net.lastSend > 1000 / NET_HZ && net.lastPad !== Math.round(g.p2.y)) {
      net.lastSend = now;
      net.lastPad = Math.round(g.p2.y);
      sendNet({ t: 'p', y: g.p2.y });
    }
  }

  function guestApplyState(d) {
    var g = game;
    if (!g) return;
    var oldDx = g.ball.dx;
    g.ball.x = d.b[0]; g.ball.y = d.b[1]; g.ball.dx = d.b[2]; g.ball.dy = d.b[3];
    g.p1.y = d.p;
    if (oldDx && d.b[2] && Math.sign(oldDx) !== Math.sign(d.b[2])) {
      burst(g.ball.x, g.ball.y, d.b[2] > 0 ? '#c77dff' : '#ff6fae');
      G.Sound.beep(d.b[2] > 0 ? 440 : 392, 0.05);
    }
    if (d.sc[0] !== g.score[0] || d.sc[1] !== g.score[1]) { G.Sound.beep(180, 0.25, 'sawtooth', 0.05); g.trail = []; }
    g.score = d.sc;
    g.rally = d.r;
    g.serveTimer = d.sv ? 1 : 0;
    if (g.rally > best) { best = g.rally; G.Store.set('pong_best_rally', best); }
    if (g.rally === 69 && performance.now() > g.niceUntil) g.niceUntil = performance.now() + 2500;
    updateHud();
  }

  function onNetData(d) {
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'hello':
        settings.target = String(d.target);
        net.them = G.Profile.sanitize(d.profile);
        renderLobby();
        break;
      case 'hi':
        net.them = G.Profile.sanitize(d.profile);
        renderLobby();
        break;
      case 'ready':
        net.theirReady = !!d.v;
        renderLobby();
        maybeStartOnline();
        break;
      case 'start':
        net.myReady = net.theirReady = false;
        settings.target = String(d.target);
        startMatch('online');
        break;
      case 'rematch':
        net.theirReady = true;
        if (game && game.over) $('#overlayText').textContent = 'Opponent wants a rematch!';
        maybeStartOnline();
        break;
      case 'p':
        if (game && net.role === 'host') game.p2.y = Math.max(0, Math.min(H - PH, +d.y || 0));
        break;
      case 's':
        if (net.role === 'guest') guestApplyState(d);
        break;
      case 'pause':
        setPaused(!!d.v, true);
        break;
      case 'over':
        if (game && net.role === 'guest') { game.score = d.score; updateHud(); game.over = true; finishGuest(d.side); }
        break;
    }
  }

  function finishGuest(side) {
    var youWon = side === 1;
    G.Sound.beep(youWon ? 660 : 200, 0.4, 'triangle', 0.07);
    showFinish(youWon ? 'You win!' : 'You lose');
  }

  function maybeStartOnline() {
    if (net.role !== 'host' || !net.myReady || !net.theirReady) return;
    net.myReady = net.theirReady = false;
    sendNet({ t: 'start', target: settings.target });
    startMatch('online');
  }

  function renderLobby() {
    var list = $('#lobbyPlayers');
    list.textContent = '';
    var me = G.Profile.get();
    var connected = net.role === 'guest' || !!(net.session && net.session.conns && net.session.conns.length);
    function status(ready) { return ready ? ['✓ Ready', 'ready'] : ['Not ready', 'waiting']; }
    var mine = status(net.myReady), theirs = status(net.theirReady);
    var hostRow = net.role === 'host' ? G.lobbyRow(me, me.name + ' (host) · you', mine[0], mine[1]) : G.lobbyRow(net.them, (net.them ? net.them.name : 'Host') + ' (host)', theirs[0], theirs[1]);
    var guestRow = net.role === 'host'
      ? (connected ? G.lobbyRow(net.them, net.them ? net.them.name : 'Opponent', theirs[0], theirs[1]) : G.lobbyRow(null, 'Waiting for opponent…', '', 'waiting'))
      : G.lobbyRow(me, me.name + ' · you', mine[0], mine[1]);
    list.appendChild(hostRow);
    list.appendChild(guestRow);
    $('#lobbyTarget').textContent = settings.target === 'inf' ? 'Endless' : 'First to ' + settings.target;
    var connected = net.role === 'guest' || (net.session && net.session.conns.length);
    $('#readyBtn').disabled = !connected;
    $('#readyBtn').textContent = net.myReady ? 'Not ready' : 'Ready';
  }

  function createLobby() {
    net.role = 'host';
    net.myReady = net.theirReady = false;
    $('#onlineNotice').textContent = 'Creating lobby…';
    $('#onlineNotice').className = 'notice';
    net.session = G.Net.host('pong', {
      maxGuests: 1,
      onReady: function (code) {
        $('#lobbyCode').textContent = code;
        G.show($('#lobbyCodeBox'));
        screen('lobbyPanel');
        renderLobby();
      },
      onJoin: function (conn) {
        net.session.send(conn, { t: 'hello', target: settings.target, profile: G.Profile.get() });
        G.Sound.beep(660, 0.1, 'triangle');
        renderLobby();
      },
      onData: function (conn, d) { onNetData(d); },
      onLeave: opponentLeft,
      onError: netError
    });
  }

  function joinLobby() {
    var code = G.cleanCode($('#joinCode').value);
    if (code.length !== 5) { netError('Lobby codes are 5 characters.'); return; }
    net.role = 'guest';
    net.myReady = net.theirReady = false;
    $('#onlineNotice').textContent = 'Connecting…';
    $('#onlineNotice').className = 'notice';
    net.session = G.Net.join('pong', code, {
      onOpen: function () {
        net.session.send({ t: 'hi', profile: G.Profile.get() });
        G.hide($('#lobbyCodeBox'));
        screen('lobbyPanel');
        renderLobby();
      },
      onData: onNetData,
      onClose: opponentLeft,
      onError: netError
    });
  }

  function opponentLeft() {
    if (!net.session) return;
    if (net.role === 'host' && (!game || game.over || $('#gameView').classList.contains('hidden'))) {
      net.theirReady = false;
      renderLobby();
      G.banner('Opponent left');
      if (game && game.over) quitToLobby();
      return;
    }
    if (net.session) { net.session.close(); net.session = null; }
    stopLoop();
    if (game) {
      game.over = true;
      overlay('Opponent left', 'The connection closed.', [{ label: 'Menu', primary: true, onClick: quitToMenu }]);
    } else {
      screen('onlinePanel');
      netError('Lost connection to the lobby.');
    }
  }

  function quitToLobby() {
    stopLoop();
    game = null;
    screen('lobbyPanel');
    renderLobby();
  }

  function netError(msg) {
    $('#onlineNotice').textContent = msg;
    $('#onlineNotice').className = 'notice error';
    if (net.session) { net.session.close(); net.session = null; }
    screen('onlinePanel');
  }

  /* ---------- wiring ---------- */

  function init() {
    loadSkins();
    renderSkinPicker();
    G.Profile.mount($('#profileEditor'));
    $('#uploadBall').addEventListener('click', uploadBall);
    $('#gifBall').addEventListener('click', function () {
      var panel = $('#gifPanel');
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) { $('#gifSearch').focus(); searchGifs(); }
    });
    $('#gifSearch').addEventListener('input', searchGifs);
    $('#emojiForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var em = firstEmoji($('#emojiInput').value);
      if (!em) { G.banner('Type or paste an emoji'); return; }
      $('#emojiInput').value = '';
      addCustom({ kind: 'emoji', emoji: em });
    });
    window.addEventListener('resize', function () { if (game) placeSprite(game.ball); });

    var diff = G.chips($('#difficultyChips'), settings.difficulty, function (v) { settings.difficulty = v; G.Store.set('pong_difficulty', v); });
    G.chips($('#targetChips'), settings.target, function (v) { settings.target = v; G.Store.set('pong_target', v); });
    void diff;

    $('#modeCpu').addEventListener('click', function () { startMatch('cpu'); });
    $('#modeLocal').addEventListener('click', function () { startMatch('local'); });
    $('#modeOnline').addEventListener('click', function () {
      $('#onlineNotice').textContent = G.Net.available() ? 'Online play connects you directly to your opponent.' : 'Online play couldn\'t load on this network.';
      $('#onlineNotice').className = 'notice';
      screen('onlinePanel');
    });
    $('#createLobby').addEventListener('click', createLobby);
    $('#joinForm').addEventListener('submit', function (e) { e.preventDefault(); joinLobby(); });
    $('#onlineBack').addEventListener('click', function () { screen('menuPanel'); });
    $('#lobbyCode').addEventListener('click', function () { G.copyText($('#lobbyCode').textContent); });
    $('#readyBtn').addEventListener('click', function () {
      net.myReady = !net.myReady;
      sendNet({ t: 'ready', v: net.myReady });
      renderLobby();
      maybeStartOnline();
    });
    $('#lobbyLeave').addEventListener('click', quitToMenu);
    $('#pauseBtn').addEventListener('click', function () { if (game) setPaused(!game.paused); });
    $('#quitBtn').addEventListener('click', quitToMenu);
    G.Sound.bindButton($('#soundBtn'));
    G.chatEasterEgg();

    $('#best').textContent = best;
    screen('menuPanel');
  }

  init();
})();
