"""Generate placeholder art for the Wilting Stream quest.

    python3 tools/make-quest-art.py scenarios/assets/starship <path to laboratory source image>

The three new planet scenes are made from the two existing planet paintings
(mirrored and recoloured) with a stream, plants and an old lander drawn on
top. Sprites and lab read-outs are drawn from scratch. Everything here is a
stand-in that an artist can replace file for file.
"""
import math, random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

root = sys.argv[1]
lab_source = sys.argv[2] if len(sys.argv) > 2 else None
W, H = 2250, 1200            # display size of a planet scene
SS = 2                       # supersampling for smooth edges

def font(size, bold=False):
    name = 'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'
    try:
        return ImageFont.truetype(f'/usr/share/fonts/truetype/dejavu/{name}', size)
    except OSError:
        return ImageFont.load_default()

def recolour(img, hue_shift=0, saturation=1.0, value=1.0):
    h, s, v = img.convert('HSV').split()
    h = h.point(lambda p: (p + hue_shift) % 256)
    s = s.point(lambda p: min(255, int(p * saturation)))
    v = v.point(lambda p: min(255, int(p * value)))
    return Image.merge('HSV', (h, s, v)).convert('RGB')

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))

# ------------------------------------------------------------------ plants

def plant(healthy, seed=0, size=220):
    """An alien bulb plant: glowing and upright when healthy, drooping and blotched when not."""
    rnd = random.Random(seed)
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    stem = (38, 150, 120, 255) if healthy else (120, 110, 60, 255)
    bulb = (70, 235, 215, 255) if healthy else (150, 125, 70, 255)
    glow = (190, 255, 245, 255) if healthy else (175, 150, 95, 255)
    base = (S * 0.5, S * 0.96)
    stems = [(-0.30, 0.62), (0.0, 0.86), (0.30, 0.66)]
    for i, (lean, height) in enumerate(stems):
        droop = 0 if healthy else (0.20 if lean >= 0 else -0.20) + rnd.uniform(-0.04, 0.04)
        height *= 1.0 if healthy else 0.72
        pts = []
        for k in range(21):
            t = k / 20
            x = base[0] + (lean * t + droop * t * t) * S * 0.75
            y = base[1] - height * S * (t - (0 if healthy else 0.38 * t * t))
            pts.append((x, y))
        d.line(pts, fill=stem, width=int(S * 0.035), joint='curve')
        tip = pts[-1]
        r = S * (0.12 if i == 1 else 0.095) * (1.0 if healthy else 0.85)
        d.ellipse([tip[0] - r, tip[1] - r * 1.15, tip[0] + r, tip[1] + r * 1.15], fill=bulb, outline=(20, 60, 60, 255), width=int(S * 0.008))
        if healthy:
            d.ellipse([tip[0] - r * 0.55, tip[1] - r * 0.8, tip[0] - r * 0.05, tip[1] - r * 0.2], fill=glow)
        else:
            for _ in range(4):
                a, rr = rnd.uniform(0, 6.28), rnd.uniform(0.15, 0.6) * r
                sx, sy = tip[0] + math.cos(a) * rr, tip[1] + math.sin(a) * rr
                q = r * rnd.uniform(0.14, 0.24)
                d.ellipse([sx - q, sy - q, sx + q, sy + q], fill=(225, 200, 60, 255))
    # leaves at the base
    for side in (-1, 1):
        lx = base[0] + side * S * 0.16
        col = (30, 120, 100, 255) if healthy else (105, 95, 55, 255)
        d.polygon([(base[0], base[1]), (lx, base[1] - S * (0.16 if healthy else 0.05)), (lx + side * S * 0.10, base[1] - S * 0.01)], fill=col)
    return im.resize((size, size), Image.LANCZOS)

# ------------------------------------------------------------------ stream

def stream_y(x, phase):
    return 815 + 22 * math.sin(x / 260 + phase) + 9 * math.sin(x / 90 + phase * 2)

