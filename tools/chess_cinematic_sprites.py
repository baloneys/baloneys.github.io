# Hand-pixelled props for the chess cinematic, drawn after Sean's reference sheets.
# Each sprite: palette (char -> hex), rows (strings, '.' = clear), scale (canvas px per art px).
# Run: python tools/chess_cinematic_sprites.py OUTDIR  -> OUTDIR/sheet.png (preview, needs Pillow) and OUTDIR/sprites.js
# (the JSON pasted as PIX in chess-cinematic.js).
import sys, json, math

OUT = '#2a1a4a'
S = {}

def check(name, rows):
    w = len(rows[0])
    bad = [(i, len(r)) for i, r in enumerate(rows) if len(r) != w]
    if bad: raise SystemExit('%s: width %d, bad rows %r' % (name, w, bad))

class Grid:
    def __init__(s, w, h): s.w, s.h, s.g = w, h, [['.'] * w for _ in range(h)]
    def set(s, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < s.w and 0 <= y < s.h: s.g[y][x] = c
    def rect(s, x, y, w, h, c):
        for j in range(h):
            for i in range(w): s.set(x + i, y + j, c)
    def ell(s, cx, cy, rx, ry, fn):
        for y in range(s.h):
            for x in range(s.w):
                dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1: c = fn(x, y, dx, dy) if callable(fn) else fn; c and s.set(x, y, c)
    def outline(s, c='o'):
        g = [r[:] for r in s.g]
        for y in range(s.h):
            for x in range(s.w):
                if s.g[y][x] != '.': continue
                if any(0 <= x + a < s.w and 0 <= y + b < s.h and s.g[y + b][x + a] not in '.o' for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))): g[y][x] = c
        s.g = g
    def rows(s): return [''.join(r) for r in s.g]

