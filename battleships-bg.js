// battleships-bg.js: Battleships' own animated backgrounds (scenes for games-bg.js).
// Scenes: 0 sonar sweep (radar arm, range rings, blips), 1 night swell (layered waves under a moon),
// 2 the deep (caustic light and rising bubbles), 3 war table (a blueprint grid with pulsing coordinates),
// 4 storm (rolling cloud, rain and lightning). A light sits on the last cell fired at, each shot sends a
// ripple out from it, hits flash, and the scene changes whenever a ship goes down (picked from the number
// of ships sunk, so both online players see the same one). The more ships sunk, the rougher it gets.
// API (window.BattleshipsBG): see games-bg.js.
(function () {
  'use strict';
  if (!window.GameBG) return;

  var SCENES = [
    'vec3 scene(float pat, vec2 uv, vec2 q, float W){',
    '  vec3 col = vec3(0.0); float t = u_time; float e = u_energy; vec3 A = u_ca; vec3 B = u_cb;',
    '  vec2 h = vec2(u_hit.x * W, u_hit.y); float age = u_hit.z; float hr = length(q - h);',
    '  float ripple = pow(sin(hr * 40.0 - age * 12.0) * 0.5 + 0.5, 8.0) * exp(-hr * 2.5) * exp(-age * 0.8);',
    '  if (pat < 0.5) {',
    // sonar: rotating sweep around the centre, rings, fading blips
    '    vec2 c = vec2(0.5 * W, 0.5); vec2 d = q - c; float r = length(d); float a = atan(d.y, d.x);',
    '    float sweep = mod(a - t * (0.9 + e), 6.2831853);',
    '    float arm = exp(-sweep * 2.2) * smoothstep(0.75, 0.0, r);',
    '    float rings = smoothstep(0.012, 0.0, abs(fract(r * 7.0) - 0.5) - 0.48);',
    '    float axes = smoothstep(0.004, 0.0, min(abs(d.x), abs(d.y)));',
    '    vec2 cell = floor(q * 9.0); float blip = step(0.93, hash(cell + floor(t * 0.2))) * exp(-mod(a - t * (0.9 + e) + 0.3, 6.2831853) * 0.6);',
    '    col = A * (arm * 0.9 + rings * 0.16 + axes * 0.12) + B * blip * smoothstep(0.6, 0.0, length(fract(q * 9.0) - 0.5)) * 0.9;',
    '    col += vec3(0.0, 0.02, 0.03);',
    '  } else if (pat < 1.5) {',
    // night swell: stacked sine waves, moon and its reflection
    '    vec2 m = vec2(0.72 * W, 0.78); float moon = smoothstep(0.08, 0.075, length(q - m));',
    '    float glow = exp(-length(q - m) * 6.0);',
    '    col = mix(vec3(0.0, 0.01, 0.04), A * 0.25, uv.y) + B * glow * 0.5 + vec3(0.9, 0.95, 1.0) * moon * 0.8;',
    '    float sea = 0.48;',
    '    if (uv.y < sea) {',
    '      float w = 0.0; float y = uv.y;',
    '      for (int i = 0; i < 5; i++) { float fi = float(i);',
    '        float wave = sin(q.x * (6.0 + fi * 5.0) + t * (0.6 + fi * 0.25) * (1.0 + e) + fi * 2.1) * (0.012 + e * 0.01);',
    '        w += smoothstep(0.006, 0.0, abs(fract((y + wave) * (10.0 + fi * 3.0)) - 0.5) - 0.47) * (0.25 - fi * 0.03); }',
    '      float refl = exp(-abs(q.x - m.x) * 9.0) * (0.5 + 0.5 * sin(y * 120.0 + t * 3.0));',
    '      col = mix(A * 0.12, vec3(0.0, 0.01, 0.03), (sea - y) * 1.6) + A * w + vec3(0.8, 0.9, 1.0) * refl * 0.25 * (y / sea);',
    '    }',
    '  } else if (pat < 2.5) {',
    // the deep: caustics from above, bubbles drifting up
    '    vec2 p = q * 3.0; float c = 0.0;',
    '    for (int i = 0; i < 3; i++) { float fi = float(i); p += vec2(sin(p.y + t * 0.5 + fi), cos(p.x - t * 0.4 + fi * 1.7)) * 0.6;',
    '      c += 0.25 / (abs(sin(p.x) * cos(p.y)) * 6.0 + 0.4); }',
    '    col = mix(vec3(0.0, 0.01, 0.03), A * 0.3, uv.y) + A * c * 0.12 * uv.y;',
    '    vec2 bq = vec2(q.x * 14.0, q.y * 14.0 - t * (1.0 + e * 2.0)); vec2 bid = floor(bq);',
    '    vec2 bf = fract(bq) - 0.5 + vec2(sin(t + bid.y) * 0.2, 0.0);',
    '    float bub = smoothstep(0.12, 0.08, length(bf)) - smoothstep(0.08, 0.04, length(bf));',
    '    col += B * bub * step(0.82, hash(bid)) * 0.8;',
    '  } else if (pat < 3.5) {',
    // war table: blueprint grid, coordinates pulsing, a slow scanning bar
    '    vec2 g = q * 10.0; vec2 f = abs(fract(g) - 0.5);',
    '    float line = smoothstep(0.035, 0.0, 0.5 - max(f.x, f.y));',
    '    float major = smoothstep(0.03, 0.0, 0.5 - max(abs(fract(g.x / 5.0) - 0.5), abs(fract(g.y / 5.0) - 0.5)) * 5.0);',
    '    float pulse = step(0.95, hash(floor(g) + floor(t * 1.5))) * (0.5 + 0.5 * sin(t * 6.0));',
    '    float scan = exp(-abs(uv.y - fract(t * 0.12)) * 30.0);',
    '    col = vec3(0.0, 0.015, 0.04) + A * (line * 0.18 + major * 0.25 + scan * 0.25) + B * pulse * smoothstep(0.5, 0.2, max(f.x, f.y)) * 0.6;',
    '  } else {',
    // storm: rolling cloud bands, rain streaks, lightning on hits and at random
    '    float cloud = fbm(vec2(q.x * 2.0 - t * 0.12, q.y * 3.0));',
    '    col = mix(vec3(0.01, 0.0, 0.03), A * 0.35, cloud * uv.y);',
    '    vec2 rq = vec2(q.x * 60.0 + q.y * 12.0, q.y * 6.0 + t * (6.0 + e * 6.0));',
    '    float rain = step(0.97, hash(floor(rq))) * fract(rq.y);',
    '    col += vec3(0.6, 0.7, 0.9) * rain * 0.18;',
    '    float bolt = step(0.985, hash1(floor(t * 3.0) + u_seed)) * (1.0 - fract(t * 3.0));',
    '    col += B * (bolt * 0.35 + u_flash * 0.2) * uv.y;',
    '  }',
    '  col += mix(A, B, 0.5) * ripple * (1.2 + e);',
    '  return col;',
    '}'
  ].join('\n');

  window.BattleshipsBG = window.GameBG.create({
    className: 'battleships-bg', count: 5, scenes: SCENES,
    pairs: [
      [[0.24, 1.0, 0.62], [0.62, 0.0, 1.0]],
      [[0.25, 0.55, 1.0], [0.78, 0.49, 1.0]],
      [[0.18, 0.83, 0.85], [0.62, 0.0, 1.0]],
      [[0.40, 0.75, 1.0], [0.90, 0.0, 0.40]],
      [[0.45, 0.35, 0.85], [0.80, 0.90, 1.0]]
    ]
  });
})();
