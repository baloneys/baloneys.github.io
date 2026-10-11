"""
Pixel-art skull icons for Pong, Battleships and Chess, drawn the same way as the Tetris skulls (tetris-skulls.png,
made by the Unity project's Tools/skull_icons.py): one shared 16x16 skull on a 24x24 canvas, a per-skull accessory
and tint, and one dark outline around everything.

    python tools/game_skull_icons.py            # writes games-skulls.png (and games-skulls_preview.png) at the repo root

The sheet is one strip of 24x24 icons in ORDER below; games-skulls.js maps 'game:id' to the index, so keep the two
in step when adding a skull. Show them at whole-number scales with nearest filtering (image-rendering: pixelated).
"""
import os
from PIL import Image

N, CANVAS, SKULL_AT = 16, 24, (4, 6)

# The Tetris skull, unchanged: '#' bone, 'e' eye socket, 'n' nose, 't' tooth gap.
SKULL = [
    "................",
    ".....######.....",
    "...##########...",
    "..############..",
    "..############..",
    ".##############.",
    ".###eee##eee###.",
    ".##eeeee#eeeee#.",
    ".##eeeee#eeeee#.",
    ".###eee###eee##.",
    "..#####n#n#####.",
    "...##########...",
    "....#t#t#t#t#...",
    "....#########...",
    ".....#######....",
    "................",
]

PAL = {
    'bone': (232, 224, 240), 'outline': (24, 14, 36), 'hole': (24, 14, 36),
    'R': (255, 72, 72), 'O': (255, 150, 40), 'Y': (255, 220, 60), 'G': (90, 230, 110), 'C': (80, 220, 255),
    'B': (70, 120, 255), 'P': (190, 110, 255), 'K': (40, 34, 52), 'W': (255, 255, 255), 'S': (150, 150, 165),
    'M': (255, 110, 190), 'D': (120, 30, 40), 'L': (210, 180, 255),
}

SLASH = [("." * i) + "RR" for i in range(21)]

# (game, id, spec). Accessories: (x, y, rows) in skull space (the skull's top-left is 0,0).
ORDER = [
    # ---- Pong ----
    ('pong', 'tiny', dict(over=[(17, 4, ["C", "C", "C", "C"]), (-3, 5, ["W"])])),                       # a stub of a paddle
    ('pong', 'shrink', dict(over=[(16, -3, ["YYY", ".Y."]), (17, 1, ["C", "C", "C", "C", "C"]), (16, 7, [".Y.", "YYY"])])),
    ('pong', 'hyper', dict(eyes='Y', over=[(11, -6, ["..YYYY", ".YYYY.", "YYYYYY", "...YY.", "..YY..", ".Y...."]),
                                           (-3, -2, ["W..", ".W.", "..W"])])),
    ('pong', 'ghost', dict(tint='L', eyes='W', over=[(13, -6, [".SS.", "S..S", "S..S", ".SS."]), (-2, 0, ["S", ".", "S"])])),
    ('pong', 'invert', dict(flip=True, over=[(-3, 1, [".Y.", "YYY", ".Y.", ".Y.", ".Y.", "YYY", ".Y."])])),
    ('pong', 'curve', dict(over=[(9, -6, [".....MMW", "...MM...", "..M.....", ".M......", "M......."])])),
    ('pong', 'wind', dict(eyes='C', over=[(-3, -5, ["CCCCCCCC...", "........C..", "CCCCC...C..", ".....CC....",
                                                     "...........", "...CCCCCC.."])])),
    ('pong', 'chaos', dict(eyes='O', over=[(10, -6, ["O.....O", ".O...O.", "..O.O..", "...W...", "..O.O..",
                                                     ".O.....", "O......"])])),
    ('pong', 'giant', dict(eyes='G', over=[(17, -4, ["GG"] * 22)])),                                    # a tall paddle
    # ---- Battleships ----
    ('battleships', 'fog', dict(eyes='S', over=[(-2, -5, ["...SS...SS.....", ".SSSSS.SSSSS...", "SSSSSSSSSSSSSSS",
                                                          ".WWWWWWWWWWWWW."])])),
    ('battleships', 'noextra', dict(over=[(15, -6, [".Y.", "YY.", ".Y.", ".Y.", "YYY"]), (-3, 0, ["R"])])),
    ('battleships', 'silent', dict(over=[(12, -6, ["..S..R.R", ".SS...R.", "SSS..R.R", ".SS.....", "..S....."])])),
    ('battleships', 'clock', dict(over=[(13, -6, ["..YY..", ".WWWW.", "W.RR.W", "W..R.W", "W....W", ".WWWW."])])),
    ('battleships', 'salvo', dict(eyes='O', over=[(11, -6, ["..O..O.", "O.OYO..", ".OYWYO.", "OYWWWYO", ".OYYYO."]),
                                                  (-3, -3, ["O.", ".O"])])),
    ('battleships', 'radar', dict(eyes='G', over=[(13, -6, ["..GGG..", ".G...G.", "G..G..G", "G.GWG.G", "G..G..G"])])),
    # ---- Chess ----
    ('chess', 'blindfold', dict(over=[(0, 7, ["KKKKKKKKKKKKKKKK", "SSSSSSSSSSSSSSSS"]), (16, 8, ["KK", ".KK", "..K"])])),
    ('chess', 'fog', dict(eyes='P', over=[(-2, -5, ["...PP...PP.....", ".PPPPP.PPPPP...", "PPPPPPPPPPPPPPP",
                                                    ".LLLLLLLLLLLLL."])])),
    ('chess', 'queenless', dict(over=[(1, -6, ["Y...Y...Y...Y.", "YY.YYY.YYY.YY.", "YYYYYYYYYYYYY.", "YRYYBYYYRYYBY."]),
                                      (-3, -5, SLASH)])),
    ('chess', 'rush', dict(eyes='R', over=[(15, -6, ["YYYYY", ".RRR.", "..R..", ".R.R.", "RRRRR", "YYYYY"])])),
    ('chess', 'ironman', dict(tint='S', eyes='C', over=[(-2, 15, ["SS.SS.SS.SS.SS.SS.SS", "S.SS.SS.SS.SS.SS.S.S"])])),
    ('chess', 'shuffle', dict(over=[(11, -6, ["MMMM...C", "...M..C.", "....MC..", "....CM..", "...C..M.", "CCC....M"])])),
    ('chess', 'odds', dict(eyes='G', over=[(1, -5, ["Y...Y...Y...Y.", "YY.YYY.YYY.YY.", "YYYYYYYYYYYYY.", "YGYYBYYYGYYBY."])])),
    ('chess', 'coach', dict(eyes='Y', over=[(13, -6, [".YYY.", "YYWYY", "YYYYY", ".YYY.", "..S..", ".SSS."])])),
]