# ---------- the pastel column (first reference): a slim Ionic column, light from the left ----------
COL = [
 "oooooooooooooooooooo",
 "oeeedddddddddddcccbo",
 "obbbbbbbbbbbbbbbbbao",
 "oooooooooooooooooooo",
 "oeeoodddddddddcoobbo",
 "oedeoeddddddddcobcbo",
 "oeoeoeddddddddcobobo",
 ".ooooddddddddddcooo.",
 "....oddddddddccbo...",
 "....obbabbabbaao....",
 "....obbabbabbaao....",
] + ["....oedbdcbccabo...."] * 50 + [
 "....odbbccbbcaao....",
 "...oeddddddddcccbo..",
 "...obbbbbbbbbbbbbo..",
 "..oeeddddddddddccbo.",
 "..obbbbbbbbbbbbbbbo.",
 ".oeddddddddddddcccbo",
 ".oddddddddddddddccbo",
 ".obbbbbbbbbbbbbbbbbo",
 ".oaaaaaaaaaaaaaaaaao",
 ".ooooooooooooooooooo",
]
COLS = {
 'colPink':  ['#8a3a7a', '#c45a9c', '#ee8cc6', '#ffb8dc', '#fff0f8'],
 'colMint':  ['#1f6a66', '#2f9a8a', '#5cd0b4', '#9cecd4', '#effff8'],
 'colBlue':  ['#2a4a96', '#3f78c8', '#6eaaee', '#a8d8ff', '#f0faff'],
 'colLilac': ['#5a4890', '#8068bc', '#a894e6', '#d0c2ff', '#f8f2ff'],
}
def ivy(rows, seed):
    g = [list(r) for r in rows]
    def put(x, y, c):
        if 0 <= y < len(g) and 0 <= x < len(g[0]) and g[y][x] != '.': g[y][x] = c
    # a vine winding up the shaft, leaves either side, pink flowers on it and at the foot
    for y in range(70, 14, -1):
        x = 9.5 + math.sin(y * 0.16 + seed) * 4.2
        put(int(round(x)), y, 'g')
        if y % 4 == 0:
            side = 1 if (y // 4) % 2 else -1
            put(int(round(x)) + side, y - 1, 'h'); put(int(round(x)) + side * 2, y - 1, 'g'); put(int(round(x)) + side, y - 2, 'h')
        if y % 13 == 5: put(int(round(x)) - 1, y, 'p'); put(int(round(x)), y - 1, 'q')
    for x, y, c in ((2, 69, 'g'), (3, 68, 'h'), (4, 69, 'g'), (3, 69, 'p'), (16, 68, 'g'), (17, 69, 'h'), (15, 69, 'q'), (17, 67, 'p'), (5, 70, 'h')):
        put(x, y, c)
    return [''.join(r) for r in g]
for k, ramp in COLS.items():
    pal = dict(zip('abcde', ramp)); pal['o'] = OUT
    pal.update({'g': '#2b8a4a', 'h': '#6fd06a', 'p': '#ff5aa8', 'q': '#ffd0ea'})
    S[k] = {'pal': pal, 'rows': COL, 'scale': 2}
    S[k + 'Ivy'] = {'pal': pal, 'rows': ivy(COL, len(k)), 'scale': 2}

# ---------- the ruin: the same column broken off, a fallen drum beside it ----------
R = [r[:] for r in COL[30:]]
R = ["........................"[:0] + r + "........" for r in R]
top = [r + "...." for r in ["....o.oo.o..oo.o........", "....odoeoddobboo........", "....oedbdcbccabo........"]]
R = top + R
g = [list(r) for r in R]
drum = Grid(28, len(R))
drum.ell(22.5, len(R) - 5.5, 4.2, 4.6, lambda x, y, dx, dy: 'e' if dx < -0.4 else 'd' if dx < 0.2 else 'c' if dx < 0.6 else 'b')
drum.outline()
for y in range(len(R)):
    for x in range(28):
        if drum.g[y][x] != '.' and g[y][x] == '.': g[y][x] = drum.g[y][x]
pal = dict(zip('abcde', COLS['colPink'])); pal['o'] = OUT
S['ruin'] = {'pal': pal, 'rows': [''.join(r) for r in g], 'scale': 2}

# ---------- the bust (both starter packs): a Greek head turned to the left, curls, on a little pedestal ----------
BUST = [
 "..........oooooooo............",
 "........oodeddcdcboo..........",
 ".......odeedcddcdcbbo.........",
 "......odedcdeddcdcbcbo........",
 ".....odeddcdedcdcbcbbbo.......",
 ".....odedcddeddcdcbcbbo.......",
 "....odeddeeeeeddcdcbcbbo......",
 "....odcdeeeeeeedccbcbbbo......",
 "....odeeeeeeeeddcccbcbbo......",
 "....oeeeeeeeeedddccbbcbo......",
 "...oeeeoooeeedddcccbbbbo......",
 "...oeeeobaeeddddccbbbbbo......",
 "..oeeeeeeeeedddcccbbbabo......",
 ".oeeeeeeeedddccccbbbbabo......",
 ".oeeeeeeeddddcccbbbbaabo......",
 "..oobeeeedddddcccbbbaabo......",
 "...oeeeedddddccccbbbaabo......",
 "...oooeeddddcccccbbbabo.......",
 "...oeedddddcccccbbbbabo.......",
 "....oedddddcccccbbbabo........",
 ".....oeddddcccccbbbao.........",
 "......oodddcccccbbao..........",
 "........oddcccccbbo...........",
 "........odcccccbbbo...........",
 ".......odcccccbbbbbo..........",
 ".....oodccccccbbbbbboo........",
 "...oodddcccccccbbbbbbbboo.....",
 "..odeeddddccccccbbbbbbbbbo....",
 ".odeeeddddddccccccbbbbbbbbo...",
 ".oeeeddddddcccccccbbbbbbbbbo..",
 "oeeedddddddccccccccbbbbbbbbao.",
 "oeeddddddddcccccccccbbbbbbbao.",
 "oooooooooooooooooooooooooooo..",
 ".......oeeddddddcccbbo........",
 "........oedddddccbbo..........",
 "........oedddddccbbo..........",
 "......ooeeddddddcccbboo.......",
 ".....oeeeddddddddcccbbbo......",
 ".....obbbbbbbbbbbbbbbbaao.....",
 ".....oooooooooooooooooooo.....",
]
S['bust'] = {'pal': {'o': OUT, 'a': '#4a3a80', 'b': '#7a64b8', 'c': '#a896e0', 'd': '#cfc2f6', 'e': '#f4eeff'}, 'rows': BUST, 'scale': 2}

# ---------- the dolphin (starter packs): a pink-violet dolphin mid-leap, pale belly ----------
DOL = [
 "................oo..................",
 "...............odo..................",
 "..............odco..................",
 ".............odcco..................",
 "...........oodccbooooo..............",
 ".........oodddccccbbbbooo...........",
 ".......oodeeeddddcccccbbbboo........",
 ".....oodeeeeddddddccccccbbbboo......",
 "....odeeeddddddddcccccccccbbbboooo..",
 "...odeedddddddddccccccccccbbobbbbbo.",
 "..odddddddddcccccccccccbbbbbbaaaaao.",
 "..obbcccccffffffffffffffffffffooooo.",
 ".obbccffffffffffffoboffffffoo.......",
 ".obcfffffffffffoooobbo.oooo.........",
 "obcffffffffoooo...obbo..............",
 "obcffffoooo........oo...............",
 "obcfo...............................",
 "obcbo...............................",
 "obbbo...............................",
 ".obcbbo.............................",
 "obccbbbo............................",
 "oooooooo............................",
]
S['dolphin'] = {'pal': {'o': OUT, 'a': '#5a1a7a', 'b': '#9a3ac0', 'c': '#cc6cf0', 'd': '#eaa4ff', 'e': '#ffe6ff', 'f': '#ffc8ec'}, 'rows': DOL, 'scale': 2}

# ---------- the flamingo (last reference): standing on one leg in pixel shades ----------
FL = [
 "......ooooo...............",
 ".....odeeedo..............",
 "....odeedddco.............",
 "kkkkkkkkkkkkko............",
 "kwkkkkokwkkkko............",
 ".kkkko.kkkkkdo............",
 "yyyo..odddcco.............",
 "ykkko.odddcbo.............",
 ".ooo..odccbo..............",
 "......odccbo..............",
 ".......odcbo..............",
 ".......odcbo..............",
 "........odcbo.............",
 "........odcbo.............",
 ".........odcbo............",
 ".........odcbo............",
 "..........odcbo...........",
 "..........odcbo...........",
 "..........odcbo...........",
 ".........odccbo...........",
 "........oddccbboooo.......",
 ".......odeeddcccbbbboo....",
 "......odeeeddddcccbbbbbo..",
 ".....odeeedddddccccbbbbbao",
 ".....odeedddccccccbbbbbaao",
 ".....oddddcccccbbbbbbaaao.",
 "......odcccccbbbbbbaaaoo..",
 ".......occcbbbbbbaaaoo....",
 "........ooobbbbaaooo......",
 "...........oollo..........",
 "............olo...........",
 "............olo...........",
 "............olo...........",
 "............olo...........",
 "............olo...........",
 "............olo...........",
 "............olo...........",
 "...........ooloo..........",
 "............olo..oooo.....",
 "............olooollo......",
 "............olollloo......",
 "............oloooo........",
 "............olo...........",
 "............olo...........",
 "............olo...........",
 "............olo...........",
 "..........oollloo.........",
 "..........ooooooo.........",
]
S['flamingo'] = {'pal': {'o': OUT, 'a': '#a0286a', 'b': '#e04a96', 'c': '#ff7ab8', 'd': '#ffaad4', 'e': '#ffe2f2', 'k': '#120c22', 'w': '#ffffff', 'y': '#ffb04a', 'l': '#ff6aaa'}, 'rows': FL, 'scale': 2}

# ---------- the arcade cabinet (stock sheet): purple, lit marquee, green screen, control deck ----------
g = Grid(24, 48)
g.rect(1, 1, 6, 46, 'a')                        # the side panel, in shade
g.rect(7, 1, 16, 46, 'c')                       # the front
g.rect(7, 1, 2, 46, 'd'); g.rect(21, 1, 2, 46, 'b')
g.rect(2, 1, 21, 1, 'e')                        # the lit top edge
g.rect(8, 3, 14, 6, 'm'); g.rect(9, 4, 6, 2, 'n'); g.rect(16, 6, 5, 1, 'n')            # the marquee
g.rect(8, 11, 14, 13, 'k'); g.rect(9, 12, 12, 11, 's'); g.rect(10, 13, 4, 2, 'S'); g.rect(15, 17, 5, 1, 't'); g.rect(10, 19, 8, 1, 't')  # the screen
g.rect(6, 25, 18, 4, 'd'); g.rect(6, 25, 18, 1, 'e'); g.rect(6, 28, 18, 1, 'b')        # the control deck
g.set(9, 26, 'k'); g.set(9, 25, 'm'); g.rect(13, 26, 2, 1, 'y'); g.rect(17, 26, 2, 1, 'm')
g.rect(10, 33, 4, 6, 'b'); g.rect(16, 33, 4, 6, 'b'); g.rect(11, 34, 2, 1, 'y'); g.rect(17, 34, 2, 1, 'y')   # coin doors
g.rect(1, 45, 22, 2, 'a')
g.outline()
S['arcade'] = {'pal': {'o': OUT, 'a': '#3a1a7a', 'b': '#5a24a8', 'c': '#7c34d8', 'd': '#a462ff', 'e': '#d8bcff', 'm': '#ff5aa8', 'n': '#ffd0ea',
                       'k': '#140c26', 's': '#7fe05a', 'S': '#d8ffb0', 't': '#2a7a3a', 'y': '#ffd640'}, 'rows': g.rows(), 'scale': 2}

# ---------- the handheld (starter pack): lilac, a pale screen with a falling piece, pink buttons ----------
g = Grid(20, 30)
g.rect(1, 1, 18, 28, 'c'); g.rect(1, 1, 2, 28, 'd'); g.rect(17, 1, 2, 28, 'b'); g.rect(1, 27, 18, 2, 'b'); g.rect(2, 1, 16, 1, 'e')
g.rect(4, 3, 12, 11, 'a'); g.rect(5, 4, 10, 9, 's'); g.rect(7, 6, 2, 2, 't'); g.rect(9, 6, 2, 2, 't'); g.rect(9, 8, 2, 2, 't'); g.rect(5, 11, 10, 2, 't')
g.set(14, 4, 'S')
g.rect(4, 18, 5, 1, 'k'); g.rect(6, 16, 1, 5, 'k')                                    # the d-pad
g.rect(12, 18, 2, 2, 'm'); g.rect(15, 16, 2, 2, 'm'); g.set(12, 18, 'n'); g.set(15, 16, 'n')
g.rect(7, 23, 2, 1, 'b'); g.rect(10, 23, 2, 1, 'b')
for i in range(3): g.rect(13 + i * 2, 24 - i, 1, 3, 'b')                              # the speaker grille
g.outline()
S['handheld'] = {'pal': {'o': OUT, 'a': '#4a3a7a', 'b': '#8a76c8', 'c': '#b8a8ee', 'd': '#dcd2ff', 'e': '#fbf8ff', 'k': '#2a1a4a',
                         's': '#a8f0e8', 'S': '#ffffff', 't': '#3a8a9a', 'm': '#ff5aa8', 'n': '#ffc0e0'}, 'rows': g.rows(), 'scale': 2}

# ---------- the can (starter pack): a tall can of iced tea, mint with a cherry-blossom branch ----------
g = Grid(14, 26)
g.rect(1, 2, 12, 22, 'c'); g.rect(1, 2, 3, 22, 'd'); g.rect(2, 2, 1, 22, 'e'); g.rect(10, 2, 3, 22, 'b')
g.rect(2, 1, 10, 1, 'S'); g.rect(1, 1, 1, 1, 's'); g.rect(12, 1, 1, 1, 's'); g.rect(2, 0, 10, 1, 's'); g.rect(4, 0, 4, 1, 'S')   # the lid
g.rect(1, 24, 12, 1, 's'); g.rect(2, 25, 10, 1, 's')
g.rect(1, 5, 12, 1, 'w'); g.rect(1, 19, 12, 1, 'w')                                   # bands
for x, y in ((4, 15), (5, 14), (6, 13), (7, 12), (7, 11), (8, 10), (5, 16), (3, 17)): g.set(x, y, 't')   # the branch
for x, y in ((8, 9), (9, 11), (6, 11), (4, 13), (8, 13), (3, 15), (6, 16)): g.set(x, y, 'p')
for x, y in ((9, 9), (7, 12), (4, 14)): g.set(x, y, 'q')
g.outline()
S['can'] = {'pal': {'o': OUT, 'b': '#2f9a8a', 'c': '#5cd0b4', 'd': '#9cecd4', 'e': '#effff8', 'S': '#f4f0ff', 's': '#a8a0c8', 'w': '#ffffff',
                    't': '#7a3a5a', 'p': '#ff6ab8', 'q': '#ffd0ea'}, 'rows': g.rows(), 'scale': 2}

# ---------- the bottle (starter pack): a glass bottle with a plant label ----------
g = Grid(12, 30)
g.rect(4, 0, 4, 2, 'k'); g.rect(4, 2, 4, 6, 'c'); g.rect(3, 8, 6, 2, 'c'); g.rect(2, 10, 8, 19, 'c')
g.rect(2, 10, 2, 19, 'd'); g.rect(8, 10, 2, 19, 'b'); g.rect(4, 2, 1, 6, 'e'); g.rect(3, 11, 1, 8, 'e')
g.rect(2, 15, 8, 9, 'w'); g.rect(3, 16, 6, 7, 'l')
for x, y in ((5, 21), (5, 20), (6, 19), (4, 19), (6, 18), (4, 17), (5, 18)): g.set(x, y, 'g')
g.set(6, 17, 'p'); g.set(4, 20, 'p')
g.rect(2, 28, 8, 1, 'b')
g.outline()
S['bottle'] = {'pal': {'o': OUT, 'b': '#6a54b0', 'c': '#9a84e0', 'd': '#c6b8ff', 'e': '#f4f0ff', 'k': '#ff5aa8', 'w': '#fbf8ff', 'l': '#e8e0ff',
                       'g': '#2b9a5a', 'p': '#ff5aa8'}, 'rows': g.rows(), 'scale': 2}

# ---------- the beach ball: six panels and a gloss highlight, lit from the top left ----------
g = Grid(22, 22)
cols = ['p', 'w', 'c', 'w', 'y', 'w']
def ball(x, y, dx, dy):
    a = (math.atan2(dy - 0.15, dx + 0.25) + math.pi) / (math.pi * 2)
    c = cols[int(a * 6) % 6]
    shade = dx * 0.6 + dy * 0.8
    if c == 'w' and shade > 0.55: c = 'v'
    if shade > 0.75: c = c.upper() if c != 'v' else 'V'
    if dx * dx + dy * dy < 0.08: c = 'w'
    return c
g.ell(11, 11, 10.2, 10.2, ball)
g.rect(6, 5, 3, 1, 'h'); g.rect(5, 6, 2, 1, 'h')
g.outline()
S['beachball'] = {'pal': {'o': OUT, 'p': '#ff4fa8', 'P': '#c02a80', 'w': '#fbf8ff', 'W': '#cfc2f0', 'v': '#e0d8ff', 'V': '#b4a6e0',
                          'c': '#2ac8f0', 'C': '#1a80c0', 'y': '#ffd640', 'Y': '#d89a20', 'h': '#ffffff'}, 'rows': g.rows(), 'scale': 2}

# ---------- the swim ring: pink with white bands ----------
g = Grid(34, 18)
def ring(x, y, dx, dy):
    if (dx * 2.0) ** 2 + ((dy + 0.12) * 2.6) ** 2 < 1: return None
    band = int((math.atan2(dy, dx) + math.pi) / (math.pi * 2) * 8) % 2
    lit = -dx * 0.4 - dy * 0.9
    c = 'w' if band else 'p'
    if lit < -0.45: c = 'W' if band else 'P'
    if lit > 0.55: c = 'h'
    return c
g.ell(17, 9, 16.5, 8.5, ring)
g.outline()
S['swimring'] = {'pal': {'o': OUT, 'p': '#ff5aa8', 'P': '#c02a80', 'w': '#fbf8ff', 'W': '#c8bce8', 'h': '#ffe0f0'}, 'rows': g.rows(), 'scale': 2}

# ---------- the temple (the temple reference): steps, six fluted columns, the entablature, a pediment ----------
g = Grid(86, 58)
g.rect(1, 52, 84, 5, 'b'); g.rect(1, 52, 84, 1, 'd')
g.rect(4, 48, 78, 4, 'c'); g.rect(4, 48, 78, 1, 'e')
g.rect(7, 45, 72, 3, 'c'); g.rect(7, 45, 72, 1, 'e')
for x in (11, 23, 35, 47, 59, 71):
    g.rect(x - 1, 42, 8, 3, 'd'); g.rect(x - 1, 21, 8, 2, 'd')
    g.rect(x, 23, 6, 19, 'P'); g.rect(x, 23, 2, 19, 'Q'); g.rect(x + 4, 23, 2, 19, 'R'); g.rect(x + 2, 23, 1, 19, 'R')
    g.rect(x, 23, 6, 1, 'R')
g.rect(5, 15, 76, 6, 'c'); g.rect(5, 15, 76, 1, 'e'); g.rect(5, 19, 76, 2, 'b')
for i in range(9, 78, 4): g.rect(i, 17, 2, 2, 'd')                                   # triglyphs
for y in range(0, 15):
    half = int((y + 1) * 38 / 15)
    g.rect(43 - half, y, half * 2, 1, 'B')
    if y > 2: g.rect(43 - half + 3, y, max(0, half * 2 - 6), 1, 'A')
g.rect(5, 14, 76, 1, 'B')
g.outline()
S['temple'] = {'pal': {'o': OUT, 'b': '#7060b0', 'c': '#a894e6', 'd': '#d0c2ff', 'e': '#f8f2ff', 'P': '#ee8cc6', 'Q': '#ffd0e8', 'R': '#c45a9c',
                       'A': '#a8d8ff', 'B': '#6eaaee'}, 'rows': g.rows(), 'scale': 2}

# ---------- the sunset orb (stock sheet): a striped sun hanging in the sky ----------
g = Grid(40, 40)
def sun(x, y, dx, dy):
    k = (dy + 1) / 2
    if k > 0.45 and (y % 4 == 0 or (k > 0.75 and y % 4 == 1)): return None     # the stripes, widening towards the bottom
    return 'abcdef'[min(5, int(k * 6))]
g.ell(20, 20, 19.5, 19.5, sun)
g.outline()
S['sunorb'] = {'pal': {'o': OUT, 'a': '#ffe85a', 'b': '#ffc04a', 'c': '#ff9a5a', 'd': '#ff6a8a', 'e': '#ff4aa8', 'f': '#d03ac0'}, 'rows': g.rows(), 'scale': 2}

for k, v in S.items(): check(k, v['rows'])

if __name__ == '__main__':
    out = sys.argv[1]
    from PIL import Image
    Z = 5
    names = list(S.keys())
    W = sum(len(S[n]['rows'][0]) * Z + 12 for n in names)
    H = max(len(S[n]['rows']) for n in names) * Z + 12
    im = Image.new('RGB', (min(W, 3400), H * (1 + W // 3400)), (60, 100, 180))
    x0, y0 = 6, 6
    for n in names:
        sp = S[n]; w = len(sp['rows'][0]) * Z
        if x0 + w > 3400: x0 = 6; y0 += H
        for j, r in enumerate(sp['rows']):
            for i, c in enumerate(r):
                if c == '.': continue
                h = sp['pal'][c].lstrip('#'); col = tuple(int(h[k:k + 2], 16) for k in (0, 2, 4))
                for a in range(Z):
                    for b in range(Z): im.putpixel((x0 + i * Z + a, y0 + j * Z + b), col)
        x0 += w + 12
    im.save(out + '/sheet.png')
    js = json.dumps({n: {'s': S[n]['scale'], 'p': S[n]['pal'], 'r': S[n]['rows']} for n in names}, separators=(',', ':'))
    open(out + '/sprites.js', 'w').write(js)
    print('ok', len(js))
