#!/usr/bin/env python3
"""
Build the QuestLab asset library: ready-made characters anyone can add to a scenario from the
editor's Characters page ("Add QuestLab Assets").

Every picture comes from OpenGameArt.org under a licence that lets us ship it (CC0, or CC-BY with
the credit kept). This script downloads the originals, cuts out the frames each animal needs, takes
away flat backgrounds, turns every animal to face right, crops them all the same way (so the feet
stay put from frame to frame), scales them to a size that suits a scene (pixel art by whole numbers,
so it stays crisp), and lays the frames out as one sprite sheet per character.

Out, under apps/editor/public/questlab-assets/ (Vite copies it into the editor build):
  index.json                       the library: each character, its sheet, animations and credit
  characters/<id>/sheet.png        its frames, a grid numbered from 0 at the top left
  characters/<id>/portrait.png     a square close-up for story boxes
  characters/<id>/preview.png      an animated PNG of it walking, for the library's cards
  CREDITS.md                       who drew what, under which licence

Run: python3 tools/make-questlab-assets.py   (needs Pillow, numpy and scipy, and the network the
first time; downloads are kept in $QBL_ASSET_CACHE, default /tmp/qbl-questlab-cache).
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sys
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageSequence
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'apps/editor/public/questlab-assets'
CACHE = Path(os.environ.get('QBL_ASSET_CACHE', '/tmp/qbl-questlab-cache'))
OGA = 'https://opengameart.org/sites/default/files/'

MAX_SHEET = 4096  # the largest texture every browser can draw
PORTRAIT = 256
PREVIEW = 160
PREVIEW_HEIGHT = 110  # tallest a preview is drawn, in pixels of the card's 160 × 160 picture

# --------------------------------------------------------------------------- sources


@dataclass
class Source:
    title: str
    author: str
    license: str
    page: str
    files: dict[str, str]  # local name -> URL (a .zip is unpacked beside it)
    note: str = ''


SOURCES: dict[str, Source] = {
    'alizard-squirrel': Source('Pixel Squirrel', 'alizard', 'CC0', 'https://opengameart.org/content/pixel-squirrel',
                               {'squirrel.png': OGA + 'sqrl_5frames_1.png'}),
    'sunnyland': Source('SunnyLand Woods', 'Luis Zuno (ansimuz)', 'CC0', 'https://opengameart.org/content/sunnyland-woods',
                        {'sunnyland.zip': OGA + 'sunny-land-woods-files.zip'}),
    'rmazanek-bird': Source('Bird', 'rmazanek', 'CC0', 'https://opengameart.org/content/bird-2',
                            {'bird.png': OGA + 'bird_v001_blue_and_yellow.png'}),
    'shepardskin-chicken': Source('Chicken Sprites', 'Shepardskin', 'CC0', 'https://opengameart.org/content/chicken-sprites',
                                  {'chicken.zip': OGA + 'chicken.zip'}),
    'moikmellah-birds': Source('Animated Birds (32x32)', 'MoikMellah', 'CC0', 'https://opengameart.org/content/animated-birds-32x32',
                               {'birds.png': OGA + 'birds.32x32.png'}),
    'rmazanek-dog': Source('Dog', 'rmazanek', 'CC0', 'https://opengameart.org/content/dog-3',
                           {'dog.png': OGA + 'dog_medium.png'},
                           'Built on the German Shepherd by Shepardskin and the husky by Hellkipz (both CC0).'),
    'pzuh-catdog': Source('Cat & Dog - Free Sprites', 'pzUH', 'CC0', 'https://opengameart.org/content/cat-dog-free-sprites',
                          {'catndog.zip': OGA + 'CatnDog.zip'}),
    'shepardskin-cat': Source('Cat sprites', 'Shepardskin', 'CC0', 'https://opengameart.org/content/cat-sprites',
                              {'cat.zip': OGA + 'cat%20sprite.zip'}),
    'teasloth-komodo': Source('Komodo', 'teasloth', 'CC0', 'https://opengameart.org/content/komodo',
                              {'komodo.png': OGA + 'kimodo.png'}),
    'hiross-snake': Source('snake 2d remix (with dead animation)', 'Hiross, from “Snake 2d” by Zelta', 'CC0',
                           'https://opengameart.org/content/snake-2d-remix-with-dead-animation',
                           {'snake.png': OGA + 'snake_move_side_sheet.png'}),
    'alizard-turtle': Source('pixel turtle', 'alizard', 'CC0', 'https://opengameart.org/content/pixel-turtle',
                             {'walk.png': OGA + 'turtle_walk.png', 'retract.png': OGA + 'turtle_retrack.png'}),
    'sevarihk-goat': Source('Mountain Goat Sprites', 'Sevarihk', 'CC-BY 4.0', 'https://opengameart.org/content/mountain-goat-sprites',
                            {'walk.png': OGA + 'bergschaf-laufanimation-m.png', 'graze.png': OGA + 'bergschaf-grasend-m.png',
                             'lookup.png': OGA + 'bergschaf-lookup-m.png', 'leap.png': OGA + 'bergschaf-bocksprung-m.png'}),
    'scratchio-horse': Source('Animated Horse', 'ScratchIO', 'CC0', 'https://opengameart.org/content/animated-horse',
                              {'horse.zip': OGA + 'Horse.zip'}),
    'yps-fish': Source('Swimming Fish', 'Mepavi @ You’re Perfect Studio', 'CC0', 'https://opengameart.org/content/swimming-fish',
                       {'fish.png': OGA + 'fish_full.png'}),
    'overcrafted-goldfish': Source('Cartoon Goldfish', 'overcrafted', 'CC0', 'https://opengameart.org/content/cartoon-goldfish',
                                   {'goldfish.zip': OGA + 'Goldfish%20Animation.zip'}),
}


def fetch(key: str) -> Path:
    """The source's files, downloaded once into the cache (zips unpacked)."""
    src = SOURCES[key]
    folder = CACHE / key
    folder.mkdir(parents=True, exist_ok=True)
    for name, url in src.files.items():
        path = folder / name
        if not path.exists():
            print(f'  downloading {url}')
            request = urllib.request.Request(url, headers={'User-Agent': 'QuestLab asset builder'})
            with urllib.request.urlopen(request, timeout=120) as response:
                path.write_bytes(response.read())
        if name.endswith('.zip') and not (folder / (name + '.d')).exists():
            with zipfile.ZipFile(path) as z:
                for member in z.infolist():
                    target = (folder / (name + '.d') / member.filename).resolve()
                    if not str(target).startswith(str(folder.resolve())):
                        raise SystemExit(f'unsafe path in {name}: {member.filename}')
                z.extractall(folder / (name + '.d'))
    return folder