def draw_stream(img, colour_at, phase=0.0, x0=0, x1=W):
    """A meandering band of water. colour_at(x) gives its colour, so it can change along its length."""
    layer = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    step = 10
    for x in range(x0, x1, step):
        y0, y1 = stream_y(x, phase), stream_y(x + step, phase)
        c = colour_at(x)
        d.polygon([(x * SS, (y0 - 20) * SS), ((x + step) * SS + 1, (y1 - 20) * SS), ((x + step) * SS + 1, (y1 + 24) * SS), (x * SS, (y0 + 24) * SS)], fill=c + (240,))
        bank = lerp(c, (15, 25, 60), 0.55) + (255,)
        d.line([(x * SS, (y0 - 20) * SS), ((x + step) * SS, (y1 - 20) * SS)], fill=bank, width=3 * SS)
        d.line([(x * SS, (y0 + 24) * SS), ((x + step) * SS, (y1 + 24) * SS)], fill=bank, width=3 * SS)
        if (x // step) % 7 == 0:
            d.line([(x * SS, (y0 - 6) * SS), ((x + 40) * SS, (stream_y(x + 40, phase) - 6) * SS)], fill=lerp(c, (255, 255, 255), 0.55) + (200,), width=3 * SS)
    layer = layer.resize((W, H), Image.LANCZOS)
    img.paste(layer, (0, 0), layer)

CLEAR = (58, 132, 236)
MURKY = (176, 178, 58)

def scatter_plants(img, healthy, xs, seed):
    rnd = random.Random(seed)
    for i, x in enumerate(xs):
        size = rnd.randint(110, 150)
        p = plant(healthy, seed * 100 + i, size)
        y = int(stream_y(x, 0) + 30 + rnd.randint(0, 22))
        img.paste(p, (int(x - size / 2), y - size), p)

# ------------------------------------------------------------------ lander

def lander():
    S = 4
    im = Image.new('RGBA', (460 * S, 420 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    def P(*pts): return [(x * S, y * S) for x, y in pts]
    steel, dark, light = (150, 160, 175, 255), (70, 78, 95, 255), (205, 212, 225, 255)
    for x0, x1 in ((120, 60), (300, 370), (210, 215)):                       # legs
        d.line(P((x0, 250), (x1, 360)), fill=dark, width=10 * S)
        d.ellipse([(x1 - 22) * S, 352 * S, (x1 + 22) * S, 370 * S], fill=dark)
    d.polygon(P((110, 250), (310, 250), (345, 170), (290, 95), (130, 95), (75, 170)), fill=steel, outline=dark)
    d.polygon(P((130, 95), (290, 95), (270, 70), (150, 70)), fill=light, outline=dark)
    d.rectangle([150 * S, 130 * S, 215 * S, 185 * S], fill=(60, 150, 200, 255), outline=dark, width=3 * S)   # window
    d.line(P((230, 70), (250, 20)), fill=dark, width=6 * S)                   # mast and dish
    d.pieslice([205 * S, -20 * S, 300 * S, 60 * S], 20, 160, fill=light, outline=dark, width=3 * S)
    d.rectangle([228 * S, 205 * S, 300 * S, 232 * S], fill=(230, 190, 60, 255), outline=dark, width=2 * S)  # hazard plate
    for k in range(4):
        d.polygon(P((232 + k * 18, 232), (240 + k * 18, 232), (250 + k * 18, 205), (242 + k * 18, 205)), fill=dark)
    # the power cell: a cracked orange cylinder slung under the body
    d.rounded_rectangle([250 * S, 255 * S, 350 * S, 300 * S], radius=18 * S, fill=(235, 120, 40, 255), outline=dark, width=3 * S)
    d.line(P((300, 256), (292, 272), (306, 282), (296, 299)), fill=(40, 20, 10, 255), width=3 * S)             # the crack
    d.polygon(P((292, 298), (304, 298), (301, 345), (295, 345)), fill=(245, 150, 40, 235))                      # the drip
    d.ellipse([262 * S, 338 * S, 338 * S, 362 * S], fill=(240, 160, 50, 215))                                   # the puddle
    im = im.resize((460, 420), Image.LANCZOS)
    return im.rotate(-9, resample=Image.BICUBIC, expand=True)

# ------------------------------------------------------------------ scenes

purple = Image.open(f'{root}/backgrounds/purple-alien-planet.jpg').convert('RGB')
surface = Image.open(f'{root}/backgrounds/alien-planet-surface.jpg').convert('RGB')

# Spring meadow (upstream): bright and green, clear water, healthy plants.
meadow = recolour(purple.resize((W, H), Image.LANCZOS), hue_shift=-52, saturation=0.8, value=1.0)
d = ImageDraw.Draw(meadow, 'RGBA')
d.ellipse([60, 770, 420, 880], fill=CLEAR + (240,), outline=(200, 250, 255, 255), width=4)   # the spring pool
d.ellipse([150, 800, 300, 840], fill=(215, 250, 255, 200))
draw_stream(meadow, lambda x: CLEAR, x0=330)
scatter_plants(meadow, True, [520, 760, 1180, 1420, 1650, 1900, 2120], seed=5)
meadow.save(f'{root}/backgrounds/spring-meadow.jpg', quality=86)

# Lander gully (the source): rocky and rust-tinted. Clear water arrives from the west and leaves murky.
gully = recolour(surface.transpose(Image.FLIP_LEFT_RIGHT).resize((W, H), Image.LANCZOS), hue_shift=118, saturation=0.9, value=0.95)
LANDER_X = 1080
def gully_water(x):
    return CLEAR if x < LANDER_X + 120 else lerp(CLEAR, MURKY, min(1.0, (x - LANDER_X - 120) / 160))
draw_stream(gully, gully_water)
scatter_plants(gully, True, [180, 420, 700], seed=6)
scatter_plants(gully, False, [1520, 1760, 2040], seed=7)
ship = lander()
gully.paste(ship, (LANDER_X - 60, 480), ship)
gully.save(f'{root}/backgrounds/lander-gully.jpg', quality=86)

# Wilting marsh (downstream): dim and purple, murky water, sick plants everywhere.
marsh = recolour(purple.transpose(Image.FLIP_LEFT_RIGHT).resize((W, H), Image.LANCZOS), hue_shift=28, saturation=0.8, value=0.82)
draw_stream(marsh, lambda x: MURKY, phase=1.3)
scatter_plants(marsh, False, [240, 520, 830, 1380, 1640, 1900, 2130], seed=8)
marsh.save(f'{root}/backgrounds/wilting-marsh.jpg', quality=86)

# Laboratory: the corridor-with-consoles painting from the demo's unused art.
if lab_source:
    Image.open(lab_source).convert('RGB').resize((2250, 1750), Image.LANCZOS).save(f'{root}/backgrounds/laboratory.jpg', quality=86)

# ------------------------------------------------------------------ sprites

plant(True, 1, 220).save(f'{root}/objects/plant-healthy.png')
plant(False, 2, 220).save(f'{root}/objects/plant-wilted.png')

# ------------------------------------------------------------------ lab read-outs

PH_COLOURS = [(222, 40, 45), (233, 80, 40), (240, 120, 35), (245, 165, 40), (240, 205, 50), (205, 215, 60), (150, 205, 70),
              (75, 180, 80), (50, 165, 120), (45, 150, 165), (55, 125, 190), (65, 95, 190), (85, 70, 175), (105, 55, 155), (95, 40, 125)]

def ph_scale(pointer=None, caption=None):
    w, h = 760, 250 if pointer is not None else 190
    im = Image.new('RGBA', (w, h), (12, 23, 78, 255))
    d = ImageDraw.Draw(im)
    d.text((20, 12), caption or 'The pH scale', font=font(24, True), fill='white')
    x0, cell, y0 = 20, 48, 60
    for i, c in enumerate(PH_COLOURS):
        d.rectangle([x0 + i * cell, y0, x0 + (i + 1) * cell - 3, y0 + 62], fill=c)
        d.text((x0 + i * cell + cell / 2 - 3, y0 + 18), str(i), font=font(22, True), fill='white', anchor='ma')
    d.text((x0, y0 + 74), 'acid', font=font(20), fill=(255, 190, 170))
    d.text((x0 + 7.5 * cell, y0 + 74), 'neutral', font=font(20), fill=(200, 255, 200), anchor='ma')
    d.text((x0 + 15 * cell - 3, y0 + 74), 'base', font=font(20), fill=(200, 190, 255), anchor='ra')
    if pointer is not None:
        px = x0 + pointer * cell + cell / 2
        d.polygon([(px, y0 + 104), (px - 16, y0 + 132), (px + 16, y0 + 132)], fill='white')
        d.rounded_rectangle([px - 120, y0 + 132, px + 120, y0 + 176], radius=10, fill=PH_COLOURS[pointer], outline='white', width=3)
        d.text((px, y0 + 141), f'test strip: pH {pointer}', font=font(22, True), fill='white', anchor='ma')
    return im

ph_scale().save(f'{root}/lab/ph-scale.png')
for value, name in ((7, 'meadow'), (3, 'gully'), (4, 'marsh')):
    ph_scale(value, f'pH test: {name} sample').save(f'{root}/lab/ph-result-{name}.png')

def microscope(healthy, seed):
    """A view down the microscope: plump green cells, or shrunken ones with broken walls. No microbes in either."""
    rnd = random.Random(seed)
    S, n = 4, 380
    im = Image.new('RGBA', (n * S, n * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([8 * S, 8 * S, (n - 8) * S, (n - 8) * S], fill=(232, 244, 236, 255))
    cell = 62
    for row in range(-1, 7):
        for col in range(-1, 7):
            cx = (col * cell + (cell / 2 if row % 2 else 0) + 30) * S
            cy = (row * cell * 0.86 + 30) * S
            if healthy:
                r = cell * 0.48 * S
                d.regular_polygon((cx, cy, r), 6, rotation=30, fill=(120, 205, 130, 255), outline=(40, 110, 60, 255), width=2 * S)
                for _ in range(3):
                    a, rr = rnd.uniform(0, 6.28), rnd.uniform(0.1, 0.5) * r
                    q = 5 * S
                    d.ellipse([cx + math.cos(a) * rr - q, cy + math.sin(a) * rr - q, cx + math.cos(a) * rr + q, cy + math.sin(a) * rr + q], fill=(40, 140, 70, 255))
            else:
                r = cell * rnd.uniform(0.28, 0.4) * S
                d.regular_polygon((cx + rnd.uniform(-6, 6) * S, cy + rnd.uniform(-6, 6) * S, r), 6, rotation=rnd.uniform(0, 60), fill=(190, 170, 95, 255), outline=(110, 90, 40, 255), width=2 * S)
                if rnd.random() < 0.5:
                    d.line([(cx - r, cy - r * 0.3), (cx + r * 0.4, cy + r * 0.6)], fill=(232, 244, 236, 255), width=3 * S)
    mask = Image.new('L', (n * S, n * S), 0)
    ImageDraw.Draw(mask).ellipse([8 * S, 8 * S, (n - 8) * S, (n - 8) * S], fill=255)
    im.putalpha(mask)
    d = ImageDraw.Draw(im)
    d.ellipse([8 * S, 8 * S, (n - 8) * S, (n - 8) * S], outline=(20, 30, 60, 255), width=10 * S)
    return im.resize((n, n), Image.LANCZOS)

microscope(True, 3).save(f'{root}/lab/cells-healthy.png')
microscope(False, 4).save(f'{root}/lab/cells-damaged.png')
print('quest art written to', root)
