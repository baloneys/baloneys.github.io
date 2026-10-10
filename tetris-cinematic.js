// tetris-cinematic.js: the Tetris intro cinematic (about 45 seconds), rendered live in the page.
//
// Twelve shots, cut to the music: LED rain, title card, lightning, a fly-through of a corridor of live boards, a pan
// down onto a running game, an Elimination match, the streak tiers, the skulls, the achievements, a falling piece
// followed down the well, a Tetris that flashes the rows, and the title again.
//
// How it is built:
//   - Boards are the real game: tetris.js lends its Player rules, board renderer and CPU through
//     TetrisApp.cinematicKit(), and the CPUs genuinely play every board on screen. Nothing touches the running game.
//   - 3D is CSS perspective: each board is a canvas on a plane in a world div, and a camera rig (x, y, z, yaw, pitch,
//     roll, fov) moves the world. Hero boards get stacked depth layers so they read as slabs, plus a moving gloss,
//     distance fog and a neon rim. That is the cinematic-only look; the game's own boards are unchanged.
//   - Backgrounds are one WebGL shader (twelve looks, one per shot) that follows the camera for parallax and reacts
//     to the music (an analyser on the audio, plus the beat grid).
//   - Lightning, sparks and letterbox are a 2D canvas over the top; the title is DOM text.
//
// Music and timing: everything hangs off CUES below. Shots start on beats of a grid (bpm + offset); a shot can
// instead pin an exact time with `at` (seconds). With CUES.track set, that file plays and drives the clock;
// without it a small synthesised placeholder plays on the same grid. To retime for a new track, set bpm, offset
// (seconds into the file where beat 0 falls), start (seconds into the file where the cinematic begins) and,
// if needed, move shot beats.
//
// Playback: once per browser (localStorage games_tetris_cinematic_seen), then only from the menu's
// "Watch cinematic" button. Skip button, Esc or Enter skip it. Testing aid: ?cinematic=N plays from beat N.
//
// API (window.TetrisCinematic): play(fromBeat), skip(), playing(), CUES
(function () {
  'use strict';

  var G = window.Games;
  var App = window.TetrisApp;
  if (!G || !App || !App.cinematicKit) return;
  var K = App.cinematicKit();
  var ACH = window.TetrisAchievements;
  var STORE_SEEN = 'tetris_cinematic_seen';
  var D2R = Math.PI / 180;

  /* =================================================================
     Cue sheet
     ================================================================= */

  var CUES = {
    bpm: 128,
    offset: 0,      // seconds into the audio where beat 0 falls
    start: 0,       // seconds into the audio where the cinematic begins (beat grid is relative to the file)
    track: null,    // e.g. 'tetris-cinematic.mp3'; null plays the synthesised placeholder
    volume: 0.8,
    end: 95,        // beat the cinematic ends on (95 beats at 128 bpm = 44.5 s)
    shots: [
      { id: 'rain', beat: 0 },
      { id: 'title', beat: 8 },
      { id: 'storm', beat: 16 },
      { id: 'corridor', beat: 24 },
      { id: 'pandown', beat: 36 },
      { id: 'elim', beat: 44 },
      { id: 'streak', beat: 52 },
      { id: 'skulls', beat: 64 },
      { id: 'achievements', beat: 72 },
      { id: 'follow', beat: 80 },
      { id: 'clear', beat: 86 },
      { id: 'finale', beat: 90 }
    ]
  };

  function spb() { return 60 / CUES.bpm; }
  function timeOfBeat(b) { return CUES.offset + b * spb() - CUES.start; }   // cinematic time (0 = first frame)
  function beatAt(t) { return (t + CUES.start - CUES.offset) / spb(); }
  function shotStart(s) { return s.at != null ? s.at - CUES.start : timeOfBeat(s.beat); }
  function endTime() { return CUES.endAt != null ? CUES.endAt - CUES.start : timeOfBeat(CUES.end); }

  /* =================================================================
     Small helpers
     ================================================================= */

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function easeOut(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function backOut(t) { t = clamp01(t); var c = 1.9, k = t - 1; return 1 + (c + 1) * k * k * k + c * k * k; }
  function span(t, a, b) { return clamp01((t - a) / (b - a)); }
  function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* =================================================================
     Background shader: one look per shot, music reactive, camera parallax
     ================================================================= */

  var FRAG = [
    'precision mediump float;',
    'uniform vec2 u_res; uniform float u_time; uniform float u_pat; uniform float u_level; uniform float u_beat;',
    'uniform float u_bt; uniform float u_flash; uniform float u_energy; uniform float u_shock; uniform vec4 u_cam;',
    'float h1(float n){ return fract(sin(n)*43758.5453); }',
    'float h2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
    'float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);',
    '  return mix(mix(h2(i),h2(i+vec2(1.0,0.0)),f.x), mix(h2(i+vec2(0.0,1.0)),h2(i+vec2(1.0)),f.x), f.y); }',
    'float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*vn(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }',
    // the site's neon loop: violet -> electric blue -> hot pink
    'vec3 neon(float t){ t=fract(t); vec3 a=vec3(0.62,0.05,1.0), b=vec3(0.1,0.55,1.0), c=vec3(1.0,0.15,0.6);',
    '  if (t<0.3333) return mix(a,b,t*3.0); if (t<0.6667) return mix(b,c,(t-0.3333)*3.0); return mix(c,a,(t-0.6667)*3.0); }',
    'float line(float x, float w){ return smoothstep(w, 0.0, abs(fract(x)-0.5)-(0.5-w)); }',
    'vec3 rays(vec2 p, float n, float spin, float hue){',
    '  float a=atan(p.y,p.x), r=length(p);',
    '  float r1=smoothstep(-0.1,0.25,sin(a*n+u_time*spin)), r2=smoothstep(0.0,0.3,sin(a*(n*0.5+1.0)-u_time*spin*1.6+r*2.0));',
    '  float reach=0.55+0.35*u_beat+0.4*u_level;',
    '  vec3 c=vec3(0.03,0.0,0.07)+neon(hue+r*0.25+u_time*0.02)*(r1*0.55+r2*0.3)*smoothstep(reach+0.9,0.0,r);',
    '  c+=vec3(1.0,0.85,1.0)*exp(-r*3.5)*(0.5+0.9*u_beat);',
    '  return c; }',
    'void main(){',
    '  vec2 p=(gl_FragCoord.xy-0.5*u_res)/u_res.y;',
    '  float yaw=u_cam.x*0.0174533, pitch=u_cam.y*0.0174533, trav=u_cam.z;',
    '  vec3 c=vec3(0.0); float pat=u_pat;',
    '  if (pat<0.5) {',  // LED rain: a grid of LEDs, columns raining in shuffled colours
    '    vec2 g=(p+vec2(yaw,-pitch)*0.6)*46.0; vec2 cell=floor(g); vec2 f=fract(g)-0.5;',
    '    float dotm=smoothstep(0.44,0.26,length(f));',
    '    float lit=0.0, head=0.0;',
    '    for (int k=0;k<2;k++){',
    '      float ch=h1(cell.x*13.1+float(k)*71.3); float sp=7.0+ch*16.0;',
    '      float yh=mod(-u_time*sp+ch*400.0, 90.0)-40.0; float d=cell.y-yh;',
    '      lit+=d>=0.0 ? exp(-d*0.16) : 0.0; head+=(d>=0.0&&d<1.0)?1.0:0.0;',
    '    }',
    '    float shuffle=floor(u_bt*0.5); float hue=h1(cell.x*7.3+shuffle*3.1);',
    '    float spark=step(0.992,h2(cell+floor(u_time*9.0)));',
    '    c=vec3(0.025,0.02,0.05)*dotm;',
    '    c+=neon(hue)*min(lit,1.4)*dotm*(0.75+u_level*0.9);',
    '    c+=vec3(1.0)*clamp(head,0.0,1.0)*dotm*0.75+neon(hue+0.5)*spark*dotm;',
    '  } else if (pat<1.5) {',  // title burst rays
    '    c=rays(p+vec2(yaw,-pitch)*0.3, 14.0, 0.5, 0.05);',
    '  } else if (pat<2.5) {',  // storm clouds lit by lightning, rain
    '    vec2 q=p+vec2(yaw,-pitch)*0.4;',
    '    float cl=fbm(q*vec2(1.6,3.0)+vec2(u_time*0.07,0.0)); cl=cl*cl;',
    '    c=vec3(0.02,0.02,0.06)+vec3(0.1,0.08,0.22)*cl*(0.6+u_level*0.6);',
    '    c+=vec3(0.55,0.62,1.0)*u_flash*(0.25+cl*1.6);',
    '    vec2 rq=vec2(q.x*70.0+q.y*12.0, q.y*3.0+u_time*7.0); float ln=h2(vec2(floor(rq.x),3.0));',
    '    float fr=fract(rq.y+ln*7.0); c+=vec3(0.35,0.4,0.6)*step(0.55,ln)*smoothstep(0.0,0.05,fr)*smoothstep(0.25,0.05,fr)*0.3;',
    '  } else if (pat<3.5) {',  // neon tunnel for the corridor fly-through
    '    vec2 q=p-vec2(-yaw*0.9, pitch*0.9);',
    '    float r=max(abs(q.x)*0.78, abs(q.y)); float side=step(abs(q.y), abs(q.x)*0.78);',
    '    float along=mix(q.x, q.y, side)/max(r,0.001);',
    '    float z=0.32/max(r,0.015)+trav;',
    '    float rings=line(z, 0.06), seams=line(along*4.0, 0.05);',
    '    c=vec3(0.015,0.0,0.04)+neon(z*0.04+u_time*0.03)*(rings*0.9+seams*0.45)*smoothstep(0.02,0.5,r)*(0.55+u_level*0.9+u_beat*0.4);',
    '    c+=neon(0.35)*exp(-r*7.0)*0.6;',
    '  } else if (pat<4.5) {',  // synthwave: perspective floor grid, striped sun; horizon follows the camera pitch
    '    float hz=0.04-pitch*1.05;',
    '    if (p.y<hz){ float d=hz-p.y; float z=0.22/d; vec2 g=vec2((p.x+yaw*0.7)*z, z+u_time*1.6+trav);',
    '      float gl=max(line(g.x,0.05), line(g.y,0.05));',
    '      c=vec3(0.03,0.0,0.06)+neon(0.6)*gl*smoothstep(0.0,0.1,d)*(0.5+u_level+u_beat*0.5)+neon(0.85)*exp(-d*14.0)*0.6;',
    '    } else { float h=p.y-hz; c=mix(vec3(0.25,0.02,0.3), vec3(0.01,0.0,0.05), smoothstep(0.0,0.7,h));',
    '      vec2 s=p-vec2(-yaw*0.5, hz+0.22); float sr=length(s);',
    '      float bands=step(0.5, fract((s.y+0.3)*14.0+u_time*0.4))+step(0.02,s.y);',
    '      c+=mix(vec3(1.0,0.2,0.6), vec3(0.6,0.3,1.0), smoothstep(-0.2,0.2,s.y))*smoothstep(0.21,0.2,sr)*clamp(bands,0.0,1.0)*(0.9+u_beat*0.3);',
    '      c+=vec3(1.0,0.3,0.7)*exp(-sr*5.0)*0.25;',
    '      c+=vec3(1.0)*step(0.996,h2(floor(p*180.0)))*smoothstep(0.1,0.4,h); }',
    '  } else if (pat<5.5) {',  // elimination: red grid, scanner and warning bands
    '    vec2 q=p+vec2(yaw,-pitch)*0.5;',
    '    float g=max(line(q.x*7.0,0.03), line(q.y*7.0,0.03));',
    '    c=vec3(0.07,0.0,0.02)+vec3(0.6,0.02,0.12)*g*(0.25+0.75*u_beat);',
    '    float sweep=fract(u_time*0.45); c+=vec3(1.0,0.1,0.25)*exp(-abs(q.x-(sweep*3.0-1.5))*9.0)*0.35;',
    '    float band=step(0.4,abs(p.y)); float st=step(0.5,fract((q.x+p.y)*6.0-u_time*0.8));',
    '    c=mix(c, vec3(0.85,0.03,0.18)*st+vec3(0.06,0.0,0.01), band*0.8);',
    '    c+=vec3(1.0,0.08,0.2)*dot(p,p)*0.45*(0.4+0.6*u_level);',
    '  } else if (pat<6.5) {',  // streaks: plasma that heats up with the tier
    '    vec2 q=(p+vec2(yaw,-pitch)*0.4)*(1.0+u_energy*0.6); float t=u_time*(0.5+u_energy);',
    '    float v=sin(q.x*4.0+t)+sin(q.y*5.0-t*1.3)+sin((q.x+q.y)*3.0+t*0.7)+sin(length(q)*9.0-t*2.0);',
    '    c=neon(v*0.12+u_time*0.05)*(0.18+0.5*u_energy+0.35*u_level);',
    '    c+=vec3(1.0,0.5,0.9)*pow(max(0.0,sin(v*3.0)),12.0)*u_energy*0.6;',
    '  } else if (pat<7.5) {',  // skulls: drifting violet smoke
    '    vec2 q=p+vec2(yaw,-pitch)*0.5;',
    '    float s=fbm(q*2.0+vec2(u_time*0.1,-u_time*0.05)+fbm(q*3.0-u_time*0.05));',
    '    c=vec3(0.03,0.0,0.06)+vec3(0.4,0.1,0.65)*s*s*(0.8+u_level*0.8)+vec3(0.1,0.6,0.4)*pow(s,6.0)*0.6;',
    '  } else if (pat<8.5) {',  // achievements: bokeh and sparkles
    '    c=mix(vec3(0.01,0.0,0.06), vec3(0.08,0.0,0.14), p.y+0.5);',
    '    for (int i=0;i<3;i++){ float fi=float(i);',
    '      vec2 g=(p+vec2(yaw*(0.25+fi*0.2),-pitch*0.3))*(2.5+fi*2.0)+vec2(0.0,-u_time*0.08*(fi+1.0));',
    '      vec2 cell=floor(g); vec2 f=fract(g)-0.5; float h=h2(cell+fi*7.0);',
    '      vec2 o=vec2(h2(cell+3.1),h2(cell+5.7))-0.5; float d=length(f-o*0.5);',
    '      c+=neon(h+u_time*0.02)*smoothstep(0.22,0.14,d)*step(0.45,h)*(0.18+u_level*0.25); }',
    '    c+=vec3(1.0)*step(0.995,h2(floor(p*160.0)+floor(u_time*6.0)))*0.9;',
    '  } else if (pat<9.5) {',  // falling: speed lines streaming upward past the camera
    '    float cx=floor((p.x+yaw)*60.0); float ch=h2(vec2(cx,1.0));',
    '    float y=fract(p.y*(0.25+ch*0.4)-u_time*(0.6+ch*1.4)*(1.0+u_level)-trav*0.05+ch);',
    '    c=vec3(0.02,0.0,0.05)+mix(vec3(0.02,0.0,0.06),vec3(0.07,0.0,0.12),0.5-p.y);',
    '    c+=neon(ch*0.6+0.2)*step(0.55,ch)*smoothstep(0.0,0.7,y)*step(y,0.97)*0.55;',
    '  } else if (pat<10.5) {',  // line clear: shockwave rings
    '    float r=length(p+vec2(yaw,-pitch)*0.4);',
    '    float k=u_shock; float ring=exp(-abs(r-k*1.6)*18.0)*(1.0-k*0.5);',
    '    float ring2=exp(-abs(r-k*1.1)*26.0)*(1.0-k*0.6);',
    '    c=vec3(0.03,0.0,0.07)+neon(0.15+r*0.3)*(sin(r*24.0-u_time*8.0)*0.5+0.5)*0.12*(1.0+u_level);',
    '    c+=vec3(1.0,0.9,1.0)*ring*1.4+neon(0.4)*ring2;',
    '  } else {',  // finale: wider rays in the other colours, with stars
    '    c=rays(p+vec2(yaw,-pitch)*0.3, 22.0, -0.35, 0.45);',
    '    c+=vec3(1.0)*step(0.996,h2(floor(p*170.0)))*0.8;',
    '  }',
    '  c+=vec3(1.0)*u_flash*0.35;',
    '  c*=1.0+u_beat*0.12;',
    '  vec2 v=gl_FragCoord.xy/u_res-0.5; c*=1.0-dot(v,v)*0.9;',
    '  c+=(h2(gl_FragCoord.xy+fract(u_time)*100.0)-0.5)*0.035;',
    '  gl_FragColor=vec4(c,1.0);',
    '}'
  ].join('\n');

  var Bg = {
    gl: null, u: {}, canvas: null,
    mount: function (canvas) {
      this.canvas = canvas;
      var gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false });
      if (!gl) return;
      function sh(type, src) {
        var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[tetris-cinematic]', gl.getShaderInfoLog(s)); return null; }
        return s;
      }
      var vs = sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a,0.0,1.0); }'), fs = sh(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return;
      var prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, 'a');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      var self = this;
      ['u_res', 'u_time', 'u_pat', 'u_level', 'u_beat', 'u_bt', 'u_flash', 'u_energy', 'u_shock', 'u_cam'].forEach(function (n) { self.u[n] = gl.getUniformLocation(prog, n); });
      this.gl = gl;
    },
    // Half the screen's CSS resolution (at most 960 across): soft enough to be cheap, sharp enough for the LEDs.
    draw: function (s) {
      var gl = this.gl, u = this.u, cv = this.canvas;
      if (!gl) return;
      var w = Math.min(960, Math.round(cv.clientWidth * 0.5)) || 640, h = Math.round(w * (cv.clientHeight || 360) / (cv.clientWidth || 640));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(u.u_res, w, h);
      gl.uniform1f(u.u_time, s.time);
      gl.uniform1f(u.u_pat, s.pat);
      gl.uniform1f(u.u_level, s.level);
      gl.uniform1f(u.u_beat, s.beat);
      gl.uniform1f(u.u_bt, s.bt);
      gl.uniform1f(u.u_flash, s.flash);
      gl.uniform1f(u.u_energy, s.energy);
      gl.uniform1f(u.u_shock, s.shock);
      gl.uniform4f(u.u_cam, s.cam.yaw, s.cam.pitch, s.travel, s.cam.roll);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  };

  /* =================================================================
     Audio: the track (CUES.track) or a synthesised placeholder on the same beat grid, through an analyser
     ================================================================= */

  var Audio = {
    ctx: null, master: null, analyser: null, bins: null, noise: null, el: null, src: null,
    on: false, next: 0, events: null, level: 0,

    init: function () {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (e) { return; }
      var ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = CUES.volume;
      var comp = ctx.createDynamicsCompressor();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.5;
      this.bins = new Uint8Array(this.analyser.frequencyBinCount);
      this.master.connect(comp); comp.connect(this.analyser); this.analyser.connect(ctx.destination);
      var len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      if (CUES.track) {
        this.el = new window.Audio(CUES.track);
        this.el.preload = 'auto';
        this.src = ctx.createMediaElementSource(this.el);
        this.src.connect(this.master);
      } else {
        this.events = placeholderScore();
      }
    },

    // Start (or restart after a seek / unmute) at cinematic time t.
    start: function (t) {
      if (!this.ctx) return false;
      var self = this;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.on = true;
      if (this.el) {
        try { this.el.currentTime = Math.max(0, CUES.start + t); } catch (e) { /* not loaded yet: the clock seeks it later */ }
        var pr = this.el.play();
        if (pr && pr.catch) pr.catch(function () { self.on = false; Cine.needSound(); });
      } else {
        this.next = 0;
        while (this.next < this.events.length && timeOfBeat(this.events[this.next].b) < t - 0.02) this.next++;
      }
      return this.ctx.state === 'running';
    },

    stop: function () {
      this.on = false;
      if (this.el) this.el.pause();
      if (this.master && this.ctx) {
        var g = this.master.gain, now = this.ctx.currentTime;
        g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + 0.25);
      }
    },

    close: function () {
      var ctx = this.ctx;
      this.stop();
      this.ctx = null;
      if (ctx) setTimeout(function () { try { ctx.close(); } catch (e) { /* already closed */ } }, 400);
    },

    // The track's position is the clock while it plays (so pictures stay locked to it).
    clock: function () {
      if (this.el && this.on && !this.el.paused && this.el.currentTime > 0) return this.el.currentTime - CUES.start;
      return null;
    },

    // Schedule placeholder notes due in the next 150 ms (cinematic time t maps onto the audio clock).
    pump: function (t) {
      if (!this.on || !this.events || !this.ctx || this.ctx.state !== 'running') return;
      while (this.next < this.events.length) {
        var e = this.events[this.next], et = timeOfBeat(e.b);
        if (et > t + 0.15) break;
        this.next++;
        if (et < t - 0.05) continue;
        try { e.f(this, this.ctx.currentTime + Math.max(0, et - t), e); } catch (err) { /* a dropped note never stops the film */ }
      }
    },

    // 0..1 loudness of the low end, for the visuals.
    measure: function () {
      if (!this.analyser || !this.on) return null;
      this.analyser.getByteFrequencyData(this.bins);
      var s = 0;
      for (var i = 1; i < 12; i++) s += this.bins[i];
      return s / (11 * 255);
    },

    // ---- placeholder voices ----
    out: function (node, t, vol, a, d) {
      var g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + (a || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t + (a || 0.004) + d);
      node.connect(g); g.connect(this.master);
      return g;
    },
    osc: function (type, f, t, dur) { var o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + dur + 0.1); return o; },
    noiseSrc: function (t, dur) { var s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(t, Math.random()); s.stop(t + dur + 0.1); return s; },
    filter: function (node, type, f, q) { var b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; node.connect(b); return b; },
    kick: function (t, v) { var o = this.osc('sine', 150, t, 0.4); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); this.out(o, t, 0.9 * v, 0.002, 0.38); },
    snare: function (t, v) {
      this.out(this.filter(this.noiseSrc(t, 0.2), 'highpass', 1400), t, 0.35 * v, 0.002, 0.18);
      this.out(this.osc('triangle', 190, t, 0.12), t, 0.25 * v, 0.002, 0.1);
    },
    hat: function (t, v, open) { this.out(this.filter(this.noiseSrc(t, open ? 0.25 : 0.05), 'highpass', 7500), t, 0.12 * v, 0.001, open ? 0.22 : 0.035); },
    bass: function (t, m, dur, v) {
      var o = this.osc('sawtooth', midi(m), t, dur), f = this.filter(o, 'lowpass', 280, 6);
      f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(220, t + dur);
      this.out(f, t, 0.32 * v, 0.004, dur);
    },
    pad: function (t, notes, dur, v) {
      var self = this;
      notes.forEach(function (m) {
        [-7, 7].forEach(function (cents) {
          var o = self.osc('sawtooth', midi(m), t, dur); o.detune.value = cents;
          self.out(self.filter(o, 'lowpass', 1100), t, 0.05 * v, dur * 0.35, dur * 0.65);
        });
      });
    },
    pluck: function (t, m, v) { this.out(this.filter(this.osc('square', midi(m), t, 0.3), 'lowpass', 2600), t, 0.07 * v, 0.002, 0.25); },
    chime: function (t, m, v) { this.out(this.osc('sine', midi(m), t, 1.2), t, 0.16 * v, 0.003, 1.1); this.out(this.osc('sine', midi(m + 19), t, 0.6), t, 0.05 * v, 0.003, 0.5); },
    impact: function (t, v) {
      this.kick(t, 1.2 * v);
      var o = this.osc('sine', 55, t, 1.6); o.frequency.exponentialRampToValueAtTime(30, t + 1.5); this.out(o, t, 0.6 * v, 0.003, 1.5);
      var n = this.filter(this.noiseSrc(t, 1.4), 'lowpass', 6000); n.frequency.exponentialRampToValueAtTime(300, t + 1.2); this.out(n, t, 0.35 * v, 0.002, 1.3);
    },
    riser: function (t, dur, v) {
      var n = this.filter(this.noiseSrc(t, dur), 'bandpass', 400, 4); n.frequency.exponentialRampToValueAtTime(7000, t + dur);
      var g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3 * v, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
      n.connect(g); g.connect(this.master);
    },
    thunder: function (t, v) {
      this.out(this.filter(this.noiseSrc(t, 0.3), 'highpass', 2500), t, 0.3 * v, 0.001, 0.12);
      var n = this.filter(this.noiseSrc(t, 2.2), 'lowpass', 380); this.out(n, t + 0.05, 0.75 * v, 0.06, 2.0);
    }
  };

  function midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // The placeholder: A minor, drums that follow the shots (quiet rain, title hit, thunder, a drop for the fly-through,
  // a build through the streak tiers, a lighter groove for skulls and achievements, a riser into the Tetris, the end hit).
  function placeholderScore() {
    var ev = [], b, i;
    function at(beat, f, x) { ev.push({ b: beat, f: f, x: x }); }
    function kick(beat, v) { at(beat, function (a, t) { a.kick(t, v || 1); }); }
    function snare(beat, v) { at(beat, function (a, t) { a.snare(t, v || 1); }); }
    function hat(beat, v, open) { at(beat, function (a, t) { a.hat(t, v || 1, open); }); }
    function bass(beat, m, d, v) { at(beat, function (a, t) { a.bass(t, m, d * spb(), v || 1); }); }
    function pad(beat, notes, d, v) { at(beat, function (a, t) { a.pad(t, notes, d * spb(), v || 1); }); }
    function impact(beat, v) { at(beat, function (a, t) { a.impact(t, v || 1); }); }
    function riser(beat, d, v) { at(beat, function (a, t) { a.riser(t, d * spb(), v || 1); }); }
    var PENTA = [69, 72, 74, 76, 79, 81, 84];
    var ROOTS = [45, 41, 48, 43];   // A F C G
    var CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];

    // rain (0-8): pad and shuffling plucks
    pad(0, CHORDS[0], 8, 1);
    for (b = 0; b < 8; b += 0.5) { (function (bb) { at(bb, function (a, t) { a.pluck(t, PENTA[Math.floor(Math.random() * PENTA.length)], 0.8); }); })(b); }
    for (b = 4; b < 8; b += 0.25) hat(b, 0.35);
    riser(5, 3, 0.8);
    // title (8-16)
    impact(8, 1);
    pad(8, CHORDS[1], 6, 1.2);
    for (b = 8; b < 15; b += 2) kick(b, 0.8);
    riser(13, 3, 0.8);
    // storm (16-24): thunder on the bolts
    pad(16, [45, 52], 8, 0.8);
    [16.5, 18, 19.25, 21, 22.5].forEach(function (bb) { at(bb, function (a, t) { a.thunder(t, 1); }); });
    riser(21, 3, 1);
    // drop (24-52): the fly-through, the pan down, Elimination
    impact(24, 0.8);
    for (b = 24; b < 52; b++) {
      kick(b, 1);
      if (b % 2 === 1) snare(b, 1);
      hat(b + 0.5, 0.8, true);
      hat(b + 0.25, 0.4); hat(b + 0.75, 0.4);
      var r = ROOTS[Math.floor((b - 24) / 4) % 4];
      bass(b, r, 0.45, 1); bass(b + 0.5, r + 12, 0.4, 0.8);
    }
    for (i = 0; i < 7; i++) pad(24 + i * 4, CHORDS[i % 4], 4, 0.8);
    // streak (52-64): build with a stab on every tier
    for (b = 52; b < 64; b++) { kick(b, 1); hat(b + 0.5, 0.7, true); }
    for (b = 52; b < 64; b += b < 58 ? 1 : b < 62 ? 0.5 : 0.25) snare(b, 0.4 + (b - 52) / 20);
    [52, 54, 56, 58, 60, 62].forEach(function (bb, k) { at(bb, function (a, t) { a.chime(t, 69 + [0, 3, 7, 10, 12, 15][k], 1); }); bass(bb, 45 + [0, 3, 7, 10, 12, 15][k], 1.8, 1); });
    riser(60, 4, 1);
    // skulls and achievements (64-80): lighter groove, chimes for the unlocks
    impact(64, 0.7);
    for (b = 64; b < 80; b++) {
      if (b % 2 === 0) kick(b, 0.9); else snare(b, 0.7);
      hat(b, 0.4); hat(b + 0.5, 0.6);
      bass(b, ROOTS[Math.floor((b - 64) / 4) % 4], 0.8, 0.8);
    }
    for (i = 0; i < 4; i++) pad(64 + i * 4, CHORDS[i], 4, 0.9);
    for (b = 72; b < 80; b += 0.5) { (function (bb) { at(bb, function (a, t) { a.chime(t, PENTA[Math.floor((bb - 72) * 2) % PENTA.length], 0.5); }); })(b); }
    // follow (80-86): pedal and riser into the Tetris
    for (b = 80; b < 86; b++) { kick(b, 0.9); bass(b, 45, 0.9, 0.9); }
    for (b = 84; b < 86; b += 0.125) snare(b, 0.3 + (b - 84) / 3);
    riser(82, 4, 1.2);
    // clear (86-90): the hit and a last burst
    impact(86, 1.3);
    for (b = 86; b < 90; b++) { kick(b, 1); if (b % 2 === 1) snare(b, 1); hat(b + 0.5, 0.8, true); bass(b, 45, 0.45, 1); bass(b + 0.5, 57, 0.4, 0.8); }
    pad(86, CHORDS[0], 4, 1);
    // finale: a breath, then the title hit and a long chord
    impact(91, 1.2);
    pad(91, [57, 60, 64, 71], 4, 1.4);
    bass(91, 33, 4, 1);
    ev.sort(function (a, b2) { return a.b - b2.b; });
    return ev;
  }

  /* =================================================================
     Stage: DOM, camera, planes
     ================================================================= */

  var BW = (K.COLS + K.SIDE * 2) * K.CELL, BH = K.ROWS * K.CELL, HEAD = 40;   // board canvas 504 x 560 + name bar

  var Cine = {
    root: null, view: null, world: null, bgCanvas: null, fx: null, fxCtx: null, title: null, fade: null, caption: null,
    soundBtn: null, hint: null,
    running: false, raf: 0, t: 0, startedAt: 0, clockBase: 0, lastNow: 0,
    shot: -1, shots: null, groups: [], boards: [],
    cam: { x: 0, y: 0, z: 1000, yaw: 0, pitch: 0, roll: 0, fov: 50 },
    shake: 0, flash: 0, shock: 1, energy: 0, travel: 0, level: 0, fade: 0, bolts: [], sparks: [], aberration: 0,
    soundWanted: true, beepWas: null,

    needSound: function () { if (this.hint) this.hint.classList.remove('hidden'); }
  };

  function buildStage() {
    var root = el('div', 'cine');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Tetris intro cinematic');
    Cine.bgCanvas = el('canvas', 'cine-bg', root);
    Cine.view = el('div', 'cine-view', root);
    Cine.world = el('div', 'cine-world', Cine.view);
    Cine.fx = el('canvas', 'cine-fx', root);
    Cine.fxCtx = Cine.fx.getContext('2d');
    Cine.caption = el('div', 'cine-caption', root);
    var title = el('div', 'cine-title', root);
    var word = el('div', 'cine-word', title);
    'TETRIS'.split('').forEach(function (ch, i) { var s = el('span', 'cine-letter l' + i, word); s.textContent = ch; });
    var sub = el('div', 'cine-sub', title);
    sub.textContent = 'falling blocks killed my family';
    Cine.title = { box: title, word: word, sub: sub, letters: word.children };
    el('div', 'cine-bars top', root);
    el('div', 'cine-bars bottom', root);
    el('div', 'cine-grain', root);
    Cine.fadeEl = el('div', 'cine-fade', root);
    var ui = el('div', 'cine-ui', root);
    Cine.hint = el('button', 'cine-btn cine-hint hidden', ui);
    Cine.hint.type = 'button';
    Cine.hint.textContent = 'Click for sound';
    Cine.soundBtn = el('button', 'cine-btn', ui);
    Cine.soundBtn.type = 'button';
    var skip = el('button', 'cine-btn cine-skip', ui);
    skip.type = 'button';
    skip.textContent = 'Skip cinematic';
    skip.addEventListener('click', function (e) { e.stopPropagation(); finish(); });
    Cine.soundBtn.addEventListener('click', function (e) { e.stopPropagation(); setSound(!Cine.soundWanted); });
    Cine.hint.addEventListener('click', function (e) { e.stopPropagation(); setSound(true); });
    // Browsers only start audio after a click or key: the first one anywhere turns the sound on.
    root.addEventListener('pointerdown', function () { if (Cine.soundWanted && !Audio.on) setSound(true); });
    Cine.root = root;
    Cine.skipBtn = skip;
    document.body.appendChild(root);
    Bg.mount(Cine.bgCanvas);
  }

  function setSound(on) {
    Cine.soundWanted = on;
    Cine.soundBtn.textContent = on ? 'Sound on' : 'Sound off';
    if (on) {
      if (!Audio.ctx) Audio.init();
      if (Audio.master) { Audio.master.gain.cancelScheduledValues(0); Audio.master.gain.value = CUES.volume; }
      if (Audio.start(Cine.t)) Cine.hint.classList.add('hidden');
      else {
        Cine.needSound();
        // resume() settles after this click; hide the hint once the browser lets the audio run
        if (Audio.ctx && Audio.ctx.resume) Audio.ctx.resume().then(function () { if (Audio.ctx && Audio.ctx.state === 'running' && Audio.on) Cine.hint.classList.add('hidden'); });
      }
    } else {
      Audio.stop();
      Cine.hint.classList.add('hidden');
    }
  }

  // A group of planes that belongs to one shot (hidden while another shot is on screen).
  function group() {
    var g = { el: el('div', 'cine-group', Cine.world), items: [], boards: [] };
    g.el.style.display = 'none';
    Cine.groups.push(g);
    return g;
  }

  function plane(g, node, w, h, o) {
    node.classList.add('cine-plane');
    node.style.width = w + 'px';
    node.style.height = h + 'px';
    g.el.appendChild(node);
    var it = { el: node, w: w, h: h, x: 0, y: 0, z: 0, ry: 0, rx: 0, rz: 0, s: 1, fog: null, r: Math.max(w, h) * 0.6, cull: true };
    Object.keys(o || {}).forEach(function (k) { it[k] = o[k]; });
    g.items.push(it);
    return it;
  }

  // A live board on a plane: the game's own canvas, plus the cinematic look (slab layers, gloss, fog, rim).
  function boardPlane(g, p, o) {
    o = o || {};
    var node = el('div', 'cine-board' + (o.hero ? ' hero' : '') + (o.mini ? ' mini' : '') + (o.danger ? ' danger' : ''));
    var head = el('div', 'cine-board-head', node);
    var name = el('span', 'cine-board-name', head);
    name.textContent = p.name;
    head.appendChild(p.ui.lives);
    var face = el('div', 'cine-board-face', node);
    face.appendChild(p.ui.canvas);
    var layers = [];
    for (var i = 1; i <= (o.depth || 0); i++) {
      var c = el('canvas', 'cine-board-depth', node);
      c.width = BW / 2; c.height = BH / 2;
      c.style.transform = 'translateZ(' + (-i * 9) + 'px)';
      layers.push(c);
    }
    var gloss = el('div', 'cine-gloss', face);
    var rows = el('div', 'cine-rows', face);
    var fog = el('div', 'cine-fog', node);
    var it = plane(g, node, BW, BH + HEAD, o);
    it.board = p; it.face = face; it.gloss = gloss; it.fog = fog; it.layers = layers; it.rows = rows; it.frame = 0;
    g.boards.push(it);
    return it;
  }

  /* ---------- boards: real Players, played by real CPUs ---------- */

  var BOT_NAMES = ['Blocky', 'Tess', 'Gridlock', 'Spin', 'Cobalt', 'Nova', 'Pixel', 'Stack', 'Drop', 'Lumen', 'Vex', 'Orbit'];
  var botCount = 0;

  function makePlayer(o) {
    o = o || {};
    var p = new K.Player({ id: 'cine' + botCount, name: o.name || BOT_NAMES[botCount % BOT_NAMES.length], palette: o.palette || K.randomPalette(),
      local: true, controls: K.NO_KEYS, lives: 1, versus: !!o.versus, skulls: o.skulls || [] });
    botCount++;
    var cv = document.createElement('canvas');
    cv.width = BW; cv.height = BH;
    cv.className = 'cine-canvas';
    p.ui = { card: document.createElement('div'), canvas: cv, ctx: cv.getContext('2d'), stats: document.createElement('div'),
      timers: document.createElement('div'), lives: el('span', 'cine-board-lives'), shownTimers: '' };
    if (o.level !== null) p.cpu = K.cpuBrain(o.level || 'ultra');
    p.f.noStreaks = !o.streaks;   // the No Streaks rule flag: only the streak shot's hero shows streak tiers
    p.speed = o.speed || 1.4;
    if (o.warm) warm(p, o.warm);
    return p;
  }

  function stackTop(p) {
    for (var r = 0; r < K.ROWS; r++) if (p.board[r].some(function (v) { return v; })) return r;
    return K.ROWS;
  }

  // One cinematic step of a board: the same gravity and lock rules as the game, with our own lock handler.
  function sim(p, dt) {
    dt *= p.speed || 1;
    p.elapsed += dt;
    if (p.flash) p.flash = Math.max(0, p.flash - dt);
    if (p.lockStreak) { p.streak = p.lockStreak; p.streakLeft = 30; }
    else if (p.streakLeft > 0) { p.streakLeft = Math.max(0, p.streakLeft - dt); if (!p.streakLeft) { p.streak = 0; p.streakLines = 0; } }
    if (!p.piece || !p.alive || p.scripted) return;
    if (p.cpu) K.cpuTick(p, dt, onLock);
    if (!p.piece) return;
    if (p.grounded()) {
      p.lockTimer += dt;
      if (p.lockTimer >= p.lockDelay()) onLock(p, p.lock());
    } else {
      p.fall += dt;
      var g = K.gravity(p.gravityLevel());
      while (p.fall >= g) { p.fall -= g; if (!p.grounded()) p.piece.y++; else break; }
    }
  }

  function onLock(p, res) {
    if (res.cleared && p.onClear) p.onClear(res);
    // A board that tops out (or gets too tall to look good) quietly starts over; cinematics have no game over.
    if (res.toppedOut || (!p.keepTall && stackTop(p) < 5)) { var keep = p.score; p.reset(true); p.score = keep; }
  }

  function warm(p, seconds) {
    for (var k = 0; k < seconds * 30; k++) sim(p, 1 / 30 / (p.speed || 1));
  }

  // Garbage rows from the bottom (for the board in danger, and for variety).
  function fillRows(p, n, holeChance) {
    for (var r = K.ROWS - n; r < K.ROWS; r++) {
      var hole = Math.floor(Math.random() * K.COLS);
      for (var c = 0; c < K.COLS; c++) p.board[r][c] = c === hole || Math.random() < (holeChance || 0) ? 0 : K.GARBAGE;
    }
  }

  /* =================================================================
     The shots
     ================================================================= */

  // Each shot: { pat (background), group, build(), enter(), update(t, u, lb, dt) }. u: 0..1 through the shot,
  // lb: beats since the shot began. Camera values are set every frame from u, so skipping around is exact.
  function makeShots() {
    var S = {};

    S.rain = { pat: 0, update: function (t, u) {
      var c = Cine.cam; c.x = 0; c.y = 0; c.z = 1000; c.yaw = Math.sin(t * 0.4) * 2; c.pitch = lerp(-3, 4, u); c.roll = 0; c.fov = 50;
      Cine.fade = 1 - span(u, 0, 0.18);
    } };

    S.title = { pat: 1, update: function (t, u, lb) {
      var c = Cine.cam; c.yaw = Math.sin(t * 0.7) * 3; c.pitch = Math.cos(t * 0.5) * 2; c.roll = Math.sin(t * 0.3) * 1.5;
      titleCard(lb, u);
      if (lb < 0.05 && !S.title.burst) { S.title.burst = true; burst(innerWidth / 2, innerHeight / 2, 140); }
      Cine.fade = span(u, 0.86, 1);
    }, enter: function () { S.title.burst = false; }, exit: function () { hideTitle(); } };

    S.storm = { pat: 2, bolts: [0.5, 2, 3.25, 5, 6.5], update: function (t, u, lb) {
      var c = Cine.cam; c.yaw = Math.sin(t * 0.5) * 3; c.pitch = 6 + Math.sin(t * 0.8) * 1.5; c.roll = 0;
      S.storm.bolts.forEach(function (b, i) {
        if (lb >= b && !S.storm.hit[i]) { S.storm.hit[i] = true; strike(i); }
      });
      Cine.fade = Math.max(1 - span(u, 0, 0.12), span(u, 0.84, 1));
    }, enter: function () { S.storm.hit = []; } };

    // Corridor: live boards line both walls; the camera rushes down the middle.
    S.corridor = { pat: 3, build: function (g) {
      for (var i = 0; i < 10; i++) {
        var left = i % 2 === 0, k = Math.floor(i / 2);
        var p = makePlayer({ warm: 18 + i * 3, speed: 1.6 });
        boardPlane(g, p, { x: left ? -620 : 620, y: 40, z: -k * 1150 - (left ? 0 : 575), ry: left ? 72 : -72, cull: true });
      }
    }, update: function (t, u) {
      var c = Cine.cam, k = easeInOut(u * 0.85 + 0.15 * u * u);
      c.x = Math.sin(u * 5) * 60; c.y = Math.sin(u * 3) * 30; c.z = lerp(1300, -5200, k);
      c.yaw = Math.sin(u * 6.5) * 9; c.pitch = Math.sin(u * 4) * 3; c.roll = Math.sin(u * 4.2) * 6; c.fov = lerp(60, 74, smooth(u * 2));
      Cine.travel = -c.z / 700;
      Cine.fade = 1 - span(u, 0, 0.04);
    } };

    // Pan down from the sky onto a game in progress.
    S.pandown = { pat: 4, build: function (g) {
      var p = makePlayer({ name: 'You', palette: K.myPalette(), warm: 30, speed: 1.3 });
      boardPlane(g, p, { x: 0, y: 0, z: 0, hero: true, depth: 3 });
    }, update: function (t, u) {
      var c = Cine.cam, k = easeInOut(span(u, 0, 0.7));
      c.x = lerp(-120, 0, k); c.y = lerp(-1300, 0, k); c.z = lerp(1100, 760, easeOut(u)); c.pitch = lerp(42, -2, k);
      c.yaw = lerp(-8, 10, smooth(u)); c.roll = lerp(-4, 0, k); c.fov = 52;
      Cine.travel = t * 0.5;
    } };

    // Elimination: a row of boards on an arc, one about to be cut.
    S.elim = { pat: 5, build: function (g) {
      S.elim.players = [];
      for (var i = 0; i < 5; i++) {
        var p = makePlayer({ versus: true, warm: 20 + i * 2, speed: i === 3 ? 0.9 : 1.4 });
        if (i === 3) { fillRows(p, 11); p.keepTall = true; }
        var a = (i - 2) * 19;
        boardPlane(g, p, { x: Math.sin(a * D2R) * 1900, y: 0, z: -Math.cos(a * D2R) * 1900 + 1900, ry: -a, danger: i === 3 });
        S.elim.players.push(p);
      }
    }, update: function (t, u, lb) {
      var c = Cine.cam, k = easeInOut(u), from = S.elim.group.items[0], to = S.elim.group.items[3];
      c.x = lerp(-1500, 700, k); c.y = lerp(-120, -40, k); c.z = lerp(1500, 1250, k); c.roll = lerp(-3, 2, k); c.fov = 55;
      lookAt(lerp(from.x, to.x, k), 0, lerp(from.z, to.z, k));
      var left = Math.max(0, 9 - Math.floor(lb / 2) * 2);
      S.elim.players.forEach(function (p, i) { p.dangerText = (i === 3 ? 'DANGER 0:0' : 'CUT IN 0:0') + left; });
      var board = S.elim.group.boards[3];
      board.el.classList.toggle('danger-on', (lb % 1) < 0.5);
    } };

    // Streak tiers: focus view, the central board dominating, minis either side.
    var TIERS = [[2, 'STREAK'], [5, 'WARMING UP'], [10, 'ON FIRE'], [20, 'RAINBOW ROAD'], [30, 'OVERDRIVE'], [50, 'SUPERNOVA']];
    S.streak = { pat: 6, build: function (g) {
      var hero = makePlayer({ name: 'You', palette: K.myPalette(), warm: 25, speed: 1.5 });
      S.streak.hero = hero;
      boardPlane(g, hero, { x: 0, y: 0, z: 0, hero: true, depth: 3 });
      [[-520, -160], [-520, 170], [520, -160], [520, 170], [-820, 5], [820, 5]].forEach(function (xy, i) {
        var p = makePlayer({ warm: 15 + i * 4, speed: 1.3 });
        boardPlane(g, p, { x: xy[0], y: xy[1], z: -160, s: 0.46, mini: true });
      });
    }, update: function (t, u) {
      var c = Cine.cam;
      c.x = Math.sin(u * 3) * 60; c.y = lerp(-20, 10, u); c.z = lerp(1000, 820, easeInOut(u)); c.roll = Math.sin(u * 2.5) * 2; c.fov = 50;
      lookAt(0, -10, 0); c.yaw += Math.sin(u * 4) * 2;
      var tier = Math.min(TIERS.length - 1, Math.floor(u * TIERS.length));
      if (tier !== S.streak.tier) {
        S.streak.tier = tier;
        S.streak.hero.lockStreak = TIERS[tier][0];
        Cine.flash = Math.max(Cine.flash, 0.35); Cine.shake = Math.max(Cine.shake, 0.5);
        caption(TIERS[tier][0] + 'x', TIERS[tier][1]);
      }
      Cine.energy = (tier + 1) / TIERS.length;
    }, enter: function () { S.streak.tier = -1; }, exit: function () { S.streak.hero.lockStreak = 0; caption(); Cine.energy = 0; } };

    // Skulls: the 24 skull cards on a wall, lighting up as the camera passes.
    S.skulls = { pat: 7, build: function (g) {
      var wall = el('div', 'cine-wall cine-skulls');
      el('div', 'cine-wall-title', wall).textContent = 'SKULLS';
      var mult = el('div', 'cine-wall-sub', wall);
      var grid = el('div', 'cine-grid', wall);
      var cards = [];
      (App.skulls ? App.skulls() : []).forEach(function (s) {
        var card = el('div', 'cine-card cat-' + s.cat, grid);
        card.appendChild(App.skullIcon(s.id));
        el('span', 'cine-card-name', card).textContent = s.name;
        el('span', 'cine-card-eff', card).textContent = (s.eff > 0 ? '+' : '') + s.eff;
        cards.push({ el: card, eff: s.eff });
      });
      S.skulls.cards = cards; S.skulls.mult = mult;
      plane(g, wall, 1700, 820, { x: 0, y: 0, z: 0, ry: -14, cull: false });
    }, update: function (t, u) {
      var c = Cine.cam, k = easeInOut(u);
      c.x = lerp(-900, 900, k); c.y = lerp(-160, 140, k); c.z = lerp(800, 980, k); c.roll = lerp(-3, 2, k); c.fov = 52;
      lookAt(lerp(-520, 520, k), lerp(-60, 60, k), 0);
      var on = Math.floor(u * 1.25 * S.skulls.cards.length), m = 1;
      S.skulls.cards.forEach(function (cd, i) { var lit = i < on && cd.eff > 0; cd.el.classList.toggle('on', lit); if (lit) m += cd.eff; });
      S.skulls.mult.textContent = 'score multiplier ×' + (Math.round(m * 100) / 100);
    } };

    // Achievements: the badge wall, unlocking in a ripple.
    S.achievements = { pat: 8, build: function (g) {
      var wall = el('div', 'cine-wall cine-ach');
      el('div', 'cine-wall-title', wall).textContent = 'ACHIEVEMENTS';
      var count = el('div', 'cine-wall-sub', wall);
      var grid = el('div', 'cine-grid', wall);
      var items = [];
      (ACH && ACH.list ? ACH.list() : []).forEach(function (a) {
        var card = el('div', 'cine-card tier-' + a.tier, grid);
        card.appendChild(ACH.badge(a.id, 56, false));
        el('span', 'cine-card-name', card).textContent = a.name;
        items.push(card);
      });
      S.achievements.items = items; S.achievements.count = count;
      plane(g, wall, 1900, 980, { x: 0, y: 0, z: 0, ry: 12, rx: 6, cull: false });
    }, update: function (t, u) {
      var c = Cine.cam, k = easeInOut(u);
      c.x = lerp(900, -800, k); c.y = lerp(280, -220, k); c.z = lerp(820, 1150, k); c.roll = lerp(2, -2, k); c.fov = 52;
      lookAt(lerp(560, -560, k), lerp(160, -160, k), 0);
      var n = S.achievements.items.length, on = Math.floor(easeOut(u * 1.15) * n);
      S.achievements.items.forEach(function (it, i) { it.classList.toggle('on', i < on); it.classList.toggle('pop', i === on - 1); });
      S.achievements.count.textContent = Math.min(n, on) + ' / ' + n + ' unlocked';
    } };

    // Follow a falling I piece down the well, into a four-row Tetris on the cut to the next shot.
    S.follow = { pat: 9, build: function (g) {
      var p = makePlayer({ name: 'You', palette: K.myPalette(), level: null, speed: 1 });
      S.follow.player = p;
      S.follow.item = boardPlane(g, p, { x: 0, y: 0, z: 0, hero: true, depth: 3 });
      S.clear.item = S.follow.item;
    }, enter: function () { prepTetris(S.follow.player); }, update: function (t, u) {
      var p = S.follow.player, item = S.follow.item;
      if (p.scripted && p.piece) {
        var land = 16, y = Math.floor(lerp(-1, land + 0.999, Math.pow(u, 1.15)));
        p.piece.y = Math.min(land, Math.max(-1, y));
      }
      var py = pieceWorldY(item, p), px = pieceWorldX(item, p), c = Cine.cam;
      c.x = lerp(330, 230, u); c.y = py - lerp(170, 90, u); c.z = lerp(470, 360, u); c.roll = lerp(-6, -2, u) + Math.sin(t * 2) * 0.8; c.fov = 56;
      lookAt(px - 20, py + 30, 0);
      pieceGlow(item, p);
      Cine.travel = t * 3;
    } };

    // The Tetris: the piece locks on the cut, the four rows flash white, the camera pulls back.
    S.clear = { pat: 10, update: function (t, u, lb) {
      var p = S.follow.player, item = S.clear.item;
      if (!S.clear.done) {
        S.clear.done = true;
        if (p.piece) { p.piece.y = 16; p.scripted = false; p.fall = 0; }
        var rows = fullRowsAfterLock(p);
        onLock(p, p.lock());
        S.clear.rows = rows; S.clear.at = t;
        Cine.flash = 1; Cine.shake = 1.2; Cine.shock = 0; Cine.aberration = 1;
        p.cpu = K.cpuBrain('ultra');
        burst(innerWidth / 2, innerHeight * 0.6, 160);
      }
      rowFlash(item, S.clear.rows, (t - S.clear.at) / 0.9);
      Cine.shock = Math.min(1, (t - S.clear.at) / 1.4);
      var k = easeOut(span(u, 0.05, 1)), c = Cine.cam;
      c.x = lerp(230, -260, k); c.y = lerp(170, -40, k); c.z = lerp(360, 980, k); c.roll = lerp(-2, 3, k); c.fov = lerp(56, 46, k);
      lookAt(lerp(106, 0, k), lerp(230, 0, k), 0);
      pieceGlow(item, null);
    }, enter: function () { S.clear.done = false; }, exit: function () { rowFlash(S.clear.item, [], 1); } };

    S.finale = { pat: 11, update: function (t, u, lb) {
      var c = Cine.cam; c.x = 0; c.y = 0; c.z = 1000; c.yaw = Math.sin(t * 0.6) * 2.5; c.pitch = Math.cos(t * 0.4) * 2; c.roll = Math.sin(t * 0.35) * 1.2; c.fov = 50;
      var hit = lb - 1;
      if (hit >= 0 && !S.finale.burst) { S.finale.burst = true; burst(innerWidth / 2, innerHeight / 2, 180); Cine.flash = 0.8; }
      if (hit >= 0) titleCard(hit, 0); else hideTitle();
      Cine.fade = hit < 0 ? span(lb, 0, 0.75) : Math.max(1 - span(hit, 0, 0.2), span(lb, 4, 5));
    }, enter: function () { S.finale.burst = false; }, exit: function () { hideTitle(); } };

    // The Tetris shot continues on the follow shot's board, so it shares that shot's planes.
    S.clear.share = 'follow';
    return CUES.shots.map(function (s) {
      var shot = S[s.id];
      shot.id = s.id; shot.cue = s;
      shot.group = shot.share ? S[shot.share].group : group();
      if (shot.build) shot.build(shot.group);
      return shot;
    });
  }

  // The follow shot's board: a tidy stack with a clean well in the right column, and a vertical I at the top.
  function prepTetris(p) {
    p.reset(true);
    for (var r = 0; r < K.ROWS; r++) for (var c = 0; c < K.COLS; c++) p.board[r][c] = 0;
    var heights = [10, 11, 9, 10, 12, 11, 9, 10, 8, 0];
    for (c = 0; c < K.COLS; c++) for (r = K.ROWS - heights[c]; r < K.ROWS; r++) p.board[r][c] = 1 + ((r + c) % 7);
    for (r = K.ROWS - 4; r < K.ROWS; r++) for (c = 0; c < K.COLS - 1; c++) p.board[r][c] = p.board[r][c] || 3;
    p.piece = { type: 'I', rot: 1, x: 7, y: -1, power: 0, powerCell: 0 };
    p.scripted = true; p.cpu = null; p.hold = null;
  }

  function fullRowsAfterLock(p) {
    var test = p.board.map(function (row) { return row.slice(); });
    p.cells(p.piece.x, p.piece.y, p.piece.rot).forEach(function (c) { if (c[1] >= 0) test[c[1]][c[0]] = 1; });
    var out = [];
    for (var r = 0; r < K.ROWS; r++) if (test[r].every(function (v) { return v; })) out.push(r);
    return out;
  }

  // Where the falling piece is in world space (board planes are centred on their position).
  function pieceWorldY(item, p) {
    var row = p.piece ? p.piece.y + 2 : 10;
    return item.y + (HEAD + row * K.CELL) - (BH + HEAD) / 2;
  }
  function pieceWorldX(item, p) {
    var col = p.piece ? p.piece.x + 2.5 : 5;
    return item.x + (K.SIDE + col) * K.CELL - BW / 2;
  }

  // A glowing frame floating a little in front of the falling piece: it parallaxes against the board as the
  // camera moves, which sells the depth, and keeps the piece readable against a stack of the same colour.
  function pieceGlow(item, p) {
    if (!item.glow) item.glow = el('div', 'cine-pieceglow', item.el);
    var g = item.glow;
    if (!p || !p.piece) { g.style.display = 'none'; return; }
    var cells = p.cells(p.piece.x, p.piece.y, p.piece.rot), minC = 99, maxC = -1, minR = 99, maxR = -99;
    cells.forEach(function (c) { minC = Math.min(minC, c[0]); maxC = Math.max(maxC, c[0]); minR = Math.min(minR, c[1]); maxR = Math.max(maxR, c[1]); });
    g.style.display = '';
    g.style.width = ((maxC - minC + 1) * K.CELL + 8) + 'px';
    g.style.height = ((maxR - minR + 1) * K.CELL + 8) + 'px';
    g.style.transform = 'translate3d(' + ((K.SIDE + minC) * K.CELL - 4) + 'px,' + (HEAD + minR * K.CELL - 4) + 'px,26px)';
  }

  function rowFlash(item, rows, k) {
    var box = item.rows;
    if (!rows.length || k >= 1) { box.textContent = ''; box.style.opacity = 0; item.face.style.filter = ''; return; }
    if (box.childElementCount !== rows.length) {
      box.textContent = '';
      rows.forEach(function (r) {
        var bar = el('div', 'cine-row', box);
        bar.style.top = (r * K.CELL) + 'px';
        bar.style.left = (K.SIDE * K.CELL) + 'px';
        bar.style.width = (K.COLS * K.CELL) + 'px';
        bar.style.height = K.CELL + 'px';
      });
    }
    var e = 1 - k;
    box.style.opacity = e;
    Array.prototype.forEach.call(box.children, function (b, i) { b.style.transform = 'scaleX(' + (1 + k * 0.5) + ') scaleY(' + (1 + k * (1.5 + i * 0.3)) + ')'; });
    item.face.style.filter = 'brightness(' + (1 + e * 1.6) + ') saturate(' + (1 + e) + ')';
  }

  /* ---------- title card, captions, fx ---------- */

  function titleCard(lb, u) {
    var t = Cine.title;
    t.box.style.display = 'flex';
    for (var i = 0; i < t.letters.length; i++) {
      var k = backOut(span(lb, i * 0.06, i * 0.06 + 0.55));
      var s = k * (1 + Cine.beat * 0.04);
      t.letters[i].style.transform = 'translateY(' + ((1 - k) * 60) + 'px) scale(' + s + ')';
      t.letters[i].style.opacity = clamp01(k * 2);
    }
    var zoom = 1 + u * 0.08;
    t.word.style.transform = 'scale(' + zoom + ') rotate(' + (Math.sin(Cine.t * 0.6) * 1.2) + 'deg)';
    var sk = span(lb, 1.5, 2.5);
    t.sub.style.opacity = sk;
    t.sub.style.letterSpacing = lerp(0.9, 0.32, easeOut(sk)) + 'em';
  }

  function hideTitle() { Cine.title.box.style.display = 'none'; }

  function caption(big, small) {
    var c = Cine.caption;
    if (!big) { c.classList.remove('show'); return; }
    c.innerHTML = '';
    el('strong', '', c).textContent = big;
    el('span', '', c).textContent = small;
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
  }

  function burst(x, y, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 200 + Math.random() * 900;
      Cine.sparks.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6 + Math.random() * 0.8, age: 0,
        hue: [280, 220, 320, 190][i % 4], size: 2 + Math.random() * 4 });
    }
  }

  // Lightning: a jagged bolt from the top with a couple of forks, flickering, and a white flash.
  function strike(i) {
    var w = innerWidth, h = innerHeight, x = w * (0.2 + hash(i * 3.7 + Cine.seed) * 0.6);
    var pts = [[x, -10]], y = -10;
    while (y < h * (0.7 + hash(i) * 0.3)) { y += 20 + Math.random() * 35; x += (Math.random() - 0.5) * 70; pts.push([x, y]); }
    var forks = [];
    for (var f = 0; f < 3; f++) {
      var from = pts[2 + Math.floor(Math.random() * (pts.length - 3))], fp = [from.slice()], fx = from[0], fy = from[1], dir = Math.random() < 0.5 ? -1 : 1;
      for (var k = 0; k < 6; k++) { fy += 15 + Math.random() * 25; fx += dir * (10 + Math.random() * 30); fp.push([fx, fy]); }
      forks.push(fp);
    }
    Cine.bolts.push({ pts: pts, forks: forks, age: 0 });
    Cine.flash = 1; Cine.shake = Math.max(Cine.shake, 0.6);
  }

  function drawFx(dt) {
    var cv = Cine.fx, ctx = Cine.fxCtx, w = innerWidth, h = innerHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.clearRect(0, 0, w, h);
    Cine.bolts = Cine.bolts.filter(function (b) { b.age += dt; return b.age < 0.6; });
    Cine.bolts.forEach(function (b) {
      var a = b.age < 0.08 ? 1 : b.age < 0.14 ? 0.3 : b.age < 0.22 ? 0.9 : Math.max(0, 1 - (b.age - 0.22) / 0.38);
      ctx.save();
      ctx.lineJoin = 'round';
      [b.pts].concat(b.forks).forEach(function (pts, n) {
        for (var pass = 0; pass < 2; pass++) {
          ctx.beginPath();
          pts.forEach(function (pt, i) { if (i) ctx.lineTo(pt[0], pt[1]); else ctx.moveTo(pt[0], pt[1]); });
          ctx.strokeStyle = pass ? 'rgba(255,255,255,' + a + ')' : 'rgba(150,120,255,' + a * 0.7 + ')';
          ctx.lineWidth = (pass ? 2 : 9) * (n ? 0.5 : 1);
          ctx.shadowColor = 'rgba(170,140,255,' + a + ')';
          ctx.shadowBlur = pass ? 10 : 30;
          ctx.stroke();
        }
      });
      ctx.restore();
    });
    Cine.sparks = Cine.sparks.filter(function (s) { s.age += dt; return s.age < s.life; });
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    Cine.sparks.forEach(function (s) {
      s.vx *= 1 - dt * 1.8; s.vy = s.vy * (1 - dt * 1.8) + 300 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      var a = 1 - s.age / s.life;
      ctx.fillStyle = 'hsla(' + s.hue + ',100%,70%,' + a + ')';
      ctx.fillRect(s.x, s.y, s.size, s.size);
    });
    ctx.restore();
  }

  /* =================================================================
     Frame loop
     ================================================================= */

  // Point the camera at a world position (yaw right-positive, pitch up-positive; world y points down).
  function lookAt(tx, ty, tz) {
    var c = Cine.cam, dx = tx - c.x, dy = ty - c.y, dz = tz - c.z;
    c.yaw = Math.atan2(dx, -dz) / D2R;
    c.pitch = Math.atan2(-dy, Math.sqrt(dx * dx + dz * dz)) / D2R;
  }

  function camDepth(x, y, z) {
    var c = Cine.cam, dx = x - c.x, dy = y - c.y, dz = z - c.z, ya = c.yaw * D2R, pa = c.pitch * D2R;
    var x1 = dx * Math.cos(ya) + dz * Math.sin(ya), z1 = -dx * Math.sin(ya) + dz * Math.cos(ya);
    var y2 = dy * Math.cos(pa) - z1 * Math.sin(pa), z2 = dy * Math.sin(pa) + z1 * Math.cos(pa);
    return { x: x1, y: y2, d: -z2 };
  }

  function applyCamera() {
    var c = Cine.cam, vw = innerWidth, vh = innerHeight;
    var safeH = Math.min(vh, vw * 9 / 16), P = (safeH / 2) / Math.tan(c.fov * D2R / 2);
    var sx = 0, sy = 0, sr = 0;
    if (Cine.shake > 0.01) { sx = (Math.random() - 0.5) * 24 * Cine.shake; sy = (Math.random() - 0.5) * 24 * Cine.shake; sr = (Math.random() - 0.5) * 1.5 * Cine.shake; }
    Cine.view.style.perspective = P.toFixed(1) + 'px';
    Cine.world.style.transform = 'translate3d(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px,' + P.toFixed(1) + 'px) rotateZ(' + (c.roll + sr).toFixed(2) + 'deg) rotateX(' +
      c.pitch.toFixed(2) + 'deg) rotateY(' + c.yaw.toFixed(2) + 'deg) translate3d(' + (-c.x).toFixed(1) + 'px,' + (-c.y).toFixed(1) + 'px,' + (-c.z).toFixed(1) + 'px)';
    return { P: P, tan: Math.tan(c.fov * D2R / 2), ax: vw / safeH, ay: vh / safeH };
  }

  function layoutGroup(g, view, dt) {
    g.items.forEach(function (it) {
      var cd = camDepth(it.x, it.y, it.z), vis = true;
      if (it.cull) {
        var r = it.r * it.s;
        vis = cd.d > -r * 0.5 && Math.abs(cd.x) - r < Math.max(cd.d, 1) * view.tan * view.ax * 1.1 && Math.abs(cd.y) - r < Math.max(cd.d, 1) * view.tan * view.ay * 1.1;
      }
      it.visible = vis;
      it.el.style.visibility = vis ? '' : 'hidden';
      if (!vis) return;
      it.el.style.transform = 'translate3d(' + it.x + 'px,' + it.y + 'px,' + it.z + 'px) rotateY(' + it.ry + 'deg) rotateX(' + it.rx + 'deg) rotateZ(' + it.rz + 'deg) scale(' + it.s + ') translate(' + (-it.w / 2) + 'px,' + (-it.h / 2) + 'px)';
      if (it.fog) it.fog.style.opacity = clamp01((cd.d - 1400) / 3200).toFixed(3);
      if (it.gloss) it.gloss.style.backgroundPosition = (50 + (Cine.cam.yaw - it.ry) * 2.5 + cd.x * 0.03).toFixed(1) + '% 0';
    });
  }

  function drawBoards(g, dt) {
    g.boards.forEach(function (it) {
      sim(it.board, dt);
      if (!it.visible) return;
      K.drawPlayer(it.board);
      if (it.layers.length && (it.frame++ % 2 === 0)) {
        it.layers.forEach(function (c, i) {
          var x = c.getContext('2d');
          x.clearRect(0, 0, c.width, c.height);
          x.globalCompositeOperation = 'source-over';
          x.drawImage(it.board.ui.canvas, 0, 0, c.width, c.height);
          x.globalCompositeOperation = 'source-atop';
          x.fillStyle = 'rgba(' + (30 - i * 6) + ',6,' + (60 - i * 10) + ',' + (0.55 + i * 0.12) + ')';
          x.fillRect(0, 0, c.width, c.height);
        });
      }
    });
  }

  function shotIndexAt(t) {
    var idx = 0;
    for (var i = 0; i < Cine.shots.length; i++) if (shotStart(Cine.shots[i].cue) <= t) idx = i;
    return idx;
  }

  function frame(now) {
    if (!Cine.running) return;
    var dt = Math.min(0.05, Math.max(0, (now - Cine.lastNow) / 1000));
    Cine.lastNow = now;
    var audioT = Audio.clock();
    if (audioT != null) { Cine.t = audioT; Cine.clockBase = now - audioT * 1000; }
    else Cine.t = Cine.hold != null ? Cine.hold : (now - Cine.clockBase) / 1000;
    var t = Cine.t;
    if (t >= endTime()) { finish(); return; }
    Audio.pump(t);

    var idx = shotIndexAt(t);
    if (idx !== Cine.shot) {
      var old = Cine.shots[Cine.shot];
      if (old) { if (old.exit) old.exit(); old.group.el.style.display = 'none'; }
      Cine.shot = idx;
      var cur = Cine.shots[idx];
      cur.group.el.style.display = '';
      Cine.travel = 0;
      if (cur.enter) cur.enter();
    }
    var shot = Cine.shots[idx], s0 = shotStart(shot.cue), s1 = idx + 1 < Cine.shots.length ? shotStart(Cine.shots[idx + 1].cue) : endTime();
    var u = clamp01((t - s0) / (s1 - s0)), lb = (t - s0) / spb();

    var bt = beatAt(t);
    Cine.beat = bt >= 0 ? Math.exp(-(bt - Math.floor(bt)) * 5) : 0;
    var lvl = Audio.measure();
    Cine.level += ((lvl == null ? 0.25 + Cine.beat * 0.35 : lvl) - Cine.level) * Math.min(1, dt * 12);
    Cine.flash = Math.max(0, Cine.flash - dt * 3);
    Cine.shake = Math.max(0, Cine.shake - dt * 2.5);
    Cine.aberration = Math.max(0, Cine.aberration - dt * 2.5);

    Cine.fade = 0;
    shot.update(t, u, lb, dt);

    var view = applyCamera();
    layoutGroup(shot.group, view, dt);
    drawBoards(shot.group, dt);
    Bg.draw({ time: t, pat: shot.pat, level: Cine.level, beat: Cine.beat, bt: bt, flash: Cine.flash, energy: Cine.energy, shock: Cine.shock, cam: Cine.cam, travel: Cine.travel });
    drawFx(dt);
    Cine.fadeEl.style.opacity = clamp01(Cine.fade).toFixed(3);
    Cine.view.style.filter = Cine.aberration > 0.02
      ? 'drop-shadow(' + (Cine.aberration * 6).toFixed(1) + 'px 0 0 rgba(255,0,90,0.55)) drop-shadow(' + (-Cine.aberration * 6).toFixed(1) + 'px 0 0 rgba(0,200,255,0.55))'
      : '';
    Cine.raf = requestAnimationFrame(frame);
  }

  /* =================================================================
     Play / finish
     ================================================================= */

  function onKey(e) {
    if (!Cine.running) return;
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(); return; }
    if (Cine.soundWanted && !Audio.on) setSound(true);
  }

  function play(fromBeat) {
    if (Cine.running) return;
    G.Store.set(STORE_SEEN, Date.now());
    Cine.seed = Math.random() * 100;
    botCount = 0;
    buildStage();
    Cine.shots = makeShots();
    Cine.shot = -1;
    Cine.running = true;
    Cine.hold = null;
    document.documentElement.classList.add('cine-open');
    // The cinematic's boards would beep on every move and lock; hush the game's sound effects while it plays.
    if (G.Sound) { Cine.beepWas = G.Sound.beep; G.Sound.beep = function () {}; }
    document.addEventListener('keydown', onKey, true);
    var startT = fromBeat ? timeOfBeat(+fromBeat) : 0;
    Cine.t = startT;
    Cine.lastNow = performance.now();
    Cine.clockBase = Cine.lastNow - startT * 1000;
    setSound(!(G.Sound && G.Sound.isMuted && G.Sound.isMuted()));
    Cine.skipBtn.focus({ preventScroll: true });
    Cine.raf = requestAnimationFrame(frame);
  }

  function finish() {
    if (!Cine.running) return;
    Cine.running = false;
    cancelAnimationFrame(Cine.raf);
    Audio.close();
    if (G.Sound && Cine.beepWas) G.Sound.beep = Cine.beepWas;
    document.removeEventListener('keydown', onKey, true);
    var root = Cine.root;
    root.classList.add('closing');
    setTimeout(function () { root.remove(); }, 450);
    document.documentElement.classList.remove('cine-open');
    Cine.groups = []; Cine.shots = null; Cine.bolts = []; Cine.sparks = [];
    var btn = document.getElementById('cinematicBtn');
    if (btn) btn.focus({ preventScroll: true });
  }

  function init() {
    var btn = document.getElementById('cinematicBtn');
    if (btn) btn.addEventListener('click', function () { play(0); });
    var forced = location.search.match(/[?&]cinematic(?:=(\d+(?:\.\d+)?))?(?:&|$)/);
    if (forced) {
      play(forced[1] || 0);
      // ?cinematic=N&hold=M: run from beat N and freeze the picture at beat M (for checking a single frame)
      var hold = location.search.match(/[?&]hold=(\d+(?:\.\d+)?)/);
      if (hold) setTimeout(function () { Cine.hold = timeOfBeat(+hold[1]); setSound(false); }, Math.max(0, (timeOfBeat(+hold[1]) - timeOfBeat(+forced[1] || 0)) * 1000));
      return;
    }
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // First visit only, straight onto the menu (not into an invite link), and not for people who asked for less motion.
    if (!G.Store.get(STORE_SEEN, 0) && !reduced && !(App.busy && App.busy())) play(0);
  }

  window.TetrisCinematic = { play: play, skip: finish, playing: function () { return Cine.running; }, CUES: CUES };
  if (/[?&]cinematic/.test(location.search)) window.TetrisCinematic.state = function () { return Cine; };   // testing aid
  init();
})();
