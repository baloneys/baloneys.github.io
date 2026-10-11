// chess-cinematic.js: the Chess opening cinematic (60 seconds), rendered live in the page.
// The Tetris/Pong/Battleships camera, clock, governor, controls and hand-over are retained here.
// Chess adds a Macintosh in a pastel void, a sunset checkerboard, a detached legal game board,
// hologram chess pieces and Finder-style panels. Music: Daydreaming by | e s c p |
// (CC BY 4.0, adapted with original sound design; see Balcade_Chess_Audio_Credits.txt).
// Playback: once per browser (chess_cinematic_seen), then the menu's Watch cinematic button.
// Testing aids: ?cinematic=SECONDS plays
// from there; &hold=SECONDS freezes the clock; ChessCinematic.step(t) runs frames by hand to time t.
(function () {
  'use strict';

  var G = window.Games;
  var App = window.ChessApp;
  if (!G || !App || !App.cinematicKit) return;
  var KIT = App.cinematicKit();
  var ACH = window.ChessAchievements;
  var STORE_SEEN = 'chess_cinematic_seen';
  var D2R = Math.PI / 180;

  /* =================================================================
     Cue sheet
     ================================================================= */

  var CUES = {
    track: 'Balcade_Chess_Cinematic_60s_MIX.mp3',
    credit: 'Daydreaming by | e s c p | (FSM Team) · CC BY 4.0 · edited for Balcade Chess',
    trackHasSfx: true,
    bpm: 80,
    offset: 12,
    end: 60,
    volume: 0.85,
    sfx: 0.5,
    segments: [{ t0: 0, t1: 60, at: 0 }],
    duck: [],
    spark: [1000, 1001],
    shots: [
      { id: 'boot', at: 0 }, { id: 'desktop', at: 6, group: 'boot' },
      { id: 'opening', at: 12 }, { id: 'capture', at: 22, group: 'opening' },
      { id: 'check', at: 30, group: 'opening' }, { id: 'mate', at: 38, group: 'opening' },
      { id: 'achievements', at: 43, nominal: 1.6 },
      { id: 'profile', at: 44.5, group: 'achievements', nominal: 1.372 },
      { id: 'chat', at: 46, group: 'achievements', nominal: 2.743 },
      { id: 'friends', at: 47.5, group: 'achievements', nominal: 2.743 },
      { id: 'modes', at: 49, nominal: 2.0 },
      { id: 'skulls', at: 51, group: 'modes', nominal: 2.0 },
      { id: 'final', at: 53 }, { id: 'menu', at: 58, group: 'final' }
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
    // The night ocean (pattern 4): the sea is the plane y = 0 (the camera's y is negative above it), rolling swells,
    // white crests, a faint naval grid on the water, a magenta glow low on the horizon and its streak on the water.
    "vec3 ocean(vec3 dir){",
    "  float az=atan(dir.x,-dir.z), el=asin(clamp(-dir.y,-1.0,1.0));",
    "  if (dir.y>0.0005){",
    "    float t=(0.0-u_cpos.y)/dir.y; vec3 p=u_cpos+dir*t; float fade=exp(-t/14000.0);",
    "    float w1=sin(p.x*0.0035+p.z*0.006+u_time*1.1)+0.6*sin(-p.x*0.007+p.z*0.0028+u_time*0.8);",
    "    float crest=smoothstep(0.8,1.0,0.5+0.5*sin(p.z*0.018+w1*2.2+u_time*1.5));",
    "    vec2 g=abs(fract(p.xz/500.0)-0.5); float gl=smoothstep(0.485,0.5,max(g.x,g.y));",
    "    vec3 c=vec3(0.008,0.004,0.03)+vec3(0.1,0.02,0.24)*(0.45+0.55*w1)*0.6*fade;",
    "    c+=vec3(0.2,0.75,1.0)*crest*fade*0.12;",
    "    c+=vec3(0.45,0.08,0.95)*gl*fade*(0.22+u_level*0.35);",
    "    c+=vec3(1.0,0.25,0.7)*exp(-abs(az-0.5)*5.0)*smoothstep(0.35,0.0,-el)*(0.25+0.35*crest);",
    "    c+=vec3(0.45,0.05,0.5)*smoothstep(0.1,0.0,-el)*0.55;",
    "    return c; }",
    "  vec3 c=world(dir)*0.38;",
    "  c+=vec3(1.0,0.3,0.8)*exp(-length(vec2(az-0.5,(el-0.08)*2.0))*5.0)*0.55;",
    "  c+=vec3(0.6,0.05,0.5)*exp(-abs(el)*22.0)*0.75;",
    "  return c; }",
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
    // Pixel planets in the vaporwave sky, ported from Deep-Fold's PixelPlanets (MIT; notice below): a banded gas
    // giant (GasLayers) with its ring (Ring), a moon with craters (NoAtmosphere + Craters) and a small pink world.
    // Each is drawn in its own little UV square on the sky, snapped to its own pixel grid, dithered and posterised.
    //
    // MIT License. Copyright (c) 2020 Deep-Fold. Permission is hereby granted, free of charge, to any person obtaining
    // a copy of this software and associated documentation files (the "Software"), to deal in the Software without
    // restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute,
    // sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
    // subject to the following conditions: The above copyright notice and this permission notice shall be included in
    // all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
    // KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
    // PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
    // CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
    // IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
    'float dfR(vec2 c, float sz, float sd){ c=mod(c,vec2(2.0,1.0)*floor(sz+0.5)); return fract(sin(dot(c,vec2(12.9898,78.233)))*15.5453*sd); }',
    'float dfN(vec2 c, float sz, float sd){ vec2 i=floor(c), f=fract(c); float a=dfR(i,sz,sd), b=dfR(i+vec2(1.0,0.0),sz,sd), e=dfR(i+vec2(0.0,1.0),sz,sd), d=dfR(i+vec2(1.0,1.0),sz,sd);',
    '  vec2 u=f*f*(3.0-2.0*f); return mix(a,b,u.x)+(e-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y; }',
    'float dfF(vec2 c, float sz, float sd){ float v=0.0, s=0.5; for(int i=0;i<5;i++){ v+=dfN(c,sz,sd)*s; c*=2.0; s*=0.5; } return v; }',
    'float dfCirc(vec2 uv, float sz, float sd){ float y=floor(uv.y); uv.x+=y*0.31; vec2 f=fract(uv); float h=dfR(vec2(floor(uv.x),y),sz,sd); return smoothstep(0.0,h*0.25,length(f-0.25-h*0.5)*0.75); }',
    'vec2 dfSph(vec2 uv){ vec2 c=uv*2.0-1.0; float z=sqrt(max(0.0,1.0-dot(c,c))); return c/(z+1.0)*0.5+0.5; }',
    'vec2 dfRot(vec2 c, float a){ c-=0.5; c=vec2(c.x*cos(a)+c.y*sin(a),-c.x*sin(a)+c.y*cos(a)); return c+0.5; }',
    'vec4 dfGas(vec2 U, float px, float sz, float sd, float rot, vec3 l0, vec3 l1, vec3 l2, vec3 d0, vec3 d1, vec3 d2){',
    '  vec2 uv=floor(U*px)/px; float ld=distance(uv,vec2(0.62,0.36));',
    '  bool dith=mod(uv.x+U.y,2.0/px)<=1.0/px; float a=step(length(uv-0.5),0.49999);',
    '  if(a<0.5) return vec4(0.0);',
    '  uv=dfSph(dfRot(uv,rot));',
    '  float band=dfF(vec2(0.0,uv.y*sz),sz,sd);',
    '  float turb=0.0; for(int i=0;i<10;i++){ turb+=dfCirc(uv*sz*0.3+float(i+1)+10.0+vec2(u_time*0.04,0.0),sz,sd); }',
    '  float f1=dfF(uv*sz,sz,sd); float f2=dfF(uv*vec2(1.0,2.0)*sz+f1+vec2(-u_time*0.04,0.0)+turb,sz,sd);',
    '  f2*=pow(band,2.0)*7.0; float light=f2+ld*1.8; f2+=ld-0.3; f2=smoothstep(-0.2,4.0-f2,light);',
    '  if(dith) f2*=1.1;',
    '  float pz=floor(f2*4.0)/2.0; vec3 col;',
    '  if(f2<0.625){ float k=floor(pz*2.0); col=k<0.5?l0:(k<1.5?l1:l2); } else { float k=floor((pz-1.0)*2.0); col=k<0.5?d0:(k<1.5?d1:d2); }',
    '  return vec4(col,1.0); }',
    'vec4 dfRing(vec2 U, float px, float sz, float sd, float rel, vec3 l0, vec3 l1, vec3 l2, vec3 d0){',
    '  vec2 uv=floor(U*px)/px; float ld=distance(uv,vec2(0.6,0.42));',
    '  vec2 c=(uv-vec2(0.0,0.5))*vec2(1.0,4.0); float cd=distance(c,vec2(0.5,0.0));',
    '  float ring=smoothstep(0.26,0.38,cd)*smoothstep(cd-0.12,cd,0.4);',
    '  if(uv.y<0.5) ring*=step(0.5/rel,distance(uv,vec2(0.5)));',
    '  ring*=dfF(dfRot(c+vec2(0.0,0.5),u_time*0.05)*sz,sz,sd);',
    '  float pz=min(floor((ring+pow(ld,2.0)*2.0)*4.0)/4.0,2.0);',
    '  vec3 col=pz<=0.0?l0:(pz<=0.5?l1:(pz<=1.0?l2:d0));',
    '  return vec4(col,step(0.28,ring)); }',
    'vec4 dfMoon(vec2 U, float px, float sz, float sd, vec3 c0, vec3 c1, vec3 c2, vec3 k0, vec3 k1){',
    '  vec2 uv=floor(U*px)/px; float dc=distance(uv,vec2(0.5)); if(dc>0.49999) return vec4(0.0);',
    '  float ld=distance(uv,vec2(0.66,0.34)); bool dith=mod(uv.x+U.y,2.0/px)<=1.0/px;',
    '  vec2 r=dfRot(uv,0.3); float f1=dfF(r,sz,sd); ld+=dfF(r*sz+f1+vec2(u_time*0.02,0.0),sz,sd)*0.3;',
    '  float db=2.0/px; vec3 col=c0;',
    '  if(ld>0.52){ col=c1; if(ld<0.52+db&&dith) col=c0; }',
    '  if(ld>0.66){ col=c2; if(ld<0.66+db&&dith) col=c1; }',
    '  vec2 su=dfSph(r); float cr=dfCirc(su*sz*0.9+3.0,sz,sd+1.7); float cr2=dfCirc((su+vec2(-0.012,0.012))*sz*0.9+3.0,sz,sd+1.7);',
    '  if(cr<0.55){ col=ld<0.6?k0:k1; if(cr2>=0.55) col=k0*1.08; }',
    '  return vec4(col,1.0); }',
    // where each planet sits (az, el) and its angular radius; U is its square, y down
    'vec2 dfUV(vec2 q, vec2 c, float R){ return vec2((q.x-c.x)/(2.0*R)+0.5, 0.5-(q.y-c.y)/(2.0*R)); }',
    // Clouds, after Deep-Fold's Clouds.gdshader (cloud_alpha and its four-colour lighting; same MIT notice), laid
    // across the sky instead of round a planet: a cumulus bank on the horizon, lit cream towards the sun and lavender in
    // its own shade, and thin cirrus streaks higher up. Each layer is snapped to its own pixel grid.
    'float dfCloud(vec2 uv, float sz, float sd, float tm){ float cn=0.0; for(int i=0;i<9;i++){ cn+=dfCirc(uv*sz*0.3+float(i+1)+10.0+vec2(tm,0.0),sz,sd); } return dfF(uv*sz+cn+vec2(tm,0.0),sz,sd); }',
    'vec3 cloudCol(float c, float cover, float dl, vec3 c0, vec3 c1, vec3 c2, vec3 c3){ vec3 col=c0; if(c<cover+0.03) col=c1; if(dl+c*0.2>0.52) col=c2; if(dl+c*0.2>0.62) col=c3; return col; }',
    'vec3 clouds(vec2 q, vec3 sky){',
    '  if(q.y<-0.02||q.y>0.62) return sky;',
    '  float tm=u_time*0.012;',
    '  if(q.y<0.26){',
    // the cumulus: a few separate heaps (a slow 1-D noise thins the bank between them) whose puffs thin out as they
    // rise; shaded by thickness and height: lavender undersides, pink sides, cream tops, a hot rim on thin edges
    '    vec2 uv=floor(vec2(q.x,q.y)*170.0)/170.0;',
    '    float c=dfCloud(vec2(uv.x*0.75,uv.y*1.5),5.0,2.3,tm);',
    '    float heap=dfN(vec2(uv.x*2.2+3.0,0.5),40.0,1.7);',
    '    float cover=0.30+uv.y*0.95+(1.0-heap)*0.2;',
    '    if(c>cover){ float th=c-cover;',
    '      bool dith=mod(floor(q.x*170.0)+floor(q.y*170.0),2.0)<1.0;',
    '      float lit=th*3.6+uv.y*2.6+(dith?0.05:0.0)-0.08*smoothstep(0.3,0.0,abs(uv.x));',
    '      vec3 col=vec3(0.40,0.30,0.70);',
    '      if(lit>0.14) col=vec3(0.70,0.46,0.86);',
    '      if(lit>0.3) col=vec3(1.0,0.56,0.80);',
    '      if(lit>0.52) col=vec3(1.0,0.86,0.86);',
    '      if(th<0.018) col=mix(col,vec3(1.0,0.74,0.92),0.7);',
    '      col=mix(col,vec3(1.0,0.78,0.55),0.45*exp(-length(vec2(uv.x*0.9,uv.y-0.05))*6.0));',
    '      sky=mix(sky,col,smoothstep(-0.02,0.0,uv.y)); } }',
    '  if(q.y>0.22){',
    '    vec2 uv=floor(vec2(q.x,q.y)*120.0)/120.0;',
    '    float c=dfCloud(vec2(uv.x*0.3,uv.y*3.6),6.0,5.1,tm*1.6);',
    '    float cover=0.6+0.1*smoothstep(0.3,0.6,uv.y);',
    '    if(c>cover){ float dl=0.45+uv.y*0.4;',
    '      vec3 col=cloudCol(c,cover,dl,vec3(1.0,0.80,0.92),vec3(0.94,0.58,0.86),vec3(0.62,0.46,0.88),vec3(0.36,0.34,0.78));',
    '      sky=mix(sky,col,0.75); } }',
    '  return sky; }',
    'vec3 planets(vec2 q, vec3 sky){',
    '  vec2 gc=vec2(-0.5,0.24); float gR=0.13;',
    '  vec2 U=dfUV(q,gc,gR*2.4); vec4 rg=vec4(0.0);',
    '  if(U.x>0.0&&U.x<1.0&&U.y>0.0&&U.y<1.0) rg=dfRing(U,200.0,6.0,4.1,2.4,vec3(1.0,0.84,0.95),vec3(1.0,0.56,0.82),vec3(0.80,0.42,0.74),vec3(0.42,0.24,0.62));',
    '  vec2 G=dfUV(q,gc,gR); if(G.x>0.0&&G.x<1.0&&G.y>0.0&&G.y<1.0){ vec4 g=dfGas(G,96.0,8.0,6.3,0.32,vec3(0.80,0.97,1.0),vec3(0.46,0.82,0.96),vec3(0.31,0.56,0.90),vec3(0.24,0.34,0.72),vec3(0.17,0.17,0.52),vec3(0.10,0.08,0.30)); sky=mix(sky,g.rgb,g.a); }',
    '  sky=mix(sky,rg.rgb,rg.a);',
    '  vec2 M=dfUV(q,vec2(0.62,0.31),0.06); if(M.x>0.0&&M.x<1.0&&M.y>0.0&&M.y<1.0){ vec4 m=dfMoon(M,52.0,5.0,3.1,vec3(1.0,0.86,0.95),vec3(0.86,0.55,0.80),vec3(0.48,0.30,0.60),vec3(0.72,0.42,0.68),vec3(0.36,0.22,0.48)); sky=mix(sky,m.rgb,m.a); }',
    '  vec2 P=dfUV(q,vec2(0.22,0.47),0.034); if(P.x>0.0&&P.x<1.0&&P.y>0.0&&P.y<1.0){ vec4 pp=dfGas(P,40.0,6.0,2.7,-0.4,vec3(1.0,0.86,0.94),vec3(0.98,0.56,0.82),vec3(0.82,0.36,0.70),vec3(0.56,0.24,0.62),vec3(0.36,0.14,0.48),vec3(0.20,0.08,0.32)); sky=mix(sky,pp.rgb,pp.a); }',
    '  return sky; }',
    'vec3 chessFloor(vec3 dir){',
    '  float el=asin(clamp(-dir.y,-1.0,1.0)); float az=atan(dir.x,-dir.z);',
    '  vec3 sky=mix(vec3(0.86,0.38,0.70),vec3(0.05,0.10,0.40),smoothstep(0.0,0.55,el));',
    '  sky=mix(sky,vec3(0.02,0.04,0.20),smoothstep(0.55,1.2,el));',
    '  vec2 sd=floor(vec2(az*190.0,el*190.0)); sky+=vec3(0.8,0.9,1.0)*step(0.993,h2(sd))*smoothstep(0.15,0.5,el)*0.9;',
    '  sky=planets(vec2(az,el),sky);',
    '  float sun=length(vec2(az*0.82,(el-0.055)*1.5));',
    '  float disc=1.0-smoothstep(0.21,0.225,sun);',
    '  float bars=step(0.15,fract((el+0.2)*50.0));',
    '  sky=mix(sky,vec3(1.0,0.58,0.40),disc*bars*0.88);',
    '  sky=clouds(vec2(az,el),sky);',
    '  sky+=vec3(0.35,0.55,0.75)*smoothstep(0.016,0.0,abs(fract(az*8.0)-0.5))*0.06;',
    '  if(dir.y>0.0005){ float t=(0.0-u_cpos.y)/dir.y; vec3 p=u_cpos+dir*t;',
    '    vec2 sq=floor(p.xz/180.0); float checker=mod(sq.x+sq.y,2.0);',
    '    vec2 q=abs(fract(p.xz/180.0)-0.5); float seam=smoothstep(0.48,0.5,max(q.x,q.y));',
    '    vec3 tile=mix(vec3(0.03,0.10,0.34),vec3(0.92,0.42,0.80),checker);',
    '    tile+=vec3(0.06,0.7,1.0)*seam*0.22;',
    '    float bevel=max(q.x,q.y); tile*=1.0-0.22*smoothstep(0.38,0.5,bevel);',
    '    tile+=vec3(0.55,0.81,1.0)*smoothstep(0.49,0.45,max(q.x,q.y))*0.045;',
    '    float refl=exp(-abs(p.x)*0.0005)*exp(-abs(p.z+3000.0)*0.0004);',
    '    tile+=vec3(1.0,0.30,0.58)*refl*0.16;',
    '    tile*=0.65+0.35*exp(-t/9000.0);',
    '    return mix(tile,sky,1.0-exp(-t/13000.0))*1.1; }',
    '  return sky; }',
    'vec3 pinkVoid(vec3 dir){',
    '  float az=atan(dir.x,-dir.z), el=asin(clamp(-dir.y,-1.0,1.0));',
    '  vec3 c=mix(vec3(0.20,0.07,0.28),vec3(0.83,0.34,0.58),smoothstep(-0.8,0.8,el));',
    '  c+=vec3(0.85,0.22,0.48)*exp(-length(vec2(az-0.5,(el-0.03)*1.4))*1.9)*0.36;',
    '  vec2 d=floor(vec2(az*150.0,el*100.0+u_time*0.7));',
    '  c+=vec3(0.95,0.78,1.0)*step(0.991,h2(d))*0.65;',
    '  c=clouds(vec2(az*0.8+1.3,el+0.02),c);',
    '  if(dir.y>0.0005){ float t=(650.0-u_cpos.y)/dir.y; vec3 p=u_cpos+dir*t;',
    '    vec2 cell=floor(p.xz/320.0); float chk=mod(cell.x+cell.y,2.0);',
    '    vec2 edge=abs(fract(p.xz/320.0)-0.5); float bevel=max(edge.x,edge.y);',
    '    vec3 tile=mix(vec3(0.035,0.08,0.24),vec3(0.72,0.26,0.60),chk);',
    '    tile*=1.0-0.23*smoothstep(0.39,0.5,bevel);',
    '    tile+=vec3(0.22,0.64,1.0)*smoothstep(0.5,0.47,bevel)*0.05;',
    '    c=mix(tile,c,1.0-exp(-t/4300.0)); }',
    '  return c; }',
    'void main(){',
    '  vec2 css=gl_FragCoord.xy/u_res*u_css; css.y=u_css.y-css.y;',
    '  if (u_tear>0.0){ float band=floor(css.y/18.0); float on=step(0.86,h1(band+floor(u_time*8.0)*7.0)); css.x+=on*u_tear*(h1(band*3.1)-0.5)*90.0; }',
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
    '  else if (u_pat<3.5) c=warehouse(vec2(css.x-0.5*u_css.x, 0.5*u_css.y-css.y)/u_css.y);\n  else if (u_pat<4.5) c=ocean(dir);\n  else if (u_pat<5.5) c=chessFloor(dir);\n  else c=pinkVoid(dir);',
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
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[chess-cinematic]', gl.getShaderInfoLog(s)); return null; }
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
      var w = Math.round(Math.max(Math.min(cw, 180), (s.pat > 2.5 && s.pat < 3.5 ? Math.min(1280, cw / 1.5) : Math.min(720, cw / 3)) * [1, 0.7, 0.5][Q.level])), h = Math.round(w * ch / cw);   // (never below 180 across, or a portrait phone gets mush)
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
      var shared = window.ChessMenuMusic && window.ChessMenuMusic.context();
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
      this.events = (CUES.trackHasSfx ? [] : sfxScore()).concat(liveSfx()).sort(function (a, b) { return a.t - b.t; });
      if (CUES.track) {
        fetch(CUES.track).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
          .then(function (ab) { return new Promise(function (ok, no) { ctx.decodeAudioData(ab, ok, no); }); })
          .then(function (b) { if (self.ctx !== ctx) return; self.buffer = b; if (self.on) self.start(Cine.t); })
          .catch(function (e) { console.warn('[chess-cinematic] track', e); });
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
        if (window.ChessMenuMusic && t < CUES.end) window.ChessMenuMusic.cue(now + (CUES.end - t));
      }
      return ctx.state === 'running';
    },

    stopSources: function () {
      this.sources.forEach(function (s) { try { s.stop(); } catch (e) { /* already stopped */ } });
      this.sources = [];
    },

    stop: function (fade, keepCue) {
      this.on = false;
      if (!keepCue && window.ChessMenuMusic) window.ChessMenuMusic.cancelCue();
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
    tick: function (t, v) { this.out(this.filter(this.noiseSrc(t, 0.03), 'highpass', 6000), t, 0.25 * v, 0.001, 0.025); },
    // An 8-bit game over for the fallen king (3.5 s): a wobbling death slide, a falling arpeggio, a chromatic
    // "dun, dun, dun" and a last low note that sags and wobbles out, square lead over a triangle bass.
    gameOver: function (t, v) {
      var self = this;
      function note(type, m, at, dur, vol) { var o = self.osc(type, midi(m), at, dur); self.out(o, at, vol * v, 0.004, dur); return o; }
      var o = this.osc('square', midi(84), t, 0.8), lfo = this.osc('square', 16, t, 0.8), dep = this.ctx.createGain();
      dep.gain.value = 60; lfo.connect(dep); dep.connect(o.frequency);
      o.frequency.exponentialRampToValueAtTime(midi(45), t + 0.8);
      var sg = this.ctx.createGain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(0.12 * v, t + 0.005);
      sg.gain.setValueAtTime(0.12 * v, t + 0.6); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.82); o.connect(sg); sg.connect(this.sfxBus);
      [[79, 0], [74, 0.15], [71, 0.3], [67, 0.45]].forEach(function (n) {
        note('square', n[0], t + 0.95 + n[1], n[1] === 0.45 ? 0.32 : 0.13, 0.17); note('triangle', n[0] - 24, t + 0.95 + n[1], 0.13, 0.26);
      });
      [66, 65, 64].forEach(function (m, i) { note('square', m, t + 1.75 + i * 0.24, 0.2, 0.17); note('triangle', m - 24, t + 1.75 + i * 0.24, 0.2, 0.28); });
      var end = t + 2.5, last = this.osc('square', midi(60), end, 1.05), vib = this.osc('sine', 7, end, 1.05), vd = this.ctx.createGain();
      vd.gain.setValueAtTime(0, end); vd.gain.linearRampToValueAtTime(14, end + 1); vib.connect(vd); vd.connect(last.frequency);
      last.frequency.setValueAtTime(midi(60), end + 0.35); last.frequency.exponentialRampToValueAtTime(midi(57), end + 1.05);
      var g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, end); g.gain.linearRampToValueAtTime(0.12 * v, end + 0.01);
      g.gain.setValueAtTime(0.12 * v, end + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, end + 1.05);
      last.connect(g); g.connect(this.sfxBus);
      var bass = this.osc('triangle', midi(36), end, 1.05), bg = this.ctx.createGain();
      bass.frequency.setValueAtTime(midi(36), end + 0.35); bass.frequency.exponentialRampToValueAtTime(midi(33), end + 1.05);
      bg.gain.setValueAtTime(0.0001, end); bg.gain.linearRampToValueAtTime(0.24 * v, end + 0.01); bg.gain.exponentialRampToValueAtTime(0.0001, end + 1.05);
      bass.connect(bg); bg.connect(this.sfxBus);
    }
  };

  // Synthesised effects played over the mixed track (it already carries its own sound design): the game over fills
  // the silence the track cuts to after checkmate (about 39.3 s to 43 s).
  function liveSfx() {
    return [{ t: 39.3, f: function (a, t) { a.gameOver(t, 1); } }];
  }

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
    timeScale: 1, fovKick: 0, look: { x: 0, y: 0, z: -1 }, missiles: [], splashes: [], fires: [], hud: null,
    soundWanted: true, beepWas: null, ending: false,

    needSound: function () { if (this.hint) this.hint.classList.remove('hidden'); }
  };

  function buildStage() {
    var root = el('div', 'cine');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Chess opening cinematic');
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
    sub.textContent = tag ? tag.textContent.trim() : 'some games live longer';
    paintLogo(lc);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { paintLogo(lc); });
    Cine.logo = { box: logo, art: lc, sub: sub };
    Cine.caption = el('div', 'cine-caption', root);
    Cine.vhsEl = el('div', 'cine-vhs', root);
    Cine.hud = el('div', 'cx-hud', root); el('b', '', Cine.hud); el('small', '', Cine.hud);   // the naval HUD (hud())
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
    var w = 250, h = 40;
    cv.width = w; cv.height = h;
    var x = cv.getContext('2d');
    x.clearRect(0, 0, w, h);
    x.font = '800 34px "JetBrains Mono", ui-monospace, monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#28e8ff'; x.fillText('chess', w / 2 - 2, h / 2 + 1);
    x.fillStyle = '#ff2fa6'; x.fillText('chess', w / 2 + 1, h / 2);
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

  /* ---------- placing things on planes ---------- */

  // Plane-local pixels (from the plane's top-left, the name bar included) to world space, with the same
  // transform order the CSS uses: translate, rotateY, rotateX, rotateZ, scale, centre.
  function toWorld(it, lx, ly) {
    var x = (lx - it.w / 2) * it.s, y = (ly - it.h / 2) * it.s, z = 0, a, c, s, t;
    a = it.rz * D2R; c = Math.cos(a); s = Math.sin(a); t = x * c - y * s; y = x * s + y * c; x = t;
    a = it.rx * D2R; c = Math.cos(a); s = Math.sin(a); t = y * c - z * s; z = y * s + z * c; y = t;
    a = it.ry * D2R; c = Math.cos(a); s = Math.sin(a); t = x * c + z * s; z = -x * s + z * c; x = t;
    return { x: it.x + x, y: it.y + y, z: it.z + z };
  }
  function projectP(w) { return project(w.x, w.y, w.z); }

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

  /* ---------- Battleships scenery: the real grids as planes, the radar, the dossier, the warship ---------- */

  // A grid: the game's own markup and paint functions (ChessApp.cinematicKit), sized exactly by
  // battleships-cinematic.css so a cell's place on the plane is known without measuring (cellWorld).
  var BW = 586, BH = 650;
  function boardPlane(g, title, o) {
    var node = el('div', 'bsx-board' + (o && o.enemy ? ' enemy' : ''));
    var head = el('div', 'bsx-board-head', node);
    el('span', '', head).textContent = title;
    el('em', '', head).textContent = o && o.enemy ? '● TARGET' : '● LIVE FEED';
    var grid = KIT.makeBoard();
    node.appendChild(grid);
    el('small', 'bsx-board-foot', node).textContent = 'BALCADE NAVAL COMMAND · 10 × 10';
    var flash = el('div', 'bsx-board-flash', node);
    var it = plane(g, node, BW, BH, o);
    it.grid = grid; it.flashEl = flash; it.marks = {}; it.flashAt = -9; it.canvas = null;
    g.boards.push(it);
    return it;
  }
  function cellLocal(r, c) { return { x: 88 + 50 * c, y: 126 + 50 * r }; }
  function cellWorld(it, r, c) { var l = cellLocal(r, c); return toWorld(it, l.x, l.y); }
  function paintBoard(it, lock) {
    KIT.targetBoard(it.grid, it.marks, null);
    if (lock) { var cell = it.grid.querySelector('.bs-cell[data-r="' + lock[0] + '"][data-c="' + lock[1] + '"]'); if (cell) cell.classList.add('locked'); }
  }
  function boardFlashes(g) {
    g.boards.forEach(function (it) { it.flashEl.style.opacity = clamp01(1 - (Cine.t - it.flashAt) / 0.5).toFixed(3); });
  }
  // A plane's picture for the glass shatter (shatterGlass copies item.canvas): a quick raster of the grid's state.
  function boardRaster(it) {
    var cv = document.createElement('canvas'); cv.width = BW; cv.height = BH;
    var x = cv.getContext('2d');
    x.fillStyle = 'rgba(6,5,20,0.95)'; x.fillRect(0, 0, BW, BH);
    x.strokeStyle = it.enemy ? '#ff3bbb' : '#30e2ff'; x.lineWidth = 4; x.strokeRect(2, 2, BW - 4, BH - 4);
    for (var r = 0; r < 10; r++) for (var c = 0; c < 10; c++) {
      var l = cellLocal(r, c), m = it.marks[r + ',' + c];
      x.fillStyle = m === 'hit' || m === 'sunk' ? '#eb1d78' : m === 'miss' ? '#10182b' : '#101025';
      x.fillRect(l.x - 23, l.y - 23, 46, 46);
    }
    it.canvas = cv; it.head = 0;
    return cv;
  }

  // The radar scope, drawn every frame: rings, the sweep, contacts that ping in on cue.
  function radarPlane(g, o) {
    var cv = document.createElement('canvas'); cv.width = 900; cv.height = 900; cv.className = 'bsx-radar';
    var it = plane(g, cv, 900, 900, o);
    it.radar = cv; it.ctx = cv.getContext('2d');
    return it;
  }
  var CONTACTS = [[0.62, -0.35, 4.2], [-0.48, 0.22, 6.0], [0.18, 0.55, 6.15], [-0.2, -0.6, 6.3], [0.7, 0.3, 6.45]];
  function paintRadar(it, t) {
    var x = it.ctx, R = 440, c = 450;
    x.clearRect(0, 0, 900, 900);
    x.fillStyle = 'rgba(2,14,16,0.86)'; x.beginPath(); x.arc(c, c, R, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(76,245,197,0.35)'; x.lineWidth = 2;
    for (var i = 1; i <= 4; i++) { x.beginPath(); x.arc(c, c, R * i / 4, 0, Math.PI * 2); x.stroke(); }
    x.beginPath(); x.moveTo(c - R, c); x.lineTo(c + R, c); x.moveTo(c, c - R); x.lineTo(c, c + R); x.stroke();
    var a = t * 1.6;
    for (var k = 0; k < 40; k++) {                                     // the sweep: a fading fan behind the arm
      x.strokeStyle = 'rgba(76,245,197,' + (0.5 * (1 - k / 40)) + ')'; x.lineWidth = 6;
      x.beginPath(); x.moveTo(c, c); x.lineTo(c + Math.cos(a - k * 0.025) * R, c + Math.sin(a - k * 0.025) * R); x.stroke();
    }
    CONTACTS.forEach(function (p, j) {
      if (t < p[2]) return;
      var age = t - p[2], px = c + p[0] * R, py = c + p[1] * R, hot = j === 0 ? '#ff3bbb' : '#4cf5c5';
      x.fillStyle = hot; x.fillRect(Math.round(px - 9), Math.round(py - 9), 18, 18);
      x.strokeStyle = hot; x.lineWidth = 3; x.globalAlpha = Math.max(0, 1 - (age % 1.2) / 1.2);
      x.beginPath(); x.arc(px, py, 14 + (age % 1.2) * 60, 0, Math.PI * 2); x.stroke(); x.globalAlpha = 1;
    });
  }

  // The classified dossier (ChatGPT's text), as a panel in the world.
  function dossierPlane(g, o) {
    var d = el('div', 'bsx-file');
    d.innerHTML = '<b>▲ CLASSIFIED</b><span class="line">NAVAL INTELLIGENCE // SECTOR 07</span><span class="line">CONTACTS: MULTIPLE VESSELS</span>' +
      '<span class="line">IDENTITY: UNKNOWN</span><span class="line">AUTHORIZATION: GRANTED</span><span class="stamp">CLASSIFIED</span>';
    var it = plane(g, d, 900, 520, o);
    it.stamp = d.querySelector('.stamp');
    return it;
  }

  // The enemy warship: pixel art drawn at 160 x 70 and scaled 3x with hard pixels. It's lit like the rest of the
  // scene: a navy-black hull, a magenta rim where the horizon glow catches the deck edges, cyan portholes and bridge
  // windows, a red masthead light, a glowing waterline, a wake, and its reflection broken up in the water below.
  var SHIP_WL = 52;   // the waterline, in sprite pixels
  function paintShip(cv) {
    var x = cv.getContext('2d'), P = function (c, px, py, w, h) { x.fillStyle = c; x.fillRect(px, py, w || 1, h || 1); };
    x.clearRect(0, 0, 160, 70);
    var hull = '#110a2a', hull2 = '#1b1142', deck = '#2c1d66', rim = '#ff4fc8', rim2 = '#b56bff', glass = '#7beeff', steel = '#3b2c7a';
    // hull: square stern on the left, a raked bow on the right
    for (var y = 40; y < SHIP_WL; y++) {
      var l = 8 + Math.round((y - 40) * 0.35), r = 152 - Math.round((y - 40) * 1.5);
      P(y < 46 ? hull2 : hull, l, y, r - l, 1);
    }
    P(rim, 8, 40, 144, 1); P(rim2, 8, 41, 143, 1);                  // deck edge catching the light
    for (var i = 12; i < 148; i += 6) P('#ffb3ec', i, 40, 2, 1);     // glints along the rail
    P(deck, 10, 46, 136, 1);                                       // a darker band along the hull
    for (i = 18; i < 136; i += 7) P(glass, i, 43, 2, 1);           // portholes
    // superstructure: two decks, the bridge, the mast and radar
    P(hull2, 50, 31, 50, 9); P(rim2, 50, 31, 50, 1); P(rim, 50, 31, 3, 1);
    for (i = 53; i < 98; i += 5) P(glass, i, 34, 3, 1);
    P(hull2, 66, 23, 28, 8); P(rim2, 66, 23, 28, 1);
    P(glass, 70, 26, 20, 2); P('#ffffff', 72, 26, 3, 1);           // the bridge windows, one glint
    P(steel, 82, 8, 2, 15); P(steel, 76, 12, 14, 1); P(steel, 78, 16, 10, 1);
    P(glass, 75, 11, 2, 1); P(glass, 89, 11, 2, 1);                  // radar arms
    P('#ff3b6e', 82, 6, 2, 2); P('#ff9ec0', 82, 6, 1, 1);           // masthead light
    // the funnel, smoke-stained, its rim glowing
    P(hull2, 100, 25, 9, 15); P(rim, 100, 25, 9, 1); P('#0a0618', 101, 26, 7, 2);
    // turrets fore and aft, barrels reaching out
    P(hull2, 116, 35, 13, 5); P(rim2, 117, 35, 11, 1); P(steel, 129, 36, 17, 1); P(steel, 129, 38, 15, 1);
    P(hull2, 28, 35, 13, 5); P(rim2, 29, 35, 11, 1); P(steel, 12, 36, 16, 1); P(steel, 14, 38, 14, 1);
    P(steel, 136, 33, 6, 2);                                       // a small fore gun on its mount
    // waterline: a hot magenta line where the hull meets the sea, foam at the bow and a wake off the stern
    P('#ff3bbb', 8, SHIP_WL - 1, 146, 1);
    for (i = 0; i < 18; i++) P(i % 3 ? '#8cf4ff' : '#ffffff', 132 + i, SHIP_WL - 1 - (i % 2), 1, 1);
    for (i = 0; i < 28; i += 2) P('rgba(140,244,255,' + (0.8 - i / 40) + ')', 7 - i / 2 - i, SHIP_WL - 1 + (i % 4 ? 0 : 1), 2, 1);
    // the reflection: the hull flipped below the waterline, faint, broken into every other row by the swell
    x.save(); x.globalAlpha = 0.28;
    for (y = 0; y < 16; y += 2) {
      var sy = SHIP_WL - 1 - y, off = Math.round(Math.sin(y * 0.9) * 2);
      x.drawImage(cv, 0, sy, 160, 1, off, SHIP_WL + y, 160, 1);
    }
    x.restore();
  }
  function shipPlane(g, o) {
    var cv = document.createElement('canvas'); cv.width = 160; cv.height = 70; cv.className = 'bsx-ship';
    paintShip(cv);
    var it = plane(g, cv, 480, 210, o);
    it.canvas = cv; it.head = 0;
    return it;
  }
  function shipPoint(it, fx, fy) { return toWorld(it, 240 + fx * 210, 120 + fy * 36); }   // fx, fy: -1..1 across the hull

  // Your fleet, seen from above on the grid: a pixel ship per FLEET entry laid over its cells, in the same light as
  // the warship (navy hull, magenta rim, cyan glass, gun turrets, a wake). They drop in one by one as the fleet deploys.
  function paintTopShip(size) {
    var w = size * 16, h = 14, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var x = cv.getContext('2d'), P = function (c, px, py, pw, ph) { x.fillStyle = c; x.fillRect(px, py, pw || 1, ph || 1); };
    // hull: square stern on the left, the bow drawn to a point on the right
    for (var px = 1; px < w - 1; px++) {
      var nose = Math.max(0, px - (w - 8)), half = 5 - Math.round(nose * 0.62);
      P('#1b1142', px, 7 - half, 1, half * 2);
      P('#ff4fc8', px, 7 - half - 1, 1, 1); P('#7a2a9a', px, 7 + half, 1, 1);   // lit edge on top, shadowed below
    }
    P('#2c1d66', 3, 6, w - 11, 2);                                           // the deck's centre line
    for (var i = 0; i < size - 1; i++) {                                     // turrets, one per section
      var tx = 6 + i * 16;
      P('#3b2c7a', tx, 4, 5, 6); P('#b56bff', tx, 4, 5, 1); P('#8a6cff', tx + 5, 6, 5, 1);
    }
    P('#241a50', w - 22, 4, 7, 6); P('#7beeff', w - 21, 5, 5, 1); P('#7beeff', w - 21, 8, 5, 1);   // the bridge
    P('#ff3b6e', w - 18, 6, 1, 1);
    for (i = 0; i < 6; i++) P(i % 2 ? '#8cf4ff' : 'rgba(140,244,255,0.5)', 0, 3 + i * 2, 1, 1);   // wake at the stern
    return cv;
  }
  function addFleetSprites(it) {
    it.ships = FLEET.map(function (f) {
      var art = paintTopShip(f.size), cv = document.createElement('canvas');
      if (f.horizontal) { cv.width = art.width; cv.height = art.height; cv.getContext('2d').drawImage(art, 0, 0); }
      else { cv.width = art.height; cv.height = art.width; var x = cv.getContext('2d'); x.translate(art.height, 0); x.rotate(Math.PI / 2); x.drawImage(art, 0, 0); }
      cv.className = 'bsx-topship';
      var a = cellLocal(f.r, f.c), lenPx = f.size * 50 - 6;
      cv.style.left = (a.x - 2 - 22) + 'px'; cv.style.top = (a.y - 2 - 22) + 'px';
      cv.style.width = (f.horizontal ? lenPx : 44) + 'px'; cv.style.height = (f.horizontal ? 44 : lenPx) + 'px';
      it.el.appendChild(cv);
      return cv;
    });
  }
  function showFleet(it, count) { if (it.ships) it.ships.forEach(function (cv, i) { cv.classList.toggle('on', i < count); }); }

  /* ---------- missiles, splashes and fireballs (world points, drawn on the effects canvas) ---------- */

  // A missile from one world point to another, landing at t0 + dur: a white-hot pixel head with a flame trail.
  // kind 'miss' throws up water, 'hit' a fireball; onLand runs when it lands (marks the grid, shakes the camera).
  function missile(from, to, t0, dur, kind, onLand, arc) {
    Cine.missiles.push({ from: from, to: to, t0: t0, dur: dur, kind: kind, onLand: onLand, arc: arc == null ? 260 : arc, landed: false, last: null });
  }
  function missileAt(m, k) {
    var to = typeof m.to === 'function' ? m.to() : m.to, e = k * 0.4 + easeIn(k) * 0.6;
    return { x: lerp(m.from.x, to.x, e), y: lerp(m.from.y, to.y, e) - Math.sin(e * Math.PI) * m.arc, z: lerp(m.from.z, to.z, e) };
  }
  function splash(w, size) { Cine.splashes.push({ w: w, age: 0, size: size || 1 }); }
  function fireball(w, size) { Cine.fires.push({ w: w, age: 0, size: size || 1 }); }

  function drawMissiles(dt, t) {
    var ctx = Cine.fxCtx;
    Cine.missiles = Cine.missiles.filter(function (m) {
      var k = (t - m.t0) / m.dur;
      if (k < 0) return true;
      if (k >= 1) {
        if (!m.landed) {
          m.landed = true;
          var to = typeof m.to === 'function' ? m.to() : m.to, p = projectP(to);
          if (m.kind === 'miss') { splash(to, m.size || 1.6); Cine.shake = Math.max(Cine.shake, 0.35); }
          else { fireball(to, m.size || 2); if (p) { ring(p, 420 * Math.min(2, p.s)); burst(p.x, p.y, 70, [20, 35, 320, 50], 1.2); }
            Cine.shake = Math.max(Cine.shake, 0.9); Cine.flash = Math.max(Cine.flash, 0.22); Cine.aberration = 1; Cine.fovKick = -8; }
          if (m.onLand) m.onLand();
        }
        return false;
      }
      var w = missileAt(m, k), p = projectP(w);
      if (!p || p.d < 30) return true;
      var vx = m.last ? (p.x - m.last.x) / Math.max(dt, 0.001) : 0, vy = m.last ? (p.y - m.last.y) / Math.max(dt, 0.001) : 0;
      m.last = { x: p.x, y: p.y };
      var r = Math.min(40, Math.max(3, 7 * p.s));
      emitFlame(p.x, p.y, r, vx, vy, 5);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ffb249'; ctx.fillRect(Math.round(p.x - r), Math.round(p.y - r), Math.round(r * 2), Math.round(r * 2));
      ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(p.x - r * 0.55), Math.round(p.y - r * 0.55), Math.round(r * 1.1), Math.round(r * 1.1));
      ctx.restore();
      return true;
    });
    // splashes: a column of white water that rises and falls back, and rings spreading on the surface
    Cine.splashes = Cine.splashes.filter(function (s) {
      s.age += dt; if (s.age > 1.5) return false;
      var p = projectP(s.w); if (!p) return true;
      var age = s.age, k = Math.min(3, p.s) * s.size, rise = Math.sin(Math.min(1, age / 1.15) * Math.PI) * 125 * k, wide = (1 + age * 1.4) * k;
      for (var q = 0; q < qn(84); q++) {
        var u = ((q * 37) % 100) / 100 - 0.5, v = ((q * 53) % 100) / 100;
        var wx = p.x + u * 44 * wide + Math.sin(q) * 4 * age * k, wy = p.y - rise * v * (1 - Math.abs(u) * 0.9) + age * age * 30 * v * k;
        var sz = Math.max(2, Math.round((3 + (q % 3) * 2) * (1 - age * 0.45) * Math.max(0.6, k)));
        ctx.fillStyle = q % 4 === 0 ? '#ffffff' : q % 2 ? '#8cf4ff' : '#2bb8e8';
        ctx.fillRect(Math.round(wx / 3) * 3, Math.round(wy / 3) * 3, sz, sz);
      }
      ctx.strokeStyle = 'rgba(140,244,255,' + Math.max(0, 1 - age / 1.5) + ')'; ctx.lineWidth = 2;
      for (var rr = 0; rr < 3; rr++) { var R = (14 + Math.max(0, age - rr * 0.18) * 110) * k; ctx.beginPath(); ctx.ellipse(p.x, p.y + 6 * k, R, R * 0.22, 0, 0, Math.PI * 2); ctx.stroke(); }
      return true;
    });
    // fireballs: a pixel blast, white core through yellow and orange to magenta, with sparks thrown up
    Cine.fires = Cine.fires.filter(function (f) {
      f.age += dt; if (f.age > 1.3) return false;
      var p = projectP(f.w); if (!p) return true;
      var age = f.age, k = Math.min(3, p.s) * f.size, radius = (24 + age * 120) * k;
      for (var i = 0; i < qn(92); i++) {
        var ang = i * 2.39996, ringk = Math.sqrt(((i * 67) % 97) / 97), dd = ringk * radius;
        var fx = p.x + Math.cos(ang) * dd, fy = p.y + Math.sin(ang) * dd * 0.76 - age * 14 * k;
        var size = Math.max(3, Math.round((4 + (i * 17) % 11) * (1 - age * 0.55) * Math.max(0.6, k * 0.8)));
        ctx.fillStyle = ringk < 0.25 ? (i % 3 === 0 ? '#ffffff' : '#fff4a3') : ringk < 0.58 ? (i % 3 === 0 ? '#ffef67' : '#ff8123') : (i % 2 === 0 ? '#ff2f77' : '#f044a8');
        ctx.globalAlpha = Math.max(0, 1 - age / 1.3);
        ctx.fillRect(Math.round(fx / 3) * 3, Math.round(fy / 3) * 3, size, size);
      }
      ctx.globalAlpha = 1;
      return true;
    });
    drawFlames(ctx, dt);
  }

  // The naval HUD (top left): what's happening, in the dossier's typewriter voice.
  function hud(label, sub) {
    var h = Cine.hud;
    if (!h) return;
    if (!label) { h.style.opacity = '0'; return; }
    h.style.opacity = '1';
    if (h.dataset.label !== label) { h.dataset.label = label; h.firstChild.textContent = label; }
    h.lastChild.textContent = sub || '';
  }

  // The logo, centred, flickering on like the CRT in the other openings (the dossier shot).
  function logoCentre(lt, st, alpha) {
    var L = Cine.logo, width = Math.min(innerWidth * 0.62, 900);
    alpha = alpha == null ? 1 : alpha;
    L.box.style.display = 'flex';
    L.art.style.width = width + 'px';
    L.sub.style.fontSize = Math.max(11, width * 0.024) + 'px';
    L.box.style.left = (innerWidth / 2) + 'px';
    L.box.style.top = (innerHeight * 0.45 + (L.box.offsetHeight - L.art.offsetHeight) / 2) + 'px';
    var on = lt < 0 ? 0 : lt < 0.06 ? 1 : lt < 0.12 ? 0 : lt < 0.2 ? 0.7 : lt < 0.26 ? 0.1 : 1;
    L.art.style.opacity = (on * alpha).toFixed(3);
    L.art.style.transform = 'scaleY(' + (lt < 0.3 ? Math.max(0.05, lt * 3.3) : 1).toFixed(3) + ')';
    L.sub.style.opacity = st == null || st < 0 ? '0' : (smooth(span(st, 0, 0.6)) * alpha).toFixed(3);
  }

  // The fleet as the dossier describes it (ChatGPT's layout).
  var FLEET = [
    { id: 'carrier', name: 'Carrier', size: 5, r: 1, c: 2, horizontal: true },
    { id: 'battleship', name: 'Battleship', size: 4, r: 4, c: 4, horizontal: true },
    { id: 'cruiser', name: 'Cruiser', size: 3, r: 7, c: 1, horizontal: true },
    { id: 'submarine', name: 'Submarine', size: 3, r: 0, c: 8, horizontal: false },
    { id: 'destroyer', name: 'Destroyer', size: 2, r: 8, c: 7, horizontal: true }
  ];
  function shipMid(f) { return [f.r + (f.horizontal ? 0 : (f.size - 1) / 2), f.c + (f.horizontal ? (f.size - 1) / 2 : 0)]; }
  // The FOV kick a hit gives a path-driven shot, easing back out.
  function kick(dt) { Cine.fovKick = (Cine.fovKick || 0) * Math.max(0, 1 - dt * 5); Cine.cam.fov += Cine.fovKick; }
  function once(S, key, t, at, fn) { if (t >= at && !S.done[key]) { S.done[key] = true; if (t - at < 0.4) fn(); } }
  function burning(it, list) {   // grid cells (or hull points) on fire keep throwing flames
    list.forEach(function (w) { var p = projectP(typeof w === 'function' ? w() : w); if (p) emitFlame(p.x, p.y, Math.min(26, Math.max(4, 9 * p.s)), 0, -60, 1); });
  }

  // Chess scenery is attached to the copied engine's planes and camera. The live board kit supplies every square.
  // The Mac: ChatGPT's Higgsfield Mac drawn at 2x, its screen repainted by the film (boot, then the Finder with the Chess
  // window opening). One canvas pixel is eight world units; the screen is a 62 x 48 area at (14, 18).
  function macPlane(g, o) {
    var body = propArt('macDraft'), cv = document.createElement('canvas'); cv.className = 'cx-mac-art'; cv.width = body.width * 2; cv.height = body.height * 2;
    var it = plane(g, cv, cv.width * 8, cv.height * 8, o), c = cv.getContext('2d'), SX = 14, SY = 18, SW = 62, SH = 48;
    c.imageSmoothingEnabled = false;
    function box(color, x, y, w, h) { c.fillStyle = color; c.fillRect(SX + x, SY + y, w, h); }
    function text(str, x, y, px, align) { c.font = px + 'px monospace'; c.textAlign = align || 'center'; c.fillText(str, SX + x, SY + y); }
    it.draw = function (mode, progress, opened) {
      c.clearRect(0, 0, cv.width, cv.height);
      c.drawImage(body, 0, 0, cv.width, cv.height);
      c.save(); c.beginPath(); c.rect(SX, SY, SW, SH); c.clip();
      if (mode === 'boot') {
        box('#111621', 0, 0, SW, SH); box('#e2f6ec', 26, 5, 10, 13); box('#111621', 28, 9, 1, 1); box('#111621', 33, 9, 1, 1);
        box('#111621', 29, 14, 5, 1); box('#e2f6ec', 28, 18, 6, 1);
        c.fillStyle = '#e2f6ec'; text('Welcome to Balcade', 31, 28, 4);
        box('#e2f6ec', 15, 34, 32, 3); box('#111621', 16, 35, 30, 1); box('#e2f6ec', 16, 35, Math.floor(30 * clamp01(progress)), 1);
      } else {
        box('#d7d9da', 0, 0, SW, SH); box('#fffdf9', 0, 0, SW, 5); box('#1b1c2b', 0, 5, SW, 1);
        c.fillStyle = '#171927'; text('♣ File Edit View', 1, 4, 4, 'left');
        box('#1b1c2b', 4, 10, 7, 8); box('#e4e5e5', 5, 11, 5, 5); text('Chess', 7, 23, 4);
        var wx = 25, wy = 8, ww = 34, wh = 37;
        box('#f9fbfb', wx, wy, ww, wh); box('#161421', wx, wy, ww, 1); box('#161421', wx, wy + wh - 1, ww, 1);
        box('#161421', wx, wy, 1, wh); box('#161421', wx + ww - 1, wy, 1, wh); box('#c0bcc7', wx + 1, wy + 1, ww - 2, 4);
        text('Balcade', wx + ww / 2, wy + 4, 4); text('♞ ♛', wx + ww / 2, wy + 16, 8); text('CHESS', wx + ww / 2, wy + 25, 6); text('チェス', wx + ww / 2, wy + 32, 5);
        if (opened < .8) { c.strokeStyle = '#111621'; c.strokeRect(SX + wx - (1 - opened) * 18, SY + wy - (1 - opened) * 4, ww * opened, wh * opened); }
        c.fillStyle = '#171927'; text(opened > .8 && opened < 1 ? '⌛' : '➤', wx, wy + 18, 8);
      }
      c.restore();
    };
    it.draw('boot', 0, 0);
    return it;
  }

  function macFloor(g) {
    var cv = document.createElement('canvas'); cv.className = 'cx-mac-floor'; cv.width = 64; cv.height = 48;
    var c = cv.getContext('2d');
    for (var y = 0; y < 12; y++) for (var x = 0; x < 16; x++) {
      c.fillStyle = (x + y) % 2 ? '#123064' : '#e963ba';
      c.fillRect(x * 4, y * 4, 4, 4);
    }
    return plane(g, cv, 1800, 1350, { x: 0, y: 650, z: -2050, rx: 79, s: 1, op: 0, cull: false });
  }

  function macShadow(g) {
    var cv = document.createElement('canvas'); cv.className = 'cx-mac-floor'; cv.width = 64; cv.height = 32;
    var c = cv.getContext('2d');
    var it = plane(g, cv, 1150, 520, { x: 0, y: 644, z: -1830, rx: 79, op: 0, cull: false });
    it.draw = function (t) {
      c.clearRect(0, 0, 64, 32);
      var sweep = (t * .46) % (Math.PI * 2);
      for (var y = 0; y < 32; y++) for (var x = 0; x < 64; x++) {
        var dx = (x - 32) / 30, dy = (y - 16) / 14, r = Math.hypot(dx, dy);
        if (r >= 1 || (r > .8 && (x + y) % 3 === 0)) continue;
        var alpha = Math.max(0, 1 - r * r) * .43;
        c.fillStyle = 'rgba(13,11,45,' + alpha.toFixed(3) + ')'; c.fillRect(x, y, 1, 1);
        var ring = Math.abs(r - .72) < .035 || Math.abs(r - .42) < .025;
        if (ring && (x + y) % 2 === 0) { c.fillStyle = 'rgba(105,183,250,.4)'; c.fillRect(x, y, 1, 1); }
        var a = Math.atan2(dy, dx), delta = (a - sweep + Math.PI * 4) % (Math.PI * 2);
        if (delta < .2 && r < .83) { c.fillStyle = 'rgba(255,104,212,' + ((.2 - delta) * 1.5).toFixed(3) + ')'; c.fillRect(x, y, 1, 1); }
      }
    };
    it.draw(0);
    return it;
  }

  // The capture burst: ChatGPT's 16-frame sheet (chess-capture-burst.png, 4 x 4 frames of 192 px, played once at 12 fps)
  // of marble shards and pink petals, over the captured pawn.
  function burstPlane(g, o) {
    var d = document.createElement('div'); d.className = 'cx-burst';
    new Image().src = 'chess-capture-burst.png';   // fetch the sheet now, well before the capture
    var it = plane(g, d, 768, 768, o); it.frame = -1; return it;
  }
  function burstFrame(it, f) {
    if (f === it.frame) return; it.frame = f;
    it.el.style.backgroundPosition = ((f % 4) * 100 / 3).toFixed(3) + '% ' + (Math.floor(f / 4) * 100 / 3).toFixed(3) + '%';
  }
  function chessBoardPlane(g, o) {
    var shell = el('div', 'cx-board-frame');
    el('div', 'cx-board-label', shell).textContent = 'BALCADE / CHESS · LIVE POSITION';
    var board = KIT.makeBoard(); shell.appendChild(board);
    var vhs = document.createElement('canvas'); vhs.className = 'cx-vhs'; vhs.width = 210; vhs.height = 220; shell.appendChild(vhs);
    var it = plane(g, shell, 840, 880, o);
    it.board = board; it.vctx = vhs.getContext('2d'); return it;
  }
  /* VHS over the board, in place of hard flashes (photosensitivity: nothing here lights the picture by more than a
     soft lift, and the only fast-changing marks are thin, faint dropout lines): scanlines, a tracking band rolling down
     with its colour fringes pulled sideways, dropouts, head-switching noise along the bottom edge, and the picture
     drifting in a slow tracking wobble that kinks when a move or hit lands (Cine.vhs). */
  function vhsBoard(it, t) {
    if (!it || !it.vctx || !(it.op > 0.01)) return;
    var k = Math.min(1, 0.4 + Cine.vhs), x = it.vctx, W = 210, H = 220, f = Math.floor(t * 12), y, n;
    x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(20,6,40,0.16)';
    for (y = 0; y < H; y += 2) x.fillRect(0, y, W, 1);
    var by = ((t * 0.16) % 1.35 - 0.15) * H, bh = 14 + 26 * k;
    for (y = Math.max(0, Math.floor(by)); y < Math.min(H, by + bh); y++) {
      var e = Math.sin((y - by) / bh * Math.PI), off = Math.round((hash(y * 1.3 + f) - 0.5) * 24 * k * e);
      x.fillStyle = 'rgba(240,230,255,' + (0.06 + 0.1 * k * e).toFixed(3) + ')'; x.fillRect(0, y, W, 1);
      x.fillStyle = 'rgba(255,60,170,' + (0.34 * k * (0.4 + e)).toFixed(3) + ')'; x.fillRect(off + 4, y, W * (0.3 + hash(y + f) * 0.5), 1);
      x.fillStyle = 'rgba(40,220,255,' + (0.28 * k * (0.4 + e)).toFixed(3) + ')'; x.fillRect(W * 0.4 - off, y, W * 0.5, 1);
    }
    for (n = 0; n < 4 + 14 * k; n++) {
      x.fillStyle = 'rgba(255,255,255,' + (0.22 * k).toFixed(3) + ')';
      x.fillRect(hash(n * 3.3 + f * 1.7) * W, hash(n * 7.1 + f * 0.37) * H, 3 + hash(n + f) * 20, 1);
    }
    for (y = H - 6; y < H; y++) {
      x.fillStyle = 'rgba(220,210,255,' + (0.1 + 0.12 * k).toFixed(3) + ')';
      x.fillRect((hash(y + f * 0.5) - 0.5) * 30 * k + hash(y * 2 + f) * W * 0.5, y, W * 0.4, 1);
    }
    var wob = Math.sin(t * 2.1) * 1.2 + Math.sin(t * 5.3) * 0.6 * k + Cine.vhs * Math.sin(t * 9) * 5;
    it.board.style.transform = 'translateX(' + wob.toFixed(1) + 'px) skewX(' + (Cine.vhs * Math.sin(t * 6) * 1.2).toFixed(2) + 'deg)';
  }

  // A chess piece as a hologram: the game's own piece (the same glyph, font and colour as the live board: white pieces
  // #f7f2ff, black #ff4fa3) projected from a little pad on the floor. It's redrawn as pixels about 20 times a second
  // (holoTick): see-through body, bright edges, rolling scanlines, a bright sweep climbing it, the odd glitched row,
  // and a faint beam from the pad.
  var HOLO_W = 48, HOLO_H = 80, HOLO_MASK = {};
  function holoMask(p) {
    if (HOLO_MASK[p]) return HOLO_MASK[p];
    var c = document.createElement('canvas'); c.width = HOLO_W; c.height = HOLO_H;
    var t = c.getContext('2d'); t.fillStyle = '#fff'; t.textAlign = 'center'; t.textBaseline = 'alphabetic';
    t.font = '58px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", monospace';
    t.fillText(KIT.glyph(p) + '\uFE0E', HOLO_W / 2, 62);
    var a = t.getImageData(0, 0, HOLO_W, HOLO_H).data, m = new Uint8Array(HOLO_W * HOLO_H), top = HOLO_H;
    for (var k = 0; k < m.length; k++) if (a[k * 4 + 3] > 110) { m[k] = 1; top = Math.min(top, (k / HOLO_W) | 0); }
    return (HOLO_MASK[p] = { m: m, top: top, white: p === p.toUpperCase() });
  }
  function holoPlane(g, p, o) {
    var cv = document.createElement('canvas'); cv.width = HOLO_W; cv.height = HOLO_H; cv.className = 'cx-holo';
    var it = plane(g, cv, HOLO_W * 4, HOLO_H * 4, o);
    it.canvas = cv; it.head = 0; it.holo = { mask: holoMask(p), seed: p.charCodeAt(0) * 0.37 + (o.x || 0) * 0.001, frame: -1 };
    holoDraw(it, 0);
    return it;
  }
  function holoTick(list, t) { (list || []).forEach(function (it) { if (it && it.holo && !it.hidden && it.op > 0.01) holoDraw(it, t); }); }
  function holoDraw(it, t) {
    var H = it.holo, f = Math.floor(t * 20); if (H.frame === f) return; H.frame = f;
    var M = H.mask, m = M.m, W = HOLO_W, Hh = HOLO_H, x = it.canvas.getContext('2d'), img = x.createImageData(W, Hh), d = img.data;
    // the game's colours: a cool white-violet for white, the hot pink for black; the edges and sweep go nearly white
    var body = M.white ? [196, 236, 255] : [255, 79, 163], edge = M.white ? [247, 242, 255] : [255, 196, 228], glow = M.white ? [94, 240, 255] : [255, 113, 206];
    var sweep = M.top + ((t * 34 + H.seed * 40) % (64 - M.top + 18)) - 9;
    var glitchRow = hash(f * 1.7 + H.seed) > 0.86 ? Math.floor(hash(f * 3.1 + H.seed) * 60) : -99, hit = H.hit || 0;
    function put(k, c, a) { var q = k * 4; if (d[q + 3] >= a) return; d[q] = c[0]; d[q + 1] = c[1]; d[q + 2] = c[2]; d[q + 3] = a; }
    for (var y = 0; y < 64; y++) {
      var shift = Math.abs(y - glitchRow) < 2 ? (hash(f + y) > 0.5 ? 2 : -2) : 0;
      if (hit > 0 && hash(y * 0.37 + f * 1.3) < hit * 0.45) shift = Math.round((hash(y + f * 2.1) - 0.5) * 12 * hit);   // torn rows
      var scan = (y + (f >> 1)) % 3, near = 1 - Math.min(1, Math.abs(y - sweep) / 3);
      for (var c = 0; c < W; c++) {
        var sx = c - shift; if (sx < 0 || sx >= W || !m[y * W + sx]) continue;
        var k = y * W + c, isEdge = !m[y * W + sx - 1] || !m[y * W + sx + 1] || !m[(y - 1) * W + sx] || !m[(y + 1) * W + sx];
        var a = isEdge ? 235 : scan === 0 ? 150 : scan === 1 ? 95 : 55;
        a = Math.min(255, a + near * 120 + (y - M.top < 2 ? 40 : 0));
        put(k, isEdge || near > 0.5 ? edge : body, Math.round(a));
        if (hit > 0.25) { var sp = Math.round(hit * 3); if (c - sp >= 0) put(k - sp, [255, 60, 170], Math.round(120 * hit)); if (c + sp < W) put(k + sp, [60, 230, 255], Math.round(120 * hit)); }   // colour split
        // a soft halo a pixel out, in the glow colour
        [-1, 1].forEach(function (dx) { var cx = c + dx; if (cx >= 0 && cx < W && !m[y * W + cx - shift]) put(y * W + cx, glow, 70); });
      }
    }
    // the beam: a faint stippled cone from the pad up to the piece's foot
    if (!H.noPad) for (y = 63; y < 70; y++) for (c = 14; c < 34; c++) if (((c + y + f) & 1) === 0) put(y * W + c, glow, 60);
    // the projector pad: a dark disc with a lit rim that pulses
    var pulse = 150 + Math.round(Math.sin(t * 6 + H.seed) * 60);
    if (!H.noPad) for (y = 68; y < 80; y++) for (c = 4; c < 44; c++) {
      var ex = (c - 24) / 19, ey = (y - 72) / 4.6, r = ex * ex + ey * ey;
      if (y >= 72 && Math.abs(ex) <= 1 && y < 77) r = Math.min(r, ex * ex);           // the pad's side
      if (r > 1) continue;
      k = y * W + c;
      if (y < 72 && r > 0.6) put(k, glow, pulse);                                       // the glowing ring on top
      else if (y < 72) put(k, M.white ? [70, 52, 120] : [96, 30, 82], 255);               // the lens
      else put(k, y === 76 ? [20, 12, 40] : [44, 30, 76], 255);                          // the casing
    }
    x.putImageData(img, 0, 0);
    // power-down: the body squashes to a bright line through its middle, the line shrinks to a dot, the dot goes out
    if (H.off > 0) {
      var o = H.off, tmp = HOLO_TMP || (HOLO_TMP = document.createElement('canvas'));
      tmp.width = W; tmp.height = 64; tmp.getContext('2d').drawImage(it.canvas, 0, 0, W, 64, 0, 0, W, 64);
      x.clearRect(0, 0, W, 64);
      var hy = Math.max(1, Math.round(64 * Math.pow(1 - Math.min(1, o / 0.55), 2))), wx = o < 0.55 ? W : Math.max(1, Math.round(W * (1 - (o - 0.55) / 0.35)));
      if (o < 0.95) {
        x.imageSmoothingEnabled = false; x.drawImage(tmp, (W - wx) / 2, 38 - hy / 2, wx, hy);
        x.fillStyle = 'rgba(255,255,255,' + Math.min(0.9, o * 1.6).toFixed(2) + ')'; x.fillRect((W - wx) / 2, 38, wx, 1);
      }
    }
  }
  var HOLO_TMP = null;
  // the pad on its own, for the king that falls off his (48 x 12, drawn once)
  function holoPadPlane(g, white, o) {
    var cv = document.createElement('canvas'); cv.width = HOLO_W; cv.height = 12; cv.className = 'cx-holo';
    var x = cv.getContext('2d');
    for (var y = 0; y < 12; y++) for (var c = 4; c < 44; c++) {
      var Y = y + 68, ex = (c - 24) / 19, ey = (Y - 72) / 4.6, r = ex * ex + ey * ey;
      if (Y >= 72 && Math.abs(ex) <= 1 && Y < 77) r = Math.min(r, ex * ex);
      if (r > 1) continue;
      x.fillStyle = Y < 72 && r > 0.6 ? (white ? '#3a6a86' : '#7a3a6a') : Y < 72 ? (white ? '#463478' : '#601e52') : Y === 76 ? '#140c28' : '#2c1e4c';
      x.fillRect(c, y, 1, 1);
    }
    var it = plane(g, cv, HOLO_W * 4, 48, o); it.canvas = cv; return it;
  }

  /* The hand-pixelled props, drawn after Sean's reference sheets (pastel Ionic columns with ivy, the vaporwave starter
     packs' bust, dolphin, handheld, can and bottle, a stock sheet's arcade cabinet and striped sun, the sunglasses
     flamingo, the temple). Source and preview tool: tools/chess_cinematic_sprites.py, which writes this table.
     Each: s = canvas pixels per art pixel, p = palette, r = rows ('.' is clear). */
  var PIX = {"colPink":{"s":2,"p":{"a":"#8a3a7a","b":"#c45a9c","c":"#ee8cc6","d":"#ffb8dc","e":"#fff0f8","o":"#2a1a4a","g":"#2b8a4a","h":"#6fd06a","p":"#ff5aa8","q":"#ffd0ea"},"r":["oooooooooooooooooooo","oeeedddddddddddcccbo","obbbbbbbbbbbbbbbbbao","oooooooooooooooooooo","oeeoodddddddddcoobbo","oedeoeddddddddcobcbo","oeoeoeddddddddcobobo",".ooooddddddddddcooo.","....oddddddddccbo...","....obbabbabbaao....","....obbabbabbaao....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....odbbccbbcaao....","...oeddddddddcccbo..","...obbbbbbbbbbbbbo..","..oeeddddddddddccbo.","..obbbbbbbbbbbbbbbo.",".oeddddddddddddcccbo",".oddddddddddddddccbo",".obbbbbbbbbbbbbbbbbo",".oaaaaaaaaaaaaaaaaao",".ooooooooooooooooooo"]},"colPinkIvy":{"s":2,"p":{"a":"#8a3a7a","b":"#c45a9c","c":"#ee8cc6","d":"#ffb8dc","e":"#fff0f8","o":"#2a1a4a","g":"#2b8a4a","h":"#6fd06a","p":"#ff5aa8","q":"#ffd0ea"},"r":["oooooooooooooooooooo","oeeedddddddddddcccbo","obbbbbbbbbbbbbbbbbao","oooooooooooooooooooo","oeeoodddddddddcoobbo","oedeoeddddddddcobcbo","oeoeoeddddddddcobobo",".ooooddddddddddcooo.","....oddddddddccbo...","....obbabbabbaao....","....obbabbabbaao....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbhcbccabo....","....oedghcgccabo....","....oedbdgbccabo....","....oedbgcbccabo....","....oedpgcbccabo....","....oedghgbccabo....","....oedgdcbccabo....","....oegbdcbccabo....","....hegbdcbccabo....","....hegbdcbccabo....","....ogdbdcbccabo....","....ogdbdcbccabo....","....ogdhdcbccabo....","....oeghgcbccabo....","....oegbdcbccabo....","....oegbdcbccabo....","....oedgdcbccabo....","....oepgdcbccabo....","....oedbgcbccabo....","....oedbgcbccabo....","....oedbdgbhcabo....","....oedbdcghgabo....","....oedbdcgccabo....","....oedbdcbgcabo....","....oedbdcbcgabo....","....oedbdcbggabo....","....oedbdcbccgbo....","....oedbdcbccgbo....","....oedbdcbccgbh....","....oedbdcbccagh....","....oedbdcbccpgo....","....oedbdcbccago....","....oedbdcbchago....","....oedbdcbghgbo....","....oedbdcbccgbo....","....oedbdcbccgbo....","....oedbdcbcgabo....","....oedbdcbcggbo....","....oedbdcbgcabo....","....oedbdcgccabo....","....oedhdcgccabo....","....oeghdgbccabo....","....oedbgcbccabo....","....oedpgcbccabo....","....oedgdcbccabo....","....oedggcbccabo....","....oegbdcbccabo....","....odgbccbbcaao....","...ohdgddddddcccbo..","...ghgbbbbbbbbbbbo..","..oeegdddddddddccbo.","..obbgbbbbbbbbbbbbo.",".oeddgdhdddddddcccbo",".oddddghgdddddddcpbo",".obhbbgbbbbbbbbbgbbo",".ogpgagqaaaaaaaqahao",".oooohpgoooooooooooo"]},"colMint":{"s":2,"p":{"a":"#1f6a66","b":"#2f9a8a","c":"#5cd0b4","d":"#9cecd4","e":"#effff8","o":"#2a1a4a","g":"#2b8a4a","h":"#6fd06a","p":"#ff5aa8","q":"#ffd0ea"},"r":["oooooooooooooooooooo","oeeedddddddddddcccbo","obbbbbbbbbbbbbbbbbao","oooooooooooooooooooo","oeeoodddddddddcoobbo","oedeoeddddddddcobcbo","oeoeoeddddddddcobobo",".ooooddddddddddcooo.","....oddddddddccbo...","....obbabbabbaao....","....obbabbabbaao....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....odbbccbbcaao....","...oeddddddddcccbo..","...obbbbbbbbbbbbbo..","..oeeddddddddddccbo.","..obbbbbbbbbbbbbbbo.",".oeddddddddddddcccbo",".oddddddddddddddccbo",".obbbbbbbbbbbbbbbbbo",".oaaaaaaaaaaaaaaaaao",".ooooooooooooooooooo"]},"colMintIvy":{"s":2,"p":{"a":"#1f6a66","b":"#2f9a8a","c":"#5cd0b4","d":"#9cecd4","e":"#effff8","o":"#2a1a4a","g":"#2b8a4a","h":"#6fd06a","p":"#ff5aa8","q":"#ffd0ea"},"r":["oooooooooooooooooooo","oeeedddddddddddcccbo","obbbbbbbbbbbbbbbbbao","oooooooooooooooooooo","oeeoodddddddddcoobbo","oedeoeddddddddcobcbo","oeoeoeddddddddcobobo",".ooooddddddddddcooo.","....oddddddddccbo...","....obbabbabbaao....","....obbabbabbaao....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbhcbccabo....","....oedghcgccabo....","....oedbdgbccabo....","....oedbgcbccabo....","....oedpgcbccabo....","....oedghgbccabo....","....oedgdcbccabo....","....oegbdcbccabo....","....hegbdcbccabo....","....hegbdcbccabo....","....ogdbdcbccabo....","....ogdbdcbccabo....","....ogdhdcbccabo....","....oeghgcbccabo....","....oegbdcbccabo....","....oegbdcbccabo....","....oedgdcbccabo....","....oepgdcbccabo....","....oedbgcbccabo....","....oedbgcbccabo....","....oedbdgbhcabo....","....oedbdcghgabo....","....oedbdcgccabo....","....oedbdcbgcabo....","....oedbdcbcgabo....","....oedbdcbggabo....","....oedbdcbccgbo....","....oedbdcbccgbo....","....oedbdcbccgbh....","....oedbdcbccagh....","....oedbdcbccpgo....","....oedbdcbccago....","....oedbdcbchago....","....oedbdcbghgbo....","....oedbdcbccgbo....","....oedbdcbccgbo....","....oedbdcbcgabo....","....oedbdcbcggbo....","....oedbdcbgcabo....","....oedbdcgccabo....","....oedhdcgccabo....","....oeghdgbccabo....","....oedbgcbccabo....","....oedpgcbccabo....","....oedgdcbccabo....","....oedggcbccabo....","....oegbdcbccabo....","....odgbccbbcaao....","...ohdgddddddcccbo..","...ghgbbbbbbbbbbbo..","..oeegdddddddddccbo.","..obbgbbbbbbbbbbbbo.",".oeddgdhdddddddcccbo",".oddddghgdddddddcpbo",".obhbbgbbbbbbbbbgbbo",".ogpgagqaaaaaaaqahao",".oooohpgoooooooooooo"]},"colBlue":{"s":2,"p":{"a":"#2a4a96","b":"#3f78c8","c":"#6eaaee","d":"#a8d8ff","e":"#f0faff","o":"#2a1a4a","g":"#2b8a4a","h":"#6fd06a","p":"#ff5aa8","q":"#ffd0ea"},"r":["oooooooooooooooooooo","oeeedddddddddddcccbo","obbbbbbbbbbbbbbbbbao","oooooooooooooooooooo","oeeoodddddddddcoobbo","oedeoeddddddddcobcbo","oeoeoeddddddddcobobo",".ooooddddddddddcooo.","....oddddddddccbo...","....obbabbabbaao....","....obbabbabbaao....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....odbbccbbcaao....","...oeddddddddcccbo..","...obbbbbbbbbbbbbo..","..oeeddddddddddccbo.","..obbbbbbbbbbbbbbbo.",".oeddddddddddddcccbo",".oddddddddddddddccbo",".obbbbbbbbbbbbbbbbbo",".oaaaaaaaaaaaaaaaaao",".ooooooooooooooooooo"]},"colBlueIvy":{"s":2,"p":{"a":"#2a4a96","b":"#3f78c8","c":"#6eaaee","d":"#a8d8ff","e":"#f0faff","o":"#2a1a4a","g":"#2b8a4a","h":"#6fd06a","p":"#ff5aa8","q":"#ffd0ea"},"r":["oooooooooooooooooooo","oeeedddddddddddcccbo","obbbbbbbbbbbbbbbbbao","oooooooooooooooooooo","oeeoodddddddddcoobbo","oedeoeddddddddcobcbo","oeoeoeddddddddcobobo",".ooooddddddddddcooo.","....oddddddddccbo...","....obbabbabbaao....","....obbabbabbaao....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbhcbccabo....","....oedghcgccabo....","....oedbdgbccabo....","....oedbgcbccabo....","....oedpgcbccabo....","....oedghgbccabo....","....oedgdcbccabo....","....oegbdcbccabo....","....hegbdcbccabo....","....hegbdcbccabo....","....ogdbdcbccabo....","....ogdbdcbccabo....","....ogdhdcbccabo....","....oeghgcbccabo....","....oegbdcbccabo....","....oegbdcbccabo....","....oedgdcbccabo....","....oepgdcbccabo....","....oedbgcbccabo....","....oedbgcbccabo....","....oedbdgbhcabo....","....oedbdcghgabo....","....oedbdcgccabo....","....oedbdcbgcabo....","....oedbdcbcgabo....","....oedbdcbggabo....","....oedbdcbccgbo....","....oedbdcbccgbo....","....oedbdcbccgbh....","....oedbdcbccagh....","....oedbdcbccpgo....","....oedbdcbccago....","....oedbdcbchago....","....oedbdcbghgbo....","....oedbdcbccgbo....","....oedbdcbccgbo....","....oedbdcbcgabo....","....oedbdcbcggbo....","....oedbdcbgcabo....","....oedbdcgccabo....","....oedhdcgccabo....","....oeghdgbccabo....","....oedbgcbccabo....","....oedpgcbccabo....","....oedgdcbccabo....","....oedggcbccabo....","....oegbdcbccabo....","....odgbccbbcaao....","...ohdgddddddcccbo..","...ghgbbbbbbbbbbbo..","..oeegdddddddddccbo.","..obbgbbbbbbbbbbbbo.",".oeddgdhdddddddcccbo",".oddddghgdddddddcpbo",".obhbbgbbbbbbbbbgbbo",".ogpgagqaaaaaaaqahao",".oooohpgoooooooooooo"]},"colLilac":{"s":2,"p":{"a":"#5a4890","b":"#8068bc","c":"#a894e6","d":"#d0c2ff","e":"#f8f2ff","o":"#2a1a4a","g":"#2b8a4a","h":"#6fd06a","p":"#ff5aa8","q":"#ffd0ea"},"r":["oooooooooooooooooooo","oeeedddddddddddcccbo","obbbbbbbbbbbbbbbbbao","oooooooooooooooooooo","oeeoodddddddddcoobbo","oedeoeddddddddcobcbo","oeoeoeddddddddcobobo",".ooooddddddddddcooo.","....oddddddddccbo...","....obbabbabbaao....","....obbabbabbaao....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....odbbccbbcaao....","...oeddddddddcccbo..","...obbbbbbbbbbbbbo..","..oeeddddddddddccbo.","..obbbbbbbbbbbbbbbo.",".oeddddddddddddcccbo",".oddddddddddddddccbo",".obbbbbbbbbbbbbbbbbo",".oaaaaaaaaaaaaaaaaao",".ooooooooooooooooooo"]},"colLilacIvy":{"s":2,"p":{"a":"#5a4890","b":"#8068bc","c":"#a894e6","d":"#d0c2ff","e":"#f8f2ff","o":"#2a1a4a","g":"#2b8a4a","h":"#6fd06a","p":"#ff5aa8","q":"#ffd0ea"},"r":["oooooooooooooooooooo","oeeedddddddddddcccbo","obbbbbbbbbbbbbbbbbao","oooooooooooooooooooo","oeeoodddddddddcoobbo","oedeoeddddddddcobcbo","oeoeoeddddddddcobobo",".ooooddddddddddcooo.","....oddddddddccbo...","....obbabbabbaao....","....obbabbabbaao....","....oedbdcbccabo....","....oedbdcbccabo....","....oedbdcbccabo....","....ohdbdcbccabo....","....ghgbdcbccabo....","....oegbdcbccabo....","....ogdbdcbccabo....","....pghbdcbccabo....","....oghgdcbccabo....","....ogdbdcbccabo....","....oegbdcbccabo....","....oegbdcbccabo....","....oggbdcbccabo....","....oedgdcbccabo....","....oedgdcbccabo....","....oedbgchccabo....","....oedbgchgcabo....","....oedbdgbccabo....","....oedbdcgccabo....","....oedbdcgqcabo....","....oedbdcpgcabo....","....oedbdcbcgabo....","....oedbdcbcgabo....","....oedbdcbccgho....","....oedbdcbccghg....","....oedbdcbccgbo....","....oedbdcbccago....","....oedbdcbcchgo....","....oedbdcbcghgo....","....oedbdcbccago....","....oedbdcbccgbo....","....oedbdcbccgbo....","....oedbdcbcqggo....","....oedbdcbpgabo....","....oedbdcbcgabo....","....oedbdhbgcabo....","....oedbghgccabo....","....oedbdcgccabo....","....oedbdgbccabo....","....oedbgcbccabo....","....oedbggbccabo....","....oedgdcbccabo....","....oedgdcbccabo....","....ohgbdcbccabo....","....ghgbdcbccabo....","....oqgbdcbccabo....","....pgdbdcbccabo....","....ogdhdcbccabo....","....ogdhgcbccabo....","....oegbdcbccabo....","....odgbccbbcaao....","...oedgddddddcccbo..","...obghgbbbbbbbbbo..","..oeeddgdddddddccbo.","..obbbbbgbbbbbbbbbo.",".oedddddgddhdddcccbo",".odddddddgdhgdddcpbo",".obhbbbbbbgbbbbbgbbo",".ogpgaaaaagqaaaqahao",".oooohoooopgoooooooo"]},"ruin":{"s":2,"p":{"a":"#8a3a7a","b":"#c45a9c","c":"#ee8cc6","d":"#ffb8dc","e":"#fff0f8","o":"#2a1a4a"},"r":["....o.oo.o..oo.o............","....odoeoddobboo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo............","....oedbdcbccabo....ooooo...","....odbbccbbcaao...oeddcco..","...oeddddddddcccbooeeddccbo.","...obbbbbbbbbbbbbooeeddccbo.","..oeeddddddddddccboeeddccbbo","..obbbbbbbbbbbbbbboeeddccbbo",".oeddddddddddddcccboeddccbbo",".oddddddddddddddccboeddccbo.",".obbbbbbbbbbbbbbbbboeddccbo.",".oaaaaaaaaaaaaaaaaaoeddcco..",".oooooooooooooooooooooooo..."]},"bust":{"s":2,"p":{"o":"#2a1a4a","a":"#4a3a80","b":"#7a64b8","c":"#a896e0","d":"#cfc2f6","e":"#f4eeff"},"r":["..........oooooooo............","........oodeddcdcboo..........",".......odeedcddcdcbbo.........","......odedcdeddcdcbcbo........",".....odeddcdedcdcbcbbbo.......",".....odedcddeddcdcbcbbo.......","....odeddeeeeeddcdcbcbbo......","....odcdeeeeeeedccbcbbbo......","....odeeeeeeeeddcccbcbbo......","....oeeeeeeeeedddccbbcbo......","...oeeeoooeeedddcccbbbbo......","...oeeeobaeeddddccbbbbbo......","..oeeeeeeeeedddcccbbbabo......",".oeeeeeeeedddccccbbbbabo......",".oeeeeeeeddddcccbbbbaabo......","..oobeeeedddddcccbbbaabo......","...oeeeedddddccccbbbaabo......","...oooeeddddcccccbbbabo.......","...oeedddddcccccbbbbabo.......","....oedddddcccccbbbabo........",".....oeddddcccccbbbao.........","......oodddcccccbbao..........","........oddcccccbbo...........","........odcccccbbbo...........",".......odcccccbbbbbo..........",".....oodccccccbbbbbboo........","...oodddcccccccbbbbbbbboo.....","..odeeddddccccccbbbbbbbbbo....",".odeeeddddddccccccbbbbbbbbo...",".oeeeddddddcccccccbbbbbbbbbo..","oeeedddddddccccccccbbbbbbbbao.","oeeddddddddcccccccccbbbbbbbao.","oooooooooooooooooooooooooooo..",".......oeeddddddcccbbo........","........oedddddccbbo..........","........oedddddccbbo..........","......ooeeddddddcccbboo.......",".....oeeeddddddddcccbbbo......",".....obbbbbbbbbbbbbbbbaao.....",".....oooooooooooooooooooo....."]},"dolphin":{"s":2,"p":{"o":"#2a1a4a","a":"#5a1a7a","b":"#9a3ac0","c":"#cc6cf0","d":"#eaa4ff","e":"#ffe6ff","f":"#ffc8ec"},"r":["................oo..................","...............odo..................","..............odco..................",".............odcco..................","...........oodccbooooo..............",".........oodddccccbbbbooo...........",".......oodeeeddddcccccbbbboo........",".....oodeeeeddddddccccccbbbboo......","....odeeeddddddddcccccccccbbbboooo..","...odeedddddddddccccccccccbbobbbbbo.","..odddddddddcccccccccccbbbbbbaaaaao.","..obbcccccffffffffffffffffffffooooo.",".obbccffffffffffffoboffffffoo.......",".obcfffffffffffoooobbo.oooo.........","obcffffffffoooo...obbo..............","obcffffoooo........oo...............","obcfo...............................","obcbo...............................","obbbo...............................",".obcbbo.............................","obccbbbo............................","oooooooo............................"]},"flamingo":{"s":2,"p":{"o":"#2a1a4a","a":"#a0286a","b":"#e04a96","c":"#ff7ab8","d":"#ffaad4","e":"#ffe2f2","k":"#120c22","w":"#ffffff","y":"#ffb04a","l":"#ff6aaa"},"r":["......ooooo...............",".....odeeedo..............","....odeedddco.............","kkkkkkkkkkkkko............","kwkkkkokwkkkko............",".kkkko.kkkkkdo............","yyyo..odddcco.............","ykkko.odddcbo.............",".ooo..odccbo..............","......odccbo..............",".......odcbo..............",".......odcbo..............","........odcbo.............","........odcbo.............",".........odcbo............",".........odcbo............","..........odcbo...........","..........odcbo...........","..........odcbo...........",".........odccbo...........","........oddccbboooo.......",".......odeeddcccbbbboo....","......odeeeddddcccbbbbbo..",".....odeeedddddccccbbbbbao",".....odeedddccccccbbbbbaao",".....oddddcccccbbbbbbaaao.","......odcccccbbbbbbaaaoo..",".......occcbbbbbbaaaoo....","........ooobbbbaaooo......","...........oollo..........","............olo...........","............olo...........","............olo...........","............olo...........","............olo...........","............olo...........","............olo...........","...........ooloo..........","............olo..oooo.....","............olooollo......","............olollloo......","............oloooo........","............olo...........","............olo...........","............olo...........","............olo...........","..........oollloo.........","..........ooooooo........."]},"arcade":{"s":2,"p":{"o":"#2a1a4a","a":"#3a1a7a","b":"#5a24a8","c":"#7c34d8","d":"#a462ff","e":"#d8bcff","m":"#ff5aa8","n":"#ffd0ea","k":"#140c26","s":"#7fe05a","S":"#d8ffb0","t":"#2a7a3a","y":"#ffd640"},"r":[".oooooooooooooooooooooo.","oaeeeeeeeeeeeeeeeeeeeeeo","oaaaaaaddccccccccccccbbo","oaaaaaadmmmmmmmmmmmmmmbo","oaaaaaadmnnnnnnmmmmmmmbo","oaaaaaadmnnnnnnmmmmmmmbo","oaaaaaadmmmmmmmmnnnnnmbo","oaaaaaadmmmmmmmmmmmmmmbo","oaaaaaadmmmmmmmmmmmmmmbo","oaaaaaaddccccccccccccbbo","oaaaaaaddccccccccccccbbo","oaaaaaadkkkkkkkkkkkkkkbo","oaaaaaadksssssssssssskbo","oaaaaaadksSSSSssssssskbo","oaaaaaadksSSSSssssssskbo","oaaaaaadksssssssssssskbo","oaaaaaadksssssssssssskbo","oaaaaaadksssssstttttskbo","oaaaaaadksssssssssssskbo","oaaaaaadksttttttttssskbo","oaaaaaadksssssssssssskbo","oaaaaaadksssssssssssskbo","oaaaaaadksssssssssssskbo","oaaaaaadkkkkkkkkkkkkkkbo","oaaaaaaddccccccccccccbbo","oaaaaaeeemeeeeeeeeeeeeee","oaaaaadddkdddyyddmmddddd","oaaaaadddddddddddddddddd","oaaaaabbbbbbbbbbbbbbbbbb","oaaaaaaddccccccccccccbbo","oaaaaaaddccccccccccccbbo","oaaaaaaddccccccccccccbbo","oaaaaaaddccccccccccccbbo","oaaaaaaddcbbbbccbbbbcbbo","oaaaaaaddcbyybccbyybcbbo","oaaaaaaddcbbbbccbbbbcbbo","oaaaaaaddcbbbbccbbbbcbbo","oaaaaaaddcbbbbccbbbbcbbo","oaaaaaaddcbbbbccbbbbcbbo","oaaaaaaddccccccccccccbbo","oaaaaaaddccccccccccccbbo","oaaaaaaddccccccccccccbbo","oaaaaaaddccccccccccccbbo","oaaaaaaddccccccccccccbbo","oaaaaaaddccccccccccccbbo","oaaaaaaaaaaaaaaaaaaaaaao","oaaaaaaaaaaaaaaaaaaaaaao",".oooooooooooooooooooooo."]},"handheld":{"s":2,"p":{"o":"#2a1a4a","a":"#4a3a7a","b":"#8a76c8","c":"#b8a8ee","d":"#dcd2ff","e":"#fbf8ff","k":"#2a1a4a","s":"#a8f0e8","S":"#ffffff","t":"#3a8a9a","m":"#ff5aa8","n":"#ffc0e0"},"r":[".oooooooooooooooooo.","odeeeeeeeeeeeeeeeebo","oddccccccccccccccbbo","oddcaaaaaaaaaaaacbbo","oddcasssssssssSacbbo","oddcassssssssssacbbo","oddcassttttssssacbbo","oddcassttttssssacbbo","oddcassssttssssacbbo","oddcassssttssssacbbo","oddcassssssssssacbbo","oddcattttttttttacbbo","oddcattttttttttacbbo","oddcaaaaaaaaaaaacbbo","oddccccccccccccccbbo","oddccccccccccccccbbo","oddccckccccccccnmbbo","oddccckccccccccmmbbo","oddckkkkkcccnmcccbbo","oddccckcccccmmcccbbo","oddccckccccccccccbbo","oddccccccccccccccbbo","oddccccccccccccccbbo","oddccccbbcbbcccbcbbo","oddccccccccccbcbcbbo","oddccccccccccbcbcbbo","oddccccccccccbcccbbo","obbbbbbbbbbbbbbbbbbo","obbbbbbbbbbbbbbbbbbo",".oooooooooooooooooo."]},"can":{"s":2,"p":{"o":"#2a1a4a","b":"#2f9a8a","c":"#5cd0b4","d":"#9cecd4","e":"#effff8","S":"#f4f0ff","s":"#a8a0c8","w":"#ffffff","t":"#7a3a5a","p":"#ff6ab8","q":"#ffd0ea"},"r":[".ossSSSSsssso.","osSSSSSSSSSSso","odedccccccbbbo","odedccccccbbbo","odedccccccbbbo","owwwwwwwwwwwwo","odedccccccbbbo","odedccccccbbbo","odedccccccbbbo","odedccccpqbbbo","odedcccctcbbbo","odedccptcpbbbo","odedcccqccbbbo","odedpctcpcbbbo","odedqtccccbbbo","odeptcccccbbbo","odedctpcccbbbo","odetccccccbbbo","odedccccccbbbo","owwwwwwwwwwwwo","odedccccccbbbo","odedccccccbbbo","odedccccccbbbo","odedccccccbbbo","osssssssssssso",".osssssssssso."]},"bottle":{"s":2,"p":{"o":"#2a1a4a","b":"#6a54b0","c":"#9a84e0","d":"#c6b8ff","e":"#f4f0ff","k":"#ff5aa8","w":"#fbf8ff","l":"#e8e0ff","g":"#2b9a5a","p":"#ff5aa8"},"r":["...okkkko...","...okkkko...","...oeccco...","...oeccco...","...oeccco...","...oeccco...","...oeccco...","...oeccco...","..occcccco..","..occcccco..",".oddccccbbo.",".odeccccbbo.",".odeccccbbo.",".odeccccbbo.",".odeccccbbo.",".owwwwwwwwo.",".owllllllwo.",".owlglpllwo.",".owllggllwo.",".owlglgllwo.",".owlpglllwo.",".owllglllwo.",".owllllllwo.",".owwwwwwwwo.",".oddccccbbo.",".oddccccbbo.",".oddccccbbo.",".oddccccbbo.",".obbbbbbbbo.","..oooooooo.."]},"beachball":{"s":2,"p":{"o":"#2a1a4a","p":"#ff4fa8","P":"#c02a80","w":"#fbf8ff","W":"#cfc2f0","v":"#e0d8ff","V":"#b4a6e0","c":"#2ac8f0","C":"#1a80c0","y":"#ffd640","Y":"#d89a20","h":"#ffffff"},"r":[".......oooooooo.......",".....oowwwwwwwwoo.....","....owwwwwwwwwccco....","...owwwwwwwwwwcccco...","..opwwwwwwwwwcccccco..",".oppwwhhhwwwwccccccco.",".oppphhwwwwwcccccccco.","opppppwwwwwcccccccccco","opppppwwwwwwccccccccco","oppppppwwwwwwcccccccco","oppppppwwwwwwwccccccco","opppppppwwwwwwccccccco","opppppppcwwwwcccccccco","owwwwwwwywwwwwwwwvvvVo","owwwwwwyyywwwwwwvvvVVo",".owwwwwyyywwwwvvvvVVo.",".owwwwyyyyywwvvvVVVVo.","..owwwyyyyywvvvVVVVo..","...owyyyyyyyvvVVVVo...","....oyyyyyyyVVVVVo....",".....ooyyyyYYVVoo.....",".......oooooooo......."]},"swimring":{"s":2,"p":{"o":"#2a1a4a","p":"#ff5aa8","P":"#c02a80","w":"#fbf8ff","W":"#c8bce8","h":"#ffe0f0"},"r":[".........oooooooooooooooo.........","......ooohhhhhhhhhhhhhhhhooo......","....oohhhhhhhhhhhhhhhhhpppppoo....","...ohhhhhhhhhhhhhhppppppppppwwo...","..ohhhhhhhhhhhwwwpppppppppwwwwwo..",".ohhhhhhhhwwooooooooooppwwwwwwwwo.","ohhhhpppppoo..........oowwwwwwwwwo","oppppppppo..............owwwwwwwwo","oppppppppo..............owwwwwwwwo","owwwwwwwwwoo..........oopppppppppo","owwwwwwwwwwwoooooooooopppppppPPPPo","owwwwwwwwwwwpppppwwwwwpppPPPPPPPPo",".owwwwwwwwpppppppwwwWWWWPPPPPPPPo.","..owwwwwppppppppPWWWWWWWWWPPPPPo..","...owwppppppPPPPPWWWWWWWWWWWPPo...","....oopPPPPPPPPPPWWWWWWWWWWWoo....","......oooPPPPPPPPWWWWWWWWooo......",".........oooooooooooooooo........."]},"temple":{"s":2,"p":{"o":"#2a1a4a","b":"#7060b0","c":"#a894e6","d":"#d0c2ff","e":"#f8f2ff","P":"#ee8cc6","Q":"#ffd0e8","R":"#c45a9c","A":"#a8d8ff","B":"#6eaaee"},"r":["......................................oooBBBBooo......................................","....................................ooBBBBBBBBBBoo....................................",".................................oooBBBBBBBBBBBBBBooo.................................","...............................ooBBBAAAAAAAAAAAAAABBBoo...............................","............................oooBBBAAAAAAAAAAAAAAAAAABBBooo............................","..........................ooBBBAAAAAAAAAAAAAAAAAAAAAAAABBBoo..........................",".......................oooBBBAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBooo.......................",".....................ooBBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBoo.....................","..................oooBBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBooo..................","................ooBBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBoo................",".............oooBBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBooo.............","...........ooBBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBoo...........","........oooBBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBooo........",".....oooBBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBooo.....","....oBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBo....","....oeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeo....","....occcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccco....","....occccddccddccddccddccddccddccddccddccddccddccddccddccddccddccddccddccddccddcco....","....occccddccddccddccddccddccddccddccddccddccddccddccddccddccddccddccddccddccddcco....","....obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo....","....obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo....",".....oooooddddddddooooddddddddooooddddddddooooddddddddooooddddddddooooddddddddooo.....",".........oddddddddo..oddddddddo..oddddddddo..oddddddddo..oddddddddo..oddddddddo.......","..........oRRRRRRo....oRRRRRRo....oRRRRRRo....oRRRRRRo....oRRRRRRo....oRRRRRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........","..........oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo....oQQRPRRo........",".........oddddddddo..oddddddddo..oddddddddo..oddddddddo..oddddddddo..oddddddddo.......",".........oddddddddo..oddddddddo..oddddddddo..oddddddddo..oddddddddo..oddddddddo.......",".......oooddddddddooooddddddddooooddddddddooooddddddddooooddddddddooooddddddddo.......","......oeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeo......","......occcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccco......","....oooccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccooo....","...oeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeo...","...occcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccco...","...occcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccco...",".oooccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccooo.","oddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddo","obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo","obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo","obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo","obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo",".oooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo."]},"sunorb":{"s":2,"p":{"o":"#2a1a4a","a":"#ffe85a","b":"#ffc04a","c":"#ff9a5a","d":"#ff6a8a","e":"#ff4aa8","f":"#d03ac0"},"r":["..............oooooooooooo..............","...........oooaaaaaaaaaaaaooo...........","..........oaaaaaaaaaaaaaaaaaao..........","........ooaaaaaaaaaaaaaaaaaaaaoo........",".......oaaaaaaaaaaaaaaaaaaaaaaaao.......","......oaaaaaaaaaaaaaaaaaaaaaaaaaao......",".....oaaaaaaaaaaaaaaaaaaaaaaaaaaaao.....","....obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo....","...obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo...","...obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo...","..obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo..",".obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo.",".obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo.",".occcccccccccccccccccccccccccccccccccco.","occcccccccccccccccccccccccccccccccccccco","occcccccccccccccccccccccccccccccccccccco","occcccccccccccccccccccccccccccccccccccco","occcccccccccccccccccccccccccccccccccccco","occcccccccccccccccccccccccccccccccccccco","occcccccccccccccccccccccccccccccccccccco",".oooooooooooooooooooooooooooooooooooooo.","oddddddddddddddddddddddddddddddddddddddo","oddddddddddddddddddddddddddddddddddddddo","oddddddddddddddddddddddddddddddddddddddo",".oooooooooooooooooooooooooooooooooooooo.","oddddddddddddddddddddddddddddddddddddddo",".oeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeo.",".oeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeo.","..oooooooooooooooooooooooooooooooooooo..","..oeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeo..","...oeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeo...","...oeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeo...","....oooooooooooooooooooooooooooooooo....",".......oooooooooooooooooooooooooo.......","......offffffffffffffffffffffffffo......",".......offffffffffffffffffffffffo.......","........oooooooooooooooooooooooo........","..............oooooooooooo..............",".............offffffffffffo.............","..............oooooooooooo.............."]}};
  function pixArt(kind) {
    var sp = PIX[kind];
    if (sp.w) return rleArt(sp);
    var k = sp.s, h = sp.r.length, w = sp.r[0].length, cv = document.createElement('canvas');
    cv.width = w * k; cv.height = h * k;
    var x = cv.getContext('2d');
    for (var y = 0; y < h; y++) for (var c = 0; c < w; c++) { var ch = sp.r[y][c]; if (ch === '.') continue; x.fillStyle = sp.p[ch]; x.fillRect(c * k, y * k, k, k); }
    return cv;
  }
  /* ChatGPT's Higgsfield drafts (Docs/previews/higgsfield-pixel-drafts in the Unity project), snapped to their pixel grid
     with the translucent glow dropped (tools/chess_cinematic_drafts.py). They replace the duplicates above; the pastel
     columns stay. Each: w = width, p = palette, r = run-length rows ('a3' is three a pixels, '.' clear), z = display size. */
  var DRAFTS = {"palm":{"w":63,"p":{"a":"#04f4fc","b":"#04ecfc","c":"#04ecf4","d":"#0ce4fc","e":"#0ce4f4","f":"#04e4f4","g":"#08d8f4","h":"#04ccec","i":"#9464f4","j":"#8c64f4","k":"#945cf4","l":"#8c5cf4","m":"#8c5cec","n":"#fc2c94","o":"#fc2494","p":"#fc248c","q":"#ec308c","r":"#8454ec","s":"#fc1c8c","t":"#fc1484","u":"#1c148c","v":"#1c1484","w":"#1c0c8c","x":"#1c0c84","y":"#1c0c7c","z":"#140c84","A":"#140c7c"},"r":[".48p5.10",".47op5s.9",".26p7.13p8s.8",".25p10.9p11s.7",".24p11s.8p8.11",".22p16.5p6.14",".22p17.3p7.14",".21p7s2p10.2p7.14",".20sp4.3s3p9.2p6.2b5a2b.5",".19s2p2.10p8.p5.b4a8.3",".19sp2.10ap8.p4.2b3a7b3.2",".19sp.8b4a3p5.p3nb4a5b3aba.2",".19s2.6b6a3bp8ab2ab9a2b2.",".25cb8a3bcp5cab6c.b2.b2a2b2",".24b14a2p3ab2p2o4.5b3a2b",".24b12o2ab2p2b2s2p4o2.4b4a2",".23b8c2b2p4b2tfbps2p8.6ab",".22b8cfep7sgAab2sp8o.5b2",".22b7.2p9dx3b4p7o2.5b",".20cb5.2c.p8ofx4fb3ap7o2.4c",".20cb5.4p8bzx4fb3abap7o2.2b",".20b6.3p7obabx4gfb5.p7o.3",".20b4.5p6a2b3x3vhfb6.2p6.3",".20b4.5p6ab4xv4ufb3ab.2p6o.2",".20b3.4op6b6wv4wfcb5.2p5o.2",".20b2.5p7b5.2vxv3.cb5.3p5.2",".20b2.5p7b5.2x3vu.2cbab2.4p4.2",".20ab.5p7b5.2x2li2.3b4.4p4.2",".27p4o.2b5.4i2lw.2cb3.5p3.2",".27p4o.2b4.5xux2.2fb3.6p2.2",".28p3.3b4.5x4.3cb2.7p.2",".29p.4b4.5xv2xu.2fcb.7p.2",".29p.4b3.7vx2u.4b.7p.2",".29p.4b3.7v2xv.4b.10",".34b.9v4.4c.10",".34b.9v2xv2u.13",".11psp2o.28ux5.13",".10p7.9b4.15ji2li.13",".8p10.6b4ab2.14ji3l.13",".6p13.4b2a3b3.14i4x.13",".6sp12.3b2a4b4.13vx4.13",".6s.4p8.2cb9a.13vx5.12",".14p5.b3ab4.3b.14x5.12",".7b7.2p3b7.20x5.12",".5b4a3b4p3ab5.21x5.12",".4b3a3ba3b3pab4opop3.17x5v.11",".3b3aba3b2a2b2qc2baop6o3.14likili.11",".2ba5b4a2o3pc3p11.14l2ki2l.11",".b3ab6cp6ca3c2p10.13x5.11","b8.2op5cb2xaba3bap8.12x5.11","a3b2.4p5oab3x2a7p8.11x5.11","a3bc.3p6nb3zx3b2a3bsp8.10x5.11","a2b2.3p6nb4x4zb2a3.3p6.10v2x3v.10","ab.4p6oab4x5c2ba2b2.4p3.10xvx4.10","ab.4p5.2b4.2x5.b6.3p3.10x6.10","b.5p5.2b4.2xvx3.2cb4.4p2.10x6.10","b.4p5.3b4.3ux3.2cb4.4p2.9xml4i.10","b.4p5.3b4.3x3uv.2b4.4p.10xml4m.10",".5p4.5b2c.4li3.3b3.15xvm2x2m.10",".5p4.5b3.4l3mx.2fb2.15x7.10",".5p4.5b3.4x5.3ac.15x6.11",".5p3.6cb2.5x2vx.3cb.15x6.11",".6p2.7bc.5xv2xv.18x7.11",".6p2.7c.6uxv3.18x7.11",".6p.16x4.18x7.11",".23uv3.17xl4i2.12",".23lj2l.17vl2m3k.12",".23l4x.16vx6.12",".23x4v.16vx5.13",".24x5.14x7.13",".24x5.14x7.13",".24x5.14x7.13",".24x5.13x7.14",".24lx2jm.12x8.14",".24ij4x.11x8.14",".24lxljlx.11rm2l3m.15",".24x6.10xvml3ml.15",".24x7.9v3x5.15",".25x6.9x8.15",".25x6.8x8.16",".25x6.8x8.16",".25l6y.7x8.16",".25l6x.6x8.17",".25vx6.5x9.17",".25x8.4x9.17",".25x8.3x11.16",".22x26.15",".21x29.13"],"z":2.0},"palm2":{"w":77,"p":{"a":"#fcaccc","b":"#f4acc4","c":"#fca4cc","d":"#fca4c4","e":"#fc74c4","f":"#a45cf4","g":"#9c5cf4","h":"#9c5cec","i":"#04ccfc","j":"#04c4fc","k":"#04c4f4","l":"#fc2cd4","m":"#fc2ccc","n":"#fc24d4","o":"#fc24cc","p":"#fc24c4","q":"#fc1cc7","r":"#a454ec","s":"#9c54ec","t":"#f426cc","u":"#9452ec","v":"#6834b4","w":"#24046c","x":"#1c0474","y":"#1c046c","z":"#1c0464","A":"#140464"},"r":[".29y7.41",".29y8.40",".29yi7y3.37",".29yi7y3.37",".29y3i8y2.35",".29y3i8y2.35",".30y6i6y2.33",".30y6i6y2.33",".32yzy3i5y4.31",".34y4i6m2y.30",".34y5i5o2y2.29",".34y7i3oly2.29",".34y7i3o2y2.29",".35y7i2o3y2.28",".35y7i2o3y2.28",".25y7.3y7i2o3y2.28",".25y10.y4zi3o3y2.28",".25ziji4y3.2y2ei2jio3y2.28",".26y4i3y2.2y5i2o2y3.9y8.11",".15y8.3y4i4z.2y5i2o2y3.9y8z.10",".15y9.5y3i3y2.2y3i2o2y3.6y3i8y2.9",".10y5i8y4.2y3ji2zx.y4i2o2y3.5y4i8yz2y.7",".10y5i8y4.y5j2i2y5i2o2y3.3y3i5o8yz.7",".7y3ji16y2.3y3i2y3iji2o2y2.2y2i6to9moy2.5",".7y3i17y2.3y3i2y3i4qoy2.2zyi6o11mzy.5",".5y2i8y5i9y.2y3jijiy3i2y5zi5o7z2o8y2.3",".5y2i8y4xji8y2.y3i4y3ijy5zi4o8y2omo6y2.3",".3y2o5yxixy4iji2y3i5y2.2y3i2y3j2y2.yzi3o4y2zyo2yzyzo6y2.3",".3y2o2mly3iy4jijy5i7y5jijy7ijito6y3o3zy2zy3o2ty2.2",".2yonm3zy3iy3i2jiy5i7y5i4y6i3o7zy2o3my3z2yo2mzy.2",".y2o2mly9i2y5ji2y2i8y2xi2y5i2no9yz3o2y2.y3zyoyz.2",".y2o2m2y10iy5i3y2i9y2i2y3xi3o10zy2zo2y2.y2zy2o2z.2",".y2o2y5.5y8i2y3i9y2i2y3jio4my5o2zy.2y4.3y2zo3zy","y2o2ly4.6y12.xy3i5y2i2y3o6my6zy2.3y3.3y3qo2y2","zyo2ly3.8y4.y6.y4i5y2i2y3o6my6zy2.4y2.6zyoy2","y2oy2.18y12i4y3o5y4.5y4.12yo2y2","y2my2.18y12i4y3o3ymy3x.21y2oy2","y3.18yzo9y5i2yxo2my3i4y4.17y5","y2.19yo3mo4y2momzy3o3yxi11y3.15y2.2","y2.14y5o4m2o3y2o3y4o3zyi11y3.15y2.2",".15y2o9my7oy4o2ziji14y2.13yz.2",".15zyo10y7ozy2zpyziji16x.16",".13y2o11my10zy2zoy8i10x2.15",".12y3o7momoy4.5y2.y15i8y2.14",".12yzo7mzo2y5.5y2.2y14ji8y.14",".12y2o5my3o2y4.6y2c3y2m2ly8i9mzy.12",".12zo2mo3ly3o2y3.7y2ac2y2o2my8i4yi4omy.12",".10y2o3y2mo2y3o2y2.10y2cy2o2mol2my6i2yi4oyz.12",".10yzom2y2om2y3o2y2.10y5omo3m2zy5ijyi4oyz.12",".8y2o4y3o2y4o2y2.8y2h3y2xmo4my2.2y7i2omoy2.10",".8y2o2mly3o2y2.y3.10y2h3y4o4liy2.3y5i2mo2zy.10",".7yo6y3omy2.y3.9yzghg2y2.yzo3mijy.3y5i2yo4y2.8",".7zo3mpy8.13y2sg3y2.y2o3mi3y2.4y5o4y2.8",".7zxo3y9.13y2hg3zy.y4omi3y2.4y5o4y2.8",".5yzo5y2.3y4.13y2fscvy2.3y2o2i3y4.4y3o6y.7",".5zyo5y2.3y3.14yzc2avy2.3y2omi5y2.4y4zo4y.7",".5y2o5y2.20y4a3.4y2omyi4y2.4y5mo3z.7",".5y2o2y5.19y3zyAaA.4y5i4y2.7y3xo3y2.5",".5yzo2y5.18y2sh2shyx.4y5i4zy.7y4o3y2.5",".7y5.20y2sh3syx.6y5i4y.6y2.2zyoy2.5",".7zyzyz.20y2h3gsy2.6y5i4y.10zyoy2.5",".8zy.21yh5uhy.7y4xi4y.10z2oy2.5",".8zy.20y2sh4xy.8y5i4ky2.8y2my2.5",".8yz.20y2c2ac2y2.9y2i7y2.10y.7",".30y2a5zy.10yi8y.10y.7",".32y3aca.11yi3xyi2o2y2.8y.7",".32y3zyby.9y2i3y2i2o2y2.16",".32y2h2y3.9y2ijy3xiloy2.16",".30yzhfh3y2.11y7o2y2.16",".30y2h3gsy2.11y7omy2.16",".30y2shg2y.13y2.2y3o3ny2.14",".29zy2h2g2y.14y.3y2o3ny2.14",".29zyh3rz2.18y2o3my2.14",".29y2c3a2y.20yzomy2.14",".29zya2cacz.20yzomy2.14",".30xy3c3.21y2qy2.14",".30zy3wyz.21y2oy2.14",".29y2h3y3.21zy2.16",".29zyh4zy.21y3.16",".29y2h3x2.22y2.17",".29yzh2gy2.41",".28zh4gzy.41",".27y2h4sy2.41",".27y2c2acazy.41",".27y2a2ca2z2.41",".27yzy3ca2.42",".27y2sh2y3.42",".26y2zh4xy.42",".26y2h6y.42",".26yhgh3y2.43",".26y2fh3y2.43",".26yacacay2.43",".26y2ac2a2z.43",".26y4ac3.43",".26y2s2zyxy.43",".26ygshyzy2.43",".24y2gh4sy2.43",".24y2h6y2.43",".24y2h6y2.43",".23y2h5sy.45",".23y2cac3y2.45",".23y2a2cac2y.45",".23y5c4.45",".23y4zyz3.45",".23y2h3y2zy.45",".23y2h5y2.45",".23yh6szy.44",".21y2h7s2y2.43",".21y2sh5s3y2.43",".21y2adca4c2y2.43",".21y3za3ca3y2.3y3.37",".13y4.3yzjzy2uschy4.y2zy2.37",".13y4.3yijy3us3y4.y2iy2.37",".13y2jzy.2yi2jiy2us3ymz2j2iy2.37",".13y2i2jy2zijijy2s2xzo2y2ijyz.2y4.32",".15y2iy2zy2i2y2shy2ioy2jiy.3y4.32",".15zyi3y3only4ijoy2i2y.y2o3my.31",".15zyji2y3m2ly3i2jozyxy3o4xy2.31",".14y2zyziy3m2lxyi4zyjy4mo2my2.32",".12yzm3y2jixyom2y2i3yzi2y2o2my8.29",".12y2momz2xjiyomy2ji2y3kiy2o2my6z2.29",".12y3o3myi2yoy2i3y3i2y3omzy3m2om2y.28",".13y36.28",".15y34.28"],"z":1.45},"bust":{"w":54,"p":{"a":"#fcfcec","b":"#fcf4ec","c":"#fcf4e4","d":"#fcf4dc","e":"#fcece0","f":"#81edfb","g":"#6cecfc","h":"#64ecfc","i":"#87d8f8","j":"#64e4fc","k":"#a294f3","l":"#fc8ce5","m":"#9c8cf4","n":"#948cf4","o":"#fc84e4","p":"#9484f4","q":"#f27be5","r":"#8d34c9","s":"#2c1494","t":"#2c148c","u":"#241494","v":"#480c9c","w":"#2c0c94","x":"#2c0c8c","y":"#240c94","z":"#240c8c","A":"#240c84"},"r":[".17x6z2.29",".16zx6t2.29",".14z2sc7x5tx3.21",".12zxzacik2c5xwc4x2z2.19",".12x3c2bk2c5sc5sz3x.18",".9z3c22w2.18",".9zgfc2fk3mc4m2l2c7lw3x.15",".7zwjgfc2gk3mc8o2c7lolz.14",".7z2gjbc7k4c4r2c7o2lz.14",".7z2ghag2c6k2c7r2c5o4zx.12",".7zywg4c15rc6o5x.12",".7z2ghagk3c13r2c6v2oz2.12",".5sxg4cgk2c4yzc8s2ro2c5z3.12",".5wsg2jgc8w2npc3p3s2ro2c5x3z.11",".3zwg4yg2c5xsx2pnp2mpwxc5o2c3lc2z2.10",".3x2g4y2zc4bx4wsnp2z3c5o6c2Axz2.8",".2zg4bcgw2zyzywfc3wcwp2z2pc7o3l2c3zx.8",".z2g7swxz2xzc6zwxz2pc8wxq2lc2owx.7",".z2g7zwg2bc12zskmc6q4olo3x.7",".z3wg2p2z2g3c13wx3c4o2c5o4x.7",".3z2g4z2g3c15x2tsz2olc5v2oz2.7",".3z2g4zg4c15xz2xzxec6vx3z.7",".5yzg2wg4c16bzm2c10x2z.7",".5z2sz2g4c5z4wvmc5xpmc5ol2c3z2.7",".5z2uwz5c5z3Awc8z2qo4z2rc3ex.7",".3z3sjgz6c3z2xpnc3mkc4z2wo4z3o3sx.7",".3z2g4zg2wxzc4wxz3wrpc6zxz5wro4x.7",".4zg4wz2wgxc4wxz2c11xz3xzw2qow2x.7",".5w2g2zwy2gxc6zwc11zwxo3z5x.8",".6z4wj2gsc17o2xzcyo2xz4.9",".7z3wg2hnc16o2rc3zxcx2ozx.9",".9ywg3kc15o2r2c3zxcx2owz2.8",".9ywg3c4vc10o3c8zxo2z2.8",".9s2g3yc3vc10o2c3lc4xwo4x.8",".9swg3zwzsc16odc2zwo4x2.8",".9zwg6dc16oz4ro4wx.8",".11sg5c16o2wxo6x2.9",".11sg4z3wrbc11o3zo6x2.9",".11sg3zwc4tc10lo3zx2o3x3.9",".11wg4hc14lz2c2x2wo3x.11",".12z2g3z3c11lzxc2xo5x.11",".12z2g3zxc10o2zc4xo2vx3.11",".12z2xg2c11t2zc5zo2x3.12",".14zjgc11tx2c5zo2x2.13",".14zgjc6k2x2zxc7x3w.14",".14szszwyzy2z3xzxc7zxw.15",".15wzx2wz3xzx2zc8z.17",".15z2g2wzx4wzwc8z.17",".14z2wg4w2xswm2c8z.17",".12sxjz2g5p4c8o2zxs.15",".12xwg2wg6npmc8o2zx2.15",".9w4g10jn2c8o3x2.15",".6tsxg12c2g2nc8o5s.14",".6sz2g12c2g3k2c6o5ws.13",".5sg5c3g5c6gk2c6o6zx2.11",".3ywg4c6g4c7k2c6o2co4lowx3.7",".3yzg2c8g4c7k2c5o3co6x4.7",".2xg6c9g3c12o3c3o8wx2.4","sw2g6c9g5c10o3c3o8x4.3","w2g7c12g2c10o3c6o8zx3","wg9c13g2c8oc9o2c5lox2","sg9c13gc9oc9o2c5o2w2","sg9c18k2c13o2c5o2sw",".w2g7wxc17kc13oc6o2w2",".2wg7w2c29o2c7o2ts",".3s2g5ywc25o4c7losx.2",".4s2g4w2c25o4c5o2xozw.2",".5swg3n2wxc21o2c9o2x3.3",".5ywg3mnw2c20o2c9ozx2.5",".6xg3m2x2kc19o2c8o2x3.5",".7zsnm2n2xc27o4zx.6",".8wpm2n2xzc17oc7o5x2.6",".9s2mn2z3mc15oc7o4x3.6",".10s2pmpzxnmc20o6x.8",".11wmpmx2zxc15o2c3o4xwx.8",".12zmpz4w2c12o8lx3.9",".13x2z6knm2c8o6x4.11",".14z4x2wxm3c8o6x4.11",".15z2x4wsms2csct2cx6z.15",".15zx8w2xwx9zx.15",".15zg3c15o3z2.15",".13z2g4c15o4z2.14",".13z2g4c15o4z2.14",".13z5vrvwx10wrwz3xz.14",".15zx2g2jx2cxc2tc4o3z3x2.14",".16x2g3c11o4z.17",".16x2g3c11o4z.17",".16x2g3c11o4z.17",".15z5wc6sbc2swsoz3.16",".15z5swtx2t2xtx10.15"],"z":1.0},"dolphin":{"w":65,"p":{"a":"#fcfcf9","b":"#fcfce4","c":"#fcfcdc","d":"#fcf4f4","e":"#ecfcec","f":"#d4bcfc","g":"#ccbcfc","h":"#65cdfc","i":"#3cdbfc","j":"#34dcfc","k":"#34d4fc","l":"#2cdcfc","m":"#2cd4fc","n":"#ccb4fc","o":"#ccb4f4","p":"#bcb4fc","q":"#b064ec","r":"#f719e1","s":"#fc0ce4","t":"#fc0cdc","u":"#fc04e4","v":"#fc04dc","w":"#fc04d4","x":"#f404d4","y":"#14047c","z":"#140474","A":"#0c0474"},"r":[".46y3z2y2z.11",".23z2y4.14z4yz3y5.9",".22uz6.14z4g5fgzy.9",".20Auvtj5z3.8yz2ngn2g7fdz.8",".20z3j8z2.5z2ng13f3z6.2",".21z3j9z.2z2fng9yz2g2f4pj2ayz2",".23z2j8zyzfg12ya2zg2f3j4azy",".23z2j5y3z3g12uza2zfg2fj5ay2",".24z2j3yzyzg14vuz2y2f2gkj3z4y",".25zi2y2ng18yz2ogh2mzy2cb2z2",".25zy2fg13fg6cb2cbyz2bcb2z2.2",".24y2zgfg5f2g12c2b3cb2c2b2z2.3",".22z2wrg8fgfg2f2g3fgbc2b8jyz3.3",".21z2sng10f9b10jmz4.5",".20z2vg3fgfg8f3g2bcb7j3z3.8",".19zv2g5fg13b8j4y.11",".18zsvfg14ikj3b6j4y2.12",".17z2sg15j5bzb4j4z.14",".17zsfg9f2b2fj6bz2j5yz.15",".16ztf2g9cb3zj6bzj6z2.15",".15zysf2g7b5yzj6vzj5y.17",".15zytfgf4gfb5kyzj6vzyjz2y.18",".14zug3f5b5j3zyj5wz2y3.20",".14zsfg3f3cb4j4y2j4xty.24",".13z2gng3fb4j6y2zj3ivy.25",".13zvg5b2cej5zyzyj3ixyz.25",".12yzg5b3j5z2.2y2j3vyz.26",".12yvg3fbcbj4yz.4z2j2uz2.27",".12zvg2fb3j2lyz2.5z2jvz2.28",".11z2ngfgb2j3yz.7z3y2.29",".10z2vg3bcj3z2.9z2y.30",".10z2vg3b2j2z2.43",".10z2ufgcmjizy.44",".9z3g2bijz2.46",".9y2vngcjz2.47",".9y2rncilz.48",".9yzghj2zy.48",".8z2yhjmz2.49",".7z3j4z2.49",".5z3mlj2l2z3.48",".3z2qj9lz2.47",".3zrj11iyz.46",".2z2j6yzj5qy.46",".z2j6z4j4lz.46","z3j5yz3yj5y2.45","zyvj2yz3.3z2j4vy2.44","y2vz3.7z3j2vy2.44","z3.12z3vy2.44",".z2.12z.yzy.45",".18z2.45"],"z":1.1},"flamingo":{"w":43,"p":{"a":"#fcf9f0","b":"#fcecdc","c":"#fcecd4","d":"#fceccc","e":"#fcccdc","f":"#fcccd4","g":"#94dcf0","h":"#3ccffc","i":"#34ccfc","j":"#fcc1d3","k":"#fca4cc","l":"#41b9ee","m":"#fc6fb6","n":"#fc3ca4","o":"#fc3c9c","p":"#fc349c","q":"#fc3494","r":"#fc2793","s":"#fc1288","t":"#e20e86","u":"#240484","v":"#24047c","w":"#240474","x":"#1c047c","y":"#1c0474","z":"#1c046c"},"r":[".29w5.9",".27wyw4yw.8",".26vwo6wy.7",".25y2o9y.6",".24wo3w5y2vy3wy2.",".23ywpo3nywywvay3vay.",".22wxpo6w2a2y3way.2",".22yp3o2so3w2yvcyvy.3",".22yxp3syso4dc5y.2",".22yp2o2sw3s2rc6dy.",".22yvpo2sy.2w3yc6y.",".22y2po2sw.6wc5y2",".23y2po2w.7wvc2y2w",".23ywpo2y2.7wywy3",".23ywso2kw.8y4w",".24w2o3kw.8y3w",".25ywpo2kw.8y2.",".26zwo3kv.8w.",".27wyo2k2v.9",".28yro2kvy.8",".29yso2kyw.7",".30wrpok2w.6",".31yrpk2y.6",".18w8.6yo2k2v.5",".15v3k7vw2.4ypo2k2w.4",".14vk5o8y.4vo2k2v.4",".11ywyk4po10w.3wp2ok2w.3",".10w2mk3o14w.2wp2o2kw.3",".9wvp2o17y.2wp2o2kw.3",".8wvo2e4o3eo11v.wpo3kw.3",".7ywo2e5o2e3o10y.wo4kw.3",".6y2o2e4f2oe4of2eo6y2wo4kw.3",".6wo2e4mf3e4fe3pejo3nyp2o3kw.3",".5wo2fe3o2f2e2o2fe2o2pfjpo2wvpo4kv.3",".4wo2e4o2e3o3f2eo2pjfjqp6o2k2v.3",".3wo3e2o3e3po3f2o3j4so2p2opok2w.4",".3wo2feo4e2o3ejeo3j2fjrspo7rw.4",".2wpo2p2o3feo3e3p2oj3ns2o9w.5",".2wqh2iqr2o2poqi3o2sonr2s2o9wy.5",".wqih3r2h3prhi2os2o2n2tpo8sw2.6",".wqih2yvrh3r2hi2s2o2rt2p2o6s2w2.7",".wh3y2i2hir2hivs4yvxp2o6syw.9","wi3y2i3r3hihy2w2yrp2o6sw3.10","wi2w2hi2r3yh2y2p5o5s2w2.13","wvwyihr4wy2w5vp3o3s2w3.13",".2wi2yr3w2.5y2wyzsr2s2w.16",".vwi2yr2v.8w2i2y4w2.16",".wh2iyv2.8vh3vy2cy.18",".wihv.9ywh3v.y2cy.18",".w3.9wvh2yw.2y2by.18",".12ygh2vw.3y2by.18",".11yi2xu.5ybcy.18",".11wh2y2.5ywby.18",".11ywhb2v2.3w2by.18",".12vhycbw2v2w2cy.18",".13y2c4wy3cy.18",".15ywc4wzy2.18",".17w3c4w2.17",".20vwbc2py2.15",".21w2vwo2y2.14",".20w2ily2o2y.14",".20yh2iy2o2y.14",".20yh3y.yoy.14",".20wh3w.ypw.14",".21yvcw.zw.15",".21ybcw.18",".21y2cy.18",".21y2cy.18",".21y2cy.18",".21yc2v.18",".21yc2y.18",".21y2cv.18",".21ybcy.18",".21yb2y.18",".21y2ky.18",".21ypoy4.15",".20ypo6w3.12",".20yo9nw.11",".20y2w5yo2zw.11",".28y2.13",".28y.14"],"z":1.15},"arcade":{"w":32,"p":{"a":"#fcfcfc","b":"#fcf4fc","c":"#ecece4","d":"#ece4dc","e":"#24dcfc","f":"#1ce4fc","g":"#1cdcfc","h":"#10e4fc","i":"#14dcfc","j":"#14d4fc","k":"#fc34b4","l":"#fc34ac","m":"#fc2cb4","n":"#fc2cac","o":"#fc24a4","p":"#541c54","q":"#541c4c","r":"#4c1c54","s":"#4c1c4c","t":"#4c1454","u":"#4c144c","v":"#44144c","w":"#14044c","x":"#140444","y":"#0c0444","z":"#14043c","A":"#0c043c"},"r":[".2x27.3",".x29.2","x3n25x3.","x2fgn23g2yx2","x2g2fn21g3x3","x2g4n20ig2x3","x2nfg3n17hg3nx3","x2n2fg3n16g2fn2x3","x2n3fghin13mg2f2n2x3","x31.",".x3u2v21x3.2",".2x2v23x2.3",".2x27.3",".2x2u2v21x2.3",".2x2uv10uv11x2.3",".2x2v3ux16v3x2.3",".2x2vutx18v3x.3",".2x2v2x2zc14x2v3x.3",".2x2v2x2c2g5i3gi2gc2xv3x.3",".2x2v2x2cg2fag2i6g2cxv2x2.3",".2x2vux2cfa2g2i8gcx2vx2.3",".2x2v2x2cgag4i7gcxv2x2.3",".2x2v2x2cig6i6gcxv2x2.3",".2x2vux2cigi11gcx2v2x.3",".2x2uvxc2i14cx2vx2.3",".2x2uvx2ci14cx2v2x.3",".2x2uvx2igi12gcxv2x2.3",".2x2vux2g6i8gcxv2x2.3",".2x2u2x2c2g12c2xv3x.3",".2x2uvx3c14x2v2x2.3",".2x2v3x18v3x.3",".2x2v4x16v3x2.3",".2x2v5xu2v15x2.3",".2x2uvx6v15x2.3",".2x5kan2x18.3",".2x5kn2mx18.3",".x3s2xn3lzs6ps2p3s4x2.2",".x2s4x4s6rp2sp2spsps2x.2",".x2s4zx3s5x2zxqsx4s3Ax.","x2s3x5zxs3xban2x2zai2xs3x2","x2s3x2gx2gxs3yn4xyegigxs3x2","x2s3x2wgjx2s3x2n2x4g2ixs3x2","x2s5x4s5xzx2s3zx2s4x2","x2s20q2s6x2","x2s13qs14x2","x32",".x30.",".x3v24x2.2",".2x2v24x2.2",".2x2v24x2.2",".2x2v4u2x11v7x2.2",".2x2v4ux2uv9xv6x2.2",".2x2v5xu2x8vxv6x2.2",".2x2v5xvux8vxv6x2.2",".2x2v5xu2xn2x2nx2uxv6x2.2",".2x2v5xv2xn2x2nx2vxv6x2.2",".2x2v5xvx2n2x2ozxvxv6x2.2",".2x2v5xv2x8uxv6x2.2",".2x2v5xu2x8uxv6x2.2",".2x2v5xvux5cx2vxv6x2.2",".2x2v5xv2x5dx2uxv6x2.2",".2x2v5xv2x8uxv6x2.2",".2x2v5xv2x8uxv6x2.2",".2x2v5xv2x8uxv6x2.2",".2x2v5x2v9uxv6x2.2",".2x2v6x11v7x2.2",".2x2v24x2.2",".2x2v24x2.2",".x30.",".x30.",".xv27x2.",".xv27x2.",".xv27x2.",".x30.",".2x4.19x5.2"],"z":1.25},"handheld":{"w":37,"p":{"a":"#dcccfc","b":"#24fcfc","c":"#1cfcfc","d":"#14fcfc","e":"#14f4fc","f":"#d4c4fc","g":"#fc24a4","h":"#fc1ca4","i":"#1c1474","j":"#1c146c","k":"#14147c","l":"#141474","m":"#14146c","n":"#0c0c4c","o":"#0c0c44"},"r":[".3mi5li5l2i6li4l5m.3",".3i11l3i3li2li4l2i3l.3",".2m2a30im.","m2a33lm","m2a33l2","m2a34m","mia3mli24l2a3m","mla3l2i19li4l2a3m","lia3l2o24l2a3l","i2a3l2o24lma3l","i2a3l2o24m2a2l2","i2a3l2o24m2a3l","i2a3l2o24m2a2l2","i2a3mlo24l2a2l2","i2a3mlo9co3c2o9l2a2l2","l2a3l2o9c2d3eo9l2a2l2","i2a3l2o8bc6o9l2a3l","i2a3lio7c3ndcnc2o8l2a2lm","i2a3l2o7c3nc2nc3o7l2a3l","l2a3lio7c9o8l2a3l","i2a3l2o9co3d2o9l2a3l","i2a3l2o24l2a3l","i2a3l2o24l2a3i","i2a3l2o24l2a3i","i2a3lio24l2a2l2","ila3lio24mla2l2","lia3i3l8il3i4li3li2lia2l2","lia4li3l2i4l5i2l2i7a3li","i2a33li","i2a34i","i2a33li","lia7l3ima21l2","i2a6lm2i3a21l2","i2a6lh2glia21l2","i2a6lh2gmia14i4a3l2","ila3lm3hg2ljil2a4i4a2ilc3l2ali","ila3mg6hg2lia3ic3diailc3l2al2","i2a3mhg8lia2i2d2cdlaikc3lial2","i2a3mg2h2g5mia2i2d4lai2c3mial2","i2a3ml2mg3i4ma3ic2d2ia2i2l2a3l2","i2a6lhg2i2a7l4fa9l2","i2a6lg3mia7i4a10l2","i2a6l5ia21l2","mia6l2ilia23l","mia33l2","i2a33l2","mia33l2","i2a22iala2iaia3l2","lia22iala2iai2a2l2","i2a22mala2laia3l2","mia22iala2laia3l2","i2a33l2",".2ia31il.",".2i2a30i2.",".3ml2i10li9li3l2im.3"],"z":1.1},"can":{"w":30,"p":{"a":"#fcfcfc","b":"#f4fcf4","c":"#acf4e4","d":"#74f4dc","e":"#74f4d4","f":"#6cf4dc","g":"#6cf4d4","h":"#6cf4cc","i":"#64f4d4","j":"#d4d4dc","k":"#ccccd4","l":"#d1b6d9","m":"#fc9cdc","n":"#ac8cf4","o":"#ac84f4","p":"#0dddbd","q":"#9784d1","r":"#fc6cc5","s":"#fc64cc","t":"#fc64c4","u":"#a676c4","v":"#240c6c","w":"#240474","x":"#24046c","y":"#240464","z":"#1c046a"},"r":[".7xv2x11y.8",".7x5y3x4y3.8",".4x3qk13qv2x.5",".2x2qlk7x4k7qz2.3",".2x2jl4kl2xk3x2aj2l3kz2.3",".2x2jk2lq2u2x6a2l2k3z2.3",".2x2qk19qx2.3",".x2egq2k15q3gxz.2",".x2edbcq15g5x.2","x2g2b2eg4ion3g7eg3yx.","xg2b3eg4fn4g6e2g4x2","xg2b3g4n5eg12x2","xg2b2eg4n3ge2g9depx2","xg2b2g3on4geg10dp2zx","xg2b2g3n4g13dp2zx","xg2b2g2n3g15dp2x2","xg2b2gno2ng2tg11edp2zx","xg2b2dnog3ftg12dp2z2","xg2b2ong2t3g13dp2zx","xg2b2og2dt3g12edp2x2","xgb3g3t2g14rtp2x2","xg2b2g2t3g13t3p2x2","xgb3t4g13otg3px2","xgb3t2g15o2g2p2zx","xgfm2t2g14og3dp2zx","xtm3tg13no2g3dp2zx","xt2m2eg13n2g4d2pzx","xr2mbe2g10no3g3d2p2zx","xtb3g12o2g4t4pzx","xgb3g17t4p2x2","xg2b2g17t4p2x2","xg2b2g15t5gp2zx","xg2b2eg3e3g7rt4g2p2zx","xgb3e2g3e3g5t3sg3ep2zx","xfb3e2g4e2g4ft3rg3dp2zx","xgb3e2g9t5g2on2p2x2","xgb3e2go2g5t4g3o2nd2px2","xgb3e2go2g5t4g2o2ngep2x2","xg2b2edog5t5g2nong2ep2x2","xg2b2o3g3ft5g2n3g3ep2x2","xgb3o2g3eft4g2n2og3edp2x2","xg2l2g4ft5g2fn3g3t2p2x2","xgl3g2egrt3hg2n3eg4t2p2x2","xonb2eget4rg2n3e2g2ftg2epx2","xdb3e2rt4g3nog9p2x2","xgb3egt4g2no2g10p2x2","xg2b2t3r2g3ong12px2","xfb3t3geg2og13p2x2","xgfm2t2e2g18tx2","xgfm2t2eg18trx2","xg2m2teg18t2rx2","xgfm2g3dtg13ft3rx2","xgb3g3t2g13t4px2","xg2b2g2tg4eg9t3rp2x2","xg2b2gftg4eg9t3g2px2","xgb3t2g13ft3g2fqx2","xgfb2t2g12t4g2o3x2","xgb3eg11frt3gio4x2","xgb3e2g2eg6eft4g2o3px2","vgb3e5g6rt4ego3p2x2","vgb3e3ge2g5t2eg3o3gp2x2","xgb3e5g4t2g5o3g2p2x2","xg2b2e5g5tg4o3g3p2x2","zvdfb2e2geg5eg3nong4fpx2",".x2qe4g11n2g6x.2",".2z2q2e2g15q2x2.3",".3z2q19z2x.3",".4zxqk15qwx.5",".5xqk15qz.6",".6zxzx14.7"],"z":0.75},"bottle":{"w":21,"p":{"a":"#fcfce4","b":"#fcf4e4","c":"#fcf4dc","d":"#74e4d4","e":"#6ce4d4","f":"#ecc4fc","g":"#fc95cd","h":"#74dcd5","i":"#6cdcd4","j":"#e3bbfc","k":"#b494f4","l":"#fc8cce","m":"#b48cfc","n":"#b48cf4","o":"#ac8cf4","p":"#fc84c9","q":"#fc7cc4","r":"#fc74c4","s":"#ac84f4","t":"#a078ec","u":"#946ce5","v":"#2c1475","w":"#241474","x":"#240c74","y":"#240c6c"},"r":[".7x7.7",".6x3yx5.6",".5xcprg2rgr2x.5",".5xgprg2rgrx2.5",".6x2u2x2ux2.6",".5x3byutjx2.6",".5xnc2bn2fjyx.5",".5x2t3u3jx.6",".6xt3u3x2.6",".6xb3onfxw.6",".6xb3n2f2w.6",".6xb3n2f2w.6",".6xb3onf2x.6",".6xb3n2fx2.6",".6xb3n2fxw.6",".6xb2n3fx2.6",".5x2b3n2f2x2.5",".5xsb3n2fkox.5",".5wob2o2n4x.5",".5xob2o2n4x.5",".5xobo2n5x.5",".5xobo2n3o2x.5",".4xo2n2o4fnox.4",".4xnb2o5f2ox.4",".3wo2b2o3n2f2o2x.3",".3wob2no4n2f2ox.3",".2wonb2no4n2f2o2x.2",".2xonb2no5n2fo2x.2",".2xob2o8f3nx.2","xwnob2o8nmfn2xw","x2n2b2o9nfn2x2","x2n2bo10nfn2x2","x2n2bo11fn2x2","x2n2knon5o2non3x2","x2n2cn10o2n2x2","x2oncn10o2nox2",".2xkcih2ihind3ho2xy.",".2xnbhb10hoyx.",".2wkbhb4qb5o2x2.",".2vkbib3q3rb3hox2.",".2xnchb2q5b3hnx2.",".2vnkibq7b2onx2.",".2vnkibq5pqe2onx2.",".2vnkibcq2e6hnx2.",".2vn2ic3e5bchox2.",".2wnkie5b4cn2x2.",".2wnkie3b2cbg3n2x2.",".2vn2hecbcbg4ln2x2.",".2wn2dalglg3cbcnox2.",".2xn2ihglglhbd2bnox2.",".2xn8o2n5x2.",".2xncn6o2n5x2.",".2wnbn10f2kx2.",".2vncn5on4f2kx2.",".2vncn4o2n5fnx2.",".2wnbn3o3n4f2nx2.",".2wn2o4n3on2mfnxw.",".2wnbso2n7f2n2w.",".2vnco3n5on2fnxw.",".2vkco4n3o2n2fnxw.",".2wnbo3n4o2n4xv.",".yn2co2n5o2n2jnox.","yxnkcso8n2jn2ox","x2n2co2no5n2j2n2x2","x2n5on4o2n5x2","x2ob3u9nf2tx2",".x2b5u2n2u2f4uy.",".2xvb4n2on3fj2ux.2",".3x3w2vw2v3w2vx.3"],"z":0.9},"beachball":{"w":43,"p":{"a":"#fcfcfc","b":"#fcfcdc","c":"#fcf4dc","d":"#fcf4d4","e":"#c4fcfc","f":"#bcfcfc","g":"#1ce4fc","h":"#14e4fc","i":"#0ce4fc","j":"#fcb4e4","k":"#fcb4dc","l":"#fcace4","m":"#fcacdc","n":"#b474fc","o":"#1cdcfc","p":"#14dcfc","q":"#ac74fc","r":"#ac6cfc","s":"#fc14c4","t":"#fc14bc","u":"#fc0cbc","v":"#fc0cb4","w":"#2c0c7c","x":"#2c0c74","y":"#240c74"},"r":[".15xwx4w8.14",".12x2ywtstsxb2wc3xwx3.11",".11yx3ut4b3c6x3.11",".9x2t7ut3ubcb4c3x2.9",".9xwut4ut4u2b2cb3c3x2.9",".7x2u2t2ut7ut2sb2cac3b2x2.7",".7x2ut6u2t7b4dc2b2x2.7",".5x2tu5t3u8t2x5c5x2.5",".5x2t2u4t2u5t6wx4dbc3x2.5",".3x2u3tu5tu3j2l3j2x2wa2wxb2c4x2.3",".3x2u8j4l8wxwa2x2c2b4x2.3",".3x2u8ml10jx7c4b2xw.3",".2xwt2u3jl12jq3x5e3c2b2xwx.2",".2xwu5l3jl9q4wx3e6b2c2x2.",".2xu3l4j4l2j2l3q6nge7c4xw.",".2xu2tj14qrq3n2hge9dbxw.",".xtul2j12qrq5ng5e8b2yw","x2vtlj13r2q5ng4he8bcx2","x2lj13r4q5ng5e10x2","x2j14qrqr2q3npg5e10x2","x2j12q3r4q3ng7e9x2","x2j12qr3q6nghg5e9x2","x2j11r5q6ngh2g4e9x2","x2j11rq9h5g4e9x2","x2j9r3q8ng2h3ghg2e9x2",".xj9qr3q7ng3h4g2he8x2",".2xj7q3rq8ng2h5g4e6xw.",".2x2j5mrq10ngh7g3he5fxw.",".2xwj5rq11h11ghe6w2.",".3w2j2q14h13e4wx.3",".3w2j2q14ph11ge4xw.3",".3xwkjq12npgh10g2e4x2.3",".3x2j2q12npgh10g2e4x2.3",".5x2q11hph12g2e2w2.5",".5x2q11ih8g2hg4e2wx.5",".7w2q8nih7g3hg4w2.7",".9w2q6h2ghg2hghg8x.8",".9w2q5ng6h2g7x2.9",".11xw3qnh3g2hg5hw3.11",".11w4q2og11w3.11",".15x6wx6w.14",".15x5w2x7.14"],"z":1.0},"swimring":{"w":67,"p":{"a":"#fcfce4","b":"#fcfcdc","c":"#fcfcd4","d":"#04ecfc","e":"#04ecf4","f":"#d4c4e4","g":"#ac8cfc","h":"#a48cfc","i":"#a484fc","j":"#04e4f4","k":"#04e4ec","l":"#04dcec","m":"#9c84fc","n":"#f45cac","o":"#fc4cb4","p":"#fc4cac","q":"#f44cac","r":"#fc44ac","s":"#f444ac","t":"#1c048c","u":"#1c0484","v":"#1c047c","w":"#1c0474","x":"#140484","y":"#14047c","z":"#140474"},"r":[".26v15.26",".26v15.26",".20v5u2r2pr9p2v6.20",".17v2uvb2cb3p2rp5r4p2c3b3v4.16",".14uv5c5b2r3p6rp4c4bcv6.14",".14v2uc10r3p4rprp3c11v2u.13",".11vu2bc13r3p2r4p2c10b2c2uv2.11",".10uhvihihbc9br4p2rp4c11i2hiviuv.9",".9v2hi3h3bc8br6pr2prc11i2h4v2.9",".8v2hihihi2h2c9r3prp3r3c9hi4h4iv.8",".7vhih2i6h2c8prp6rp2c8hi7h3iu.7",".6v2i6h2i2h3c4buv9uv5c4i8h5mv.6",".5v2hi6h8c3vuv11uv3cb2ci8hi5v3.4",".4uvi7h9cuv4j2e4j2e2juv2uv2bi15v2.4",".3u2fhih2ih8iuvuvj5e8jeje2jv2u2i5h6i2hgvu.3",".3v2c7bh6uv2j2ej3uvu2vu2v2u2j3ej3vui4h3c7bu.3",".3vbc8bch2ihvuj4u3zv2uv7uvuj2e2jvui2hc11uv.2",".2vbc9b2i2uvwj5uv2.11v3j4ejuvihc11bv2.",".2vbc10b3cuj3u3.17u2vuj2vuc12b2v2.",".vbc7b7cvj2yu.22v2jv2cb6c7bwv","v2bc6b2rbrbp2ovlxv.23v2jv2bpbr4bc6bv2","v2c3b5r6pov3.25vyv2p3r2prpcbc5v2","v2c3b2r4p3rp2uv2.27v2uprp5r3pcbc2v2","v2bc2r4p9ov2u.24v2p9r2p3rc2v2","v2jcr3p11o2uv2.21v2urp11rp3bjv2","v2er4p11o2pv3.20vuvprprp13ev2","v2j2r3p13b3v3.15v4c3r3p12njv2","v2jejp5o2p5bc4b4v2u6vu5vbc8rp5rp5oj2dv",".u2jejprp2o2p4c8b2v14uc10p2r2p6ojetv.",".2ue3p9c10bci13c12rprp2rp3e3vu.",".2vrpe3p6c12bi13bc13rp4kje2sv2.",".3uvpe4p4c12bi12h2c11b2rp3j4qu.3",".3vupe4jp2c12hi15hc13poj4prv.3",".3vuprpe3kbc12i17c12bjej3p3u.3",".4vup3e4j2c10i17c11ecej2op2u2.4",".5up5eke3c9i17c10e3j2r2p2v2.4",".6vp5aje5c6i17c6e5jer3p2u2.5",".7vr2p2c2be4je5i17e5je4c3rp2ru.7",".7v2zr2c3b2kbe20je9bcbc3r2puv.7",".8v2rpbc5be28jc6br2pv.8",".10v2ucb2c6b3he16hc8b4v3.9",".13v2uc2bc3b2h2i16hc7b2u3.12",".13v2ubvbc2b3h2i16hc5b3vuv.13",".16v3wb4hi13hi4bc3bv4.15",".19v8hi11hv8.19",".27uvu5v2uvuv.27",".27v3u3v7.27"],"z":1.0},"temple":{"w":64,"p":{"a":"#fcf4ec","b":"#fcf4e4","c":"#fcf4dc","d":"#fcece4","e":"#fcecdc","f":"#cfc5ec","g":"#bc94fc","h":"#bc94f4","i":"#b494fc","j":"#b494f4","k":"#bc8cfc","l":"#b48cfc","m":"#b48cf4","n":"#b48cec","o":"#29d0f6","p":"#04def7","q":"#a88cf2","r":"#aa84f3","s":"#936be1","t":"#fc37c7","u":"#fc2cc5","v":"#8354d1","w":"#1c0474","x":"#1c046c","y":"#1c0464","z":"#140465","A":"#16045c"},"r":[".30x4.30",".30xt2x.30",".27x2wpt2pwx2.27",".25x2pwb6zpx2.25",".24x2wpeb6dpx2w.24",".21zyxp2bdbdbt2b5p2x2.22",".20wyxApb3u2qrqt2db2p2oxzx.20",".19yxp2bd3butqbq2t2b3d2pyxy.19",".17x2p2db2d2t2r2bd2bjqjtbd2bdp2x2.17",".14x3zpd4tutloabem2b2aoqt3db2dp2zx2.14",".14x2wpbd4tq2rbd3qm2bdbq2rtd2b3pzxz.14",".12x2p2b3d2t2q3b3mq2m3b3r3t2bdb2dp2x2.12",".9x3p2abdb2tq3mb6qm2lb6qrqt2bd2bdp2x3.9",".9x2p2bd3etrqrb4pb3qjmb4pb3dm2qtebdb2poy2.9",".6x2wp2d4t2lq2b4p2qpdb7prp2b4q3tub2d2p2x2.7",".4x3pb2db2dt2q2rb7m2pob4p2m2b7q4tdb4opx3.4",".3x3p2b2db2tq9rqm5qmqm8qmqmq4lub5p2x3.3",".2xt2b7d8bd8bdbd3bd16b7tx2.2",".2x2tb7d4b3dbdb2d4b3d4bdbd5b4d3b9tx2.2",".2x3qr7q8r11q15r12x3.2",".3x3yr6q3r3q2r10q7rq2r4q2r10yx2.4",".5x2b50x2.5",".5y2b50yx.5",".5x2s50x2.5",".5x3zs3w3x2zy2s3w2xzs2xy5wsfw4s2xy2sxs3w2s2x3.5",".6xypb6pAzy2pb5dpy7p2d3b2p2y3p2b5p2y.7",".6x2ztijh2t2y4ztoj2lt2y7zt2hj2oty4At2hj2oty2.7",".6x2ytd4t2y3z2tb3et2y8ted2bety5t2b4ty2.7",".8y2sqe2sAy3zywsqcesy8zysbe2sxy6seb2sz2.8",".8yzs3qsy6s4qsy10sq3sxy6sqsqsxy.8",".8y2dgbkhy6b2hbdgy10b2djdy7dhb2ghy.8",".8yb2gb2hy6d2gb2gy10b3gby7dhb2gz2.8",".8yb2gb2gy5zb2gb2hy10b3gb2y5zdhb2gz2.8",".8yb2hb2gy6b2gb2hy10b3gby6zdgb2gz2.8",".8yb2hb2hy6b2gb2hy10b3hby6zdgb2gzy.8",".8yb2hb2hy5zb2gb2hy10b3gby7dgb2gzy.8",".8yb2gb2gy5zb2gb2gy10b3gby7dgb2gy2.8",".8yb2gb2hy5zb2gb2gy10b3gb2y6dhb2gy2.8",".8yb2gb2hy6b2gb2hy10b3gby7dhb2gy2.8",".8yb2gb2hy6b2gb2hy10b3gby7ehb2gz2.8",".8yb2gb2gy5zb2gb2hy10b3hb2y6ehb2gy2.8",".8yb2hb2gy5zb2gb2hy10b3hb2y6dhb2gy2.8",".8yb2hb2jy5zb2gb2hy10b3gby6zbhb2gxy.8",".8yb2hb2jy6b2gb2gy10b3gby7dhb2gxy.8",".8yb2gb2jy6b2gb2gy10b3gb2y6dhb2gy2.8",".8yb2gb2my6b2hb2hy10b3gby7dhb2gy2.8",".8y2bgb2my6bdgb2jy10b3hby7dgb2hy2.8",".8yAfq2msy6dbr3sy10dm2qsy7drq2ry2.8",".6xyxtdb2dt2y4ztd2b2t2y8tubdb2ty4zt2bd2bty2.7",".6yxztb3dt2zy3zted2bt2zy7t2ed2btzy3zt2d3ety2.7",".6xyp3jm2p2xy3p3nj2p2y4xy2p3jm2p3y3p3j4p2x.7",".5x2zqbd2b2d2zy3qed2b2d2y4xyxqobd2bd3y2xo2d2bd4yx2.5",".5yx2yx5y6x3yxyx3y4x11y3x6y2x2y2.5",".3x4y4x2y8xy5x2y5dx2yx4y8x2y5x2y.4",".3x2tab50t2y.4",".3x2t2m2ilmibmlm6lm11i3m4ijlbigijml2mjij2t2x.4",".3x3tj2i5jljm4jm9j3ij3m2jijm2ig2jmi2j3i2ty2.4",".x5v52yx4.","x2tb9db47atx2","xt2b9db48txy","xt2ki2g12i7j3ij5i3j2imji13ji5uzy","x2plm2g3ig9i2li6m15i6m3i6jljx2y",".x2w43xw14xy.",".x5w4x12wx3wx2w2x2w2x5w3x7wx7wx3.2"],"z":2.2},"sunorb":{"w":47,"p":{"a":"#fcd47c","b":"#fcd474","c":"#fcac8c","d":"#fcac84","e":"#fca484","f":"#fc7cac","g":"#fc74ac","h":"#fc74a4","i":"#fc1cac","j":"#fc14ac","k":"#fc14a4","l":"#f414a4","m":"#1c0c6c","n":"#1c0c64","o":"#140c6c","p":"#140c64","q":"#e4048c","r":"#dc048c","s":"#dc0484"},"r":[".17a13.17",".17a14.16",".13ba20.13",".13a21.13",".10a27.10",".9a30.8",".8a31.8",".7a34.6",".6a35.6",".5d2ce3c20dc9e.5",".5dc35de.4",".3d3c36de.3",".3d2c37de.3",".3d2c38d.3",".2edc39de.2",".2dc6dcdc28dcd2e.2",".2h13ch9g2hcgh2c2h3gh7.2",".2hg10hg25hg2h4.","h2g43h2","h2g43h2","hg12fg31h2","hg7fgfg35h","hg7fgfg2f2g8f2g21h","hg12fg33","hg46","fg32fg6hg5h","pn2m24p3n2m2p2np2m2np5","pn2m21pm2omn2m2np4m3n4pm","kj2i2jij35ij4","kji11ji7j13i2j3i5j3","lki19j12i9ji2j2",".k4j2i2j10ij26k",".2np4nm20nm4n5m3nmnm.2",".2p4n5m8nm7pn2m3n5m3n3p.2",".2p2n41.2",".2sq6r6q27r2q.2",".3rq3r7q27rqr.3",".3s2r9q7rq5r2q3r9qr2.3",".5s20mrms12oq.5",".5n2p2n4p2nm4n16p6.5",".6p3n4pn3pn19p4.6",".7qsqr3q2r2qr3qrqr2q2r2qrq9.6",".8s2r6qr14sr7.8",".8s3r17sr7s2r.8",".10s3r12s2r8s3.9",".12s3r7s2rsrsr7.12",".13s4r6sr3s6r2.12",".16s4r3s2rs6.15",".18s11.18",".19s10.18"],"z":1.6},"ruin":{"w":52,"p":{"a":"#fcf4e4","b":"#fcf4dc","c":"#fcecdc","d":"#cdbce3","e":"#33c6dd","f":"#bc9ce4","g":"#bc9cdc","h":"#b49ce4","i":"#b49cdc","j":"#b494dc","k":"#f764ac","l":"#a88dd8","m":"#987ccd","n":"#9474cc","o":"#8466c3","p":"#665db5","q":"#ef379e","r":"#e81c98","s":"#dc1494","t":"#6a36a1","u":"#341b89","v":"#2c2d8c","w":"#2c148c","x":"#2c1484","y":"#2c147c","z":"#2c0c81","A":"#242b88"},"r":[".9e4r2.37",".7e2acb3cr4.33",".6epb8cwxr.32",".6evb9x2s.32",".6ef2b6f2ux2s.31",".6vf10duxzu.30",".5pcagf6b4dx2.30",".5vb2gf5b5cx2ts.28",".5vb2f2gf4b5d2gusr3.24",".5vigf5a2b4cb2cpcu2r.24",".5wig2f4b3fbafb2apbu2cr.23",".4eAf7b3f4b8r.23",".2e3uf3gf13b5cr2.21",".e2v3ig5f7gf3gbab3qr.21",".ex2c2b18cpab3cu.20",".ezxm2aop2o2po2po4po2pap2a2cagur2.17",".exznm2p6o7po3p4og3ur2.17","e2vabcb5dj3i8jcb3abcb2yr2.16","evb3ln3dcb12atl3mlmbads2.16","epacimb2n2b2ab10ctcb2ab2obdks.16","pva2nb4ng2p11xb4o2aobgs2.16","vubanbaoaox2zp2m7lxagiaoaboaikt.16","v2abon2oaox2ztm8luai2ao4aikt.16",".xcab2nabuijcn2b8lag2bconbcut.17",".2x2b3azxwdj3b2j2b2j3x3dcb2czr2.17",".4x5mfaj2b3j2b2j4o2yxz3s.19",".4x4njdbj3b2j2b2j4goyxzxz.20",".7xnib2j3b2j2b2j2ibl2oy.23",".7vaib2j3b2j2b2j3bl2qx.23",".7vaib2j2ab2j2b2j3bl2qs.23",".7ecgb2j2b3j2b2j3bl2qs.23",".7ecgb2j3b2j2b2j3bl2qs.23",".7ecgb2j3b2j2abj3bl2qs.23",".7ecgb2j3b2j2abj2ib2lqs.23",".7ecgb2j3b2j2b2jijb2jqs.2vtr.18",".7ecib2j3b2j2b2ji2balqr.2vb2s.17",".7ecgb2j3b2j2b2ji2bajqsx2vc3r2.15",".7ecgb2j2b3j2b2i3b2jqsx2cb5r3.12",".7ecgb2j2b3j2b2i3balqx2b5gfb2cr2.10",".7ecgb2j3b2j2b2ji2bajyx2cb3igibcbr3.9",".7eagabj3b2j2b2ji2bax2ydf2cib3gb3r3.8",".7eagabj3b2j2b2ji2b2lxdg2f2cb8r2.8",".7ecib2j3b2j2b2ji2bx2dg4fb10cr.7",".7ecib2j3b2j2abji2bxudg4fab9cr2.6",".7ecgb2j3b2j2abj2ibxzfg4f2ab5i2fgjr.6",".7pagabj3b2j2b2jijbz2xig4f3b2i2fcb3r2.5",".6xgagb2jijb2j2b2j3bo2xi5gf2afgicb4r2.5",".5exfaib2i3b2jib2j2ibouxi4gf3cfb7ar2.4",".5exgcib2i3b2j2b2j3bn2pxi4gfihgb8r2.4",".4epacmib2ji2b2j2b2j3bn2pxi7opb9r.4",".4eyb4iji2ab2j2ablj2n5xi6phb9tr.3",".4ex2b4j2bib9non2x2i5pfifb9r.3",".5xwf2b16gfmx2ui4pg2f2b8or.2",".4exjp2n6db4g2m2nowx5j3lg2f3b8r2.",".3evcacgn6m11n2x4j2ioigf3bob7r2",".2e2pcb2gmn6m10n2oqx3j2og2f3o3b6r2",".e2xpg2b19di2qx3jitg3f2b2coi2gf2r2",".exlo2if3b13agj2ioux5i3g2fdcb2oi3usr",".ewj3i2gib9ab3ij3o2xzx4i5gf2b2ojixzt.",".ezij2i10gigpj7ijiqx5i4gfhb2oix2r2.",".2zx3i6b5apoj6ai3qx2.2xi4gfi2fox2z.3",".3x5idcab12dugx5.3xui6nx4.4",".5x4f2ab2a7bcux5.7xi2f2i2nx3.5",".6x23.7x10.6",".9x16.12x7.8"],"z":1.1},"colWhite":{"w":32,"p":{"a":"#fcf4f4","b":"#fcf4ec","c":"#fcf4e4","d":"#fcecec","e":"#fcece4","f":"#08ecfc","g":"#b494ea","h":"#bc8ce4","i":"#b48cec","j":"#b48ce4","k":"#30d6fc","l":"#ac8cec","m":"#ac8ce4","n":"#7059ce","o":"#963bc3","p":"#fa2cbb","q":"#514cc3","r":"#241c88","s":"#24148c","t":"#241484","u":"#24147c","v":"#171c8a","w":"#1c1484","x":"#141484","y":"#1b147b","z":"#1c0c7c"},"r":[".5t21.6",".4qtu2t2u7t2utu5pu.4",".3xkb21p2.4",".3xkbmgi2bg2ig4imlgig2ips.4",".3xwn20ots.4",".3fwb5n2b12e2sy.4",".2vfb18ce4py.3",".xfb5gr3tr8stb2d2e2y.2","xfb2qn2b2r3tr7tsbeq3e2pw2","xfb2nb2qbgub2qbcmnbmrneoe2odepw2","xfb2nb3nmub2qb2n2bmrn2qe2qe2pw2","xfb2enb2n2ubcqnbn2bn5bnoe2pw.",".vfb5ytn10qwyaeb3py.2",".2f2b3vnlb11mrzb3py.3",".3xw2vn17wt2w.4",".6v2n2b4n3bnbdn3t.7",".7vf2b10ep2u.8",".7vfb2gb3gb3le2pt.8",".7wfbgjb2j2b3mjepu.8",".7wfbj2b2j2gb2mjept.8",".7wfbjgb2j2b3mjept.8",".7wfbj2b2j2b3miept.8",".7wfbj2b2j2b3m2ept.8",".7wfbj2b2j2b3m2ept.8",".7wfbj2b2j2gb2mjept.8",".7tfbj2b2j2b3miept.8",".7wfb2jb2j2b3miept.8",".7wfbj2b2j2b3mjept.8",".7rfbj2b2j2b3i2ept.8",".7wfbj2b2j2b3i2ept.8",".7wfbj2b2j2b3i2ept.8",".7wfbmjb2j2gb2i2ept.8",".7vfbmjb2j2b3i2ept.8",".7wfbj2b2j2b3igept.8",".7wfbj2b2j2b3i2ept.8",".7wfbj2b2jib3i2epy.8",".7wfbj2b3jb3i2ept.8",".7wfbj2b2j2mb2i2ept.8",".7wfbj2b2j2mb2i2ept.8",".7wfbigb2j2mb2miept.8",".7wfbijb3jb3igept.8",".7wfbj2b2j2b3i2epu.8",".7wfb2jb2j2b3i2ept.8",".7wfb2jb2j2b3ijept.8",".7wfbj2b2j2gb2i2ept.8",".7wfbj2b2j2gb2j2ept.8",".7wfbj2b2j3b2j2ept.8",".7wfbj2b2mj2b2m2ept.8",".7wfbj2b2j3b2m2epu.8",".7wfbj2b2j3b2miept.8",".7wfbj2b2m2b3j2ept.8",".7wfb2jb2mjb3m2ept.8",".7wfbj2b2m2b3mjept.8",".7wfbj2b2m2b3jiept.8",".7wfbj2b2j3b2i2ept.8",".7wfb2mb2j2b3i2ept.8",".7yfb2mb2j2gb2j2ept.8",".7wfbj2b2j2b3m2ept.8",".7tfb2jb2m2jb2m2ept.8",".7tfbj2b2j2b3lmept.8",".7wfbj2b2j2mb2igept.8",".7wfbj2b2jib3i2ept.8",".7wfb2jb2jib3i2ept.8",".7wfbj2b2j2b3i2ept.8",".7wfb2jb2jmb3i2ept.8",".7wfbmjb3m2b2igept.8",".7yfb11e2py.8",".6vf3b10e2p2v.7",".6vfkig5i2gig2jp2y.7",".7xkgjig2ij2i4p2t.8",".6xfb15p2u.6",".5vb18ept.5",".4x2k2gi4mi4g6p2t.5",".4xvb3jbj2mbj3b5p3y.5",".3vfb19ebp2.4",".3vfkim2l2m2lm5l2m2h2p2s2.3",".3xfklm2l4ml2m3l3mj2p2w.4",".3xvkstwy2t5y4t4jspt.4"],"z":1.85},"kingStatue":{"w":35,"p":{"a":"#fcfce4","b":"#fcfcdc","c":"#fcf4e4","d":"#fcf4dc","e":"#fcf4d4","f":"#e4f7e7","g":"#44ecfc","h":"#34e4fc","i":"#2ce4fc","j":"#2cdcfc","k":"#24e4fc","l":"#24dcfc","m":"#1cdcfc","n":"#fc5ccc","o":"#fc54d4","p":"#fc54cc","q":"#fc4cd4","r":"#fc4ccc","s":"#fc4cc4","t":"#1c249c","u":"#1c2494","v":"#14249c","w":"#142494","x":"#14248c","y":"#141c94","z":"#141c8c","A":"#0c1c8c"},"r":[".16yz3.15",".15z6.14",".15jb3qp.14",".14yib2dp2z.13",".14yjb3p2y.13",".12y3lb3r2z2y.11",".11wid8abryz.9",".11wid8b2rzy.9",".11wib3d4b3ry2.9",".11wkbdbd3b2dbpyz.9",".12w4cbdp2z3.11",".15wcb2r2z.13",".15wdbdrpz.13",".15ycdbryz.13",".12w5y2z5.11",".11wkb10pz.10",".10w2kb2db5a2rz2.9",".8w2ylywyw5y2zwry2z.7",".8zy2mywy9zr2z2y.6",".6w2kdbd10bd2b2arz2.5",".5wycdbd13b5qzy.4",".5ykid14bdb4rAz.4",".5wkibd16b2ar2z.4",".5wk2d4bd11b2aqroz.4",".6wyid5bd2bd6b2arz2.5",".6y2ibd14bp2oz2.5",".7yiabd13bp2oz.6",".8y2bd7bd5bpz2.7",".8ywkbd9b3drz2.7",".8w2lad10apr2z2.7",".10wibd7b3pz2.9",".10whab2d6bdp2z.9",".10w11z5.9",".10w9y2z5.9",".8w2idb2db2d5b2daz.8",".8w2kbd5bd4b3rz.8",".8w2ibd2b10prz.8",".7wvly3w5ywy4zypz2.6",".7whly7wy5z2ypnz.6",".5w2ldbdbd11b2dbp2z2.4",".5w2kab2d13b2p3z2.4",".7ym2b16rpz.6",".8w4y3wyw5zyzy2z2.6",".10wyw10zyzy.9",".10w2kd10pz2.9",".10wzkbd7bp2z2.9",".12tcd6brpy.11",".12ywd5b2prz.11",".12ycd4b3rz2.11",".12wcd5bdr2z.11",".12w2d3bd2br2z.11",".12ywd6br3.11",".10w2id6b2d2rz2.9",".10wyid6b4rz2.9",".10w2id6bdb2rz2.9",".10wyid8bdrz2.9",".10wyid8b2rz2.9",".10y2id9brz2.9",".10yzcd10prz.9",".9wkbd9b2r3z.8",".9wkbd9bdbr2z.8",".9wkbd9b2dr2z.8",".9wid10b3r2z.8",".9wibd10b2r2z.8",".9wid12br2z.8",".7wvid13boprz2.6",".7w2id2bd11bapz2.6",".7w2id13b3rz2.6",".7w2id14b2rz2.6",".7w2id13b2drz2.6",".6whdb2dbdbd7b4r2qz.5",".5w2ib6d8b4aq2z.5",".5wvwgb5d7b5p2z2.5",".4w2lawyw3b3db5dz5drz2.3",".4wkiac2d2cywu4w3zdz3edpyz.3",".4w2libd2bdy2w5y2wd3borpwz.3",".5w2ihb3d14apoz.5",".5v2ha3d2bd2b2d6bcdpyzy.4",".4wkiw2y2bdbdb4d5ayz2ypz2.3",".2y2jd2b4d4bdb2d4b2d3b2poy2.",".2y2hd5bd5b3d10b2oz2.","w2kbd3b3d19b3r2z","w2kd4b4d17b3ar2z","w3ihbd2bdbd10bdb8rwzy",".2wyw4b8d4b8azsyz2.",".ywyw4aw2aw2a2d4ydyayza2xz6","y2fbdb2dzwu2wz2x6z7wr5z","w2b2d3b6d14b3r4z","ywab5d4bd7b2d4b4r4z","wyac3bdb8d3b2db2d2b2ar5z",".2w4b23sz3y.",".6w19zwz3.5"],"z":1.6},"knightStatue":{"w":56,"p":{"a":"#fcfce9","b":"#fcf4ec","c":"#fcf4e4","d":"#fcb6ec","e":"#e0dbf5","f":"#cca4fc","g":"#c4a4fc","h":"#60ecfb","i":"#32f1fa","j":"#f99ced","k":"#c49cfc","l":"#f958df","m":"#fc44d4","n":"#ef3cdc","o":"#8c41fc","p":"#783ff7","q":"#fa1bfc","r":"#5c25cd","s":"#290c93","t":"#040c7c","u":"#040c74","v":"#b60460","w":"#1c047c","x":"#1c0474","y":"#14047c","z":"#140474","A":"#0a0476"},"r":[".21Ay3.31",".20A2z3.31",".20A2z3.31",".18t2ihb3zy.29",".18tuihab2z2.29",".18tuihea2m2z2.27",".18t2ihgfam2z3.26",".18t2ihpga3yzw.26",".18u2h2pfecam3z9.17",".18u2hep2ecbm2yz3wx3z2.17",".18u2e2p3cbd3z2o3m2v2x3.14",".18Ate2p3c2d3zwo3m2v2yx2.14",".16t2iha2p3c4awyo3pmv2m2w.14",".16t2iha2p3c3bcw2po4n2m3wx.12",".16t2h2a2c7bwxp5onm3w2.12",".16t2r2bc7ec3s5p2m3w2xz.10",".16t2r2c7bec3s5p2m3w2xz.10",".14t2ihac7bg3c3acp4o3m2v2z3.7",".14t2ihc6bcbg2fc3b2p4o3m2v2z3.7",".12t2ihc8be2c8a2pso2po2m2yz2.7",".11t3ihc6bcbe2c8bcs2o5m2zxz.7",".11t3h2c2ayb4c11bas2opopom3xz.7",".11tuth2cbzy6c14s3p2m3xz.7",".11t2uh2acy7c13bs3opm3x2.7",".9t3i2c2by2aby2c7g2c6bs3o3m4z2.5",".9t3ihc3y2aby2c7kgc6bs3po2m4x2.5",".9t3h2c3y6c7kg3c5d3w2onm3xz.5",".7t2i2ac4by6c7g5c4d3w2p2m3xz.5",".7t2ihac15bc2g5c7w2po2m2zx.5",".7tuh2c15bagkg5c6bw2o3m2xz.5",".5utihac10bc5bcg7c6bxwo3m4x2.3",".5t2h2c16bcag7c6bzwo2m5x3.2",".3tuh2ac17g5r2g3c6bzwpo2m4x2w.2",".3t2h2c13bcbkg6r2g3c6bzwo5m2x3.2",".t3ibhc11ag4k2g4r3kg2c7xzo2p2om2x2w.2","t3ihac12g10r4g3c6bj2w2p2om2x3.2","t3ihabc6bc4g10r4kgc7bj2zwp2om2x3.2","t3iht2c6bg11yw2r2gkbc7b2j2zwp3m5wz","t3ihtuc6bg11yw2r2g2c9j3w2p2om5x2","t3ihcbc3bfg4y8zr3ok2gc9j3w2p3o2m3x2","t3h2c4bcfg4zy8r3k2fgc9j3zwop2o2m3x2","tu2h2c3bg5yz.7y2o3gkc9kgkj2zwop2o2m3x2","tu2ihab3g2f2gy2.7Ayo3g2c9gk2j2zwp3o2m3x2",".3t2h2fg4zy.9Aykg4c9k3j2zwp2o3m3zx",".3t2h2g4zy2.9A2g5c8bk3j2zxopoq2xwx3",".5uA6.9tu2Ag3c9bgk3j2zxp3q2wx2.2",".5uA6.8t3h2g3c9k5j2zxp2oq2wxw.2",".20t2uh2g2c9bk5j2zxo3q2w3.2",".18t2ih3gc11ak5j2zwon2q2wxw.2",".18uth4gc11bk5j2w2o2nq2w3.2",".16t2i2h3c12k7j2wpon2q2wxw.2",".16t2ih3bc11bk4f3xwp2oqnq2wxw.2",".14t2i3h2bc10b2ck4j2wzypo2q2z2.5",".14tui2h2c11bkg2k2g2j3zwpoq3z2.5",".14tuih3c12gk2g4j3w2poq3z2.5",".14t2ihc12bak3g3fj3w2poq3zx.5",".11tuti2h2c12k5g2j5w2poq3x2.5",".11t3i2h2c12gk3g3j5xwo3q2zx.5",".11t3i2c14k3g4j5zwq3z2.7",".11t3i2c14k2g5j5zxq3zw.7",".11t3i2c11bk3g6j2zwz3x3.9",".11t3i2c12k2g7j2wz4x2w.9",".12t2i2bc10bk2g7j2w2z.14",".14t2i2c9bkg7fj2wx2.14",".14t2i2c8b2g2kg5j3zx2.14",".16A2z9yz13x.14",".16A2z8y2z13x.14",".14utb8c3b4c2b4q5z2.12",".14A2b2c17b2q5z2.12",".13uA2b2c17b2q5wz.12",".11ut2i2a2cb2cbc8bcb4l2q5z2.10",".11tuti2k3g4kg2kgk2gkg7l3q2z2.10",".11u2ti2k4g7kg3k2g6l3q2z2.10",".11t3i2k5g6k2g10l3q2zx.10",".14t2i2r24zw.12",".14t2i2r24z2.12",".14t2ihbc4beg6k2g4q5z2.12",".14utihbc3b2ekg11q5x2.12",".11t3ihcbc4bc2aca7g5q5x2.10",".11Auth2c18bg4q5x2z.9",".11Atbhc20g3bq6xz2.8",".9t2i2cbc22b2djdq5z2.7",".9t2ihc5ba2ca2c7bc3a2b2jd2q5z2.7",".9t2i2g31q3z2.7",".9t2ihg31q3z2.7",".9u2i2g31q3z2.7",".9uAt2Ay15wy4wzwyz2w2zxzwz3.7",".9t2A3y13z2y2zy2z15.7",".11A4y12z3yz2yz4y2z7.9"],"z":1.6},"macDraft":{"w":46,"p":{"a":"#ecdccc","b":"#ecdcc4","c":"#bca4e4","d":"#bc9ce4","e":"#bc9cdc","f":"#04f4fc","g":"#b494e4","h":"#b494dc","i":"#3c2c84","j":"#2c246c","k":"#2c1c6c","l":"#241c64","m":"#241c54","n":"#241c4c","o":"#1c1c54","p":"#1c1c4c","q":"#1c1454","r":"#1c144c","s":"#1c1444"},"r":[".5o2mom6omo3momo4m2o5mo3po.6",".5o2m17o2m5o2m4o3r.5",".2pomb36p3.2",".2m2b37m2r.2","p2b41rp2","mpb41rp2","mnb4d33b4rp2","npb4d33b4rp2","n2b3d3p29d4b2rp2","mnb3d2np26r2p3d2b2rp2","mpb3dpnp7rprp4r2p10r2p2nd2b2r2p","mnb3dpnp14r3p3rp9nd2b2rp2","n2b3dpnp2r2p12rp13nd2b2rp2","mnb3dpnp2r3p2rp8rp3r2p8nd2b2rp2","m2b3drp3r2pr3p8r3pr2p2rp5nd2b2rp2","m2b3dp5r3p3rprprp2r3nrp2rp7d2b2rp2","mpb3dp8rpndr3pr4nd2rp8nd2b3p2","m2b3dpnp9dpr7pd2rp9d2b2rp2","mnb3dpnp9d2r7phdp10d2b2rpm","mnb3dpnp7rpdprp2dr3pdp10nd2b2p2m","m2b3dp3np4r2p5ndr4p12d2b2p3","m2b3dpn2p8r3pndr5p10nd2b2p2n","mpb2adpn2p2r2p4r3pndsr4p10nd2b3pm","mnb3dn3p8r2prpdr4p12d2b2p2n","mnb2adp6r3pnhprp3r2pnhrp10d2b3pm","mnb2d2rp7rp2h2npr4pngrp8n2d2b2rpm","mnb3drp8rp2sdrn3rd2p10n2dcb3pm","m2b3drp12nd5prp3np2np4nd2b3pm","mnb3dp11rp2d5prp11nd2b2rpm","mnb3dp10np8r2p2np3n2p3nd2b3pm","npb3dp15r3pr2p4rp6nd2b3pm","mpb3dn2p2np8rp2rpr3p10n2d2b3p2","n2b3d3np4n2p6rp3rp6np4d4b2p2n","npb3d3n2pn6pnp4n2p2n2pn5rnd4b2p3","mnb4d33b4p3","mnb5d32b4p2m","m2b41p3","m2b41p3","m2b41p2m","m2b41p2m","m2b41m3","mpb18rm8o2m2o2momo2mb2om2","mpb18m2d14ijlmob3m2","mnb18m2d14ikl2ob3p2","m2b3romb12nmrpmom8or3mb4p2m","m2b3f2qb35rpm","m2b3f3b35p2o","m2b3r2pb35rpm","mnb41p2m","mpb42pm","m2b41omo",".morcd8ed28om.2",".2omd38om.2",".2omb38om.2",".2opb38m2.2",".2pmb38mo.2",".3o2b35m2.4",".4rp3op2o3m2p4mo2p5m2p2m4o4r.5",".4p7o2p19mp4rp2r.5"],"z":1.0},"clock":{"w":45,"p":{"a":"#acfcfc","b":"#b4f4fc","c":"#acf4fc","d":"#fc94dc","e":"#fc8cdc","f":"#1cdcf4","g":"#14dcf4","h":"#14d4f4","i":"#fc84dc","j":"#5c24b4","k":"#5c24ac","l":"#5424ac","m":"#5424a4","n":"#fc14a4","o":"#f414a4","p":"#541ca8","q":"#3c0c7c","r":"#340c7c","s":"#340c74","t":"#340c6c","u":"#1c0c44","v":"#1c0c3c","w":"#140c3c","x":"#1c0444","y":"#1c043c","z":"#14043c","A":"#140434"},"r":[".9g6.15on5.9",".8hg2fg3.15n6.9",".8r2q2r2q.14s3nqn2q.8",".8rq7.13ts2q5.8",".z2y5z2yz4yz3y2z4yz17.2","z6yz38","z14y2z29","z6y2kl6myz11ymplkml3Az7","z5ymkc3zbc2k2z10xp2e3ze2dljyz5","z4ylkc10lyz8le10k2yz4","z4ljc12l2z5lke6ze5klz4","z4lc10vbc2kz5ke7ze6lz4","z3jc10wc4jz4lje7yie5l2z3","z3kc9Auc4lkz3le8ze7lz3","z2ykc8v2c5akz3ke8ze7lz3","z2ylvc6yvc5yljz3lAye5yze6zlz3","z3lc6uywc6p2yz2l2e6y3e6lz3","z3lc5vc9plz3le10ye5lz3","z3lc4zc10pmz3le11ye4lyz2","z4kc14kyz4ke14lz4","z4kc13lmz5kle13lz4","z5kc11l2z7lme11lz5","z5mlbc3vc4mlz9ple4ze3dl2yz4","z7lkck3ckl2z10ymlk7lzyz5","z8k5l2my2z12k7z8","z6y2z9yzy3z23",".z18yzy2z17y2z2.",".2z3.35z3.2"],"z":1.0},"floppy":{"w":46,"p":{"a":"#fcf4d4","b":"#fcecd4","c":"#fceccc","d":"#b4acbc","e":"#b4a4c4","f":"#b4a4bc","g":"#aca4bc","h":"#14d4f4","i":"#0cd4f4","j":"#0cd4ec","k":"#04d4f4","l":"#04d4ec","m":"#bc84fc","n":"#bc7cfc","o":"#bc7cf4","p":"#1c0c3c","q":"#1c0c34","r":"#1c0434"},"r":[".5q5p2g21fq7.5",".5q7g4fg9fg5fgq7.5",".3q9g4fg8fqpq3gfeq9.3",".2q10g14pq4g2fq10.2",".2q10g14q5gfgq10.2","q12g14q5g2fq12","q12g14q5g2fq12","q12g13fq5g2fq12","q12g14q5g3q12","q12g14q5g3q12","q12g4f2g6fgq5g3q12","q12g3f3g6f2qpq3g3q12","q13pf6g6dg2f2gpq13","q14gf3gf2g4fgf3gfpq8p2q3","q14pq4p6q7pq8pqpq2","q19pq15pq5p2q3","q7pq10pqp2q2pq3pq2p5q2pq6p","q6pa32q7","q6a33bq6","q5pa34q6","q6a14ji4ba14q6","q6a13jki5laba11q6","q6a13j2i4j2a13q6","q6a13j2i4jia13q6","q6a13ji7a13q6","q6a13i2jiji3a2ba10q6","q6ba12bj2ij2la14q6","q6a13bcbc4aba12q6","q6a13jij6aba11q6","q6a12bj5ijhaba11q6","q6a13bljij2ia14q6","q6a14j2ij2ia14q5p","q6ba12bj2i4a10ba3q6","q6ba12i8a2ba10rq5","q6a13ji5j2iab2a9q6","q6a12ji8jab2a9q6","q6a10j2i10j2b2a8q6","q6b2a7biji10jicb2a7q6","q6a9biji10jiaba8q6","q6a10ij12iaba8q6","q6a11bab7a2b3a4ba4q6","q5pa15bababa5ba7bpq5","q7a31bpq6","q2p2q2p26ap6q2p3q2","qpmompq2p22q5pqpq2po2nqp","q2nm2pq3p21q3pq2pq3po2npq","q2p3q6p9qp15q6p2qp",".pqpq6p9q2p9qp9q4.2",".2q7pq3p8qp2q2p4qp6qpq5.2"],"z":1.0},"crown":{"w":74,"p":{"a":"#fcf4e5","b":"#fcf4dc","c":"#fcf4d4","d":"#fcecd6","e":"#69e4f1","f":"#04d4f9","g":"#04ccf4","h":"#a197e0","i":"#d184dc","j":"#c484dc","k":"#c484d4","l":"#bc84dc","m":"#bc84d4","n":"#2a84d0","o":"#c779d4","p":"#fc40ad","q":"#8c5bc1","r":"#6c3c9e","s":"#643c9c","t":"#981d94","u":"#194ea1","v":"#271272","w":"#38046e","x":"#24046c","y":"#240464","z":"#24045c","A":"#1b0461"},"r":[".39y6.29",".36u2db2p5t.27",".33u2hb9p3t2.24",".32gfb11dbp2t2.23",".32gb15p2t.23",".31gb17p2t.22",".30gb6j3b10p2.22",".4v.25gb4j6lb8p2t.21",".3nup.6w.16gdb3j10b7p2t.20",".2nfap2.4ydp.15gb4j11b6p2t.20",".ngb3pt.2yb3p2.13gb3j12lb6pwt.19","ufb5zy2b5p.13gb2j14lb5p2t.19","ufcb5Ab5ipt.12gb2lj13lb5p2t.19",".uj3b8jipy.12ublj16b5p2t.18",".2vAljb6ljw.14ualqj15b6p2t.17",".3nyb8yt.10uvug3qbqhj13b7pty2.15",".2n2b10dw.4ax3ug5fb3p2sj12b6pxp2y.14",".nfb5jlb5dw.3b16is2lj10b8p2y.13",".fb5jyjmb4wx2.2Aab15pr2j10b7ir2jy4.9","ufb4jlwv2lb2sx2A.2Afgb15psj11b5j3bp5t.8",".nfb2ijw.2vl2bA3.3Agfb16isj9rb3mjb8p2y.7",".2ufi2y.4w2lAxA.2Afgab16ijsl3j2ljrb3kmb7irsy3z.5",".3uiw.7x2A.3ugfb18plrl2j2lsb3lb7dr2p5y.5",".4A.8A.5vb21iosl3sbdbjdb6xqad2b4pxy.3",".18xfb3lj4b14dijrsbcbjb6j2xsicb5p3.3",".18vgb2j2lj4lb13i2rdcbmb6ljb2xslb6apt.2",".18vfb2j11b11rb3lb6mldb2yxs2b4ip2t.2",".18vfb2j13b8rb3mb6mbdb5ymb3ljviw.2",".18vfb3l2j12b5rd2bjb6mb8xsbl2xyxjy.2",".19ufb2j17b2rb2j2b5mb9y2qly4jy.2",".19ugfb2j17rdb2jdb4mb8l2y7sjy.2",".20Afgdbj15lrb2lb5lb8jly7sljy.2",".21Agbdb2cj12rb2j2b4jb8m2y7srlA.3",".22vf2b8j7rb2lb5jb7l2y4sy3rl2y.3",".23gfgb2db7j3rb2j2db3lb7msy4s5mly.4",".24xf2gfl2jgeb5rb2ljb3j2b6lry4rs4rm2y.4",".26Ax2lohf4abab2kmb3j2b6ljAy2s2r3srlmy.5",".29y3xAf3gfb2j2b3j2b5l2y4r6mlx.6",".34A2f2xb2jb3j2b6l2y2s3r4m2y.7",".36A2uablb3j2b5m2y3s4r2l2y.8",".37Auoq2b3mb5l2y2zrs4rm3.9",".38Alqg2bm2b5jly2s5rm3y.9",".39Ag2far2b2y4xs6rm3y.10",".39Agf2arhlbAs2xys6ml2z.11",".40gf2guflb2zxs7m3z.12",".41Ag2uflb3y2s4m4A.13",".42Agufl2b3ys3m4A.8y3w.2",".43Aufl2b3xsm4Ay.4A.4vb3t.",".44Ag2mb3ysm2Ay.4x2pt.3Ahb2t.",".45Afgb4yxyA.4vb2p2.4uglpt",".46Afb3jsy.5vb4p2.4Ay2.",".47Ag2bm2A.4ub5p2t.7",".48A4y.4ub5j2pw.7",".56ugb4jljp.8",".56ug2lmAyA.10",".57uAy.14"],"z":1.0},"hand":{"w":62,"p":{"a":"#fcf4dc","b":"#fcecd4","c":"#fceccc","d":"#ececdc","e":"#d4c6d8","f":"#04ccfc","g":"#04c4fc","h":"#04b7fa","i":"#d759d8","j":"#bc55dc","k":"#9d59d9","l":"#e34acd","m":"#b44cdc","n":"#b44cd4","o":"#9348cf","p":"#fa31ae","q":"#f724a5","r":"#9735bc","s":"#4e28a1","t":"#3c1487","u":"#5c0c84","v":"#342793","w":"#34148c","x":"#341484","y":"#34147c","z":"#340c7c","A":"#2c127a"},"r":[".39f9.14",".37gf9gp.13",".36g3c2b2c2bc2bqcq.10",".35gfc5bc9pq3.6",".33g2fc12b2c4b2q2.4",".32gfc6bjbc2bcljlc4b2cbq.3",".31gc8btl5nxil3cb3lq.3",".30gbc7b2lyty3t.xsnj2i2rt.4",".28ghc9bly2.8tyxzyxr.4",".27g2c9b2lo.12hfbcq.3",".25g2c12li.12hfc4q.2",".24gbc10el2y.13wmbc2bq.2",".23gc8e2m2ijs.14xtjc2p.3",".22gc12nx2wg4p.10zAspy.3",".22gc12x2snhg2b2p.8xkb2cbq.2",".22gc8b3l2xmic6p.8y3rz.3",".21gnbcjc4bnc2lxtmc7q.8xoc2q.3",".21gcbj2c5brlnt2c8p.8tgc2q.3",".21gc2mbc4bctortrmj3sc2bcq.6xkbc2bp.2",".20gbc2mc6bcyx2vokmsnbc2bp.6hacb4.2",".19gfc8b2cbx7knc3bp.5xysomlp2q.",".19fbc8b2c2bx4v2xsb2cbp.5xfb3c3q.",".18g2c8b2jbcbx3m4wb2cbp2.3x2ybxbyxcq2",".18gbc8b3cb3xtsm3wb2cbp2.3g2x2abxq2r.",".18gc10b2lc2bx2snm2yc2bl2.2g4b5q2.2",".17g2c9bcbclbcbx3ytbc2l2wfgbc4bc2b2pq.",".17g2c8b2c3il3x4tb2i2tgfc5lb5cq.",".17gbc12ec2brx3tvbj2fgc7jb4clq.",".17kc14jc2b2x3sf3c7b2tnl4p.2",".16hnc7b2c4bc3b2df2dc7lbc2l2xy4.3",".16hc19bc10mcibl2ty.7",".15hnc27bc2snml2t.9",".15hnc25b2c2l2yity.10",".14hoc10bc12b3j2l3yxy.12",".14hmc9bc12bcem3yx2.15",".13hoc21m2j2l2my.18",".13hc21m3iply2.19",".13hc3b2c3b2c8bcjs2mlpy2.20",".12hoc7bcb2c5b2cm2s3y2.22",".12obc7b4cb4cj3mp3.24",".11vnbcbc4b2jmb5cj4p2y.25",".7sv2woc8bm8jm2p3z.26",".6gcvxsmc7b3msm5jp2zt.28",".4g2cx3rbc8b2mryx3y5.29",".3g2c2x2vnc10bm2rx4.33",".2hcbc2x2ncb2c8b2m2otx2.33",".2vc3b2t2sc10bcm3t2.34",".2x2b2cb2t2bpqc8bm3x.35",".3x2jbcbcbtcpc7bcm3y.35",".3wym2b5c2qc6bm3t.36",".2xm2jmb2ilb2ecbc5bm3t.36",".2xm3b4jb3zb2c4bm2st.36",".2x2sjb4c2b3f3bc2m3t.37",".3x3obc6bcbgficm2ot.37",".3txvstmc8b3fm2sxtr.35",".3t2sm2yxbc7b2dcfgyxlq.34",".3ts2m2yzoibcbc4b3g2kzlqp.33",".3t2b3vsm2ojebc5b5c2q.33",".3t2ob2s2b3x2jc6b4ecq.33",".3wm2b2o2b3wsj3b3cb2jtlq.34",".3w2mb2m2c2bs2cb2xtjbcbjt2.35",".2xsm2b2m2c2bo2bcbs2j3brt.36",".2xs2mcbm2c2bm2c3src2x2tq.36",".vo2sjcbm2c2bm2c3ojcbt2rq.36","vob3jb2m2c2bm2c2bmjb2srq.37","v2b2c2b2omc2bm2b3jmb2mpq.37","xvjb2jb3mc2bm2cb2j2cbjp.38","y3m3b3cbcbm2b2cj2b2jp.38",".y3m2jicb2efgmb3j2b2jp.38",".2y2xmjib6kb3j2cbmt.38",".3y2xjb3c2b3cb2j2bctbq.37",".4yxjb6x2bcb4otcq2.36",".5y2ab5xyvcb3sbcbq2.36",".6y2ebybryxtsb2txb2lq2.36",".7A2y5rc2xex2bilt.37",".14z2uzAyxisx.38",".20yzy.39"],"z":1.3},"arch":{"w":65,"p":{"a":"#fcf4e4","b":"#fcf4dc","c":"#fcece4","d":"#fcecdc","e":"#fcecd4","f":"#fcb4cc","g":"#eac6ce","h":"#cb9ee4","i":"#cc94dc","j":"#c494ec","k":"#c494e4","l":"#3edaf6","m":"#bd8be8","n":"#b484e4","o":"#ac76e4","p":"#9355e3","q":"#5d42cf","r":"#672cc9","s":"#5c24bc","t":"#fa04a5","u":"#9f0ca1","v":"#33087e","w":"#19117e","x":"#240475","y":"#24046c","z":"#1c0474","A":"#230464"},"r":[".28s9.28",".25s4b4xd2as3.25",".22s4ns2d2bevd3smis3.22",".20svs2d3sd2b2xd4sbdb2svs.20",".19psd6rd3xd5sb3dbd2sv.18",".16ws2d7brdb2d6sd6bd2uv.16",".15wobd6b3r2byd6sb2d7bov.15",".14wd6b4hpr2he2d4hsphb2d8t.14",".13wd6b3mp2mrj2h7sjp2hb3d6tv.12",".11wld8kp2m3r2no6vrpj3p2d8tA.11",".11ld8p2m3rpxy10xpjm2p3bd6fu.10",".10qed6p2m3pxy2.12y2rm3p2d4badt.10",".9levdb3dp2m3y2.17xyrkmp2d2bxd3t.9",".8l2dbxb3pm2jry.21y2jmjpdyd5t.8",".8ld4xep2jmyx.23xypj2pxd5t2.7",".7l2d3bd2m2nrx.25yvj2xpd6t.7",".7lbd3baAjmry.27Arj2p2d5t2.6",".6l2d3b2pm2Ayx.28y2m2pd6t.6",".6lbd2b2hpnpx.31xrmnhd5t2.5",".5l2bd2bdpmnrx.31yrnmpd4b2t.5",".5ld3b2mpm2x2.32xrmpkd3b2t2.4",".5ld3b2m3rx.33xrmond3b2t.5",".5ld3b2pm2rx.33xrjmpgd2bdt2.4",".4lcd2b2kpmrx.35xrmohd5t.4",".4lcb5pmrx.35vrmphd5t.4",".2lwv10xv3.30vx2v11tu.",".qd2bd8e4uv.28ved2e3d4ed4t.",".l2dh10k2dv.29xedk2h10et.",".2qs2r11v.31xvr11sv.2",".l2edb6d3b2au.29uded7b3d2t2.",".ldbs3p6s2dbdu.28tedsrprp5srdet.","lb2rab2pm3psbdrdbdA.26rd2sbdsrm2npsbdredt","lbdabcbsp2rpdbdardaA.26rdsdbd2vprpvbdadsdt","lbdedrbsv4d2rard2v.26rdsdsd2v5dbsardt","l2d2sebwr3v2bdsdbr.27rads2bdvr3vb2srd2t",".l2d3sodkbdpsd3v.29xd4pdk2dprad2at.",".2lwqw2ndb2dmpx3.31vx3mk2dkm2yt3.2",".5q2sr3s3rx.33xs3r6v2.4",".5lqpj4p2rx.33xrp2j3hp2t2.4",".5lh2dbd2jkoy.33xpjhd3b2gt2.4",".5lcpdpbdrgpy.33xpgrdbrb2pt2.4",".5lcpbd2bogpy.33yogodbrbd2t2.4",".5lcjbjb2ogmy.33ymgnbdjdm2bt.4",".5lcjbjb2ogmy.33ymgob2jbmdt2.4",".5lcjbjd2ogny.33ymgod2kb2dt2.4",".5lcjbj2dogny.33yngnd2kb2d2t.4",".5lckdjbdogny.33yngnb2kbkdt2.4",".5lcjdjbdngmy.33yngnb2kb2kt2.4",".5lcjb3dngmy.33yngnd2kbjdt2.4",".5lcjdjbdngmy.33yngnd2jdbjt2.4",".5lcjbjbdogmy.33yngnb2kb2dt2.4",".5lkjbjbdogmy.33yngnd2kb2kt2.4",".5lwkbj2dogny.33yngnbdkb2mt2.4",".5lcwbj2dogny.33yngnbdkbdzt2.4",".5lcmvjbdogny.33yngnb2kdxe2t.4",".5lcjdxd2ngny.33yngob2jbk2t2.4",".5lcjdbvdngmy.33yngob2jymdt2.4",".5lcjb2vdngny.33yngob2md2jt2.4",".5lcjb2jangny.33yngoadkdj2t2.4",".5lcjbj2xngny.33yngoxdkbjdt2.4",".5lcjbjd2vgny.33yngodbkbkdt2.4",".5lcjbj2doxmy.33yngodbjbdkbt.4",".5lckbj2dogxy.33yngob2jbj2bt.4",".5lcjbj2dogny.33xygodbjbj2bt.4",".5lcjdj2dogny.33ynvob2jd2jt2.4",".5lcjbj2dogny.33yngvd2kbj2t2.4",".5lcjb2jbogmy.33xngyabkbj2bt.4",".5lcjbjbdognA.33xngoAakdbjbt.4",".5lzkdjbdogny.33xngodymb2jt2.4",".5lckbjb2ogny.33yngod2mb2dt2.4",".5lckbjb2ogny.33yngod2kdbjt2.4",".5lcjdjb2ogny.33yngodbjbj2dt.4",".5lcjbxbdogny.33yngob2jb2jt2.4",".5lcjbpbdogmy.33ymgob2jb2jt2.4",".5lcmbod2pgny.33yngpbdodn2bt.4",".5lcabmd2k2px.33xpkhd6t2.4",".4wl2sr4s2yx2.32xys8t2.4",".3qlad7khy2.31y2hksd7t2.3",".3qad8iorx.31xroihd8t.3",".3qh2rh3rh2porx2.30xrsok2h2r2h3tu.2",".2q2dr2d6asx2y2.28yxvjsd3r3drtdt.2",".qd9b3kp2rxy.26yrokjd2bd6b2dt.",".q2sr11s2vxy.26yvs2r12t2.",".lab4rdrbdb3eo3x.25yro2hd2b2rd3r2d2bt.","qb7dxedb2d2kprsx.24xsrpd2b5d2xed3bt","qmkj7kj6r2sx.23y2sr2kj8mj4kt","wmkj7mxj5rsxy.23y2sr2j7mpxj4ku","wy20.24y18Ax"],"z":2.6}};
  Object.keys(DRAFTS).forEach(function (k) { PIX[k] = DRAFTS[k]; });
  function rleArt(sp) {
    var cv = document.createElement('canvas'); cv.width = sp.w; cv.height = sp.r.length;
    var x = cv.getContext('2d');
    sp.r.forEach(function (row, y) {
      var re = /(.)(\d*)/g, m, c = 0;
      while ((m = re.exec(row)) && m[0]) { var n = m[2] ? +m[2] : 1; if (m[1] !== '.') { x.fillStyle = sp.p[m[1]]; x.fillRect(c, y, n, 1); } c += n; }
    });
    return cv;
  }
  var PROP_CACHE = {};
  function propArt(kind) {
    if (!PROP_CACHE[kind] && PIX[kind]) PROP_CACHE[kind] = pixArt(kind);
    return PROP_CACHE[kind];
  }
  // A prop standing in the world (o.ground: the y it stands on; o.s: scale; o.flip: mirrored).
  var COLUMN_KINDS = ['colPink', 'colMintIvy', 'colBlue', 'colLilacIvy', 'colPinkIvy', 'colBlueIvy', 'colMint', 'colLilac'];
  function decorPlane(g, kind, o) {
    if (kind === 'palm') kind = hash(((o && o.x) || 0) * 0.021 + ((o && o.z) || 0) * 0.011) > 0.5 ? 'palm' : 'palm2';
    if (kind === 'column') kind = COLUMN_KINDS[Math.floor(hash(((o && o.x) || 0) * 0.013 + ((o && o.z) || 0) * 0.007) * 8) % 8];
    var art = propArt(kind), cv = document.createElement('canvas'); cv.width = art.width; cv.height = art.height; cv.className = 'cx-decor';
    var x = cv.getContext('2d');
    if (o && o.flip) { x.translate(art.width, 0); x.scale(-1, 1); }
    x.drawImage(art, 0, 0);
    var z = (PIX[kind] && PIX[kind].z) || 1, W = art.width * 4 * z, H = art.height * 4 * z;
    if (o && o.ground != null) o.y = o.ground - (H / 2) * (o.s || 1);
    var it = plane(g, cv, W, H, o);
    it.canvas = cv; it.head = 0; it.art = cv; it.kind = kind;
    if (o && o.ground != null && o.shadow !== false && kind !== 'dolphin') it.shadow = castShadow(g, it, o.ground);
    return it;
  }
  // The shadow: the sprite's silhouette, flipped and laid flat behind the prop (towards +z, away from the sun), drawn
  // in a dither that thins out towards its tip.
  var SHADOW_LEN = 0.85;
  function castShadow(g, it, ground) {
    var src = it.canvas, w = src.width, h = src.height, K2 = 2, W2 = w * K2, H2 = h * K2;
    var cv = document.createElement('canvas'); cv.width = W2; cv.height = H2; cv.className = 'cx-shadow';
    var m = document.createElement('canvas'); m.width = W2; m.height = H2;
    var mx = m.getContext('2d'); mx.imageSmoothingEnabled = false;
    mx.translate(0, H2); mx.scale(1, -1); mx.drawImage(src, 0, 0, W2, H2);            // flipped: the prop's top lands at the far end
    mx.setTransform(1, 0, 0, 1, 0, 0); mx.globalCompositeOperation = 'source-in'; mx.fillStyle = '#0e0422'; mx.fillRect(0, 0, W2, H2);
    var x = cv.getContext('2d');
    x.filter = 'blur(' + (K2 * 1.4) + 'px)'; x.drawImage(m, 0, 0); x.filter = 'none';
    x.globalCompositeOperation = 'destination-in';
    var gr = x.createLinearGradient(0, 0, 0, H2); gr.addColorStop(0, 'rgba(0,0,0,0.82)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0.06)');
    x.fillStyle = gr; x.fillRect(0, 0, W2, H2);
    x.globalCompositeOperation = 'source-over';
    var rg = x.createRadialGradient(W2 / 2, 0, 0, W2 / 2, 0, W2 * 0.36);
    rg.addColorStop(0, 'rgba(14,4,34,0.7)'); rg.addColorStop(1, 'rgba(14,4,34,0)');
    x.save(); x.scale(1, 0.5); x.fillStyle = rg; x.fillRect(0, 0, W2, W2 * 0.72); x.restore();
    var L = it.h * it.s * SHADOW_LEN, sh = plane(g, cv, it.w, it.h * SHADOW_LEN, { x: it.x, y: ground - 3, z: it.z + L / 2, rx: 90, s: it.s, op: it.op, cull: it.cull });
    sh.h0 = it.h; sh.scaleY = SHADOW_LEN;
    sh.el.style.transformOrigin = '50% 50%';
    sh.ground = ground; sh.caster = it; sh.len = L; sh.halfW = it.w * it.s * 0.22;
    return sh;
  }
  // keep each shadow under its prop (props bob, bounce and fade): position, length, fade
  function syncShadows(list) {
    (list || []).forEach(function (it) {
      var sh = it.shadow; if (!sh) return;
      var lift = sh.ground - (it.y + it.h * it.s / 2);       // how far the prop is off the floor
      sh.x = it.x; sh.z = it.z + sh.len / 2 + lift * 0.4;
      sh.s = it.s * (1 - Math.min(0.5, lift / 900));
      sh.op = (it.op == null ? 1 : it.op) * (1 - Math.min(0.8, lift / 700));
    });
  }
  // a prop standing in another prop's shadow is darkened from its foot up to the height the shadow reaches there
  function receiveShadows(list) {
    list.forEach(function (it) {
      if (!it.art || !it.shadow) return;
      var best = 0;
      list.forEach(function (o) {
        if (o === it || !o.shadow) return;
        var dz = it.z - o.z, dx = Math.abs(it.x - o.x);
        if (dz <= 0 || dz > o.shadow.len || dx > o.shadow.halfW + it.w * it.s * 0.25) return;
        var reach = o.h * o.s * (1 - dz / o.shadow.len);     // the height of the shadow where it falls on this prop
        best = Math.max(best, Math.min(1, reach / (it.h * it.s)));
      });
      if (best <= 0.02) return;
      var x = it.canvas.getContext('2d'), w = it.canvas.width, h = it.canvas.height, top = Math.round(h * (1 - best));
      x.save(); x.globalCompositeOperation = 'source-atop';
      for (var y = top; y < h; y++) { x.fillStyle = 'rgba(30,12,60,' + (y === top ? 0.2 : 0.42) + ')'; x.fillRect(0, y, w, 1); }
      x.restore();
    });
  }

  // A classic Mac alert as pixel art on a canvas (so it can shatter into pixel shards when the camera flies through
  // it): striped title bar, the warning sign, the message, an OK button.
  function macAlert(g, message, o) {
    var cv = document.createElement('canvas'); cv.width = 240; cv.height = 100; cv.className = 'cx-alert-art';
    var x = cv.getContext('2d');
    x.fillStyle = '#b967ff'; x.fillRect(6, 6, 234, 94);                       // the hard drop shadow
    x.fillStyle = '#fbf4f4'; x.fillRect(0, 0, 234, 94);
    x.fillStyle = '#251e31'; x.fillRect(0, 0, 234, 2); x.fillRect(0, 92, 234, 2); x.fillRect(0, 0, 2, 94); x.fillRect(232, 0, 2, 94);
    for (var y = 4; y < 16; y += 2) x.fillRect(4, y, 226, 1);                  // title bar stripes
    x.fillStyle = '#fbf4f4'; x.fillRect(96, 3, 42, 13);
    x.fillStyle = '#251e31'; x.fillRect(0, 17, 234, 2);
    x.font = 'bold 10px "JetBrains Mono", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Chess', 117, 10);
    // the warning sign, drawn in pixels
    for (var r = 0; r < 18; r++) { var half = Math.floor(r / 2); x.fillStyle = '#251e31'; x.fillRect(26 - half, 30 + r, half * 2 + 1, 1); }
    x.fillStyle = '#ffd640'; for (r = 3; r < 16; r++) { half = Math.floor(r / 2) - 1; if (half > 0) x.fillRect(26 - half, 30 + r, half * 2 + 1, 1); }
    x.fillStyle = '#251e31'; x.fillRect(25, 36, 2, 6); x.fillRect(25, 44, 2, 2);
    x.font = 'bold 12px "JetBrains Mono", monospace'; x.textAlign = 'left';
    var words = message.split(' '), line = '', lines = [];
    words.forEach(function (w) { if (x.measureText(line + w).width > 180 && line) { lines.push(line.trim()); line = ''; } line += w + ' '; });
    lines.push(line.trim());
    lines.forEach(function (l, i) { x.fillText(l, 44, 34 + i * 14 - (lines.length - 1) * 4); });
    x.fillStyle = '#251e31'; x.fillRect(176, 72, 48, 16); x.fillStyle = '#fbf4f4'; x.fillRect(178, 74, 44, 12);
    x.fillStyle = '#251e31'; x.fillRect(180, 76, 40, 8); x.fillStyle = '#fbf4f4'; x.font = 'bold 9px "JetBrains Mono", monospace'; x.textAlign = 'center'; x.fillText('OK', 200, 80);
    var it = plane(g, cv, 720, 300, o);
    it.canvas = cv; it.head = 0;
    return it;
  }

  // Fly-throughs: an alert in the camera's path pops in as the camera nears it, and bursts into pixel shards (with a
  // flash, a tape tear and a colour split) the moment the camera goes through it.
  function flyAlert(it, t, show) {
    if (!show || it.broken) { if (!it.broken) it.op = 0; return; }
    var cd = camDepth(it.x, it.y, it.z), near = clamp01((2600 - cd.d) / 900);
    it.ry = -Cine.cam.yaw;
    it.op = near;
    it.s = it.baseS * (1 + 0.25 * (1 - near));                              // a little pop as it arrives
    if (cd.d < 110 && cd.d > -400) breakAlert(it);
  }
  function breakAlert(it, push) {
    if (it.broken) return;
    it.broken = true;
    var c = Cine.cam, ya = c.yaw * D2R, fwd = push || { x: Math.sin(ya) * 900, y: -120, z: -Math.cos(ya) * 900 };
    shatterGlass(it, { x: it.x, y: it.y, z: it.z }, fwd);
    Cine.flash = Math.max(Cine.flash, 0.3); Cine.tear = Math.max(Cine.tear, 1.1); Cine.aberration = 1.2; Cine.shake = Math.max(Cine.shake, 0.4);
    Cine.fovKick = 10;
  }
  // The orb: a glowing pixel ball the camera chases down the check run, hopping from OK button to OK button and
  // smashing each Check. box just before the camera gets there.
  function orbPlane(g, o) {
    var cv = document.createElement('canvas'); cv.width = 24; cv.height = 24; cv.className = 'cx-holo';
    var x = cv.getContext('2d');
    for (var y = 0; y < 24; y++) for (var c = 0; c < 24; c++) {
      var d = Math.hypot(c - 11.5, y - 11.5), hl = Math.hypot(c - 9, y - 8.5);
      if (d > 11.5) continue;
      x.fillStyle = d > 10.2 ? 'rgba(94,240,255,0.55)' : d > 8.6 ? '#ff71ce' : hl < 3 ? '#ffffff' : d > 6 ? '#ff9ad8' : '#ffe0f2';
      x.fillRect(c, y, 1, 1);
    }
    var it = plane(g, cv, 72, 72, o); it.canvas = cv; return it;
  }
  function resetAlert(it) { it.broken = false; it.hidden = false; it.op = 0; }

  // The chess logo as a cut-out in the world (the ending): the same pink-and-cyan pixel lettering as the film's
  // logo, on a tight canvas so its letters' width is known (textFrac) and can be matched to the page title.
  function logoPlane(g, o) {
    var cv = document.createElement('canvas'); cv.width = 120; cv.height = 40; cv.className = 'cx-logo3d';
    var it = plane(g, cv, 1200, 400, o);
    function paint() {
      var x = cv.getContext('2d');
      x.clearRect(0, 0, 120, 40);
      x.font = '800 34px "JetBrains Mono", ui-monospace, monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
      it.textFrac = Math.min(1, (x.measureText('chess').width + 3) / 120);
      x.fillStyle = '#28e8ff'; x.fillText('chess', 58, 21);
      x.fillStyle = '#ff2fa6'; x.fillText('chess', 61, 20);
      var img = x.getImageData(0, 0, 120, 40), d = img.data;
      for (var i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0;
      x.putImageData(img, 0, 0);
    }
    paint();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(paint);
    return it;
  }

  function petals(w, n) {
    var p = projectP(w); if (!p) return;
    for (var i = 0; i < qn(n); i++) Cine.petals.push({ x: p.x, y: p.y, vx: rand(-180, 180), vy: rand(-170, 40), life: rand(.7, 1.6), age: 0, size: rand(4, 13) });
  }
  function drawChessPetals(dt) {
    if (!Cine.petals) return;
    var c = Cine.fxCtx;
    Cine.petals = Cine.petals.filter(function (p) {
      p.age += dt; if (p.age >= p.life) return false;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 160 * dt;
      c.fillStyle = 'rgba(255,113,206,' + (1 - p.age / p.life).toFixed(2) + ')';
      c.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size * .55);
      return true;
    });
  }

  // The F15 Gambit (named for this film: the f1 bishop's trap, mate on ply 15). A Légal-style miniature: 5.h3 Bh5 keeps
  // the pin, 6.Nxe5!? offers the queen, 6...Bxd1 takes her, and 7.Bxf7+ Ke7 8.Nd5# mates with bishop and both knights.
  var FILM_MOVES = [
    [13.2, 'e2e4'], [14.3, 'e7e5'], [15.4, 'g1f3'], [16.5, 'd7d6'],
    [17.6, 'f1c4'], [18.7, 'c8g4'], [19.8, 'b1c3'], [20.9, 'g7g6'],
    [22.6, 'h2h3'], [23.7, 'g4h5'], [25.4, 'f3e5'], [27, 'h5d1'], [30.5, 'c4f7'], [34, 'e8e7'], [39.1, 'c3d5']
  ];

  function makeShots() {
    var S = { done: {} }, me = (window.GameSocial && window.GameSocial.me && window.GameSocial.me()) || (G.Profile && G.Profile.get()) || { name: 'Player' };
    var frames = KIT.script(FILM_MOVES.map(function (m) { return m[1]; }));
    // a square's centre on the board plane (the frame's padding, label and border measured from chess-cinematic.css)
    function squareWorld(board, i) { var col = i % 8, row = (i / 8) | 0; return toWorld(board, 44 + (col + 0.5) * 93, 78 + (row + 0.5) * 93); }
    function moveFx(f) {
      if (!f || !f.move || !S.board.visible) return;
      var a = squareWorld(S.board, f.move.from), b = squareWorld(S.board, f.move.to);
      a.y -= 40; b.y -= 40;
      bolt(a, b, Cine.t - 0.02, 0.32);
      var p = projectP(b);
      if (p) { ring(p, 220 * Math.min(2, p.s)); burst(p.x, p.y, qn(28), [320, 190, 285], 0.6); petals(b, 14); }
      Cine.fovKick = -5; Cine.shake = Math.max(Cine.shake, 0.18); Cine.vhs = Math.max(Cine.vhs, 0.7);
    }
    function boardAt(t) {
      var n = 0;
      while (n < FILM_MOVES.length && t >= FILM_MOVES[n][0]) n++;
      var f = frames[n];
      if (S.boardFrame !== n) {
        KIT.setPosition(S.board.board, f.squares);
        if (f.move) KIT.highlight(S.board.board, f.move.from, f.move.to);
        if (f.check != null) KIT.check(S.board.board, f.check);
        if (S.boardFrame >= 0 && n === S.boardFrame + 1) { moveFx(f); slideStart(f, frames[n - 1], FILM_MOVES[n - 1][0]); } else S.slide = null;
        S.boardFrame = n;
      }
      return n;
    }
    function slideStart(f, prev, t0) {
      var b = S.board.board, from = b.children[f.move.from], to = b.children[f.move.to], g = to && to.querySelector('.piece');
      if (!g || !from) { S.slide = null; return; }
      var taken = prev.squares[f.move.to], ghost = null;
      if (taken && taken !== '.') {
        ghost = document.createElement('span');
        ghost.className = 'piece cx-taken ' + (taken === taken.toUpperCase() ? 'white-piece' : 'black-piece');
        ghost.textContent = KIT.glyph(taken) + '\uFE0E';
        to.insertBefore(ghost, g);
      }
      var mover = f.squares[f.move.to];
      S.slide = { el: g, ghost: ghost, dx: from.offsetLeft - to.offsetLeft, dy: from.offsetTop - to.offsetTop, t0: t0, knight: mover === 'n' || mover === 'N' };
      slideTick(Cine.t);
    }
    function slideTick(t) {
      var sl = S.slide; if (!sl) return;
      var q = clamp01((t - sl.t0) / 0.38), e = easeInOut(q), lift = Math.sin(q * Math.PI) * (sl.knight ? 46 : 16);
      sl.el.style.position = 'relative'; sl.el.style.zIndex = '5';
      sl.el.style.transform = q >= 1 ? '' : 'translate(' + (sl.dx * (1 - e)).toFixed(1) + 'px,' + (sl.dy * (1 - e) - lift).toFixed(1) + 'px) scale(' + (1 + 0.18 * Math.sin(q * Math.PI)).toFixed(3) + ')';
      if (sl.ghost) {
        var k = clamp01((q - 0.72) / 0.28);
        sl.ghost.style.opacity = (1 - k).toFixed(3);
        sl.ghost.style.transform = 'translate(' + (k * 60).toFixed(1) + 'px,' + (-k * 40).toFixed(1) + 'px) rotate(' + (k * 70).toFixed(1) + 'deg) scale(' + (1 + k * 0.4).toFixed(3) + ')';
      }
      if (q >= 1) { if (sl.ghost && sl.ghost.parentNode) sl.ghost.parentNode.removeChild(sl.ghost); sl.el.style.zIndex = ''; S.slide = null; }
    }
    // the orb's flight: in from ahead of the camera, a hop from OK button to OK button, then on down to the king
    function orbAt(t) {
      var H = S.orbHits;
      H.forEach(function (h) { if (!h.p) h.p = toWorld(h.it, 200 * 3, 80 * 3); });   // the OK button (canvas 200, 80; 3x)
      var pts = [{ t: 30.05, p: { x: 0, y: -380, z: 2350 } }].concat(H.map(function (h) { return { t: h.t, p: h.p }; }), [{ t: 37.95, p: { x: 0, y: -300, z: -620 } }]);
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1];
        if (t <= b.t || i === pts.length - 2) {
          var k = clamp01((t - a.t) / (b.t - a.t)), e = k * k * (3 - 2 * k) * 0.35 + k * 0.65;
          return { x: lerp(a.p.x, b.p.x, e), y: lerp(a.p.y, b.p.y, e) - Math.sin(k * Math.PI) * (i === 0 ? 60 : 170), z: lerp(a.p.z, b.p.z, e) };
        }
      }
      return pts[pts.length - 1].p;
    }
    function faceStatues() {
      slideTick(Cine.t);
      S.statues.forEach(function (it) { it.ry = -Cine.cam.yaw; });
      if (S.props) S.props.forEach(function (it) { it.ry = -Cine.cam.yaw; });
      syncShadows(S.props); syncShadows(S.statues); vhsBoard(S.board, Cine.t);
      holoTick(S.statues, Cine.t); holoTick(S.afterimages, Cine.t);
      leap(S.dolphins, Cine.t);
      bob(S.floaties, Cine.t);
    }
    // beach balls bounce (a squash at the bottom), rings and flamingos bob and rock
    function bob(list, t) {
      (list || []).forEach(function (it) {
        var F = it.float, ph = t * 1.6 + F.ph;
        if (F.kind === 'beachball') { var b = Math.abs(Math.sin(ph * 1.3)); it.y = F.y0 - b * 260 * it.s / 2.4; it.rz = Math.sin(ph) * 25; }
        else if (F.kind === 'flamingo') { it.y = F.y0; it.rz = Math.sin(ph * 0.5) * 2; }
        else { it.y = F.y0 - 20 - Math.sin(ph) * 30; it.rz = Math.sin(ph * 0.8) * 6; }
      });
    }
    // a dolphin plane and its leap: out of the floor, an arc, back in (period 3.4 s, its own phase)
    function dolphin(g, x0, ground, z, phase, dir) {
      var it = decorPlane(g, 'dolphin', { x: x0, y: ground - 100, z: z, s: 2.4, flip: dir < 0, op: 0, cull: false });
      it.leap = { x0: x0, ground: ground, phase: phase, dir: dir };
      return it;
    }
    function leap(list, t) {
      (list || []).forEach(function (it) {
        var L = it.leap, k = ((t + L.phase) % 3.4) / 3.4;
        it.x = L.x0 + (k - 0.5) * 1100 * L.dir;
        it.y = L.ground - 40 - Math.sin(k * Math.PI) * 760;
        it.rz = L.dir * lerp(-38, 38, k);
        it.leapOp = k < 0.06 || k > 0.94 ? 0 : 1;
        it.op = (it.fadeIn == null ? 1 : it.fadeIn) * it.leapOp;
      });
    }

    S.boot = { pat: 6, build: function (g) {
      S.macFloor = macFloor(g);
      S.macShadow = macShadow(g);
      S.mac = macPlane(g, { x: 0, y: -30, z: -1800, s: 1.25, op: 0, cull: false });
      S.macProps = [
        decorPlane(g, 'column', { x: -1820, z: -2350, s: 6.0, ground: 650, light: 'cyan', op: 0, cull: false }),
        decorPlane(g, 'column', { x: 1820, z: -2350, s: 6.0, ground: 650, light: 'pink', op: 0, cull: false }),
        decorPlane(g, 'column', { x: -2100, z: -4850, s: 2.2, ground: 650, light: 'indigo', op: 0, cull: false }),
        decorPlane(g, 'column', { x: 2100, z: -5200, s: 2.3, ground: 650, light: 'cyan', op: 0, cull: false }),
        decorPlane(g, 'palm', { x: -1320, z: -3750, s: 2.6, ground: 650, light: 'indigo', op: 0, cull: false }),
        decorPlane(g, 'palm', { x: 1320, z: -4050, s: 2.6, ground: 650, light: 'pink', op: 0, cull: false }),
        decorPlane(g, 'bust', { x: -980, z: -2050, s: 2.0, ground: 650, op: 0, cull: false }),
        decorPlane(g, 'bust', { x: 1000, z: -2150, s: 1.8, ground: 650, flip: true, op: 0, cull: false }),
        decorPlane(g, 'sunorb', { x: 1500, y: -1000, z: -5600, s: 2.6, op: 0, cull: false }),
        decorPlane(g, 'arcade', { x: -1500, z: -2900, s: 3.4, ground: 650, op: 0, cull: false }),
        decorPlane(g, 'can', { x: 1450, z: -2700, s: 3.6, ground: 650, flip: true, op: 0, cull: false }),
        decorPlane(g, 'temple', { x: -300, z: -8200, s: 3.4, ground: 650, op: 0, cull: false }),
        decorPlane(g, 'floppy', { x: 620, z: -1350, s: 1.2, ground: 650, op: 0, cull: false }),
        decorPlane(g, 'clock', { x: -640, z: -1400, s: 1.3, ground: 650, op: 0, cull: false }),
        decorPlane(g, 'kingStatue', { x: -2700, z: -4100, s: 2.2, ground: 650, op: 0, cull: false }),
        decorPlane(g, 'knightStatue', { x: 2750, z: -4500, s: 2.2, ground: 650, flip: true, op: 0, cull: false }),
        decorPlane(g, 'arch', { x: 2600, z: -6600, s: 2.2, ground: 650, op: 0, cull: false })];
      S.macDolphins = [dolphin(g, -1700, 650, -4400, 0, 1), dolphin(g, 1900, 650, -4700, 1.6, -1)];
      S.macFloaties = [[-620, -1500, 'beachball', 1.6], [700, -1400, 'swimring', 1.7], [-1500, -3000, 'flamingo', 2.2], [1600, -3300, 'beachball', 2.2]].map(function (f, i) {
        var it = decorPlane(g, f[2], { x: f[0], z: f[1], s: f[3], ground: 650, flip: i % 2 === 1, op: 0, cull: true });
        it.float = { y0: it.y, kind: f[2], ph: i * 1.7 }; S.macProps.push(it); return it;
      });
      // the void around the Mac: a loose ring of columns and palms receding into the pink
      for (var i = 0; i < 12; i++) {
        var side = i % 2 ? 1 : -1, z = -3000 - Math.floor(i / 2) * 900, jit = hash(i * 11) - 0.5;
        S.macProps.push(decorPlane(g, (i >> 1) % 2 ? 'palm' : 'column', { x: side * (2300 + Math.floor(i / 2) * 260 + jit * 300), z: z, s: 2.4 + jit, ground: 650, flip: side > 0, op: 0, cull: true }));
      }
      S.macProps = S.macProps.concat(S.macDolphins);
    }, enter: function () { S.done = {}; S.mac.op = 0; S.macFloor.op = 0; S.macShadow.op = 0; S.macProps.forEach(function (it) { it.op = 0; }); S.mac.draw('boot', 0, 0); hideLogo(); },
    update: function (t, lt) {
      S.mac.op = smooth(span(lt, .1, 1.1));
      S.macFloor.op = smooth(span(lt, .35, 1.6));
      S.macShadow.op = S.macFloor.op;
      S.macShadow.draw(t);
      S.macProps.forEach(function (it) { it.op = it.fadeIn = smooth(span(lt, 3.1, 5.1)); it.ry = -Cine.cam.yaw; });
      leap(S.macDolphins, t); bob(S.macFloaties, t); syncShadows(S.macProps);
      path([{ t: 0, x: 0, y: -30, z: -1570, tx: 0, ty: -30, tz: -1800, fov: 65, roll: 0 },
        { t: 5.8, x: 0, y: -30, z: 1400, tx: 0, ty: -30, tz: -1800, fov: 45, roll: 0 }], lt);
      S.mac.draw('boot', Math.min(1, lt / 4.2), 0);
      hud('SYSTEM 7 · BOOT', 'Welcome to Balcade');
    } };

    S.desktop = { pat: 6, enter: function () { S.mac.op = 1; S.macFloor.op = 1; S.macShadow.op = 1; S.macProps.forEach(function (it) { it.op = 1; }); S.mac.draw('desktop', 1, 0); hideLogo(); },
      update: function (t, lt) {
        path([{ t: 0, x: 0, y: -30, z: 1400, tx: 0, ty: -30, tz: -1800, fov: 45, roll: 0 },
          { t: 5.95, x: 0, y: -30, z: -1450, tx: 0, ty: -30, tz: -1800, fov: 48, roll: 0 }], lt);
        S.mac.draw('desktop', 1, easeOut(span(lt, 2.15, 3.1)));
        if (lt >= 3.4) logoCentre(lt - 3.4, lt - 4.1, 1 - smooth(span(lt, 5.2, 5.8)));
        Cine.env = 1 - smooth(span(lt, 5.0, 5.9));
        S.mac.op = Cine.env;
        S.macFloor.op = Cine.env;
        S.macShadow.op = Cine.env;
        S.macShadow.draw(t);
        S.macProps.forEach(function (it) { it.ry = -Cine.cam.yaw; it.op = Cine.env; }); S.macDolphins.forEach(function (it) { it.fadeIn = Cine.env; }); leap(S.macDolphins, t); bob(S.macFloaties, t); syncShadows(S.macProps);
        hud(lt < 3.2 ? 'FINDER · CHESS' : '', 'ＣＨＥＳＳ / チェス');
      }, exit: function () { hideLogo(); } };

    S.opening = { pat: 5, build: function (g) {
      S.board = chessBoardPlane(g, { x: 0, y: 0, z: 0, rx: 90, s: 2.1, cull: false, op: 0 });
      S.statues = [
        holoPlane(g, 'N', { x: -640, y: -220, z: 150, s: 1.7, op: 0, cull: false }),
        holoPlane(g, 'Q', { x: 550, y: -200, z: -250, s: 1.5, op: 0, cull: false }),
        holoPlane(g, 'k', { x: 0, y: -290, z: -760, s: 2, op: 0, cull: false }),
        holoPlane(g, 'p', { x: -170, y: -110, z: 50, s: 1.1, op: 0, cull: false })
      ];
      S.props = [
        decorPlane(g, 'column', { x: -1450, z: -950, s: 2.5, ground: 0, light: 'cyan', op: 0, cull: false }),
        decorPlane(g, 'column', { x: 1500, z: -1550, s: 2.6, ground: 0, light: 'pink', op: 0, cull: false }),
        decorPlane(g, 'column', { x: -2650, z: -3700, s: 1.8, ground: 0, light: 'indigo', op: 0, cull: false }),
        decorPlane(g, 'column', { x: 2700, z: -4750, s: 1.7, ground: 0, light: 'cyan', op: 0, cull: false }),
        decorPlane(g, 'palm', { x: -2100, z: -3150, s: 1.9, ground: 0, light: 'indigo', op: 0, cull: false }),
        decorPlane(g, 'palm', { x: 2220, z: -3400, s: 1.9, ground: 0, light: 'pink', op: 0, cull: false }),
        decorPlane(g, 'bust', { x: -2900, z: -7600, s: 7.5, ground: 0, op: 0, cull: false }),          // a giant Helios on the horizon
        decorPlane(g, 'sunorb', { x: 3000, y: -1900, z: -8200, s: 5, op: 0, cull: false }),
        decorPlane(g, 'palm', { x: -1500, z: -5200, s: 2.4, ground: 0, flip: true, op: 0, cull: false }),
        decorPlane(g, 'temple', { x: 600, z: -9800, s: 4, ground: 0, op: 0, cull: false }),                  // a temple on the horizon
        decorPlane(g, 'arcade', { x: -1250, z: -1250, s: 2.6, ground: 0, op: 0, cull: false }),
        decorPlane(g, 'handheld', { x: 1180, z: -350, s: 2.4, ground: 0, flip: true, op: 0, cull: false }),
        decorPlane(g, 'can', { x: 980, z: -2700, s: 3.2, ground: 0, op: 0, cull: false }),
        decorPlane(g, 'bottle', { x: -1050, z: -2300, s: 3, ground: 0, op: 0, cull: false }),
        decorPlane(g, 'arcade', { x: 1900, z: -6200, s: 3.6, ground: 0, flip: true, op: 0, cull: true }),
        decorPlane(g, 'arch', { x: 0, z: -4300, s: 2.2, ground: 0, op: 0, cull: false }),                    // the arch frames the avenue
        decorPlane(g, 'kingStatue', { x: -2350, z: -2100, s: 1.7, ground: 0, op: 0, cull: false }),
        decorPlane(g, 'knightStatue', { x: 2450, z: -2700, s: 1.7, ground: 0, flip: true, op: 0, cull: false }),
        decorPlane(g, 'kingStatue', { x: 3700, z: -7400, s: 2.6, ground: 0, flip: true, op: 0, cull: true }),
        decorPlane(g, 'knightStatue', { x: -3600, z: -6600, s: 2.6, ground: 0, op: 0, cull: true }),
        decorPlane(g, 'hand', { x: -1950, z: -950, s: 1.9, ground: 0, op: 0, cull: false }),
        decorPlane(g, 'clock', { x: 1400, z: -150, s: 2, ground: 0, op: 0, cull: false }),
        decorPlane(g, 'floppy', { x: -1500, z: 350, s: 1.8, ground: 0, flip: true, op: 0, cull: false }),
        decorPlane(g, 'ruin', { x: 2100, z: -1500, s: 1.6, ground: 0, op: 0, cull: false }),
        decorPlane(g, 'ruin', { x: -2900, z: -4300, s: 2, ground: 0, flip: true, op: 0, cull: true }),
        decorPlane(g, 'colWhite', { x: -1150, z: -4700, s: 1.6, ground: 0, op: 0, cull: true }),
        decorPlane(g, 'colWhite', { x: 1150, z: -4700, s: 1.6, ground: 0, flip: true, op: 0, cull: true }),
        decorPlane(g, 'colWhite', { x: -3300, z: -2900, s: 1.9, ground: 0, op: 0, cull: true }),
        decorPlane(g, 'colWhite', { x: 3350, z: -3900, s: 1.9, ground: 0, flip: true, op: 0, cull: true })
      ];
      // the fallen crown drops beside the board at checkmate; the capture burst blooms over the captured pawn
      S.crown = decorPlane(g, 'crown', { x: 640, z: -1050, s: 1.6, ground: 0, op: 0, cull: false }); S.crown.y0 = S.crown.y;
      S.burst = burstPlane(g, { x: -170, y: -150, z: 60, s: 1, op: 0, cull: false });
      S.dolphins = [dolphin(g, -2300, 0, -4300, 0.4, 1), dolphin(g, 2500, 0, -5200, 2.0, -1), dolphin(g, 600, 0, -6800, 1.1, 1)];
      S.props = S.props.concat(S.dolphins);
      // inflatables scattered round the board: bouncing beach balls, bobbing rings and a flamingo or two
      S.floaties = [];
      [[-1150, -300, 'beachball', 2.4], [1250, -900, 'beachball', 2.0], [-900, -1900, 'swimring', 2.6], [1500, -2400, 'flamingo', 2.6],
       [-1900, -3200, 'beachball', 3], [700, -3600, 'swimring', 3], [-600, -5200, 'flamingo', 3.4], [2300, -5600, 'beachball', 4],
       [-2500, -6400, 'swimring', 4], [1100, -7600, 'beachball', 5]].forEach(function (f, i) {
        var it = decorPlane(g, f[2], { x: f[0], z: f[1], s: f[3], ground: 0, flip: i % 2 === 1, op: 0, cull: true });
        it.float = { y0: it.y, kind: f[2], ph: i * 1.3 }; S.floaties.push(it); S.props.push(it);
      });
      // an avenue: columns and palms lining both sides of the board out to the horizon, then a scatter beyond
      for (var i = 0; i < 9; i++) {
        var z = -500 - i * 950, side, k;
        for (side = -1; side <= 1; side += 2) {
          var jit = hash(i * 7 + side) - 0.5;
          S.props.push(decorPlane(g, i % 2 ? 'palm' : 'column', { x: side * (1700 + i * 90 + jit * 200), z: z + jit * 300, s: 1.9 + jit * 0.5, ground: 0, flip: side > 0, op: 0, cull: true }));
          S.props.push(decorPlane(g, i % 2 ? 'column' : 'palm', { x: side * (2700 + i * 140 + jit * 300), z: z - 450, s: 2.2 + jit * 0.6, ground: 0, flip: side < 0, op: 0, cull: true }));
        }
      }
      for (k = 0; k < 10; k++) {
        var a = hash(k * 3.7) * Math.PI - Math.PI / 2, dist = 6500 + hash(k * 5.3) * 4500;
        S.props.push(decorPlane(g, ['palm', 'column', 'palm', 'bust'][k % 4], { x: Math.sin(a) * dist * 0.8, z: -Math.cos(a) * dist - 1500, s: 3 + hash(k) * 2.5, ground: 0, flip: k % 2 === 0, op: 0, cull: true }));
      }
      S.kingPad = holoPadPlane(g, false, { x: 0, y: -290 + 74 * 8 - 160 * 2, z: -760, s: 2, op: 0, cull: false });
      S.afterimages = [0, 1, 2].map(function (i) { return holoPlane(g, 'N', { x: -640, y: -220, z: 150 - i * 12, s: 1.7, op: 0, cull: false }); });
      // the alerts sit right in the camera's path, so it flies through each one (flyAlert)
      S.captureAlert = macAlert(g, 'The application Queen has unexpectedly quit.', { x: 390, y: -430, z: 250, s: .5, op: 0, cull: false });
      S.stairs = Array.from({ length: 10 }, function (_, i) {
        var tile = el('div', 'cx-float-tile ' + (i % 2 ? 'dark' : 'light'));
        return plane(g, tile, 150, 150, { x: -470 + i * 105, y: 0, z: -950 - i * 145, rx: 90, rz: 0, op: 0, cull: false });
      });
      // a cascade of the same alert, each a step down and right of the last, like a window dragged on an old Mac
      S.checkAlerts = [2450, 2130, 1810, 1490, 1170].map(   // along the run, one about every 1.4 s
        function (z, i) { return macAlert(g, 'Check.', { x: (2900 - z) / 1900 * 700 + (i % 2 ? 1 : -1) * 50, y: -420 + i * 6, z: z, rz: (i % 2 ? 1 : -1) * 4, s: .55, op: 0, cull: false }); });
      S.orb = orbPlane(g, { x: 0, y: -400, z: 2700, op: 0, cull: false });
      S.orbHits = S.checkAlerts.map(function (it) {
        var e = (2900 - it.z) / 1900, q = (1.15 - Math.sqrt(1.3225 - 0.6 * e)) / 0.3;   // the run's camera reaches this z at 30 + 8q
        return { it: it, t: 30 + 8 * q - 1.5 };
      });
      S.mateAlert = macAlert(g, 'Checkmate.', { x: 385, y: -355, z: 430, s: .6, op: 0, cull: false });
      S.captureAlert.baseS = .5; S.mateAlert.baseS = .6; S.checkAlerts.forEach(function (it) { it.baseS = .55; });
    }, enter: function () { var Qn = S.statues[1]; Qn.holo.hit = 0; Qn.holo.off = 0; var K = S.statues[2]; K.x = 0; K.y = -290; K.z = -760; K.rz = 0; K.holo.hit = 0; K.holo.off = 0; K.holo.noPad = false; S.kingPad.op = 0; S.crown.op = 0; S.boardFrame = -1; S.board.op = 0; S.statues.forEach(function (it) { it.hidden = false; it.op = 0; }); S.props.forEach(function (it) { it.op = 0; }); S.afterimages.forEach(function (it) { it.op = 0; }); resetAlert(S.captureAlert); S.checkAlerts.forEach(resetAlert); resetAlert(S.mateAlert); hideLogo(); },
      update: function (t, lt) {
        boardAt(t);
        path([{ t: 0, x: 0, y: -3500, z: 1400, tx: 0, ty: 0, tz: 0, fov: 78 },
          { t: 2, x: -550, y: -900, z: 1000, tx: 0, ty: -100, tz: 0, fov: 64, roll: -5, e: easeOut },
          { t: 9.8, x: 650, y: -380, z: 850, tx: 0, ty: -120, tz: -150, fov: 50, roll: 3 }], lt);
        S.board.op = smooth(span(lt, .1, 1.1));
        S.statues.forEach(function (it, i) { it.op = smooth(span(lt, 1 + i * .7, 3 + i * .7)); it.y = lerp(110, [-220,-200,-290,-110][i], smooth(span(lt, 1 + i * .7, 3 + i * .7))); });
        S.props.forEach(function (it) { it.op = it.fadeIn = smooth(span(lt, .8, 2.4)); });
        faceStatues(); Cine.speed = 0.12 * (1 - smooth(span(lt, 0, 2)));
        hud('F15 GAMBIT', 'PLY ' + Math.max(0, boardAt(t)) + ' / 15');
      } };

    S.capture = { pat: 5, enter: function () { S.boardFrame = -1; S.board.op = 1; S.statues.forEach(function (it) { it.hidden = false; it.op = 1; }); S.props.forEach(function (it) { it.op = 1; }); S.afterimages.forEach(function (it) { it.op = 0; }); resetAlert(S.captureAlert); },
      update: function (t, lt, u, dt) {
        boardAt(t);
        var N = S.statues[0], crouch = Math.sin(clamp01((t - 24.82) / 0.2) * Math.PI) * (t < 25.02 ? 1 : 0), k = clamp01((t - 25.0) / 0.4), land = clamp01((t - 25.4) / 0.35);
        var arc = k * (2 - k);                                                 // fast off the ground, easing into the target
        N.x = lerp(-640, -210, arc) - crouch * 30; N.y = -220 - Math.sin(k * Math.PI) * 250 + crouch * 26 + Math.sin(land * Math.PI) * 18 * (1 - land);
        N.rz = t < 25.0 ? -crouch * 8 : t < 25.4 ? lerp(-8, 16, k) : 16 * (1 - easeOut(land)) * Math.cos(land * 9);
        N.s = 1.7 * (1 + (t > 25.4 ? -0.07 * Math.sin(land * Math.PI) * (1 - land) : 0));
        S.statues[3].op = 1 - smooth(span(t, 25.4, 25.6));
        var bf = Math.floor((t - 25.4) * 12); S.burst.op = bf >= 0 && bf < 16 ? 1 : 0; if (S.burst.op) burstFrame(S.burst, bf); S.burst.ry = -Cine.cam.yaw;
        S.afterimages.forEach(function (it, i) { var q = clamp01((t - .05 * (i + 1) - 25.0) / 0.4), a2 = q * (2 - q); it.x = lerp(-640, -210, a2); it.y = -220 - Math.sin(q * Math.PI) * 250; it.rz = lerp(-8, 16, q); it.ry = -Cine.cam.yaw; it.op = q > 0 && q < 1 ? .3 - i * .08 : 0; });
        path([{ t: 0, x: -920, y: -430, z: 1000, tx: -450, ty: -180, tz: 100, fov: 50 },
          { t: 3.4, x: -760, y: -420, z: 980, tx: -260, ty: -200, tz: 60, fov: 54, roll: -4 },
          { t: 5.1, x: 180, y: -440, z: 900, tx: 470, ty: -410, tz: -350, fov: 53 },
          { t: 7.9, x: 520, y: -420, z: -150, tx: 470, ty: -410, tz: -700, fov: 60, e: easeIn }], lt);   // straight through the alert
        kick(dt);
        faceStatues();
        once(S, 'capture', t, 25.4, function () { var p = projectP({ x: -170, y: -110, z: 50 }); if (p) { ring(p, 260); burst(p.x, p.y, qn(32), [320, 185], .5); }
          shatterGlass(S.statues[3], { x: -170, y: -110, z: 50 }, { x: 170, y: -140, z: 70 });
          petals({ x: -170, y: -110, z: 50 }, 44); Cine.flash = Math.max(Cine.flash, .19); Cine.vhs = 1; Cine.shake = Math.max(Cine.shake, .5); Cine.fovKick = -8; Cine.hitStop = 0.12; caption('F15 GAMBIT', 'Nxe5 · THE QUEEN IS BAIT'); });
        // D. the queen is taken: her hologram tears and powers down, and stays gone
        var Q = S.statues[1];
        Q.holo.hit = t < 27 ? 0 : Math.max(0, 1 - (t - 27) / 0.6); Q.holo.off = smooth(span(t, 27.15, 27.75)); Q.holo.noPad = false;
        once(S, 'queen', t, 27, function () { var p = projectP({ x: Q.x, y: Q.y, z: Q.z }); if (p) { ring(p, 240); burst(p.x, p.y, qn(26), [320, 285], .5); }
          Cine.shake = Math.max(Cine.shake, .4); Cine.vhs = 1; caption('QUEEN TAKEN', '...Bxd1 · AS PLANNED'); });
        flyAlert(S.captureAlert, t, t >= 26.4);
        hud('CAPTURE · Nxe5', 'HOLOGRAM / PETALS');
      } };

    S.check = { pat: 5, enter: function () { S.boardFrame = -1; S.board.op = 1; S.captureAlert.op = 0; S.statues.forEach(function (it, i) { it.hidden = false; it.op = i === 3 || i === 1 ? 0 : 1; }); S.props.forEach(function (it) { it.op = 1; }); S.afterimages.forEach(function (it) { it.op = 0; }); S.statues[0].x = -210; S.statues[0].rz = 0; S.statues[0].s = 1.7; var K0 = S.statues[2]; K0.x = 0; K0.y = -290; K0.z = -760; K0.rz = 0; S.checkAlerts.forEach(resetAlert); },
      update: function (t, lt, u, dt) {
        boardAt(t);
        S.statues[1].op = 0;   // (the queen was taken)
        // a run at the king through a corridor of Check. alerts, bursting through each, weaving a little, handing straight
        // on to the checkmate shot's opening move
        path([{ t: 0, x: 0, y: -430, z: 2900, tx: 0, ty: -260, tz: -760, fov: 50 },
          { t: 8, x: 700, y: -420, z: 1000, tx: 0, ty: -280, tz: -760, fov: 48, e: function (q) { return q * (1.15 - 0.15 * q); } }], lt);
        Cine.cam.x += Math.sin(lt * 1.1) * 90 * (1 - span(lt, 6, 8)); Cine.cam.roll = Math.sin(lt * 1.1 + 0.6) * 4 * (1 - span(lt, 6.5, 8));
        lookAt(0, -280, -760);
        // Ke7: the king flinches a step forward at 34 s
        var K = S.statues[2], fl = clamp01((t - 34) / 0.45);
        K.y = -290 - Math.sin(fl * Math.PI) * 60; K.rz = Math.sin(fl * Math.PI) * 6;
        once(S, 'ke7', t, 34, function () { K.holo.hit = 0.6; Cine.vhs = Math.max(Cine.vhs, 0.6); });
        K.holo.hit = Math.max(0, (K.holo.hit || 0) - dt * 1.2);
        once(S, 'chk', t, 30.5, function () { caption('CHECK', 'Bxf7+ · THE F1 BISHOP STRIKES'); Cine.vhs = 1; });
        kick(dt);
        var o = orbAt(t);
        S.orb.x = o.x; S.orb.y = o.y; S.orb.z = o.z; S.orb.ry = -Cine.cam.yaw; S.orb.rz = t * 240;
        S.orb.op = smooth(span(t, 30.05, 30.35)) * (1 - smooth(span(t, 37.6, 37.95)));
        S.orb.s = 1 + 0.35 * Math.max(0, 1 - Math.min.apply(null, S.orbHits.map(function (h) { return Math.abs(t - h.t); })) / 0.12);
        // the camera chases the orb (a little behind and above it, along the run), then settles onto the run's last
        // pose for the checkmate shot
        var c = Cine.cam, rd = { x: 700 / 2024, z: -1900 / 2024 }, back = 520, hand = smooth(span(t, 36.6, 38));
        var fx = o.x - rd.x * back + Math.sin(lt * 1.1) * 40, fy = o.y - 100, fz = o.z - rd.z * back;
        c.x = lerp(fx, c.x, hand); c.y = lerp(fy, c.y, hand); c.z = lerp(fz, c.z, hand);
        lookAt(lerp(o.x + rd.x * 220, 0, hand), lerp(o.y + 10, -280, hand), lerp(o.z + rd.z * 220, -760, hand));
        if (S.orb.op > 0.2 && Math.random() < 0.7) { var op2 = projectP(o); if (op2) burst(op2.x, op2.y, 2, [320, 190], 0.3); }
        S.orbHits.forEach(function (h, i) {
          if (t >= h.t + 0.4 && !h.it.broken) { h.it.broken = true; h.it.op = 0; }   // (started past it)
          once(S, 'orb' + i, t, h.t, function () {
            var pp = projectP(h.p); if (pp) { ring(pp, 300 * Math.min(2, pp.s)); burst(pp.x, pp.y, qn(36), [320, 190, 285], 0.8); }
            var ya = Cine.cam.yaw * D2R;
            breakAlert(h.it, { x: Math.sin(ya) * 1400 + (i % 2 ? -300 : 300), y: -260, z: -Math.cos(ya) * 1400 });
            Cine.shake = Math.max(Cine.shake, 0.5); Cine.vhs = 1; Cine.fovKick = -7; Cine.hitStop = 0.08;
          });
        });
        S.checkAlerts.forEach(function (it) { flyAlert(it, t, true); });
        Cine.speed = 0.25; Cine.streaks = 0.3;
        faceStatues();
        hud('CHECK', 'THE KING IS EXPOSED');
      } };

    S.mate = { pat: 5, enter: function () { S.orb.op = 0; var K = S.statues[2]; K.x = 0; K.y = -290; K.z = -760; K.holo.hit = 0; K.holo.off = 0; K.holo.noPad = false; K.holo.frame = -1; S.kingPad.op = 0; S.boardFrame = -1; S.board.op = 1; S.statues.forEach(function (it, i) { it.hidden = false; it.op = i === 3 || i === 1 ? 0 : 1; }); S.props.forEach(function (it) { it.op = 1; }); S.afterimages.forEach(function (it) { it.op = 0; }); S.checkAlerts.forEach(function (it) { it.op = 0; }); resetAlert(S.mateAlert); S.statues[2].rz = 0; },
      update: function (t, lt, u, dt) {
        boardAt(t);
        // hit-stop: the camera all but stops for a quarter second on the blow, then carries on
        var hs = lt < 1.1 ? lt : lt < 1.35 ? 1.1 + (lt - 1.1) * 0.12 : lt - 0.22;
        path([{ t: 0, x: 700, y: -420, z: 1000, tx: 0, ty: -280, tz: -760, fov: 48 },
          { t: 1.1, x: 360, y: -350, z: 380, tx: 0, ty: -250, tz: -760, fov: 54, e: function (q) { return q * (0.45 + 0.55 * q); } },   // through Checkmate. on the mating move
          { t: 4.9, x: 120, y: -270, z: 100, tx: -180, ty: -140, tz: -760, fov: 62, roll: -5, e: easeOut }], hs);
        kick(dt);
        flyAlert(S.mateAlert, t, true);
        var K = S.statues[2], KF = 23 * 4 * K.s, a = 0;           // KF: centre to the piece's foot (canvas row 63)
        K.holo.hit = t < 39.1 ? 0 : Math.max(0, 1 - (t - 39.1) / 0.9);
        K.holo.noPad = t >= 39.1; S.kingPad.op = t >= 39.1 ? 1 : 0; S.kingPad.ry = -Cine.cam.yaw;
        if (t >= 39.32 && t < 39.95) a = -88 * Math.pow((t - 39.32) / 0.63, 2);                       // falls, gathering speed
        else if (t >= 39.95) { var b = t - 39.95; a = -88 + 16 * Math.exp(-b * 6) * Math.abs(Math.sin(b * 15)); }   // and bounces
        K.rz = a;
        var ar = a * D2R, ry = -Cine.cam.yaw * D2R, sx = Math.sin(ar) * KF;     // pivot about the foot, in the billboard's plane
        K.x = sx * Math.cos(ry); K.z = -760 - sx * Math.sin(ry); K.y = -290 + KF - Math.cos(ar) * KF + (t >= 39.1 && t < 39.32 ? -30 * Math.sin((t - 39.1) / 0.22 * Math.PI) : 0);
        K.holo.off = smooth(span(t, 41.8, 42.7));
        once(S, 'thud', t, 39.95, function () {
          var p = projectP({ x: K.x - Math.cos(ry) * KF, y: -40, z: K.z });
          if (p) { ring(p, 300); burst(p.x, p.y, qn(40), [285, 190, 320], 0.9); }
          Cine.shake = Math.max(Cine.shake, .85); Cine.fovKick = -9; Cine.vhs = 1; Cine.aberration = Math.max(Cine.aberration, .6);
        });
        // the crown, knocked loose, lands just after him and rocks to rest
        var cr = clamp01((t - 39.55) / 0.55), cb = t - 40.1;
        S.crown.op = t >= 39.55 ? 1 : 0; S.crown.y = S.crown.y0 - (1 - cr * cr) * 900; S.crown.ry = -Cine.cam.yaw;
        S.crown.rz = cr < 1 ? (1 - cr) * 160 : 9 * Math.exp(-cb * 4) * Math.sin(cb * 14);
        if (S.crown.shadow) { S.crown.shadow.op = S.crown.op * cr; }
        once(S, 'crown', t, 40.1, function () { var p = projectP({ x: S.crown.x, y: -30, z: S.crown.z }); if (p) burst(p.x, p.y, qn(18), [320, 285], 0.6); Cine.shake = Math.max(Cine.shake, .35); });
        S.board.op = 1 - .65 * smooth(span(t, 40.4, 42.8));
        S.stairs.forEach(function (it, i) { var k = smooth(span(t, 39.4 + i * .12, 41.8 + i * .12)); it.op = k * .9; it.y = -i * 42 * k; it.rz = (i % 2 ? -1 : 1) * 9 * k; });
        once(S, 'mate', t, 39.1, function () { var p = projectP({ x: 0, y: -250, z: -760 }); if (p) { ring(p, 390); petals({ x: 0, y: -250, z: -760 }, 55); }
          Cine.flash = Math.max(Cine.flash, .28); Cine.shake = Math.max(Cine.shake, .7); Cine.aberration = .9; Cine.vhs = 1; Cine.fovKick = -14; caption('CHECKMATE', '♞ Nd5#'); });
        faceStatues(); hud('CHECKMATE', '♞ Nd5#');
      } };

    S.achievements = { pat: 6, build: function (g) {
      var wall = panel('cine-ach', 'Achievements');
      S.achCount = el('div', 'cine-panel-sub', wall);
      var grid = el('div', 'cine-grid', wall);
      S.achItems = (ACH && ACH.list ? ACH.list() : []).slice(0, 10).map(function (a) {
        var card = el('div', 'cine-card tier-' + a.tier, grid);
        card.appendChild(ACH.badge(a.id, 56, false));
        el('span', 'cine-card-name', card).textContent = a.secret ? '???' : a.name;
        return card;
      });
      S.achWall = plane(g, wall, 1900, 760, { x: 0, y: 0, z: 0, ry: 14, rx: 6, cull: false });
      buildSocial(g, S, me);
    }, enter: function () { S.achWall.x = 0; S.achWall.ry = 14; S.invite.op = 0; S.profPanel.x = 300; hud(''); },
      update: function (t, lt) {
        chessSocial(S, 'achievements', t);
        var n = S.achItems.length, on = Math.min(n, Math.floor(n * (0.5 + lt * .55)));
        S.achItems.forEach(function (it, i) { it.classList.toggle('on', i < on); });
        S.achCount.textContent = Math.min(n, on) + ' / ' + n + ' unlocked';
  
      } };
    addSocialShots(S, me);
    S.profile.pat = S.chat.pat = S.friends.pat = 6;

    S.modes = { pat: 6, build: function (g) {
      var src = document.getElementById('menuPanel'), mp = src ? src.cloneNode(true) : panel('cine-modes', 'Choose a mode');
      mp.classList.remove('hidden'); mp.classList.add('cine-real'); mp.style.width = '760px';
      mp.querySelectorAll('[id]').forEach(function (e) { e.removeAttribute('id'); });
      S.modeCards = Array.prototype.slice.call(mp.querySelectorAll('.mode-card, .chip'));
      S.modePanel = plane(g, mp, 760, 1000, { x: 0, y: 0, z: 0, ry: -8, s: 1.5, cull: false });
      var sk = document.querySelector('.gskull-panel');
      if (sk) { var wall = sk.cloneNode(true); wall.querySelectorAll('[id]').forEach(function (e) { e.removeAttribute('id'); }); wall.classList.add('cine-real');
        S.skullCards = Array.prototype.slice.call(wall.querySelectorAll('.gsk-card')); S.skullWall = plane(g, wall, 960, 720, { x: 0, y: 0, z: -2200, ry: 10, s: 1.5, cull: false }); }
      else S.skullCards = [];
    }, enter: function () { S.modePanel.x = 0; }, update: function (t, lt) {
      path([{ t: 0, x: -700, y: -480, z: 1000, tx: -150, ty: -300, tz: 0, fov: 52 },
        { t: 2, x: 300, y: -100, z: -300, tx: 0, ty: 0, tz: -2200, fov: 56 }], lt);
      var n = S.modeCards.length, i = n ? Math.floor(lt / (SPB / 2)) % n : -1;
      S.modeCards.forEach(function (c, j) { c.classList.toggle('cine-hl', j === i); });
      S.modePanel.x = lerp(0, -2400, easeIn(span(lt, 1.45, 2)));
    } };
    S.skulls = { pat: 6, update: function (t, lt) {
      path([{ t: 0, x: 300, y: 0, z: -300, tx: 0, ty: 0, tz: -2200, fov: 56 },
        { t: 2, x: -100, y: 0, z: -1550, tx: -100, ty: 0, tz: -2200, fov: 58 }], lt);
      S.skullCards.forEach(function (c, j) { c.classList.toggle('cine-hl', j === Math.floor(lt * 3) % S.skullCards.length); });
    } };

    /* ---------- 53 to 60: the king in the middle of the board, the logo above it; the camera swivels round the
       king and closes in until the logo sits exactly where the page's own title is, then the film fades away and the
       live menu is there underneath (the same hand-over as the other openings, but done in 3D) ---------- */

    // the king floats well above the board (its shadow on the squares below), so the camera, which ends level with
    // the logo, always stays above the board
    var KING = { x: 0, y: -560, z: -1600 }, LOGO_Y = -880, FINAL_FOV = 44;   // (sized so the camera closes in to reach the title, never backs off)
    S.final = { pat: 5, build: function (g) {
      S.finalBoard = chessBoardPlane(g, { x: 0, y: 0, z: -1600, rx: 90, s: 2, op: 1, cull: false });
      var last = frames[frames.length - 1].squares.slice ? frames[frames.length - 1].squares.slice() : frames[frames.length - 1].squares;
      KIT.setPosition(S.finalBoard.board, last);
      S.finalKing = holoPlane(g, 'K', { x: KING.x, y: KING.y, z: KING.z, s: 1.3, cull: false });
      S.finalLogo = logoPlane(g, { x: KING.x, y: LOGO_Y, z: KING.z, s: 0.3, cull: false });
      // the same world round the final board: columns, palms and inflatables in a ring
      S.finalProps = [];
      for (var i = 0; i < 14; i++) {
        var a = i / 14 * Math.PI * 2 + 0.2, rad = 2300 + (i % 3) * 700;
        S.finalProps.push(decorPlane(g, ['column', 'palm', 'beachball', 'palm', 'swimring', 'column', 'flamingo'][i % 7],
          { x: Math.sin(a) * rad, z: KING.z + Math.cos(a) * rad, s: [2.2, 2.2, 2.2, 2.4, 2.4, 2.6, 2.4][i % 7], ground: 0, flip: i % 2 === 0, cull: true }));
      }
      // a soft round shadow on the board under the floating king
      var sh = document.createElement('canvas'); sh.width = 64; sh.height = 64; sh.className = 'cx-king-shadow';
      var sx = sh.getContext('2d'), grad = sx.createRadialGradient(32, 32, 2, 32, 32, 31);
      grad.addColorStop(0, 'rgba(20,8,40,0.75)'); grad.addColorStop(0.6, 'rgba(40,10,60,0.35)'); grad.addColorStop(1, 'rgba(40,10,60,0)');
      sx.fillStyle = grad; sx.fillRect(0, 0, 64, 64);
      S.kingShadow = plane(g, sh, 420, 420, { x: KING.x, y: -3, z: KING.z, rx: 90, cull: false });
    }, enter: function () { S.finalBoard.op = 1; S.finalKing.op = 1; S.finalLogo.op = 1; S.kingShadow.op = 1; hideLogo(); hud(''); },
      update: function (t, lt, u, dt) {
        finalCamera(t);
        S.finalLogo.op = smooth(span(t, 53.3, 54.2));
      } };

    // Where the camera must end so the logo plane lands on the page title: straight on, at the distance that makes
    // the logo's letters as wide as the title's, shifted so the logo sits on the title's centre.
    function finalPose() {
      var title = document.querySelector('.game-head .game-title'), r = null;
      if (title) { var rg = document.createRange(); rg.selectNodeContents(title); r = rg.getBoundingClientRect(); }
      var vw = innerWidth || 1280, vh = innerHeight || 720, safeH = Math.min(vh, vw * 9 / 16);
      var P = (safeH / 2) / Math.tan(FINAL_FOV * D2R / 2);
      var wantW = r && r.width ? r.width : vw * 0.3, cx = r && r.width ? r.left + r.width / 2 : vw / 2, cy = r && r.width ? r.top + r.height / 2 : vh * 0.3;
      var logoW = S.finalLogo.w * S.finalLogo.s * S.finalLogo.textFrac;
      // the camera stays level with the logo and turns to put it where the title is (moving it instead would sink it
      // under the floor on a tall phone screen, where the title sits far above the middle); the distance allows for
      // the logo then being off the view's axis, so it still comes out exactly the title's width
      var dx = cx - vw / 2, dy = cy - vh / 2, ax = Math.atan(dx / P), ay = Math.atan(dy / P);
      var d = logoW * P / wantW / (Math.cos(ax) * Math.cos(ay));
      var pos = { x: KING.x, y: LOGO_Y, z: KING.z + d };
      return { pos: pos, look: { x: KING.x - Math.tan(ax) * d, y: LOGO_Y - Math.tan(ay) * d, z: KING.z } };
    }
    function finalCamera(t) {
      // the swivel eases round; the closing-in gathers speed all the way (k^2.2) and the field of view widens with
      // it, both landing exactly on the end pose
      var k = span(t, 53, 58.8), e = easeInOut(k), z = Math.pow(k, 2.2), end = finalPose();
      var th = lerp(-205, 0, e) * D2R, R = lerp(2700, end.pos.z - KING.z, z);
      var pos = { x: KING.x + Math.sin(th) * R + (end.pos.x - KING.x) * z, y: lerp(-900, end.pos.y, z), z: KING.z + Math.cos(th) * R };
      var look = mix3({ x: KING.x, y: lerp(-260, LOGO_Y, smooth(span(t, 54, 58.8))), z: KING.z }, end.look, smooth(span(t, 56.5, 58.8)));
      var c = Cine.cam;
      c.x = pos.x; c.y = Math.min(pos.y, -160); c.z = pos.z;   // (never down at board level)
      c.fov = lerp(30, FINAL_FOV, Math.pow(k, 1.6)); c.roll = Math.sin(th) * 4 * (1 - e);
      Cine.speed = 0.35 * z * (1 - span(t, 58.6, 58.8)); Cine.streaks = Cine.speed;
      once(S, 'land', t, 58.8, function () { Cine.flash = Math.max(Cine.flash, 0.18); Cine.aberration = 0.8; });   // it lands on the title
      lookAt(look.x, look.y, look.z);
      // the king and the logo always face the camera (they're cut-outs)
      S.finalKing.ry = -c.yaw; S.finalLogo.ry = -c.yaw;
      S.finalProps.forEach(function (it) { it.ry = -c.yaw; });
      // the king bobs gently; its shadow tightens and darkens as it dips
      var bob = Math.sin(t * 1.8) * 22;
      S.finalKing.y = KING.y + bob; holoTick([S.finalKing], t); vhsBoard(S.finalBoard, t);
      S.kingShadow.s = 1 - bob / 300; S.kingShadow.op = 0.85 + bob / 150;   // (a plane faces +z at ry 0, so it turns by minus the camera yaw)
    }

    S.menu = { pat: 5, update: function (t, lt) {
      finalCamera(t);
      if (!S.menu.hit) { S.menu.hit = true; caption(); }
      hideLogo();
      var k = smooth(span(lt, 0.9, 1.9));
      Cine.stage.style.opacity = (1 - k).toFixed(3);
      Cine.root.style.backgroundColor = 'rgba(0,0,0,' + (1 - k).toFixed(3) + ')';
      Cine.vhsEl.style.opacity = (1 - k * 0.85).toFixed(3);
      if (lt > 1.0 && !Cine.ending) { Cine.ending = true; Cine.root.classList.add('letting-go'); }
    }, enter: function () { S.menu.hit = false; window.scrollTo(0, 0); hud(''); } };

    var shots = CUES.shots.map(function (cue) {
      var shot = S[cue.id]; shot.id = cue.id; shot.cue = cue;
      var gid = cue.group || cue.id; shot.group = Cine.groups[gid] || group(gid);
      if (shot.build && !cue.group) shot.build(shot.group);
      return shot;
    });
    Cine.S = S;
    return shots;
  }
  function uFor(t, a, b) { return clamp01((t - a) / (b - a)); }

  // The profile, chat, friends and invite panels (the same real data and look as the Tetris opening).
  function buildSocial(g, S, me) {
    var prof = panel('cine-profile', 'PROFILE');
    var row = el('div', 'cine-prof-row', prof);
    var av = el('div', 'cine-prof-av', row);
    av.appendChild(G.Profile && G.Profile.avatar ? G.Profile.avatar(me, 180) : avatarArt(1, 180));
    var info = el('div', 'cine-prof-info', row);
    el('div', 'cine-prof-name', info).textContent = me.name;
    el('div', 'cine-prof-lvl', info).textContent = 'LEVEL ' + (window.GameSocial && window.GameSocial.level ? window.GameSocial.level() : 1);
    var bar = el('div', 'cine-prof-bar', info); S.profBar = el('i', '', bar);
    el('div', 'cine-panel-label', prof).textContent = 'THEME';
    var themes = el('div', 'cine-chips', prof);
    S.profThemes = ['Neon', 'Arcade', 'Midnight', 'Vapor', 'Static'].map(function (n) { var c = el('span', 'cine-chip', themes); c.textContent = n; return c; });
    el('div', 'cine-panel-label', prof).textContent = 'COLOUR';
    var sw = el('div', 'cine-swatches', prof);
    S.profSw = ['#c77dff', '#a020ff', '#7c6cff', '#4cc9ff', '#3d8bff', '#ff2fa6', '#28e8ff'].map(function (c) { var s = el('span', 'cine-sw', sw); s.style.background = c; return s; });
    S.profPanel = plane(g, prof, 1100, 720, { x: 300, y: 80, z: -2600, ry: -10, cull: false });

    var chat = panel('cine-chat', 'CHAT · CHESS');
    S.chatList = el('div', 'cine-chat-list', chat);
    S.chatMsgs = [[me.name, 'Chess room ready']];
    S.chatPanel = plane(g, chat, 900, 760, { x: -900, y: 0, z: -4800, ry: 18, cull: false });

    var fr = panel('cine-friends', 'FRIENDS');
    var realFriends = window.GameSocial && window.GameSocial.friends ? window.GameSocial.friends().filter(function (f) { return f.status === 'accepted'; }) : [];
    el('div', 'cine-panel-sub', fr).textContent = realFriends.length + ' friend' + (realFriends.length === 1 ? '' : 's');
    S.friendRows = realFriends.slice(0, 6).map(function (f) {
      var p = f.profile || { name: 'Friend' }, r = el('div', 'cine-friend', fr);
      r.appendChild(G.Profile.avatar(p, 56));
      el('span', 'cine-friend-name', r).textContent = p.name;
      el('span', 'cine-friend-st', r).textContent = 'friend';
      return r;
    });
    if (!S.friendRows.length) el('div', 'cine-panel-sub', fr).textContent = 'No friends yet · add someone from your profile';
    S.friendsPanel = plane(g, fr, 900, 820, { x: 700, y: 40, z: -6600, ry: -16, cull: false });

    var inv = panel('cine-invite', 'GAME INVITE');
    var ir = el('div', 'cine-prof-row', inv);
    ir.appendChild(avatarArt(3, 110));
    var iw = el('div', '', ir);
    el('div', 'cine-prof-name', iw).textContent = 'A friend';
    el('div', 'cine-prof-lvl', iw).textContent = 'Play chess together';
    var btns = el('div', 'cine-invite-btns', inv);
    el('span', 'cine-accept', btns).textContent = 'Accept';
    el('span', 'cine-decline', btns).textContent = 'Decline';
    S.invite = plane(g, inv, 860, 420, { x: 400, y: 0, z: -6000, cull: false, op: 0 });
    S.invite.hidden = !realFriends.length;
  }

  /* The social run (achievements, profile, chat, friends) is one continuous move: a smooth spline through the panels
     over the whole stretch, in real seconds, so the camera never stops dead at a cut or snaps its aim to the next
     panel, and each panel comes to life (and steps aside) at its point on the run. Keys: u, camera x y z, look x y z, fov. */
  var SOCIAL_KEYS = [
    [0.00, 300, 100, 950, 150, 40, 0, 54], [0.18, -250, -80, 1000, -150, -20, 0, 54],
    [0.30, -100, -60, -700, 300, 80, -2600, 56], [0.40, 500, 110, -1450, 300, 80, -2600, 54], [0.48, 680, 140, -1700, 320, 80, -2600, 54],
    [0.60, -500, 30, -3600, -900, 0, -4800, 54], [0.70, -620, 40, -3800, -900, 0, -4800, 54],
    [0.80, -100, 0, -4300, 500, 30, -6300, 54], [0.88, 380, -40, -5300, 700, 40, -6600, 54], [1.00, 420, 0, -5450, 420, 0, -6000, 54]];
  /* Chess's social section: a cut to each panel with a different kind of shot instead of one long glide. The
     achievements wall gets a slow low push-in; the profile two quick cuts of the camera swivelling round it while its
     theme and colour swatches cycle; the chat a sideways tracking shot as messages arrive; the friends list a crane
     down, with the game invite sliding in beside the list (not into the lens). */
  function panelFrame(it) {
    var a = it.ry * D2R;
    return { c: { x: it.x, y: it.y, z: it.z }, n: { x: Math.sin(a), y: 0, z: Math.cos(a) }, tg: { x: Math.cos(a), y: 0, z: -Math.sin(a) } };
  }
  function orbitCam(it, az, dist, h, fov, roll, aim) {
    var F = panelFrame(it), a = az * D2R, nx = F.n.x * Math.cos(a) + F.tg.x * Math.sin(a), nz = F.n.z * Math.cos(a) + F.tg.z * Math.sin(a);
    var c = Cine.cam; c.x = F.c.x + nx * dist; c.y = F.c.y + h; c.z = F.c.z + nz * dist; c.fov = fov; c.roll = roll || 0;
    var o = aim || 0; lookAt(F.c.x + F.tg.x * o, F.c.y, F.c.z + F.tg.z * o);
  }
  function chessSocial(S, id, t) {
    var t0 = shotStart(S[id].cue), t1 = shotStart(id === 'friends' ? S.modes.cue : S[{ achievements: 'profile', profile: 'chat', chat: 'friends' }[id]].cue);
    var q = clamp01((t - t0) / (t1 - t0)), e = smooth(q);
    S.achWall.x = 0; S.achWall.ry = 14; S.profPanel.x = 300;
    if (id === 'achievements') orbitCam(S.achWall, lerp(-10, 4, e), lerp(1650, 1200, e), lerp(160, 60, e), 54, lerp(-2, 0, e));
    else if (id === 'profile') {
      if (q < 0.5) { var a = q / 0.5; orbitCam(S.profPanel, lerp(-42, -10, smooth(a)), 1050, -60, 52, 3, -120); }
      else { var b = (q - 0.5) / 0.5; orbitCam(S.profPanel, lerp(34, 12, smooth(b)), 820, 90, 50, -4, 160); }
      if (Math.abs(q - 0.5) < 0.02) Cine.tear = Math.max(Cine.tear, 0.5);   // a VHS kick on the cut
    }
    else if (id === 'chat') {
      var F = panelFrame(S.chatPanel), off = lerp(-560, 480, e), c = Cine.cam;
      c.x = F.c.x + F.n.x * 1080 + F.tg.x * off; c.y = F.c.y - 40; c.z = F.c.z + F.n.z * 1080 + F.tg.z * off; c.fov = 52; c.roll = -2;
      lookAt(F.c.x + F.tg.x * off * 0.35, F.c.y, F.c.z + F.tg.z * off * 0.35);
    }
    else {
      orbitCam(S.friendsPanel, lerp(-14, -4, e), lerp(1250, 1050, e), lerp(-650, -90, easeOut(q)), 54, 0, 260);
      var G = panelFrame(S.friendsPanel), inK = easeOut(span(q, 0.45, 0.75));
      S.invite.op = inK; S.invite.s = 0.62;
      S.invite.x = G.c.x + G.tg.x * lerp(1500, 760, inK) + G.n.x * 60; S.invite.y = G.c.y + 120; S.invite.z = G.c.z + G.tg.z * lerp(1500, 760, inK) + G.n.z * 60;
      S.invite.ry = S.friendsPanel.ry; S.invite.rz = (1 - inK) * 8;
    }
    if (id !== 'friends') S.invite.op = 0;
  }
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
      var u = socialU(S, t); chessSocial(S, 'profile', t);
      var beat = Math.floor(beatAt(t));
      S.profThemes.forEach(function (c, i) { c.classList.toggle('on', i === beat % S.profThemes.length); });
      S.profSw.forEach(function (c, i) { c.classList.toggle('on', i === (beat * 3) % S.profSw.length); });
      S.profBar.style.width = (40 + 50 * smooth(span(u, 0.32, 0.5))) + '%';
    } };
    S.chat = { pat: 0, update: function (t) {
      var u = socialU(S, t); chessSocial(S, 'chat', t);
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
      var u = socialU(S, t); chessSocial(S, 'friends', t);
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
    // CRT warm-up: a squashed line opening out as it brightens (a ramp, not flickers: photosensitivity)
    var on = lt < 0 ? 0 : smooth(span(lt, 0, 0.3));
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
    L.sub.style.fontSize = Math.max(11, w * 0.028) + 'px';   // (Battleships' tagline is long)
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
    c.classList.add('show', 'hold');   // held about two seconds (tetris-cinematic.css)
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
    Cine.vhs = Math.max(0, (Cine.vhs || 0) - dt * 1.4);

    Cine.env = 1; Cine.speed = 0; Cine.streaks = 0; Cine.variant = 0; Cine.eye = CAB_EYE; Cine.timeScale = 1;
    shot.update(t, lt, u, dt);
    // hit-stop: on a big impact the camera holds still for a beat (Cine.hitStop seconds) while the effects play on
    if (Cine.hitStop > 0) { if (!Cine.camHeld) Cine.camHeld = Object.assign({}, Cine.cam); else Object.assign(Cine.cam, Cine.camHeld); Cine.hitStop -= dt; }
    else Cine.camHeld = null;

    var view = applyCamera();
    layoutGroup(shot.group, view);
    boardFlashes(shot.group);
    Bg.draw({ time: t, pat: shot.pat, level: Cine.level, beat: Cine.beat, flash: Math.min(0.12, Cine.flash * 0.4), env: Cine.env, tear: Cine.tear,
      speed: Cine.speed, variant: Cine.variant, P: view.P, cam: Cine.cam, dist: Cine.dist, eye: Cine.eye, crt: Cine.crt });
    drawFx(dt, t);
    drawChessPetals(dt);
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
    Rig.on = false; Cine.timeScale = 1; Cine.fovKick = 0; Cine.petals = [];
    document.documentElement.classList.add('cine-open');
    if (window.ChessMenuMusic) window.ChessMenuMusic.hold(true);
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
    if (window.ChessMenuMusic) { window.ChessMenuMusic.hold(false); window.ChessMenuMusic.startNow(skipped ? 1.2 : 1.5); }
    if (G.Sound && Cine.beepWas) G.Sound.beep = Cine.beepWas;
    document.removeEventListener('keydown', onKey, true);
    var root = Cine.root;
    root.classList.add(skipped ? 'closing' : 'closed');
    setTimeout(function () { root.remove(); }, skipped ? 450 : 50);
    document.documentElement.classList.remove('cine-open');
    Cine.groups = {}; Cine.shots = null; Cine.bolts = []; Cine.sparks = []; Cine.frags = []; Cine.flames = []; Cine.rings = []; Cine.transits = [];
    Cine.glass = []; Cine.crack = null; Cine.petals = []; Rig.on = false;
    var btn = document.getElementById('chessCinematicBtn');
    if (btn && skipped) btn.focus({ preventScroll: true });
  }

  function init() {
    var btn = document.getElementById('chessCinematicBtn');
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
    // First visit only (players who have been before but never saw it get it too, and first-timers arriving on an
    // invite link), and not for people who asked for less motion.
    if (G.Store.get(STORE_SEEN, 0) || reduced) return;
    play(0);
  }

  window.ChessCinematic = { play: play, skip: function () { finish(true); }, playing: function () { return Cine.running; }, CUES: CUES };
  if (/[?&]cinematic\b/.test(location.search)) window.ChessCinematic.propArt = function (k) { delete PROP_CACHE[k]; return propArt(k); };   // testing aid: a prop's sprite
  if (/[?&]cinematic\b/.test(location.search)) window.ChessCinematic.state = function () { Cine.bgDraw = Bg; Cine.audio = Audio; return Cine; };   // testing aid
  // testing aid: run the film's frames by hand (silently) up to `to` seconds at `fps`, then hold there
  if (/[?&]cinematic\b/.test(location.search)) window.ChessCinematic.step = function (to, fps) {
    if (!Cine.running) return;
    setSound(false); Cine.hold = null;
    var now = Cine.lastNow;
    while (Cine.running && Cine.t < to) { now += 1000 / (fps || 60); frame(now); cancelAnimationFrame(Cine.raf); }
    Cine.hold = to; Cine.raf = requestAnimationFrame(frame);
  };
  init();
})();
