// games-bg.js: a small engine for a game's animated background (WebGL, one fragment shader drawn at low
// resolution and scaled up for chunky pixels, like Tetris's and Pong's). Battleships and Chess each give it
// their own scenes; Tetris (tetris-bg.js) and Pong (pong-bg.js) keep their own, older files.
//
// GameBG.create(cfg) -> api
//   cfg: { className, scenes: GLSL string defining vec3 scene(float pat, vec2 uv, vec2 q, float W),
//          count (number of scenes), pairs: [[rgbA, rgbB], ...] one colour pair per scene }
//   The scene code can read: u_time, u_res, u_focus (vec2, window 0..1, y up), u_hit (vec3 x, y, seconds
//   since), u_energy (0..1), u_balance (-1..1), u_flash (0..1), u_ca / u_cb (the scene's colours), u_seed.
// api: mount(host), focus(el | {x, y}), hit(el | {x, y}, strength), flash(n), energy(0..1), balance(-1..1),
//   scene(n), shuffle(), current()
// Positions can be a DOM element (its centre on screen is used) or window coordinates in pixels.
(function () {
  'use strict';

  var HEAD = [
    'precision mediump float;',
    'uniform vec2 u_res; uniform float u_time;',
    'uniform float u_pa; uniform float u_pb; uniform float u_blend;',
    'uniform vec2 u_focus; uniform vec3 u_hit; uniform float u_energy; uniform float u_balance;',
    'uniform float u_flash; uniform vec3 u_ca; uniform vec3 u_cb; uniform float u_seed;',
    'float hash(vec2 v){ return fract(sin(dot(v, vec2(12.9898,78.233)))*43758.5453); }',
    'float hash1(float n){ return fract(sin(n*91.345)*47453.5453); }',
    'float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);',
    '  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), f.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), f.x), f.y); }',
    'float fbm(vec2 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a*noise(p); p *= 2.03; a *= 0.5; } return v; }'
  ].join('\n');

  var TAIL = [
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / u_res; float W = u_res.x / u_res.y; vec2 q = vec2(uv.x * W, uv.y);',
    '  vec3 col = mix(scene(u_pa, uv, q, W), scene(u_pb, uv, q, W), u_blend);',
    '  vec2 fp = vec2(u_focus.x * W, u_focus.y); float fd = length(q - fp);',
    '  col += mix(u_ca, u_cb, 0.5) * (0.05 / (fd * fd * 16.0 + 0.4)) * (0.4 + u_energy * 0.5);',
    '  col += mix(u_ca, u_cb, 0.5) * u_flash * 0.3;',
    '  col = 1.0 - exp(-col * 1.6);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';

  function create(cfg) {
    var COUNT = cfg.count, PAIRS = cfg.pairs;
    var S = {
      gl: null, u: {}, canvas: null, start: performance.now(), raf: null, reduced: false, last: 0,
      pa: 0, pb: 0, blend: 1, ca: PAIRS[0][0].slice(), cb: PAIRS[0][1].slice(), ta: PAIRS[0][0], tb: PAIRS[0][1],
      focus: [0.5, 0.5], focusT: [0.5, 0.5], hit: [0.5, 0.5], hitAt: 0, energy: 0, energyT: 0, balance: 0, balanceT: 0, flash: 0, seed: 1
    };

    function compile(gl, type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { if (window.console) console.warn('[' + cfg.className + ']', gl.getShaderInfoLog(sh)); return null; }
      return sh;
    }

    function mount(host) {
      var cv = document.createElement('canvas');
      cv.className = cfg.className + ' game-bg';
      cv.setAttribute('aria-hidden', 'true');
      host.insertBefore(cv, host.firstChild);
      S.canvas = cv;
      S.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var gl = cv.getContext('webgl', { antialias: false, alpha: false, depth: false, powerPreference: 'low-power' });
      if (!gl) { cv.classList.add('fallback'); return; }
      var vs = compile(gl, gl.VERTEX_SHADER, VERT), fs = compile(gl, gl.FRAGMENT_SHADER, HEAD + '\n' + cfg.scenes + '\n' + TAIL);
      if (!vs || !fs) { cv.classList.add('fallback'); return; }
      var prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { cv.classList.add('fallback'); return; }
      gl.useProgram(prog);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, 'a');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      ['u_res', 'u_time', 'u_pa', 'u_pb', 'u_blend', 'u_focus', 'u_hit', 'u_energy', 'u_balance', 'u_flash', 'u_ca', 'u_cb', 'u_seed']
        .forEach(function (n) { S.u[n] = gl.getUniformLocation(prog, n); });
      S.gl = gl;
      resize();
      window.addEventListener('resize', resize);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
      kick();
    }

    // Low resolution on purpose (chunky pixels, and cheap): about 220 px across, matching the window's shape.
    function resize() {
      if (!S.canvas) return;
      var w = window.innerWidth || 800, h = window.innerHeight || 600;
      var cw = Math.max(44, Math.round(220 / (window.ChatScenePixel || 1)));
      var ch = Math.max(24, Math.round(cw * h / w));
      S.canvas.width = cw; S.canvas.height = ch;
      if (S.gl) S.gl.viewport(0, 0, cw, ch);
    }

    function lerp(a, b, k) { return a + (b - a) * k; }

    function frame(now) {
      S.raf = null;
      if (!S.gl || document.hidden) return;
      var dt = Math.min(0.05, (now - (S.last || now)) / 1000);
      S.last = now;
      var k = 1 - Math.exp(-dt * 6);
      S.focus[0] = lerp(S.focus[0], S.focusT[0], k);
      S.focus[1] = lerp(S.focus[1], S.focusT[1], k);
      S.energy = lerp(S.energy, S.energyT, k * 0.5);
      S.balance = lerp(S.balance, S.balanceT, k * 0.4);
      S.flash = Math.max(0, S.flash - dt * 1.8);
      if (S.blend < 1) S.blend = Math.min(1, S.blend + dt / 1.3);
      for (var i = 0; i < 3; i++) { S.ca[i] = lerp(S.ca[i], S.ta[i], k * 0.5); S.cb[i] = lerp(S.cb[i], S.tb[i], k * 0.5); }
      var gl = S.gl, u = S.u, t = S.reduced ? 0 : (now - S.start) / 1000;
      gl.uniform2f(u.u_res, S.canvas.width, S.canvas.height);
      gl.uniform1f(u.u_time, t);
      gl.uniform1f(u.u_pa, S.pa);
      gl.uniform1f(u.u_pb, S.pb);
      gl.uniform1f(u.u_blend, S.blend * S.blend * (3 - 2 * S.blend));
      gl.uniform2f(u.u_focus, S.focus[0], S.focus[1]);
      gl.uniform3f(u.u_hit, S.hit[0], S.hit[1], S.hitAt ? (now - S.hitAt) / 1000 : 99);
      gl.uniform1f(u.u_energy, S.energy);
      gl.uniform1f(u.u_balance, S.balance);
      gl.uniform1f(u.u_flash, S.reduced ? 0 : S.flash);
      gl.uniform3fv(u.u_ca, S.ca);
      gl.uniform3fv(u.u_cb, S.cb);
      gl.uniform1f(u.u_seed, S.seed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!S.reduced) kick();
    }
    function kick() { if (!S.raf && S.gl) S.raf = requestAnimationFrame(frame); }

    // An element's centre (or {x, y} window pixels) -> window 0..1 with y up.
    function toWindow(p) {
      var w = window.innerWidth || 1, h = window.innerHeight || 1, x, y;
      if (p && p.getBoundingClientRect) { var r = p.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
      else if (p) { x = p.x; y = p.y; }
      else return [0.5, 0.5];
      return [x / w, 1 - y / h];
    }

    function scene(n) {
      n = ((n | 0) % COUNT + COUNT) % COUNT;
      if (n === S.pb && S.blend >= 1) return;
      S.pa = S.pb;
      S.pb = n;
      S.blend = 0;
      S.ta = PAIRS[n][0]; S.tb = PAIRS[n][1];
      S.seed = 1 + n * 7.31;
      kick();
    }

    return {
      mount: mount,
      focus: function (p) { S.focusT = toWindow(p); kick(); },
      hit: function (p, strength) { var w = toWindow(p); S.hit = [w[0], w[1]]; S.hitAt = performance.now(); S.flash = Math.max(S.flash, 0.12 * (strength || 1)); kick(); },
      flash: function (n) { S.flash = Math.max(S.flash, n == null ? 1 : n); kick(); },
      energy: function (x) { S.energyT = Math.max(0, Math.min(1, x)); },
      balance: function (x) { S.balanceT = Math.max(-1, Math.min(1, x)); },
      scene: scene,
      shuffle: function () { scene(S.pb + 1); return S.pb; },
      current: function () { return S.pb; }
    };
  }

  window.GameBG = { create: create };
})();
