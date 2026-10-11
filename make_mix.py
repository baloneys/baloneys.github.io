import os, numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve

SRC='/mnt/data/fsm-team-escp-daydreaming.mp3'
OUT='/mnt/data/chess_cinematic_audio'
SR=44100
DUR=60
N=SR*DUR
rng=np.random.default_rng(101126)
src,sr=sf.read(SRC, dtype='float32', always_2d=True)
assert sr==SR and src.shape[1]==2
music=np.zeros((N,2),np.float32)
fx=np.zeros((N,2),np.float32)

def sl(t): return int(round(t*SR))
def smooth(t): return np.clip(t,0,1)**2*(3-2*np.clip(t,0,1))
def ramp(length,start=0.,end=1.):return np.linspace(start,end,length,dtype=np.float32)
def filt(x, cutoff,typ='lowpass',order=3):
    sos=butter(order,cutoff, btype=typ,fs=SR, output='sos')
    return sosfilt(sos,x,axis=0).astype('float32')
def place(target,start,x,gain=1.,pan=0.):
    x=np.asarray(x,dtype=np.float32)
    if x.ndim==1:
        x=np.column_stack((x*(1-min(pan,0)*-.45),x*(1-max(pan,0)*.45)))
    i=sl(start)
    if i<0: x=x[-i:];i=0
    if i>=len(target): return
    x=x[:len(target)-i]
    target[i:i+len(x)]+=x*gain

def cut(srcstart,dur):
    return src[sl(srcstart):sl(srcstart+dur)].copy()

def env_fade(x,start=0.1,end=0.1):
    x=x.copy(); a=sl(start);b=sl(end)
    if a: x[:a]*=ramp(a)[:,None]
    if b: x[-b:]*=ramp(b,1,0)[:,None]
    return x

# 00:00-12:00 original calm melody: faux old CRT filtering, gradually uncover music
intro=cut(0,12)
lpf=filt(intro,1800)
t=np.arange(len(intro),dtype=np.float32)/SR
openmix=smooth((t-3)/9)
intro=lpf*(1-openmix[:,None]*.8)+intro*(openmix[:,None]*.8)
intro*=((.36+.18*smooth(t/11))*smooth(t/.7))[:,None]
place(music,0,intro)

# 12:00 second act: true beat-led part of original song, aligned to 80-BPM grid
main=cut(24,26)
t=np.arange(len(main),dtype=np.float32)/SR
scale=(.63+.04*np.sin(2*np.pi*t/12)).astype(np.float32)
scale*=smooth(t/.18)
# duck music gently around marble capture, alerts and king fall
scale*=1-.08*np.exp(-((t-13.7)/.5)**2)
scale*=1-.055*np.exp(-((t-21.5)/1.6)**2)
scale*=1-smooth((t-25.15)/.85)
place(music,12,main*scale[:,None])

# Emulate a short tape-stop using progressively slower resampling of the last chord.
stopdur=1.45
count=sl(stopdur)
speed=.95*(1-np.linspace(0,1,count,dtype=np.float64))**2+.025
coords=np.cumsum(speed) # samples into source
base=src[sl(49):sl(49)+int(coords[-1])+3]
xs=np.arange(len(base))
tapestop=np.column_stack((np.interp(coords,xs,base[:,0]),np.interp(coords,xs,base[:,1]))).astype(np.float32)
tapestop*=((1-smooth(np.arange(count)/count))*.58)[:,None]
place(music,37.7,tapestop)

# Reverberant ghost of the opening melody hangs under the checkmate freeze.
ghost=cut(2,1.8)[::-1]
ghost=filt(ghost,850)*.13
ghost=env_fade(ghost,.2,.65)
place(music,40.4,ghost)

# 43-58: more animated section for flying Macintosh windows and finale.
resume=cut(78,15.3)
t=np.arange(len(resume),dtype=np.float32)/SR
scale=(.62+.09*smooth((t-9.0)/3))*smooth(t/.19)
scale*=1-smooth((t-14.6)/.7)
place(music,43,resume*scale[:,None])

# 24-second beat-compatible menu loop with matching head and tail,
# assembled from 80-BPM track (24s = 8 bars, 80BPM).
loop_len=24
loop=cut(24,26)
menu=loop[:sl(loop_len)].copy()
wrap=sl(2.0)
weight=smooth(np.arange(wrap)/max(wrap-1,1))[:,None]
menu[:wrap]=loop[sl(loop_len):sl(loop_len)+wrap]*(1-weight)+menu[:wrap]*weight
menu_lo=filt(menu,2100)
menu=menu*.40+menu_lo*.60
menu*=.32
# very low synthesised harmonics support the lo-fi low frequencies
lf=np.arange(len(menu),dtype=np.float64)/SR
menu[:,0]+=(.0010*np.sin(2*np.pi*60*lf)).astype('float32')
menu[:,1]+=(.0010*np.sin(2*np.pi*60*lf+.1)).astype('float32')
# Guarantee click-free PCM loop boundary, even with filter startup transients.
seam_length=sl(.6)
delta=menu[-1]-menu[0]
menu[-seam_length:]-=(smooth(np.linspace(0,1,seam_length,dtype=np.float32))[:,None]*delta[None,:])
# A two-second preview of the actual menu loop enters underneath the handover.
menu_enter=menu[:sl(2)].copy()
menu_enter*=smooth(np.arange(len(menu_enter))/sl(.55))[:,None]
place(music,58,menu_enter)

