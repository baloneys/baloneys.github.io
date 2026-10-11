// tetris-cinematic.js: the Tetris opening cinematic (60 seconds), rendered live in the page.
//
// Twenty shots in ten scenes, after Sean's direction (Hotline Miami grit, VHS, the game's own purple look):
//   1  arcade cabinet in the dark, the camera dollies in; "tetris" flickers on its CRT, the subtitle fades in,
//      the world goes dark around the words, silence, a spark streaks across and bursts into the drop
//   2  real boards launch at the lens; a pixel car on a grid road with boards streaking past; one board blocks
//      the road and the camera flies into it
//   3  close on the game: a falling piece is followed down the well into a Tetris; the rows flash white
//   4  streak ascension: 2x, 6x and 10x panels rushing at the camera
//   5  multiplayer: four boards floating in space, an attack bolt, garbage, ELIMINATED, the board shatters,
//      a second attack whips us out
//   6  achievements unlocking, then the profile
//   7  chat, friends and an invite
//   8  mode select, then the skulls
//   9  a montage of everything, then everything recedes into the shader on the final impact
//   10 the logo returns and the real menu fades in under it, live and playable
//
// How it is built (cheap to render, all in the page):
//   - Boards are the real game: tetris.js lends its Player rules, board renderer and CPU through
//     TetrisApp.cinematicKit(), and CPUs genuinely play every board. Nothing touches the running game.
//   - 3D is CSS perspective: boards and panels are planes in a world div; a camera rig (x, y, z, yaw, pitch, roll,
//     fov) moves it. The background is one WebGL shader that ray-casts with the same camera, so the hex sky and the
//     road's floor sit in the same 3D space as the DOM planes.
//   - The VHS layer (scanlines, grain, tracking noise, tearing, chromatic aberration) reacts to hits and speed.
//   - Sparks, attack bolts, shatter fragments and speed lines are a 2D canvas over the top.
//
// Music: CUES.track is a cut of "tetris cinematic.mp3" made by copying whole MP3 frames (no re-encode). The file
// holds two pieces: the build and drop (0 to 55.8 s), then the track's later break. The player splices them on a
// beat (CUES.segments) so the final impact lands on that break, then the break fades out under the live menu.
// The beat grid (175 BPM, beat 0 = the drop at 11.236 s) times the shots. Without audio everything still runs.
// The source track is a commercial release: keep it local, or point CUES.track at a cleared file before publishing.
//
// Playback: once per browser (localStorage games_tetris_cinematic_seen), then only from the menu's
// "Watch cinematic" button. Skip button, Esc or Enter skip it. Testing aids: ?cinematic=SECONDS plays from there;
// &hold=SECONDS freezes the clock at that moment.
//
// API (window.TetrisCinematic): play(fromSeconds), skip(), playing(), CUES
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

  // Timed to Sean's temp sound package (Balcade_Temp_60s: music + original SFX, cue sheet included). The master
  // already carries the effects, so the synthesised ones (sfxScore) stay off while it plays.
  var CUES = {
    track: 'Balcade_Cinematic_60s_MenuReady.mp3',   // its last 1.7 s blend into the menu loop (tetris-menu-music.js)
    credit: 'Music: "runner2088" by wekont (CC BY 4.0), edited',
    trackHasSfx: true,
    bpm: 89,
    offset: 12.5,        // cinematic seconds of beat 0 (the drop's first hit)
    end: 60,
    volume: 0.9,
    sfx: 0.5,
    // Where the file plays: t0..t1 on the cinematic clock, from buffer second `at`.
    segments: [{ t0: 0, t1: 60, at: 0 }],
    duck: [],            // the track has its own silence before the spark
    spark: [11.14, 12.5],
    // nominal: the length each shot's internal moves were written for; they stretch or squeeze to the real slot
    shots: [
      { id: 'cabinet', at: 0, nominal: 4 },
      { id: 'logo', at: 4.0, group: 'cabinet' },
      { id: 'subtitle', at: 7.0, group: 'cabinet' },
      { id: 'spark', at: 10.0, group: 'cabinet' },
      { id: 'launch', beat: 0, nominal: 2.743 },
      { id: 'road', beat: 4, nominal: 4.114 },
      { id: 'gameplay', at: 23.2, group: 'road' },
      { id: 'clear', at: 25.6, group: 'road', nominal: 2.743 },
      { id: 'streak', at: 27.3, nominal: 4.114 },
      { id: 'multiplayer', at: 31.0, nominal: 4.114 },
      { id: 'eliminated', at: 34.7, group: 'multiplayer', nominal: 1.372 },
      { id: 'attack', at: 36.6, group: 'multiplayer', nominal: 2.743 },
      { id: 'achievements', at: 38.0, nominal: 4.114 },
      { id: 'profile', at: 41.0, group: 'achievements', nominal: 1.372 },
      { id: 'chat', at: 43.0, group: 'achievements', nominal: 2.743 },
      { id: 'friends', at: 45.5, group: 'achievements', nominal: 2.743 },
      { id: 'modes', at: 48.0, nominal: 2.743 },
      { id: 'skulls', at: 51.0, group: 'modes', nominal: 2.743 },
      { id: 'montage', at: 54.0, nominal: 4.262 },
      { id: 'menu', at: 58.0, group: 'montage' }
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
    '      vec2 cell=floor((uv*0.5+0.5)*vec2(20.0,15.0)); float fall=mod(floor(u_time*4.0+cell.x*3.7),19.0)-2.0;',
    '      float blk=step(0.62,fract(sin(cell.x*91.3)*437.1))*step(abs(cell.y-(14.0-fall)),0.5)+step(0.8,fract(sin(cell.x*13.1+cell.y*7.7)*91.3))*step(cell.y,2.5);',
    '      sv+=mix(vec3(0.5,0.2,1.0),vec3(1.0,0.25,0.65),fract(cell.x*0.37))*clamp(blk,0.0,1.0)*0.45*(1.0-u_crt);',
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
      var shared = window.TetrisMenuMusic && window.TetrisMenuMusic.context();
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
        if (window.TetrisMenuMusic && t < CUES.end) window.TetrisMenuMusic.cue(now + (CUES.end - t));
      }
      return ctx.state === 'running';
    },

    stopSources: function () {
      this.sources.forEach(function (s) { try { s.stop(); } catch (e) { /* already stopped */ } });
      this.sources = [];
    },

    stop: function (fade, keepCue) {
      this.on = false;
      if (!keepCue && window.TetrisMenuMusic) window.TetrisMenuMusic.cancelCue();
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

  var BW = (K.COLS + K.SIDE * 2) * K.CELL, BH = K.ROWS * K.CELL, HEAD = 40;   // board canvas 504 x 560 + name bar


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
    sparks: [], bolts: [], frags: [],
    soundWanted: true, beepWas: null, ending: false,

    needSound: function () { if (this.hint) this.hint.classList.remove('hidden'); }
  };

  function buildStage() {
    var root = el('div', 'cine');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Tetris opening cinematic');
    var stage = el('div', 'cine-stage', root);
    Cine.bgCanvas = el('canvas', 'cine-bg', stage);
    Cine.view = el('div', 'cine-view', stage);
    Cine.world = el('div', 'cine-world', Cine.view);
    Cine.fx = el('canvas', 'cine-fx', stage);
    Cine.fxCtx = Cine.fx.getContext('2d');
    Cine.toasts = el('div', 'cine-toasts', stage);
    Cine.stage = stage;
    // The pixel logo: drawn small and scaled up with hard pixels, pink with a cyan ghost.
    var logo = el('div', 'cine-logo', root);
    var lc = el('canvas', 'cine-logo-art', logo);
    var sub = el('div', 'cine-logo-sub', logo);
    sub.textContent = 'falling blocks killed my family';
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
    x.fillStyle = '#28e8ff'; x.fillText('tetris', w / 2 - 2, h / 2 + 1);
    x.fillStyle = '#ff2fa6'; x.fillText('tetris', w / 2 + 1, h / 2);
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
    var g = { id: id, el: el('div', 'cine-group', Cine.world), items: [], boards: [] };
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

  // A live board on a plane: the game's own canvas, with the cinematic rim, gloss and distance fog.
  function boardPlane(g, p, o) {
    o = o || {};
    var node = el('div', 'cine-board' + (o.hero ? ' hero' : ''));
    if (o.color) node.style.setProperty('--board-color', o.color);
    var head = el('div', 'cine-board-head', node);
    el('span', 'cine-board-name', head).textContent = p.name;
    head.appendChild(p.ui.lives);
    var face = el('div', 'cine-board-face', node);
    face.appendChild(p.ui.canvas);
    el('div', 'cine-gloss', face);
    var rows = el('div', 'cine-rows', face);
    var fog = el('div', 'cine-fog', node);
    var it = plane(g, node, BW, BH + HEAD, o);
    it.board = p; it.face = face; it.fog = fog; it.rows = rows;
    g.boards.push(it);
    return it;
  }

  /* ---------- boards: real Players, played by real CPUs ---------- */

  var BOT_NAMES = ['Blocky', 'Tess', 'Gridlock', 'Spin', 'Cobalt', 'Lunar', 'Pixel', 'Stack', 'Drop', 'Lumen', 'Vex', 'Orbit'];
  var botCount = 0;

  function makePlayer(o) {
    o = o || {};
    var p = new K.Player({ id: 'cine' + botCount, name: o.name || BOT_NAMES[botCount % BOT_NAMES.length], palette: o.palette || K.randomPalette(),
      local: true, controls: K.NO_KEYS, lives: 1, versus: !!o.versus, skulls: [] });
    botCount++;
    var cv = document.createElement('canvas');
    cv.width = BW; cv.height = BH;
    cv.className = 'cine-canvas';
    p.ui = { card: document.createElement('div'), canvas: cv, ctx: cv.getContext('2d'), stats: document.createElement('div'),
      timers: document.createElement('div'), lives: el('span', 'cine-board-lives'), shownTimers: '' };
    if (o.level !== null) p.cpu = K.cpuBrain(o.level || 'ultra');
    p.f.noStreaks = !o.streaks;   // the No Streaks rule flag: streak effects only where a shot wants them
    p.speed = o.speed || 1.5;
    if (o.warm) warm(p, o.warm);
    if (o.stack) stageStack(p, o.stack);
    return p;
  }

  function stackTop(p) {
    for (var r = 0; r < K.ROWS; r++) if (p.board[r].some(function (v) { return v; })) return r;
    return K.ROWS;
  }

  // One cinematic step of a board: the game's gravity and lock rules, with our own lock handler.
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
    if (p.keepTall) return;
    // A board that tops out (or gets too tall to look good) quietly starts over; cinematics have no game over.
    if (res.toppedOut || stackTop(p) < 5) { var keep = p.score; p.reset(true); p.score = keep; stageStack(p, 5); }
  }

  function warm(p, seconds) {
    for (var k = 0; k < seconds * 30; k++) sim(p, 1 / 30 / (p.speed || 1));
  }

  // A believable mid-game stack: n rows of game blocks with a hole per row, so boards never open empty.
  function stageStack(p, n) {
    for (var r = K.ROWS - n; r < K.ROWS; r++) {
      var hole = Math.floor(Math.random() * K.COLS);
      for (var c = 0; c < K.COLS; c++) p.board[r][c] = c === hole ? 0 : 1 + Math.floor(Math.random() * 7);
    }
    if (p.piece && p.collides(p.piece.x, p.piece.y, p.piece.rot)) p.piece.y = 0;
  }

  function fillRows(p, n) {
    for (var r = K.ROWS - n; r < K.ROWS; r++) {
      var hole = Math.floor(Math.random() * K.COLS);
      for (var c = 0; c < K.COLS; c++) p.board[r][c] = c === hole ? 0 : K.GARBAGE;
    }
    if (p.piece && p.collides(p.piece.x, p.piece.y, p.piece.rot)) p.piece.y = 0;
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
    var k = v.P / cd.d, sx = cd.x * k, sy = cd.y * k, r = Cine.cam.roll * D2R;
    return { x: innerWidth / 2 + sx * Math.cos(r) - sy * Math.sin(r), y: innerHeight / 2 + sx * Math.sin(r) + sy * Math.cos(r), s: k, d: cd.d };
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

  // A board breaking into pixel fragments that tumble back into the dark.
  function shatter(item) {
    var p = project(item.x, item.y, item.z);
    if (!p) return;
    var src = item.board.ui.canvas, snap = document.createElement('canvas');
    snap.width = src.width; snap.height = src.height;
    snap.getContext('2d').drawImage(src, 0, 0);
    var cols = 14, rows = 16, tw = src.width / cols, th = src.height / rows, s = p.s * item.s;
    var left = p.x - (BW / 2) * s, top = p.y - ((BH + HEAD) / 2 - HEAD) * s;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var cx = left + (c + 0.5) * tw * s, cy = top + (r + 0.5) * th * s;
      Cine.frags.push({ img: snap, sx: c * tw, sy: r * th, sw: tw, sh: th, x: cx, y: cy, w: tw * s, h: th * s,
        vx: (cx - p.x) * rand(0.6, 1.6), vy: (cy - p.y) * rand(0.6, 1.6) - 60, spin: rand(-4, 4), a: 0, age: 0, life: rand(0.9, 1.6) });
    }
    item.hidden = true;
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

  function makeShots() {
    var S = {}, me = (G.Profile && G.Profile.get()) || { name: 'Player' };

    /* ---------- Scene 1: the arcade cabinet (painted in the shader, head-on the whole time) ---------- */

    // The dolly: from a small silhouette at the far end of the warehouse, easing to a dead stop with the
    // controls on the bottom edge of the frame. Straight in: no sideways drift, no roll.
    function dolly(t) { return lerp(15, CAB_STOP, easeOut(span(t, 0, 3.9))); }

    S.cabinet = { pat: 3, update: function (t, lt) {
      Cine.dist = dolly(lt); Cine.crt = 0;
      Cine.env = smooth(span(lt, 0, 1.2));
    } };

    S.logo = { pat: 3, update: function (t, lt) {
      Cine.dist = CAB_STOP; Cine.crt = smooth(span(lt, 0, 0.3));
      logoOnScreen(lt, lt - 1.3);
    } };

    S.subtitle = { pat: 3, update: function (t, lt) {
      Cine.dist = CAB_STOP;
      // the warehouse and the cabinet go dark (the CRT last); the words stay exactly where they are
      var dark = smooth(span(lt, 0.4, 2.4));
      Cine.env = 1 - dark; Cine.crt = 1 - smooth(span(lt, 1.2, 2.4));
      logoOnScreen(3 + lt, 1.7 + lt);
    } };

    S.spark = { pat: 2, update: function (t, lt) {
      Cine.dist = CAB_STOP; Cine.env = 0;
      logoOnScreen(6 + lt, 4.7 + lt, 1 - smooth(span(lt, 0.1, 0.8)));
    }, exit: function () { hideLogo(); } };

    /* ---------- Scene 2: boards launch, then the road ---------- */

    S.launch = { pat: 0, build: function (g) {
      for (var i = 0; i < 11; i++) {
        var p = makePlayer({ warm: 6 + i, stack: 3 + (i % 5), speed: 2 });
        var near = i % 3 === 0;
        boardPlane(g, p, { x: (hash(i * 2.1) - 0.5) * (near ? 1100 : 2600), y: (hash(i * 5.7) - 0.5) * (near ? 700 : 1500), z: -900 - i * 1050,
          ry: (hash(i * 9.1) - 0.5) * 50, rx: (hash(i * 4.4) - 0.5) * 30, rz: (hash(i * 3.3) - 0.5) * 20, spin: (hash(i) - 0.5) * 40 });
      }
    }, update: function (t, lt, u) {
      path([{ t: 0, x: 0, y: 0, z: 1600, tz: -1e5, fov: 62, roll: -6 }, { t: 2.743, x: 0, y: 0, z: -11500, tz: -1e5, fov: 78, roll: 8, e: function (k) { return k * k * 0.55 + k * 0.45; } }], lt);
      Cine.cam.yaw += Math.sin(lt * 3) * 4; Cine.cam.pitch += Math.cos(lt * 2.4) * 3;
      Cine.env = 0.2 + 0.8 * easeOut(span(lt, 0, 0.5));
      Cine.speed = 0.6 + u * 0.6; Cine.streaks = 0.5 + u;
      var nearest = 1e9;
      S.launch.group.items.forEach(function (it) { it.ry += it.spin * 0.016; var d = camDepth(it.x, it.y, it.z).d; if (d > 0) nearest = Math.min(nearest, d); });
      Cine.aberration = Math.max(Cine.aberration, clamp01(1 - nearest / 1300));
      if (lt > 2.5) Cine.tear = Math.max(Cine.tear, 0.8);
    } };

    S.road = { pat: 1, build: function (g) {
      S.roadBoards = [];
      for (var i = 0; i < 12; i++) {
        var left = i % 2 === 0;
        var p = makePlayer({ warm: 5 + i, stack: 4 + (i % 4), speed: 1.8 });
        var it = boardPlane(g, p, { x: (left ? -1 : 1) * (1100 + hash(i) * 900), y: -560 - hash(i * 3) * 500, z: -1600 - i * 950, ry: left ? 38 : -38, s: 1.2 });
        it.baseX = it.x; it.fly = i % 4 === 1 || i % 4 === 2; it.side = left ? -1 : 1;
        S.roadBoards.push(it);
      }
      // the board that blocks the road: we fly into it for the gameplay close-up
      S.hero = makePlayer({ name: me.name, palette: K.myPalette(), level: null });
      S.heroItem = boardPlane(g, S.hero, { x: 0, y: -420, z: -12600, hero: true, cull: false });
    }, enter: function () { prepTetris(S.hero); S.hero.piece.y = -4; }, update: function (t, lt) {
      // the camera drives low down the road on its own (the car is gone; everything else stays)
      var k = span(lt, 0, 4.114), carZ = -9000 * (easeIn(k) * 0.6 + k * 0.4), carX = Math.sin(lt * 2.2) * 120;
      var lunge = easeIn(span(lt, 3.2, 4.114)), c = Cine.cam;
      c.x = carX * 0.5 + Math.sin(lt * 1.3) * 60; c.y = lerp(-230, -420, lunge); c.z = lerp(carZ + 780, -12600 + 560, lunge);
      c.fov = lerp(62, 56, lunge); c.roll = Math.sin(lt * 1.7) * 4 * (1 - lunge);
      lookAt(lerp(carX * 0.3, 0, lunge), lerp(-170, -420, lunge), lerp(carZ - 2500, -12600, lunge));
      S.roadBoards.forEach(function (it) {
        var ahead = c.z - it.z;
        if (it.fly) it.x = it.baseX - it.side * clamp01(1 - (ahead - 600) / 2600) * (Math.abs(it.baseX) - 520);
      });
      Cine.speed = 0.25 + lunge;
      Cine.streaks = 0.3 + lunge;
    } };

    /* ---------- Scene 3: the gameplay close-up, a falling piece, a Tetris ---------- */

    // (prepared when the road shot starts; this covers starting the film part-way through)
    S.gameplay = { pat: 0, enter: function () { if (!S.hero.scripted) prepTetris(S.hero); }, update: function (t, lt, u) {
      var p = S.hero, item = S.heroItem;
      if (p.scripted && p.piece) p.piece.y = Math.min(16, Math.max(-1, Math.floor(lerp(-1, 16.999, Math.pow(u, 1.1)))));
      var px = pieceWorldX(item, p), py = pieceWorldY(item, p), c = Cine.cam;
      // from straight on (the end of the road) to an angled shot riding down the well with the piece
      var k = easeInOut(span(lt, 0, 1.2));
      c.x = lerp(0, px + 260, k); c.y = lerp(-420, py - 130, k); c.z = lerp(-12600 + 560, -12600 + 420, k);
      c.roll = lerp(0, -5, k); c.fov = 56;
      lookAt(lerp(0, px - 30, k), lerp(-420, py + 20, k), -12600);
      S.gpCam = { x: c.x, y: c.y, z: c.z, tx: px - 30, ty: py + 20 };
      pieceGlow(item, p);
    } };

    S.clear = { pat: 0, update: function (t, lt) {
      var p = S.hero, item = S.heroItem;
      if (!S.clear.done) {
        S.clear.done = true;
        if (p.piece) { p.piece.y = 16; p.scripted = false; p.fall = 0; }
        var rows = fullRowsAfterLock(p);
        onLock(p, p.lock());
        S.clear.rows = rows; S.clear.at = t;
        Cine.flash = 0.7; Cine.shake = 1.4; Cine.aberration = 1; Cine.tear = 1;
        p.cpu = K.cpuBrain('ultra');
        var sp = project(item.x, item.y + 200, item.z);
        if (sp) burst(sp.x, sp.y, 160, [285, 320, 190], 1.4);
      }
      pieceGlow(item, null);
      rowFlash(item, S.clear.rows, (t - S.clear.at) / 1.6);
      var from = S.gpCam || { x: 386, y: -306, z: -12180, tx: 96, ty: -156 };
      var k = easeOut(span(lt, 0.05, 1.6)), c = Cine.cam;
      c.x = lerp(from.x, -260, k); c.y = lerp(from.y, -480, k); c.z = lerp(from.z, -12600 + 980, k); c.roll = lerp(-5, 3, k); c.fov = 52;
      lookAt(lerp(from.tx, 0, k), lerp(from.ty, -420, k), -12600);
      // the flash swells into a white-out that hands over to the streaks
      Cine.flash = Math.max(Cine.flash, smooth(span(lt, 2.0, 2.743)) * 1.1);
    }, enter: function () { S.clear.done = false; }, exit: function () { rowFlash(S.heroItem, [], 1); } };

    /* ---------- Scene 4: streak ascension ---------- */

    S.streak = { pat: 0, build: function (g) {
      S.badges = [[2, 'STREAK', -1400, 0.7, -260, 120], [6, 'STREAK', -4300, 1.3, 330, -150], [10, 'STREAK', -8200, 2.6, -80, 40]].map(function (b, i) {
        var cv = el('canvas', 'cine-badge');
        cv.width = 520; cv.height = 340; cv.dataset.n = b[0]; cv.dataset.label = b[1];
        var it = plane(g, cv, 520, 340, { x: b[4], y: b[5], z: b[2], s: b[3], ry: (i - 1) * 12, cull: false });
        it.heat = i / 2;
        return it;
      });
    }, update: function (t, lt) {
      // ease up to each panel, then lunge past it: faster every time
      path([
        { t: 0, x: 0, y: 0, z: 900, tx: -260, ty: 120, tz: -1400, fov: 50 },
        { t: 1.1, x: -150, y: 60, z: -700, tx: -260, ty: 120, tz: -1400, e: easeOut },
        { t: 1.45, x: 200, y: -40, z: -2600, tx: 330, ty: -150, tz: -4300, e: easeIn },
        { t: 2.35, x: 260, y: -110, z: -3300, tx: 330, ty: -150, tz: -4300, e: easeOut },
        { t: 2.65, x: 0, y: 0, z: -6200, tx: -80, ty: 40, tz: -8200, e: easeIn },
        { t: 4.114, x: -70, y: 40, z: -7650, tx: -80, ty: 40, tz: -8200, fov: 60, e: easeIn }
      ], lt);
      Cine.cam.roll = Math.sin(lt * 2) * 5;
      Cine.flash = Math.max(Cine.flash, 1 - span(lt, 0, 0.5));
      S.badges.forEach(function (it) { paintBadge(it.el, t, it.heat); });
      Cine.env = 0.9;
      Cine.variant = 0.6;
      Cine.streaks = (lt > 1.1 && lt < 1.5) || (lt > 2.35 && lt < 2.7) ? 1 : 0.2;
      if (lt > 3.6) { Cine.aberration = Math.max(Cine.aberration, (lt - 3.6) * 1.6); Cine.tear = Math.max(Cine.tear, (lt - 3.6) * 1.5); }
      if (Math.random() < 0.3) {
        var b = S.badges[lt < 1.4 ? 0 : lt < 2.6 ? 1 : 2], sp = project(b.x, b.y, b.z);
        if (sp) burst(sp.x + rand(-1, 1) * 260 * sp.s * b.s, sp.y + rand(-1, 1) * 170 * sp.s * b.s, 3, [190, 320], 0.5);
      }
    } };

    /* ---------- Scene 5: multiplayer ---------- */

    S.multiplayer = { pat: 0, build: function (g) {
      var spots = [[-900, -60, -400, 22], [1400, 220, -2900, -24], [-1700, -380, -4600, 16], [2300, -300, -1500, -38]];
      var names = [me.name, 'Blocky', 'Lunar', 'Gridlock'];
      S.mp = spots.map(function (s, i) {
        var pal = K.randomPalette();
        var p = makePlayer({ name: names[i], palette: pal, versus: true, warm: 6 + i * 2, stack: 5 + i, speed: 1.6 });
        return boardPlane(g, p, { x: s[0], y: s[1], z: s[2], ry: s[3], color: pal.top });
      });
    }, enter: function () {
      S.multiplayer.fired = false;
      var b = S.mp[1]; b.board.keepTall = true; b.board.alive = true; b.board.eliminated = false; b.hidden = false; b.el.classList.remove('out');
      if (!b.board.cpu) { b.board.cpu = K.cpuBrain('ultra'); b.board.level = 1; b.board.speed = 1.6; }
    }, update: function (t, lt) {
      var A = S.mp[0], Bb = S.mp[1];
      // close on player one, pull back and swing round to reveal the other three, then chase the attack
      path([
        { t: 0, x: -760, y: -60, z: 80, tx: -900, ty: -60, tz: -400, fov: 50 },
        { t: 2.2, x: 300, y: -380, z: 2300, tx: 200, ty: -100, tz: -2400, fov: 62 },
        { t: 3.1, x: 900, y: -100, z: 600, tx: 1200, ty: 120, tz: -2600, fov: 56 },
        { t: 4.114, x: 1350, y: 200, z: -2250, tx: 1400, ty: 220, tz: -2900, fov: 52, e: easeIn }
      ], lt);
      Cine.cam.roll += Math.sin(lt * 1.5) * 3;
      if (!S.multiplayer.fired && t >= 33.3) {
        S.multiplayer.fired = true;
        bolt({ x: A.x, y: A.y, z: A.z }, { x: Bb.x, y: Bb.y, z: Bb.z }, t, 0.9, function () {
          Cine.flash = 0.6; Cine.shake = 1; Bb.shakeUntil = Cine.t + 0.5;
          // buried: a tall garbage stack, and the player stops keeping up while gravity speeds up
          fillRows(Bb.board, 14); Bb.board.cpu = null; Bb.board.level = 16; Bb.board.speed = 1;
          var sp = project(Bb.x, Bb.y, Bb.z); if (sp) burst(sp.x, sp.y, 90, [320, 190], 1);
        });
      }
    } };

    S.eliminated = { pat: 0, update: function (t, lt) {
      var Bb = S.mp[1];
      path([{ t: 0, x: 1350, y: 200, z: -2250, tx: 1400, ty: 220, tz: -2900, fov: 52 }, { t: 1.372, x: 1250, y: 160, z: -2050, tx: 1400, ty: 220, tz: -2900, fov: 54 }], lt);
      if (!S.eliminated.out && t >= 35.94) {
        S.eliminated.out = true;
        Bb.board.alive = false; Bb.board.eliminated = true;
        Cine.flash = 0.45; Cine.tear = 1.4; Cine.aberration = 1;
        Bb.el.classList.add('out');
      }
      if (!S.eliminated.broke && t >= 36.3) { S.eliminated.broke = true; shatter(Bb); Cine.shake = 0.6; }
    }, enter: function () { S.eliminated.out = false; S.eliminated.broke = false; } };

    S.attack = { pat: 0, update: function (t, lt) {
      var C = S.mp[2];
      path([
        { t: 0, x: 1250, y: 160, z: -2050, tx: 1400, ty: 220, tz: -2900, fov: 54 },
        { t: 0.8, x: 1500, y: -200, z: 1200, tx: 1400, ty: 0, tz: -2900, fov: 60, e: easeOut },
        { t: 1.25, x: 400, y: -300, z: 1400, tx: -1700, ty: -380, tz: -4600, fov: 60 },
        { t: 2.743, x: 0, y: -260, z: 2600, tx: -400, ty: -300, tz: -1500, fov: 64, e: easeIn }
      ], lt);
      if (!S.attack.fired && t >= 36.9) {
        S.attack.fired = true;
        bolt({ x: C.x, y: C.y, z: C.z }, { x: 0, y: -260, z: 2700 }, t, 1.0, function () { burst(innerWidth / 2, innerHeight / 2, 220, [285, 190, 320], 2); Cine.flash = 0.8; });
      }
      if (lt > 2.2) { Cine.aberration = Math.max(Cine.aberration, 1); Cine.tear = Math.max(Cine.tear, 0.9); }
    }, enter: function () { S.attack.fired = false; } };

    /* ---------- Scenes 6 and 7: achievements, profile, chat, friends, invite (one continuous space) ---------- */

    S.achievements = { pat: 0, build: function (g) {
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
      S.achWall = plane(g, wall, 1900, 980, { x: 0, y: 0, z: 0, ry: 14, rx: 6, cull: false });

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

      var chat = panel('cine-chat', 'CHAT · #tetris');
      S.chatList = el('div', 'cine-chat-list', chat);
      S.chatMsgs = [['Lunar', 'that T-spin was illegal'], ['Blocky', 'gg'], [me.name, 'rematch??'], ['Gridlock', 'who just hit 50x'], ['Tess', 'invite me next round'], [me.name, 'lobby up, join me']];
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
      el('div', 'cine-prof-lvl', iw).textContent = 'invited you to Versus · Elimination';
      var btns = el('div', 'cine-invite-btns', inv);
      el('span', 'cine-accept', btns).textContent = 'Accept';
      el('span', 'cine-decline', btns).textContent = 'Decline';
      S.invite = plane(g, inv, 860, 420, { x: 400, y: 0, z: -6000, cull: false, op: 0 });
    }, update: function (t, lt) {
      socialCam(socialU(S, t));
      var n = S.achItems.length, on = Math.floor(easeOut(lt / 3.2) * n);
      S.achItems.forEach(function (it, i) { it.classList.toggle('on', i < on); it.classList.toggle('pop', i === on - 1); });
      S.achCount.textContent = Math.min(n, on) + ' / ' + n + ' unlocked';
      [[0.6, 'streak10'], [1.5, 'first_tetris'], [2.3, 'skull5']].forEach(function (x) {
        if (lt > x[0] && !S.achToasted[x[1]]) { S.achToasted[x[1]] = true; var a = ACH && ACH.get && ACH.get(x[1]); if (a) toast('Achievement unlocked', a.name); }
      });
      // the wall turns and slides past the lens, revealing the profile behind it
      socialPanels(S, socialU(S, t));
    }, enter: function () { S.achToasted = {}; S.achWall.x = 0; S.achWall.ry = 14; S.invite.op = 0; S.profPanel.x = 300; } };

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

    /* ---------- Scene 8: modes and skulls ---------- */

    var MODES = [['Marathon', 'speeds up every 10 lines'], ['Sprint 40', 'clear 40 lines, fast'], ['Ultra 2:00', 'best score in two minutes'], ['Dig', 'clear 10 garbage rows'],
      ['Survival', 'garbage rises from below'], ['Versus', 'two players, one keyboard'], ['vs CPU', 'you against 1–3 CPUs'], ['Online', '2–4 players']];
    S.modes = { pat: 0, build: function (g) {
      // the game's own menu panel, cloned (ids stripped) so the shot shows the real interface
      var src = document.getElementById('menuPanel');
      if (src && src.offsetHeight) {
        var mp = src.cloneNode(true), ph = Math.ceil(src.offsetHeight), pw = Math.ceil(src.offsetWidth);
        var picks = Array.prototype.slice.call(mp.querySelectorAll('.mode-card, #gameTypeChips .chip, #versusTypeChips .chip'));
        Array.prototype.forEach.call(mp.querySelectorAll('[id]'), function (e) { e.removeAttribute('id'); });
        mp.removeAttribute('id'); mp.classList.remove('hidden'); mp.classList.add('cine-real');
        S.modeCards = picks;
        S.modePanel = plane(g, mp, pw, ph, { x: 0, y: 0, z: 0, ry: -8, s: 1.5, cull: false });
        S.modeReal = true;
      } else {
        var cp = panel('cine-modes', 'PICK A MODE');
        var grid = el('div', 'cine-mode-grid', cp);
        S.modeCards = MODES.map(function (m) { var c = el('div', 'cine-mode', grid); el('strong', '', c).textContent = m[0]; el('span', '', c).textContent = m[1]; return c; });
        S.modePanel = plane(g, cp, 1500, 700, { x: 0, y: 0, z: 0, ry: -8, cull: false });
      }
      S.modeBoard = makePlayer({ warm: 8, stack: 5, speed: 1.8 });
      S.modeBoardItem = boardPlane(g, S.modeBoard, { x: 1150, y: -60, z: 300, ry: -22, s: 0.8, cull: false });

      var wall = panel('cine-skulls', 'SKULLS');
      S.skullMult = el('div', 'cine-panel-sub', wall);
      var sg = el('div', 'cine-grid', wall);
      S.skullCards = (App.skulls ? App.skulls() : []).map(function (s) {
        var card = el('div', 'cine-card cat-' + s.cat, sg);
        card.appendChild(App.skullIcon(s.id));
        el('span', 'cine-card-name', card).textContent = s.name;
        el('span', 'cine-card-eff', card).textContent = (s.eff > 0 ? '+' : '') + s.eff;
        return { el: card, eff: s.eff, id: s.id };
      });
      S.skullWall = plane(g, wall, 1700, 1000, { x: 0, y: 0, z: -2200, ry: 10, cull: false });
      S.flyers = [0, 1, 2, 3, 4, 5].map(function (i) {
        var ic = el('div', 'cine-flyer');
        var sk = S.skullCards[(i * 5 + 3) % Math.max(1, S.skullCards.length)];
        if (sk) ic.appendChild(App.skullIcon(sk.id));
        return plane(g, ic, 120, 120, { x: (i % 2 ? 1 : -1) * (300 + i * 90), y: (i % 3 - 1) * 260, z: -3000, s: 2, cull: false, op: 0 });
      });
    }, update: function (t, lt) {
      var top = S.modeReal ? -S.modePanel.h * 0.5 : -40, bottom = S.modeReal ? S.modePanel.h * 0.2 : 60;
      path([{ t: 0, x: -700, y: top - 150, z: 1000, tx: -150, ty: top + 250, tz: 0, fov: 52 }, { t: 2.3, x: 600, y: bottom, z: 1150, tx: 250, ty: bottom, tz: 0, fov: 52 },
        { t: 2.743, x: 300, y: 0, z: -300, tx: 0, ty: 0, tz: -2200, fov: 56, e: easeIn }], lt);
      var n = S.modeCards.length, i = Math.max(0, Math.floor((t - shotStart(S.modes.cue)) / (SPB / 2))) % n;
      S.modeCards.forEach(function (c, j) { c.classList.toggle('on', j === i); c.classList.toggle('cine-hl', j === i); });
      i = i % MODES.length;
      if (S.modeShown !== i) {
        S.modeShown = i;
        var p = S.modeBoard;
        p.reset(true);
        if (i === 3) fillRows(p, 9); else if (i === 4) { stageStack(p, 3); fillRows(p, 4); } else stageStack(p, 2 + (i % 4));
        S.modeBoardItem.el.style.setProperty('--board-color', ['#c77dff', '#4cc9ff', '#ff2fa6', '#9e8cd9', '#ff5a7a', '#7c6cff', '#28e8ff', '#a020ff'][i]);
      }
      S.modeBoardItem.x = 1150 - easeOut(span(lt, 0, 0.4)) * 200;
      S.modePanel.x = lerp(0, -2400, easeIn(span(lt, 2.2, 2.743)));
      S.modeBoardItem.op = 1 - span(lt, 2.2, 2.6);
    }, enter: function () { S.modeShown = -1; S.modePanel.x = 0; S.modeBoardItem.op = 1; } };

    S.skulls = { pat: 0, update: function (t, lt) {
      path([{ t: 0, x: 300, y: 0, z: -300, tx: 0, ty: 0, tz: -2200, fov: 56 }, { t: 2.4, x: -500, y: -150, z: -1100, tx: -300, ty: -40, tz: -2200, fov: 54 },
        { t: 2.743, x: -200, y: 0, z: -1700, tx: -100, ty: 0, tz: -2200, fov: 60, e: easeIn }], lt);
      var b = Math.floor((t - shotStart(S.skulls.cue)) / (SPB / 2)), m = 1, n = S.skullCards.length;
      S.skullCards.forEach(function (c, j) {
        var order = (j * 7) % n, on = order <= b && c.eff > 0;
        c.el.classList.toggle('on', on);
        c.el.classList.toggle('pop', order === b);
        if (on) m += c.eff;
      });
      S.skullMult.textContent = 'score multiplier ×' + (Math.round(m * 100) / 100);
      S.flyers.forEach(function (f, i) {
        var k = span(lt, 0.4 + i * 0.25, 1.4 + i * 0.25);
        f.op = k > 0 && k < 1 ? 1 : 0; f.z = lerp(-3000, Cine.cam.z + 200, easeIn(k)); f.rz = k * 360;
      });
      if (lt > 2.55) { Cine.flash = Math.max(Cine.flash, (lt - 2.55) * 5); Cine.tear = Math.max(Cine.tear, 1); }
    }, exit: function () { S.modePanel.x = 0; } };

    /* ---------- Scene 9: montage, then everything recedes into the shader ---------- */

    S.montage = { pat: 0, build: function (g) {
      S.mon = [];
      for (var i = 0; i < 12; i++) {
        var p = makePlayer({ warm: 4 + i, stack: 4 + (i % 6), speed: 2.2, streaks: i % 3 === 0 });
        if (i % 3 === 0) p.lockStreak = [5, 12, 22, 55][(i / 3) % 4];
        var a = i * 2.4;
        S.mon.push(boardPlane(g, p, { x: Math.cos(a) * (700 + (i % 3) * 400), y: Math.sin(a) * (420 + (i % 2) * 200), z: -i * 900,
          ry: (hash(i) - 0.5) * 60, rx: (hash(i * 3) - 0.5) * 24, spin: (hash(i * 7) - 0.5) * 30 }));
      }
    }, update: function (t, lt) {
      // backwards through the boards, faster and faster, then a rapid pull-out until they vanish into the purple
      var pull = easeIn(span(lt, 2.4, 4.262)), c = Cine.cam;
      c.x = Math.sin(lt * 2.3) * 200 * (1 - pull); c.y = Math.cos(lt * 1.7) * 120 * (1 - pull);
      c.z = lerp(-10400, 1200, easeInOut(span(lt, 0, 2.4))) + pull * 22000;
      c.fov = lerp(66, 40, pull); c.roll = Math.sin(lt * 3.1) * 10 * (1 - pull);
      lookAt(c.x * 0.4, c.y * 0.4, c.z - 1000);
      S.mon.forEach(function (it, i) { it.ry += it.spin * 0.02; it.op = 1 - smooth(span(lt, 3.2 + (i % 4) * 0.1, 4.1)); });
      Cine.streaks = 1 - pull; Cine.speed = 0.6 * (1 - pull);
      var bt = Math.floor(beatAt(t));
      if (bt !== S.montage.lastBeat && lt < 3.0) {
        S.montage.lastBeat = bt;
        if (bt % 2 === 0) { var a = S.mon[bt % 12], b2 = S.mon[(bt + 5) % 12]; bolt({ x: a.x, y: a.y, z: a.z }, { x: b2.x, y: b2.y, z: b2.z }, t, 0.5); }
        if (bt % 4 === 1) caption(['2x', '10x', '20x', '50x'][(bt >> 2) % 4], ['STREAK', 'ON FIRE', 'RAINBOW ROAD', 'SUPERNOVA'][(bt >> 2) % 4]);
        if (bt % 4 === 3) toast('Achievement unlocked', ['On Fire', 'Tetris!', 'Demolition', 'Champion'][(bt >> 2) % 4]);
        Cine.tear = Math.max(Cine.tear, 0.6);
      }
      if (lt > 3.0) caption();
      Cine.aberration = Math.max(Cine.aberration, 0.35 * (1 - pull));
    }, enter: function () { S.montage.lastBeat = -1; } };

    // Scene 10: the logo returns, the real menu fades in under it, and the overlay lets go.
    S.menu = { pat: 0, update: function (t, lt) {
      var c = Cine.cam; c.x = 0; c.y = 0; c.z = 23000; c.fov = 40; c.roll = 0; lookAt(0, 0, 0);
      S.mon.forEach(function (it) { it.op = 0; });
      if (!S.menu.hit) { S.menu.hit = true; Cine.flash = 1; burst(innerWidth / 2, innerHeight / 2, 200, [285, 320, 190], 1.6); caption(); }
      logoFinale(lt);
      // the cinematic's picture fades to reveal the live page behind it (the same purple world, now the real menu)
      var k = smooth(span(lt, 0.45, 1.6));
      Cine.stage.style.opacity = (1 - k).toFixed(3);
      Cine.root.style.backgroundColor = 'rgba(0,0,0,' + (1 - k).toFixed(3) + ')';
      Cine.vhsEl.style.opacity = (1 - k * 0.85).toFixed(3);
      if (lt > 0.6 && !Cine.ending) { Cine.ending = true; Cine.root.classList.add('letting-go'); }
    }, enter: function () {
      S.menu.hit = false; window.scrollTo(0, 0);
      // the page's own background turns violet underneath, so the hand-over keeps the cinematic's colour
      if (window.TetrisBG && window.TetrisBG.show) window.TetrisBG.show(13, violetSeed());
    } };

    // Shots that name a group share the planes of the shot that built it.
    return CUES.shots.map(function (s) {
      var shot = S[s.id];
      shot.id = s.id; shot.cue = s;
      var gid = s.group || s.id;
      shot.group = Cine.groups[gid] || group(gid);
      if (shot.build && !s.group) shot.build(shot.group);
      return shot;
    });
  }

  // A seed whose palette hue lands in violet with tetris-bg.js's show() (its first random number is the hue).
  function violetSeed() {
    for (var seed = 1; seed < 20000; seed++) {
      var x = (seed * 48271) % 2147483647, hue = x / 2147483647;
      if (hue > 0.74 && hue < 0.8) return seed;
    }
    return 1;
  }

  // Scene 3's board: a tidy stack with a clean well in the right column, and a vertical I waiting above it.
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

  function pieceWorldY(item, p) {
    var row = p.piece ? p.piece.y + 2 : 10;
    return item.y + (HEAD + row * K.CELL) - (BH + HEAD) / 2;
  }
  function pieceWorldX(item, p) {
    var col = p.piece ? p.piece.x + 2.5 : 5;
    return item.x + (K.SIDE + col) * K.CELL - BW / 2;
  }

  // A glowing frame floating in front of the falling piece: it parallaxes against the board, selling the depth.
  function pieceGlow(item, p) {
    if (!item.glow) item.glow = el('div', 'cine-pieceglow', item.el);
    var g = item.glow;
    if (!p || !p.piece || p.piece.y < 0) { g.style.display = 'none'; return; }
    var cells = p.cells(p.piece.x, p.piece.y, p.piece.rot), minC = 99, maxC = -1, minR = 99, maxR = -99;
    cells.forEach(function (c) { minC = Math.min(minC, c[0]); maxC = Math.max(maxC, c[0]); minR = Math.min(minR, c[1]); maxR = Math.max(maxR, c[1]); });
    g.style.display = '';
    g.style.width = ((maxC - minC + 1) * K.CELL + 8) + 'px';
    g.style.height = ((maxR - minR + 1) * K.CELL + 8) + 'px';
    g.style.transform = 'translate3d(' + ((K.SIDE + minC) * K.CELL - 4) + 'px,' + (HEAD + minR * K.CELL - 4) + 'px,26px)';
  }

  // The cleared rows: white bars with a bright sweep running across them, swelling and fading.
  function rowFlash(item, rows, k) {
    var box = item.rows;
    if (!rows || !rows.length || k >= 1) { box.textContent = ''; box.style.opacity = 0; item.face.style.filter = ''; return; }
    if (box.childElementCount !== rows.length) {
      box.textContent = '';
      rows.forEach(function (r) {
        var bar = el('div', 'cine-row', box);
        bar.style.top = (r * K.CELL) + 'px'; bar.style.left = (K.SIDE * K.CELL) + 'px';
        bar.style.width = (K.COLS * K.CELL) + 'px'; bar.style.height = K.CELL + 'px';
      });
    }
    var e = 1 - k;
    box.style.opacity = e;
    Array.prototype.forEach.call(box.children, function (b, i) {
      b.style.transform = 'scaleX(' + (1 + k * 0.6) + ') scaleY(' + (1 + k * (1.5 + i * 0.3)) + ')';
      b.style.backgroundPosition = (-100 + k * 400 + i * 20) + '% 0';
    });
    item.face.style.filter = 'brightness(' + (1 + e * 1.8) + ') saturate(' + (1 + e) + ')';
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

  function drawBoards(g, dt) {
    g.boards.forEach(function (it) {
      sim(it.board, dt);
      if (it.visible) K.drawPlayer(it.board);
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

    Cine.env = 1; Cine.speed = 0; Cine.streaks = 0; Cine.variant = 0; Cine.eye = CAB_EYE;
    shot.update(t, lt, u, dt);

    var view = applyCamera();
    layoutGroup(shot.group, view);
    drawBoards(shot.group, dt);
    Bg.draw({ time: t, pat: shot.pat, level: Cine.level, beat: Cine.beat, flash: Math.min(0.14, Cine.flash * 0.45), env: Cine.env, tear: Cine.tear,
      speed: Cine.speed, variant: Cine.variant, P: view.P, cam: Cine.cam, dist: Cine.dist, eye: Cine.eye, crt: Cine.crt });
    drawFx(dt, t);
    drawSpark(t);
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
    botCount = 0;
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
    document.documentElement.classList.add('cine-open');
    if (window.TetrisMenuMusic) window.TetrisMenuMusic.hold(true);
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
    if (window.TetrisMenuMusic) { window.TetrisMenuMusic.hold(false); window.TetrisMenuMusic.startNow(skipped ? 1.2 : 1.5); }
    if (G.Sound && Cine.beepWas) G.Sound.beep = Cine.beepWas;
    document.removeEventListener('keydown', onKey, true);
    var root = Cine.root;
    root.classList.add(skipped ? 'closing' : 'closed');
    setTimeout(function () { root.remove(); }, skipped ? 450 : 50);
    document.documentElement.classList.remove('cine-open');
    Cine.groups = {}; Cine.shots = null; Cine.bolts = []; Cine.sparks = []; Cine.frags = [];
    var btn = document.getElementById('cinematicBtn');
    if (btn && skipped) btn.focus({ preventScroll: true });
  }

  function init() {
    var btn = document.getElementById('cinematicBtn');
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
    // First visit only, straight onto the menu (not into an invite link), and not for people who asked for less motion.
    if (!G.Store.get(STORE_SEEN, 0) && !reduced && !(App.busy && App.busy())) play(0);
  }

  window.TetrisCinematic = { play: play, skip: function () { finish(true); }, playing: function () { return Cine.running; }, CUES: CUES };
  if (/[?&]cinematic\b/.test(location.search)) window.TetrisCinematic.state = function () { Cine.bgDraw = Bg; Cine.audio = Audio; return Cine; };   // testing aid
  init();
})();
