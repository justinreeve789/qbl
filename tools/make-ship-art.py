"""
Draws the placeholder backgrounds for the starship's corridor, crew quarters, hydroponics bay
and engine room. Like the quest art, these are drawn by code so the repository contains no
third-party artwork; replace them with real art when it exists.

    python3 tools/make-ship-art.py
"""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

root = os.path.join(os.path.dirname(__file__), '..', 'scenarios', 'assets', 'starship', 'backgrounds')

def font(size):
    for path in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/Library/Fonts/Arial Bold.ttf'):
        if os.path.exists(path): return ImageFont.truetype(path, size)
    return ImageFont.load_default()

def gradient(w, h, top, bottom):
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return img

def room(w, h, floor_y, wall_top, wall_bottom, floor_top, floor_bottom, seed):
    """A room seen from the front: a back wall with panel seams, and a floor with receding plates."""
    random.seed(seed)
    img = gradient(w, h, wall_top, wall_bottom)
    d = ImageDraw.Draw(img)
    for x in range(0, w, 250):
        d.line([(x, 0), (x, floor_y)], fill=tuple(max(0, c - 14) for c in wall_bottom), width=4)
    d.rectangle([0, 150, w, 166], fill=tuple(min(255, c + 22) for c in wall_top))
    img.paste(gradient(w, h - floor_y, floor_top, floor_bottom), (0, floor_y))
    d = ImageDraw.Draw(img)
    for i in range(1, 7):
        y = floor_y + (h - floor_y) * (i / 7) ** 1.6
        d.line([(0, y), (w, y)], fill=tuple(max(0, c - 18) for c in floor_top), width=3)
    for x in range(-w, 2 * w, 300):
        d.line([(w / 2 + (x - w / 2) * 0.55, floor_y), (x, h)], fill=tuple(max(0, c - 18) for c in floor_top), width=3)
    d.rectangle([0, floor_y - 10, w, floor_y + 6], fill=tuple(max(0, c - 40) for c in wall_bottom))
    return img, d

def glow(img, box, colour, blur=40):
    layer = Image.new('RGB', img.size, (0, 0, 0))
    ImageDraw.Draw(layer).ellipse(box, fill=colour)
    return Image.composite(img, Image.blend(img, Image.eval(layer.filter(ImageFilter.GaussianBlur(blur)), lambda v: v), 0.0), Image.new('L', img.size, 255)) if False else \
        Image.fromarray(__import__('numpy').clip(__import__('numpy').asarray(img, dtype='int16') + __import__('numpy').asarray(layer.filter(ImageFilter.GaussianBlur(blur)), dtype='int16'), 0, 255).astype('uint8'))

def sign(d, xy, text, size=34, fill=(215, 235, 255)):
    d.text(xy, text, font=font(size), fill=fill, anchor='mm')

def door(d, x0, y0, x1, y1, frame=(60, 70, 90), leaf=(120, 140, 170)):
    d.rounded_rectangle([x0 - 14, y0 - 14, x1 + 14, y1], 18, fill=frame)
    d.rounded_rectangle([x0, y0, x1, y1], 10, fill=leaf)
    d.line([((x0 + x1) / 2, y0), ((x0 + x1) / 2, y1)], fill=frame, width=6)