# ---- Original synthesised sound design: all effects generated here, no audio samples ----
def chord(freqs,d,attack=.015,release=.7,amp=1,noise=0):
    tt=np.arange(sl(d),dtype=np.float32)/SR
    s=np.zeros(len(tt),np.float32)
    for i,f in enumerate(freqs):
        s+=(np.sin(2*np.pi*(f*tt+(0.002*f)*np.sin(2*np.pi*1.2*tt)))*(.55**i))
    s/=max(1,len(freqs)*.55)
    e=smooth(tt/attack)*np.exp(-tt/max(1e-4,release))
    if noise: s+=rng.standard_normal(len(tt)).astype('float32')*noise
    return s*e*amp

def chirp(d,startf,endf,amp=.12,pan=0,fall=True):
    tt=np.arange(sl(d),dtype=np.float32)/SR
    freq=startf+(endf-startf)*smooth(tt/d)
    phase=2*np.pi*np.cumsum(freq)/SR
    e=(1-smooth(tt/d)) if fall else smooth(tt/d)
    return (np.sin(phase)*e*amp).astype('float32')

def click(d=.025,amp=.1):
    tt=np.arange(sl(d),dtype=np.float32)/SR
    nz=rng.normal(0,1,len(tt)).astype('float32')
    return filt(nz,5000,'highpass')*np.exp(-tt/.005)*amp

def bell(freq,d=1.5,amp=.1,pan=0):
    tt=np.arange(sl(d),dtype=np.float32)/SR
    tone=(np.sin(2*np.pi*freq*tt)+.35*np.sin(2*np.pi*freq*2.03*tt)+.16*np.sin(2*np.pi*freq*3.98*tt))
    return (tone*np.exp(-tt*3.8)*smooth(tt/.005)*amp).astype('float32')

def noise_sweep(d,amp=.1,up=True):
    tt=np.arange(sl(d),dtype=np.float32)/SR
    q=rng.normal(0,1,len(tt)).astype('float32')
    q=filt(q,350,'highpass')
    curve=smooth(tt/d)
    if not up:curve=1-curve
    # Pseudofrequency change via rapid amplitude shimmer
    mod=0.65+0.35*np.sin(2*np.pi*(12*tt+50*(tt*tt)/max(d,.1)))
    out=q*curve*mod
    return (out*amp).astype('float32')

def impact(d=.8,amp=.33):
    tt=np.arange(sl(d),dtype=np.float32)/SR
    nz=rng.normal(0,1,len(tt)).astype('float32')
    thud=np.sin(2*np.pi*(95*tt-28*tt*tt))*np.exp(-tt*11)
    rocks=filt(nz,950,'highpass')*np.exp(-tt*21)
    grit=filt(nz,2000,'highpass')*np.exp(-tt*45)
    return (amp*(.75*thud+.35*rocks+.15*grit)).astype('float32')

def alert(at,high=True,gain=.11):
    # An original dual-frequency classic-computer-styled alert, NOT the Apple recording.
    place(fx,at,chord([750,982] if high else [570,870],.26,attack=.003,release=.10,amp=gain),pan=-.12)
    place(fx,at+.15,chord([610,806],.23,attack=.002,release=.06,amp=gain*.6),pan=.18)

# Continuous CRT hum + tape noise with a little wobble, lowered under loud music.
t=np.arange(N,dtype=np.float64)/SR
ambient_noise=rng.normal(0,1,N).astype('float32')
# hiss with bass removed, low-intensity; warm 60Hz CRT hum (the fake computer power tone)
hiss=filt(ambient_noise,600,'highpass')
amb=(hiss*.0020+np.sin(2*np.pi*60*t).astype('float32')*.0015)
amb*= (.95+.08*np.sin(2*np.pi*.16*t)).astype('float32')
fx[:,0]+=amb
fx[:,1]+=amb*.97
# Reduce hum underneath main beat, restore for freeze
quiet=np.ones(N,dtype=np.float32)
quiet[sl(12):sl(38)]*=.55
quiet[sl(43):sl(58)]*=.55
fx*=quiet[:,None]