# --------------------------------------------------------------------------- cutting frames

Frames = list[Image.Image]


def rgba(path: Path) -> Image.Image:
    return Image.open(path).convert('RGBA')


def grid(path: Path, columns: int, rows: int, frames: list[int]) -> Frames:
    image = rgba(path)
    w, h = image.width // columns, image.height // rows
    return [image.crop(((f % columns) * w, (f // columns) * h, (f % columns + 1) * w, (f // columns + 1) * h)) for f in frames]


def files(paths: list[Path]) -> Frames:
    return [rgba(p) for p in paths]


def gif(path: Path) -> Frames:
    return [frame.convert('RGBA') for frame in ImageSequence.Iterator(Image.open(path))]


def key_out(frames: Frames, colour: tuple[int, int, int] | None = None, everywhere: bool = False) -> Frames:
    """
    Take away a flat background: the colour of the top-left pixel (or the one given), where it
    touches the edge of the frame, so the same colour inside the animal stays. `everywhere` takes
    it away inside too (gaps between legs), for art that never uses that colour.
    """
    out = []
    for frame in frames:
        a = np.array(frame)
        bg = np.array(colour if colour else a[0, 0, :3])
        same = np.all(a[:, :, :3] == bg, axis=2) & (a[:, :, 3] > 0)
        if everywhere:
            a[same, 3] = 0
        else:
            labels, _ = ndimage.label(same)
            edge = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
            a[np.isin(labels, list(edge)), 3] = 0
        a[a[:, :, 3] == 0] = 0  # clear the colour of see-through pixels too
        out.append(Image.fromarray(a))
    return out


def solid(frame: Image.Image) -> Image.Image:
    """Clear the faint haze some exports leave around a sprite (alpha under 16), so crops are tight."""
    a = np.array(frame)
    a[a[:, :, 3] < 16] = 0
    return Image.fromarray(a)


def flip(frames: Frames) -> Frames:
    return [f.transpose(Image.FLIP_LEFT_RIGHT) for f in frames]


def half(frames: Frames) -> Frames:
    """Back to one pixel per pixel, for art published already doubled."""
    return [f.resize((f.width // 2, f.height // 2), Image.NEAREST) for f in frames]


def centred(frames: Frames) -> Frames:
    """Frames of different sizes, centred on one canvas (cartoon art exported frame by frame)."""
    w, h = max(f.width for f in frames), max(f.height for f in frames)
    out = []
    for f in frames:
        canvas = Image.new('RGBA', (w, h))
        canvas.paste(f, ((w - f.width) // 2, h - f.height))
        out.append(canvas)
    return out


# --------------------------------------------------------------------------- characters


@dataclass
class Anim:
    name: str
    frames: Frames | list[int]  # new frames, or indices of frames already in the sheet
    ms: int  # per frame
    repeat: bool | None = None  # None: the game's usual (poses loop, other animations play once)


@dataclass
class Character:
    id: str
    name: str
    group: str
    source: str
    about: str
    style: str  # 'pixel' or 'cartoon'
    animations: list[Anim]
    zoom: float = 1  # pixel art: a whole number; cartoon: ignored when height is set
    height: int | None = None  # cartoon art: frame height wanted after cropping
    preview: str = 'walk_right'
    tags: list[str] = field(default_factory=list)


def characters() -> list[Character]:
    s = {key: fetch(key) for key in SOURCES}
    sunny = s['sunnyland'] / 'sunnyland.zip.d/Sunny-land-woods-files/SPRITES/player'
    pz = s['pzuh-catdog'] / 'catndog.zip.d/png'
    chicken = s['shepardskin-chicken'] / 'chicken.zip.d/chicken'
    cat = s['shepardskin-cat'] / 'cat.zip.d/cat sprite'
    horse = s['scratchio-horse'] / 'horse.zip.d/Horse'
    goldfish = s['overcrafted-goldfish'] / 'goldfish.zip.d/Goldfish Animation'

    def numbered(folder: Path, stem: str, count: int, first: int = 1, pattern: str = '{stem}-{n}.png') -> list[Path]:
        return [folder / pattern.format(stem=stem, n=n) for n in range(first, first + count)]

    def pz_frames(animal: str, anim: str, count: int) -> Frames:
        return files([pz / animal / f'{anim} ({n}).png' for n in range(1, count + 1)])

    def fish_frames(folder: str, stem: str, count: int) -> Frames:
        return files([goldfish / folder / f'{stem}__{n:03d}.png' for n in range(count)])

    squirrel = flip(key_out(grid(s['alizard-squirrel'] / 'squirrel.png', 1, 5, [0, 1, 2, 3, 4])))
    turtle_walk = flip(key_out(grid(s['alizard-turtle'] / 'walk.png', 6, 1, list(range(6)))))
    turtle_hide = flip(key_out(grid(s['alizard-turtle'] / 'retract.png', 5, 1, list(range(5)))))
    hawk = flip(key_out(grid(s['moikmellah-birds'] / 'birds.png', 6, 2, [6, 7, 8, 9, 10])))
    hen_walk = flip(key_out(half(gif(chicken / 'chickenprofilewalkx2.gif')), everywhere=True))
    hen_peck = flip(key_out(half(gif(chicken / 'chickenprofilepeckx2.gif')), everywhere=True))
    cat_walk = flip(key_out(half(gif(cat / 'catwalkx2.gif')), everywhere=True))
    cat_run = flip(key_out(half(gif(cat / 'catrunx2.gif')), everywhere=True))
    bird = s['rmazanek-bird'] / 'bird.png'
    husky = s['rmazanek-dog'] / 'dog.png'
    goat = s['sevarihk-goat']
    lookup = grid(goat / 'lookup.png', 4, 4, [8, 9, 10, 11])
    fish = s['yps-fish'] / 'fish.png'
    gold = centred(fish_frames('swim', 'swim', 12) + fish_frames('eating', 'eating_right', 12) + fish_frames('close eyes', 'closeEyes_right', 12) + fish_frames('sad', 'sad', 10))

    return [
        # ------------------------------------------------------------- squirrels
        Character('red-squirrel', 'Red Squirrel', 'Squirrels', 'alizard-squirrel', 'A quick little squirrel that bounds along with its tail up.', 'pixel', [
            Anim('walk_right', squirrel, 90),
            Anim('stand_right', [0], 1000),
            Anim('hop', [0, 1, 2, 3, 4], 70),
        ], zoom=4, tags=['forest', 'park']),
        Character('woodland-squirrel', 'Woodland Squirrel', 'Squirrels', 'sunnyland', 'A bushy-tailed squirrel that twitches its nose, scampers, jumps and ducks.', 'pixel', [
            Anim('stand_right', files(numbered(sunny / 'idle', 'player-idle', 8)), 110),
            Anim('walk_right', files(numbered(sunny / 'run', 'player-run', 6)), 90),
            Anim('jump', files(numbered(sunny / 'jump', 'player-jump', 4)), 140),
            Anim('crouch', files(numbered(sunny / 'crouch', 'player-crouch', 2)), 300),
        ], zoom=2, tags=['forest', 'park']),
        # ------------------------------------------------------------- birds
        Character('bluebird', 'Bluebird', 'Birds', 'rmazanek-bird', 'A songbird that hops about, pecks at the ground and takes to the air.', 'pixel', [
            Anim('stand_right', grid(bird, 11, 8, list(range(22, 30))), 140),
            Anim('walk_right', grid(bird, 11, 8, list(range(44, 50))), 90),
            Anim('peck', grid(bird, 11, 8, list(range(33, 41))), 90),
            Anim('fly', grid(bird, 11, 8, list(range(66, 75))), 80, True),
            Anim('take_off', grid(bird, 11, 8, list(range(55, 66))), 70),
            Anim('land', grid(bird, 11, 8, list(range(77, 84))), 80),
            Anim('jump', grid(bird, 11, 8, list(range(11, 20))), 70),
        ], zoom=2, tags=['garden', 'forest']),
        Character('hen', 'Hen', 'Birds', 'shepardskin-chicken', 'A farmyard hen that struts about and pecks for seeds.', 'pixel', [
            Anim('walk_right', hen_walk, 160),
            Anim('stand_right', [0], 1000),
            Anim('peck', hen_peck + hen_peck, 160),
        ], zoom=6, tags=['farm']),
        Character('hawk', 'Hawk', 'Birds', 'moikmellah-birds', 'A bird of prey that is always on the wing.', 'pixel', [
            Anim('walk_right', hawk, 100),
            Anim('stand_right', [0, 1, 2, 3, 4], 160),
            Anim('fly', [0, 1, 2, 3, 4], 100, True),
        ], zoom=3, tags=['sky', 'mountains']),
        # ------------------------------------------------------------- dogs
        Character('husky', 'Husky', 'Dogs', 'rmazanek-dog', 'A friendly husky that wags its tail, barks, runs and sits.', 'pixel', [
            Anim('stand_right', flip(grid(husky, 6, 6, [30, 31, 32, 33])), 160),
            Anim('walk_right', flip(grid(husky, 6, 6, [6, 7, 8, 9, 10, 11])), 110),
            Anim('run', flip(grid(husky, 6, 6, [12, 13, 14, 15, 16])), 80, True),
            Anim('bark', flip(grid(husky, 6, 6, [0, 1, 2, 3])) , 110),
            Anim('sit', flip(grid(husky, 6, 6, [18, 19, 20, 24, 25, 26, 27])), 140, True),
        ], zoom=3, tags=['town', 'home']),
        Character('puppy', 'Puppy', 'Dogs', 'pzuh-catdog', 'A cheerful cartoon puppy that trots, runs and jumps for joy.', 'cartoon', [
            Anim('stand_right', pz_frames('dog', 'Idle', 10), 90),
            Anim('walk_right', pz_frames('dog', 'Walk', 10), 70),
            Anim('run', pz_frames('dog', 'Run', 8), 60, True),
            Anim('jump', pz_frames('dog', 'Jump', 8), 70),
            Anim('slide', pz_frames('dog', 'Slide', 10), 60),
        ], height=150, tags=['town', 'home']),
        # ------------------------------------------------------------- cats
        Character('tabby-kitten', 'Tabby Kitten', 'Cats', 'pzuh-catdog', 'A big-eyed cartoon kitten that pads about, runs and jumps.', 'cartoon', [
            Anim('stand_right', pz_frames('cat', 'Idle', 10), 90),
            Anim('walk_right', pz_frames('cat', 'Walk', 10), 70),
            Anim('run', pz_frames('cat', 'Run', 8), 60, True),
            Anim('jump', pz_frames('cat', 'Jump', 8), 70),
            Anim('slide', pz_frames('cat', 'Slide', 10), 60),
        ], height=140, tags=['town', 'home']),
        Character('black-cat', 'Black Cat', 'Cats', 'shepardskin-cat', 'A sleek black cat that prowls and dashes.', 'pixel', [
            Anim('walk_right', cat_walk, 120),
            Anim('stand_right', [0], 1000),
            Anim('run', cat_run, 70, True),
        ], zoom=6, tags=['town', 'home']),
        # ------------------------------------------------------------- reptiles
        Character('komodo-dragon', 'Komodo Dragon', 'Reptiles', 'teasloth-komodo', 'A big lizard that waddles along, swinging its tail.', 'pixel', [
            Anim('walk_right', grid(s['teasloth-komodo'] / 'komodo.png', 2, 4, [0, 1, 2, 3]), 160),
            Anim('stand_right', [0], 1000),
        ], zoom=5, tags=['desert', 'island']),
        Character('snake', 'Snake', 'Reptiles', 'hiross-snake', 'A coiled snake that sways and slithers.', 'pixel', [
            Anim('walk_right', grid(s['hiross-snake'] / 'snake.png', 2, 4, [0, 1, 2, 3, 4, 5, 6]), 110),
            Anim('stand_right', [0, 1, 2, 1], 260),
        ], zoom=4, tags=['desert', 'jungle']),
        Character('turtle', 'Turtle', 'Reptiles', 'alizard-turtle', 'A slow and steady turtle that can hide in its shell.', 'pixel', [
            Anim('walk_right', turtle_walk, 150),
            Anim('stand_right', [0], 1000),
            Anim('hide', turtle_hide, 120),
        ], zoom=4, tags=['pond', 'beach']),
        # ------------------------------------------------------------- farm and field
        Character('mountain-goat', 'Mountain Goat', 'Farm and field', 'sevarihk-goat', 'A curly-horned goat that wanders, grazes and leaps.', 'pixel', [
            Anim('stand_right', lookup[:1], 1000),
            Anim('walk_right', grid(goat / 'walk.png', 4, 4, [8, 9, 10, 11]), 170),
            Anim('graze', lookup + grid(goat / 'graze.png', 4, 4, [8, 9, 10, 11, 8, 9, 10, 11]) + lookup[::-1], 160),
            Anim('leap', grid(goat / 'leap.png', 4, 4, [8, 9, 10, 11]), 150),
        ], zoom=2, tags=['farm', 'mountains']),
        Character('horse', 'Horse', 'Farm and field', 'scratchio-horse', 'A chestnut horse that walks, gallops, grazes and swishes its tail.', 'pixel', [
            Anim('stand_right', grid(horse / 'Horse_Idle.png', 13, 1, list(range(13))), 140),
            Anim('walk_right', grid(horse / 'Horse_Walk.png', 8, 1, list(range(8))), 120),
            Anim('run', grid(horse / 'Horse_Run.png', 6, 1, list(range(6))), 80, True),
            Anim('eat', grid(horse / 'Horse_Eat.png', 12, 1, list(range(12))), 150),
        ], zoom=6, tags=['farm']),
        # ------------------------------------------------------------- fish
        Character('goldfish', 'Goldfish', 'Fish', 'overcrafted-goldfish', 'A grumpy cartoon goldfish that swims, munches, blinks and sulks.', 'cartoon', [
            Anim('walk_right', gold[0:12], 60),
            Anim('stand_right', list(range(12)), 110),
            Anim('eat', gold[12:24], 70),
            Anim('blink', gold[24:36], 50),
            Anim('sad', gold[36:46], 90),
        ], height=120, tags=['sea', 'pond']),
        Character('yellow-tang', 'Yellow Fish', 'Fish', 'yps-fish', 'A spiky yellow reef fish that flutters through the water.', 'pixel', [
            Anim('walk_right', flip(grid(fish, 4, 3, [4, 5, 6, 7])), 110),
            Anim('stand_right', [0, 1, 2, 3], 200),
        ], zoom=3, tags=['sea', 'reef']),
    ]


# --------------------------------------------------------------------------- building


def scale(frames: Frames, c: Character) -> Frames:
    if c.style == 'pixel':
        k = int(c.zoom)
        return [f.resize((f.width * k, f.height * k), Image.NEAREST) for f in frames]
    k = c.height / frames[0].height
    size = (max(1, round(frames[0].width * k)), c.height)
    return [f.resize(size, Image.LANCZOS) for f in frames]


def build(c: Character) -> dict:
    # Every new frame, in the order the animations give them; references to frames already listed stay numbers.
    frames: Frames = []
    plan: list[tuple[Anim, list[int]]] = []
    for anim in c.animations:
        if anim.frames and isinstance(anim.frames[0], Image.Image):
            start = len(frames)
            frames.extend(anim.frames)  # type: ignore[arg-type]
            plan.append((anim, list(range(start, len(frames)))))
        else:
            plan.append((anim, list(anim.frames)))  # type: ignore[arg-type]
    frames = [solid(f) for f in frames]
    size = frames[0].size
    if any(f.size != size for f in frames):
        frames = centred(frames)
    # One crop for every frame: the smallest box holding all of them, so nothing jumps.
    box = None
    for f in frames:
        b = f.getchannel('A').getbbox()
        if b:
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    frames = [f.crop(box) for f in frames]
    unscaled = frames
    frames = scale(frames, c)
    fw, fh = frames[0].size
    columns = max(1, min(len(frames), 8, MAX_SHEET // fw))
    rows = (len(frames) + columns - 1) // columns
    if rows * fh > MAX_SHEET:
        raise SystemExit(f'{c.id}: sheet too tall ({rows} rows of {fh})')
    sheet = Image.new('RGBA', (columns * fw, rows * fh))
    for i, f in enumerate(frames):
        sheet.paste(f, ((i % columns) * fw, (i // columns) * fh))

    folder = OUT / 'characters' / c.id
    folder.mkdir(parents=True, exist_ok=True)
    sheet.save(folder / 'sheet.png', optimize=True)

    animations = {}
    for anim, list_ in plan:
        entry: dict = {'frames': list_, 'duration': anim.ms * len(list_)}
        if anim.repeat is not None:
            entry['repeat'] = anim.repeat
        animations[anim.name] = entry

    # The portrait: the first standing frame, as large as fits a square, with a little room around it.
    stand = unscaled[animations['stand_right']['frames'][0]]
    stand = stand.crop(stand.getchannel('A').getbbox())
    portrait = Image.new('RGBA', (PORTRAIT, PORTRAIT))
    fit = (PORTRAIT * 0.86) / max(stand.width, stand.height)
    if c.style == 'pixel' and fit >= 1:
        fit = int(fit)
    shown = stand.resize((max(1, round(stand.width * fit)), max(1, round(stand.height * fit))), Image.NEAREST if c.style == 'pixel' else Image.LANCZOS)
    portrait.paste(shown, ((PORTRAIT - shown.width) // 2, (PORTRAIT - shown.height) // 2), shown)
    portrait.save(folder / 'portrait.png', optimize=True)

    # The card's picture: the preview animation playing, as an animated PNG. Near the size it has
    # in a scene (a hen stays smaller than a husky), only the big ones shrunk to fit the card.
    anim = animations.get(c.preview) or animations['stand_right']
    fit = min(PREVIEW / fw, PREVIEW_HEIGHT / fh)
    if c.style == 'pixel' and fit >= 1:
        fit = int(fit)
    fit = min(fit, 1.0) if c.style == 'cartoon' else fit
    pw, ph = max(1, round(fw * fit)), max(1, round(fh * fit))
    shots = []
    for i in anim['frames']:
        canvas = Image.new('RGBA', (PREVIEW, PREVIEW))
        shot = frames[i].resize((pw, ph), Image.NEAREST if c.style == 'pixel' and fit >= 1 else Image.LANCZOS)
        canvas.paste(shot, ((PREVIEW - pw) // 2, PREVIEW - ph - 8 if ph < PREVIEW - 8 else (PREVIEW - ph) // 2), shot)
        shots.append(canvas)
    each = max(30, anim['duration'] // max(1, len(anim['frames'])))
    if len(shots) > 1:
        shots[0].save(folder / 'preview.png', save_all=True, append_images=shots[1:], duration=each, loop=0, disposal=1, optimize=False)
    else:
        shots[0].save(folder / 'preview.png')

    src = SOURCES[c.source]
    return {
        'id': c.id,
        'name': c.name,
        'group': c.group,
        'about': c.about,
        'style': c.style,
        'tags': c.tags,
        'sheet': {'file': f'characters/{c.id}/sheet.png', 'columns': columns, 'rows': rows, 'count': len(frames), 'frame_width': fw, 'frame_height': fh},
        'portrait': f'characters/{c.id}/portrait.png',
        'preview': f'characters/{c.id}/preview.png',
        'animations': animations,
        'credit': {'title': src.title, 'author': src.author, 'license': src.license, 'url': src.page, **({'note': src.note} if src.note else {})},
    }


LICENCE_URLS = {'CC0': 'https://creativecommons.org/publicdomain/zero/1.0/', 'CC-BY 4.0': 'https://creativecommons.org/licenses/by/4.0/'}


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    entries = []
    for c in characters():
        print(f'building {c.id}')
        entries.append(build(c))
    groups = list(dict.fromkeys(e['group'] for e in entries))
    (OUT / 'index.json').write_text(json.dumps({'version': 1, 'groups': groups, 'characters': entries}, indent=1, ensure_ascii=False) + '\n')

    lines = ['# QuestLab assets: credits', '',
             'The characters in the QuestLab asset library are built from art published on OpenGameArt.org.',
             'Frames were cut out, backgrounds removed, turned to face right, cropped and scaled by',
             '`tools/make-questlab-assets.py`. Each keeps its original licence; CC-BY art must be credited',
             'wherever it is used (the editor copies the credit onto the media it adds).', '']
    for e in entries:
        cr = e['credit']
        lines.append(f"- **{e['name']}**: “{cr['title']}” by {cr['author']}, {cr['license']} ({LICENCE_URLS.get(cr['license'], '')}). {cr['url']}"
                     + (f" {cr['note']}" if cr.get('note') else ''))
    (OUT / 'CREDITS.md').write_text('\n'.join(lines) + '\n')
    print(f'{len(entries)} characters written to {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    sys.exit(main())
