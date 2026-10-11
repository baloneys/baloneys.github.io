// battleships-cinematic.js: the Battleships opening cinematic (60 seconds), rendered live in the page.
//
// The naval-command film (first cut by ChatGPT: radar, classified dossier, missiles, a sinking warship), rebuilt on
// the Tetris and Pong openings' engine so it moves and looks like them: one CSS-3D camera flying through a night
// ocean (a ray-cast background shader), the real game's grids as planes in that space, the same VHS layer, buttons,
// pixel logo and hand-over to the live menu.
//
// The shots (times from the track's cue points, Balcade_Battleships_60s_Cinematic_Master.mp3):
//   0  radar: the camera dives from high above onto a radar scope lying on the dark water; contacts appear
//   7  a classified dossier floats over the sea; CLASSIFIED stamps down; the logo flickers on as the world goes dark
//  12  the drop: the camera rushes down onto your fleet grid and glides across it as the ships deploy
//  19  it rises and turns to the enemy grid across the water; the search locks on
//  25  a missile streaks in and misses (a column of water); 29 the next one is a direct hit (fire)
//  34  a flyby through the enemy sectors, missiles overtaking the camera to their targets
//  40  the enemy warship on the open sea: three hits, and it sinks
//  46  achievements, profile, chat and friends; then the real mode menu and skulls page
//  52  the final salvo between two fleets, the camera circling the duel; FLEET DESTROYED; the boards shatter
//  58  the logo flies into the page title and the live menu takes over (the menu loop is cued on the same clock)
//
// Music: "Shadow" by William Hector (CC BY 4.0), edited, with original synthesised radar, radio, missile and
// explosion effects (Balcade_Battleships_Audio_Credits.txt). Playback: once per browser
// (games_bs_cinematic_seen), then from the menu's "Watch cinematic" button. Testing aids: ?cinematic=SECONDS plays
// from there; &hold=SECONDS freezes the clock; BattleshipsCinematic.step(t) runs frames by hand to time t.
(function () {
  'use strict';

  var G = window.Games;
  var App = window.BattleshipsApp;
  if (!G || !App || !App.cinematicKit) return;
  var KIT = App.cinematicKit();
  var ACH = window.BattleshipsAchievements;
  var STORE_SEEN = 'bs_cinematic_seen';
  var D2R = Math.PI / 180;

  /* =================================================================
     Cue sheet
     ================================================================= */

  var CUES = {
    track: 'Balcade_Battleships_60s_Cinematic_Master.mp3',
    credit: 'Music: "Shadow" by William Hector (CC BY 4.0), edited',
    trackHasSfx: true,
    bpm: 120,
    offset: 12.0,        // the drop
    end: 60,
    volume: 0.85,
    sfx: 0.5,
    segments: [{ t0: 0, t1: 60, at: 0 }],
    duck: [],
    spark: [1000, 1001],
    shots: [
      { id: 'radar', at: 0 },
      { id: 'dossier', at: 7.0, group: 'radar' },
      { id: 'deploy', at: 12.0 },
      { id: 'acquire', at: 19.0, group: 'deploy' },
      { id: 'miss', at: 25.0, group: 'deploy' },
      { id: 'hit', at: 29.0, group: 'deploy' },
      { id: 'hunt', at: 34.0 },
      { id: 'sunk', at: 40.0 },
      { id: 'achievements', at: 46.0, nominal: 1.6 },
      { id: 'profile', at: 47.2, group: 'achievements', nominal: 1.372 },
      { id: 'chat', at: 48.2, group: 'achievements', nominal: 2.743 },
      { id: 'friends', at: 49.2, group: 'achievements', nominal: 2.743 },
      { id: 'modes', at: 50.2, nominal: 2.0 },
      { id: 'skulls', at: 51.1, group: 'modes', nominal: 2.0 },
      { id: 'final', at: 52.0 },
      { id: 'menu', at: 58.0, group: 'final' }
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
    '  else if (u_pat<3.5) c=warehouse(vec2(css.x-0.5*u_css.x, 0.5*u_css.y-css.y)/u_css.y);\n  else c=ocean(dir);',
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
      var shared = window.BattleshipsMenuMusic && window.BattleshipsMenuMusic.context();
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
        if (window.BattleshipsMenuMusic && t < CUES.end) window.BattleshipsMenuMusic.cue(now + (CUES.end - t));
      }
      return ctx.state === 'running';
    },

    stopSources: function () {
      this.sources.forEach(function (s) { try { s.stop(); } catch (e) { /* already stopped */ } });
      this.sources = [];
    },

    stop: function (fade, keepCue) {
      this.on = false;
      if (!keepCue && window.BattleshipsMenuMusic) window.BattleshipsMenuMusic.cancelCue();
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
    timeScale: 1, fovKick: 0, look: { x: 0, y: 0, z: -1 }, missiles: [], splashes: [], fires: [], hud: null,
    soundWanted: true, beepWas: null, ending: false,

    needSound: function () { if (this.hint) this.hint.classList.remove('hidden'); }
  };

  function buildStage() {
    var root = el('div', 'cine');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Battleships opening cinematic');
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
    sub.textContent = tag ? tag.textContent.trim() : 'sink the enemy fleet';
    paintLogo(lc);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { paintLogo(lc); });
    Cine.logo = { box: logo, art: lc, sub: sub };
    Cine.barTop = el('div', 'bsx-bar top', root); Cine.barBot = el('div', 'bsx-bar bottom', root);   // the 32:9 letterbox (bars())
    Cine.caption = el('div', 'cine-caption', root);
    Cine.vhsEl = el('div', 'cine-vhs', root);
    Cine.hud = el('div', 'bsx-hud', root); el('b', '', Cine.hud); el('small', '', Cine.hud);   // the naval HUD (hud())
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
    x.fillStyle = '#28e8ff'; x.fillText('battleships', w / 2 - 2, h / 2 + 1);
    x.fillStyle = '#ff2fa6'; x.fillText('battleships', w / 2 + 1, h / 2);
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

  // A grid: the game's own markup and paint functions (BattleshipsApp.cinematicKit), sized exactly by
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
            Cine.shake = Math.max(Cine.shake, 0.9); Cine.flash = Math.max(Cine.flash, 0.22); Cine.aberration = 1; Cine.fovKick = -8; Cine.hitStop = 0.12; }
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

  function makeShots() {
    var S = { done: {} }, me = (G.Profile && G.Profile.get()) || { name: 'Player' };

    /* ---------- 0 to 12: the radar in the dark, the dossier, the logo ---------- */

    S.radar = { pat: 4, build: function (g) {
      S.R = radarPlane(g, { x: 0, y: -20, z: 0, rx: 90, s: 1.8, cull: false });
      S.D = dossierPlane(g, { x: 0, y: -560, z: -1500, s: 1.3, cull: false });
    }, enter: function () { S.done = {}; S.D.stamp.classList.remove('slam'); S.D.op = 1; S.R.op = 1; }, update: function (t, lt) {
      paintRadar(S.R, t);
      path([
        { t: 0, x: 0, y: -3400, z: 300, tx: 0, ty: 0, tz: 0, fov: 46, roll: 0 },
        { t: 4.5, x: 260, y: -1500, z: 900, tx: 0, ty: 0, tz: -100, fov: 52, roll: -6 },
        { t: 7, x: -200, y: -700, z: 1500, tx: 0, ty: -400, tz: -1200, fov: 56, roll: -2 }
      ], lt);
      Cine.env = smooth(span(lt, 0, 1.6));
      // each contact pings in with a flicker of the tape
      CONTACTS.forEach(function (c, i) { once(S, 'ping' + i, t, c[2], function () {
        var p = projectP(toWorld(S.R, 450 + c[0] * 440, 450 + c[1] * 440)); if (p) { ring(p, 160); burst(p.x, p.y, 14, [160, 190], 0.4); }
        Cine.tear = Math.max(Cine.tear, i ? 0.4 : 0.8); }); });
      hud('RADAR CONTACT', 'SCAN ' + String(Math.floor(t * 12)).padStart(3, '0') + ' · CONTACTS ' + (t < 4.2 ? '00' : t < 6 ? '01' : '05'));
    } };
    S.dossier = { pat: 4, update: function (t, lt) {
      paintRadar(S.R, t);
      path([
        { t: 0, x: -200, y: -700, z: 1500, tx: 0, ty: -400, tz: -1200, fov: 56, roll: -2 },
        { t: 2.2, x: -560, y: -600, z: -250, tx: 0, ty: -560, tz: -1500, fov: 50, roll: 3 },
        { t: 5, x: -60, y: -560, z: -150, tx: 0, ty: -560, tz: -1500, fov: 44, roll: 0 }
      ], lt);
      once(S, 'stamp', t, 9.0, function () { S.D.stamp.classList.add('slam'); Cine.shake = Math.max(Cine.shake, 0.6); Cine.flash = Math.max(Cine.flash, 0.18); Cine.aberration = 1; });
      // the world goes dark around the logo, then black for the drop
      Cine.env = 1 - 0.85 * smooth(span(lt, 3.0, 4.0)) - 0.15 * smooth(span(lt, 4.6, 4.95));
      S.D.op = Cine.env; S.R.op = Cine.env;   // the planes go dark with the world
      if (lt >= 3.3) logoCentre(lt - 3.3, lt - 3.9, 1 - smooth(span(lt, 4.55, 4.95))); else hideLogo();
      hud(lt < 3.2 ? 'CLASSIFIED INTELLIGENCE' : '', 'NAVAL INTELLIGENCE // SECTOR 07');
    }, exit: function () { hideLogo(); } };

    /* ---------- 12 to 34: your fleet, the enemy grid, the miss and the hit ---------- */

    S.deploy = { pat: 4, build: function (g) {
      S.Fb = boardPlane(g, 'YOUR FLEET', { x: 0, y: -14, z: 0, rx: 90, s: 1.5, cull: false });
      S.Eb = boardPlane(g, 'ENEMY WATERS', { x: 0, y: -760, z: -3000, s: 1.7, cull: false, enemy: true });
      S.Eb.enemy = true;
      addFleetSprites(S.Fb);
    }, enter: function () { S.Eb.marks = {}; paintBoard(S.Eb); KIT.fleetBoard(S.Fb.grid, FLEET, 0); showFleet(S.Fb, 0); S.shown = 0; S.Eb.fire = []; }, update: function (t, lt, u, dt) {
      var count = clamp01((t - 12) / 6) * 5.4 | 0;
      if (count > 5) count = 5;
      if (count !== S.shown) {
        S.shown = count; KIT.fleetBoard(S.Fb.grid, FLEET, count); showFleet(S.Fb, count); S.Fb.flashAt = Cine.t;
        var f = FLEET[count - 1]; if (f) { var m = shipMid(f); splash(cellWorld(S.Fb, m[0], m[1]), 0.8); Cine.shake = Math.max(Cine.shake, 0.25); }
      }
      path([
        { t: 0, x: 0, y: -2600, z: 2200, tx: 0, ty: 0, tz: 0, fov: 70, roll: 0 },
        { t: 0.8, x: -420, y: -330, z: 760, tx: -60, ty: 0, tz: 100, fov: 62, roll: -8, e: easeOut },
        { t: 7, x: 420, y: -360, z: 420, tx: 80, ty: 0, tz: -260, fov: 56, roll: 4 }
      ], lt);
      kick(dt);
      Cine.speed = 1 - smooth(span(lt, 0.2, 1.0)); Cine.streaks = Cine.speed;
      hud('DEPLOYING THE FLEET', 'SHIPS ' + count + ' / 5 · SIGNAL ENCRYPTED');
    } };
    var SEARCH = [[0, 2], [2, 6], [7, 3], [5, 8], [3, 1], [4, 1]];
    S.acquire = { pat: 4, update: function (t, lt, u, dt) {
      var lock = SEARCH[Math.min(5, Math.floor((t - 19) * 1.35))];
      if (S.lockKey !== lock.join()) { S.lockKey = lock.join(); paintBoard(S.Eb, lock); }
      path([
        { t: 0, x: 420, y: -360, z: 420, tx: 80, ty: 0, tz: -260, fov: 56, roll: 4 },
        { t: 1.8, x: 0, y: -640, z: 600, tx: 0, ty: -760, tz: -3000, fov: 50, roll: 0 },
        { t: 6, x: 120, y: -720, z: -1100, tx: 0, ty: -760, tz: -3000, fov: 44, roll: -1 }
      ], lt);
      kick(dt);
      hud('TARGET ACQUISITION', 'TARGET SEARCH · ' + String(Math.floor((t - 19) * 17)).padStart(3, '0') + '°');
    } };
    S.miss = { pat: 4, enter: function () { S.done.missile1 = false; }, update: function (t, lt, u, dt) {
      once(S, 'missile1', t, 25.25, function () {
        var hitAt = cellWorld(S.Eb, 4, 1);
        missile({ x: -1000, y: -260, z: -1250 }, hitAt, 25.25, 0.65, 'miss', function () {
          S.Eb.marks['4,1'] = 'miss'; paintBoard(S.Eb, [4, 1]); S.Eb.flashAt = Cine.t; caption('MISS', 'GRID E-2 · WATER');
        }, 320);
      });
      path([
        { t: 0, x: 120, y: -720, z: -1100, tx: 0, ty: -760, tz: -3000, fov: 44 },
        { t: 0.9, x: -220, y: -620, z: -1500, tx: -120, ty: -560, tz: -2900, fov: 46, roll: -3 },
        { t: 4, x: -60, y: -700, z: -1800, tx: 0, ty: -700, tz: -3000, fov: 42, roll: 0 }
      ], lt);
      kick(dt);
      hud('MISSED SHOT', 'RELOADING · TUBE 2');
    } };
    S.hit = { pat: 4, update: function (t, lt, u, dt) {
      once(S, 'missile2', t, 29.7, function () {
        missile({ x: 900, y: -340, z: -1350 }, function () { return cellWorld(S.Eb, 4, 4); }, 29.7, 0.6, 'hit', function () {
          S.Eb.marks['4,4'] = 'hit'; paintBoard(S.Eb); S.Eb.flashAt = Cine.t; S.Eb.fire = [cellWorld(S.Eb, 4, 4)]; caption('DIRECT HIT', 'GRID E-5 · BATTLESHIP');
        }, 260);
      });
      path([
        { t: 0, x: -60, y: -700, z: -1800, tx: 0, ty: -700, tz: -3000, fov: 42 },
        { t: 1.5, x: 60, y: -740, z: -1650, tx: 0, ty: -740, tz: -3000, fov: 44, roll: 2 },
        { t: 5, x: -1300, y: -1100, z: 900, tx: 0, ty: -380, tz: -1500, fov: 58, roll: -4 }
      ], lt);
      kick(dt);
      burning(S.Eb, S.Eb.fire || []);
      hud('DIRECT HIT', 'FLEET LINK ACTIVE · SIGNAL ENCRYPTED');
    } };

    /* ---------- 34 to 40: a flyby through the enemy sectors ---------- */

    var SECTORS = [[-900, -620, -1600, 24, -4, 'ALPHA'], [950, -820, -3300, -22, 5, 'BRAVO'], [-1000, -560, -5000, 28, 3, 'CHARLIE'],
      [900, -900, -6800, -26, -6, 'DELTA'], [0, -700, -8800, 0, 0, 'ECHO']];
    var SALVO = [[34.35, 0, 3, 6, 'hit'], [35.0, 1, 1, 7, 'miss'], [35.7, 1, 4, 5, 'hit'], [36.6, 2, 6, 2, 'hit'], [37.6, 3, 2, 8, 'hit'], [38.6, 4, 4, 6, 'hit']];
    S.hunt = { pat: 4, build: function (g) {
      S.sec = SECTORS.map(function (s, i) {
        var it = boardPlane(g, 'SECTOR / ' + s[5], { x: s[0], y: s[1], z: s[2], ry: s[3], rz: s[4], s: 1.2, enemy: true });
        it.enemy = true; return it;
      });
    }, enter: function () {
      S.sec.forEach(function (it, i) { it.marks = {}; if (i % 2) it.marks['6,3'] = 'miss'; it.marks['8,8'] = 'miss'; paintBoard(it); it.fire = []; });
    }, update: function (t, lt, u, dt) {
      path([
        { t: 0, x: 0, y: -560, z: 900, tx: 0, ty: -650, tz: -3000, fov: 58 },
        { t: 6, x: 150, y: -760, z: -6200, tx: 0, ty: -700, tz: -10000, fov: 74 }
      ], lt);
      Cine.cam.roll = Math.sin(lt * 0.9) * 6;
      kick(dt);
      // missiles overtake the camera to their targets
      SALVO.forEach(function (m, i) { once(S, 'salvo' + i, t, m[0] - 0.75, function () {
        var it = S.sec[m[1]], c = Cine.cam, cell = cellWorld(it, m[2], m[3]);
        var to = m[4] === 'miss' ? { x: cell.x, y: -4, z: it.z + 220 } : cell;
        missile({ x: c.x + (i % 2 ? 260 : -260), y: c.y + 140, z: c.z - 120 }, to, m[0] - 0.75, 0.75, m[4], function () {
          it.marks[m[2] + ',' + m[3]] = m[4]; paintBoard(it); it.flashAt = Cine.t; if (m[4] === 'hit') it.fire.push(cell);
        }, 160);
      }); });
      S.sec.forEach(function (it) { if (it.visible) burning(it, it.fire); });
      Cine.speed = 0.35 + u * 0.4; Cine.streaks = 0.3 + u * 0.5;
      hud('HUNTING THE FLEET', 'SECTORS 05 · TARGETS LOCKED');
    } };

    /* ---------- 40 to 46: the warship, three hits, and it sinks ---------- */

    var HULL = [[40.8, -0.5, 0.4], [42.4, 0.05, -0.6], [44.0, 0.55, 0.3]];
    var SHIP_Y = -(SHIP_WL * 3 - 105) * 3.6;   // the plane's centre, so the sprite's waterline sits on the sea (y = 0)
    S.sunk = { pat: 4, build: function (g) {
      S.Sh = shipPlane(g, { x: 0, y: SHIP_Y, z: -1800, ry: -12, s: 3.6, cull: false });
    }, enter: function () { S.Sh.y = SHIP_Y; S.Sh.rz = 0; S.Sh.op = 1; S.Sh.fire = []; S.Sh.el.style.clipPath = ''; }, update: function (t, lt, u, dt) {
      var Sh = S.Sh;
      HULL.forEach(function (h, i) { once(S, 'hull' + i, t, h[0] - 0.6, function () {
        missile({ x: -900 + i * 300, y: -900, z: 400 }, function () { return shipPoint(Sh, h[1], h[2]); }, h[0] - 0.6, 0.6, 'hit', function () {
          Sh.fire.push(function () { return shipPoint(Sh, h[1], h[2]); }); Cine.tear = Math.max(Cine.tear, 0.6);
        }, 380);
      }); });
      // the sinking: down by the bow, under the waterline (clipped there), the sea closing over it
      var k = easeIn(span(t, 44.1, 46));
      Sh.y = SHIP_Y + k * 640; Sh.rz = 13 * k; Sh.op = 1 - smooth(span(t, 45.3, 46));
      // once it starts going down, only what's still above the water shows (the reflection goes with it)
      var drop = Sh.y - SHIP_Y, above = SHIP_WL * 3 - drop / 3.6;
      Sh.el.style.clipPath = drop > 0.5 ? 'inset(0 0 ' + clamp01((210 - above) / 210 * 1) * 100 + '% 0)' : '';
      once(S, 'sink1', t, 44.3, function () { splash({ x: Sh.x - 200, y: -4, z: Sh.z + 120 }, 2.2); Cine.shake = Math.max(Cine.shake, 0.8); });
      once(S, 'sink2', t, 45.0, function () { splash({ x: Sh.x + 250, y: -4, z: Sh.z + 80 }, 1.8); });
      once(S, 'sunkCap', t, 45.05, function () { caption('SUNK', 'ENEMY BATTLESHIP'); Cine.flash = Math.max(Cine.flash, 0.3); Cine.hitStop = 0.16; Cine.shake = Math.max(Cine.shake, 0.8); Cine.fovKick = -10; });
      if (Sh.op > 0.2) burning(Sh, Sh.fire.filter(function (f) { var w = f(); return w.y < -10; }));
      path([
        { t: 0, x: -1500, y: -560, z: 100, tx: 0, ty: -300, tz: -1800, fov: 50, roll: -3 },
        { t: 6, x: 1200, y: -420, z: -650, tx: 0, ty: -220, tz: -1800, fov: 48, roll: 3 }
      ], lt);
      kick(dt);
      hud(t < 44.9 ? 'MULTIPLE IMPACTS' : 'ENEMY SHIP SUNK', 'OPERATION STATUS · LIVE');
    } };

    /* ---------- 46 to 52: achievements, profile, chat, friends, then the real modes and skulls ---------- */

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
      S.achWall = plane(g, wall, 1900, 760, { x: 0, y: 0, z: 0, ry: 14, rx: 6, cull: false });
      buildSocial(g, S, me);
      bsSocialLayout(S);
    }, enter: function () { bsSocialReset(S); hud(''); },
    update: function (t, lt) {
      bsSocialCam(S, t);
      var n = S.achItems.length, on = Math.min(n, Math.floor(n * (0.6 + lt * 0.4)));
      S.achItems.forEach(function (it, i) { it.classList.toggle('on', i < on); it.classList.toggle('pop', i === on - 1); });
      S.achCount.textContent = Math.min(n, on) + ' / ' + n + ' unlocked';
      bsSocialPanels(S, t);
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

    /* ---------- 52 to 58: the final salvo between two fleets, then everything breaks apart ---------- */

    var FINAL = [[52.7, 'F', 3, 3], [53.7, 'E', 2, 5], [54.9, 'F', 6, 7], [56.1, 'E', 7, 2], [57.2, 'F', 4, 4]];
    S.final = { pat: 4, build: function (g) {
      S.F2 = boardPlane(g, 'YOUR FLEET', { x: -950, y: -560, z: -200, ry: 32, s: 1.3, cull: false });
      S.E2 = boardPlane(g, 'ENEMY FLEET', { x: 950, y: -560, z: -900, ry: -32, s: 1.3, cull: false, enemy: true });
      S.E2.enemy = true;
      addFleetSprites(S.F2);
    }, enter: function () {
      showFleet(S.F2, 5);
      [S.F2, S.E2].forEach(function (it) { it.marks = { '1,1': 'miss', '5,8': 'miss', '8,4': 'hit' }; it.fire = []; it.hidden = false; paintBoard(it); });
      KIT.fleetBoard(S.F2.grid, FLEET, 5);
      S.blasted = false;
    }, update: function (t, lt, u, dt) {
      FINAL.forEach(function (m, i) { once(S, 'final' + i, t, m[0] - 0.55, function () {
        var src = m[1] === 'F' ? S.F2 : S.E2, dst = m[1] === 'F' ? S.E2 : S.F2, cell = cellWorld(dst, m[2], m[3]);
        missile(cellWorld(src, 5, 5), cell, m[0] - 0.55, 0.55, 'hit', function () {
          dst.marks[m[2] + ',' + m[3]] = 'hit'; paintBoard(dst); dst.flashAt = Cine.t; dst.fire.push(cell);
        }, 420);
      }); });
      once(S, 'destroyed', t, 56.7, function () { caption('FLEET DESTROYED', 'FINAL NAVAL ASSAULT'); });
      var C = { x: 0, y: -560, z: -550 }, a = lerp(-0.55, 0.6, smooth(span(lt, 0, 5.8))), R = 2100 - 300 * u;
      var pos = { x: Math.sin(a) * R, y: -760 + Math.sin(lt * 0.8) * 80, z: C.z + Math.cos(a) * R };
      if (t >= 57.45 && !S.blasted) {
        S.blasted = true; S.blastAt = t; S.blastFrom = pos;
        Cine.flash = 1; Cine.shake = 1.5; Cine.aberration = 1.4;
        [S.F2, S.E2].forEach(function (it) { boardRaster(it); shatterGlass(it, centreOf(it), { x: 0, y: -200, z: 600 }); });
      }
      var c = Cine.cam;
      if (S.blasted) {   // pull back to where the menu shot takes over
        var k = easeOut(span(t, S.blastAt, 58.0)), end = { x: 0, y: 0, z: 9000 };
        var p = mix3(S.blastFrom, end, k);
        c.x = p.x; c.y = p.y; c.z = p.z; c.roll = 0; c.fov = lerp(58, 40, k);
        var L = mix3(C, { x: 0, y: 0, z: -2000 }, k); lookAt(L.x, L.y, L.z);
      } else {
        c.x = pos.x; c.y = pos.y; c.z = pos.z; c.roll = Math.sin(lt * 1.1) * 4; c.fov = 58 + u * 6;
        lookAt(C.x, C.y, C.z);
        kick(dt);
      }
      [S.F2, S.E2].forEach(function (it) { if (!it.hidden) burning(it, it.fire); });
      Cine.speed = S.blasted ? 0 : 0.25;
      hud(S.blasted ? '' : 'FINAL NAVAL ASSAULT', 'OPERATION STATUS · LIVE');
    } };

    S.menu = { pat: 4, update: function (t, lt) {
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
    Cine.S = S;   // (for the ?cinematic testing aid)
    return shots;
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

    var chat = panel('cine-chat', 'CHAT · #battleships');
    S.chatList = el('div', 'cine-chat-list', chat);
    S.chatMsgs = [['Lunar', 'that salvo was unreal'], ['Blocky', 'gg'], [me.name, 'rematch??'], ['Gridlock', 'five ships in five shots??'], ['Tess', 'invite me next round'], [me.name, 'lobby up, join me']];
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
    el('div', 'cine-prof-lvl', iw).textContent = 'invited you to Battleships · salvo rules';
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
  /* Battleships' social run: the four panels stand one behind another on a straight line, already up, and the camera
     dollies straight down it at a steady speed. A missile streaks in from off screen and blows each panel apart just
     before the camera would reach it, so the camera flies on through the debris to the next one (the last panel, the
     friends list, is where the run ends). */
  var BS_LINE = [0, -1400, -2800, -4200], BS_CAM0 = 1000, BS_CAM1 = -3450;
  function bsPanels(S) { return [S.achWall, S.profPanel, S.chatPanel, S.friendsPanel]; }
  function bsSocialLayout(S) {
    bsPanels(S).forEach(function (it, i) {
      it.x = (i % 2 ? 1 : -1) * 60; it.y = i === 0 ? -20 : 0; it.z = BS_LINE[i]; it.ry = (i % 2 ? -1 : 1) * 4; it.rx = 0; it.home = { x: it.x, y: it.y, z: it.z, ry: it.ry };
      it.canvas = panelRaster(it, ['ACHIEVEMENTS', 'PROFILE', 'CHAT', 'FRIENDS'][i]); it.head = 0;
    });
    S.invite.hidden = true;
  }
  function bsHits(S) {   // when the camera would reach panels 0-2, less a beat for the missile (worked out once)
    if (S.bsHits) return S.bsHits;
    var span0 = shotStart(S.achievements.cue), span1 = shotStart(S.modes.cue);
    return (S.bsHits = [0, 1, 2].map(function (i) {
      var k = (BS_CAM0 - BS_LINE[i]) / (BS_CAM0 - BS_CAM1);
      return { i: i, t: span0 + (span1 - span0) * camInv(k) - 0.55 };
    }));
  }
  // the dolly: a steady glide, easing in from the shot before (cam progress k at time fraction q, and back)
  function camK(q) { return q < 0.15 ? q * q / 0.3 : q - 0.075; }
  function camInv(k) { var q = 0, a = 0, b = 1; for (var n = 0; n < 30; n++) { q = (a + b) / 2; if (camK(q) / camK(1) < k) a = q; else b = q; } return q; }
  function bsSocialCam(S, t) {
    var span0 = shotStart(S.achievements.cue), span1 = shotStart(S.modes.cue), q = clamp01((t - span0) / (span1 - span0)), k = camK(q) / camK(1);
    var c = Cine.cam;
    c.x = Math.sin(q * 5) * 40; c.y = -60 + Math.sin(q * 3.4) * 20; c.z = lerp(BS_CAM0, BS_CAM1, k); c.fov = 56; c.roll = Math.sin(q * 4) * 1.5;
    lookAt(c.x * 0.3, -20, c.z - 2000);
  }
  function bsSocialReset(S) {
    bsPanels(S).forEach(function (it) { var h = it.home; if (!h) return; it.hidden = false; it.op = 1; it.x = h.x; it.y = h.y; it.z = h.z; it.ry = h.ry; it.blown = false; });
    S.invite.op = 0;
  }
  function bsSocialPanels(S, t) {
    S.invite.op = 0;
    bsHits(S).forEach(function (h) {
      var it = bsPanels(S)[h.i];
      if (it.blown) return;
      if (t >= h.t + 0.4) { it.blown = true; it.hidden = true; return; }   // (started past it)
      // the missile comes in from high on one side, out of frame until its last few hundred units
      var m0 = h.t - 0.42, side = h.i % 2 ? 1 : -1;
      once(S, 'bsm' + h.i, t, m0, function () {
        var hit = { x: it.x, y: it.y, z: it.z }, from = { x: side * 1900, y: -1100, z: it.z + 900 };
        missile(from, hit, m0, 0.42, 'hit', function () {
          it.blown = true;
          shatterGlass(it, hit, { x: side * -700, y: -300, z: -2200 });
          var p = projectP(hit); if (p) { ring(p, 520 * Math.min(2, p.s)); burst(p.x, p.y, 60, [20, 35, 320, 190], 1.1); }
          Cine.shake = Math.max(Cine.shake, 0.6); Cine.fovKick = -6; Cine.hitStop = 0.06;
        }, 120);
      });
    });
  }
  // a quick picture of a social panel, for its shards: the card, its border and its title
  function panelRaster(it, title) {
    var w = 240, h = Math.max(60, Math.round(240 * it.h / it.w)), cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var x = cv.getContext('2d');
    x.fillStyle = 'rgba(18,8,40,0.94)'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#c77dff'; x.lineWidth = 3; x.strokeRect(2, 2, w - 4, h - 4);
    x.fillStyle = '#f2e6ff'; x.font = 'bold 16px "JetBrains Mono", monospace'; x.fillText(title, 14, 28);
    x.fillStyle = 'rgba(199,125,255,0.35)';
    for (var i = 0; i < 5; i++) x.fillRect(14, 44 + i * Math.max(8, (h - 60) / 5), w * (0.4 + 0.1 * (i % 3)), 4);
    return cv;
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
      var u = socialU(S, t); bsSocialCam(S, t); bsSocialPanels(S, t);
      var beat = Math.floor(beatAt(t));
      S.profThemes.forEach(function (c, i) { c.classList.toggle('on', i === beat % S.profThemes.length); });
      S.profSw.forEach(function (c, i) { c.classList.toggle('on', i === (beat * 3) % S.profSw.length); });
      S.profBar.style.width = (40 + 50 * smooth(span(u, 0.32, 0.5))) + '%';
    } };
    S.chat = { pat: 0, update: function (t) {
      var u = socialU(S, t); bsSocialCam(S, t); bsSocialPanels(S, t);
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
      var u = socialU(S, t); bsSocialCam(S, t); bsSocialPanels(S, t);
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

  // The letterbox, the bars sliding in at the start and away for the hand-over to the menu: a 32:9 band on a desktop
  // screen, 21:9 on a phone (portrait or landscape) or any narrow screen.
  function bandHeight() {
    var vw = innerWidth, vh = innerHeight, phone = vh > vw || vw < 900 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    return Math.min(vh, vw * 9 / (phone ? 21 : 32));
  }
  function bars(t) {
    var k = smooth(span(t, 0.1, 1.0)) * (1 - smooth(span(t, CUES.end - 1.4, CUES.end - 0.3))), h = (innerHeight - bandHeight()) / 2 * k;
    Cine.barTop.style.height = Cine.barBot.style.height = h.toFixed(1) + 'px';
  }
  // smooth shake noise in [-1, 1]: three incommensurate sines (25 Hz or so), so it looks random but has no frame steps
  function shakeN(t, k) { return Math.sin(t * 61 + k * 1.7) * 0.5 + Math.sin(t * 37.3 + k * 4.1) * 0.3 + Math.sin(t * 97.1 + k * 0.6) * 0.2; }
  function applyCamera() {
    var c = Cine.cam, vw = innerWidth, vh = innerHeight;
    var full = Math.min(vh, vw * 9 / 16), safeH = Math.sqrt(full * Math.min(full, bandHeight())), P = (safeH / 2) / Math.tan(c.fov * D2R / 2);
    var sx = 0, sy = 0, sr = 0;
    // shake from smooth noise in time, not a fresh random offset every frame (at a high refresh rate per-frame jumps
    // read as a doubled, ghosted picture; at a low one as jerks): the same shake at any frame rate
    if (Cine.shake > 0.01) { var T = Cine.t; sx = shakeN(T, 1) * 14 * Cine.shake; sy = shakeN(T, 2) * 14 * Cine.shake; sr = shakeN(T, 3) * 0.8 * Cine.shake; }
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
      var jx = it.shakeUntil && Cine.t < it.shakeUntil ? shakeN(Cine.t * 1.3, 7) * 20 : 0;
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
    // hit-stop: on a big impact the camera holds still for a beat (Cine.hitStop seconds) while the effects play on,
    // then eases back onto its path over a fifth of a second (no snap: the path kept moving underneath)
    if (Cine.hitStop > 0 && !Cine.camHeld) { Cine.camHeld = Object.assign({}, Cine.cam); Cine.hsRel = 0; }
    if (Cine.camHeld) {
      if (Cine.hitStop > 0) { Cine.hitStop -= dt; Cine.hsRel = 0; } else Cine.hsRel += dt;
      var hw = smooth(clamp01(Cine.hsRel / 0.2)), H0 = Cine.camHeld, C0 = Cine.cam;
      ['x', 'y', 'z', 'fov', 'roll', 'yaw', 'pitch'].forEach(function (k) { if (H0[k] != null) C0[k] = lerp(H0[k], C0[k], hw); });
      if (hw >= 1) Cine.camHeld = null;
    }

    var view = applyCamera();
    layoutGroup(shot.group, view);
    boardFlashes(shot.group);
    Bg.draw({ time: t, pat: shot.pat, level: Cine.level, beat: Cine.beat, flash: Math.min(0.12, Cine.flash * 0.4), env: Cine.env, tear: Cine.tear,
      speed: Cine.speed, variant: Cine.variant, P: view.P, cam: Cine.cam, dist: Cine.dist, eye: Cine.eye, crt: Cine.crt });
    drawFx(dt, t);
    drawMissiles(dt, t);   // missiles, splashes, fireballs and every flame
    // VHS: the chromatic split and tearing grow with hits and speed; a calm floor of it is always there
    // (the last shot settles: no split while the live menu fades in, which also keeps that hand-over smooth)
    // (two full-screen drop-shadows are costly, so the split is only on during hits and fast moves, never idling)
    var ab = Math.min(1.4, Cine.aberration), off = (ab * 3.5).toFixed(1);   // (a smaller split: big offsets read as ghost copies)
    Cine.stage.style.filter = Cine.ending || ab < 0.15 || Q.level ? '' : 'drop-shadow(' + off + 'px 0 0 rgba(255,0,110,0.5)) drop-shadow(-' + off + 'px 0 0 rgba(0,220,255,0.45))';
    Cine.stage.style.transform = Cine.tear > 0.3 ? 'translateX(' + (Math.sin(t * 13) * 7 * Cine.tear).toFixed(1) + 'px) skewX(' + (Math.sin(t * 9) * 0.7 * Cine.tear).toFixed(2) + 'deg)' : '';
    bars(t);
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
    Rig.on = false; Cine.timeScale = 1; Cine.fovKick = 0; Cine.missiles = []; Cine.splashes = []; Cine.fires = [];
    document.documentElement.classList.add('cine-open');
    if (window.BattleshipsMenuMusic) window.BattleshipsMenuMusic.hold(true);
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
    if (window.BattleshipsMenuMusic) { window.BattleshipsMenuMusic.hold(false); window.BattleshipsMenuMusic.startNow(skipped ? 1.2 : 1.5); }
    if (G.Sound && Cine.beepWas) G.Sound.beep = Cine.beepWas;
    document.removeEventListener('keydown', onKey, true);
    var root = Cine.root;
    root.classList.add(skipped ? 'closing' : 'closed');
    setTimeout(function () { root.remove(); }, skipped ? 450 : 50);
    document.documentElement.classList.remove('cine-open');
    Cine.groups = {}; Cine.shots = null; Cine.bolts = []; Cine.sparks = []; Cine.frags = []; Cine.flames = []; Cine.rings = []; Cine.transits = [];
    Cine.glass = []; Cine.crack = null; Cine.missiles = []; Cine.splashes = []; Cine.fires = []; Rig.on = false;
    var btn = document.getElementById('battleshipsCinematicBtn');
    if (btn && skipped) btn.focus({ preventScroll: true });
  }

  function init() {
    var btn = document.getElementById('battleshipsCinematicBtn');
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

  window.BattleshipsCinematic = { play: play, skip: function () { finish(true); }, playing: function () { return Cine.running; }, CUES: CUES };
  if (/[?&]cinematic\b/.test(location.search)) window.BattleshipsCinematic.state = function () { Cine.bgDraw = Bg; Cine.audio = Audio; return Cine; };   // testing aid
  // testing aid: run the film's frames by hand (silently) up to `to` seconds at `fps`, then hold there
  if (/[?&]cinematic\b/.test(location.search)) window.BattleshipsCinematic.step = function (to, fps) {
    if (!Cine.running) return;
    setSound(false); Cine.hold = null;
    var now = Cine.lastNow;
    while (Cine.running && Cine.t < to) { now += 1000 / (fps || 60); frame(now); cancelAnimationFrame(Cine.raf); }
    Cine.hold = to; Cine.raf = requestAnimationFrame(frame);
  };
  init();
})();