# Mac boot 0-6
place(fx,.25,chord([523.25,659.25,783.99,1046.5],2.0,.035, .84,amp=.28),pan=-.15)
place(fx,1.8,click(.05,.07),pan=-.55)
place(fx,2.1,chirp(.24,820,1100,.035),pan=.35)
place(fx,3.75,chord([880],.27,.002,.10,amp=.12),pan=-.08)
# Cursor double-click and striped window opening, logo flash
place(fx,6.65,click(.042,.20),pan=.4)
place(fx,6.80,click(.042,.17),pan=.45)
place(fx,7.00,chirp(.5,380,1250,.085),pan=.1)
place(fx,9.15,bell(660,.65,.10),pan=-.3)
place(fx,10.7,noise_sweep(1.3,.055,up=True),pan=.2)
place(fx,11.5,chirp(.55,230,1150,.09),pan=-.25)
# 12 portal impact and falling pieces
place(fx,11.90,noise_sweep(1.0,.09),pan=-.45)
place(fx,12.0,impact(.85,.24),pan=.08)
place(fx,13.25,chirp(.8,600,190,.043),pan=-.30)
place(fx,15.5,noise_sweep(.65,.055,up=False),pan=.45)
place(fx,17.2,chirp(.45,380,190,.034),pan=-.1)
place(fx,19.1,chirp(.40,330,140,.030),pan=.35)
# 22-30: Knight moves, capture, marble chips, alert dialog.
place(fx,22.2,noise_sweep(.85,.08),pan=-.3)
place(fx,24.95,noise_sweep(.48,.11,up=True),pan=.2)
place(fx,25.42,impact(1.05,.38),pan=.1)
for k in range(10):
    at=25.46+.06*k+rng.uniform(0,.14)
    place(fx,at,bell(float(rng.uniform(850,3800)),.35,float(rng.uniform(.015,.045))),pan=float(rng.uniform(-.8,.8)))
alert(26.48)
# Check alert cascade / dragged window glitches
for k,at in enumerate([30.2,30.85,31.55,32.25,33.05,33.72,34.55,35.45,36.25]):
    alert(at, high=k%3!=0, gain=.073+(k%4)*.007)
    place(fx,at+.22,click(.03,.065),pan=float(np.sin(k)))
# 37.7-43 the giant king falls in stylised tape stop, marble smash, RG split
place(fx,37.65,chirp(1.2,1450,60,.11),pan=-.1)
place(fx,38.35,noise_sweep(.55,.045,up=False),pan=.3)
place(fx,39.10,impact(1.2,.48))
for k in range(6):
    place(fx,39.2+k*.12,bell(float(1000+200*k),.55,.032),pan=(-1)**k*.4)
alert(40.05,high=False,gain=.08)
# Scene 43-53 social: Mac windows, app sounds, control changes
for k,at in enumerate([43.1,44.25,45.75,46.65,47.9,49.2,50.05,51.4,52.35]):
    place(fx,at,noise_sweep(.25,.022,up=(k%2==0)),pan=(-1)**k*.45)
    place(fx,at+.15,click(.024,.065),pan=(-1)**k*.4)
for at in [44.65,46.1,47.25,48.3,50.85,52.6]:
    place(fx,at,bell(1200,.32,.045),pan=-.25)
# 53-58 rhythmic finale cut points
for k,at in enumerate([53.15,53.9,54.65,55.4,56.15,56.9]):
    place(fx,at,noise_sweep(.22,.045),pan=(-1)**k*.55)
    place(fx,at+.16,click(.045,.06),pan=(-1)**k*.5)
place(fx,57.3,chirp(.75,1300,270,.085),pan=.25)
place(fx,57.95,impact(.65,.24),pan=0)
# 58-60 menu soft confirmation
place(fx,58.28,chord([523.25,659.25,783.99],1.1,.018,.53,.11),pan=0)

# Smooth composite and duck near dialogue pop, checkmate.
combined=(music+fx)
# suppress hard clips smoothly with master ceiling
pk=float(np.max(np.abs(combined)))
if pk>.92:
    g=.92/pk
    music*=g;fx*=g;combined*=g
print('Music peak',float(np.max(np.abs(music))),'Sfx peak',float(np.max(np.abs(fx))),'Master peak',float(np.max(np.abs(combined))))
for key,a in [('Balcade_Chess_Cinematic_60s_MIX',combined),('Balcade_Chess_Cinematic_60s_MUSIC',music),('Balcade_Chess_Cinematic_60s_SFX',fx),('Balcade_Chess_Menu_LOOP_24s',menu)]:
    sf.write(os.path.join(OUT,key+'.wav'),a,SR, subtype='PCM_16')
    print(key,'seconds',len(a)/SR)