def build(spec):
    img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    px = img.load()
    sx, sy = SKULL_AT
    tint = PAL.get(spec.get('tint'))
    bone = PAL['bone']
    if tint:
        bone = tuple(int(b * 0.35 + t * 0.65) for b, t in zip(PAL['bone'], tint))
    eyes = bone if spec.get('eyes') == 'bone' else PAL.get(spec.get('eyes'), PAL['hole'])
    rows = SKULL[::-1] if spec.get('flip') else SKULL     # Upside Down: the skull itself is flipped
    for y in range(N):
        for x in range(N):
            ch = rows[y][x]
            if ch == '#':
                c = bone
                if (y >= 11 or x >= 13) and not spec.get('flip') or (spec.get('flip') and (y <= 4 or x >= 13)):
                    c = tuple(int(v * 0.82) for v in c)   # simple shading: the lower-right a step darker
                px[sx + x, sy + y] = c + (255,)
            elif ch == 'e':
                px[sx + x, sy + y] = eyes + (255,)
            elif ch in 'nt':
                px[sx + x, sy + y] = PAL['hole'] + (255,)
    for ox, oy, art in spec.get('over', []):
        for j, row in enumerate(art):
            for i, ch in enumerate(row):
                xx, yy = sx + ox + i, sy + oy + j
                if ch == '.' or ch == ' ' or not (0 <= xx < CANVAS and 0 <= yy < CANVAS):
                    continue
                px[xx, yy] = PAL[ch] + (255,)
    # one dark outline around everything, so every icon reads on any background
    solid = [[px[x, y][3] > 0 for x in range(CANVAS)] for y in range(CANVAS)]
    for y in range(CANVAS):
        for x in range(CANVAS):
            if solid[y][x]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < CANVAS and 0 <= yy < CANVAS and solid[yy][xx]:
                    px[x, y] = PAL['outline'] + (255,)
                    break
    return img


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sheet = Image.new("RGBA", (CANVAS * len(ORDER), CANVAS), (0, 0, 0, 0))
    for i, (_, _, spec) in enumerate(ORDER):
        sheet.paste(build(spec), (i * CANVAS, 0))
    sheet.save(os.path.join(root, "games-skulls.png"))
    cols = 8
    grid = Image.new("RGBA", (cols * CANVAS * 6, ((len(ORDER) + cols - 1) // cols) * CANVAS * 6), (30, 24, 44, 255))
    for i in range(len(ORDER)):
        ic = sheet.crop((i * CANVAS, 0, (i + 1) * CANVAS, CANVAS)).resize((CANVAS * 6, CANVAS * 6), Image.NEAREST)
        grid.paste(ic, ((i % cols) * CANVAS * 6, (i // cols) * CANVAS * 6), ic)
    grid.save(os.path.join(root, "tools", "games-skulls_preview.png"))
    print("wrote %d icons:" % len(ORDER), ", ".join("%d %s:%s" % (i, g, k) for i, (g, k, _) in enumerate(ORDER)))


if __name__ == "__main__":
    main()
