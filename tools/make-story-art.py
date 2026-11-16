"""
Placeholder art for the storytelling examples in the demo mission:

  portraits/   close-ups for the story dialogue box, cut from the top of each avatar picture
  objects/     the boulders of the rockfall, and the three hydroponics critters

Run from the repository root:  python3 tools/make-story-art.py
Real portraits should be drawn as portraits; these are enlarged crops and look like it.
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

root = os.path.join(os.path.dirname(__file__), '..', 'scenarios', 'assets', 'starship')
os.makedirs(f'{root}/portraits', exist_ok=True)

# ---------------------------------------------------------------- portraits
SIZE = 320
for n in range(1, 10):
    art = Image.open(f'{root}/avatars/avatar-{n}.png').convert('RGBA')
    band = art.crop((0, 0, art.width, int(art.height * 0.36)))
    box = band.getbbox() or (0, 0, art.width, band.height)
    side = int(art.height * 0.44)
    cx = (box[0] + box[2]) // 2
    left = max(0, min(art.width - side, cx - side // 2))
    head = art.crop((left, 0, left + side, side)).resize((SIZE, SIZE), Image.LANCZOS)
    # A soft backdrop, so the close-up reads as a portrait and not a cut-out.
    back = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(back)
    for r in range(SIZE, 0, -8):
        t = r / SIZE
        d.ellipse([SIZE / 2 - r, SIZE * 0.45 - r, SIZE / 2 + r, SIZE * 0.45 + r], fill=(int(40 + 60 * (1 - t)), int(52 + 70 * (1 - t)), int(96 + 90 * (1 - t)), 255))
    back.alpha_composite(head)
    back.convert('RGB').save(f'{root}/portraits/avatar-{n}.png')
# Captain Vega shares her picture with the ninth avatar; her portrait gets a gold backdrop.
art = Image.open(f'{root}/portraits/avatar-9.png').convert('RGB')
r, g, b = art.split()
Image.merge('RGB', (r.point(lambda v: min(255, int(v * 1.12) + 10)), g.point(lambda v: min(255, int(v * 1.04))), b.point(lambda v: int(v * 0.82)))).save(f'{root}/portraits/captain.png')

# ------------------------------------------------------------------ boulders
S = 3
def rock(d, cx, cy, r, seed):
    random.seed(seed)
    pts = []
    for k in range(9):
        a = k * math.tau / 9
        rr = r * random.uniform(0.78, 1.0)
        pts.append(((cx + rr * math.cos(a)) * S, (cy + rr * 0.82 * math.sin(a)) * S))
    shade = random.randint(-12, 12)
    d.polygon(pts, fill=(124 + shade, 116 + shade, 108 + shade, 255), outline=(52, 46, 44, 255))
    d.line(pts[5:8], fill=(170 + shade, 162 + shade, 150 + shade, 255), width=3 * S)

img = Image.new('RGBA', (300 * S, 190 * S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
for i, (x, y, r) in enumerate(((70, 130, 52), (232, 136, 48), (150, 118, 66), (110, 62, 40), (196, 70, 44), (150, 30, 26))):
    rock(d, x, y, r, 40 + i)
img.resize((300, 190), Image.LANCZOS).save(f'{root}/objects/boulders.png')
img = Image.new('RGBA', (120 * S, 110 * S), (0, 0, 0, 0))
rock(ImageDraw.Draw(img), 60, 55, 50, 7)
img.resize((120, 110), Image.LANCZOS).save(f'{root}/objects/boulder.png')

# ------------------------------------------------------------------ critters
def critter(name, body, eye):
    img = Image.new('RGBA', (110 * S, 96 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    P = lambda *pts: [(x * S, y * S) for x, y in pts]
    out = (38, 42, 60, 255)
    for x in (30, 80):                                                          # antennae
        d.line(P((x, 30), (x - 6 if x < 55 else x + 6, 8)), fill=out, width=3 * S)
        d.ellipse(P((x - 11 if x < 55 else x + 1, 2), (x - 1 if x < 55 else x + 11, 12)), fill=eye, outline=out, width=2 * S)
    d.ellipse(P((14, 24), (96, 84)), fill=body, outline=out, width=3 * S)       # body
    d.ellipse(P((24, 30), (60, 52)), fill=tuple(min(255, c + 50) for c in body[:3]) + (255,))  # shine
    for x in (40, 70):                                                          # eyes
        d.ellipse(P((x - 9, 44), (x + 9, 62)), fill=(255, 255, 255, 255), outline=out, width=2 * S)
        d.ellipse(P((x - 4, 50), (x + 4, 58)), fill=out)
    d.arc(P((44, 58), (66, 74)), 20, 160, fill=out, width=3 * S)                # smile
    for x in (30, 55, 80):                                                      # feet
        d.ellipse(P((x - 8, 80), (x + 8, 92)), fill=out)
    img.resize((110, 96), Image.LANCZOS).save(f'{root}/objects/{name}.png')

critter('critter-a', (110, 200, 140, 255), (255, 214, 74, 255))
critter('critter-b', (240, 150, 90, 255), (120, 220, 255, 255))
critter('critter-c', (150, 140, 240, 255), (255, 150, 200, 255))
print('wrote portraits, boulders and critters')

# ------------------------------------------------------- a sprite-sheet avatar
# "Sprocket": 6 frames across, 3 down. Row 1: idle (frames 0-1). Row 2: walk (6-11).
# Row 3: jump (12-14) and dance (15-17). The demo defines those animations on the sheet.
FW, FH, COLS, ROWS = 120, 180, 6, 3
sheet = Image.new('RGBA', (FW * COLS * S, FH * ROWS * S), (0, 0, 0, 0))
sd = ImageDraw.Draw(sheet)
OUTLINE, BODY, LIGHT, DARK, EYE = (30, 36, 54, 255), (86, 170, 220, 255), (150, 215, 245, 255), (52, 96, 150, 255), (255, 226, 110, 255)

def robot(frame, bob=0, lean=0, legs=(0, 0), arms=(20, -20), squash=0, lift=0):
    ox, oy = (frame % COLS) * FW, (frame // COLS) * FH
    P = lambda *pts: [((ox + x + lean * (170 - y) / 110) * S, (oy + y) * S) for x, y in pts]
    ground, hip = 172 - lift, 122 - lift + squash + bob
    for side, swing in ((-1, legs[0]), (1, legs[1])):                              # legs and feet
        knee = (60 + side * 13 + swing * 0.5, hip + 26)
        foot = (60 + side * 13 + swing, min(ground, hip + 50))
        sd.line(P((60 + side * 13, hip), knee, foot), fill=OUTLINE, width=13 * S)
        sd.line(P((60 + side * 13, hip), knee, foot), fill=DARK, width=8 * S)
        sd.ellipse(P((foot[0] - 11, foot[1] - 6), (foot[0] + 13, foot[1] + 8)), fill=OUTLINE)
    top = 64 - lift + squash * 2 + bob
    for side, angle in ((-1, arms[0]), (1, arms[1])):                              # arms
        sh = (60 + side * 30, top + 14)
        hand = (sh[0] + side * 16 + math.sin(math.radians(angle)) * 10 * side, sh[1] + math.cos(math.radians(angle)) * 40)
        sd.line(P(sh, hand), fill=OUTLINE, width=11 * S)
        sd.line(P(sh, hand), fill=LIGHT, width=6 * S)
        sd.ellipse(P((hand[0] - 7, hand[1] - 7), (hand[0] + 7, hand[1] + 7)), fill=EYE, outline=OUTLINE, width=2 * S)
    sd.rounded_rectangle(P((30, top), (90, hip + 6)), 14 * S, fill=BODY, outline=OUTLINE, width=3 * S)   # body
    sd.rounded_rectangle(P((44, top + 14), (76, top + 34)), 5 * S, fill=LIGHT, outline=OUTLINE, width=2 * S)
    head = top - 46
    sd.line(P((60, head), (60, head - 12)), fill=OUTLINE, width=3 * S)                                   # antenna
    sd.ellipse(P((54, head - 22), (66, head - 10)), fill=EYE, outline=OUTLINE, width=2 * S)
    sd.rounded_rectangle(P((32, head), (88, top + 2)), 16 * S, fill=LIGHT, outline=OUTLINE, width=3 * S)  # head
    for x in (48, 72):
        sd.ellipse(P((x - 7, head + 14), (x + 7, head + 28)), fill=OUTLINE)
        sd.ellipse(P((x - 3, head + 17), (x + 2, head + 22)), fill=EYE)
    sd.arc(P((48, head + 24), (72, head + 40)), 20, 160, fill=OUTLINE, width=3 * S)

robot(0); robot(1, bob=3)                                                                     # idle: a gentle breath
for i, (a, b) in enumerate(((16, -16), (10, -8), (0, 0), (-16, 16), (-8, 10), (0, 0))):      # walk
    robot(6 + i, bob=abs(a) // 8, legs=(a, b), arms=(-a * 2, -b * 2))
robot(12, squash=10, arms=(40, -40)); robot(13, lift=26, arms=(150, -150), legs=(-6, 6)); robot(14, lift=12, arms=(110, -110))   # jump
robot(15, lean=10, arms=(150, 30), legs=(8, 0)); robot(16, bob=5, arms=(60, -60)); robot(17, lean=-10, arms=(-30, -150), legs=(0, -8))  # dance
sheet = sheet.resize((FW * COLS, FH * ROWS), Image.LANCZOS)
sheet.save(f'{root}/avatars/sprocket-sheet.png')
# Its close-up: the top third of the first frame, as the editor makes one.
back = Image.new('RGBA', (FW, FH // 3), (58, 76, 132, 255))
back.alpha_composite(sheet.crop((0, 0, FW, FH // 3)))
back.resize((FW * 2, FH // 3 * 2), Image.LANCZOS).convert('RGB').save(f'{root}/portraits/sprocket.png')
print('wrote the sprite-sheet avatar')
