#!/usr/bin/env python3
"""
Build the QuestLab asset library's shipped pack: ready-made animals and vehicles anyone can add to a
scenario (the editor's "Add QuestLab Assets", the /api/editor/library API, `php artisan qbl:library`).

Every picture comes from OpenGameArt.org under a licence that lets us ship it (CC0, or CC BY with
the credit kept), except the stagecoach's coach, which is drawn here (CC0). This script downloads
the originals, cuts out the frames each asset needs, takes away flat backgrounds, turns everything
to face right, crops all of an asset's frames the same way (so feet and wheels stay put), scales
them to suit a scene (pixel art by whole numbers, so it stays crisp), spins wheels, and lays the
frames out as one sprite sheet per asset.

Out, under scenarios/assets/library/ (served as /scenario-assets/library/; the API reads it there):
  library.json                     the pack: each asset, its definition, files and credit (AssetLibrary::importPack)
  characters/<id>/sheet.png        an animal's frames, a grid numbered from 0 at the top left
  characters/<id>/portrait.png     its square close-up for story boxes
  vehicles/<id>/sheet.png          a vehicle's frames (idle, then walk: wheels turning, legs moving)
  */<id>/preview.png               an animated PNG of it moving, for the library's cards
  CREDITS.md                       who drew what, under which licence

Run: python3 tools/make-questlab-assets.py   (needs Pillow, numpy and scipy, and the network the
first time; downloads are kept in $QBL_ASSET_CACHE, default /tmp/qbl-questlab-cache). Then
`php artisan qbl:library import --refresh` brings an installation's library up to date with it.
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
from PIL import Image, ImageDraw, ImageSequence
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'scenarios/assets/library'
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
    # ------------------------------------------------------------------ vehicles
    'sujit-cars': Source('Side View Cars Game Assets', 'Sujit Yadav (Unlucky Studio)', 'CC0', 'https://opengameart.org/content/side-view-cars-game-assets',
                         {'cars.zip': OGA + 'Side%20view%20Cars_Game%20assets.zip'}),
    'chasers-car': Source('2D Small Car', 'Chasersgaming', 'CC0', 'https://opengameart.org/content/2d-small-car',
                          {'car.png': OGA + 'spr_silvercar_0.png'}),
    'chasers-bike': Source('2D Bike Sprite', 'Chasersgaming', 'CC0', 'https://opengameart.org/content/2d-bike-sprite',
                           {'bike.png': OGA + 'spr_bike_0.png'}),
    'clint-bicycle': Source('Bicycle', 'Clint Bellanger', 'CC-BY 3.0', 'https://opengameart.org/content/bicycle',
                            {'bicycle.png': OGA + 'bicycle.png'}),
    'lpc-horse': Source('LPC Horse Extended', 'bluecarrot16 (“[LPC] Horse”), modified by Benjamin K. Smith (BenCreating)', 'CC-BY 3.0',
                        'https://opengameart.org/content/lpc-horse-extended', {'horse.zip': OGA + 'LPC%20Horse%20Extended.zip'},
                        'Original horse: https://opengameart.org/content/lpc-horses'),
    'questlab-coach': Source('Stagecoach', 'QuestLab (the coach), with horses by bluecarrot16 and Benjamin K. Smith (“LPC Horse Extended”)', 'CC-BY 3.0',
                             'https://opengameart.org/content/lpc-horse-extended', {},
                             'The coach is drawn by tools/make-questlab-assets.py (CC0); the horses are CC BY 3.0.'),
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

    definition = {'animations': {name: {'file': 'sheet', **a} for name, a in animations.items()}}
    definition['animations']['portrait'] = {'file': 'portrait'}
    return {
        'slug': c.id,
        'kind': 'character',
        'name': c.name,
        'category': c.group,
        'description': c.about,
        'style': c.style,
        'tags': c.tags,
        'definition': definition,
        'files': {
            'sheet': {'file': f'characters/{c.id}/sheet.png', 'params': {'sheet': {'columns': columns, 'rows': rows, 'count': len(frames)}}},
            'portrait': {'file': f'characters/{c.id}/portrait.png'},
            'preview': {'file': f'characters/{c.id}/preview.png'},
        },
        'credit': credit(SOURCES[c.source]),
    }


def credit(src: Source) -> dict:
    return {'title': src.title, 'author': src.author, 'license': src.license, 'url': src.page, **({'note': src.note} if src.note else {})}


# =========================================================================== vehicles
#
# A vehicle is an item with vehicle: true. Its sheet has an `idle` animation (standing still) and a
# `walk` one (wheels turning, legs moving), which the game plays by itself while it is ridden. The
# rider is drawn behind it and cut off below the seat (hide_rider_below), so they seem to sit in it.

AVATAR = 225  # how tall the platform's avatars stand in a scene, in pixels
WAIST = round(AVATAR * 0.45)  # where they are cut when they sit
VEHICLE_PREVIEW = (240, 140)


@dataclass
class Vehicle:
    id: str
    name: str
    group: str
    source: str
    about: str
    style: str
    idle: Frames  # facing right, all frames the same size
    walk: Frames
    seat: tuple[float, float]  # where the rider sits, in the frames' pixels (x, y)
    ms_idle: int = 1000
    ms_walk: int = 100
    extra: list[tuple[str, Frames, int, bool]] = field(default_factory=list)  # (name, frames, ms per frame, repeat)
    speed: float = 1.5
    layer: str = 'front'
    closed: bool = False  # it has a roof: the rider is lowered until their head is under it, and seen through the windows
    tags: list[str] = field(default_factory=list)


def spokes(tyre: Image.Image) -> int:
    """How many times the tyre's pattern repeats round it (its spokes), so a turn by 360/n looks the same."""
    a = np.array(tyre.convert('L'), dtype=float)
    h, w = a.shape
    cx, cy, r = w / 2, h / 2, min(w, h) * 0.3
    ring = [a[int(cy + r * np.sin(t)), int(cx + r * np.cos(t))] for t in np.linspace(0, 2 * np.pi, 720, endpoint=False)]
    power = np.abs(np.fft.rfft(np.array(ring) - np.mean(ring)))
    return int(np.argmax(power[3:40]) + 3)


