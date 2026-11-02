"""Build Longview Horizon Rule masters: symbol, small cut, outlined wordmark, lockups."""
import sys, pathlib
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
FONT = pathlib.Path(__file__).parent / "font" / "YoungSerif-Regular.ttf"
OLIVE = "#465032"

# --- Symbol, 256 grid. Rule: three equal dashes (58 long, 21 gap), 20 thick. Sun: r64 half-disc, 16 above the rule.
def symbol_shapes(small=False):
    if small:  # favicon cut: fewer, fatter parts and wider gaps for 16-32 px
        y, h, dashes, cx, cy, r = 160, 32, [(0, 64), (96, 160), (192, 256)], 128, 144, 96  # snapped to a 16 px grid (1 px = 16 units)
    else:
        y, h, dashes, cx, cy, r = 156, 20, [(20, 78), (99, 157), (178, 236)], 128, 140, 64
    sun = f"M{cx-r} {cy}A{r} {r} 0 0 1 {cx+r} {cy}Z"
    rule = "".join(f"M{a} {y}H{b}V{y+h}H{a}Z" for a, b in dashes)
    return sun, rule

def svg(view, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}">'
            f'<title>{title}</title>{body}</svg>\n')

def symbol_body(fill, small=False, dx=0, dy=0, s=1):
    sun, rule = symbol_shapes(small)
    tf = f' transform="translate({dx} {dy}) scale({s})"' if (dx or dy or s != 1) else ""
    return f'<g fill="{fill}"{tf}><path d="{sun}"/><path d="{rule}"/></g>'

(OUT / "longview-symbol.svg").write_text(svg("0 0 256 256", symbol_body(OLIVE), "Longview"))
(OUT / "longview-symbol-small.svg").write_text(svg("0 0 256 256", symbol_body(OLIVE, small=True), "Longview"))

# --- Wordmark: Young Serif outlines, lowercase, with hand-set pair spacing (font units, 1000 upm).
font = TTFont(FONT); gs = font.getGlyphSet(); cmap = font.getBestCmap(); hmtx = font["hmtx"]
TRACK = -6
PAIRS = {"lo": -4, "on": 0, "ng": -6, "gv": -14, "vi": -8, "ie": 0, "ew": -12}
word = "longview"
pen = SVGPathPen(gs); x = 0
for i, ch in enumerate(word):
    g = cmap[ord(ch)]
    gs[g].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
    x += hmtx[g][0] + TRACK + (PAIRS.get(word[i:i+2], 0) if i + 1 < len(word) else 0)
word_d = pen.getCommands()
bp = BoundsPen(gs); x = 0
for i, ch in enumerate(word):
    g = cmap[ord(ch)]
    gs[g].draw(TransformPen(bp, (1, 0, 0, -1, x, 0)))
    x += hmtx[g][0] + TRACK + (PAIRS.get(word[i:i+2], 0) if i + 1 < len(word) else 0)
wx0, wy0, wx1, wy1 = bp.bounds  # y is flipped: wy0 = -ascender top, wy1 = descender depth
XH = 500  # x-height
ww, wh = wx1 - wx0, wy1 - wy0
(OUT / "longview-wordmark.svg").write_text(
    svg(f"{wx0:.0f} {wy0:.0f} {ww:.0f} {wh:.0f}", f'<path fill="{OLIVE}" d="{word_d}"/>', "Longview"))

# --- Horizontal lockup: rule bottom sits on the baseline, sun top meets the ascender height.
# Symbol content spans y 76..176 (100 units) -> scale so it spans baseline..ascender top.
asc = -wy0
s = asc / 100
sym_w = 216 * s                     # dashes span x 20..236
gap = 0.55 * XH                     # clear space between symbol and word
sx = -(20 * s) - sym_w - gap + wx0  # place symbol left of the word
sy = -(176 * s)                     # rule bottom (176) on baseline (0)
body = symbol_body(OLIVE, dx=round(sx, 2), dy=round(sy, 2), s=round(s, 4)) + f'<path fill="{OLIVE}" d="{word_d}"/>'
hx0 = sx + 20 * s
(OUT / "longview-horizontal.svg").write_text(
    svg(f"{hx0:.0f} {wy0:.0f} {wx1 - hx0:.0f} {wh:.0f}", body, "Longview"))

# --- Stacked lockup: symbol centred above the word, rule width = 70% of word width.
s2 = 0.70 * ww / 216
cx = wx0 + ww / 2
sy2 = wy0 - 0.5 * XH - 176 * s2
sx2 = cx - 128 * s2
body = symbol_body(OLIVE, dx=round(sx2, 2), dy=round(sy2, 2), s=round(s2, 4)) + f'<path fill="{OLIVE}" d="{word_d}"/>'
top = sy2 + 76 * s2
(OUT / "longview-stacked.svg").write_text(
    svg(f"{wx0:.0f} {top:.0f} {ww:.0f} {wy1 - top:.0f}", body, "Longview"))
print("ok", OUT, f"word {ww:.0f}x{wh:.0f} asc {asc:.0f}")
