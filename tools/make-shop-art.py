"""
Draws placeholder pictures for the marketplace's platform items (hats, a jetpack, pets...).
Drawn by code so the repository contains no third-party artwork; replace with real art.

    python3 tools/make-shop-art.py
"""
import os
from PIL import Image, ImageDraw

root = os.path.join(os.path.dirname(__file__), '..', 'scenarios', 'assets', 'shop')
os.makedirs(root, exist_ok=True)
S = 4  # drawn large and shrunk, for smooth edges

def canvas(w, h):
    img = Image.new('RGBA', (w * S, h * S), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)
def P(*pts): return [(x * S, y * S) for x, y in pts]
def save(img, name, w, h): img.resize((w, h), Image.LANCZOS).save(os.path.join(root, name))
OUT = (30, 34, 46, 255)

img, d = canvas(120, 80)   # star cap
d.pieslice(P((20, 14), (100, 94)), 180, 360, fill=(52, 120, 220, 255), outline=OUT, width=3 * S)
d.rounded_rectangle(P((6, 50), (84, 62)), 6 * S, fill=(36, 90, 180, 255), outline=OUT, width=3 * S)
d.regular_polygon((60 * S, 34 * S, 11 * S), 5, fill=(255, 214, 74, 255), outline=OUT)
save(img, 'star-cap.png', 120, 80)

img, d = canvas(140, 90)   # explorer hat
d.ellipse(P((4, 52), (136, 84)), fill=(170, 124, 70, 255), outline=OUT, width=3 * S)
d.rounded_rectangle(P((36, 10), (104, 66)), 22 * S, fill=(196, 148, 88, 255), outline=OUT, width=3 * S)
d.rectangle(P((36, 48), (104, 58)), fill=(110, 60, 40, 255))
save(img, 'explorer-hat.png', 140, 90)

img, d = canvas(130, 130)  # space helmet
d.ellipse(P((6, 6), (124, 124)), fill=(232, 238, 246, 255), outline=OUT, width=4 * S)
d.ellipse(P((24, 28), (106, 100)), fill=(70, 150, 220, 200), outline=OUT, width=3 * S)
d.arc(P((34, 36), (80, 80)), 190, 260, fill=(255, 255, 255, 230), width=5 * S)
save(img, 'space-helmet.png', 130, 130)

img, d = canvas(130, 110)  # flight jacket
d.polygon(P((30, 8), (100, 8), (124, 36), (106, 50), (100, 102), (30, 102), (24, 50), (6, 36)), fill=(190, 96, 44, 255), outline=OUT)
d.line(P((65, 8), (65, 102)), fill=OUT, width=3 * S)
d.rectangle(P((30, 92), (100, 102)), fill=(120, 60, 30, 255)); d.ellipse(P((38, 30), (54, 46)), fill=(255, 214, 74, 255), outline=OUT)
save(img, 'flight-jacket.png', 130, 110)

img, d = canvas(110, 140)  # jetpack
for x in (8, 60):
    d.rounded_rectangle(P((x, 8), (x + 42, 104)), 18 * S, fill=(196, 204, 216, 255), outline=OUT, width=3 * S)
    d.polygon(P((x + 6, 104), (x + 36, 104), (x + 21, 136)), fill=(255, 150, 40, 255), outline=OUT)
d.rectangle(P((44, 34), (66, 60)), fill=(220, 70, 60, 255), outline=OUT)
save(img, 'jetpack.png', 110, 140)

img, d = canvas(130, 150)  # hero cape
d.polygon(P((24, 6), (106, 6), (126, 140), (96, 124), (65, 146), (34, 124), (4, 140)), fill=(200, 48, 70, 255), outline=OUT)
d.rectangle(P((24, 6), (106, 18)), fill=(255, 214, 74, 255), outline=OUT)
save(img, 'hero-cape.png', 130, 150)

img, d = canvas(90, 110)   # scanner
d.rounded_rectangle(P((14, 6), (76, 78)), 10 * S, fill=(60, 70, 92, 255), outline=OUT, width=3 * S)
d.rectangle(P((24, 16), (66, 50)), fill=(90, 220, 150, 255)); d.line(P((28, 40), (40, 28), (50, 38), (62, 22)), fill=(20, 60, 40, 255), width=3 * S)
d.rounded_rectangle(P((34, 78), (56, 106)), 6 * S, fill=(40, 46, 60, 255), outline=OUT, width=3 * S)
save(img, 'scanner.png', 90, 110)

img, d = canvas(130, 110)  # robo-pup
d.rounded_rectangle(P((26, 40), (104, 86)), 14 * S, fill=(150, 170, 196, 255), outline=OUT, width=3 * S)
d.rounded_rectangle(P((70, 14), (122, 58)), 12 * S, fill=(176, 194, 216, 255), outline=OUT, width=3 * S)
d.ellipse(P((98, 28), (110, 40)), fill=(80, 220, 250, 255), outline=OUT); d.polygon(P((76, 14), (86, 0), (92, 16)), fill=(150, 170, 196, 255), outline=OUT)
for x in (34, 54, 76, 92): d.rounded_rectangle(P((x, 84), (x + 10, 106)), 3 * S, fill=(96, 110, 134, 255), outline=OUT)
d.line(P((26, 50), (8, 34)), fill=OUT, width=5 * S)
save(img, 'robo-pup.png', 130, 110)