def wheel_spots(sample: Image.Image, body: Image.Image) -> list[tuple[float, float, float]]:
    """Wheels (x, y, diameter) of a car: where the finished picture has more than the body alone."""
    s = np.array(sample)[:, :, 3] > 128
    b = np.array(body)[:, :, 3] > 128
    diff = ndimage.binary_opening(s & ~b, iterations=2)
    labels, _ = ndimage.label(diff)
    boxes = [box for box in ndimage.find_objects(labels) if (box[0].stop - box[0].start) * (box[1].stop - box[1].start) > 200]
    # Pieces of one wheel (cut by the body) overlap across: join them.
    boxes.sort(key=lambda b: b[1].start)
    wheels: list[list[int]] = []
    for box in boxes:
        x0, x1, y0, y1 = box[1].start, box[1].stop, box[0].start, box[0].stop
        if wheels and x0 < wheels[-1][1] - 10:
            w = wheels[-1]
            wheels[-1] = [min(w[0], x0), max(w[1], x1), min(w[2], y0), max(w[3], y1)]
        else:
            wheels.append([x0, x1, y0, y1])
    return [((x0 + x1) / 2, y1 - (x1 - x0) / 2, x1 - x0) for x0, x1, y0, y1 in wheels]


def turning(body: Image.Image, tyre: Image.Image, wheels: list[tuple[float, float, float]], count: int) -> Frames:
    """Frames of a car whose wheels turn forward (clockwise, as it faces right), the body drawn over them."""
    tyre = tyre.crop(tyre.getchannel('A').getbbox())
    period = 360 / spokes(tyre)
    out = []
    for i in range(count):
        canvas = Image.new('RGBA', body.size)
        for x, y, d in wheels:
            size = max(1, round(d))
            turned = tyre.resize((size, size), Image.LANCZOS).rotate(-period * i / count, Image.BICUBIC)
            canvas.alpha_composite(turned, (round(x - size / 2), round(y - size / 2)))
        canvas.alpha_composite(body)
        out.append(canvas)
    return out


