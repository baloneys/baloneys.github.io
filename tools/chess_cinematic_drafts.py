# Snap ChatGPT's Higgsfield chess-cinematic drafts to their pixel grid (majority colour per 12 px cell, translucent glow
# dropped, palette limited) and write run-length JSON for DRAFTS in chess-cinematic.js. SRC is the drafts folder in the
# Unity project. Run: python tools/chess_cinematic_drafts.py OUTDIR  (needs Pillow); z (display size) is set in the JS.
# Snap the Higgsfield drafts to a pixel grid: majority colour per cell, drop translucent glow, limit the palette.
import sys, json, collections
from PIL import Image
SRC = 'F:/unity projects/Tetris/Docs/previews/higgsfield-pixel-drafts/'
OUT = sys.argv[1]
JOBS = {  # name: (file, cell px)
 'palm': ('palm-pair.png', 12), 'palm2': ('approved-palm-from-earlier-chat.png', 12),
 'bust': ('bust.png', 12), 'dolphin': ('dolphin.png', 12), 'flamingo': ('flamingo.png', 12), 'arcade': ('arcade.png', 12),
 'handheld': ('handheld.png', 12), 'can': ('can.png', 12), 'bottle': ('bottle.png', 12), 'beachball': ('beachball.png', 14),
 'swimring': ('swimring.png', 12), 'temple': ('temple.png', 10), 'sunorb': ('sunorb.png', 14), 'ruin': ('ruin.png', 12),
 'colWhite': ('column.png', 12), 'kingStatue': ('king.png', 12), 'knightStatue': ('knight.png', 12), 'macDraft': ('mac.png', 12),
 'clock': ('new-props/chess-clock.png', 12), 'floppy': ('new-props/floppy-disk.png', 12), 'crown': ('new-props/fallen-crown.png', 12),
 'hand': ('new-props/marble-hand-pawn.png', 12), 'arch': ('new-props/portal-arch.png', 12),
}
CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&()*+,-/:;<=>?@[]^_{|}~'
def snap(path, cs):
    im = Image.open(SRC + path).convert('RGBA'); x0, y0, x1, y1 = im.getbbox(); px = im.load()
    W, H = (x1 - x0 + cs - 1) // cs, (y1 - y0 + cs - 1) // cs
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0)); op = out.load()
    for j in range(H):
        for i in range(W):
            cnt = collections.Counter(); n = solid = 0
            for y in range(y0 + j * cs + 1, min(y1, y0 + (j + 1) * cs) - 1):
                for x in range(x0 + i * cs + 1, min(x1, x0 + (i + 1) * cs) - 1):
                    c = px[x, y]; n += 1
                    if c[3] >= 200: solid += 1; cnt[(c[0] >> 3, c[1] >> 3, c[2] >> 3)] += 1
            if n and solid / n >= 0.5:
                q = cnt.most_common(1)[0][0]; op[i, j] = (q[0] << 3 | 4, q[1] << 3 | 4, q[2] << 3 | 4, 255)
    bb = out.getbbox()
    return out.crop(bb)
def quant(im, k=28):
    rgb = Image.new('RGB', im.size, (0, 0, 0)); rgb.paste(im, mask=im.split()[3])
    q = rgb.quantize(colors=k, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = q.getpalette(); a = im.split()[3].load(); qp = q.load(); w, h = im.size
    used = sorted({qp[x, y] for y in range(h) for x in range(w) if a[x, y]})
    cmap = {u: CHARS[i] for i, u in enumerate(used)}
    rows = []
    for y in range(h):
        r = ''; prev = None; n = 0
        for x in range(w):
            ch = cmap[qp[x, y]] if a[x, y] else '.'
            if ch == prev: n += 1
            else:
                if prev is not None: r += prev + (str(n) if n > 1 else '')
                prev, n = ch, 1
        r += prev + (str(n) if n > 1 else '')
        rows.append(r)
    palette = {cmap[u]: '#%02x%02x%02x' % tuple(pal[u * 3:u * 3 + 3]) for u in used}
    return {'w': w, 'p': palette, 'r': rows}
data = {}
for name, (f, cs) in JOBS.items():
    sm = snap(f, cs); d = quant(sm); data[name] = d
    big = sm.resize((sm.width * 4, sm.height * 4), Image.NEAREST); big.save(OUT + '/' + name + '.png')
    print(name, sm.size, len(d['p']), 'colours', sum(len(r) for r in d['r']), 'chars')
open(OUT + '/drafts.json', 'w').write(json.dumps(data, separators=(',', ':')))