img, d = canvas(120, 100)  # glow moth
d.ellipse(P((4, 10), (58, 70)), fill=(170, 240, 200, 230), outline=OUT, width=3 * S); d.ellipse(P((62, 10), (116, 70)), fill=(170, 240, 200, 230), outline=OUT, width=3 * S)
d.ellipse(P((14, 56), (56, 94)), fill=(120, 210, 230, 230), outline=OUT, width=3 * S); d.ellipse(P((64, 56), (106, 94)), fill=(120, 210, 230, 230), outline=OUT, width=3 * S)
d.rounded_rectangle(P((52, 16), (68, 88)), 8 * S, fill=(255, 236, 140, 255), outline=OUT, width=3 * S)
save(img, 'glow-moth.png', 120, 100)

for name, colour, glyph in (('bounce', (255, 150, 60), '^'), ('float', (130, 190, 255), '~'), ('translator', (150, 110, 230), 'A'), ('field-guide', (80, 180, 110), 'i')):
    img, d = canvas(100, 100)   # badges for things that are not worn: animations and abilities
    d.ellipse(P((6, 6), (94, 94)), fill=colour + (255,), outline=OUT, width=4 * S)
    if glyph == '^': d.line(P((28, 62), (50, 34), (72, 62)), fill=(255, 255, 255, 255), width=9 * S)
    elif glyph == '~': d.arc(P((24, 36), (52, 64)), 180, 360, fill=(255, 255, 255, 255), width=9 * S); d.arc(P((48, 36), (76, 64)), 0, 180, fill=(255, 255, 255, 255), width=9 * S)
    elif glyph == 'A': d.line(P((30, 72), (50, 26), (70, 72)), fill=(255, 255, 255, 255), width=9 * S); d.line(P((38, 56), (62, 56)), fill=(255, 255, 255, 255), width=8 * S)
    else: d.ellipse(P((43, 22), (57, 36)), fill=(255, 255, 255, 255)); d.rounded_rectangle(P((43, 42), (57, 78)), 5 * S, fill=(255, 255, 255, 255))
    save(img, f'{name}.png', 100, 100)
print('wrote shop art')

img, d = canvas(120, 120)  # spin: a move
d.arc(P((18, 18), (102, 102)), 30, 300, fill=(120, 200, 255, 255), width=12 * S)
d.polygon(P((88, 14), (112, 40), (78, 46)), fill=(120, 200, 255, 255), outline=OUT)
d.ellipse(P((48, 48), (72, 72)), fill=(255, 214, 74, 255), outline=OUT, width=3 * S)
save(img, 'spin.png', 120, 120)

img, d = canvas(120, 120)  # wave: a move
d.rounded_rectangle(P((40, 44), (86, 104)), 16 * S, fill=(255, 205, 150, 255), outline=OUT, width=3 * S)
for x in (42, 54, 66, 78):
    d.rounded_rectangle(P((x, 14), (x + 10, 56)), 5 * S, fill=(255, 205, 150, 255), outline=OUT, width=3 * S)
d.arc(P((90, 20), (116, 60)), 300, 60, fill=(120, 200, 255, 255), width=5 * S)
d.arc(P((4, 20), (30, 60)), 120, 240, fill=(120, 200, 255, 255), width=5 * S)
save(img, 'wave.png', 120, 120)

# ---------------------------------------------------------------- mission-specific items
# Sold only in the Starship Explorer mission, so they live with that scenario's media.
root = os.path.join(os.path.dirname(__file__), '..', 'scenarios', 'assets', 'starship', 'shop')
os.makedirs(root, exist_ok=True)

img, d = canvas(110, 110)  # Wilting Stream mission patch
d.ellipse(P((5, 5), (105, 105)), fill=(40, 96, 110, 255), outline=OUT, width=4 * S)
d.ellipse(P((14, 14), (96, 96)), outline=(240, 226, 150, 255), width=2 * S)
d.line(P((22, 74), (40, 60), (56, 70), (72, 54), (90, 62)), fill=(120, 200, 240, 255), width=6 * S, joint='curve')   # the stream
d.line(P((55, 56), (55, 30)), fill=(90, 190, 100, 255), width=4 * S)                                                 # a plant
d.ellipse(P((40, 30), (56, 44)), fill=(110, 210, 110, 255)); d.ellipse(P((54, 24), (72, 40)), fill=(90, 190, 100, 255))
save(img, 'mission-patch.png', 110, 110)

img, d = canvas(130, 100)  # survey map
d.polygon(P((6, 14), (44, 6), (86, 14), (124, 6), (124, 86), (86, 94), (44, 86), (6, 94)), fill=(236, 222, 180, 255), outline=OUT)
d.line(P((44, 6), (44, 86)), fill=(190, 172, 130, 255), width=2 * S); d.line(P((86, 14), (86, 94)), fill=(190, 172, 130, 255), width=2 * S)
d.line(P((14, 70), (36, 52), (60, 60), (82, 40), (114, 30)), fill=(90, 160, 220, 255), width=5 * S, joint='curve')
for x, y in ((30, 56), (66, 54), (104, 33)):
    d.ellipse(P((x - 6, y - 6), (x + 6, y + 6)), fill=(220, 70, 60, 255), outline=OUT)
save(img, 'survey-map.png', 130, 100)
print('wrote mission items')