def turn_patch(image: Image.Image, centre: tuple[float, float], radius: float, degrees: float) -> Image.Image:
    """Pixel art: turn the round part of a picture inside `radius` about `centre` (a hub turning)."""
    out = image.copy()
    cx, cy = centre
    box = (round(cx - radius), round(cy - radius), round(cx + radius) + 1, round(cy + radius) + 1)
    patch = image.crop(box).rotate(-degrees, Image.NEAREST, center=(cx - box[0], cy - box[1]))
    mask = Image.new('L', patch.size)
    ImageDraw.Draw(mask).ellipse((cx - box[0] - radius, cy - box[1] - radius, cx - box[0] + radius, cy - box[1] + radius), fill=255)
    out.paste(patch, box[:2], mask)
    return out


def see_through(frame: Image.Image, test, alpha: int = 70) -> Image.Image:
    """Windows the rider is seen through: pixels for which test(r, g, b, x, y) holds become faint."""
    a = np.array(frame)
    h, w = a.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    mask = test(a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int), xs / w, ys / h) & (a[:, :, 3] > 0)
    a[mask, 3] = np.minimum(a[mask, 3], alpha)
    return Image.fromarray(a)


def nearest(frames: Frames, k: float) -> Frames:
    return [f.resize((round(f.width * k), round(f.height * k)), Image.NEAREST) for f in frames]


def smooth(frames: Frames, k: float) -> Frames:
    return [f.resize((round(f.width * k), round(f.height * k)), Image.LANCZOS) for f in frames]


# ------------------------------------------------------------------- the stagecoach's coach

OUTLINE, BODY, BODY_D, BODY_L = (43, 24, 18, 255), (150, 42, 32, 255), (112, 30, 24, 255), (190, 74, 48, 255)
TRIM, WOOD, WOOD_D = (226, 172, 72, 255), (104, 64, 36, 255), (62, 38, 24, 255)
GLASS, GLASS_L = (44, 56, 72, 255), (126, 156, 186, 255)
WHEEL, WHEEL_D, IRON = (206, 146, 54, 255), (146, 96, 34, 255), (46, 46, 52, 255)
LEATHER, CANVAS, LAMP = (88, 54, 32, 255), (146, 140, 120, 255), (248, 218, 112, 255)


def coach_wheel(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float, degrees: float) -> None:
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=IRON)
    d.ellipse((cx - r + 1, cy - r + 1, cx + r - 1, cy + r - 1), fill=WHEEL)
    d.ellipse((cx - r + 3, cy - r + 3, cx + r - 3, cy + r - 3), fill=None, outline=WHEEL_D)
    for k in range(12):
        t = np.radians(degrees + k * 30)
        d.line((cx + 3 * np.cos(t), cy + 3 * np.sin(t), cx + (r - 3) * np.cos(t), cy + (r - 3) * np.sin(t)), fill=WHEEL_D)
    d.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), fill=WHEEL_D, outline=OUTLINE)
    d.point((cx, cy), fill=OUTLINE)


