// chess-bg.js: Chess's own animated backgrounds (scenes for games-bg.js).
// Scenes: 0 endless board (a checkerboard floor stretching to the horizon), 1 marble (slow veined stone),
// 2 knight's tour (lights hopping in L-shapes across a grid), 3 velvet (soft folds of curtain),
// 4 star board (squares that twinkle like a night sky). A light sits on the last square moved to, each move
// sends a ripple out from it, captures and checks flash, and the scene leans toward whoever is ahead on
// material. It changes every ten moves (from the move number, so both online players see the same one).
// API (window.ChessBG): see games-bg.js.
(function () {
  'use strict';
  if (!window.GameBG) return;

  var SCENES = [
    'vec3 scene(float pat, vec2 uv, vec2 q, float W){',
    '  vec3 col = vec3(0.0); float t = u_time; float e = u_energy; vec3 A = u_ca; vec3 B = u_cb;',
    '  vec2 h = vec2(u_hit.x * W, u_hit.y); float age = u_hit.z; float hr = length(q - h);',
    '  float ripple = pow(sin(hr * 34.0 - age * 10.0) * 0.5 + 0.5, 8.0) * exp(-hr * 2.5) * exp(-age * 0.8);',
    '  float lean = u_balance * 0.15;',
    '  if (pat < 0.5) {',
    // endless board: perspective checkerboard drifting toward the viewer, glow on the horizon
    '    float hz = 0.5 + lean * 0.3;',
    '    if (uv.y < hz) {',
    '      float d = hz - uv.y; float z = 0.3 / d; float x = (uv.x - 0.5) * z * 2.0 + sin(t * 0.1) * 0.5;',
    '      float chk = mod(floor(x) + floor(z - t * 0.3), 2.0);',
    '      float fade = smoothstep(0.0, 0.3, d);',
    '      col = mix(A * 0.06, B * 0.22, chk) * fade + mix(A, B, uv.x) * 0.05 * fade;',
    '    } else {',
    '      col = mix(A, B, 0.5) * exp(-(uv.y - hz) * 7.0) * 0.4 + vec3(0.02, 0.0, 0.04);',
    '    }',
    '  } else if (pat < 1.5) {',
    // marble: warped noise veins
    '    vec2 p = q * 2.2 + vec2(t * 0.03, 0.0); float n = fbm(p + fbm(p * 1.7 + t * 0.02) * 1.5);',
    '    float vein = smoothstep(0.03, 0.0, abs(sin(n * 18.0 + q.x * 2.0)) - 0.02);',
    '    col = mix(vec3(0.03, 0.01, 0.06), A * 0.18, n) + B * vein * 0.35;',
    '  } else if (pat < 2.5) {',
    // knight's tour: a faint grid, glowing dots hopping square to square in knight moves
    '    vec2 g = q * 8.0; vec2 f = abs(fract(g) - 0.5);',
    '    float grid = smoothstep(0.03, 0.0, 0.5 - max(f.x, f.y));',
    '    col = vec3(0.02, 0.0, 0.05) + A * grid * 0.12 + mix(A, B, mod(floor(g.x) + floor(g.y), 2.0)) * 0.03;',
    '    for (int i = 0; i < 4; i++) { float fi = float(i); float step0 = floor(t * (0.8 + e) + fi * 3.0);',
    '      float s = hash1(step0 + fi * 13.0 + u_seed); float s2 = hash1(step0 * 1.3 + fi);',
    '      vec2 home = floor(vec2(hash1(fi + 2.0) * 8.0 * W, hash1(fi + 5.0) * 8.0));',
    '      vec2 jump = vec2(mod(step0 * (fi + 1.0), 3.0) - 1.0, mod(step0 * 2.0 + fi, 3.0) - 1.0) * vec2(2.0, 1.0);',
    '      vec2 pos = mod(home + jump * step0, vec2(8.0 * W, 8.0)) + 0.5;',
    '      float d = length(g - pos);',
    '      col += mix(A, B, s) * exp(-d * 3.0) * (0.6 + s2 * 0.4); }',
    '  } else if (pat < 3.5) {',
    // velvet: vertical folds swaying, light catching the ridges
    '    float x = q.x * 9.0 + sin(q.y * 3.0 + t * 0.5) * 0.6 + sin(t * 0.3 + q.y) * 0.4;',
    '    float fold = sin(x) * 0.5 + 0.5; float ridge = pow(fold, 8.0);',
    '    col = mix(B * 0.05, B * 0.25, fold) + A * ridge * 0.25;',
    '    col *= 0.7 + 0.3 * uv.y;',
    '  } else {',
    // star board: dark squares, light squares hold twinkling stars
    '    vec2 g = q * 10.0; vec2 cell = floor(g); float light = mod(cell.x + cell.y, 2.0);',
    '    col = mix(vec3(0.01, 0.0, 0.03), A * 0.06, light);',
    '    vec2 sq = q * 70.0; float star = step(0.985, hash(floor(sq))) * (0.5 + 0.5 * sin(t * 2.0 + hash(floor(sq)) * 30.0));',
    '    col += mix(A, B, hash(floor(sq) + 3.0)) * star * (0.6 + light * 0.6);',
    '    col += B * fbm(q * 1.5 + t * 0.03) * 0.06;',
    '  }',
    '  col += mix(A, B, 0.5) * ripple * (1.1 + e);',
    '  return col;',
    '}'
  ].join('\n');

  window.ChessBG = window.GameBG.create({
    className: 'chess-bg', count: 5, scenes: SCENES,
    pairs: [
      [[0.62, 0.0, 1.0], [0.95, 0.85, 1.0]],
      [[0.80, 0.65, 1.0], [0.62, 0.0, 1.0]],
      [[0.35, 0.72, 1.0], [0.88, 0.28, 0.95]],
      [[1.0, 0.70, 0.85], [0.90, 0.0, 0.40]],
      [[0.55, 0.75, 1.0], [0.78, 0.49, 1.0]]
    ]
  });
})();
