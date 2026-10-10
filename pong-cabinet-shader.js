// The exact cabinet and warehouse shader from tetris-cinematic.js.
// Keep physical cabinet changes in sync with that source; Pong supplies its own CRT title.
(function () {
  'use strict';
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
      var gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true });
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
      var cw = cv.clientWidth || 1280, ch = cv.clientHeight || 720;
      // the warehouse (pattern 3) renders sharper, so the cabinet's detail holds up
      var w = s.pat > 2.5 ? Math.min(1280, Math.round(cw / 1.5)) : Math.min(720, Math.round(cw / 3)), h = Math.round(w * ch / cw);
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

  window.PongCabinet = function () {
    var canvas = document.createElement('canvas');
    var bg = Object.create(Bg); bg.u = {}; bg.mount(canvas);
    return {
      draw: function (ctx, t, dist, env, beat, flash) {
        if (!bg.gl) return false;
        bg.draw({ pat: 3, time: t, level: 0, beat: beat || 0, flash: flash || 0, env: env,
          tear: 0, speed: 0, variant: 0, P: 1,
          cam: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 },
          dist: dist, eye: 1.24, crt: 1 });
        ctx.drawImage(canvas, 0, 0, 1280, 720);
        return true;
      }
    };
  };
})();