def coach(degrees: float) -> Image.Image:
    """A Concord stagecoach, drawn at the LPC horses' scale (one pixel of theirs), facing right; ground at y = 86."""
    im = Image.new('RGBA', (150, 92))
    d = ImageDraw.Draw(im)
    # Undercarriage first: the perch between the axles and the pole out to the horses.
    d.line((20, 70, 58, 74), fill=WOOD_D, width=2)
    d.line((58, 73, 84, 67), fill=WOOD_D, width=2)
    d.line((58, 75, 84, 69), fill=OUTLINE)
    # The boot: a leather luggage box hung behind.
    d.rounded_rectangle((1, 30, 11, 50), radius=3, fill=LEATHER, outline=OUTLINE)
    d.line((3, 38, 9, 38), fill=WOOD_D)
    # The body: egg-shaped, red, hung on leather straps.
    body = [(12, 24), (50, 24), (54, 30), (56, 40), (54, 50), (48, 58), (16, 58), (10, 50), (8, 40), (9, 30)]
    d.polygon(body, fill=BODY)
    shade = Image.new('RGBA', im.size)
    ImageDraw.Draw(shade).rectangle((0, 49, 150, 60), fill=BODY_D)
    mask = Image.new('L', im.size)
    ImageDraw.Draw(mask).polygon(body, fill=255)
    im.paste(shade, (0, 0), Image.fromarray((np.array(mask) * (np.array(shade)[:, :, 3] > 0)).astype('uint8')))
    d = ImageDraw.Draw(im)
    d.line((12, 26, 50, 26), fill=BODY_L)
    d.line((10, 31, 10, 46), fill=BODY_L)
    d.line((9, 46, 55, 46), fill=TRIM)
    d.polygon(body, outline=OUTLINE)
    for x0, x1 in ((13, 21), (27, 35), (41, 50)):
        d.rectangle((x0, 29, x1, 39), fill=GLASS, outline=TRIM)
        d.line((x0 + 2, 37, x0 + 5, 31), fill=GLASS_L)
    d.rectangle((25, 27, 37, 56), outline=OUTLINE)
    d.point((35, 44), fill=TRIM)
    d.line((14, 58, 18, 67), fill=LEATHER, width=2)
    d.line((47, 58, 52, 70), fill=LEATHER, width=2)
    # The roof, its rail and the luggage.
    d.rectangle((10, 20, 52, 24), fill=WOOD_D, outline=OUTLINE)
    d.line((11, 17, 51, 17), fill=WOOD)
    for x in (11, 30, 51):
        d.line((x, 17, x, 20), fill=WOOD)
    d.rectangle((15, 10, 29, 19), fill=LEATHER, outline=OUTLINE)
    d.line((22, 10, 22, 19), fill=TRIM)
    d.rounded_rectangle((32, 13, 43, 19), radius=2, fill=CANVAS, outline=OUTLINE)
    # The driver's box, its seat and footboard, and a lamp.
    d.rectangle((55, 35, 66, 45), fill=WOOD, outline=OUTLINE)
    d.rectangle((54, 25, 56, 35), fill=LEATHER, outline=OUTLINE)
    d.rectangle((55, 31, 66, 34), fill=LEATHER, outline=OUTLINE)
    d.polygon([(63, 45), (66, 45), (75, 54), (71, 54)], fill=WOOD_D, outline=OUTLINE)
    d.rectangle((55, 26, 58, 30), fill=LAMP, outline=OUTLINE)
    # The wheels, over everything.
    coach_wheel(d, 20, 70, 16, degrees)
    coach_wheel(d, 58, 74, 12, degrees * 16 / 12)
    return im


def lpc_horse_layers(folder: Path, anim: str, coat: str, mane: str, face: str | None, tack: bool) -> Image.Image:
    """One of the LPC horse's sheets (Walk, Gallop, Idle) with its coat, mane and tail, markings, blanket and saddle laid on."""
    sheet = rgba(folder / f'Horse/Horse {anim} {coat}.png')
    layers = [f'Markings/Mane:Tail/Mane:Tail {anim} {mane}.png']
    if face:
        layers.append(f'Markings/Face/{face} {anim}.png')
    if tack:
        layers += [f'Accessories/Blanket {anim}.png', f'Accessories/Saddle {anim}.png']
    for layer in layers:
        sheet.alpha_composite(rgba(folder / layer))
    return sheet


def horse_right(sheet: Image.Image, frames: int) -> Frames:
    """The frames of a horse sheet that face right (the bottom row of the walk and gallop; the idle sheet's fourth)."""
    if sheet.height == 128:
        return [sheet.crop((128 * 3, 0, 128 * 4, 128))]
    return [sheet.crop((128 * i, 384, 128 * (i + 1), 512)) for i in range(frames)]


