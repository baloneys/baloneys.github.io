// tetris-bg.js: the animated background behind Tetris (a port of the VRChat world's stage backgrounds).
//
// One WebGL fragment shader draws 16 looping patterns (8 everyday ones plus 8 themed ones that join the rotation
// when their game type or skull is in play). It is built to stay cheap on any device:
//   - renders at a tiny internal resolution (150 px wide, like the VRChat stage's 150x44 pixel grid) and the page
//     scales it up with nearest-neighbour filtering, which is both the chunky pixel look and nearly free to draw,
//   - caps itself at 30 fps, and stops entirely while the tab is hidden or the page is scrolled away from it,
//   - honours prefers-reduced-motion (one still frame, redrawn only when something changes),
//   - falls back to a CSS gradient when WebGL is unavailable.
// It reacts to play: streaks raise its energy, garbage adds pressure, hard drops send shockwaves,
// line clears pulse through it, and every pattern shifts through saturated colours while avoiding yellow, beige and brown.
//
// API (window.TetrisBG): mount(el), setThemes(mask), milestone(), shuffle() -> {p, s}, show(pattern, seed),
// setEnergy(0..1), setPressure(0..1), pulse(strength), impact(strength), setDanger(0..1)
(function () {
  'use strict';

  var BASE = 4, THEMES = 8, EXTRAS = 4, COUNT = BASE + THEMES + EXTRAS;
  // Theme bits (match the VRChat world): strata, storm, warp, clock, party, stars, fog, kaleidoscope.
  var TH = { STRATA: 1, STORM: 2, WARP: 4, CLOCK: 8, PARTY: 16, STARS: 32, FOG: 64, KALEIDO: 128 };
  var THEME_HUE = [0.07, 0.62, 0.52, 0.12, 0.92, 0.74, 0.48, 0.83];

  var FRAG = [
    'precision mediump float;',
    'uniform vec2 u_res; uniform float u_time; uniform float u_turn;',
    'uniform float u_pa; uniform float u_pb; uniform float u_blend;',
    'uniform vec4 u_sa; uniform vec4 u_sb;',
    'uniform vec3 u_deep; uniform vec3 u_dusk; uniform vec3 u_moon;',
    'uniform float u_hue; uniform float u_energy; uniform float u_pulse; uniform float u_danger;',
    'uniform float u_impact; uniform float u_pressure; uniform float u_cinematic;',
    'float crest(float x){ float c = sin(x)*0.5+0.5; c*=c; return c*c; }',
    'float hash(vec2 v){ return fract(sin(dot(v, vec2(12.9898,78.233)))*43758.5453); }',
    'vec3 rainbow(float h){ return clamp(abs(fract(h+vec3(0.0,0.333,0.667))*6.0-3.0)-1.0, 0.0, 1.0); }',
    'vec3 stage(vec2 p, float turn, float pat, vec4 sd){',
    '  float t = turn*6.2831853; float a; float b; float foam; vec3 extra = vec3(0.0);',
    '  vec2 asp = vec2(p.x*u_res.x/u_res.y, p.y); float W = u_res.x/u_res.y;',
    '  vec2 ld = (p-vec2(0.78,0.8))*vec2(1.0,1.5); float light = clamp(1.0-dot(ld,ld)*1.6,0.0,1.0);',
    '  if (pat < 0.5) {',
    '    float surge = 0.5+0.5*sin(t);',
    '    float wa = sin(p.x*(15.0+sd.x*8.0)+t*2.0+sd.y*6.0)*0.065 + sin(p.x*37.0-t*3.0)*0.022;',
    '    float wb = sin(p.x*(13.0+sd.z*9.0)-t*2.0+sd.w*6.0)*0.075 + sin(p.x*31.0+t*3.0)*0.025;',
    '    float da = p.y-(0.16+surge*0.35+wa); float db = p.y-(0.84-surge*0.35+wb);',
    '    a = 1.0-smoothstep(0.005,0.11,abs(da)); b = 1.0-smoothstep(0.005,0.11,abs(db));',
    '    foam = clamp((surge-0.65)*3.0,0.0,1.0)*a*b;',
    '  } else if (pat < 1.5) {',
    '    vec2 l=(p-vec2(-0.12,sd.x))*vec2(1.5,1.0); vec2 r=(p-vec2(1.12,sd.z))*vec2(1.5,1.0);',
    '    a = crest(length(l)*(22.0+sd.y*7.0)-t*2.0); b = crest(length(r)*(19.0+sd.w*7.0)-t*3.0); foam = a*b*0.7;',
    '  } else if (pat < 2.5) {',
    '    float fold = sin(p.y*10.0+t+sd.x*6.0)*0.12;',
    '    a = crest((p.x+p.y*0.65+fold)*(17.0+sd.y*7.0)-t); b = crest((p.x*0.5-p.y+sin(p.x*12.0-t)*0.08)*19.0+t*2.0); foam = a*b*0.45;',
    '  } else if (pat < 3.5) {',
    '    vec2 l=(p-vec2(0.28+sin(t)*0.08,0.45+cos(t)*0.13))*vec2(1.6,1.0); vec2 r=(p-vec2(0.72+cos(t)*0.07,0.55+sin(t)*0.12))*vec2(1.6,1.0);',
    '    a = crest(length(l)*(23.0+sd.x*7.0)+p.y*7.0-t*2.0); b = crest(length(r)*(21.0+sd.z*8.0)-p.x*8.0+t*2.0); foam = a*b*0.65;',
    '  } else if (pat < 4.5) {',  // strata
    '    float wob = sin(p.x*(9.0+sd.x*5.0)+sd.y*6.0)*0.16+sin(p.x*23.0+sd.z*6.0)*0.05;',
    '    float y = p.y*6.0+wob-turn*2.0; float f = fract(y);',
    '    float seam = 1.0-smoothstep(0.0,0.07,min(f,1.0-f));',
    '    a = step(0.5,fract(floor(y)*0.5))*(0.55+0.45*f)*1.3+seam*0.3;',
    '    float h = hash(floor(asp*vec2(46.0,13.0))+sd.xy*17.0);',
    '    b = step(0.9,h)*pow(max(sin(t*(1.0+floor(h*3.0))+h*40.0),0.0),8.0)+seam*0.45; foam = seam*0.5;',
    '    extra = vec3(1.0,0.75,0.35)*b*0.3;',
    '  } else if (pat < 5.5) {',  // storm
    '    float cloud = sin(p.x*7.0+t+sd.x*6.0)*0.5+sin(p.x*17.0-t*2.0+sd.y*6.0)*0.3;',
    '    a = clamp((p.y-0.62+cloud*0.1)*3.0,0.0,1.0);',
    '    float u = asp.x+p.y*0.45; float col = floor(u*34.0); float h = hash(vec2(col,sd.z*31.0));',
    '    float fall = fract(p.y*1.4+turn*(3.0+floor(h*3.0))+h);',
    '    float drop = step(0.82,fall)*step(0.45,h)*(1.0-smoothstep(0.0,0.25,abs(fract(u*34.0)-0.5)-0.2));',
    '    float ph = fract(turn*2.0); float flash = clamp(1.0-abs(ph-0.3)*14.0,0.0,1.0)+clamp(1.0-abs(ph-0.36)*22.0,0.0,1.0)*0.7;',
    '    float bx = 0.25+sd.w*0.5+floor(turn*2.0)*0.21+sin(p.y*31.0+sd.x*9.0)*0.012+sin(p.y*13.0+sd.y*7.0)*0.025;',
    '    float bolt = (1.0-smoothstep(0.002,0.008,abs(p.x-fract(bx))))*step(0.15,p.y)*clamp(flash*2.0,0.0,1.0);',
    '    b = drop*0.6+flash*0.35+bolt; foam = bolt; extra = vec3(0.85,0.9,1.0)*(bolt*0.7+flash*0.1);',
    '  } else if (pat < 6.5) {',  // warp
    '    float row = floor(p.y*38.0); float h = hash(vec2(row,sd.x*13.0));',
    '    float x = fract(p.x*0.8+turn*(2.0+floor(h*4.0))+h);',
    '    float streak = clamp(1.0-x/(0.18+h*0.25),0.0,1.0)*step(0.4,h);',
    '    a = streak*clamp((1.0-abs(fract(p.y*38.0)-0.5)*2.0)*1.6,0.0,1.0); b = pow(a,4.0);',
    '    vec2 d = (p-0.5)*vec2(1.6,1.0); foam = clamp(1.0-dot(d,d)*5.0,0.0,1.0)*(0.5+0.5*sin(t*4.0))*0.4;',
    '  } else if (pat < 7.5) {',  // clock
    '    vec2 d = asp-vec2(W*0.5,0.5); float r = length(d); float ang = atan(d.y,d.x)/6.2831853+0.5;',
    '    float sweep = fract(ang+turn); a = pow(sweep,5.0)*clamp(1.0-r*0.6,0.0,1.0);',
    '    float ring = 1.0-smoothstep(0.0,0.012,abs(r-0.4));',
    '    float tick = step(0.985,cos(ang*6.2831853*12.0))*step(0.33,r)*step(r,0.4);',
    '    float hand = step(0.995,sweep)*step(r,0.42);',
    '    b = ring*0.6+tick+hand+crest(r*26.0-t*2.0)*0.25; foam = hand;',
    '  } else if (pat < 8.5) {',  // party
    '    float cx = floor(asp.x*22.0); float h = hash(vec2(cx,0.0)+sd.xy*7.0);',
    '    float y = fract(p.y+turn*(1.0+floor(h*3.0))+h); vec2 cell = vec2(fract(asp.x*22.0),fract(y*8.0));',
    '    float spin = abs(sin(t*(2.0+floor(h*3.0))+h*20.0));',
    '    float conf = step(abs(cell.x-0.5),0.22*spin+0.05)*step(abs(cell.y-0.5),0.18)*step(0.72,hash(vec2(cx,floor(y*8.0))));',
    '    float bc = floor(asp.x*5.0); float hb = hash(vec2(bc,0.0)+sd.zw*11.0); float by = fract(hb-turn*(1.0+floor(hb*2.0)));',
    '    vec2 bp = vec2((bc+0.5+sin(t+hb*9.0)*0.15)/5.0, by*1.4-0.2);',
    '    float balloon = 1.0-smoothstep(0.055,0.07,length((asp-bp)*vec2(1.0,0.85)));',
    '    a = balloon*0.7; b = conf; foam = 0.0;',
    '    extra = rainbow(h+floor(y*8.0)*0.17)*conf*0.5+rainbow(hb)*balloon*0.22;',
    '  } else if (pat < 9.5) {',  // stars
    '    vec2 g = floor(p*vec2(150.0,44.0)); float h = hash(g+sd.xy*23.0);',
    '    float star = step(0.94,h)*(0.5+0.5*sin(t*(1.0+floor(h*4.0))+h*50.0));',
    '    a = crest(asp.x*2.0+sin(p.y*5.0+t)*0.6+sd.z*6.0)*1.1*clamp(1.0-abs(p.y-0.5)*1.4,0.0,1.0);',
    '    float shoot = 0.0;',
    '    for (int i = 0; i < 2; i++) {',
    '      float fi = float(i); float k = fract(turn*2.0+fi*0.5);',
    '      vec2 s0 = vec2(0.4+hash(vec2(fi,sd.w*7.0))*(W-0.8),1.05); vec2 dir = normalize(vec2(-1.0,-0.55));',
    '      vec2 rel = asp-(s0+dir*k*1.6); float along = dot(rel,-dir); float across = abs(rel.x*dir.y-rel.y*dir.x);',
    '      shoot += step(0.0,along)*clamp(1.0-along/0.35,0.0,1.0)*(1.0-smoothstep(0.0,0.008,across))*step(k,0.8);',
    '    }',
    '    b = star+shoot; foam = shoot; extra = vec3(1.0,0.95,0.85)*(star*0.25+shoot*0.6);',
    '  } else if (pat < 10.5) {',  // fog
    '    float m1 = sin(p.x*12.566+t+sin(p.y*7.0+t)*0.8+sd.x*6.0); float m2 = sin(p.x*18.85-t*2.0+sin(p.y*11.0-t)*0.6+sd.y*6.0);',
    '    a = clamp(0.45+m1*0.3+m2*0.2,0.0,1.0)*(0.4+p.y*0.6);',
    '    vec2 d = asp-vec2(W*0.5,-0.1); float ba = atan(d.x,d.y)-sin(t)*0.7;',
    '    b = (1.0-smoothstep(0.05,0.12,abs(ba)))*clamp(1.0-length(d)*0.5,0.0,1.0)*(0.6+a*0.6); foam = 0.0;',
    '  } else if (pat < 11.5) {',  // kaleidoscope
    '    vec2 d = asp-vec2(W*0.5,0.5); float r = length(d); float ang = atan(d.y,d.x)/6.2831853*6.0;',
    '    float w = abs(fract(ang+turn)-0.5);',
    '    a = crest(r*(24.0+sd.x*8.0)-t*2.0+w*9.0); b = crest(w*18.0+r*9.0+t+sd.y*6.0); foam = a*b*0.6;',
    '  } else if (pat < 12.5) {',  // circuit city: stepped traces and travelling signals
    '    vec2 q = asp*vec2(18.0,14.0); vec2 cell = floor(q); vec2 f = fract(q)-0.5;',
    '    float h = hash(cell+sd.xy*19.0); float lane = step(0.48,fract(cell.y*0.37+h*0.4));',
    '    float wire = 1.0-smoothstep(0.02,0.09,abs(f.y+lane*0.28));',
    '    float elbow = (1.0-smoothstep(0.02,0.09,abs(f.x-0.22)))*step(0.68,h);',
    '    a = wire*0.42+elbow*0.35;',
    '    float signal = fract(q.x*0.045-turn*3.0+h*0.3);',
    '    b = wire*pow(1.0-signal,8.0)*step(0.48,h); foam = b*0.7;',
    '  } else if (pat < 13.5) {',  // prism portal: faceted rings opening toward the horizon
    '    vec2 d=(asp-vec2(W*0.5,0.52))*vec2(1.0,1.25);',
    '    float r=max(abs(d.x)*0.866+abs(d.y)*0.5,abs(d.y));',
    '    float ring=fract(r*(8.0+sd.x*3.0)-turn*3.0);',
    '    a=pow(1.0-ring,5.0)*(1.0-smoothstep(0.15,W*0.6,r));',
    '    b=crest(r*19.0-t*2.0+sd.y*5.0)*0.6;',
    '    foam=(1.0-smoothstep(0.0,0.1,r))*0.5;',
    '  } else if (pat < 14.5) {',  // meteor rain: diagonal pixel streaks over a star field
    '    vec2 q=vec2(asp.x+p.y*0.7,p.y); vec2 cell=floor(q*vec2(34.0,25.0));',
    '    float h=hash(vec2(cell.x,sd.x*23.0));',
    '    float fall=fract(q.y*0.85+turn*(2.0+floor(h*3.0))+h);',
    '    float streak=pow(max(1.0-fall,0.0),6.0)*step(0.72,h);',
    '    a=streak*(1.0-smoothstep(0.1,0.48,abs(fract(q.x*34.0)-0.5)));',
    '    float star=hash(cell+sd.zw*17.0); b=step(0.975,star)*(0.5+0.5*sin(t*2.0+star*25.0));',
    '    foam=a*0.55; extra=vec3(0.45,0.7,1.0)*(a*0.25+b*0.15);',
    '  } else {',  // pixel aurora: layered curtains and vertical light columns
    '    float bend=sin(p.x*9.0+t+sd.x*6.0)*0.1+sin(p.x*21.0-t*1.4)*0.035;',
    '    float curtain=p.y-(0.45+bend);',
    '    a=(1.0-smoothstep(0.0,0.38,abs(curtain)))*(0.65+0.35*sin(p.x*31.0+t*2.0));',
    '    float beam=pow(0.5+0.5*sin(p.x*42.0+sin(p.y*7.0+t)*1.3),8.0);',
    '    b=beam*(1.0-smoothstep(0.0,0.8,abs(curtain))); foam=beam*a*0.25;',
    '    extra=vec3(0.12,0.42,0.28)*a*0.4;',
    '  }',
    '  float vert = 1.0-clamp(p.y,0.0,1.0);',
    '  vec3 c = mix(u_deep, u_dusk, vert*(0.6+vert*0.4));',
    '  c += u_dusk*a*0.9 + u_moon*b*(0.22+light*0.37);',
    '  c += u_moon*(foam*0.42+light*light*0.14);',
    '  return c+extra;',
    '}',
    // Drift along the green -> cyan -> blue -> pink -> red arc, reversing before yellow/orange.
    // A saturation floor also prevents beige/olive accents in the source patterns.
    'vec3 sceneTint(vec3 c, float turns){',
    '  c=max(c,0.0); float value=max(max(c.r,c.g),c.b);',
    '  float source=atan(1.73205*(c.g-c.b),2.0*c.r-c.g-c.b+0.00001)/6.2831853;',
    '  float phase=0.5+0.5*sin((source+turns)*6.2831853);',
    '  float hue=mix(0.30+0.70*phase, 0.54+0.34*phase, u_cinematic);',
    '  vec3 spectrum=clamp(abs(fract(hue+vec3(0.0,0.666667,0.333333))*6.0-3.0)-1.0,0.0,1.0);',
    '  return mix(vec3(1.0),spectrum,0.72)*value;',
    '}',
    'void main(){',
    '  vec2 p = gl_FragCoord.xy/u_res;',
    '  vec3 c = stage(p, u_turn, u_pa, u_sa);',
    '  if (u_blend > 0.001) c = mix(c, stage(p, u_turn, u_pb, u_sb), u_blend);',
    // energy: a touch brighter and richer as streaks climb; pulse: a soft wave from the bottom on line clears
    '  float l = dot(c, vec3(0.299,0.587,0.114));',
    '  c = mix(vec3(l), c, 1.0+u_energy*0.35) * (1.0+u_energy*0.28);',
    '  float wave = exp(-abs(p.y-(1.0-u_pulse))*9.0)*u_pulse;',
    '  c += u_moon*wave*0.3;',
    '  vec2 shockPos=(p-vec2(0.5))*vec2(u_res.x/u_res.y,1.0);',
    '  float ring=exp(-abs(length(shockPos)-(1.0-u_impact)*1.35)*24.0)*u_impact;',
    '  c += u_moon*ring*0.85;',
    '  c += u_dusk*u_pressure*(0.12+0.13*sin(p.y*45.0+u_time*4.0));',
    '  c = sceneTint(c, u_hue);',
    '  c = mix(c, c*vec3(1.25,0.55,0.6), u_danger*0.35+u_pressure*0.12);',
    '  vec2 v = p-0.5; c *= 1.0-dot(v,v)*0.7;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  var VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a,0.0,1.0); }';

  function hsv(h, s, v) {
    var f = function (n) { var k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5), f(3), f(1)];
  }

  function rng(seed) {
    var x = seed >>> 0 || 1;
    return function () { x = (x * 48271) % 2147483647; return x / 2147483647; };
  }

  var S = {
    canvas: null, gl: null, prog: null, u: {}, host: null,
    pattern: 0, from: 0, seedA: [0.2, 0.4, 0.6, 0.8], seedB: [0.2, 0.4, 0.6, 0.8], blend: 0, fading: false, fadeT: 0,
    deep: [0, 0, 0], dusk: [0, 0, 0], moon: [0, 0, 0], palFrom: null, palTo: null,
    hue: Math.random(), hueOffset: 0, themes: 0, energy: 0, energyTarget: 0, pulse: 0, impact: 0, pressure: 0, pressureTarget: 0, danger: 0,
    running: false, visible: true, onscreen: true, last: 0, reduced: false, cinematic: false, raf: 0, dirty: true
  };

  function palette(h, sat) {
    return { deep: hsv(h, 0.65, 0.03), dusk: hsv(h, sat, 0.34), moon: hsv((h + 0.87) % 1, 0.44, 0.84) };
  }

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[tetris-bg]', gl.getShaderInfoLog(s)); return null; }
    return s;
  }

  function mount(host) {
    S.host = host;
    var cv = document.createElement('canvas');
    cv.className = 'tetris-bg';
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
    ['u_res', 'u_time', 'u_turn', 'u_pa', 'u_pb', 'u_blend', 'u_sa', 'u_sb', 'u_deep', 'u_dusk', 'u_moon', 'u_hue',
      'u_energy', 'u_pulse', 'u_impact', 'u_pressure', 'u_danger', 'u_cinematic'].forEach(function (n) { S.u[n] = gl.getUniformLocation(prog, n); });
    S.gl = gl; S.prog = prog;
    var p = palette(S.hue, 0.7);
    S.deep = p.deep; S.dusk = p.dusk; S.moon = p.moon;
    S.pattern = everydayPattern(); S.from = S.pattern;
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    document.addEventListener('visibilitychange', function () { S.visible = !document.hidden; kick(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { S.onscreen = es[0].isIntersecting; kick(); }).observe(host);
    }
    kick();
  }

  // Tiny internal resolution (150 px across, square pixels): the page scales it up pixelated, like the VRChat stage.
  function resize() {
    if (!S.canvas) return;
    // Square pixels at any window shape: 150 across, as many rows as the aspect needs (an ultrawide 21:9
    // window gets ~64 rows, a phone in portrait ~320), clamped so nothing degenerates.
    var r = S.canvas.getBoundingClientRect();
    var cw = r.width || window.innerWidth || 1000, ch = r.height || window.innerHeight || 600;
    var w = Math.max(30, Math.round(150 / (window.ChatScenePixel || 1)));
    var h = Math.max(24, Math.min(400, Math.round(w * ch / Math.max(1, cw))));
    if (S.canvas.width !== w || S.canvas.height !== h) { S.canvas.width = w; S.canvas.height = h; S.dirty = true; }
    kick();
  }

  function kick() {
    if (!S.gl || S.running) return;
    if (!S.visible || !S.onscreen) return;
    S.running = true;
    S.last = 0;
    S.raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    S.running = false;
    if (!S.gl || !S.visible || !S.onscreen) return;
    if (now - S.last < 33) { S.running = true; S.raf = requestAnimationFrame(frame); return; } // ~30 fps
    var dt = S.last ? Math.min(0.1, (now - S.last) / 1000) : 0.033;
    S.last = now;
    // Ease continuous signals; let one-shot events fade at a fixed rate.
    S.energy += (S.energyTarget - S.energy) * Math.min(1, dt * 1.5);
    S.pressure += (S.pressureTarget - S.pressure) * Math.min(1, dt * 2.5);
    S.pulse = Math.max(0, S.pulse - dt * 1.4);
    S.impact = Math.max(0, S.impact - dt * 1.25);
    if (S.fading) {
      S.fadeT += dt / 1.4;
      var k = Math.min(1, S.fadeT), e = k * k * (3 - 2 * k);
      S.blend = e;
      for (var i = 0; i < 3; i++) {
        S.deep[i] = S.palFrom.deep[i] + (S.palTo.deep[i] - S.palFrom.deep[i]) * e;
        S.dusk[i] = S.palFrom.dusk[i] + (S.palTo.dusk[i] - S.palFrom.dusk[i]) * e;
        S.moon[i] = S.palFrom.moon[i] + (S.palTo.moon[i] - S.palFrom.moon[i]) * e;
      }
      if (k >= 1) { S.fading = false; S.blend = 0; S.from = S.pattern; S.seedA = S.seedB; }
    }
    draw(now / 1000);
    if (!S.reduced || S.fading || S.pulse > 0 || S.impact > 0 || Math.abs(S.energy - S.energyTarget) > 0.01 || Math.abs(S.pressure - S.pressureTarget) > 0.01) { S.running = true; S.raf = requestAnimationFrame(frame); }
  }

  function draw(t) {
    var gl = S.gl, u = S.u;
    gl.viewport(0, 0, S.canvas.width, S.canvas.height);
    var speed = 0.06 * (1 + S.energy * 0.9 + S.pressure * 0.6);
    S.turnAcc = (S.turnAcc || 0) + (S.lastT ? (t - S.lastT) * speed : 0);
    S.lastT = t;
    var turn = S.reduced ? 0.3 : S.turnAcc % 1;
    gl.uniform2f(u.u_res, S.canvas.width, S.canvas.height);
    gl.uniform1f(u.u_time, t);
    gl.uniform1f(u.u_turn, turn);
    gl.uniform1f(u.u_pa, S.fading ? S.from : S.pattern);
    gl.uniform1f(u.u_pb, S.pattern);
    gl.uniform1f(u.u_blend, S.blend);
    gl.uniform4fv(u.u_sa, S.seedA);
    gl.uniform4fv(u.u_sb, S.seedB);
    gl.uniform3fv(u.u_deep, S.deep);
    gl.uniform3fv(u.u_dusk, S.dusk);
    gl.uniform3fv(u.u_moon, S.moon);
    gl.uniform1f(u.u_hue, S.reduced ? 0 : (t * 0.008) % 1); // cycle the allowed colour arc without crossing yellow
    gl.uniform1f(u.u_energy, S.energy);
    gl.uniform1f(u.u_pulse, S.pulse);
    gl.uniform1f(u.u_impact, S.impact);
    gl.uniform1f(u.u_pressure, S.pressure);
    gl.uniform1f(u.u_danger, S.danger);
    gl.uniform1f(u.u_cinematic, S.cinematic ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function transition(pattern, seed4, hue, sat) {
    if (!S.gl) return;
    S.palFrom = { deep: S.deep.slice(), dusk: S.dusk.slice(), moon: S.moon.slice() };
    S.palTo = palette(hue, sat);
    S.from = S.fading ? S.pattern : S.pattern;
    S.seedA = S.seedB;
    S.seedB = seed4;
    S.pattern = pattern;
    S.hue = hue;
    S.fading = true;
    S.fadeT = 0;
    kick();
  }

  function bits(mask) { var out = []; for (var i = 0; i < THEMES; i++) if (mask & (1 << i)) out.push(i); return out; }

  function everydayPattern() {
    var n = Math.floor(Math.random() * (BASE + EXTRAS));
    return n < BASE ? n : n + THEMES;
  }

  function pickPattern() {
    var themes = bits(S.themes);
    if (themes.length && Math.random() < 0.6) {
      var t = BASE + themes[Math.floor(Math.random() * themes.length)];
      if (t !== S.pattern || themes.length === 1) return t;
    }
    var n = everydayPattern();
    return n === S.pattern ? (n + 1) % BASE : n;
  }

  var API = {
    TH: TH,
    COUNT: COUNT,
    mount: mount,
    // Themes for what's being played; a newly added theme shows at once.
    setThemes: function (mask, defer) {
      var added = mask & ~S.themes;
      S.themes = mask;
      if (!added || defer) return;
      var b = bits(added), p = BASE + b[Math.floor(Math.random() * b.length)];
      transition(p, [Math.random(), Math.random(), Math.random(), Math.random()], THEME_HUE[p - BASE] + (Math.random() - 0.5) * 0.06, 0.7);
    },
    // A Tetris or level up: a new look, themed patterns favoured while their theme is on.
    milestone: function () {
      if (S.fading) return null;
      var p = pickPattern(), seed = 1 + Math.floor(Math.random() * 999999);
      var themed = p >= BASE && p < BASE + THEMES;
      API.show(p, seed, themed);
      return { p: p, s: seed, th: themed };
    },
    // Shuffle: the next of every pattern in turn, on a random hue. Returns what to send other players.
    shuffle: function () {
      var next = (S.pattern + 1) % COUNT, seed = 1 + Math.floor(Math.random() * 999999);
      API.show(next, seed);
      return { p: next, s: seed };
    },
    // Deterministic from (pattern, seed), so every player in a lobby sees the same thing.
    show: function (pattern, seed, themed) {
      pattern = Math.max(0, Math.min(COUNT - 1, pattern | 0));
      var r = rng(seed);
      var a = r(), b = r(), c = r(), d = r();
      var hue = themed && pattern >= BASE && pattern < BASE + THEMES ? (THEME_HUE[pattern - BASE] + (a - 0.5) * 0.06 + 1) % 1 : a;
      transition(pattern, [b, c, d, a], hue, 0.62 + 0.16 * b);
    },
    setEnergy: function (x) { S.energyTarget = Math.max(0, Math.min(1, x)); kick(); },
    setPressure: function (x) { S.pressureTarget = Math.max(0, Math.min(1, x)); kick(); },
    pulse: function (strength) { S.pulse = Math.min(1, Math.max(S.pulse, strength)); kick(); },
    impact: function (strength) { if (!S.reduced) { S.impact = Math.min(1, Math.max(S.impact, strength)); kick(); } },
    setDanger: function (x) { S.danger = Math.max(0, Math.min(1, x)); kick(); },
    setCinematicPalette: function (on) { S.cinematic = !!on; kick(); },
    snapshot: function () {
      return { pattern: S.pattern, from: S.from, seedA: S.seedA.slice(), seedB: S.seedB.slice(),
        blend: S.blend, fading: S.fading, fadeT: S.fadeT, hue: S.hue,
        deep: S.deep.slice(), dusk: S.dusk.slice(), moon: S.moon.slice(),
        palFrom: S.palFrom, palTo: S.palTo };
    },
    restore: function (scene) {
      if (!scene) return;
      ['pattern', 'from', 'seedA', 'seedB', 'blend', 'fading', 'fadeT', 'hue', 'deep', 'dusk', 'moon', 'palFrom', 'palTo'].forEach(function (key) { S[key] = scene[key]; });
      kick();
    },
    // Match the highlight on screen, including palette fades and the shader's slow hue drift.
    sceneColor: function () {
      if (!S.gl) return null;
      var c = S.moon, value = Math.max(c[0], c[1], c[2]);
      var turns = S.reduced ? 0 : (performance.now() / 1000 * 0.008) % 1;
      var source = Math.atan2(1.73205 * (c[1] - c[2]), 2 * c[0] - c[1] - c[2] + 0.00001) / (Math.PI * 2);
      var hue = 0.30 + 0.70 * (0.5 + 0.5 * Math.sin((source + turns) * Math.PI * 2));
      return hsv(hue % 1, 0.72, value);
    }
  };
  window.TetrisBG = API;
})();