# ------------------------------------------------------------------ main corridor
# Seen down its length, so the floor narrows towards a door at the far end. The scene's scale
# area shrinks avatars as they walk up the screen, which is what sells the depth.
W, H = 1800, 1200
img = gradient(W, H, (26, 32, 52), (44, 54, 82))
d = ImageDraw.Draw(img)
far = dict(l=670, r=1130, t=330, b=580)
d.polygon([(0, 0), (W, 0), (far['r'], far['t']), (far['l'], far['t'])], fill=(36, 44, 68))                      # ceiling
d.polygon([(0, 0), (far['l'], far['t']), (far['l'], far['b']), (0, H)], fill=(58, 70, 104))                      # left wall
d.polygon([(W, 0), (far['r'], far['t']), (far['r'], far['b']), (W, H)], fill=(50, 62, 96))                      # right wall
d.polygon([(0, H), (W, H), (far['r'], far['b']), (far['l'], far['b'])], fill=(84, 92, 112))                     # floor
d.rectangle([far['l'], far['t'], far['r'], far['b']], fill=(40, 48, 74))                                        # end wall
for i in range(1, 9):                                                                                          # ribs receding into the distance
    t = (i / 9) ** 1.7
    lx, rx = far['l'] * (1 - t), W - (W - far['r']) * (1 - t)
    ty, by = far['t'] * (1 - t), H - (H - far['b']) * (1 - t)
    d.line([(lx, ty), (lx, by)], fill=(40, 50, 78), width=5)
    d.line([(rx, ty), (rx, by)], fill=(36, 46, 74), width=5)
    d.line([(lx, by), (rx, by)], fill=(66, 74, 94), width=4)
    d.line([(lx, ty), (rx, ty)], fill=(70, 86, 130), width=6)                                                   # ceiling lights
d.line([(W / 2, H), (W / 2, far['b'])], fill=(120, 170, 220), width=6)                                          # guide line on the floor
door(d, 800, 390, 1000, 580)
sign(d, (900, 360), 'ENGINE ROOM', 24)
# Side doors, drawn in perspective on each wall about half way along.
d.polygon([(250, 430), (430, 480), (430, 802), (250, 969)], fill=(128, 150, 184)); d.polygon([(250, 430), (430, 480), (430, 500), (250, 455)], fill=(60, 70, 90))
d.polygon([(1550, 430), (1370, 480), (1370, 802), (1550, 969)], fill=(120, 142, 176)); d.polygon([(1550, 430), (1370, 480), (1370, 500), (1550, 455)], fill=(60, 70, 90))
sign(d, (340, 400), 'CREW', 30); sign(d, (1460, 400), 'HYDROPONICS', 26)
img = glow(img, [760, 250, 1040, 420], (40, 60, 90), 60)
img.save(f'{root}/corridor.jpg', quality=86)

# ------------------------------------------------------------------ crew quarters
W, H = 2250, 1200
img, d = room(W, H, 800, (70, 58, 86), (104, 88, 120), (120, 104, 96), (84, 72, 70), 1)
for i, x in enumerate((180, 700, 1220)):                                                                        # bunks set into the wall
    d.rounded_rectangle([x, 260, x + 440, 760], 30, fill=(48, 40, 62))
    for y in (300, 530):
        d.rounded_rectangle([x + 24, y, x + 416, y + 200], 22, fill=(30, 26, 44))
        d.rounded_rectangle([x + 40, y + 120, x + 400, y + 186], 16, fill=((176, 120, 110), (110, 150, 176), (150, 170, 120))[i])
        d.ellipse([x + 60, y + 96, x + 150, y + 146], fill=(232, 226, 214))
d.rounded_rectangle([1760, 300, 2020, 560], 130, fill=(18, 22, 44)); d.ellipse([1790, 330, 1990, 530], fill=(10, 12, 30))   # porthole
random.seed(4)
for _ in range(40):
    x, y = random.randint(1800, 1980), random.randint(340, 520)
    if (x - 1890) ** 2 + (y - 430) ** 2 < 95 ** 2: d.point((x, y), fill=(255, 255, 255))
d.ellipse([1905, 380, 1965, 440], fill=(96, 150, 200))
d.rounded_rectangle([1740, 620, 2040, 800], 14, fill=(90, 76, 70)); d.rectangle([1770, 590, 1850, 620], fill=(200, 190, 160))    # desk and book
door(d, 2120, 420, 2250, 800)
sign(d, (1125, 110), 'CREW QUARTERS', 44)
img.save(f'{root}/crew-quarters.jpg', quality=86)

