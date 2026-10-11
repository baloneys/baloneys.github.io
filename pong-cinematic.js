// pong-cinematic.js: the Pong opening cinematic (60 seconds), rendered live in the page.
//
// After Sean's Pong direction: the same dark warehouse and painted cabinet as the Tetris opening, then a ball that
// leads the camera through real Pong courts: low across a court lying flat, a rally that speeds up with a new angle
// on every hit, the point (a close-up of the ball going out, then a cut to the board and POINT SCORED), a pull back
// through the score, an arena of courts with balls flying from one to the next and landing explosively, match point
// in slow motion and an elimination, the results, achievements, profile, chat, friends and invite, the real mode
// and skull panels, a frantic final rally cut on every beat, then everything breaks apart into the live menu.
//
// It runs on the Tetris opening's engine (tetris-cinematic.js): the same CSS-3D camera rig, ray-cast background
// shader (warehouse, hex world), VHS layer, panels and menu hand-over, copied here so each page stays
// self-contained. What is Pong's own: the courts are Pong's renderer and ball physics (PongApp.cinematicKit), with
// the court's ball hidden and redrawn on top as the site's ball icon with a Terraria-style pixel flame trail.
//
// Music: Balcade_Pong_60s_Master.mp3 (Space Adventure by MintoDog, CC0, with Sean's synthesised effects; drop at
// 12.0 s, 140 BPM). At its end the menu loop (pong-menu-music.js) is cued on the same audio clock, so it's gapless.
//
// Playback: once per browser (games_pong_cinematic_seen), then from the menu's "Watch cinematic" button. Skip
// button, Esc or Enter skip it. Testing aids: ?cinematic=SECONDS plays from there; &hold=SECONDS freezes the clock.
//
// API (window.PongCinematic): play(fromSeconds), skip(), playing(), CUES
(function () {
  'use strict';

  var G = window.Games;
  var App = window.PongApp;
  if (!G || !App || !App.cinematicKit) return;
  var K = App.cinematicKit();
  var ACH = window.PongAchievements;
  var STORE_SEEN = 'pong_cinematic_seen';
  var D2R = Math.PI / 180;

  /* =================================================================
     Cue sheet
     ================================================================= */

  // Timed to Balcade_Pong_Cue_Sheet: the track already carries the effects, so the synthesised ones stay off.
  var CUES = {
    track: 'Balcade_Pong_60s_Master.mp3',
    credit: 'Music: "Space Adventure" by MintoDog (CC0), edited',
    trackHasSfx: true,
    bpm: 140,
    offset: 12.0,        // cinematic seconds of beat 0 (the drop)
    end: 60,
    volume: 0.9,
    sfx: 0.5,
    segments: [{ t0: 0, t1: 60, at: 0 }],
    duck: [],
    spark: [1000, 1001], // (Pong has its own pixel-ball moment instead of the Tetris spark)
    shots: [
      { id: 'cabinet', at: 0, nominal: 4 },
      { id: 'logo', at: 4.0, group: 'cabinet' },
      { id: 'subtitle', at: 7.0, group: 'cabinet' },
      { id: 'pixel', at: 9.6, group: 'cabinet' },
      { id: 'serve', at: 12.0 },
      { id: 'rally', at: 18.0, group: 'serve' },
      { id: 'score', at: 24.45, group: 'serve' },
      { id: 'arena', at: 31.0, group: 'serve' },
      { id: 'matchpoint', at: 37.0, group: 'serve' },
      { id: 'results', at: 41.0, nominal: 3.0 },
      { id: 'achievements', at: 42.8, group: 'results', nominal: 1.6 },
      { id: 'profile', at: 44.4, group: 'results', nominal: 1.372 },
      { id: 'chat', at: 45.8, group: 'results', nominal: 2.743 },
      { id: 'friends', at: 47.4, group: 'results', nominal: 2.743 },
      { id: 'modes', at: 49.0, nominal: 2.0 },
      { id: 'skulls', at: 51.0, group: 'modes', nominal: 2.0 },
      { id: 'final', at: 53.0 },
      { id: 'menu', at: 57.0, group: 'final' }
    ]
  };

  var SPB = 60 / CUES.bpm;
  function B(k) { return CUES.offset + k * SPB; }            // beat k -> cinematic seconds
  function beatAt(t) { return (t - CUES.offset) / SPB; }
  function shotStart(s) { return s.at != null ? s.at : B(s.beat); }
  var IMPACT = 58.0;
  // The painted cabinet (shader pattern 3): camera eye height, where the dolly stops, the CRT's centre height.
  var CAB_EYE = 1.24, CAB_STOP = 0.9, CAB_SCREEN_Y = 1.305;

  /* =================================================================
     Small helpers
     ================================================================= */

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function easeIn(t) { t = clamp01(t); return t * t * t; }
  function easeOut(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function span(t, a, b) { return clamp01((t - a) / (b - a)); }
  function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  /* =================================================================
     Background shader: ray-cast with the CSS camera, so it shares the planes' 3D space
     ================================================================= */

  var FRAG = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform vec2 u_res; uniform vec2 u_css; uniform float u_time; uniform float u_pat; uniform float u_level; uniform float u_beat;',
    'uniform float u_flash; uniform float u_env; uniform float u_tear; uniform float u_speed; uniform float u_var; uniform float u_P;',
    'uniform vec3 u_cpos; uniform vec3 u_crot; uniform float u_dist; uniform float u_eye; uniform float u_crt;',
    'float h1(float n){ return fract(sin(n)*43758.5453); }',
    'float h2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
    'float vn(float x){ float i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f); return mix(h1(i),h1(i+1.0),f); }',
    'float hexd(vec2 p){ p=abs(p); return max(dot(p, vec2(0.5,0.8660254)), p.x); }',
    // hex lattice: x = distance to the cell edge (0 at the edge, 0.5 in the middle), yz = cell id
    'vec3 hexc(vec2 uv){ vec2 r=vec2(1.0,1.7320508); vec2 h=r*0.5; vec2 a=mod(uv,r)-h; vec2 b=mod(uv-h,r)-h;',
    '  vec2 g = dot(a,a)<dot(b,b) ? a : b; return vec3(0.5-hexd(g), uv-g); }',
    // The game's world: black-violet, a glowing hex lattice, magenta light, cyan accents, drifting motes.
    'vec3 world(vec3 dir){',
    '  float az=atan(dir.x,-dir.z), el=asin(clamp(-dir.y,-1.0,1.0));',
    '  vec3 c=mix(vec3(0.012,0.0,0.03), vec3(0.07,0.0,0.11), smoothstep(-0.7,0.8,el));',
    '  vec2 uv=vec2(az,el)*3.4+vec2(0.0,u_time*0.03);',
    '  vec3 hx=hexc(uv);',
    '  float edge=smoothstep(0.05,0.0,hx.x);',
    '  float wave=0.5+0.5*sin(length(hx.yz)*0.7-u_time*1.3);',
    '  float cell=h2(hx.yz); float pulse=pow(0.5+0.5*sin(u_time*(1.0+cell*2.0)+cell*30.0),10.0);',
    '  c+=vec3(0.45,0.08,0.95)*edge*(0.12+0.45*wave*wave+u_level*0.55);',
    '  c+=vec3(1.0,0.15,0.62)*edge*pulse*(0.5+u_beat*0.6);',
    '  c+=vec3(0.45,0.08,0.95)*smoothstep(0.5,0.25,hx.x)*pulse*0.12;',
    '  c+=vec3(0.1,0.85,1.0)*smoothstep(0.03,0.0,abs(hx.x-0.2))*step(0.93,cell)*(0.4+0.6*wave)*0.6;',
    '  float ca=cos(u_time*0.05+u_var), sa=sin(u_time*0.05+u_var); vec2 q=vec2(az,el)*0.9; q=vec2(q.x*ca-q.y*sa, q.x*sa+q.y*ca);',
    '  vec3 big=hexc(q); c+=vec3(0.55,0.1,1.0)*smoothstep(0.015,0.0,abs(big.x-0.04))*0.35;',
    '  c+=vec3(0.6,0.0,0.35)*exp(-length(vec2(az-0.9-u_var,el-0.15))*2.2)*(0.35+u_level*0.4);',
    '  c+=vec3(0.0,0.35,0.55)*exp(-length(vec2(az+1.3+u_var,el+0.2))*2.6)*0.25;',
    '  vec2 m=vec2(az,el)*60.0+vec2(u_time*0.6,u_time*1.1); float mo=step(0.996,h2(floor(m)));',
    '  c+=vec3(0.9,0.6,1.0)*mo*(0.5+0.5*sin(u_time*3.0+h2(floor(m))*40.0));',
    '  return c; }',
    // The road: dark mountains, hex towers and lights over a glowing grid floor (the road runs along x = 0).
    'vec3 road(vec3 dir){',
    '  float az=atan(dir.x,-dir.z), el=asin(clamp(-dir.y,-1.0,1.0));',
    '  if (dir.y>0.0005){',
    '    float t=(0.0-u_cpos.y)/dir.y; vec3 p=u_cpos+dir*t;',
    '    vec2 g=abs(fract(p.xz/220.0)-0.5); float gl=smoothstep(0.47,0.5,max(g.x,g.y));',
    '    float fade=exp(-t/9000.0);',
    '    vec3 c=vec3(0.02,0.0,0.04)+vec3(0.55,0.08,1.0)*gl*fade*(0.55+u_level*0.7);',
    '    float rd=abs(p.x); float onroad=step(rd,380.0);',
    '    c=mix(c, vec3(0.025,0.0,0.05)+vec3(0.3,0.05,0.6)*gl*fade*0.4, onroad);',
    '    c+=vec3(1.0,0.2,0.7)*smoothstep(14.0,0.0,abs(rd-380.0))*fade*1.2;',
    '    c+=vec3(0.2,0.9,1.0)*smoothstep(10.0,0.0,rd)*step(0.5,fract(p.z/520.0))*fade*0.9;',
    '    c+=vec3(0.6,0.1,0.9)*exp(-t/2500.0)*0.08;',
    '    return c+vec3(0.5,0.05,0.4)*smoothstep(0.08,0.0,-el)*0.5; }',
    '  vec3 c=world(dir)*0.55;',
    '  float ridge=0.05+0.07*vn(az*4.0)+0.04*vn(az*11.0+3.0);',
    '  c=mix(c, vec3(0.018,0.0,0.035), step(el,ridge));',
    '  c+=vec3(1.0,0.2,0.75)*smoothstep(0.006,0.0,abs(el-ridge))*0.8;',
    '  for (int i=0;i<4;i++){ float fi=float(i); float ta=-1.2+fi*0.8+0.2*sin(fi*3.0); vec2 d=vec2(az-ta, el-0.16-0.05*fi);',
    '    float r=hexd(d/(0.07+0.02*fi)); c+=vec3(0.55,0.1,1.0)*smoothstep(0.08,0.0,abs(r-1.0))*0.9;',
    '    c+=vec3(1.0,0.2,0.6)*smoothstep(0.05,0.0,abs(r-0.55))*0.4*(0.5+0.5*sin(u_time*2.0+fi)); }',
    '  float lx=floor(az*90.0); c+=vec3(1.0,0.5,0.9)*step(0.85,h1(lx))*smoothstep(0.004,0.0,abs(el-0.012-0.01*h1(lx+3.0)))*(0.6+0.4*sin(u_time*4.0+lx));',
    '  c+=vec3(0.6,0.05,0.5)*exp(-abs(el)*30.0)*0.6;',
    '  return c; }',
    // ---- Scene 1: the arcade cabinet, painted flat in a dark warehouse ----
    // A head-on camera at eye height u_eye, u_dist from the cabinet's front. Each layer is a flat card at its own
    // depth (world = s * 2 tan(fov/2) * depth), so the dolly gets real parallax from flat cards alone.
    // World units are roughly metres: y up, floor at 0, the cabinet centred on x = 0.
    'float sdBox(vec2 p, vec2 c, vec2 h){ vec2 d=abs(p-c)-h; return length(max(d,0.0))+min(max(d.x,d.y),0.0); }',
    'float fillB(vec2 p, vec2 lo, vec2 hi){ vec2 a=step(lo,p)*step(p,hi); return a.x*a.y; }',
    'float bit(float n, float k){ return mod(floor(n/pow(2.0,k)),2.0); }',
    // a crate (kind 0, wooden) or a cardboard box (kind 1)
    'vec3 crate(vec2 p, vec2 lo, vec2 hi, float kind, float lit, vec3 c){',
    '  if (fillB(p,lo,hi)<0.5) return c;',
    '  vec2 sz=hi-lo; vec2 q=(p-lo)/sz; float edge=min(min(q.x,1.0-q.x)*sz.x, min(q.y,1.0-q.y)*sz.y);',
    '  vec3 col;',
    '  if (kind<0.5){ col=vec3(0.075,0.04,0.05);',
    '    float plank=smoothstep(0.006,0.0,abs(fract(q.y*sz.y/0.11)-0.5)-0.46); col*=1.0-plank*0.45;',
    '    float brace=smoothstep(0.03,0.0,abs((q.x-0.5)*sz.x-(q.y-0.5)*sz.y)); col=mix(col,vec3(0.1,0.055,0.065),brace*step(0.04,edge));',
    '    col=mix(vec3(0.11,0.06,0.07),col,step(0.04,edge));',
    '  } else { col=vec3(0.085,0.06,0.065);',
    '    col=mix(col,vec3(0.13,0.11,0.12),smoothstep(0.004,0.0,abs(q.x-0.5)*sz.x-0.025));',
    '    col=mix(col,vec3(0.05,0.035,0.045),smoothstep(0.006,0.0,abs(q.y-0.8)*sz.y));',
    '    col*=1.0-0.35*step(edge,0.008); }',
    '  col*=lit*(0.75+0.35*q.y);',
    '  col+=vec3(0.55,0.08,0.45)*smoothstep(0.014,0.0,edge)*lit*0.35;',
    '  return col; }',
    // ---- the cabinet: a classic upright, head-on ----
    // Side panels with glowing T-moulding stand proud of a recessed front: a backlit marquee with BALCADE in pixel
    // letters, a speaker bar, a black glass bezel with pinstripes and tetromino corner decals round a curved 4:3 CRT,
    // a wide control deck (art overlay, ball-top joystick, six buttons in a fighting-game arc, start buttons), a coin
    // door with two lit coin slots and returns, and a kick plate on levelling feet.
    'float cover(float sd, float aa){ return clamp(0.5-sd/aa, 0.0, 1.0); }',
    'vec2 glyph(float i){',
    '  if (i<0.5) return vec2(1001022.0,17982.0); if (i<1.5) return vec2(476735.0,17969.0); if (i<2.5) return vec2(541200.0,16927.0);',
    '  if (i<3.5) return vec2(508432.0,16911.0); if (i<4.5) return vec2(476735.0,17969.0); if (i<5.5) return vec2(1001009.0,17982.0);',
    '  return vec2(1032734.0,16927.0); }',
    // 1 where BALCADE has a lit pixel at marquee cell g (x 0..40, y 0..6 from the top)
    'float marqueeText(vec2 g){',
    '  if (g.x<0.0||g.x>40.5||g.y<0.0||g.y>6.5) return 0.0;',
    '  float li=floor(g.x/6.0), cx=mod(g.x,6.0); if (cx>4.5) return 0.0;',
    '  vec2 gl=glyph(li); float r=g.y;',
    '  return r<3.5 ? bit(gl.x,(3.0-r)*5.0+(4.0-cx)) : bit(gl.y,(6.0-r)*5.0+(4.0-cx)); }',
    'vec3 cabinet(vec2 p, float aa, vec3 c, out float sil){',
    '  float side=max(cover(sdBox(p,vec2(-0.37,0.94),vec2(0.02,0.94)),aa), cover(sdBox(p,vec2(0.37,0.94),vec2(0.02,0.94)),aa));',
    '  float front=cover(sdBox(p,vec2(0.0,0.94),vec2(0.35,0.92)),aa);',
    '  float deckS=sdBox(p,vec2(0.0,0.965),vec2(0.405,0.085))-0.008, deck=cover(deckS,aa);',
    '  sil=max(max(side,front),deck);',
    '  if (sil<0.001) return c;',
    '  float topL=0.55+0.55*smoothstep(0.2,1.9,p.y);',   // the overhead lamp lights the top more
    '  vec3 k=vec3(0.03,0.014,0.055)*topL;',
    // recessed front: speaker bar, bezel and CRT, lower front, coin door, kick plate
    '  if (p.y>1.62){',  // marquee light box
    '    vec2 m=(p-vec2(0.0,1.74))/vec2(0.33,0.095);',
    '    if (abs(m.x)<1.0&&abs(m.y)<1.0){',
    '      vec3 mb=mix(vec3(0.1,0.02,0.2),vec3(0.36,0.05,0.4),0.5+0.5*m.y);',
    '      vec3 hx=hexc(p*60.0); mb+=vec3(0.5,0.15,0.8)*smoothstep(0.06,0.0,hx.x)*0.12;',
    '      mb+=vec3(1.0,0.5,0.9)*exp(-abs(m.y)*3.0)*0.12;',
    '      vec2 g=vec2((p.x+0.297)/0.0145, (1.791-p.y)/0.0145); vec2 gi=floor(g), gf=fract(g);',
    '      float tx=marqueeText(gi)*step(0.1,gf.x)*step(0.1,gf.y);',
    '      float sh=marqueeText(floor(g-vec2(0.35,-0.35)));',
    '      mb=mix(mb, vec3(0.1,0.85,1.0)*0.9, sh*0.7);',
    '      mb=mix(mb, mix(vec3(1.0,0.45,0.85),vec3(1.0,0.9,1.0),step(gf.y,0.35)), tx);',
    '      mb+=vec3(1.0)*smoothstep(0.08,0.0,abs(m.x*0.5+m.y*0.3-0.2))*0.05;',   // glass sheen
    '      k=mb*(0.9+0.1*sin(u_time*7.0)*0.3);',
    '    } else k=vec3(0.02,0.008,0.035)*topL; }',
    '  else if (p.y>1.56){',  // speaker bar
    '    k=vec3(0.018,0.008,0.03);',
    '    float gr=max(cover(sdBox(p,vec2(-0.2,1.59),vec2(0.1,0.017)),aa),cover(sdBox(p,vec2(0.2,1.59),vec2(0.1,0.017)),aa));',
    '    vec2 hole=fract(p*vec2(140.0,140.0))-0.5; k=mix(k, vec3(0.002), gr*step(length(hole),0.3));',
    '    k=mix(k, vec3(0.06,0.03,0.1), gr*(1.0-step(length(hole),0.3))*0.6); }',
    '  else if (p.y>1.05){',  // bezel and the CRT
    '    vec2 sc=p-vec2(0.0,1.305);',
    '    k=mix(vec3(0.012,0.006,0.022),vec3(0.03,0.012,0.05),smoothstep(1.05,1.56,p.y));',
    '    float stripe1=abs(sdBox(sc,vec2(0.0),vec2(0.29,0.215))), stripe2=abs(sdBox(sc,vec2(0.0),vec2(0.275,0.2)));',
    '    k+=vec3(1.0,0.2,0.65)*cover(stripe1-0.003,aa)*0.8+vec3(0.15,0.85,1.0)*cover(stripe2-0.002,aa)*0.6;',
    '    for (int i=0;i<4;i++){ vec2 cn=vec2(i==0||i==3?-0.31:0.31, i<2?1.51:1.1); vec2 q=(p-cn)/0.012; vec2 qi=floor(q+2.0);',
    '      float tet=(i<2? (qi.y==2.0&&qi.x>=0.0&&qi.x<=2.0)||(qi.y==1.0&&qi.x==1.0) : (qi.y==1.0&&qi.x>=0.0&&qi.x<=2.0)||(qi.y==2.0&&qi.x==2.0)) ? 1.0 : 0.0;',
    '      vec3 tc=i==0?vec3(1.0,0.25,0.7):i==1?vec3(0.2,0.85,1.0):i==2?vec3(0.75,0.4,1.0):vec3(1.0,0.4,0.6);',
    '      k=mix(k, tc*(0.7+0.4*step(fract(q.y+2.0),0.3)), tet*step(0.08,fract(q.x+2.0))*step(0.08,fract(q.y+2.0))); }',
    '    float scd=sdBox(sc,vec2(0.0),vec2(0.22,0.165))-0.03;',
    '    k=mix(k, vec3(0.0), cover(scd-0.014,aa));',   // the dark tube surround
    '    if (scd<0.0){ vec2 uv=sc/vec2(0.25,0.195); uv*=1.0+0.1*dot(uv,uv);',
    '      vec3 sv=vec3(0.02,0.008,0.045)+vec3(0.3,0.1,0.6)*exp(-dot(uv,uv)*1.6)*(0.18+0.42*u_crt);',
    // attract mode: the cabinet plays Pong by itself on a chunky 48 x 36 grid (the ball bounces off the walls on two
    // triangle waves; each paddle chases it, a touch late), until the title takes over the tube (u_crt)
    '      vec2 pg=(floor((uv*0.5+0.5)*vec2(48.0,36.0))+0.5)/vec2(48.0,36.0)*2.0-1.0; float T=u_time;',
    '      float bx=(abs(fract(T*0.42)*2.0-1.0)*2.0-1.0)*0.84, by=(abs(fract(T*0.31+0.27)*2.0-1.0)*2.0-1.0)*0.82;',
    '      float lag=(abs(fract((T-0.18)*0.31+0.27)*2.0-1.0)*2.0-1.0)*0.82;',
    '      float ly=clamp(mix(lag*0.6,by,smoothstep(0.2,-0.84,bx)),-0.72,0.72), ry=clamp(mix(lag*0.6,by,smoothstep(-0.2,0.84,bx)),-0.72,0.72);',
    '      float png=step(abs(pg.x-bx),0.03)*step(abs(pg.y-by),0.045)+step(abs(pg.x+0.9),0.03)*step(abs(pg.y-ly),0.17)+step(abs(pg.x-0.9),0.03)*step(abs(pg.y-ry),0.17);',
    '      float net=step(abs(pg.x),0.025)*step(0.5,fract(pg.y*6.0));',
    '      sv+=(vec3(0.85,0.95,1.0)*clamp(png,0.0,1.0)*0.8+vec3(0.5,0.25,0.9)*net*0.35)*(1.0-u_crt);',
    '      sv*=0.72+0.28*step(0.5,fract((p.y-1.0)*480.0));',
    '      sv*=1.0-0.55*smoothstep(0.75,1.05,max(abs(uv.x),abs(uv.y)));',   // vignette into the tube edge
    '      sv+=vec3(1.0)*smoothstep(0.12,0.0,abs(uv.x*0.7+uv.y-0.75))*0.06+vec3(1.0)*smoothstep(0.05,0.0,abs(uv.x*0.7+uv.y-0.95))*0.04;',   // glass reflections
    '      k=mix(k, sv, cover(scd,aa)); } }',
    '  else if (p.y>0.08){',  // lower front and coin door
    '    k=vec3(0.026,0.012,0.045)*(0.75+0.35*p.y)+vec3(0.5,0.08,0.4)*u_crt*0.05*smoothstep(0.88,0.6,p.y);',
    '    float dr=sdBox(p,vec2(0.0,0.56),vec2(0.13,0.17))-0.01;',
    '    k=mix(k, mix(vec3(0.06,0.045,0.085),vec3(0.035,0.025,0.05),smoothstep(0.75,0.4,p.y)), cover(dr,aa));',
    '    k+=vec3(0.35,0.3,0.45)*cover(abs(dr)-0.002,aa)*0.5;',
    '    for (int i=0;i<2;i++){ float sx=i==0?-0.055:0.055;',
    '      float ins=sdBox(p,vec2(sx,0.63),vec2(0.032,0.05))-0.006; k=mix(k, vec3(0.12,0.03,0.05), cover(ins,aa));',
    '      float sl=sdBox(p,vec2(sx,0.64),vec2(0.0045,0.03)); k=mix(k, vec3(1.0,0.35,0.2), cover(sl,aa)); k+=vec3(1.0,0.25,0.3)*exp(-max(sl,0.0)*120.0)*0.3*cover(ins,aa);',
    '      float rt=sdBox(p,vec2(sx,0.52),vec2(0.02,0.016))-0.003; k=mix(k, vec3(0.55,0.5,0.62), cover(rt,aa)); k=mix(k, vec3(0.1,0.08,0.12), cover(sdBox(p,vec2(sx,0.52),vec2(0.012,0.004)),aa)); }',
    '    k=mix(k, vec3(0.5,0.45,0.55), cover(length(p-vec2(0.0,0.43))-0.008,aa)); k=mix(k, vec3(0.05), cover(sdBox(p,vec2(0.0,0.43),vec2(0.001,0.005)),aa));',
    '    float tag=sdBox(p,vec2(0.0,0.75),vec2(0.09,0.012)); k+=vec3(1.0,0.3,0.6)*cover(tag,aa)*0.35*(0.6+0.4*step(0.5,fract(u_time*1.2)));',   // INSERT COIN strip
    '  } else {',
    '    k=vec3(0.006,0.003,0.012);',
    '    k=mix(k, vec3(0.12,0.11,0.14), max(cover(sdBox(p,vec2(-0.3,0.012),vec2(0.03,0.012)),aa),cover(sdBox(p,vec2(0.3,0.012),vec2(0.03,0.012)),aa))); }',
    // side panels: glossy black edge with the T-moulding glowing on its face
    '  if (side>0.001){ vec3 sp=vec3(0.02,0.008,0.035)*topL; float ax=abs(abs(p.x)-0.37);',
    '    sp+=vec3(1.0,0.18,0.65)*(cover(ax-0.006,aa)*0.85+exp(-ax*120.0)*0.25)*(0.8+0.2*sin(u_time*2.0+p.y*3.0));',
    '    sp+=vec3(1.0)*cover(abs(ax-0.002)-0.0015,aa)*0.25;',
    '    k=mix(k, sp, side); }',
    // the control deck sits in front of everything
    '  if (deck>0.001){',
    '    vec3 dk;',
    '    if (p.y>0.95){ float tq=(p.y-0.95)/0.1;',   // the top surface, seen from just above
    '      dk=mix(vec3(0.05,0.02,0.09),vec3(0.12,0.045,0.18),tq)*topL+vec3(0.4,0.15,0.6)*u_crt*0.18*tq;',
    '      float st=step(0.5,fract((p.x+p.y)*16.0)); dk=mix(dk, dk*vec3(1.4,0.8,1.5), st*0.25*step(abs(p.x),0.39));',
    '      dk+=vec3(1.0,0.2,0.65)*cover(abs(p.y-1.048)-0.002,aa)*0.6;',
    '    } else {',   // the front lip with a chrome strip and a neon line
    '      dk=vec3(0.015,0.006,0.028);',
    '      dk=mix(dk, vec3(0.45,0.42,0.55)*(0.6+0.4*smoothstep(0.9,0.94,p.y)), cover(abs(p.y-0.938)-0.008,aa));',
    '      dk+=vec3(0.15,0.85,1.0)*cover(abs(p.y-0.905)-0.0018,aa)*0.8; }',
    // joystick: dust washer, shaft, ball top
    '    vec2 jw=(p-vec2(-0.22,0.99))*vec2(1.0,2.4); dk=mix(dk, vec3(0.01), cover(length(jw)-0.05,aa));',
    // six buttons in an arc, two rows of three
    '    for (int i=0;i<6;i++){ float fi=float(i); float col3=mod(fi,3.0); float row=fi<2.5?0.0:1.0;',
    '      vec2 bc=vec2(-0.04+col3*0.085, 1.012-row*0.042+col3*0.008-col3*col3*0.004);',
    '      vec2 d=(p-bc)*vec2(1.0,2.2); float rr=length(d);',
    '      vec3 bcol=col3<0.5?vec3(0.15,0.85,1.0):col3<1.5?vec3(1.0,0.2,0.65):vec3(0.7,0.3,1.0);',
    '      dk=mix(dk, vec3(0.02), cover(rr-0.031,aa));',
    '      dk=mix(dk, bcol*(0.55+0.5*smoothstep(0.026,0.0,rr)), cover(rr-0.025,aa));',
    '      dk+=vec3(1.0)*cover(length(d-vec2(-0.008,0.009))-0.006,aa)*0.6; dk+=bcol*exp(-rr*45.0)*0.2; }',
    // 1P and 2P start buttons
    '    for (int i=0;i<2;i++){ vec2 d=(p-vec2(0.27+float(i)*0.06,1.028))*vec2(1.0,2.2); dk=mix(dk, vec3(0.85,0.85,0.95), cover(length(d)-0.013,aa)); dk+=vec3(1.0)*exp(-length(d)*80.0)*0.15; }',
    '    k=mix(k, dk, deck); }',
    // the joystick's shaft and ball top stand up in front of the bezel
    '  float shaft=cover(sdBox(p,vec2(-0.22,1.035),vec2(0.006,0.045)),aa);',
    '  k=mix(k, mix(vec3(0.08,0.07,0.1),vec3(0.3,0.28,0.35),cover(abs(p.x+0.222)-0.002,aa)), shaft);',
    '  vec2 bl=p-vec2(-0.22,1.085); float br=length(bl), ballC=cover(br-0.032,aa);',
    '  vec3 ball=vec3(1.0,0.16,0.55)*(0.3+0.8*clamp(dot(normalize(vec3(bl,0.025)),normalize(vec3(-0.45,0.65,0.6))),0.0,1.0));',
    '  k=mix(k, ball, ballC); k+=vec3(1.0)*cover(length(bl-vec2(-0.01,0.012))-0.007,aa)*0.75*ballC;',
    '  sil=max(sil, max(shaft, ballC));',
    // a little lamplight rim along the top edge
    '  k+=vec3(0.6,0.35,0.9)*cover(abs(p.y-1.875)-0.003,aa)*step(abs(p.x),0.39)*0.5;',
    '  return mix(c, k, sil); }',
    'vec3 warehouse(vec2 s){',
    '  float T=0.36397, D=u_dist, E=u_eye; vec3 c;',
    '  float zw=D+3.2; vec2 w=s*2.0*T*zw+vec2(0.0,E);',
    // the floor, or the back wall
    '  if (w.y<0.0){ float zf=E/max(0.0001,-s.y*2.0*T); vec2 f=vec2(s.x*2.0*T*zf, zf-D);',
    '    vec2 tg=abs(fract(f*1.25)-0.5); float seam=smoothstep(0.48,0.5,max(tg.x,tg.y));',
    '    c=vec3(0.022,0.016,0.03)*(1.0-seam*0.4)+vec3(0.012,0.008,0.016)*fract(sin(dot(floor(f*12.0),vec2(12.9,78.2)))*437.5);',
    '    c+=vec3(0.32,0.12,0.6)*exp(-length((f-vec2(0.0,0.25))*vec2(1.2,1.8))*1.6)*0.35;',
    '    float refl=exp(-abs(f.x)*5.0)*exp(-abs(f.y+0.35)*2.2)*step(f.y,0.15);',
    '    c+=mix(vec3(0.9,0.15,0.6),vec3(0.2,0.8,1.0),0.5+0.5*sin(f.y*9.0))*refl*(0.08+0.18*u_crt);',
    '    c*=exp(-max(0.0,f.y)*0.15);',
    '  } else {',
    '    float rib=0.5+0.5*sin(w.x*46.0); c=vec3(0.026,0.02,0.042)*(0.75+0.35*rib);',
    '    float door=fillB(w,vec2(-1.35,0.0),vec2(1.35,2.5)); c=mix(c, vec3(0.034,0.027,0.05)*(0.8+0.25*step(0.5,fract(w.y*9.0))), door);',
    '    c=mix(c, vec3(0.07,0.055,0.09), smoothstep(0.015,0.0,abs(sdBox(w,vec2(0.0,1.25),vec2(1.35,1.25)))));',
    '    for (int i=0;i<2;i++){ float py=3.05+float(i)*0.26; float d=abs(w.y-py); c=mix(c, vec3(0.05,0.04,0.07)*(1.4-d*18.0), step(d,0.06)); }',
    '    float win=fillB(vec2(fract(w.x/1.1),w.y),vec2(0.1,3.55),vec2(0.9,3.95)); c+=vec3(0.04,0.05,0.12)*win*(0.6+0.4*fract(sin(floor(w.x/1.1)*7.3)*91.7));',
    '    float ex=sdBox(w,vec2(2.7,2.75),vec2(0.17,0.07)); c+=vec3(0.9,0.05,0.12)*(step(ex,0.0)*0.55+exp(-max(ex,0.0)*14.0)*0.12);',
    '    c*=1.0-0.35*smoothstep(1.0,3.5,abs(w.x));',
    '  }',
    // shelving racks with boxes on them
    '  float zr=D+1.9; vec2 r=s*2.0*T*zr+vec2(0.0,E);',
    '  if (r.y>0.0 && r.y<3.25 && abs(r.x)>1.3 && abs(r.x)<4.6){',
    '    float ax=abs(r.x); float bay=floor((ax-1.3)/1.1); float bx=fract((ax-1.3)/1.1);',
    '    float lvl=floor(r.y/1.05); float ly=fract(r.y/1.05);',
    '    float h=fract(sin(bay*17.1+lvl*5.3+sign(r.x)*3.7)*4375.5);',
    '    c=crate(vec2(bx,ly),vec2(0.1,0.06),vec2(0.9,0.6*h+0.25),step(0.5,h),0.55,c);',
    '    float upr=step(bx,0.04)+step(0.96,bx); float beam=step(ly,0.05);',
    '    c=mix(c, vec3(0.06,0.035,0.1), clamp(upr+beam,0.0,1.0));',
    '  }',
    // the overhead lamp's cone of violet light, with dust drifting in it
    '  vec2 pc=s*2.0*T*(D+0.15)+vec2(0.0,E);',
    '  float cone=smoothstep(0.0,0.08,(0.12+(3.3-pc.y)*0.26)-abs(pc.x))*step(pc.y,3.3)*step(0.0,pc.y);',
    '  vec2 dg=floor(vec2(s.x*420.0,s.y*420.0+u_time*14.0)); float dust=step(0.992,fract(sin(dot(dg,vec2(12.9,78.2)))*43758.5));',
    '  c+=vec3(0.3,0.12,0.55)*cone*(0.05+0.03*sin(u_time*0.7))+vec3(0.7,0.5,1.0)*dust*cone*0.35;',
    '  c=mix(c, vec3(0.03,0.025,0.04), fillB(pc,vec2(-0.16,3.3),vec2(0.16,3.42))); c+=vec3(0.9,0.75,1.0)*fillB(pc,vec2(-0.12,3.28),vec2(0.12,3.31))*0.7;',
    // crates just behind the cabinet, either side
    '  vec2 b=s*2.0*T*(D+0.75)+vec2(0.0,E);',
    '  c=crate(b,vec2(-1.6,0.0),vec2(-0.82,0.74),0.0,0.85,c); c=crate(b,vec2(-1.48,0.74),vec2(-0.95,1.18),1.0,0.85,c);',
    '  c=crate(b,vec2(-2.45,0.0),vec2(-1.7,0.56),1.0,0.7,c); c=crate(b,vec2(-2.3,0.56),vec2(-1.82,0.95),1.0,0.7,c);',
    '  c=crate(b,vec2(0.84,0.0),vec2(1.66,0.78),0.0,0.85,c); c=crate(b,vec2(0.98,0.78),vec2(1.46,1.12),1.0,0.85,c); c=crate(b,vec2(1.72,0.0),vec2(2.5,0.62),0.0,0.7,c);',
    // the cabinet, then the glow it throws into the dark
    '  vec2 p=s*2.0*T*D+vec2(0.0,E); float sil;',
    '  c=cabinet(p, 2.0*T*D/u_css.y*1.5, c, sil);',
    '  c+=vec3(0.5,0.15,0.8)*exp(-length((p-vec2(0.0,1.3))*vec2(1.0,1.3))*3.2)*(0.05+0.1*u_crt)*(1.0-sil);',
    '  c+=vec3(0.9,0.2,0.7)*exp(-length((p-vec2(0.0,1.74))*vec2(0.8,2.5))*4.0)*0.08*(1.0-sil);',
    // foreground crates that slide past the lens during the push in
    '  float zf2=D-1.4;',
    '  if (zf2>0.15){ vec2 q=s*2.0*T*zf2+vec2(0.0,E);',
    '    c=crate(q,vec2(-2.0,0.0),vec2(-1.0,0.9),0.0,0.45,c); c=crate(q,vec2(-1.85,0.9),vec2(-1.15,1.4),1.0,0.45,c);',
    '    c=crate(q,vec2(1.0,0.0),vec2(1.85,0.65),1.0,0.45,c); c=crate(q,vec2(1.15,0.65),vec2(1.7,1.05),1.0,0.4,c); }',
    '  return c*1.35; }',
    'void main(){',
    '  vec2 css=gl_FragCoord.xy/u_res*u_css; css.y=u_css.y-css.y;',
    '  if (u_tear>0.0){ float band=floor(css.y/18.0); float on=step(0.86,h1(band+floor(u_time*24.0)*7.0)); css.x+=on*u_tear*(h1(band*3.1)-0.5)*90.0; }',
    '  vec2 sp=css-0.5*u_css;',
    '  float r=-u_crot.z*0.0174533; sp=vec2(sp.x*cos(r)-sp.y*sin(r), sp.x*sin(r)+sp.y*cos(r));',
    '  vec3 cc=vec3(sp.x, sp.y, -u_P);',
    '  float pa=u_crot.y*0.0174533, ya=u_crot.x*0.0174533;',
    '  float dy=cc.y*cos(pa)+cc.z*sin(pa); float z1=-cc.y*sin(pa)+cc.z*cos(pa);',
    '  vec3 dir=normalize(vec3(cc.x*cos(ya)-z1*sin(ya), dy, cc.x*sin(ya)+z1*cos(ya)));',
    '  vec3 c;',
    '  if (u_pat<0.5) c=world(dir);',
    '  else if (u_pat<1.5) c=road(dir);',
    '  else if (u_pat<2.5) c=vec3(0.0);',
    '  else c=warehouse(vec2(css.x-0.5*u_css.x, 0.5*u_css.y-css.y)/u_css.y);',
    '  if (u_speed>0.01){ vec2 s=sp/u_css.y; float ang=atan(s.y,s.x); float rr=length(s); float id=floor(ang*70.0); float hh=h1(id);',
    '    float st=step(0.82,hh)*smoothstep(0.0,0.5,fract(rr*1.5-u_time*(3.0+hh*4.0)+hh))*smoothstep(0.08,0.5,rr);',
    '    c+=mix(vec3(0.6,0.2,1.0),vec3(1.0,0.4,0.8),hh)*st*u_speed*0.8; }',
    '  c*=u_env;',
    '  c+=vec3(1.0,0.92,1.0)*u_flash;',
    '  c*=1.0+u_beat*0.1;',
    '  vec2 v=gl_FragCoord.xy/u_res-0.5; c*=1.0-dot(v,v)*1.1;',
    '  c+=(h2(gl_FragCoord.xy+fract(u_time*7.0)*100.0)-0.5)*0.05;',
    '  gl_FragColor=vec4(max(c,0.0),1.0);',
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
      ['u_res', 'u_css', 'u_time', 'u_pat', 'u_level', 'u_beat', 'u_flash', 'u_env', 'u_tear', 'u_speed', 'u_var', 'u_P', 'u_cpos', 'u_crot', 'u_dist', 'u_eye', 'u_crt']
        .forEach(function (n) { self.u[n] = gl.getUniformLocation(prog, n); });
      this.gl = gl;
    },
    // A third of the CSS size (at most 720 across), scaled up: chunky, cheap, and right for the VHS look.
    draw: function (s) {
      var gl = this.gl, u = this.u, cv = this.canvas;
      if (!gl) return;
      var cw = cv.clientWidth || 640, ch = cv.clientHeight || 360;
      // the warehouse (pattern 3) renders sharper, so the cabinet's detail holds up
      var w = Math.round(Math.max(Math.min(cw, 180), (s.pat > 2.5 ? Math.min(1280, cw / 1.5) : Math.min(720, cw / 3)) * [1, 0.7, 0.5][Q.level])), h = Math.round(w * ch / cw);   // (never below 180 across, or a portrait phone gets mush)
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(u.u_res, w, h);
      gl.uniform2f(u.u_css, cw, ch);
      gl.uniform1f(u.u_time, s.time);
      gl.uniform1f(u.u_pat, s.pat);
      gl.uniform1f(u.u_level, s.level);
      gl.uniform1f(u.u_beat, s.beat);
      gl.uniform1f(u.u_flash, s.flash);
      gl.uniform1f(u.u_env, s.env);
      gl.uniform1f(u.u_tear, s.tear);
      gl.uniform1f(u.u_speed, s.speed);
      gl.uniform1f(u.u_var, s.variant);
      gl.uniform1f(u.u_P, s.P);
      gl.uniform3f(u.u_cpos, s.cam.x, s.cam.y, s.cam.z);
      gl.uniform3f(u.u_crot, s.cam.yaw, s.cam.pitch, s.cam.roll);
      gl.uniform1f(u.u_dist, s.dist || 1); gl.uniform1f(u.u_eye, s.eye || 1.2); gl.uniform1f(u.u_crt, s.crt || 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  };

  /* =================================================================
     Audio: the cut track (decoded, played as spliced segments) plus synthesised effects for the game's moments
     ================================================================= */

  var Audio = {
    ctx: null, master: null, music: null, sfxBus: null, analyser: null, bins: null, noise: null,
    buffer: null, sources: [], on: false, startCtx: 0, startT: 0, next: 0, events: [],

    init: function () {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || this.ctx) return;
      // Share the menu music's AudioContext, so the menu loop can be cued on the same clock for a gapless hand-over.
      var shared = window.PongMenuMusic && window.PongMenuMusic.context();
      this.shared = !!shared;
      try { this.ctx = shared || new AC(); } catch (e) { return; }
      var ctx = this.ctx, self = this;
      this.master = ctx.createGain();
      this.music = ctx.createGain(); this.music.gain.value = CUES.volume;
      this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = CUES.sfx;
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 256; this.analyser.smoothingTimeConstant = 0.5;
      this.bins = new Uint8Array(this.analyser.frequencyBinCount);
      var comp = ctx.createDynamicsCompressor();
      this.music.connect(this.analyser); this.analyser.connect(this.master);
      this.sfxBus.connect(this.master);
      this.master.connect(comp); comp.connect(ctx.destination);
      var len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.events = CUES.trackHasSfx ? [] : sfxScore();
      if (CUES.track) {
        fetch(CUES.track).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
          .then(function (ab) { return new Promise(function (ok, no) { ctx.decodeAudioData(ab, ok, no); }); })
          .then(function (b) { if (self.ctx !== ctx) return; self.buffer = b; if (self.on) self.start(Cine.t); })
          .catch(function (e) { console.warn('[tetris-cinematic] track', e); });
      }
    },

    // Start (or restart after a seek / unmute) at cinematic time t. Returns false while the browser blocks audio.
    start: function (t) {
      if (!this.ctx) return false;
      var self = this, ctx = this.ctx;
      if (ctx.state === 'suspended') ctx.resume();
      this.stopSources();
      this.on = true;
      this.startCtx = ctx.currentTime + 0.05;
      this.startT = t;
      this.next = 0;
      while (this.next < this.events.length && this.events[this.next].t < t - 0.02) this.next++;
      if (this.buffer) {
        var now = this.startCtx;
        CUES.segments.forEach(function (sg) {
          if (t >= sg.t1) return;
          var from = Math.max(t, sg.t0), when = now + (from - t), offset = sg.at + (from - sg.t0);
          var src = ctx.createBufferSource(), g = ctx.createGain(), xf = 0.03;
          src.buffer = self.buffer;
          src.connect(g); g.connect(self.music);
          g.gain.setValueAtTime(0, when);
          g.gain.linearRampToValueAtTime(1, when + (sg.fadeIn && from < sg.fadeIn ? sg.fadeIn - from : xf));
          var stopAt = now + (sg.t1 - t) + xf;
          if (sg.fadeOut) {
            var a = now + (sg.fadeOut[0] - t), b2 = now + (sg.fadeOut[1] - t);
            if (a > when + xf) g.gain.setValueAtTime(1, a);
            g.gain.linearRampToValueAtTime(0.0001, Math.max(when + 0.1, b2));
            stopAt = Math.min(stopAt, Math.max(when + 0.1, b2) + 0.1);
          } else {
            g.gain.setValueAtTime(1, Math.max(when + xf, stopAt - xf * 2));
            g.gain.linearRampToValueAtTime(0, stopAt);
          }
          src.start(when, offset);
          src.stop(Math.max(when + 0.05, stopAt));
          self.sources.push(src);
        });
        var mg = this.music.gain;
        mg.cancelScheduledValues(0);
        mg.setValueAtTime(CUES.volume * duckAt(t), now);
        CUES.duck.forEach(function (d) { if (d[0] > t) mg.linearRampToValueAtTime(CUES.volume * d[1], now + d[0] - t); });
        // the menu loop picks up exactly where the cinematic's track ends
        if (window.PongMenuMusic && t < CUES.end) window.PongMenuMusic.cue(now + (CUES.end - t));
      }
      return ctx.state === 'running';
    },

    stopSources: function () {
      this.sources.forEach(function (s) { try { s.stop(); } catch (e) { /* already stopped */ } });
      this.sources = [];
    },

    stop: function (fade, keepCue) {
      this.on = false;
      if (!keepCue && window.PongMenuMusic) window.PongMenuMusic.cancelCue();
      if (!this.ctx) return;
      var g = this.master.gain, now = this.ctx.currentTime, self = this;
      g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + (fade || 0.25));
      setTimeout(function () { if (!self.on) { self.stopSources(); g.cancelScheduledValues(0); g.value = 1; } }, (fade || 0.25) * 1000 + 50);
    },

    close: function (fade, keepCue) {
      var ctx = this.ctx, master = this.master, shared = this.shared;
      if (!ctx) return;
      this.stop(fade, keepCue);
      this.ctx = null; this.buffer = null;
      // a shared context belongs to the menu music: just let go of our nodes
      setTimeout(function () {
        if (shared) { try { master.disconnect(); } catch (e) { /* already gone */ } }
        else { try { ctx.close(); } catch (e) { /* already closed */ } }
      }, (fade || 0.25) * 1000 + 300);
    },

    // The audio clock drives the pictures while the music plays.
    clock: function () {
      if (!this.on || !this.ctx || this.ctx.state !== 'running' || !this.buffer) return null;
      return this.startT + Math.max(0, this.ctx.currentTime - this.startCtx);
    },

    // Schedule effects due in the next 150 ms.
    pump: function (t) {
      if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
      while (this.next < this.events.length) {
        var e = this.events[this.next];
        if (e.t > t + 0.15) break;
        this.next++;
        if (e.t < t - 0.05) continue;
        try { e.f(this, this.ctx.currentTime + Math.max(0, e.t - t)); } catch (err) { /* a dropped effect never stops the film */ }
      }
    },

    measure: function () {
      if (!this.analyser || !this.on || !this.buffer) return null;
      this.analyser.getByteFrequencyData(this.bins);
      var s = 0;
      for (var i = 1; i < 10; i++) s += this.bins[i];
      return s / (9 * 255);
    },

    // ---- effect voices ----
    out: function (node, t, vol, a, d) {
      var g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + (a || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t + (a || 0.004) + d);
      node.connect(g); g.connect(this.sfxBus);
      return g;
    },
    osc: function (type, f, t, dur) { var o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + dur + 0.1); return o; },
    noiseSrc: function (t, dur) { var s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(t, Math.random()); s.stop(t + dur + 0.1); return s; },
    filter: function (node, type, f, q) { var b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; node.connect(b); return b; },
    impact: function (t, v) {
      var o = this.osc('sine', 120, t, 1.2); o.frequency.exponentialRampToValueAtTime(34, t + 0.6); this.out(o, t, 0.9 * v, 0.003, 1.1);
      var n = this.filter(this.noiseSrc(t, 1.0), 'lowpass', 5000); n.frequency.exponentialRampToValueAtTime(200, t + 0.9); this.out(n, t, 0.45 * v, 0.002, 0.9);
    },
    chime: function (t, m, v) { this.out(this.osc('square', midi(m), t, 0.5), t, 0.08 * v, 0.003, 0.4); this.out(this.osc('sine', midi(m + 12), t, 0.8), t, 0.1 * v, 0.003, 0.7); },
    blip: function (t, m, v) { this.out(this.osc('square', midi(m), t, 0.08), t, 0.09 * v, 0.002, 0.06); this.out(this.osc('square', midi(m + 7), t + 0.06, 0.08), t + 0.06, 0.07 * v, 0.002, 0.06); },
    zap: function (t, v, dur) {
      dur = dur || 0.6;
      var o = this.osc('sawtooth', 1800, t, dur); o.frequency.exponentialRampToValueAtTime(120, t + dur);
      this.out(this.filter(o, 'bandpass', 1200, 2), t, 0.25 * v, 0.005, dur);
      this.out(this.filter(this.noiseSrc(t, dur), 'highpass', 3000), t, 0.18 * v, 0.003, dur * 0.8);
    },
    whoosh: function (t, v, dur) {
      var n = this.filter(this.noiseSrc(t, dur), 'bandpass', 600, 1.5); n.frequency.exponentialRampToValueAtTime(5000, t + dur * 0.6); n.frequency.exponentialRampToValueAtTime(300, t + dur);
      this.out(n, t, 0.35 * v, dur * 0.5, dur * 0.5);
    },
    crackle: function (t, v, dur) {
      for (var i = 0; i < dur * 30; i++) { var tt = t + Math.random() * dur; this.out(this.filter(this.noiseSrc(tt, 0.02), 'highpass', 4000), tt, 0.25 * v * Math.random() + 0.01, 0.001, 0.015); }
    },
    glitch: function (t, v) {
      for (var i = 0; i < 6; i++) { var tt = t + i * 0.035; this.out(this.osc('square', 80 + Math.random() * 1600, tt, 0.04), tt, 0.12 * v, 0.001, 0.03); }
    },
    tick: function (t, v) { this.out(this.filter(this.noiseSrc(t, 0.03), 'highpass', 6000), t, 0.25 * v, 0.001, 0.025); }
  };

  function midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function duckAt(t) {
    var d = CUES.duck, v = 1;
    for (var i = 0; i < d.length; i++) {
      if (t >= d[i][0]) v = d[i][1];
      else { if (i) v = lerp(d[i - 1][1], d[i][1], (t - d[i - 1][0]) / (d[i][0] - d[i - 1][0])); break; }
    }
    return v;
  }

  // The game's own little sounds on the beat, so the game plays along with the track.
  function sfxScore() {
    var ev = [], k;
    function at(t, f) { ev.push({ t: t, f: f }); }
    at(3.0, function (a, t) { a.crackle(t, 0.6, 0.3); });
    at(10.15, function (a, t) { a.crackle(t, 1, 1.0); });
    at(B(0), function (a, t) { a.impact(t, 1); });
    at(B(18), function (a, t) { a.whoosh(t, 0.9, 0.6); });
    at(B(32), function (a, t) { a.impact(t, 1.1); a.chime(t, 76, 1); a.chime(t + 0.08, 83, 0.8); });
    [43, 47, 51].forEach(function (kk, i) { at(B(kk), function (a, t) { a.chime(t, 69 + i * 5, 1); a.zap(t, 0.4, 0.3); }); });
    at(B(58.7), function (a, t) { a.zap(t, 1, 0.9); });
    at(B(61.3), function (a, t) { a.impact(t, 0.7); });
    at(B(66), function (a, t) { a.impact(t, 1); a.glitch(t, 1); });
    at(B(67.2), function (a, t) { a.crackle(t, 0.8, 0.5); });
    at(B(71), function (a, t) { a.zap(t, 1, 1.4); });
    for (k = 78; k < 87; k += 1.5) (function (kk) { at(B(kk), function (a, t) { a.chime(t, 72 + ((kk - 78) * 2) % 12, 0.6); }); })(k);
    for (k = 0; k < 6; k++) (function (kk) { at(B(92 + kk * 1.2), function (a, t) { a.blip(t, 79 + (kk % 3) * 2, 0.8); }); })(k);
    at(B(103.2), function (a, t) { a.blip(t, 84, 1); a.chime(t + 0.1, 88, 0.6); });
    for (k = 108; k < 124; k++) (function (kk) { at(B(kk), function (a, t) { a.tick(t, kk < 116 ? 0.8 : 0.6); }); })(k);
    at(B(123.5), function (a, t) { a.chime(t, 84, 1); });
    [126, 128, 130, 132].forEach(function (kk) { at(B(kk), function (a, t) { a.zap(t, 0.6, 0.4); }); });
    at(IMPACT, function (a, t) { a.impact(t, 1.2); });
    ev.sort(function (a, b) { return a.t - b.t; });
    return ev;
  }

  /* =================================================================
     Stage: DOM, camera, planes
     ================================================================= */



  /* =================================================================
     Frame-rate governor
     Phones start one step down, and anything that can't hold about 40 fps for a second steps down again (never
     back up mid-film, so it doesn't flicker between looks). Level 1: the background shader at a lower resolution,
     no full-screen colour-split filter, no canvas glow blurs, lighter CSS filters (.cine-lite). Level 2: lower
     again, fewer particles (.cine-low).
     ================================================================= */

  var Q = { level: 0, avg: 16.7, slow: 0, t: 0 };
  function qualityStart() {
    var phone = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent);
    Q.level = phone ? 1 : 0; Q.avg = 16.7; Q.slow = 0; Q.t = 0;
    qualityApply();
  }
  function qualityFrame(ms) {
    if (Cine.hold != null || ms > 250) return;   // held frames, and tab switches, say nothing about speed
    Q.t += ms;
    if (Q.t < 800) return;                       // the first frames are always slow (compiling, decoding)
    Q.avg += (ms - Q.avg) * 0.12;
    Q.slow = Q.avg > 25 ? Q.slow + ms : 0;
    if (Q.slow > 900 && Q.level < 2) { Q.level++; Q.slow = 0; Q.avg = 16.7; qualityApply(); }
  }
  function qualityApply() {
    if (!Cine.root) return;
    Cine.root.classList.toggle('cine-lite', Q.level >= 1);
    Cine.root.classList.toggle('cine-low', Q.level >= 2);
  }
  function glow(b) { return Q.level ? 0 : b; }                                       // canvas shadowBlur
  function qn(n) { return Q.level >= 2 ? Math.ceil(n * 0.5) : Q.level ? Math.ceil(n * 0.75) : n; }   // particle counts

  var Cine = {
    root: null, stage: null, view: null, world: null, bgCanvas: null, fx: null, fxCtx: null, logo: null,
    soundBtn: null, hint: null, skipBtn: null, toasts: null, vhsEl: null, caption: null,
    running: false, raf: 0, t: 0, clockBase: 0, lastNow: 0, hold: null,
    shot: -1, shots: null, groups: {}, viewInfo: { P: 800, tan: 0.47, ax: 1.78, ay: 1 },
    cam: { x: 0, y: 0, z: 1000, yaw: 0, pitch: 0, roll: 0, fov: 50 },
    env: 1, speed: 0, variant: 0, streaks: 0, dist: 15, eye: 1.2, crt: 0, shake: 0, flash: 0, aberration: 0, tear: 0, level: 0, beat: 0,
    sparks: [], bolts: [], frags: [], flames: [], rings: [], transits: [], glass: [], ballQ: [], sprites: [], spriteLayer: null, crack: null,
    timeScale: 1, fovKick: 0, look: { x: 0, y: 0, z: -1 },
    soundWanted: true, beepWas: null, ending: false,

    needSound: function () { if (this.hint) this.hint.classList.remove('hidden'); }
  };

  function buildStage() {
    var root = el('div', 'cine');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Pong opening cinematic');
    var stage = el('div', 'cine-stage', root);
    Cine.bgCanvas = el('canvas', 'cine-bg', stage);
    Cine.view = el('div', 'cine-view', stage);
    Cine.world = el('div', 'cine-world', Cine.view);
    Cine.fx = el('canvas', 'cine-fx', stage);
    Cine.fxCtx = Cine.fx.getContext('2d');
    Cine.spriteLayer = el('div', 'cine-sprites', stage);   // image and GIF balls, in front of their flames
    Cine.sprites = []; Cine.ballQ = [];
    Cine.toasts = el('div', 'cine-toasts', stage);
    Cine.stage = stage;
    // The pixel logo: drawn small and scaled up with hard pixels, pink with a cyan ghost.
    var logo = el('div', 'cine-logo', root);
    var lc = el('canvas', 'cine-logo-art', logo);
    var sub = el('div', 'cine-logo-sub', logo);
    var tag = document.querySelector('.game-head .game-tagline');
    sub.textContent = tag ? tag.textContent.trim() : 'first to the target wins';
    paintLogo(lc);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { paintLogo(lc); });
    Cine.logo = { box: logo, art: lc, sub: sub };
    Cine.caption = el('div', 'cine-caption', root);
    Cine.vhsEl = el('div', 'cine-vhs', root);
    if (CUES.credit) el('div', 'cine-credit', root).textContent = CUES.credit;   // the track's CC BY attribution
    var ui = el('div', 'cine-ui', root);
    Cine.hint = el('button', 'cine-btn cine-hint hidden', ui);
    Cine.hint.type = 'button';
    Cine.hint.textContent = 'Click for sound';
    Cine.soundBtn = el('button', 'cine-btn', ui);
    Cine.soundBtn.type = 'button';
    var skip = el('button', 'cine-btn cine-skip', ui);
    skip.type = 'button';
    skip.textContent = 'Skip cinematic';
    skip.addEventListener('click', function (e) { e.stopPropagation(); finish(true); });
    Cine.soundBtn.addEventListener('click', function (e) { e.stopPropagation(); setSound(!Cine.soundWanted); });
    Cine.hint.addEventListener('click', function (e) { e.stopPropagation(); setSound(true); });
    // Browsers only start audio after a click or key: the first one anywhere turns the sound on.
    root.addEventListener('pointerdown', function () { if (Cine.soundWanted && !Audio.on) setSound(true); });
    Cine.root = root;
    Cine.skipBtn = skip;
    document.body.appendChild(root);
    Bg.mount(Cine.bgCanvas);
  }

  function paintLogo(cv) {
    var w = 132, h = 40;
    cv.width = w; cv.height = h;
    var x = cv.getContext('2d');
    x.clearRect(0, 0, w, h);
    x.font = '800 34px "JetBrains Mono", ui-monospace, monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#28e8ff'; x.fillText('pong', w / 2 - 2, h / 2 + 1);
    x.fillStyle = '#ff2fa6'; x.fillText('pong', w / 2 + 1, h / 2);
    // hard alpha so the edges stay pixelated when it is scaled up
    var img = x.getImageData(0, 0, w, h), d = img.data;
    for (var i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0;
    x.putImageData(img, 0, 0);
  }

  function setSound(on) {
    Cine.soundWanted = on;
    Cine.soundBtn.textContent = on ? 'Sound on' : 'Sound off';
    if (on) {
      if (!Audio.ctx) Audio.init();
      if (Audio.master) { Audio.master.gain.cancelScheduledValues(0); Audio.master.gain.value = 1; }
      if (Audio.start(Cine.t)) Cine.hint.classList.add('hidden');
      else {
        Cine.needSound();
        if (Audio.ctx && Audio.ctx.resume) Audio.ctx.resume().then(function () {
          if (Audio.ctx && Audio.ctx.state === 'running' && Audio.on) { Cine.hint.classList.add('hidden'); Audio.start(Cine.t); }
        });
      }
    } else {
      Audio.stop();
      Cine.hint.classList.add('hidden');
    }
  }

  // A group of planes shared by one or more consecutive shots (hidden while other shots are on screen).
  function group(id) {
    var g = { id: id, el: el('div', 'cine-group', Cine.world), items: [], boards: [], courts: [] };
    g.el.style.display = 'none';
    Cine.groups[id] = g;
    return g;
  }

  function plane(g, node, w, h, o) {
    node.classList.add('cine-plane');
    node.style.width = w + 'px';
    node.style.height = h + 'px';
    g.el.appendChild(node);
    var it = { el: node, w: w, h: h, x: 0, y: 0, z: 0, ry: 0, rx: 0, rz: 0, s: 1, fog: null, r: Math.max(w, h) * 0.6, cull: true, op: 1, hidden: false };
    Object.keys(o || {}).forEach(function (k) { it[k] = o[k]; });
    g.items.push(it);
    return it;
  }

  /* ---------- courts: Pong's own renderer and ball physics (PongApp.cinematicKit) ---------- */

  var CW = K.width, CH = K.height, HEAD = 40, BALL_R = 8;
  var NAMES = ['Blocky', 'Tess', 'Gridlock', 'Spin', 'Cobalt', 'Lunar', 'Pixel', 'Stack', 'Drop', 'Lumen', 'Vex', 'Orbit'];
  var courtCount = 0;

  // A court: a real Pong match from the kit. Its own ball is hidden (the cinematic draws the ball, with its flame
  // trail, over the court in screen space) but the kit's physics, paddles and scores all keep running.
  function makeCourt(o) {
    o = o || {};
    var c = K.make(o.seed != null ? o.seed : courtCount * 7 + 3);
    c.hideBall = true;
    c.speed = o.speed || 1.3;
    c.names = o.names || [NAMES[courtCount % NAMES.length], NAMES[(courtCount + 5) % NAMES.length]];
    c.lastDx = c.state.ball.dx;
    c.lastScore = c.state.score.slice();
    courtCount++;
    return c;
  }

  function courtPlane(g, court, o) {
    o = o || {};
    var node = el('div', 'cine-board pong-court' + (o.hero ? ' hero' : ''));
    if (o.color) node.style.setProperty('--board-color', o.color);
    var head = el('div', 'cine-board-head pong-court-head', node);
    el('span', 'cine-board-name', head).textContent = court.names[0];
    var sc = el('span', 'pong-court-score', head);
    el('span', 'cine-board-name', head).textContent = court.names[1];
    var face = el('div', 'cine-board-face pong-court-face', node);
    face.style.width = CW + 'px'; face.style.height = CH + 'px';
    court.canvas.className = 'cine-canvas';
    court.canvas.style.width = CW + 'px'; court.canvas.style.height = CH + 'px';
    face.appendChild(court.canvas);
    el('div', 'cine-gloss', face);
    var flash = el('div', 'pong-court-flash', face);
    var banner = el('div', 'pong-court-banner', face);
    var fog = el('div', 'cine-fog', node);
    var it = plane(g, node, CW, CH + HEAD, o);
    it.court = court; it.face = face; it.fog = fog; it.scoreEl = sc; it.flashEl = flash; it.banner = banner;
    it.canvas = court.canvas; it.head = HEAD; it.flashAt = -9;
    g.courts.push(it);
    return it;
  }

  // Plane-local pixels (from the plane's top-left, the name bar included) to world space, with the same
  // transform order the CSS uses: translate, rotateY, rotateX, rotateZ, scale, centre.
  function toWorld(it, lx, ly) {
    var x = (lx - it.w / 2) * it.s, y = (ly - it.h / 2) * it.s, z = 0, a, c, s, t;
    a = it.rz * D2R; c = Math.cos(a); s = Math.sin(a); t = x * c - y * s; y = x * s + y * c; x = t;
    a = it.rx * D2R; c = Math.cos(a); s = Math.sin(a); t = y * c - z * s; z = y * s + z * c; y = t;
    a = it.ry * D2R; c = Math.cos(a); s = Math.sin(a); t = x * c + z * s; z = -x * s + z * c; x = t;
    return { x: it.x + x, y: it.y + y, z: it.z + z };
  }
  function ballWorld(it) { var b = it.court.state.ball; return toWorld(it, b.x, it.head + b.y); }
  function paddleWorld(it, side) {
    var p = side ? it.court.state.p2 : it.court.state.p1;
    return toWorld(it, side ? CW - 31 : 31, it.head + p.y + p.h / 2);
  }

  /* Pre-baked rallies: every court's game (bar the final hero court, which is steered live) is played out in advance,
     at a fixed 120 steps a second with the film's own scripted moments played into it, and recorded 30 times a second;
     the film replays the recording by time. So the background courts cost nothing to run, the film is the same every
     time, and a board can't stage a miss the film didn't ask for. The baking is spread over the cabinet intro's frames;
     a court needed sooner (a seek) finishes on the spot. */
  var BAKE_HZ = 30, BAKE_STEP = 1 / 120;
  function bakeCourts(shots) {
    var spans = {};
    shots.forEach(function (sh, i) {
      var a = shotStart(sh.cue), b = i + 1 < shots.length ? shotStart(shots[i + 1].cue) : CUES.end, w = spans[sh.group.id];
      if (!w) spans[sh.group.id] = { a: a, b: b, g: sh.group }; else { w.a = Math.min(w.a, a); w.b = Math.max(w.b, b); }
    });
    Cine.bakeJobs = [];
    Object.keys(spans).map(function (id) { return spans[id]; }).sort(function (x, y) { return x.a - y.a; }).forEach(function (w) {
      w.g.courts.forEach(function (it) {
        if (it.heroBall && !it.bakeEnd) return;   // the final hero court plays live
        var end = Math.min(w.b, it.bakeEnd || w.b);
        if (it.bakeInit) it.bakeInit(it.court);
        it.court.bakeJob = { it: it, t: w.a, t0: w.a, end: end, snaps: [], acc: 0 };
        Cine.bakeJobs.push(it.court.bakeJob);
      });
    });
  }
  function bakeOne(job) {
    var it = job.it, c = it.court;
    job.snaps.push(JSON.stringify(c.state));
    for (var k = 0; k < 4; k++) {   // 4 steps of 1/120 s per 1/30 s snapshot
      if (it.bakeScript) it.bakeScript(c, job.t);
      var ts = it.timeScale ? it.timeScale(job.t) : 1;
      c.noDraw = true; K.advance(c, BAKE_STEP * ts * (c.speed || 1)); c.noDraw = false;
      job.t += BAKE_STEP;
    }
    if (job.t >= job.end) {
      c.baked = { t0: job.t0, end: job.end, snaps: job.snaps, i: -1 }; c.bakeJob = null;
      var i = Cine.bakeJobs.indexOf(job); if (i >= 0) Cine.bakeJobs.splice(i, 1);
      return true;
    }
    return false;
  }
  function bakeStep(ms) {
    var end = performance.now() + ms;
    while (Cine.bakeJobs && Cine.bakeJobs.length && performance.now() < end) bakeOne(Cine.bakeJobs[0]);
  }
  // put a court at its recorded state for time t (true while the recording covers t)
  function replayCourt(it, t) {
    var c = it.court, B = c.baked;
    if (!B || t >= B.end) return false;
    var i = Math.max(0, Math.min(B.snaps.length - 1, Math.floor((t - B.t0) * BAKE_HZ)));
    if (i !== B.i) { B.i = i; c.state = JSON.parse(B.snaps[i]); c.dirty = true; }
    if (c.dirty && it.visible && !it.hidden) { K.advance(c, 0); c.dirty = false; }   // a zero step just draws it
    return true;
  }

  // Run every court in the shot (they keep playing even off camera) and react to hits and points.
  function simCourts(g, dt) {
    g.courts.forEach(function (it) {
      var c = it.court;
      if (c.bakeJob) while (!bakeOne(c.bakeJob)) { /* needed now: finish its bake */ }
      if (replayCourt(it, Cine.t)) { courtEvents(it); return; }
      var d = c.state;
      if (it.script) it.script(c, dt);
      var step = dt * (Cine.timeScale == null ? 1 : Cine.timeScale) * (c.speed || 1), n = Math.max(1, Math.ceil(step / 0.02));
      // physics in small steps, but one draw a frame, and none at all for a court that's off screen
      var skip = Q.level >= 2 && !it.hero && (Cine.frameNo & 1);
      for (var i = 0; i < n; i++) { c.noDraw = i < n - 1 || !it.visible || it.hidden || skip; K.advance(c, step / n); }
      c.noDraw = false;
      // the hero courts never sit out a serve pause in shot: the ball is back in play almost at once
      if (it.hero && d.serveTimer > 0.15) d.serveTimer = 0.15;
      courtEvents(it);
    });
  }
  // hits (the ball turns round) and points (the score changes), live or replayed
  function courtEvents(it) {
    var c = it.court, d = c.state;
    if (d.ball.dx && c.lastDx && (d.ball.dx > 0) !== (c.lastDx > 0)) onHit(it);
    if (d.ball.dx) c.lastDx = d.ball.dx;
    if (d.score[0] !== c.lastScore[0] || d.score[1] !== c.lastScore[1]) { c.lastScore = d.score.slice(); onPoint(it); }
    var s = d.score[0] + ' : ' + d.score[1];
    if (it.scoreEl.textContent !== s) it.scoreEl.textContent = s;
    var f = clamp01(1 - (Cine.t - it.flashAt) / 0.5);
    it.flashEl.style.opacity = f.toFixed(3);
  }

  function onHit(it) {
    it.hitCount = (it.hitCount || 0) + 1;
    var p = it.visible && projectP(ballWorld(it));
    if (p) burst(p.x, p.y, 16, [320, 190, 285], 0.5);
    if (it.hero) { Cine.shake = Math.max(Cine.shake, 0.35); Cine.flash = Math.max(Cine.flash, 0.06); Cine.aberration = Math.max(Cine.aberration, 0.5); }
    it.flashAt = Cine.t - 0.35;
  }

  function onPoint(it) {
    it.flashAt = Cine.t; it.pointAt = Cine.t;
    if (it.hero) { Cine.flash = Math.max(Cine.flash, 0.45); Cine.shake = Math.max(Cine.shake, 0.8); Cine.aberration = 1; }
  }

  function projectP(w) { return project(w.x, w.y, w.z); }

  /* ---------- the ball: the player's own ball (or the host's, on an invite link) with a pixel flame trail ---------- */

  // PongApp.ball() is the skin the player picked, or on an invite link the lobby host's (it arrives with the
  // lobby's hello). Image and GIF balls are real <img> elements over the effects canvas, so GIFs animate and the
  // ball always sits in front of its flames; the classic pearl and emoji balls are drawn on the canvas after them.
  var BALL = { kind: 'classic', src: null, emoji: null };
  function pickBall() {
    var info = App.ball ? App.ball() : null;
    BALL.kind = 'classic'; BALL.src = null; BALL.emoji = null;
    if (info && (info.kind === 'image' || info.kind === 'gif') && info.src) { BALL.kind = 'img'; BALL.src = info.src; }
    else if (info && info.kind === 'emoji' && info.emoji) { BALL.kind = 'emoji'; BALL.emoji = info.emoji; }
  }

  // Balls are queued while the flames are emitted, then drawn on top of them.
  function queueBall(x, y, r, plain, ghost) { Cine.ballQ.push({ x: x, y: y, r: r, plain: !!plain, ghost: ghost || null }); }

  function drawPearl(ctx, x, y, r, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.shadowColor = '#9d00ff'; ctx.shadowBlur = glow(r * 2.2);
    ctx.fillStyle = '#f3e6ff';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function spriteAt(i) {
    var s = Cine.sprites[i];
    if (!s) {
      s = el('img', 'cine-ball-sprite', Cine.spriteLayer);
      s.alt = '';
      s.decoding = 'async';
      // built-in balls: ball3 is only a .gif, the others try .png then .gif (as pong.js does)
      s.onerror = function () { if (/ball\d\.png$/.test(s.src)) s.src = s.src.replace(/\.png$/, '.gif'); };
      Cine.sprites[i] = s;
    }
    if (s.dataset.src !== BALL.src) { s.dataset.src = BALL.src; s.src = BALL.src; }
    return s;
  }

  function flushBalls(ctx) {
    var used = 0;
    Cine.ballQ.forEach(function (b) {
      if (b.plain || BALL.kind === 'classic') {
        if (b.ghost && !b.plain) b.ghost.forEach(function (gp, i) { drawPearl(ctx, gp.x, gp.y, b.r * (0.9 - i * 0.12), 0.28 - i * 0.07); });
        drawPearl(ctx, b.x, b.y, b.r);
      } else if (BALL.kind === 'emoji') {
        ctx.save();
        ctx.font = Math.round(b.r * 2.6) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (b.ghost) b.ghost.forEach(function (gp, i) { ctx.globalAlpha = 0.25 - i * 0.07; ctx.fillText(BALL.emoji, gp.x, gp.y + b.r * 0.1); });
        ctx.globalAlpha = 1;
        ctx.fillText(BALL.emoji, b.x, b.y + b.r * 0.1);
        ctx.restore();
      } else {
        var s = spriteAt(used++), size = b.r * 3.2;
        s.style.display = '';
        s.style.width = s.style.height = size.toFixed(1) + 'px';
        s.style.transform = 'translate3d(' + (b.x - size / 2).toFixed(1) + 'px,' + (b.y - size / 2).toFixed(1) + 'px,0)';
      }
    });
    for (var i = used; i < Cine.sprites.length; i++) if (Cine.sprites[i].style.display !== 'none') Cine.sprites[i].style.display = 'none';
    Cine.ballQ = [];
  }

  // Pixel fire in the Terraria manner: chunky square embers stepping white, pink, magenta, violet as they die.
  var FLAME = ['#fff3ff', '#ffb3ec', '#ff4fc8', '#c03dff', '#6a2aff'];
  function emitFlame(x, y, r, vx, vy, n) {
    n = qn(n);
    for (var i = 0; i < n; i++) {
      Cine.flames.push({ x: x + rand(-0.6, 0.6) * r, y: y + rand(-0.6, 0.6) * r, vx: -vx * rand(0.05, 0.25) + rand(-40, 40),
        vy: -vy * rand(0.05, 0.25) + rand(-120, -30), life: rand(0.22, 0.5), age: 0, size: Math.max(3, r * rand(0.45, 0.95)) });
    }
  }

  function drawFlames(ctx, dt) {
    Cine.flames = Cine.flames.filter(function (f) { f.age += dt; return f.age < f.life; });
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    Cine.flames.forEach(function (f) {
      f.x += f.vx * dt; f.y += f.vy * dt;
      var k = f.age / f.life, s = Math.max(2, Math.round(f.size * (1 - k * 0.6)));
      ctx.globalAlpha = 1 - k * 0.7;
      ctx.fillStyle = FLAME[Math.min(FLAME.length - 1, Math.floor(k * FLAME.length))];
      ctx.fillRect(Math.round((f.x - s / 2) / 3) * 3, Math.round((f.y - s / 2) / 3) * 3, s, s);
    });
    ctx.restore();
    // landing shockwaves: a pixel ring that races outwards
    Cine.rings = Cine.rings.filter(function (g) { g.age += dt; return g.age < 0.6; });
    Cine.rings.forEach(function (g) {
      var k = g.age / 0.6, R = g.r0 + k * g.r1;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = k < 0.3 ? '#ffffff' : '#ff4fc8'; ctx.lineWidth = Math.max(2, 14 * (1 - k));
      ctx.shadowColor = '#28e8ff'; ctx.shadowBlur = glow(24);
      ctx.beginPath(); ctx.arc(g.x, g.y, R, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    });
  }

  function ring(p, size) { if (p) Cine.rings.push({ x: p.x, y: p.y, r0: 10, r1: size || Math.max(innerWidth, innerHeight) * 0.6, age: 0 }); }

  /* ---------- the hero ball's journey: scripted flights in world space ----------
     Hero.segs: [{ t0, t1, from, to (point or function), arc, bulge (vector), ease, onEnd }]. Between courts the
     ball is the hero; on a court it's the court's own physics ball. */
  var Hero = { segs: [], last: null, ghost: [] };
  function heroSeg(t) {
    for (var i = 0; i < Hero.segs.length; i++) { var s = Hero.segs[i]; if (t >= s.t0 && t <= s.t1) return s; }
    return null;
  }
  function heroAt(t) {
    var s = heroSeg(t);
    if (!s) return null;
    var k = clamp01((t - s.t0) / (s.t1 - s.t0)), e = s.ease ? s.ease(k) : k;
    var to = typeof s.to === 'function' ? s.to() : s.to, b = Math.sin(e * Math.PI);
    var p = { x: lerp(s.from.x, to.x, e), y: lerp(s.from.y, to.y, e) - b * (s.arc || 0), z: lerp(s.from.z, to.z, e) };
    if (s.bulge) { p.x += s.bulge.x * b; p.y += s.bulge.y * b; p.z += s.bulge.z * b; }
    return p;
  }
  function heroVel(t) {
    var a = heroAt(t - 0.02), b = heroAt(t + 0.02);
    if (!a || !b) return null;
    return { x: (b.x - a.x) / 0.04, y: (b.y - a.y) / 0.04, z: (b.z - a.z) / 0.04 };
  }
  // fire each segment's onEnd once the clock passes it (also when the film was started part way through)
  function heroEvents(t) {
    Hero.segs.forEach(function (s) { if (s.onEnd && !s.ended && t >= s.t1) { s.ended = true; if (t - s.t1 < 0.25) s.onEnd(); } });
  }

  // Draw the ball on every visible court in the shot, the hero in flight, then the flames, then the balls on top.
  function drawBalls(g, dt, t) {
    var ctx = Cine.fxCtx;
    if (g) g.courts.forEach(function (it) {
      if (!it.visible || it.hidden || it.noBall) return;
      var b = it.court.state.ball, p = projectP(ballWorld(it));
      if (!p) return;
      var plain = !it.heroBall;
      var r = Math.min(110, Math.max(plain ? 2 : 4, BALL_R * (plain ? 1.3 : 2.1) * it.s * p.s));   // the hero is drawn a little larger so it always reads
      var sp = Math.hypot(b.dx, b.dy) / 600;
      var prev = Cine.justCut ? null : it.lastBallScreen;
      var vx = prev ? (p.x - prev.x) / Math.max(dt, 0.001) : 0, vy = prev ? (p.y - prev.y) / Math.max(dt, 0.001) : 0;
      it.lastBallScreen = { x: p.x, y: p.y };
      if (it.court.state.serveTimer > 0) return;
      if (!plain) emitFlame(p.x, p.y, r, vx, vy, Math.min(6, 2 + Math.round(sp * 2)));
      queueBall(p.x, p.y, r, plain);
    });
    Cine.transits = Cine.transits.filter(function (tr) {
      var k = (t - tr.t0) / tr.dur;
      if (k < 0) return true;
      if (k >= 1) {
        if (!tr.landed) {
          tr.landed = true;
          var lp = projectP(tr.to);
          if (lp) { ring(lp); burst(lp.x, lp.y, 90, [320, 190, 285], 1.3); }
          Cine.flash = Math.max(Cine.flash, tr.flash == null ? 0.4 : tr.flash); Cine.shake = Math.max(Cine.shake, 0.9); Cine.aberration = 1;
          if (tr.onLand) tr.onLand();
        }
        return false;
      }
      var e = easeIn(k) * 0.4 + k * 0.6;
      var w = { x: lerp(tr.from.x, tr.to.x, e), y: lerp(tr.from.y, tr.to.y, e) - Math.sin(e * Math.PI) * (tr.arc || 300), z: lerp(tr.from.z, tr.to.z, e) };
      tr.head = w;
      var p = projectP(w);
      if (!p) return true;
      var r = Math.min(160, Math.max(3, BALL_R * 1.6 * p.s));
      var prev = tr.last; tr.last = { x: p.x, y: p.y };
      var vx = prev ? (p.x - prev.x) / Math.max(dt, 0.001) : 0, vy = prev ? (p.y - prev.y) / Math.max(dt, 0.001) : 0;
      emitFlame(p.x, p.y, r, vx, vy, 7);
      queueBall(p.x, p.y, r);
      return true;
    });
    // the hero in flight between courts
    heroEvents(t);
    var hw = heroAt(t), hp = hw && projectP(hw);
    if (hp && hp.d > 25) {
      var hr = Math.min(150, Math.max(4, BALL_R * 2.1 * hp.s));
      var last = Cine.justCut ? null : Hero.last;
      var hvx = last ? (hp.x - last.x) / Math.max(dt, 0.001) : 0, hvy = last ? (hp.y - last.y) / Math.max(dt, 0.001) : 0;
      Hero.last = { x: hp.x, y: hp.y };
      var fast = Math.hypot(hvx, hvy) > 900;
      Hero.ghost.unshift({ x: hp.x, y: hp.y }); Hero.ghost.length = Math.min(Hero.ghost.length, 4);
      emitFlame(hp.x, hp.y, hr, hvx, hvy, 7);
      queueBall(hp.x, hp.y, hr, false, fast ? Hero.ghost.slice(1) : null);
    } else { Hero.last = null; Hero.ghost = []; }
    drawPixel(t);
    drawFlames(ctx, dt);
    flushBalls(ctx);
    Cine.justCut = false;
  }

  // A ball leaving one place for another: from/to are world points; it lands with a shockwave.
  function transit(from, to, t0, dur, onLand, o) {
    var tr = { from: from, to: to, t0: t0, dur: dur, onLand: onLand, landed: false };
    Object.keys(o || {}).forEach(function (k) { tr[k] = o[k]; });
    Cine.transits.push(tr);
    return tr;
  }

  // Screen-space cards (achievement toasts) that sit over the picture rather than in the world.
  function toast(title, body) {
    var t = el('div', 'cine-toast', Cine.toasts);
    el('strong', '', t).textContent = title;
    el('span', '', t).textContent = body;
    setTimeout(function () { t.classList.add('out'); }, 900);
    setTimeout(function () { t.remove(); }, 1400);
  }

  /* =================================================================
     Custom scenery: the arcade cabinet, the car, the panels
     ================================================================= */

  // The game's streak badge, big: label, count, the timer bar; the hottest adds the game's pixel fire.
  function paintBadge(cv, t, heat) {
    var x = cv.getContext('2d'), w = cv.width, h = cv.height, n = cv.dataset.n;
    x.clearRect(0, 0, w, h);
    x.fillStyle = 'rgba(8,4,20,0.82)'; x.fillRect(10, 10, w - 20, h - 20);
    var col = heat > 0.66 ? [255, 196, 70] : heat > 0.33 ? [190, 110, 255] : [80, 220, 255];
    var rgb = 'rgb(' + col.join(',') + ')';
    if (heat > 0.66) {
      for (var i = 0; i < w / 8; i++) {
        var fh = (0.4 + 0.6 * Math.abs(Math.sin(i * 1.7 + t * 9))) * (40 + 30 * Math.sin(i * 0.7 + t * 5));
        var gr = x.createLinearGradient(0, h - fh, 0, h);
        gr.addColorStop(0, 'rgba(255,80,40,0)'); gr.addColorStop(1, 'rgba(255,200,120,0.85)');
        x.fillStyle = gr; x.fillRect(i * 8, h - 10 - fh, 8, fh);
      }
    }
    x.strokeStyle = rgb; x.lineWidth = 6; x.shadowColor = rgb; x.shadowBlur = 30;
    x.strokeRect(13, 13, w - 26, h - 26);
    x.textAlign = 'center';
    x.fillStyle = rgb; x.shadowBlur = 24;
    x.font = '800 34px "JetBrains Mono", monospace'; x.fillText(cv.dataset.label, w / 2, 78);
    x.fillStyle = 'rgb(' + col.map(function (v) { return Math.round(v * 0.55 + 115); }).join(',') + ')';
    x.font = '800 150px "JetBrains Mono", monospace'; x.fillText(n + 'x', w / 2, 220);
    x.shadowBlur = 0;
    x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(90, 255, w - 180, 12);
    x.fillStyle = rgb; x.fillRect(90, 255, (w - 180) * (0.6 + 0.25 * Math.sin(t * 2)), 12);
  }

  function panel(cls, title) {
    var p = el('div', 'cine-panel ' + (cls || ''));
    if (title) el('div', 'cine-panel-title', p).textContent = title;
    return p;
  }

  function avatarArt(seed, size) {
    var cv = document.createElement('canvas');
    cv.width = 8; cv.height = 8; cv.className = 'cine-avatar';
    cv.style.width = cv.style.height = size + 'px';
    var x = cv.getContext('2d'), hue = Math.floor(hash(seed) * 360);
    x.fillStyle = 'hsl(' + hue + ',70%,22%)'; x.fillRect(0, 0, 8, 8);
    x.fillStyle = 'hsl(' + ((hue + 160) % 360) + ',90%,65%)';
    for (var y = 1; y < 7; y++) for (var c = 1; c < 4; c++) if (hash(seed * 7 + y * 3 + c) > 0.45) { x.fillRect(c, y, 1, 1); x.fillRect(7 - c, y, 1, 1); }
    return cv;
  }

  /* =================================================================
     Effects: spark, bolts, fragments, speed lines, VHS noise
     ================================================================= */

  function burst(x, y, n, hues, speed) {
    hues = hues || [285, 320, 190];
    n = qn(n);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = (speed || 1) * (150 + Math.random() * 800);
      Cine.sparks.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.9, age: 0, hue: hues[i % hues.length], size: 2 + Math.random() * 4 });
    }
  }

  // Screen position of a world point (null behind the camera).
  function project(x, y, z) {
    var cd = camDepth(x, y, z), v = Cine.viewInfo;
    if (cd.d <= 1) return null;
    var k = v.P / cd.d, sx = cd.x * k, sy = cd.y * k, r = (Cine.cam.roll + (Cine.shakeR || 0)) * D2R;
    return { x: innerWidth / 2 + (Cine.shakeX || 0) + sx * Math.cos(r) - sy * Math.sin(r), y: innerHeight / 2 + (Cine.shakeY || 0) + sx * Math.sin(r) + sy * Math.cos(r), s: k, d: cd.d };
  }

  // An attack bolt between two world points; its head runs 0..1 over `dur` seconds from t0 (cinematic time).
  function bolt(from, to, t0, dur, onHit) { Cine.bolts.push({ from: from, to: to, t0: t0, dur: dur, onHit: onHit, hit: false }); }

  function boltHead(b, k) {
    return { x: lerp(b.from.x, b.to.x, k), y: lerp(b.from.y, b.to.y, k) - Math.sin(k * Math.PI) * 260, z: lerp(b.from.z, b.to.z, k) };
  }

  function drawBolts(ctx, t) {
    Cine.bolts = Cine.bolts.filter(function (b) {
      var k = (t - b.t0) / b.dur;
      if (k < 0) return true;
      if (k >= 1) { if (!b.hit) { b.hit = true; if (b.onHit) b.onHit(); } return false; }
      var pts = [];
      for (var i = 0; i <= 16; i++) {
        var kk = Math.max(0, k - 0.32 + i * 0.02), hp = boltHead(b, kk), pp = project(hp.x, hp.y, hp.z);
        if (pp) pts.push(pp);
      }
      if (pts.length < 2) return true;
      var head = pts[pts.length - 1], scale = Math.min(3, Math.max(0.6, head.s));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var pass = 0; pass < 3; pass++) {
        ctx.beginPath();
        pts.forEach(function (p, i) {
          var j = i && i < pts.length - 1 ? (Math.random() - 0.5) * 26 * Math.min(2, p.s) : 0;
          if (i) ctx.lineTo(p.x + j, p.y + j * 0.6); else ctx.moveTo(p.x, p.y);
        });
        ctx.strokeStyle = pass === 2 ? 'rgba(255,255,255,0.95)' : pass === 1 ? 'rgba(40,232,255,0.8)' : 'rgba(255,47,166,0.55)';
        ctx.lineWidth = (pass === 2 ? 2 : pass === 1 ? 6 : 16) * scale;
        ctx.shadowColor = '#ff2fa6'; ctx.shadowBlur = glow(20);
        ctx.stroke();
      }
      var R = 60 * Math.min(4, head.s + 0.4);
      var rg = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, R);
      rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(0.3, 'rgba(40,232,255,0.6)'); rg.addColorStop(1, 'rgba(255,47,166,0)');
      ctx.fillStyle = rg; ctx.fillRect(head.x - R, head.y - R, R * 2, R * 2);
      ctx.restore();
      if (Math.random() < 0.6) burst(head.x, head.y, 2, [190, 320], 0.4);
      Cine.aberration = Math.max(Cine.aberration, Math.min(1, head.s * 0.6));
      return true;
    });
  }

  // A court breaking into pixel fragments that tumble back into the dark.
  function shatter(item) {
    var p = project(item.x, item.y, item.z);
    if (!p) return;
    var src = item.canvas, copy = document.createElement('canvas');
    copy.width = src.width; copy.height = src.height;
    copy.getContext('2d').drawImage(src, 0, 0);
    var cols = 16, rows = 10, tw = src.width / cols, th = src.height / rows, s = p.s * item.s;
    var left = p.x - (item.w / 2) * s, top = p.y - (item.h / 2 - item.head) * s;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var cx = left + (c + 0.5) * tw * s, cy = top + (r + 0.5) * th * s;
      Cine.frags.push({ img: copy, sx: c * tw, sy: r * th, sw: tw, sh: th, x: cx, y: cy, w: tw * s, h: th * s,
        vx: (cx - p.x) * rand(0.6, 1.8), vy: (cy - p.y) * rand(0.6, 1.8) - 60, spin: rand(-4, 4), a: 0, age: 0, life: rand(0.9, 1.6) });
    }
    item.hidden = true;
  }

  // A court breaking like glass as the ball goes through it: triangular shards in world space, each carrying its
  // piece of the court's picture, blown along the ball's path so the camera flies through them.
  function shatterGlass(item, hit, push) {
    var src = item.canvas, copy = document.createElement('canvas');
    copy.width = src.width; copy.height = src.height;
    copy.getContext('2d').drawImage(src, 0, 0);
    var cols = 9, rows = 6, tw = src.width / cols, th = src.height / rows, ny = item.head;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      // each cell split into two triangles along a jittered diagonal
      var x0 = c * tw, y0 = r * th, j = hash(r * 31 + c) > 0.5;
      var tris = j ? [[[x0, y0], [x0 + tw, y0], [x0, y0 + th]], [[x0 + tw, y0], [x0 + tw, y0 + th], [x0, y0 + th]]]
        : [[[x0, y0], [x0 + tw, y0], [x0 + tw, y0 + th]], [[x0, y0], [x0 + tw, y0 + th], [x0, y0 + th]]];
      tris.forEach(function (tri) {
        var cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
        var w = toWorld(item, cx, ny + cy);
        var dx = w.x - hit.x, dy = w.y - hit.y, dz = w.z - hit.z, dl = Math.max(1, Math.hypot(dx, dy, dz));
        var near = Math.max(0, 1 - dl / 700);   // the middle, where the ball hit, goes fastest
        var sp = rand(400, 1100) * (0.4 + near);
        Cine.glass.push({
          img: copy, tri: tri.map(function (v) { return [v[0] - cx, v[1] - cy]; }), cx: cx, cy: cy,
          p: w, v: { x: dx / dl * sp + push.x * (0.5 + near) * rand(0.6, 1.2), y: dy / dl * sp + push.y * (0.5 + near) + rand(-80, 80), z: dz / dl * sp + push.z * (0.5 + near) * rand(0.6, 1.2) },
          a: 0, spin: rand(-5, 5), s: item.s, age: 0, life: rand(1.8, 2.8), glint: Math.random()
        });
      });
    }
    item.hidden = true;
  }

  function drawGlass(ctx, dt) {
    if (!Cine.glass.length) return;
    Cine.glass = Cine.glass.filter(function (g) { g.age += dt; return g.age < g.life; });
    Cine.glass.forEach(function (g) {
      g.p.x += g.v.x * dt; g.p.y += g.v.y * dt; g.p.z += g.v.z * dt;
      g.v.y += 260 * dt; g.v.x *= 1 - dt * 0.25; g.v.z *= 1 - dt * 0.25;
      g.a += g.spin * dt;
      var p = project(g.p.x, g.p.y, g.p.z);
      if (!p || p.d < 40) return;
      var k = Math.min(7, p.s * g.s), fade = 1 - Math.max(0, (g.age - g.life + 0.6) / 0.6);
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(g.a); ctx.scale(k, k * (0.55 + 0.45 * Math.abs(Math.cos(g.a * 1.3))));   // the squash reads as the shard tumbling
      ctx.globalAlpha = fade * 0.92;
      ctx.beginPath(); ctx.moveTo(g.tri[0][0], g.tri[0][1]); ctx.lineTo(g.tri[1][0], g.tri[1][1]); ctx.lineTo(g.tri[2][0], g.tri[2][1]); ctx.closePath();
      ctx.save(); ctx.clip();
      ctx.fillStyle = 'rgba(14,6,32,0.6)'; ctx.fill();
      ctx.drawImage(g.img, -g.cx, -g.cy);
      // a glint sweeping across the glass as it turns
      var gl = 0.5 + 0.5 * Math.sin(g.a * 2 + g.glint * 6);
      var gl4 = gl * gl * gl * gl;
      ctx.fillStyle = 'rgba(200,230,255,' + (0.03 + gl4 * 0.32) + ')'; ctx.fill();
      ctx.restore();
      ctx.lineWidth = 1.5 / k; ctx.strokeStyle = g.glint > 0.5 ? 'rgba(255,120,220,' + (0.35 + gl * 0.5) + ')' : 'rgba(120,240,255,' + (0.35 + gl * 0.5) + ')';
      ctx.stroke();
      ctx.restore();
    });
  }

  // Cracks racing across the glass from the impact point, just before it gives way.
  function drawCracks(ctx, t) {
    var c = Cine.crack;
    if (!c) return;
    var age = t - c.t0;
    if (age < 0 || age > 0.5) return;
    var p = project(c.at.x, c.at.y, c.at.z);
    if (!p) return;
    var grow = easeOut(span(age, 0, 0.12)), R = Math.min(innerWidth, innerHeight) * 0.55 * grow, fade = 1 - span(age, 0.3, 0.5);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(235,245,255,' + (0.9 * fade) + ')'; ctx.shadowColor = '#28e8ff'; ctx.shadowBlur = glow(12);
    for (var i = 0; i < 16; i++) {
      var a = i / 16 * Math.PI * 2 + hash(i + c.seed) * 0.4, x = p.x, y = p.y, len = R * (0.5 + hash(i * 3 + c.seed) * 0.6);
      ctx.lineWidth = 2.5 - (i % 3) * 0.6;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (var s = 1; s <= 6; s++) { a += (hash(i * 13 + s + c.seed) - 0.5) * 0.5; x = p.x + Math.cos(a) * len * s / 6; y = p.y + Math.sin(a) * len * s / 6; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // the rings of the spider-web
    for (var rr = 1; rr <= 3; rr++) { ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, R * rr * 0.22, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }

  function drawFx(dt, t) {
    var cv = Cine.fx, ctx = Cine.fxCtx, w = innerWidth, h = innerHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.clearRect(0, 0, w, h);
    if (Cine.streaks > 0.02) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var R = Math.max(w, h) * 0.75;
      for (var i = 0; i < 40; i++) {
        var a = hash(i * 3.3) * Math.PI * 2, r0 = (hash(i * 7.1) + t * (1.5 + hash(i) * 2)) % 1, r1 = Math.min(1, r0 + 0.12 * Cine.streaks);
        ctx.strokeStyle = 'rgba(' + (i % 3 ? '200,120,255' : '40,232,255') + ',' + (0.5 * Math.min(1, Cine.streaks) * r0) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(w / 2 + Math.cos(a) * r0 * R, h / 2 + Math.sin(a) * r0 * R); ctx.lineTo(w / 2 + Math.cos(a) * r1 * R, h / 2 + Math.sin(a) * r1 * R); ctx.stroke();
      }
      ctx.restore();
    }
    drawBolts(ctx, t);
    Cine.frags = Cine.frags.filter(function (f) {
      f.age += dt;
      if (f.age > f.life) return false;
      var k = Math.max(0.05, 1 - f.age * 0.55);
      f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 120 * dt; f.a += f.spin * dt;
      ctx.save();
      ctx.globalAlpha = 1 - f.age / f.life;
      ctx.translate(f.x, f.y); ctx.rotate(f.a); ctx.scale(k, k);
      ctx.drawImage(f.img, f.sx, f.sy, f.sw, f.sh, -f.w / 2, -f.h / 2, f.w, f.h);
      ctx.restore();
      return true;
    });
    drawGlass(ctx, dt);
    drawCracks(ctx, t);
    Cine.sparks = Cine.sparks.filter(function (s) { s.age += dt; return s.age < s.life; });
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    Cine.sparks.forEach(function (s) {
      s.vx *= 1 - dt * 1.8; s.vy = s.vy * (1 - dt * 1.8) + 200 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      ctx.fillStyle = 'hsla(' + s.hue + ',100%,70%,' + (1 - s.age / s.life) + ')';
      ctx.fillRect(Math.round(s.x / 3) * 3, Math.round(s.y / 3) * 3, s.size, s.size);
    });
    ctx.restore();
    // VHS tracking noise: a band of white specks that rolls down the picture, louder on hits
    var v = Math.min(1, 0.15 + Cine.tear + Cine.aberration * 0.5);
    var by = ((t * 0.37) % 1.2 - 0.1) * h, bh = 10 + v * 30;
    for (var n = 0; n < 60 * v; n++) {
      ctx.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.18 * v) + ')';
      ctx.fillRect(Math.random() * w, by + Math.random() * bh, rand(8, 80), 1);
    }
  }

  // The spark: a point darting across the dark, a dotted violet trail behind it, swelling until it bursts.
  function drawSpark(t) {
    var ctx = Cine.fxCtx, w = innerWidth, h = innerHeight, t0 = CUES.spark[0], t1 = CUES.spark[1];
    if (t < t0) return;
    if (t >= t1) { if (!Cine.sparkBurst) { Cine.sparkBurst = true; burst(w / 2, h / 2, 140, [285, 320, 190], 1.3); Cine.flash = Math.max(Cine.flash, 0.5); } return; }
    Cine.sparkBurst = false;
    var k = (t - t0) / (t1 - t0);
    function at(q) { return { x: lerp(-0.05, 0.5, q) * w + Math.sin(q * 9) * h * 0.06, y: lerp(0.78, 0.5, q) * h - Math.sin(q * 3.2) * h * 0.18 }; }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 40; i++) {
      var q = k - i * 0.012;
      if (q < 0) break;
      var p = at(q);
      if (i % 2) continue;
      ctx.fillStyle = 'rgba(180,90,255,' + (0.8 * (1 - i / 40)) + ')';
      ctx.fillRect(Math.round(p.x / 4) * 4, Math.round(p.y / 4) * 4, 4, 4);
    }
    var hp = at(k), flick = 0.6 + 0.4 * Math.random(), size = 6 + k * k * 40;
    var rg = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, size * 3);
    rg.addColorStop(0, 'rgba(255,255,255,' + flick + ')'); rg.addColorStop(0.25, 'rgba(255,80,220,' + flick * 0.8 + ')'); rg.addColorStop(1, 'rgba(120,0,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(hp.x - size * 3, hp.y - size * 3, size * 6, size * 6);
    ctx.restore();
  }

  /* =================================================================
     Camera
     ================================================================= */

  // keys: [{ t, x, y, z, tx, ty, tz, roll, fov, e }] in shot-local seconds; e: the easing into that key.
  function path(keys, lt) {
    var a = keys[0], b = keys[0], k = 0;
    for (var i = 0; i < keys.length - 1; i++) if (lt >= keys[i].t && lt <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
    if (lt > keys[keys.length - 1].t) a = b = keys[keys.length - 1];
    if (a !== b) k = (b.e || easeInOut)((lt - a.t) / (b.t - a.t));
    var c = Cine.cam;
    function f(n, d) { var va = a[n] == null ? d : a[n], vb = b[n] == null ? d : b[n]; return lerp(va, vb, k); }
    c.x = f('x', 0); c.y = f('y', 0); c.z = f('z', 0); c.roll = f('roll', 0); c.fov = f('fov', 52);
    lookAt(f('tx', 0), f('ty', 0), f('tz', -1e5));
  }

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

  /* =================================================================
     The shots
     ================================================================= */

  // Camera helpers for following the ball: chase eases the rig towards a position and a look-at point (the swing
  // when the ball changes direction comes from this easing); snap jumps straight there (a cut).
  function chase(pos, look, dt, rate) {
    var c = Cine.cam, L = Cine.look, k = Math.min(1, dt * (rate || 5)), k2 = Math.min(1, dt * (rate || 5) * 1.6);
    c.x += (pos.x - c.x) * k; c.y += (pos.y - c.y) * k; c.z += (pos.z - c.z) * k;
    L.x += (look.x - L.x) * k2; L.y += (look.y - L.y) * k2; L.z += (look.z - L.z) * k2;
    lookAt(L.x, L.y, L.z);
  }
  function snap(pos, look) {
    var c = Cine.cam;
    Cine.justCut = true;   // the ball jumps on screen at a cut: don't read that as speed for its flames
    Rig.on = false;
    c.x = pos.x; c.y = pos.y; c.z = pos.z;
    Cine.look = { x: look.x, y: look.y, z: look.z };
    lookAt(look.x, look.y, look.z);
  }
  // The follow rig: critically damped springs on the camera's position, look-at point, field of view and roll, so
  // every move eases in and out with a little weight to it instead of snapping. rigTo() pulls it towards a target
  // each frame; the first call after rigReset() (or after Rig.on is cleared, e.g. a cut) lands on the target.
  var Rig = { on: false };
  function rigReset(pos, look, fov, roll) {
    Rig.on = true;
    Rig.p = { x: pos.x, y: pos.y, z: pos.z }; Rig.pv = { x: 0, y: 0, z: 0 };
    Rig.l = { x: look.x, y: look.y, z: look.z }; Rig.lv = { x: 0, y: 0, z: 0 };
    Rig.f = fov; Rig.fv = 0; Rig.r = roll || 0; Rig.rv = 0;
    Rig.az = null; Rig.azv = 0; Rig.head = null;
    Cine.justCut = true;
  }
  function spring(o, v, k, target, w, h) { var a = w * w * (target - o[k]) - 2 * w * v[k]; v[k] += a * h; o[k] += v[k] * h; }
  function rigTo(pos, look, fov, roll, dt, wp, wl) {
    if (!Rig.on) rigReset(pos, look, fov, roll);
    var n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n, F = { f: Rig.f, r: Rig.r }, FV = { f: Rig.fv, r: Rig.rv };
    for (var i = 0; i < n; i++) {
      ['x', 'y', 'z'].forEach(function (k) { spring(Rig.p, Rig.pv, k, pos[k], wp || 5.5, h); spring(Rig.l, Rig.lv, k, look[k], wl || 10, h); });
      spring(F, FV, 'f', fov, 4.2, h); spring(F, FV, 'r', roll || 0, 5, h);
    }
    Rig.f = F.f; Rig.fv = FV.f; Rig.r = F.r; Rig.rv = FV.r;
    var c = Cine.cam;
    c.x = Rig.p.x; c.y = Rig.p.y; c.z = Rig.p.z; c.fov = Rig.f; c.roll = Rig.r;
    lookAt(Rig.l.x, Rig.l.y, Rig.l.z);
  }
  // The orbit angle round the ball, in degrees from straight behind it, on its own spring (so swinging round the
  // ball is always a smooth arc), and the ball's heading, turned smoothly (so a bounce swings the camera round).
  function rigAz(target, dt, w) {
    if (Rig.az == null) { Rig.az = target; Rig.azv = 0; return Rig.az; }
    var o = { a: Rig.az }, v = { a: Rig.azv }, n = Math.max(1, Math.ceil(dt / 0.008));
    for (var i = 0; i < n; i++) spring(o, v, 'a', target, w || 3.2, dt / n);
    Rig.az = o.a; Rig.azv = v.a;
    return Rig.az;
  }
  function rigHeading(vel, dt) {
    var want = vel && Math.hypot(vel.x, vel.z) > 5 ? Math.atan2(vel.z, vel.x) : Rig.head == null ? 0 : Rig.head;
    if (Rig.head == null) Rig.head = want;
    var d = want - Rig.head;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    Rig.head += d * Math.min(1, dt * 3.5);
    return Rig.head;
  }
  // A point orbiting the ball: az degrees round from behind it (relative to its heading), dist away, up above it.
  function orbitPos(ball, head, az, dist, up) {
    var a = head + Math.PI + az * D2R;
    return { x: ball.x + Math.cos(a) * dist, y: ball.y - up, z: ball.z + Math.sin(a) * dist };
  }
  function mix3(a, b, k) { return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) }; }
  function add3(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  // A point in front of a standing court, along its facing direction.
  function frontOf(it, dist, up) {
    var a = it.ry * D2R;
    return { x: it.x + Math.sin(a) * dist, y: it.y - (up || 40), z: it.z + Math.cos(a) * dist };
  }
  function centreOf(it) { return { x: it.x, y: it.y, z: it.z }; }

  // The lone CRT pixel in the dark that becomes the ball and launches at the lens on the drop.
  function drawPixel(t) {
    var ctx = Cine.fxCtx, w = innerWidth, h = innerHeight, x = w / 2, y = h / 2;
    if (t < 10.4 || t >= 12.05) return;
    if (t < 11.75) {
      var on = t < 11.15 ? (Math.random() < 0.55 ? 1 : 0.15) : 1, sz = t < 11.15 ? 4 : 6 + (t - 11.15) * 10;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(243,230,255,' + on + ')';
      ctx.shadowColor = '#9d00ff'; ctx.shadowBlur = t < 11.15 ? 8 : 26;
      ctx.fillRect(Math.round(x - sz / 2), Math.round(y - sz / 2), Math.round(sz), Math.round(sz));
      ctx.restore();
      return;
    }
    var k = easeIn(span(t, 11.75, 12.0)), r = lerp(6, h * 0.75, k);
    emitFlame(x, y, Math.max(4, r * 0.2), 0, 0, 10);
    queueBall(x, y, r);
    Cine.aberration = Math.max(Cine.aberration, k);
  }

  function makeShots() {
    var S = {}, me = (G.Profile && G.Profile.get()) || { name: 'Player' };
    var FLOOR = 300;
    pickBall();

    /* ---------- Scene 1: the same painted cabinet as Tetris, head-on ---------- */

    function dolly(t) { return lerp(15, CAB_STOP, easeOut(span(t, 0, 3.9))); }
    S.cabinet = { pat: 3, update: function (t, lt) { Cine.dist = dolly(lt); Cine.crt = 0; Cine.env = smooth(span(lt, 0, 1.2)); } };
    S.logo = { pat: 3, update: function (t, lt) { Cine.dist = CAB_STOP; Cine.crt = smooth(span(lt, 0, 0.3)); logoOnScreen(lt, lt - 1.3); } };
    S.subtitle = { pat: 3, update: function (t, lt) {
      Cine.dist = CAB_STOP;
      var dark = smooth(span(lt, 0.4, 2.4));
      Cine.env = 1 - dark; Cine.crt = 1 - smooth(span(lt, 1.2, 2.4));
      logoOnScreen(3 + lt, 1.7 + lt);
    } };
    // darkness, then the single pixel (drawn by drawPixel) that becomes the ball
    S.pixel = { pat: 2, update: function (t, lt) {
      Cine.dist = CAB_STOP; Cine.env = 0;
      logoOnScreen(5.6 + lt, 4.3 + lt, 1 - smooth(span(lt, 0, 0.6)));
    }, exit: function () { hideLogo(); } };

    /* ---------- Scenes 2 to 6: one unbroken follow of the ball ----------
       The serve: the camera rides low behind the ball until the first paddle hits it, then rises to show the board.
       The rally speeds up under a slow orbit. On POINT SCORED the ball hops out of the court and flies to the next
       board, where the nearest paddle whacks it on to the next: a run of boards lined up diagonally, like a surf map,
       whose players miss their own balls. The camera never cuts: it swings round the ball on springs, and the field of
       view opens with speed. Then a long soaring arc to the last board, slow motion as that player is eliminated,
       and the ball smashes through the glass, the camera close behind it through the shards. */

    var NP = 8;                                             // boards in the surf run, before the one that breaks
    function hitT(i) { return B(33 + 3 * i); }              // the run's paddle hits, three beats apart
    var T_POINT = 24.45, T_SLOW = 37.0, T_RUSH = 38.05, T_BREAK = 38.25, T_THROUGH_END = 41.0;
    var SURF_NAMES = [['Blocky', 'Tess'], ['Lunar', 'Spin'], ['Cobalt', 'Pixel'], ['Stack', 'Drop'], ['Lumen', 'Vex'], ['Orbit', 'Gridlock'], ['Tess', 'Lunar'], ['Spin', 'Blocky']];
    var SURF_COLORS = ['#c77dff', '#4cc9ff', '#ff2fa6', '#7c6cff', '#28e8ff', '#a020ff', '#ff5a7a', '#3d8bff'];
    function normalOf(it) { var a = it.ry * D2R; return { x: Math.sin(a), y: 0, z: Math.cos(a) }; }
    function scale3(v, k) { return { x: v.x * k, y: v.y * k, z: v.z * k }; }
    function onFace(it, lx, ly) { return add3(toWorld(it, lx, it.head + ly), scale3(normalOf(it), 6)); }

    S.serve = { pat: 0, build: function (g) {
      var a = makeCourt({ seed: 4, speed: 1.4, names: [me.name, 'Blocky'] });
      S.A = courtPlane(g, a, { x: 0, y: FLOOR, z: 0, rx: 90, hero: true, cull: false });
      S.A.heroBall = true;
      S.exitW = toWorld(S.A, CW + 12, HEAD + CH * 0.5);
      // the surf run: down and away to the right, each board angled a little to the path
      // The run (after Sean's sketch): boards zig-zag right and left up a line that climbs away from the camera,
      // each tilted like a diamond and turned a little towards the middle. The ball crosses each board to the far
      // paddle, which knocks it back across to the next board on the other side (right boards: in from the left,
      // off the right paddle; left boards the other way round). The last board, centred at the top, shatters.
      S.surf = [];
      for (var i = 0; i < NP; i++) {
        var right = i % 2 === 0;
        var it = courtPlane(g, makeCourt({ seed: 9 + i * 5, speed: 1.5, names: SURF_NAMES[i] }),
          { x: (right ? 1 : -1) * 640, y: 120 - i * 250, z: -1400 - i * 1300, ry: (right ? -1 : 1) * 14, rz: (right ? 1 : -1) * 30, color: SURF_COLORS[i] });
        it.right = right;
        it.entryL = { x: right ? CW * 0.1 : CW * 0.9, y: CH * (0.3 + 0.4 * hash(i + 1)) };
        it.hitL = { x: right ? CW - 31 - 12 : 31 + 12, y: CH * (0.25 + 0.5 * hash(i + 7)) };
        S.surf.push(it);
      }
      // the board that breaks: bigger, red, centred at the end of the line, square on to the ball
      S.PE = courtPlane(g, makeCourt({ seed: 77, speed: 1.3, names: ['Gridlock', 'Vex'] }),
        { x: 0, y: 120 - NP * 250 - 150, z: -1400 - NP * 1300 - 700, s: 1.3, color: '#ff2f6e' });
      S.journey = buildJourney();
      S.A.bakeEnd = 23.2;   // from here the rally's last ball is steered live onto the point
      S.A.bakeInit = function (c) { var st = c.state; st.ball.x = 140; st.ball.y = CH * 0.45; st.ball.dx = Math.abs(st.ball.dx || 500); st.serveTimer = 0; };
      S.A.bakeScript = function (c, t) { c.perfect = true; c.speed = t < 18 ? 1.4 : lerp(1.4, 2.6, span(t, 18, T_POINT)); };
      S.surf.forEach(function (it, i) {
        it.bakeScript = function (c, t) {
          c.perfect = true;   // the run's boards rally cleanly: a point there would read as the hero ball's
          if (t >= hitT(i) - SPB && !c.parked) { c.parked = true; c.state.serveTimer = 999; }
          ridePaddle(it, i, t);
        };
      });
      // its only miss is the elimination: the right-hand player freezes, out of the ball's way
      S.PE.bakeScript = function (c, t) {
        c.perfect = true;
        if (t >= T_SLOW + 0.5) { var st = c.state; c.cinematicMiss = true; if (!c.dodged) { c.dodged = true; st.p2.y = st.ball.y < CH / 2 ? CH - st.p2.h : 0; } }
        if (t >= T_BREAK + 0.1) c.state.serveTimer = 999;   // broken: no more play
      };
      S.PE.timeScale = function (t) { return 1 - 0.8 * smooth(span(t, T_SLOW - 0.15, T_SLOW + 0.15)) * (1 - smooth(span(t, T_RUSH - 0.05, T_RUSH + 0.1))); };
    }, enter: function () {
      var st = S.A.court.state;
      st.ball.x = 140; st.ball.y = CH * 0.45; st.ball.dx = Math.abs(st.ball.dx || 500); st.serveTimer = 0;
      S.A.banner.textContent = ''; S.A.banner.style.opacity = '0'; S.A.court.cinematicMiss = false; S.A.noBall = false; S.A.hitCount = 0;
      S.firstHit = null; S.lastB = null; S.steerT = null; S.pointed = false; S.elim = false; S.elimShown = false; S.cracked = false; S.broke = false;
      S.surf.concat([S.PE]).forEach(function (it) { it.hidden = false; it.noBall = false; it.el.classList.remove('out'); it.banner.textContent = ''; it.court.cinematicMiss = false; it.court.cinematicMissLeft = false; it.court.speed = 1.5; });
      Rig.on = false;
    }, update: function (t, lt, u, dt) {
      var A = S.A, b = ballWorld(A), v = S.lastB && dt ? scale3(add3(b, scale3(S.lastB, -1)), 1 / dt) : { x: 1, y: 0, z: 0 };
      S.lastB = b;
      if (S.firstHit == null && (A.hitCount || 0) > 0) S.firstHit = t;
      var head = rigHeading(v, dt);
      var k = S.firstHit == null ? 0 : smooth(span(t, S.firstHit, S.firstHit + 1.4));
      var follow = orbitPos(b, head, 0, 300, 55), look = add3(b, { x: Math.cos(head) * 260, y: 0, z: Math.sin(head) * 260 });
      var wide = { x: -260, y: FLOOR - 940, z: 980 }, wideL = { x: 0, y: FLOOR, z: 0 };
      rigTo(mix3(follow, wide, k), mix3(look, wideL, k), lerp(64, 56, k), -Math.cos(head) * 5 * (1 - k), dt, lerp(9, 3.2, k), lerp(14, 6, k));
      Cine.streaks = 0.4 * (1 - k) + 0.1; Cine.speed = 0.3 * (1 - k);
    } };

    S.rally = { pat: 0, update: function (t, lt, u, dt) {
      var A = S.A, c = A.court, st = c.state, bl = st.ball;
      c.speed = lerp(1.4, 2.6, u);
      // the last rally: once the ball is heading right, it's steered past the right-hand paddle onto the point
      if (S.steerT == null && t >= 23.2 && (bl.dx > 0 || t >= 23.85)) { S.steerT = t; S.steerFrom = { x: bl.x, y: bl.y }; }
      if (S.steerT != null) {
        var k = span(t, S.steerT, T_POINT);
        c.cinematicMiss = true; c.speed = 0.0001;
        bl.x = lerp(S.steerFrom.x, CW + 12, k); bl.y = lerp(S.steerFrom.y, CH * 0.5, smooth(k)); bl.dx = 900; bl.dy = 0;
      }
      var b = ballWorld(A), a = 0.5 + lt * 0.2, R = lerp(1100, 860, u);
      var pos = { x: Math.sin(a) * R, y: FLOOR - 700 - 120 * Math.sin(lt * 0.6), z: Math.cos(a) * R }, look = { x: b.x * 0.3, y: FLOOR, z: b.z * 0.3 };
      // at the end, ease down towards the ball as it goes out
      var e = S.steerT == null ? 0 : smooth(span(t, S.steerT, T_POINT));
      var near = { x: b.x + 300, y: FLOOR - 420, z: b.z + 760 };
      rigTo(mix3(pos, near, e), mix3(look, b, e), lerp(56, 62, e) + (Cine.fovKick || 0), Math.sin(lt * 0.5) * 4, dt, 3.4, 6);
      Cine.streaks = 0.2 + u * 0.6; Cine.speed = u * 0.5;
    } };

    // the whole journey as hero segments (deterministic, so the film can start part way through)
    function buildJourney() {
      var segs = [], P = S.surf;
      var hop = add3(S.exitW, { x: 260, y: -330, z: -60 });
      segs.push({ kind: 'hop', t0: T_POINT, t1: 25.0, from: S.exitW, to: hop, ease: easeOut });
      var prev = hop, prevT = 25.0;
      P.forEach(function (it, i) {
        var entry = onFace(it, it.entryL.x, it.entryL.y), hit = onFace(it, it.hitL.x, it.hitL.y);
        segs.push({ kind: 'fly', i: i, t0: prevT, t1: hitT(i) - SPB, from: prev, to: entry, arc: i ? 220 : 160,
          bulge: i ? scale3(normalOf(P[i - 1]), 260) : null, ease: function (k) { return k * 0.55 + smooth(k) * 0.45; },
          onEnd: function () { land(it); } });
        segs.push({ kind: 'ride', i: i, it: it, t0: hitT(i) - SPB, t1: hitT(i), from: entry, to: hit, onEnd: function () { paddleHit(it); } });
        prev = hit; prevT = hitT(i);
      });
      var PE = S.PE, n = normalOf(PE), mid = toWorld(PE, PE.w / 2, PE.head + CH / 2);
      var appr = add3(mid, scale3(n, 900)), appr2 = add3(mid, scale3(n, 360)), through = add3(mid, scale3(n, 4));
      segs.push({ kind: 'long', t0: prevT, t1: T_SLOW, from: prev, to: appr, arc: 700, bulge: scale3(normalOf(P[NP - 1]), 500), ease: easeInOut });
      segs.push({ kind: 'slow', t0: T_SLOW, t1: T_RUSH, from: appr, to: appr2 });
      segs.push({ kind: 'rush', t0: T_RUSH, t1: T_BREAK, from: appr2, to: through, ease: easeIn, onEnd: function () { breakThrough(); } });
      segs.push({ kind: 'through', t0: T_BREAK, t1: T_THROUGH_END, from: through, to: add3(mid, { x: 1100, y: 600, z: -7000 }), arc: 260,
        ease: function (k) { return 1 - Math.pow(1 - k, 1.35); } });
      S.through = through; S.dirThrough = scale3(n, -1);
      return segs;
    }

    // the ball lands on a board: a small shockwave, the board lights, and its right-hand player stops (and so misses
    // their own ball) to meet ours instead
    function land(it) {
      var p = projectP(heroAt(Cine.t) || centreOf(it));
      if (p) { ring(p, 260 * Math.min(2, p.s)); burst(p.x, p.y, 26, [320, 190, 285], 0.6); }
      it.flashAt = Cine.t;
      it.noBall = true;   // the board's own ball is set aside for ours (the baked game parks it: no point, no loss)
      Cine.shake = Math.max(Cine.shake, 0.22);
    }
    function paddleHit(it) {
      var p = projectP(heroAt(Cine.t) || centreOf(it));
      if (p) { burst(p.x, p.y, 60, [320, 190, 285, 50], 1.0); ring(p, 420 * Math.min(2, p.s)); }
      it.flashAt = Cine.t;
      Cine.shake = Math.max(Cine.shake, 0.45); Cine.flash = Math.max(Cine.flash, 0.14); Cine.aberration = Math.max(Cine.aberration, 0.8);
      Cine.tear = Math.max(Cine.tear, 0.35); Cine.fovKick = -9; Cine.hitStop = 0.07;
    }
    function breakThrough() {
      var PE = S.PE;
      Cine.flash = Math.max(Cine.flash, 0.75); Cine.shake = Math.max(Cine.shake, 1.3); Cine.aberration = 1.4; Cine.tear = Math.max(Cine.tear, 1.2);
      var p = projectP(S.through); if (p) { burst(p.x, p.y, 160, [340, 320, 190, 300], 1.6); ring(p); }
      PE.noBall = true;
      shatterGlass(PE, S.through, scale3(S.dirThrough, 2600));   // blown along with the ball, so the camera flies through them
    }

    // the right-hand paddle on the board the ball is riding slides to meet it (played into the baked game)
    function ridePaddle(it, i, t) {
      var t1 = hitT(i), t0 = t1 - SPB;
      if (t < t0 - 0.25 || t > t1 + 0.1) return;
      var pd = it.right ? it.court.state.p2 : it.court.state.p1, want = it.hitL.y - pd.h / 2;
      pd.y = lerp(pd.y, want, Math.min(1, 0.25 + span(t, t0 - 0.25, t1) * 0.75));
    }
    function ridePaddles(t) { S.surf.forEach(function (it, i) { if (!it.court.baked) ridePaddle(it, i, t); }); }

    // where the camera sits in each part of the journey: [orbit angle round the ball, distance, height, fov]
    function journeyCam(s, k, i, speed) {
      var side = i % 2 ? -1 : 1, fast = clamp01(speed / 2600);
      switch (s.kind) {
        case 'hop': return [-115, 820, 420, 62];          // out ahead, looking back at the court and POINT SCORED
        case 'fly': return [side * 10, 950, 190, 58 + fast * 22];
        case 'ride': return [side * 6, 1050, 110, 56];
        case 'long': return [-38 * Math.sin(smooth(k) * Math.PI), 700, lerp(220, 120, smooth(k)), 62 + fast * 18];   // a swing out to the side and back
        case 'slow': return [lerp(20, 2, smooth(k)), lerp(460, 250, k), lerp(110, 40, k), lerp(68, 36, smooth(k))];   // dolly zoom, from just behind
        case 'rush': return [0, 220, 30, lerp(40, 70, k)];
        default: return [0, 320, 70, 84];
      }
    }

    var RUN_HEAD = Math.atan2(-1300, 0);   // the run climbs straight away from the camera (towards -z)

    // the orbit angle that puts the camera out along a board's facing direction
    function azToward(n, head) {
      var a = (Math.atan2(n.z, n.x) - head - Math.PI) / D2R;
      while (a > 180) a -= 360;
      while (a < -180) a += 360;
      return a;
    }

    function journey(t, lt, u, dt) {
      var A = S.A;
      // the point
      if (!S.pointed && t >= T_POINT) {
        S.pointed = true;
        var st = A.court.state;
        if (t - T_POINT < 0.3) { st.score[0]++; A.court.lastScore = st.score.slice(); onPoint(A); }
        A.noBall = true; A.court.cinematicMiss = false; A.court.speed = 1.3; st.ball.x = CW / 2; st.ball.y = CH / 2; st.serveTimer = 0.8;
        A.banner.textContent = 'POINT SCORED';
      }
      A.banner.style.opacity = (1 - smooth(span(t, T_POINT + 0.8, T_POINT + 1.3))).toFixed(3);
      ridePaddles(t);
      // slow motion as the last board's player is eliminated
      Cine.timeScale = 1 - 0.8 * smooth(span(t, T_SLOW - 0.15, T_SLOW + 0.15)) * (1 - smooth(span(t, T_RUSH - 0.05, T_RUSH + 0.1)));
      if (!S.elim && t >= T_SLOW + 0.5) { S.elim = true; S.PE.court.cinematicMiss = true; }
      if (!S.elimShown && t >= T_RUSH + 0.05) { S.elimShown = true; S.PE.banner.textContent = 'ELIMINATED'; S.PE.banner.style.opacity = '1'; S.PE.el.classList.add('out'); }
      if (!S.cracked && t >= T_BREAK - 0.1) { S.cracked = true; Cine.crack = { t0: T_BREAK - 0.1, at: S.through, seed: 3 }; }
      var dim = smooth(span(t, T_SLOW, T_SLOW + 0.4)) * (1 - smooth(span(t, T_BREAK, T_BREAK + 0.4)));
      Cine.env = 1 - dim * 0.55;

      var s = heroSeg(t), bw = heroAt(t);
      if (!s || !bw) return;
      var v = heroVel(t) || { x: 1, y: 0, z: 0 }, speed = Math.hypot(v.x, v.y, v.z);
      var k = clamp01((t - s.t0) / (s.t1 - s.t0)), cam = journeyCam(s, k, s.i || 0, speed);
      // along the run, the camera faces up the line (mostly), not wherever the ball bounces to next
      var hv = v;
      if (s.kind === 'fly' || s.kind === 'ride' || s.kind === 'long') {
        var vh = Math.atan2(v.z, v.x), d = vh - RUN_HEAD;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        var hh = RUN_HEAD + d * 0.25;
        hv = { x: Math.cos(hh), y: 0, z: Math.sin(hh) };
      }
      var head = rigHeading(hv, dt);
      var az = rigAz(cam[0], dt, s.kind === 'slow' || s.kind === 'long' ? 6 : 3.2);
      var pos = orbitPos(bw, head, az, cam[1], cam[2]), look = add3(bw, scale3(v, 0.08));
      // along the zig-zag run the camera trails the ball's own path a third of a second behind, drawn in towards
      // the line's middle, so it glides up the line while the ball weaves from board to board in front of it
      var trail = (s.kind === 'fly' || s.kind === 'ride') && heroAt(t - 0.32);
      if (trail) {
        pos = { x: lerp(trail.x, 0, 0.45) + (s.i % 2 ? -1 : 1) * cam[0] * 8, y: trail.y - cam[2], z: trail.z + cam[1] * 0.75 };
        look = mix3(bw, add3(bw, { x: 0, y: -60, z: -900 }), 0.35);
      }
      // in the slow motion, frame the ball against the board it's about to break
      if (s.kind === 'slow' || s.kind === 'long') look = mix3(look, centreOf(S.PE), s.kind === 'slow' ? 0.4 : 0.25 * smooth(k));
      Cine.fovKick = (Cine.fovKick || 0) * Math.max(0, 1 - dt * 5);
      var roll = Math.max(-12, Math.min(12, -Rig.azv * 0.05)) + (s.kind === 'through' ? Math.sin(t * 2) * 3 : 0);
      // lead the targets by the ball's velocity: a spring trails a moving target by 2v/w, so this cancels the lag and
      // the camera holds its place round the ball while still easing through every change of direction
      var wp = s.kind === 'rush' || s.kind === 'through' || s.kind === 'slow' ? 9 : 6, wl = 11;
      // (capped, so a sudden burst of speed, like the rush at the glass, can't throw the camera through it)
      var lead = trail ? 0 : Math.min(1, (s.kind === 'rush' ? 120 : 420) / Math.max(1, speed * 2 / wp));
      rigTo(add3(pos, scale3(v, 2 / wp * lead)), add3(look, scale3(v, 2 / wl * lead)), cam[3] + Cine.fovKick, roll, dt, wp, wl);
      Cine.streaks = s.kind === 'slow' ? 0.05 : s.kind === 'through' || s.kind === 'rush' ? 1 : 0.2 + clamp01(speed / 2400) * 0.8;
      Cine.speed = s.kind === 'slow' ? 0 : clamp01(speed / 3000) * 0.7;
      if (s.kind === 'through' || s.kind === 'rush') Cine.aberration = Math.max(Cine.aberration, 0.35);
    }

    S.score = { pat: 0, update: journey };
    S.arena = { pat: 0, update: journey };
    S.matchpoint = { pat: 0, update: journey, exit: function () { Cine.timeScale = 1; } };

    /* ---------- Scenes 7 and 8: results, achievements, profile, chat, friends, invite (one space) ---------- */

    S.results = { pat: 0, build: function (g) {
      var rp = panel('cine-results', 'MATCH RESULTS');
      var rows = [[me.name, 7, 5, 'WIN'], ['Lunar', 7, 3, 'WIN'], ['Blocky', 5, 7, ''], ['Tess', 2, 7, ''], ['Gridlock', 0, 7, 'OUT']];
      rows.forEach(function (r, i) {
        var row = el('div', 'cine-result' + (r[3] === 'WIN' ? ' win' : r[3] === 'OUT' ? ' out' : ''), rp);
        row.appendChild(avatarArt(i + 2, 54));
        el('span', 'cine-result-name', row).textContent = r[0];
        el('span', 'cine-result-score', row).textContent = r[1] + ' – ' + r[2];
        el('span', 'cine-result-tag', row).textContent = r[3];
      });
      S.resultsPanel = plane(g, rp, 1100, 760, { x: -900, y: 0, z: 2600, ry: 15, cull: false });
      var tw = el('div', 'cine-toast cine-toast-world');
      el('strong', '', tw).textContent = 'Achievement unlocked';
      var first = ACH && ACH.list ? ACH.list()[0] : null;
      el('span', '', tw).textContent = first ? first.name : 'First Point';
      S.toastPlane = plane(g, tw, 520, 120, { x: 120, y: -60, z: 1400, s: 1.6, cull: false });

      // achievements, profile, chat, friends and invite: the same real data and look as the Tetris opening
      var wall = panel('cine-ach', 'ACHIEVEMENTS');
      var count = el('div', 'cine-panel-sub', wall);
      var grid = el('div', 'cine-grid', wall);
      var items = [];
      (ACH && ACH.list ? ACH.list() : []).forEach(function (a) {
        var card = el('div', 'cine-card tier-' + a.tier, grid);
        card.appendChild(ACH.badge(a.id, 56, false));
        el('span', 'cine-card-name', card).textContent = a.secret ? '???' : a.name;
        items.push(card);
      });
      S.achItems = items; S.achCount = count;
      S.achWall = plane(g, wall, 1900, 760, { x: 0, y: 0, z: 0, ry: 14, rx: 6, cull: false });
      buildSocial(g, S, me);
    }, enter: function () { S.achWall.x = 0; S.achWall.ry = 14; S.invite.op = 0; S.profPanel.x = 300; S.toasted = false; }, update: function (t, lt) {
      path([
        { t: 0, x: -200, y: -150, z: 3900, tx: -900, ty: 0, tz: 2600, fov: 54 },
        { t: 1.3, x: -1400, y: 100, z: 3800, tx: -900, ty: 0, tz: 2600, fov: 54 },
        { t: 2.1, x: 100, y: -40, z: 2300, tx: 120, ty: -60, tz: 1400, fov: 56, e: easeInOut },
        { t: 3.0, x: 300, y: 100, z: 950, tx: 200, ty: 60, tz: 0, fov: 54, e: easeIn }
      ], lt);
      var n = S.achItems.length, on = Math.floor(easeOut(span(lt, 2.0, 3.0)) * n);
      S.achItems.forEach(function (it, i) { it.classList.toggle('on', i < on); it.classList.toggle('pop', i === on - 1); });
      S.achCount.textContent = Math.min(n, on) + ' / ' + n + ' unlocked';
      S.toastPlane.op = smooth(span(lt, 1.0, 1.3));
    } };

    S.achievements = { pat: 0, update: function (t, lt) {
      socialCam(socialU(S, t));
      var n = S.achItems.length, on = Math.min(n, Math.floor(n * (0.6 + lt * 0.4)));
      S.achItems.forEach(function (it, i) { it.classList.toggle('on', i < on); it.classList.toggle('pop', i === on - 1); });
      S.achCount.textContent = Math.min(n, on) + ' / ' + n + ' unlocked';
      socialPanels(S, socialU(S, t));
    } };

    addSocialShots(S, me);

    /* ---------- Scene 9: modes and skulls (the real menu panel) ---------- */

    S.modes = { pat: 0, build: function (g) {
      var src = document.getElementById('menuPanel');
      var mp, ph = 900, pw = 760;
      if (src) {
        // measure the copy at the menu's normal width (the live panel can be mid-layout under the overlay)
        mp = src.cloneNode(true); pw = 760;
        var meas = el('div', '', document.body);
        meas.style.cssText = 'position:absolute;left:-9999px;top:0;width:' + pw + 'px;visibility:hidden';
        mp.classList.remove('hidden'); mp.style.width = pw + 'px'; mp.style.margin = '0';
        meas.appendChild(mp); ph = Math.min(1500, Math.ceil(mp.offsetHeight) || 900); meas.remove();
        S.modeCards = Array.prototype.slice.call(mp.querySelectorAll('.mode-card, .chip')).slice(0, 14);
        Array.prototype.forEach.call(mp.querySelectorAll('[id]'), function (e) { e.removeAttribute('id'); });
        mp.classList.remove('hidden'); mp.classList.add('cine-real');
        // the real skulls page (games-skulls.js builds it, hidden, at load)
        var sk = document.querySelector('.gskull-panel');
        if (sk) {
          var wall = sk.cloneNode(true);
          Array.prototype.forEach.call(wall.querySelectorAll('[id]'), function (e) { e.removeAttribute('id'); });
          wall.classList.add('cine-real');
          S.skullCards = Array.prototype.slice.call(wall.querySelectorAll('.gsk-card'));
          S.skullWall = plane(g, wall, 960, 720, { x: 0, y: 0, z: -2200, ry: 10, s: 1.5, cull: false });
        }
      } else { mp = panel('cine-modes', 'PICK A MODE'); S.modeCards = []; }
      S.skullCards = S.skullCards || [];
      S.modePanel = plane(g, mp, pw, ph, { x: 0, y: 0, z: 0, ry: -8, s: 1.5, cull: false });
    }, enter: function () { S.modePanel.x = 0; }, update: function (t, lt) {
      var h = S.modePanel.h * 1.5;
      path([{ t: 0, x: -700, y: -h * 0.5, z: 1000, tx: -150, ty: -h * 0.3, tz: 0, fov: 52 }, { t: 1.6, x: 600, y: h * 0.15, z: 1150, tx: 250, ty: h * 0.15, tz: 0, fov: 52 },
        { t: 2.0, x: 300, y: 0, z: -300, tx: 0, ty: 0, tz: -2200, fov: 56, e: easeIn }], lt);
      var n = S.modeCards.length, i = n ? Math.max(0, Math.floor(lt / (SPB / 2))) % n : -1;
      S.modeCards.forEach(function (c, j) { c.classList.toggle('cine-hl', j === i); });
      S.modePanel.x = lerp(0, -2400, easeIn(span(lt, 1.5, 2.0)));
    } };

    S.skulls = { pat: 0, update: function (t, lt) {
      path([{ t: 0, x: 300, y: 0, z: -300, tx: 0, ty: 0, tz: -2200, fov: 56 }, { t: 1.5, x: -500, y: -150, z: -1100, tx: -300, ty: -40, tz: -2200, fov: 54 },
        { t: 2.0, x: -100, y: 0, z: -2000, tx: -100, ty: 0, tz: -2200, fov: 64, e: easeIn }], lt);
      var b = Math.floor(lt / (SPB / 2)), n = S.skullCards.length;
      S.skullCards.forEach(function (c, j) { c.classList.toggle('cine-hl', n && (j * 5) % n <= b); });
      if (lt > 1.75) { Cine.flash = Math.max(Cine.flash, (lt - 1.75) * 3); Cine.tear = Math.max(Cine.tear, 1); }
    } };

    /* ---------- Scene 10: the final rally, then everything breaks apart ---------- */

    S.final = { pat: 0, build: function (g) {
      var f = makeCourt({ seed: 21, speed: 3.0, names: [me.name, 'Lunar'] });
      S.F = courtPlane(g, f, { x: 0, y: 0, z: 0, hero: true, cull: false });
      S.F.heroBall = true;
      S.mon = [];
      for (var i = 0; i < 6; i++) {
        var a = i * 1.05;
        S.mon.push(courtPlane(g, makeCourt({ seed: 30 + i, speed: 2.2 }), { x: Math.cos(a) * 1700, y: Math.sin(a) * 900, z: -1500 - i * 500, ry: (hash(i) - 0.5) * 60, s: 0.8 }));
      }
    }, enter: function () {
      var st = S.F.court.state, b = st.ball;
      // the ball comes back in from the opposite direction to the one it left in
      b.x = CW * 0.85; b.y = CH * 0.4; b.dx = -Math.abs(b.dx || 700) * 1.2; st.serveTimer = 0;
      S.F.court.cinematicMiss = false; S.F.hidden = false; S.F.noBall = true; S.F.returned = false;   // our ball flies back in (laterSegs) S.F.el.classList.remove('out'); S.F.banner.textContent = '';
      S.blasted = false; S.cut = -1; S.mon.forEach(function (it) { it.hidden = false; });
      snap(frontOf(S.F, 950, 40), centreOf(S.F));
    }, update: function (t, lt, u, dt) {
      var F = S.F, st = F.court.state, b = ballWorld(F), dir = st.ball.dx >= 0 ? 1 : -1;
      if (!F.returned && !S.blasted && t >= T_RETURN) { F.returned = true; F.noBall = false; }
      // the last point lands on the track's final impact: the ball is steered past the right paddle from 55.6 s
      if (t >= 55.6 && !S.blasted) {
        F.court.cinematicMiss = true;
        var bb = st.ball, k = span(t, 55.6, 56.3);
        bb.x = lerp(CW * 0.35, CW + 20, k * k); bb.y = CH * 0.5 + Math.sin(k * 4) * 40; bb.dx = 950; bb.dy = 0;
        F.court.speed = 0.0001;
      }
      // a hard cut to a new angle on every beat
      var cut = Math.floor(lt / SPB), mode = cut % 4, pos, look;
      if (mode === 0) { pos = add3(b, { x: -dir * 320, y: -40, z: 260 }); look = add3(b, { x: dir * 320, y: 0, z: 0 }); }
      else if (mode === 1) { pos = { x: F.x, y: F.y - 1100, z: F.z + 260 }; look = centreOf(F); }
      else if (mode === 2) { var pd = paddleWorld(F, dir > 0 ? 1 : 0); pos = add3(pd, { x: -dir * 190, y: -30, z: 230 }); look = pd; }
      else { pos = frontOf(F, 850, 40); look = centreOf(F); }
      if (!S.blasted) {
        if (cut !== S.cut) { S.cut = cut; snap(pos, look); Cine.tear = Math.max(Cine.tear, 0.7); Cine.aberration = Math.max(Cine.aberration, 0.6); }
        else chase(pos, look, dt, 8);
        Cine.cam.roll = (mode % 2 ? 1 : -1) * 6;
      }
      if (!S.blasted && t >= 56.3) {
        st.score[0]++; F.court.lastScore = st.score.slice(); F.court.speed = 1;
        S.blasted = true; S.blastAt = t;
        Cine.flash = 1; Cine.shake = 1.5; Cine.aberration = 1.4;
        F.flashAt = t; F.noBall = true;
        shatter(F);
        S.mon.forEach(function (it) { shatter(it); it.hidden = true; });
        snap(frontOf(F, 950, 40), centreOf(F));
      }
      if (S.blasted) {
        var k = easeOut(span(t, S.blastAt, S.blastAt + 1.6));
        Cine.cam.z = lerp(950, 9000, k); Cine.cam.roll = 0; lookAt(0, 0, -2000);
      }
      Cine.streaks = S.blasted ? 0 : 1; Cine.speed = S.blasted ? 0 : 0.6;
    } };
    S.final.enter = (function (base) { return function () { base(); var st = S.F.court.state; S.F.startTotal = st.score[0] + st.score[1]; }; })(S.final.enter);

    S.menu = { pat: 0, update: function (t, lt) {
      var c = Cine.cam; c.x = 0; c.y = 0; c.z = 9000; c.fov = 40; c.roll = 0; lookAt(0, 0, -2000);
      if (!S.menu.hit) { S.menu.hit = true; caption(); }
      logoFinale(lt);
      var k = smooth(span(lt, 0.45, 1.6));
      Cine.stage.style.opacity = (1 - k).toFixed(3);
      Cine.root.style.backgroundColor = 'rgba(0,0,0,' + (1 - k).toFixed(3) + ')';
      Cine.vhsEl.style.opacity = (1 - k * 0.85).toFixed(3);
      if (lt > 0.6 && !Cine.ending) { Cine.ending = true; Cine.root.classList.add('letting-go'); }
    }, enter: function () { S.menu.hit = false; window.scrollTo(0, 0); } };

    var shots = CUES.shots.map(function (s) {
      var shot = S[s.id];
      shot.id = s.id; shot.cue = s;
      var gid = s.group || s.id;
      shot.group = Cine.groups[gid] || group(gid);
      if (shot.build && !s.group) shot.build(shot.group);
      return shot;
    });
    Hero.segs = S.journey.concat(laterSegs(S));
    Cine.S = S;   // (for the ?cinematic testing aid)
    bakeCourts(shots);
    return shots;
  }

  // The ball's later appearances: it smacks into the results panel and bounces off out of shot, then flies back in
  // for the final rally.
  var T_RETURN = 53.38;
  function laterSegs(S) {
    var rp = S.resultsPanel, rc = toWorld(rp, rp.w / 2, rp.h * 0.42);
    rc.z += 12;
    return [
      { kind: 'bounce', t0: 41.0, t1: 41.3, from: { x: -260, y: -40, z: 3600 }, to: rc, ease: easeIn, onEnd: function () {
        var p = projectP(rc); if (p) { ring(p, 700); burst(p.x, p.y, 70, [320, 190, 285], 1.1); }
        rp.shakeUntil = Cine.t + 0.22; Cine.shake = Math.max(Cine.shake, 0.6); Cine.flash = Math.max(Cine.flash, 0.2); Cine.aberration = 1;
      } },
      { kind: 'away', t0: 41.3, t1: 41.85, from: rc, to: { x: -200, y: -1700, z: 3400 }, ease: easeOut },
      { kind: 'return', t0: 53.0, t1: T_RETURN, from: { x: -1100, y: -650, z: 700 }, to: function () { return ballWorld(S.F); }, arc: 150, ease: easeIn, onEnd: function () {
        var p = projectP(ballWorld(S.F)); if (p) { ring(p, 600); burst(p.x, p.y, 80, [320, 190, 285], 1.2); }
        Cine.shake = Math.max(Cine.shake, 0.7); Cine.flash = Math.max(Cine.flash, 0.3);
      } }
    ];
  }

  // The profile, chat, friends and invite panels (the same real data and look as the Tetris opening).
  function buildSocial(g, S, me) {
    var prof = panel('cine-profile', 'PROFILE');
    var row = el('div', 'cine-prof-row', prof);
    var av = el('div', 'cine-prof-av', row);
    av.appendChild(G.Profile && G.Profile.avatar ? G.Profile.avatar(me, 180) : avatarArt(1, 180));
    var info = el('div', 'cine-prof-info', row);
    el('div', 'cine-prof-name', info).textContent = me.name;
    el('div', 'cine-prof-lvl', info).textContent = 'LEVEL 12 · 4,820 XP';
    var bar = el('div', 'cine-prof-bar', info); S.profBar = el('i', '', bar);
    el('div', 'cine-panel-label', prof).textContent = 'THEME';
    var themes = el('div', 'cine-chips', prof);
    S.profThemes = ['Neon', 'Arcade', 'Midnight', 'Vapor', 'Static'].map(function (n) { var c = el('span', 'cine-chip', themes); c.textContent = n; return c; });
    el('div', 'cine-panel-label', prof).textContent = 'COLOUR';
    var sw = el('div', 'cine-swatches', prof);
    S.profSw = ['#c77dff', '#a020ff', '#7c6cff', '#4cc9ff', '#3d8bff', '#ff2fa6', '#28e8ff'].map(function (c) { var s = el('span', 'cine-sw', sw); s.style.background = c; return s; });
    S.profPanel = plane(g, prof, 1100, 720, { x: 300, y: 80, z: -2600, ry: -10, cull: false });

    var chat = panel('cine-chat', 'CHAT · #pong');
    S.chatList = el('div', 'cine-chat-list', chat);
    S.chatMsgs = [['Lunar', 'that angle was unreal'], ['Blocky', 'gg'], [me.name, 'rematch??'], ['Gridlock', 'rally of 69 lets go'], ['Tess', 'invite me next round'], [me.name, 'lobby up, join me']];
    S.chatPanel = plane(g, chat, 900, 760, { x: -900, y: 0, z: -4800, ry: 18, cull: false });

    var fr = panel('cine-friends', 'FRIENDS');
    el('div', 'cine-panel-sub', fr).textContent = '6 online · 2 in a match';
    S.friendRows = ['Lunar', 'Blocky', 'Tess', 'Gridlock', 'Cobalt', 'Lumen'].map(function (n, i) {
      var r = el('div', 'cine-friend', fr);
      r.appendChild(avatarArt(i + 3, 56));
      el('span', 'cine-friend-name', r).textContent = n;
      el('span', 'cine-friend-st s' + (i % 3), r).textContent = ['online', 'in a match', 'away'][i % 3];
      return r;
    });
    S.friendsPanel = plane(g, fr, 900, 820, { x: 700, y: 40, z: -6600, ry: -16, cull: false });

    var inv = panel('cine-invite', 'GAME INVITE');
    var ir = el('div', 'cine-prof-row', inv);
    ir.appendChild(avatarArt(3, 110));
    var iw = el('div', '', ir);
    el('div', 'cine-prof-name', iw).textContent = 'Lunar';
    el('div', 'cine-prof-lvl', iw).textContent = 'invited you to Pong · first to 7';
    var btns = el('div', 'cine-invite-btns', inv);
    el('span', 'cine-accept', btns).textContent = 'Accept';
    el('span', 'cine-decline', btns).textContent = 'Decline';
    S.invite = plane(g, inv, 860, 420, { x: 400, y: 0, z: -6000, cull: false, op: 0 });
  }

  /* The social run (achievements, profile, chat, friends) is one continuous move: a smooth spline through the panels
     over the whole stretch, in real seconds, so the camera never stops dead at a cut or snaps its aim to the next
     panel, and each panel comes to life (and steps aside) at its point on the run. Keys: u, camera x y z, look x y z, fov. */
  var SOCIAL_KEYS = [
    [0.00, 300, 100, 950, 150, 40, 0, 54], [0.18, -250, -80, 1000, -150, -20, 0, 54],
    [0.30, -100, -60, -700, 300, 80, -2600, 56], [0.40, 500, 110, -1450, 300, 80, -2600, 54], [0.48, 680, 140, -1700, 320, 80, -2600, 54],
    [0.60, -500, 30, -3600, -900, 0, -4800, 54], [0.70, -620, 40, -3800, -900, 0, -4800, 54],
    [0.80, -100, 0, -4300, 500, 30, -6300, 54], [0.88, 380, -40, -5300, 700, 40, -6600, 54], [1.00, 420, 0, -5450, 420, 0, -6000, 54]];
  function socialU(S, t) { var t0 = shotStart(S.achievements.cue), t1 = shotStart(S.modes.cue); return clamp01((t - t0) / (t1 - t0)); }
  function socialCam(u) {
    var K = SOCIAL_KEYS, i = 0;
    while (i < K.length - 2 && u > K[i + 1][0]) i++;
    var a = K[i], b = K[i + 1], p = K[i - 1], n = K[i + 2], h = b[0] - a[0], s = clamp01((u - a[0]) / h);
    var s2 = s * s, s3 = s2 * s, h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    function v(j) {   // Catmull-Rom with uneven key spacing; at rest at the very start and end
      var m0 = p ? (b[j] - p[j]) / (b[0] - p[0]) * h : 0, m1 = n ? (n[j] - a[j]) / (n[0] - a[0]) * h : 0;
      return h00 * a[j] + h10 * m0 + h01 * b[j] + h11 * m1;
    }
    var c = Cine.cam; c.x = v(1); c.y = v(2); c.z = v(3); c.fov = v(7); c.roll = 0;
    lookAt(v(4), v(5), v(6));
  }
  // the achievements wall and the profile slide aside just before the camera passes their planes; the invite drifts in
  function socialPanels(S, u) {
    var w = smooth(span(u, 0.16, 0.27)); S.achWall.x = lerp(0, -2600, w); S.achWall.ry = lerp(14, 70, w);
    S.profPanel.x = 300 + smooth(span(u, 0.46, 0.55)) * 1800;
    var inK = smooth(span(u, 0.88, 0.95)), outK = smooth(span(u, 0.95, 1));
    S.invite.op = inK; S.invite.x = lerp(1600, 400, inK); S.invite.z = lerp(-6000, -5700, outK); S.invite.ry = lerp(-30, 0, inK);
  }
  function addSocialShots(S, me) {
    S.profile = { pat: 0, update: function (t) {
      var u = socialU(S, t); socialCam(u); socialPanels(S, u);
      var beat = Math.floor(beatAt(t));
      S.profThemes.forEach(function (c, i) { c.classList.toggle('on', i === beat % S.profThemes.length); });
      S.profSw.forEach(function (c, i) { c.classList.toggle('on', i === (beat * 3) % S.profSw.length); });
      S.profBar.style.width = (40 + 50 * smooth(span(u, 0.32, 0.5))) + '%';
    } };
    S.chat = { pat: 0, update: function (t) {
      var u = socialU(S, t); socialCam(u); socialPanels(S, u);
      // messages arrive one at a time and stay (appended, not rebuilt), the newest one popping in
      var shown = Math.max(0, Math.min(S.chatMsgs.length, Math.floor((u - 0.56) / 0.045) + 1));
      if (S.chatList.childElementCount > shown) S.chatList.textContent = '';
      while (S.chatList.childElementCount < shown) {
        var m = S.chatMsgs[S.chatList.childElementCount];
        if (S.chatList.lastChild) S.chatList.lastChild.classList.remove('new');
        var r = el('div', 'cine-msg' + (m[0] === me.name ? ' mine' : '') + ' new', S.chatList);
        el('b', '', r).textContent = m[0];
        el('span', '', r).textContent = m[1];
      }
    }, enter: function () { S.chatList.textContent = ''; } };
    S.friends = { pat: 0, update: function (t) {
      var u = socialU(S, t); socialCam(u); socialPanels(S, u);
      var beat = Math.floor(beatAt(t) * 2);
      S.friendRows.forEach(function (r, i) { r.classList.toggle('lit', (beat + i) % 4 === 0); });
    } };
  }

  /* ---------- logo ---------- */

  // The logo sits on the cabinet's CRT. The shader paints the cabinet with a head-on camera (eye height CAB_EYE,
  // distance Cine.dist, vertical fov 40), so the screen's place in the frame is simple to work out; the logo is
  // drawn over it in screen space and can stay perfectly still while the world fades from under it.
  // lt: seconds since the logo began; st: since the subtitle began.
  function logoOnScreen(lt, st, alpha) {
    var L = Cine.logo, vh = innerHeight, k = vh / (2 * 0.36397 * Cine.dist);   // px per world unit at the cabinet
    alpha = alpha == null ? 1 : alpha;
    L.box.style.display = 'flex';
    var width = 0.34 * k;
    L.art.style.width = width + 'px';
    L.sub.style.fontSize = Math.max(10, width * 0.05) + 'px';
    var cy = vh / 2 - (CAB_SCREEN_Y - Cine.eye) * k;
    L.box.style.left = (innerWidth / 2) + 'px';
    L.box.style.top = (cy + (L.box.offsetHeight - L.art.offsetHeight) / 2) + 'px';
    // CRT warm-up: a couple of hard flickers and a squashed line before it settles
    var on = lt < 0 ? 0 : lt < 0.06 ? 1 : lt < 0.12 ? 0 : lt < 0.2 ? 0.7 : lt < 0.26 ? 0.1 : 1;
    L.art.style.opacity = (on * alpha).toFixed(3);
    L.art.style.transform = 'scaleY(' + (lt < 0.3 ? Math.max(0.05, lt * 3.3) : 1).toFixed(3) + ')';
    L.sub.style.opacity = st == null || st < 0 ? '0' : (smooth(span(st, 0, 0.8)) * alpha).toFixed(3);
  }

  function logoFinale(lt) {
    var L = Cine.logo, w = Math.min(innerWidth * 0.5, 820);
    L.box.style.display = 'flex';
    // the title's text box (the heading itself is a full-width block)
    var title = document.querySelector('.game-head .game-title'), r = null;
    if (title) { var rg = document.createRange(); rg.selectNodeContents(title); r = rg.getBoundingClientRect(); }
    var k = smooth(span(lt, 0.9, 1.9)), cx = innerWidth / 2, cy = innerHeight / 2;
    if (r && r.width) { cx = lerp(cx, r.left + r.width / 2, k); cy = lerp(cy, r.top + r.height / 2, k); w = lerp(w, r.width * 1.05, k); }
    L.art.style.width = w + 'px';
    // centre the art itself (not the art plus subtitle) on the target
    L.box.style.left = cx + 'px'; L.box.style.top = (cy + (L.box.offsetHeight - L.art.offsetHeight) / 2) + 'px';
    var flick = lt < 0.05 ? 1 : lt < 0.1 ? 0.2 : 1;
    L.art.style.opacity = (flick * (1 - smooth(span(lt, 1.6, 1.98)))).toFixed(3);
    L.art.style.transform = 'scale(' + (1 + 0.15 * (1 - smooth(span(lt, 0, 0.4)))).toFixed(3) + ')';
    L.sub.style.opacity = (smooth(span(lt, 0.2, 0.6)) * (1 - smooth(span(lt, 1.0, 1.6)))).toFixed(3);
    L.sub.style.fontSize = Math.max(11, w * 0.05) + 'px';
  }

  function hideLogo() { Cine.logo.box.style.display = 'none'; }

  function caption(big, small) {
    var c = Cine.caption;
    if (!big) { c.classList.remove('show'); return; }
    c.textContent = '';
    el('strong', '', c).textContent = big;
    el('span', '', c).textContent = small;
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
  }

  /* =================================================================
     Frame loop
     ================================================================= */

  function applyCamera() {
    var c = Cine.cam, vw = innerWidth, vh = innerHeight;
    var safeH = Math.min(vh, vw * 9 / 16), P = (safeH / 2) / Math.tan(c.fov * D2R / 2);
    var sx = 0, sy = 0, sr = 0;
    if (Cine.shake > 0.01) { sx = (Math.random() - 0.5) * 28 * Cine.shake; sy = (Math.random() - 0.5) * 28 * Cine.shake; sr = (Math.random() - 0.5) * 1.6 * Cine.shake; }
    Cine.shakeX = sx; Cine.shakeY = sy; Cine.shakeR = sr;
    Cine.view.style.perspective = P.toFixed(1) + 'px';
    Cine.world.style.transform = 'translate3d(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px,' + P.toFixed(1) + 'px) rotateZ(' + (c.roll + sr).toFixed(2) + 'deg) rotateX(' +
      c.pitch.toFixed(2) + 'deg) rotateY(' + c.yaw.toFixed(2) + 'deg) translate3d(' + (-c.x).toFixed(1) + 'px,' + (-c.y).toFixed(1) + 'px,' + (-c.z).toFixed(1) + 'px)';
    Cine.viewInfo = { P: P, tan: Math.tan(c.fov * D2R / 2), ax: vw / safeH, ay: vh / safeH };
    return Cine.viewInfo;
  }

  function layoutGroup(g, view) {
    g.items.forEach(function (it) {
      var cd = camDepth(it.x, it.y, it.z), vis = !it.hidden && it.op > 0.01;
      if (vis && it.cull) {
        var r = it.r * it.s;
        vis = cd.d > -r * 0.5 && Math.abs(cd.x) - r < Math.max(cd.d, 1) * view.tan * view.ax * 1.1 && Math.abs(cd.y) - r < Math.max(cd.d, 1) * view.tan * view.ay * 1.1;
      }
      it.visible = vis;
      it.el.style.visibility = vis ? '' : 'hidden';
      if (!vis) return;
      var jx = it.shakeUntil && Cine.t < it.shakeUntil ? (Math.random() - 0.5) * 40 : 0;
      it.el.style.transform = 'translate3d(' + (it.x + jx) + 'px,' + it.y + 'px,' + it.z + 'px) rotateY(' + it.ry + 'deg) rotateX(' + it.rx + 'deg) rotateZ(' + it.rz + 'deg) scale(' + it.s + ') translate(' + (-it.w / 2) + 'px,' + (-it.h / 2) + 'px)';
      it.el.style.opacity = it.op < 1 ? it.op.toFixed(3) : '';
      if (it.fog) it.fog.style.opacity = clamp01((cd.d - 1800) / 5000).toFixed(3);
    });
  }

  function shotIndexAt(t) {
    var idx = 0;
    for (var i = 0; i < Cine.shots.length; i++) if (shotStart(Cine.shots[i].cue) <= t) idx = i;
    return idx;
  }

  function frame(now) {
    if (!Cine.running) return;
    qualityFrame(now - Cine.lastNow);
    Cine.frameNo = (Cine.frameNo || 0) + 1;
    var dt = Math.min(0.05, Math.max(0, (now - Cine.lastNow) / 1000));
    Cine.lastNow = now;
    var audioT = Cine.hold == null ? Audio.clock() : null;
    if (audioT != null) { Cine.t = audioT; Cine.clockBase = now - audioT * 1000; }
    else Cine.t = Cine.hold != null ? Cine.hold : (now - Cine.clockBase) / 1000;
    var t = Cine.t;
    if (t >= CUES.end) { finish(false); return; }
    Audio.pump(t);

    var idx = shotIndexAt(t);
    if (idx !== Cine.shot) {
      var old = Cine.shots[Cine.shot], cur = Cine.shots[idx];
      if (old) { if (old.exit) old.exit(); if (old.group !== cur.group) old.group.el.style.display = 'none'; }
      Cine.shot = idx;
      cur.group.el.style.display = '';
      if (cur.enter) cur.enter();
      Cine.tear = Math.max(Cine.tear, 0.5);   // every cut gets a little VHS kick
    }
    var shot = Cine.shots[idx], s0 = shotStart(shot.cue), s1 = idx + 1 < Cine.shots.length ? shotStart(Cine.shots[idx + 1].cue) : CUES.end;
    var lt = t - s0, u = clamp01(lt / (s1 - s0));
    if (shot.cue.nominal) lt *= shot.cue.nominal / (s1 - s0);   // stretch the shot's moves to its slot

    var bt = beatAt(t);
    Cine.beat = bt >= 0 ? Math.exp(-(bt - Math.floor(bt)) * 5) : 0;
    var lvl = Audio.measure();
    Cine.level += ((lvl == null ? (bt >= 0 ? 0.3 + Cine.beat * 0.4 : 0.15) : lvl) - Cine.level) * Math.min(1, dt * 12);
    Cine.flash = Math.max(0, Cine.flash - dt * 2.6);
    Cine.shake = Math.max(0, Cine.shake - dt * 2.5);
    Cine.aberration = Math.max(0, Cine.aberration - dt * 2.2);
    Cine.tear = Math.max(0, Cine.tear - dt * 3);

    Cine.env = 1; Cine.speed = 0; Cine.streaks = 0; Cine.variant = 0; Cine.eye = CAB_EYE; Cine.timeScale = 1;
    shot.update(t, lt, u, dt);
    // hit-stop: on a big impact the camera holds still for a beat (Cine.hitStop seconds) while the effects play on
    if (Cine.hitStop > 0) { if (!Cine.camHeld) Cine.camHeld = Object.assign({}, Cine.cam); else Object.assign(Cine.cam, Cine.camHeld); Cine.hitStop -= dt; }
    else Cine.camHeld = null;

    var view = applyCamera();
    layoutGroup(shot.group, view);
    bakeStep(Q.level ? 4 : 6);
    simCourts(shot.group, dt);
    Bg.draw({ time: t, pat: shot.pat, level: Cine.level, beat: Cine.beat, flash: Math.min(0.14, Cine.flash * 0.45), env: Cine.env, tear: Cine.tear,
      speed: Cine.speed, variant: Cine.variant, P: view.P, cam: Cine.cam, dist: Cine.dist, eye: Cine.eye, crt: Cine.crt });
    drawFx(dt, t);
    drawBalls(shot.group, dt, t);   // (the CRT pixel too, and the hero ball between courts)
    // VHS: the chromatic split and tearing grow with hits and speed; a calm floor of it is always there
    // (the last shot settles: no split while the live menu fades in, which also keeps that hand-over smooth)
    // (two full-screen drop-shadows are costly, so the split is only on during hits and fast moves, never idling)
    var ab = Math.min(1.4, Cine.aberration), off = (ab * 5).toFixed(1);
    Cine.stage.style.filter = Cine.ending || ab < 0.08 || Q.level ? '' : 'drop-shadow(' + off + 'px 0 0 rgba(255,0,110,0.5)) drop-shadow(-' + off + 'px 0 0 rgba(0,220,255,0.45))';
    Cine.stage.style.transform = Cine.tear > 0.3 ? 'translateX(' + (Math.sin(t * 13) * 7 * Cine.tear).toFixed(1) + 'px) skewX(' + (Math.sin(t * 9) * 0.7 * Cine.tear).toFixed(2) + 'deg)' : '';
    Cine.raf = requestAnimationFrame(frame);
  }

  /* =================================================================
     Play / finish
     ================================================================= */

  function onKey(e) {
    if (!Cine.running) return;
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); return; }
    if (Cine.soundWanted && !Audio.on) setSound(true);
  }

  function play(fromSeconds) {
    if (Cine.running) return;
    G.Store.set(STORE_SEEN, Date.now());
    courtCount = 0;
    window.scrollTo(0, 0);
    buildStage();
    qualityStart();
    Cine.groups = {};
    Cine.shots = makeShots();
    Cine.shot = -1;
    Cine.running = true;
    Cine.ending = false;
    Cine.sparkBurst = false;
    Cine.hold = null;
    Hero.last = null; Hero.ghost = []; Rig.on = false; Cine.timeScale = 1; Cine.fovKick = 0;
    document.documentElement.classList.add('cine-open');
    if (window.PongMenuMusic) window.PongMenuMusic.hold(true);
    // The cinematic's boards would beep on every move and lock; hush the game's sound effects while it plays.
    if (G.Sound) { Cine.beepWas = G.Sound.beep; G.Sound.beep = function () {}; }
    document.addEventListener('keydown', onKey, true);
    var startT = +fromSeconds || 0;
    Cine.t = startT;
    Cine.lastNow = performance.now();
    Cine.clockBase = Cine.lastNow - startT * 1000;
    setSound(!(G.Sound && G.Sound.isMuted && G.Sound.isMuted()));
    Cine.skipBtn.focus({ preventScroll: true });
    Cine.raf = requestAnimationFrame(frame);
  }

  // skipped: the person pressed Skip (everything fades fast). Otherwise the film ended on the live menu and the
  // music's tail keeps fading out under it.
  function finish(skipped) {
    if (!Cine.running) return;
    Cine.running = false;
    cancelAnimationFrame(Cine.raf);
    var last = CUES.segments[CUES.segments.length - 1];
    Audio.close(skipped ? 0.3 : Math.max(0.5, (last.fadeOut ? last.fadeOut[1] : CUES.end) - CUES.end), !skipped);
    // the menu loop: already cued on the audio clock if the film ran to the end with sound; otherwise start it now
    if (window.PongMenuMusic) { window.PongMenuMusic.hold(false); window.PongMenuMusic.startNow(skipped ? 1.2 : 1.5); }
    if (G.Sound && Cine.beepWas) G.Sound.beep = Cine.beepWas;
    document.removeEventListener('keydown', onKey, true);
    var root = Cine.root;
    root.classList.add(skipped ? 'closing' : 'closed');
    setTimeout(function () { root.remove(); }, skipped ? 450 : 50);
    document.documentElement.classList.remove('cine-open');
    Cine.groups = {}; Cine.shots = null; Cine.bolts = []; Cine.sparks = []; Cine.frags = []; Cine.flames = []; Cine.rings = []; Cine.transits = [];
    Cine.glass = []; Cine.ballQ = []; Cine.sprites = []; Cine.crack = null; Hero.segs = []; Rig.on = false;
    var btn = document.getElementById('pongCinematicBtn');
    if (btn && skipped) btn.focus({ preventScroll: true });
  }

  function init() {
    var btn = document.getElementById('pongCinematicBtn');
    if (btn) btn.addEventListener('click', function () { play(0); });
    var forced = location.search.match(/[?&]cinematic(?:=(\d+(?:\.\d+)?))?(?:&|$)/);
    if (forced) {
      play(forced[1] || 0);
      // ?cinematic=A&hold=B: run from A seconds and freeze the clock at B seconds (for checking one frame)
      var hold = location.search.match(/[?&]hold=(\d+(?:\.\d+)?)/);
      if (hold) setTimeout(function () { Cine.hold = +hold[1]; setSound(false); }, Math.max(0, (+hold[1] - (+forced[1] || 0)) * 1000));
      return;
    }
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // First visit only (players who have been before but never saw it get it too), and not for people who asked for
    // less motion. Someone arriving on an invite link sees it as well, with the host's ball: wait a moment for the
    // lobby's hello to bring it (pong.js), then play.
    if (G.Store.get(STORE_SEEN, 0) || reduced) return;
    if (App.fromInvite) {
      var waited = 0, poll = setInterval(function () {
        waited += 200;
        if (Cine.running || G.Store.get(STORE_SEEN, 0)) { clearInterval(poll); return; }
        if ((App.hostBall && App.hostBall()) || waited >= 6000) { clearInterval(poll); play(0); }
      }, 200);
      return;
    }
    if (!(App.lobby && App.lobby())) play(0);
  }

  window.PongCinematic = { play: play, skip: function () { finish(true); }, playing: function () { return Cine.running; }, CUES: CUES };
  if (/[?&]cinematic\b/.test(location.search)) window.PongCinematic.state = function () { Cine.bgDraw = Bg; Cine.audio = Audio; return Cine; };   // testing aid
  // testing aid: run the film's frames by hand (silently) up to `to` seconds at `fps`, then hold there
  if (/[?&]cinematic\b/.test(location.search)) window.PongCinematic.step = function (to, fps) {
    if (!Cine.running) return;
    setSound(false); Cine.hold = null;
    var now = Cine.lastNow;
    while (Cine.running && Cine.t < to) { now += 1000 / (fps || 60); frame(now); cancelAnimationFrame(Cine.raf); }
    Cine.hold = to; Cine.raf = requestAnimationFrame(frame);
  };
  init();
})();
