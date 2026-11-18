"""
Placeholder art for the starship hub's ambient touches (scenarios/assets/hub/):

  planet-pass.png     a wide, mostly empty strip with one planet on it. Tiled and scrolled as a
                      background layer of the observation deck, the planet drifts past the
                      window every couple of minutes.
  warning-light.png   a soft amber glow, shown and hidden by an event to make a light blink.

  python3 tools/make-hub-art.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

out = Path(__file__).resolve().parent.parent / 'scenarios' / 'assets' / 'hub'
out.mkdir(parents=True, exist_ok=True)

# The strip is 4096 wide (the largest texture every device accepts) and as tall as the deck.
W, H = 4096, 900
strip = Image.new('RGBA', (W, H), (0, 0, 0, 0))
cx, cy, r = 700, 330, 210
planet = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(planet)
d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(64, 150, 170, 255))
for i, (dy, hgt, colour) in enumerate([(-120, 46, (92, 180, 190)), (-40, 30, (48, 120, 150)), (30, 54, (110, 196, 180)), (110, 28, (40, 104, 140))]):
    band = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(band).ellipse((cx - r - 40, cy + dy, cx + r + 40, cy + dy + hgt), fill=colour + (255,))
    planet.alpha_composite(band)
# Keep the bands inside the disc, then shade the night side.
mask = Image.new('L', (W, H), 0)
ImageDraw.Draw(mask).ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
planet.putalpha(mask)
shade = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(shade).ellipse((cx - r + 90, cy - r - 30, cx + r + 150, cy + r + 60), fill=(6, 10, 30, 150))
shade = shade.filter(ImageFilter.GaussianBlur(28))
shade.putalpha(Image.composite(shade.getchannel('A'), Image.new('L', (W, H), 0), mask))
planet.alpha_composite(shade)
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((cx - r - 14, cy - r - 14, cx + r + 14, cy + r + 14), fill=(120, 210, 230, 70))
strip.alpha_composite(glow.filter(ImageFilter.GaussianBlur(14)))
strip.alpha_composite(planet)
# A small moon, some way behind it.
moon = ImageDraw.Draw(strip)
moon.ellipse((1180, 520, 1236, 576), fill=(190, 190, 200, 255))
moon.ellipse((1196, 534, 1210, 548), fill=(160, 160, 172, 255))
strip.save(out / 'planet-pass.png', optimize=True)

size = 160
light = Image.new('RGBA', (size, size), (0, 0, 0, 0))
ImageDraw.Draw(light).ellipse((40, 40, 120, 120), fill=(255, 190, 60, 230))
light = light.filter(ImageFilter.GaussianBlur(16))
ImageDraw.Draw(light).ellipse((66, 66, 94, 94), fill=(255, 240, 190, 255))
light.save(out / 'warning-light.png', optimize=True)
print('wrote', *(p.name for p in sorted(out.iterdir())))
