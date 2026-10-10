// pong-bg.js: Pong's own animated backgrounds (WebGL, one small fragment shader drawn at low resolution and
// scaled up for chunky pixels, like Tetris's). Separate from tetris-bg.js on purpose: these are built around
// the court. A soft light follows the real ball on screen, paddle hits send out a ripple from where they
// happened, the scene gets more intense as a rally grows, and it leans towards whoever is winning.
//
// Scenes: 0 neon court (a floor grid racing toward the net), 1 ping waves (ripples from every hit),
// 2 LED rain (scoreboard pixels falling), 3 arcade sunset (striped sun over a grid horizon),
// 4 orbit (lights bouncing round a box), 5 split field (the two players' colours meeting at a wavy net).
// The scene changes on every point, chosen from the score so both online players see the same one.
//
// API (window.PongBG): mount(host), setCourt(canvasEl), ball(x, y) (court pixels), hit(x, y, strength),
// point(side), rally(n), score(a, b), scene(n), shuffle()
(function () {
  'use strict';

  var COUNT = 6;
  var COURT_W = 800, COURT_H = 500;

  var FRAG = [
    'precision mediump float;',
    'uniform vec2 u_res; uniform float u_time;',
    'uniform float u_pa; uniform float u_pb; uniform float u_blend;',
    'uniform vec2 u_ball; uniform vec3 u_hit; uniform float u_rally; uniform float u_balance;',
    'uniform float u_flash; uniform vec3 u_ca; uniform vec3 u_cb; uniform float u_seed;',
    'float hash(vec2 v){ return fract(sin(dot(v, vec2(12.9898,78.233)))*43758.5453); }',
    'float hash1(float n){ return fract(sin(n*91.345)*47453.5453); }',
    // one scene at uv (0..1, y up), aspect-corrected q
    'vec3 scene(float pat, vec2 uv, vec2 q, float W){',
    '  vec3 col = vec3(0.0); float t = u_time; float e = u_rally;',
    '  vec3 A = u_ca; vec3 B = u_cb;',
    '  if (pat < 0.5) {',
    // neon court: perspective floor below the horizon, rows racing toward the viewer
    '    float hz = 0.46; float y = uv.y;',
    '    if (y < hz) {',
    '      float d = (hz - y); float z = 0.35 / d; float x = (uv.x - 0.5) * z * 2.2;',
    '      float rows = fract(z * 0.9 - t * (0.9 + e * 2.5)); float cols = fract(x * 1.6);',
    '      float g = smoothstep(0.06, 0.0, min(rows, 1.0 - rows)) + smoothstep(0.05, 0.0, min(cols, 1.0 - cols));',
    '      float fade = smoothstep(0.0, 0.25, d);',
    '      col = mix(A, B, uv.x) * g * fade * (0.55 + e * 0.6);',
    '      col += mix(A, B, 0.5) * 0.08 * fade;',
    '    } else {',
    '      float glow = exp(-(y - hz) * 9.0);',
    '      col = mix(A, B, uv.x) * glow * 0.75 + vec3(0.02, 0.0, 0.05);',
    '      float star = step(0.995, hash(floor(q * 90.0))) * (0.5 + 0.5 * sin(t * 3.0 + hash(floor(q * 90.0)) * 40.0));',
    '      col += vec3(star) * 0.6 * (1.0 - glow);',
    '    }',
    '  } else if (pat < 1.5) {',
    // ping waves: rings expanding from the last hit, plus slow background swell
    '    vec2 h = vec2(u_hit.x * W, u_hit.y); float age = u_hit.z;',
    '    float r = length(q - h);',
    '    float ring = sin(r * 38.0 - age * 14.0) * 0.5 + 0.5;',
    '    ring = pow(ring, 6.0) * exp(-r * 2.2) * exp(-age * 0.9);',
    '    float swell = sin(q.x * 6.0 + t * 0.7) * sin(q.y * 7.0 - t * 0.5) * 0.5 + 0.5;',
    '    col = mix(A, B, swell) * (0.10 + swell * 0.12) + mix(B, A, uv.x) * ring * (1.4 + e);',
    '    float bg = sin(r * 10.0 - t * 2.0) * 0.5 + 0.5;',
    '    col += mix(A, B, 0.5) * pow(bg, 12.0) * 0.12;',
    '  } else if (pat < 2.5) {',
    // LED rain: columns of pixels falling at different speeds, brighter as the rally grows
    '    vec2 cell = vec2(56.0 * W / 1.6, 40.0); vec2 id = floor(uv * cell); vec2 f = fract(uv * cell);',
    '    float sp = 0.3 + hash1(id.x) * 1.2 + e * 1.5;',
    '    float head = fract(hash1(id.x + 7.0) - t * sp * 0.25);',
    '    float yy = fract(uv.y + 0.0);',
    '    float dist = fract(head - yy + 1.0);',
    '    float tail = exp(-dist * (9.0 - e * 4.0)) * step(0.3, hash1(id.x + 3.0));',
    '    float led = smoothstep(0.5, 0.3, length(f - 0.5));',
    '    col = mix(A, B, hash1(id.x)) * tail * led * 1.2 + vec3(0.03, 0.0, 0.05) * led;',
    '  } else if (pat < 3.5) {',
    // arcade sunset: big striped sun, horizon grid, scanlines
    '    vec2 sc = vec2(0.5 * W, 0.52); float r = length(q - sc);',
    '    float sun = smoothstep(0.30, 0.295, r);',
    '    float stripes = step(0.5, fract((q.y - 0.52) * 26.0 - t * 0.4)) + step(0.62, q.y);',
    '    sun *= clamp(stripes, 0.0, 1.0);',
    '    vec3 sky = mix(B * 0.35, vec3(0.02, 0.0, 0.06), clamp((uv.y - 0.3) * 1.6, 0.0, 1.0));',
    '    col = sky + mix(B, A, (q.y - 0.22) * 2.0) * sun * (0.9 + e * 0.4);',
    '    col += mix(A, B, 0.5) * exp(-abs(r - 0.31) * 30.0) * 0.4;',
    '    if (uv.y < 0.34) {',
    '      float d = 0.34 - uv.y; float z = 0.2 / d; float x = (uv.x - 0.5) * z * 2.0;',
    '      float g = smoothstep(0.07, 0.0, min(fract(z - t * (0.6 + e)), 1.0 - fract(z - t * (0.6 + e)))) + smoothstep(0.05, 0.0, min(fract(x), 1.0 - fract(x)));',
    '      col = vec3(0.02, 0.0, 0.05) + A * g * smoothstep(0.0, 0.2, d) * 0.9;',
    '    }',
    '    col *= 0.85 + 0.15 * sin(uv.y * u_res.y * 3.14);',
    '  } else if (pat < 4.5) {',
    // orbit: five lights bouncing round the box, trails as soft glow
    '    for (int i = 0; i < 5; i++) {',
    '      float fi = float(i); float sp = 0.15 + hash1(fi + u_seed) * 0.25 + e * 0.3;',
    '      vec2 p = vec2(abs(fract(t * sp * 0.7 + hash1(fi * 3.1 + u_seed)) * 2.0 - 1.0) * W, abs(fract(t * sp * 0.53 + hash1(fi * 5.7 + u_seed)) * 2.0 - 1.0));',
    '      float d = length(q - p);',
    '      col += mix(A, B, hash1(fi + 1.0)) * (0.012 / (d * d + 0.002)) * 0.05;',
    '    }',
    '    col += vec3(0.02, 0.0, 0.04);',
    '    float grid = smoothstep(0.02, 0.0, min(fract(q.x * 8.0), 1.0 - fract(q.x * 8.0))) + smoothstep(0.02, 0.0, min(fract(q.y * 8.0), 1.0 - fract(q.y * 8.0)));',
    '    col += mix(A, B, uv.x) * grid * 0.06;',
    '  } else {',
    // split field: left colour vs right colour, the wavy seam leaning towards whoever is behind
    '    float seam = 0.5 - u_balance * 0.18 + sin(uv.y * 9.0 + t * 1.6) * (0.02 + e * 0.03) + sin(uv.y * 23.0 - t * 3.0) * 0.008;',
    '    float side = smoothstep(seam - 0.004, seam + 0.004, uv.x);',
    '    float bands = sin((uv.x - seam) * 60.0 - t * 4.0 * sign(uv.x - seam)) * 0.5 + 0.5;',
    '    float near = exp(-abs(uv.x - seam) * 18.0);',
    '    col = mix(A, B, side) * (0.10 + 0.10 * bands * near) + vec3(1.0) * near * near * 0.25 * (0.6 + e);',
    '  }',
    '  return col;',
    '}',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / u_res; float W = u_res.x / u_res.y; vec2 q = vec2(uv.x * W, uv.y);',
    '  vec3 a = scene(u_pa, uv, q, W); vec3 b = scene(u_pb, uv, q, W);',
    '  vec3 col = mix(a, b, u_blend);',
    // the light that follows the ball, and a flash when a point is scored
    '  vec2 bp = vec2(u_ball.x * W, u_ball.y); float bd = length(q - bp);',
    '  col += mix(u_ca, u_cb, u_ball.x) * (0.06 / (bd * bd * 18.0 + 0.4)) * (0.35 + u_rally * 0.5);',
    '  col += mix(u_ca, u_cb, 0.5) * u_flash * 0.35;',
    '  col = 1.0 - exp(-col * 1.6);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';

  // Colour pairs per scene: the site's purple and pink first, then a few cousins.
  var PAIRS = [
    [[0.62, 0.0, 1.0], [0.90, 0.0, 0.40]],
    [[0.25, 0.85, 1.0], [0.62, 0.0, 1.0]],
    [[0.72, 1.0, 0.30], [0.18, 0.83, 0.75]],
    [[1.0, 0.84, 0.25], [1.0, 0.25, 0.64]],
    [[0.78, 0.49, 1.0], [0.40, 0.95, 1.0]],
    [[0.62, 0.0, 1.0], [0.90, 0.0, 0.40]]
  ];

  var S = {
    gl: null, u: {}, canvas: null, court: null, start: performance.now(), raf: null, reduced: false,
    pa: 0, pb: 0, blend: 1, blendT: 1, ca: PAIRS[0][0].slice(), cb: PAIRS[0][1].slice(), ta: PAIRS[0][0], tb: PAIRS[0][1],
    ball: [0.5, 0.5], ballT: [0.5, 0.5], hit: [0.5, 0.5, 99], hitAt: 0,
    rally: 0, rallyT: 0, balance: 0, balanceT: 0, flash: 0, seed: 1
  };

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { if (window.console) console.warn('[pong-bg]', gl.getShaderInfoLog(sh)); return null; }
    return sh;
  }

  function mount(host) {
    var cv = document.createElement('canvas');
    cv.className = 'pong-bg';
    cv.setAttribute('aria-hidden', 'true');
    host.insertBefore(cv, host.firstChild);
    S.canvas = cv;
    S.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var gl = cv.getContext('webgl', { antialias: false, alpha: false, depth: false, powerPreference: 'low-power' });
    if (!gl) { cv.classList.add('fallback'); return; }
    var vs = compile(gl, gl.VERTEX_SHADER, VERT), fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
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
    ['u_res', 'u_time', 'u_pa', 'u_pb', 'u_blend', 'u_ball', 'u_hit', 'u_rally', 'u_balance', 'u_flash', 'u_ca', 'u_cb', 'u_seed']
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
    S.ball[0] = lerp(S.ball[0], S.ballT[0], 1 - Math.exp(-dt * 18));
    S.ball[1] = lerp(S.ball[1], S.ballT[1], 1 - Math.exp(-dt * 18));
    S.rally = lerp(S.rally, S.rallyT, k * 0.5);
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
    gl.uniform2f(u.u_ball, S.ball[0], S.ball[1]);
    gl.uniform3f(u.u_hit, S.hit[0], S.hit[1], S.hitAt ? (now - S.hitAt) / 1000 : 99);
    gl.uniform1f(u.u_rally, S.rally);
    gl.uniform1f(u.u_balance, S.balance);
    gl.uniform1f(u.u_flash, S.reduced ? 0 : S.flash);
    gl.uniform3fv(u.u_ca, S.ca);
    gl.uniform3fv(u.u_cb, S.cb);
    gl.uniform1f(u.u_seed, S.seed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!S.reduced) kick();
  }
  function kick() { if (!S.raf && S.gl) S.raf = requestAnimationFrame(frame); }

  // Court pixels -> where that is on the window (0..1, y up), using the court canvas's place on the page.
  function toWindow(x, y) {
    if (!S.court) return [0.5, 0.5];
    var r = S.court.getBoundingClientRect(), w = window.innerWidth || 1, h = window.innerHeight || 1;
    return [(r.left + x / COURT_W * r.width) / w, 1 - (r.top + y / COURT_H * r.height) / h];
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

  window.PongBG = {
    mount: mount,
    setCourt: function (el) { S.court = el; },
    ball: function (x, y) { S.ballT = toWindow(x, y); },
    hit: function (x, y, strength) { var p = toWindow(x, y); S.hit = [p[0], p[1], 0]; S.hitAt = performance.now(); S.flash = Math.max(S.flash, 0.15 * (strength || 1)); kick(); },
    point: function () { S.flash = 1; kick(); },
    rally: function (n) { S.rallyT = Math.min(1, Math.max(0, n) / 40); },
    // positive when the left player leads; the split field's seam leans away from the leader
    score: function (a, b) { S.balanceT = Math.max(-1, Math.min(1, (a - b) / 5)); scene(a + b); },
    scene: scene,
    shuffle: function () { scene(S.pb + 1); return S.pb; },
    current: function () { return S.pb; }
  };
})();