def vehicles() -> list[Vehicle]:
    s = {key: fetch(key) for key in ('sujit-cars', 'chasers-car', 'chasers-bike', 'clint-bicycle', 'lpc-horse', 'questlab-coach')}
    cars = s['sujit-cars'] / 'cars.zip.d/Game assets/Cars'
    out: list[Vehicle] = []

    def cartoon_car(id: str, name: str, about: str, body: Path, sample: Path, plain: Path, tyre: Path, half_sample: bool,
                    height: int, seat: tuple[float, float], roof_cut: tuple[int, int, int, int] | None, speed: float, tags: list[str]) -> Vehicle:
        """One of Sujit Yadav's cars, which face left: turned round, its wheels set turning. `seat` and `roof_cut`
        (taken off to make a convertible) are in the turned body's pixels."""
        b, smp, pl = (rgba(p).transpose(Image.FLIP_LEFT_RIGHT) for p in (body, sample, plain))
        k = 2 if half_sample else 1
        spots = [(x * k, y * k, dd * k) for x, y, dd in wheel_spots(smp, pl)]
        if roof_cut:
            ImageDraw.Draw(b).rectangle(roof_cut, fill=(0, 0, 0, 0))
        b = see_through(b, lambda r, g, bl, x, y: (y < 0.5) & (np.maximum(np.maximum(r, g), bl) - np.minimum(np.minimum(r, g), bl) < 40) & (np.maximum(np.maximum(r, g), bl) < 170))
        frames = turning(b, rgba(tyre), spots, 6)
        # Crop now, then scale to the height wanted; the seat moves with it.
        box = frames[0].getchannel('A').getbbox()
        for f in frames[1:]:
            bb = f.getchannel('A').getbbox()
            box = (min(box[0], bb[0]), min(box[1], bb[1]), max(box[2], bb[2]), max(box[3], bb[3]))
        frames = [f.crop(box) for f in frames]
        z = height / frames[0].height
        frames = smooth(frames, z)
        return Vehicle(id, name, 'Cars', 'sujit-cars', about, 'cartoon', frames[:1], frames, ((seat[0] - box[0]) * z, (seat[1] - box[1]) * z),
                       ms_walk=70, speed=speed, closed=roof_cut is None, tags=tags)

    out.append(cartoon_car('red-convertible', 'Red Convertible', 'A low red sports car with the top down, so everyone can see who is driving.',
                           cars / '4 - Super Car/Cars/car_1.png', cars / '4 - Super Car/Cars/supercar_2_3.png', cars / '4 - Super Car/Cars/car_4.png',
                           cars / '4 - Super Car/Cars/tyre.png', True, 150, (580, 350), (350, 160, 660, 344), 2.4, ['city', 'race', 'road']))
    out.append(cartoon_car('yellow-roadster', 'Yellow Roadster', 'A bright yellow roadster with pop-up headlights and no roof.',
                           cars / '2 - Unknown/Cars/car_1.png', cars / '2 - Unknown/Cars/sample.png', cars / '2 - Unknown/Cars/car_1.png',
                           cars / '2 - Unknown/Cars/tyre.png', False, 150, (580, 108), (300, 0, 660, 104), 2.2, ['city', 'road']))
    out.append(cartoon_car('farm-truck', 'Farm Truck', 'An orange flatbed truck for hauling hay, crates and friends; the driver waves from the cab.',
                           cars / '3 - Truck/truck_1.png', cars / '3 - Truck/sample.png', cars / '3 - Truck/truck_1.png',
                           cars / '3 - Truck/tyre.png', False, 230, (864, 268), None, 1.8, ['farm', 'road']))

    # A silver hatchback, pixel art drawn at three pixels a pixel and facing left.
    car = rgba(s['chasers-car'] / 'car.png')
    car = car.resize((car.width // 3, car.height // 3), Image.NEAREST).transpose(Image.FLIP_LEFT_RIGHT)
    car = see_through(car, lambda r, g, b, x, y: (y < 0.45) & (g > r + 6) & (g > 140))
    wheels = [(car.width - 1 - 54 / 3, 121 / 3), (car.width - 1 - 238 / 3, 121 / 3)]
    frames = []
    for i in range(6):
        f = car
        for c in wheels:
            f = turn_patch(f, c, 5.5, i * 15)
        frames.append(f)
    box = frames[0].getchannel('A').getbbox()
    frames = nearest([f.crop(box) for f in frames], 6)
    out.append(Vehicle('silver-hatchback', 'Silver Hatchback', 'Cars', 'chasers-car', 'A family hatchback, in crisp pixel art.', 'pixel',
                       frames[:1], frames, ((40 - box[0]) * 6, (27 - box[1]) * 6), ms_walk=80, speed=2.0, closed=True, tags=['city', 'road', 'family']))

    # A motorcycle: pixel art at three pixels a pixel. Its back hub turns; the whole bike hums as it goes.
    bike = rgba(s['chasers-bike'] / 'bike.png')
    bike = bike.resize((bike.width // 3, bike.height // 3), Image.NEAREST)
    frames = []
    for i in range(6):
        f = turn_patch(bike, (17, 46), 8.5, i * 15)
        lifted = Image.new('RGBA', f.size)
        lifted.alpha_composite(f, (0, -1 if i % 2 else 0))
        frames.append(lifted)
    box = (0, 0, bike.width, bike.height)
    box = bike.getchannel('A').getbbox()
    box = (box[0], max(0, box[1] - 1), box[2], box[3])
    frames = nearest([f.crop(box) for f in frames], 3)
    out.append(Vehicle('motorcycle', 'Motorcycle', 'Bikes', 'chasers-bike', 'A sleek black sports motorcycle.', 'pixel',
                       [nearest([bike.crop(box)], 3)[0]], frames, ((40 - box[0]) * 3, (20 - box[1]) * 3), ms_walk=60, speed=2.6, tags=['city', 'road']))

    # A bicycle, rendered from 3D, eight frames of pedalling; its shadow is left out.
    cycle = rgba(s['clint-bicycle'] / 'bicycle.png')
    frames = []
    for i in range(8):
        f = cycle.crop((64 * i, 64 * 4, 64 * (i + 1), 64 * 5))
        a = np.array(f)
        rgb = a[:, :, :3].astype(int)
        shadow = (a[:, :, 3] < 250) & (rgb.max(axis=2) - rgb.min(axis=2) < 16) & (rgb.max(axis=2) < 120)
        a[shadow] = 0
        frames.append(Image.fromarray(a))
    box = frames[0].getchannel('A').getbbox()
    for f in frames[1:]:
        bb = f.getchannel('A').getbbox()
        box = (min(box[0], bb[0]), min(box[1], bb[1]), max(box[2], bb[2]), max(box[3], bb[3]))
    frames = nearest([f.crop(box) for f in frames], 4)
    out.append(Vehicle('bicycle', 'Bicycle', 'Bikes', 'clint-bicycle', 'A red bicycle that pedals along.', 'rendered',
                       frames[:1], frames, ((23 - box[0]) * 4, (20 - box[1]) * 4), ms_walk=80, speed=1.6, tags=['park', 'city']))

    # Horses to ride: saddled, walking, galloping when asked.
    lpc = s['lpc-horse'] / 'horse.zip.d/LPC Horse Extended'
    for id, name, coat, mane, face, about in (
        ('bay-horse', 'Bay Horse', 'Brown', 'Black', None, 'A saddled brown horse with a black mane, to ride at a walk or a gallop.'),
        ('palomino-horse', 'Palomino Horse', 'Gold', 'White', 'Blaze', 'A saddled golden horse with a white mane and a blaze.'),
    ):
        walk = horse_right(lpc_horse_layers(lpc, 'Walk', coat, mane, face, True), 6)
        gallop = horse_right(lpc_horse_layers(lpc, 'Gallop', coat, mane, face, True), 6)
        idle = horse_right(lpc_horse_layers(lpc, 'Idle', coat, mane, face, True), 1)
        saddle = horse_right(rgba(lpc / 'Accessories/Saddle Walk.png'), 1)[0].getchannel('A').getbbox()
        frames = idle + walk + gallop
        box = frames[0].getchannel('A').getbbox()
        for f in frames[1:]:
            bb = f.getchannel('A').getbbox()
            box = (min(box[0], bb[0]), min(box[1], bb[1]), max(box[2], bb[2]), max(box[3], bb[3]))
        frames = nearest([f.crop(box) for f in frames], 4)
        seat = (((saddle[0] + saddle[2]) / 2 - box[0]) * 4, (saddle[1] + 2 - box[1]) * 4)
        out.append(Vehicle(id, name, 'Horses', 'lpc-horse', about, 'pixel', frames[:1], frames[1:7], seat, ms_walk=130, speed=1.8,
                           extra=[('gallop', frames[7:13], 80, True)], tags=['farm', 'west', 'history']))

    # The stagecoach: the coach drawn above, pulled by a pair of LPC horses.
    near = horse_right(lpc_horse_layers(lpc, 'Walk', 'Brown', 'Black', None, False), 6)
    far = horse_right(lpc_horse_layers(lpc, 'Walk', 'Black', 'Black', 'Star', False), 6)
    near_idle = horse_right(lpc_horse_layers(lpc, 'Idle', 'Brown', 'Black', None, False), 1)[0]
    far_idle = horse_right(lpc_horse_layers(lpc, 'Idle', 'Black', 'Black', 'Star', False), 1)[0]

    def team(i: int, idle: bool) -> Image.Image:
        canvas = Image.new('RGBA', (190, 92))
        f, n = (far_idle, near_idle) if idle else (far[i], near[(i + 2) % 6])
        dim = Image.fromarray((np.array(f) * np.array([0.8, 0.8, 0.85, 1])).astype('uint8'))
        canvas.alpha_composite(dim, (50, -9))
        canvas.alpha_composite(coach(0 if idle else i * 5), (0, 0))
        canvas.alpha_composite(n, (42, -6))
        d = ImageDraw.Draw(canvas)
        d.line((63, 31, 128, 34), fill=OUTLINE)  # the reins
        return canvas

    frames = [team(0, True)] + [team(i, False) for i in range(6)]
    box = frames[0].getchannel('A').getbbox()
    for f in frames[1:]:
        bb = f.getchannel('A').getbbox()
        box = (min(box[0], bb[0]), min(box[1], bb[1]), max(box[2], bb[2]), max(box[3], bb[3]))
    frames = nearest([f.crop(box) for f in frames], 3)
    out.append(Vehicle('stagecoach', 'Stagecoach', 'Horse-drawn', 'questlab-coach',
                       'A red Concord stagecoach and its team of two horses; the rider takes the reins up on the box.', 'pixel', frames[:1], frames[1:], ((60 - box[0]) * 3, (32 - box[1]) * 3),
                       ms_walk=140, speed=1.4, tags=['west', 'history', 'travel']))
    return out


def build_vehicle(v: Vehicle) -> dict:
    frames = [solid(f) for f in v.idle + v.walk + [f for _, fr, _, _ in v.extra for f in fr]]
    box = frames[0].getchannel('A').getbbox()
    for f in frames[1:]:
        bb = f.getchannel('A').getbbox()
        if bb:
            box = (min(box[0], bb[0]), min(box[1], bb[1]), max(box[2], bb[2]), max(box[3], bb[3]))
    frames = [f.crop(box) for f in frames]
    seat = (v.seat[0] - box[0], v.seat[1] - box[1])
    fw, fh = frames[0].size
    columns = max(1, min(len(frames), 6, MAX_SHEET // fw))
    rows = (len(frames) + columns - 1) // columns
    sheet = Image.new('RGBA', (columns * fw, rows * fh))
    for i, f in enumerate(frames):
        sheet.paste(f, ((i % columns) * fw, (i // columns) * fh))
    folder = OUT / 'vehicles' / v.id
    folder.mkdir(parents=True, exist_ok=True)
    sheet.save(folder / 'sheet.png', optimize=True)

    n_idle, n_walk = len(v.idle), len(v.walk)
    animations = [{'name': 'idle', 'frames': list(range(n_idle)), 'duration': v.ms_idle * n_idle},
                  {'name': 'walk', 'frames': list(range(n_idle, n_idle + n_walk)), 'duration': v.ms_walk * n_walk}]
    start = n_idle + n_walk
    for name, fr, ms, repeat in v.extra:
        animations.append({'name': name, 'frames': list(range(start, start + len(fr))), 'duration': ms * len(fr), 'repeat': repeat})
        start += len(fr)

    # The card's picture: it moving, as an animated PNG.
    pw, ph = VEHICLE_PREVIEW
    fit = min(pw / fw, ph / fh)
    shots = []
    for i in animations[1]['frames']:
        canvas = Image.new('RGBA', VEHICLE_PREVIEW)
        shot = frames[i].resize((round(fw * fit), round(fh * fit)), Image.LANCZOS)
        canvas.paste(shot, ((pw - shot.width) // 2, ph - shot.height - 4), shot)
        shots.append(canvas)
    shots[0].save(folder / 'preview.png', save_all=True, append_images=shots[1:], duration=v.ms_walk, loop=0, disposal=1)

    # Where the rider sits: the vehicle is moved so its seat is under them, and lowered when the seat is
    # higher than their waist; they are cut off at the seat.
    seat_height = fh - seat[1]
    # Open: the rider's waist at the seat. Closed: lower, so the top of their head is just under the roof.
    lift = seat_height - WAIST
    if v.closed:
        lift = min(lift, fh * 0.96 - AVATAR)
    settings = {
        'scale': 1,
        'art_faces': 'right',
        'attach_layer': v.layer,
        'attach_offset_x': round(fw / 2 - seat[0]),
        'attach_offset_y': round(lift),
        'hide_rider_below': round(min(1, max(0, 1 - seat_height / fh)), 3),
        'speed_multiplier': v.speed,
    }
    return {
        'slug': v.id,
        'kind': 'vehicle',
        'name': v.name,
        'category': v.group,
        'description': v.about,
        'style': v.style,
        'tags': v.tags,
        'definition': {'file': 'sheet', 'item': {'physical': False, 'blocking': False, 'wearable': False, 'settings': settings}},
        'files': {
            'sheet': {'file': f'vehicles/{v.id}/sheet.png', 'params': {'sheet': {'columns': columns, 'rows': rows, 'count': len(frames)}, 'animations': animations}},
            'preview': {'file': f'vehicles/{v.id}/preview.png'},
        },
        'credit': credit(SOURCES[v.source]),
    }


LICENCE_URLS = {'CC0': 'https://creativecommons.org/publicdomain/zero/1.0/', 'CC-BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
                'CC-BY 4.0': 'https://creativecommons.org/licenses/by/4.0/'}


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    entries = []
    for c in characters():
        print(f'building {c.id}')
        entries.append(build(c))
    for v in vehicles():
        print(f'building {v.id}')
        entries.append(build_vehicle(v))
    (OUT / 'library.json').write_text(json.dumps({'version': 2, 'assets': entries}, indent=1, ensure_ascii=False) + '\n')

    lines = ['# QuestLab asset library: credits', '',
             'The animals and vehicles in the QuestLab asset library are built from art published on OpenGameArt.org',
             '(the stagecoach\'s coach is drawn by the script itself). Frames were cut out, backgrounds removed, turned',
             'to face right, cropped and scaled, and wheels set turning, by `tools/make-questlab-assets.py`. Each keeps its',
             'original licence; CC BY art must be credited wherever it is used (adding an asset copies the credit onto',
             'the media it adds).', '']
    for e in entries:
        cr = e['credit']
        lines.append(f"- **{e['name']}**: “{cr['title']}” by {cr['author']}, {cr['license']} ({LICENCE_URLS.get(cr['license'], '')}). {cr['url']}"
                     + (f" {cr['note']}" if cr.get('note') else ''))
    (OUT / 'CREDITS.md').write_text('\n'.join(lines) + '\n')
    print(f'{len(entries)} assets written to {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    sys.exit(main())
