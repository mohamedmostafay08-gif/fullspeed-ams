"""Renders public/brand/login-hero.jpg — 'Kinetic Cartography' (see design/philosophy.md)."""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONTS = Path("/root/.claude/skills/synced/98f1101b-527f-44a3-a87b-727ef7b734e0_50ecf684-d877-4994-8638-19d5f651fd6c/canvas-design/canvas-fonts")
OUT = Path(__file__).resolve().parent.parent / "public" / "brand" / "login-hero.jpg"

W, H, SS = 1200, 1600, 2  # final size, supersampling factor
w, h = W * SS, H * SS
INK = (11, 16, 32)
BONE = (236, 232, 222)
SLATE = (120, 136, 170)
ORANGE = (249, 115, 22)
rng = random.Random(27)


def s(v: float) -> int:
    return int(round(v * SS))


img = Image.new("RGB", (w, h), INK)

# Ground: gentle vertical falloff toward the destination corner.
grad = Image.new("L", (1, 256))
for y in range(256):
    grad.putpixel((0, y), int(18 * (y / 255) ** 1.6))
glow = grad.resize((w, h))
img = Image.composite(Image.new("RGB", (w, h), (24, 32, 58)), img, glow)

layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
d = ImageDraw.Draw(layer)

# Street lattice — two families of thin lines at a slight skew.
angle = math.radians(-14)
ca, sa = math.cos(angle), math.sin(angle)
for i in range(-40, 80):
    off = i * 46
    x0, y0 = off * ca - (-800) * sa, off * sa + (-800) * ca
    x1, y1 = off * ca - 2400 * sa, off * sa + 2400 * ca
    d.line([(s(x0), s(y0)), (s(x1), s(y1))], fill=SLATE + (14,), width=s(1))
for i in range(-40, 80):
    off = i * 58
    x0, y0 = -800 * ca - off * sa, -800 * sa + off * ca
    x1, y1 = 2400 * ca - off * sa, 2400 * sa + off * ca
    d.line([(s(x0), s(y0)), (s(x1), s(y1))], fill=SLATE + (10,), width=s(1))

# The river: a calm band of fine ticks bending through the field.
def river_x(y: float) -> float:
    return 330 + 120 * math.sin(y / 420) + 0.12 * y

for y in range(-20, H + 20, 7):
    cx = river_x(y)
    for k in range(-5, 6):
        d.line([(s(cx + k * 6), s(y)), (s(cx + k * 6), s(y + 3))], fill=(96, 120, 170, 46), width=s(1))

# Destination hub (dispatch).
HX, HY = 860, 1090

# Accumulated routes: many quiet dashed paths converging on the hub.
def bezier(p0, p1, p2, t):
    a = (1 - t) ** 2
    b = 2 * (1 - t) * t
    c = t ** 2
    return (a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1])

for n in range(140):
    edge = rng.random()
    if edge < 0.45:
        start = (rng.uniform(-60, W * 0.7), rng.uniform(-80, 40))
    elif edge < 0.8:
        start = (rng.uniform(-80, 20), rng.uniform(0, H * 0.95))
    else:
        start = (rng.uniform(0, W), rng.uniform(H - 40, H + 80))
    ctrl = ((start[0] + HX) / 2 + rng.uniform(-180, 180), (start[1] + HY) / 2 + rng.uniform(-180, 180))
    steps = 120
    alpha = rng.randint(16, 42)
    for i in range(0, steps, 2):
        a = bezier(start, ctrl, (HX, HY), i / steps)
        b = bezier(start, ctrl, (HX, HY), (i + 1) / steps)
        d.line([(s(a[0]), s(a[1])), (s(b[0]), s(b[1]))], fill=BONE + (alpha,), width=s(1))

# Measured axis along the leading edge.
for i in range(0, 61):
    y = 140 + i * 22
    length = 18 if i % 10 == 0 else 8 if i % 5 == 0 else 4
    d.line([(s(W - 72), s(y)), (s(W - 72 + length), s(y))], fill=BONE + (70 if i % 10 == 0 else 34,), width=s(1))

# The signal route: one orange path with 27 stops, arriving at the hub.
route = [(110, 230), (300, 300), (470, 420), (520, 610), (690, 720), (760, 900), (HX, HY)]

def catmull(points, samples=40):
    out = []
    pts = [points[0]] + points + [points[-1]]
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for j in range(samples):
            t = j / samples
            t2, t3 = t * t, t * t * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append((x, y))
    out.append(points[-1])
    return out

path = catmull(route)

# Soft glow under the signal route.
glow_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow_layer)
gd.line([(s(x), s(y)) for x, y in path], fill=ORANGE + (120,), width=s(14), joint="curve")
glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(s(18)))
layer = Image.alpha_composite(layer, glow_layer)
d = ImageDraw.Draw(layer)
d.line([(s(x), s(y)) for x, y in path], fill=ORANGE + (255,), width=s(2), joint="curve")

# 27 evenly spaced stops along the route.
lengths = [0.0]
for (x0, y0), (x1, y1) in zip(path, path[1:]):
    lengths.append(lengths[-1] + math.hypot(x1 - x0, y1 - y0))
total = lengths[-1]
for k in range(27):
    target = total * k / 26
    i = next(i for i, L in enumerate(lengths) if L >= target)
    x, y = path[i]
    r = 4.5 if k % 9 == 0 else 2.6
    d.ellipse([s(x - r), s(y - r), s(x + r), s(y + r)], fill=INK + (255,), outline=ORANGE + (255,), width=s(1.4))

# Hub: concentric rings, decaying.
for i, rad in enumerate([10, 26, 48, 78, 116, 164]):
    a = max(14, 210 - i * 40)
    d.ellipse([s(HX - rad), s(HY - rad), s(HX + rad), s(HY + rad)], outline=ORANGE + (a,), width=s(1.2))
d.ellipse([s(HX - 5), s(HY - 5), s(HX + 5), s(HY + 5)], fill=ORANGE + (255,))

img = Image.alpha_composite(img.convert("RGBA"), layer)

# Typography — clinical annotations only.
t = ImageDraw.Draw(img)
mono = ImageFont.truetype(str(FONTS / "GeistMono-Regular.ttf"), s(13))
mono_small = ImageFont.truetype(str(FONTS / "GeistMono-Regular.ttf"), s(11))
title = ImageFont.truetype(str(FONTS / "Jura-Light.ttf"), s(30))

def spaced(text: str, spacing: int) -> str:
    return (" " * spacing).join(text)

t.text((s(72), s(72)), spaced("FULL SPEED", 1), font=title, fill=BONE + (235,))
t.text((s(74), s(118)), "ACQUISITION / FIELD SURVEY 01", font=mono_small, fill=SLATE + (200,))
t.text((s(HX + 34), s(HY - 34)), "DISPATCH", font=mono_small, fill=ORANGE + (230,))
t.text((s(HX + 34), s(HY - 18)), "27 / 27", font=mono_small, fill=BONE + (150,))
t.text((s(72), s(H - 96)), "30.0444° N   31.2357° E", font=mono, fill=BONE + (170,))
t.text((s(72), s(H - 72)), "ROUTES OBSERVED 140  ·  STOPS 27  ·  ARRIVAL 1", font=mono_small, fill=SLATE + (190,))

final = img.convert("RGB").resize((W, H), Image.LANCZOS)
OUT.parent.mkdir(parents=True, exist_ok=True)
final.save(OUT, quality=90, optimize=True, progressive=True)
print(f"wrote {OUT} {final.size}")