# ------------------------------------------------------------------ hydroponics bay
img, d = room(W, H, 800, (38, 78, 70), (60, 112, 96), (96, 120, 112), (62, 84, 80), 2)
random.seed(7)
for x in range(260, 2000, 290):                                                                                 # racks of plants under grow lights
    d.rectangle([x, 230, x + 230, 250], fill=(230, 160, 240))
    for shelf in (360, 540, 720):
        d.rectangle([x - 10, shelf, x + 240, shelf + 18], fill=(40, 60, 58))
        d.rounded_rectangle([x, shelf - 34, x + 230, shelf], 8, fill=(70, 130, 170))                            # trays of nutrient water
        for k in range(6):
            px = x + 20 + k * 38
            hgt = random.randint(50, 110)
            d.line([(px, shelf - 30), (px + random.randint(-8, 8), shelf - 30 - hgt)], fill=(60, 150, 70), width=6)
            for j in range(3):
                ly = shelf - 40 - hgt * (j + 1) / 3.2
                d.ellipse([px - 22, ly - 9, px, ly + 9], fill=(84, 186, 92)); d.ellipse([px, ly - 12, px + 22, ly + 6], fill=(70, 170, 84))
d.rounded_rectangle([2040, 380, 2200, 800], 16, fill=(52, 96, 110)); d.ellipse([2070, 420, 2170, 520], fill=(120, 200, 220))  # water tank and gauge
door(d, 0, 420, 130, 800)
sign(d, (1125, 110), 'HYDROPONICS BAY', 44)
img = glow(img, [200, 150, 2050, 360], (50, 20, 56), 70)
img.save(f'{root}/hydroponics.jpg', quality=86)

# ------------------------------------------------------------------ engine room
img, d = room(W, H, 800, (52, 44, 40), (84, 70, 62), (92, 88, 90), (58, 56, 60), 3)
d.rounded_rectangle([760, 200, 1490, 800], 60, fill=(40, 44, 56))                                               # reactor housing
d.ellipse([900, 270, 1350, 720], fill=(20, 28, 48)); d.ellipse([960, 330, 1290, 660], fill=(60, 150, 230)); d.ellipse([1030, 400, 1220, 590], fill=(190, 235, 255))
for a in range(0, 360, 30):                                                                                     # bolts round the window
    d.ellipse([1125 + 250 * math.cos(math.radians(a)) - 9, 495 + 250 * math.sin(math.radians(a)) - 9, 1125 + 250 * math.cos(math.radians(a)) + 9, 495 + 250 * math.sin(math.radians(a)) + 9], fill=(120, 126, 140))
for x0, x1 in ((120, 760), (1490, 2130)):                                                                       # pipes
    for y, c in ((300, (170, 96, 60)), (380, (96, 140, 170)), (460, (150, 150, 156))):
        d.rounded_rectangle([x0, y, x1, y + 36], 18, fill=c)
        for fx in range(int(x0) + 90, int(x1), 180): d.rectangle([fx, y - 6, fx + 22, y + 42], fill=(70, 70, 78))
d.rounded_rectangle([200, 560, 560, 800], 14, fill=(46, 50, 62))                                                # control desk
for k, c in enumerate(((90, 220, 120), (240, 200, 80), (230, 90, 80), (90, 180, 240))):
    d.ellipse([240 + k * 80, 600, 280 + k * 80, 640], fill=c)
d.rectangle([240, 680, 520, 760], fill=(20, 60, 50)); d.line([(250, 740), (320, 700), (390, 730), (460, 690), (510, 710)], fill=(110, 240, 160), width=5)
d.rounded_rectangle([1700, 560, 2050, 800], 14, fill=(46, 50, 62)); d.rectangle([1740, 600, 2010, 760], fill=(24, 30, 60))
sign(d, (1875, 680), 'OUTPUT', 30, (140, 200, 255))
sign(d, (1125, 110), 'ENGINE ROOM', 44)
img = glow(img, [820, 200, 1430, 790], (30, 60, 96), 80)
img.save(f'{root}/engine-room.jpg', quality=86)
print('wrote corridor, crew-quarters, hydroponics, engine-room')
