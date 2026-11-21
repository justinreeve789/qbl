---
title: The asset library
description: Ready-made characters, vehicles, items, pictures and sounds kept once for the whole platform, and added to any scenario.
---

The asset library holds things anyone can add to a scenario: animals, vehicles, items, pictures and sounds. QuestLab ships a pack of them; administrators can add more, from files or from something made in a scenario. Teachers see them in the editor under **🐾 Add QuestLab Assets** (Characters and Items pages).

Adding an asset **copies** the files it uses into the scenario's media (once per scenario: a second Red Squirrel shares the first one's sheet) and creates the row it describes. Nothing in a scenario points back at the library afterwards, so a scenario exports, duplicates and plays whole, and changing or withdrawing an asset never breaks one.

## Tables

`library_assets`: one row per asset.

| Column | |
| --- | --- |
| `slug` | Unique name used to refer to it: `red-squirrel`, `stagecoach`. |
| `kind` | `character`, `vehicle`, `item`, `picture` or `sound`. |
| `name`, `category`, `description`, `tags` (JSON list), `style` | What the library shows and searches. |
| `definition` (JSON) | What adding it makes, naming its files by role (below). |
| `credit` (JSON) | `{title, author, license, url, note}`. Copied onto every media row it adds. |
| `organization_id` | Null: everyone's. Otherwise only that organization's teachers see it. |
| `created_by`, `source` | Who added it, and how: `pack`, `upload` or `scenario`. |
| `active`, `sequence` | Withdrawn assets are not offered; the order they are listed in. |

`library_asset_files`: the files of an asset, one per `role` (`sheet`, `portrait`, `image`, `sound`, `preview`...), with `type`, `url`, `width`, `height`, `bytes` and the `params` the file carries into a scenario's media (`sheet {columns, rows, count}`, `animations`, `scale_x`/`scale_y`). `path` says where it is kept: `pack:…` in the shipped pack, `media:library/<asset id>/…` in the media directory. Files with the role `preview` or `thumbnail` are only for showing the asset in the library.

### Definitions

```jsonc
// character: its animations, drawn from its files
{ "animations": { "stand_right": { "file": "sheet", "frames": [0, 1], "duration": 800 },
                  "walk_right":  { "file": "sheet", "frames": [2, 3, 4, 5], "duration": 400 },
                  "portrait":    { "file": "portrait" } },
  "scale": 1 }

// vehicle (or item): its picture and the item it makes
{ "file": "sheet",
  "item": { "physical": false, "blocking": false,
            "settings": { "scale": 1, "art_faces": "right", "attach_layer": "front", "attach_offset_x": 64,
                          "attach_offset_y": 67, "hide_rider_below": 0.28, "speed_multiplier": 1.4 } } }

// picture or sound: just the media
{ "file": "image" }
```

A vehicle's sheet carries `idle` and `walk` animations, which the game plays by itself while it stands and while it is ridden.

## In Laravel

`App\Models\LibraryAsset` (with `files()`) and `App\Models\LibraryAssetFile` read the tables; changes go through `App\Qbl\Library\AssetLibrary`, which checks definitions and stores files (it is plain PHP over PDO, shared with the dev server and the tests).

```php
use App\Models\LibraryAsset;

LibraryAsset::active()->ofKind('vehicle')->ordered()->get();
LibraryAsset::search('horse')->visibleTo($user)->get();
LibraryAsset::resolve('stagecoach')->file('sheet')?->url;

// Add one to a scenario: ['asset', 'created' => ['table', 'row'], 'media' => [...], 'copied' => [ids]]
LibraryAsset::resolve('bay-horse')->addTo($scenario, ['name' => 'Thunder']);

// Keep a scenario's character, item or media row as a new asset
LibraryAsset::keep($scenario, 'characters', $characterId, ['category' => 'Robots', 'tags' => 'space, friendly']);

// Give an asset a file
LibraryAsset::resolve('night-sky')->attach('image', '/path/to/sky.png', ['scale_x' => 2]);
```

`app(AssetLibrary::class)` does the same and more: `all($filter, $user)`, `categories()`, `get()`, `save()`, `remove()`, `putFile()`, `removeFile()`, `addToScenario()`, `capture()`, `importPack()`.

From the command line:

```sh
php artisan qbl:library                         # list (--kind=vehicle, --q=horse)
php artisan qbl:library show stagecoach
php artisan qbl:library import --refresh        # bring the library up to date with the shipped pack
php artisan qbl:library add bay-horse --to=12   # add to scenario 12 (id, code or shortname)
php artisan qbl:library keep --to=12 --table=characters --row=40 --name="Captain Vega"
php artisan qbl:library withdraw motorcycle     # and: restore motorcycle
```

`php artisan qbl:seed` imports the pack too (`LibrarySeeder`), adding each asset once by slug so later changes are kept; `qbl:seed --reset` refreshes them.

## HTTP API

Under `/api/editor/library`, with the editor's sign-in. Teachers and administrators list and add; only administrators change the library.

| | |
| --- | --- |
| `GET library?kind=vehicle,item&category=&q=&tag=` | `{assets, categories, kinds}` |
| `GET library/{asset}` | `{asset}`; `{asset}` is an id or a slug |
| `POST library/{asset}/add` `{scenario_id, name?}` | Adds it to a scenario the user can edit: `{asset, created: {table, row}, media, copied}` |
| `POST library` | Create an asset (administrators) |
| `PATCH library/{asset}` / `DELETE library/{asset}` | Change or remove one |
| `POST library/{asset}/files` | Multipart `file`, `role`, `params` (JSON) |
| `DELETE library/{asset}/files/{role}` | |
| `POST library/capture` `{scenario_id, table, row_id, name?, slug?, category?, tags?, credit?}` | Keep a scenario's character, item or media row |

For the platform's own services (the generator, the game server, scripts) the same reads and adding are on the internal API, with the service key (`X-QBL-Service-Key`):

| | |
| --- | --- |
| `GET /api/internal/library?kind=…` | `{assets, categories}` |
| `GET /api/internal/library/{slug}` | `{asset}` |
| `POST /api/internal/scenarios/{scenario}/library/{slug}` `{name?}` | Adds it to the scenario |

## The shipped pack

The pack is `scenarios/assets/library/`: `library.json` (each asset with its definition, files and credit), the pictures under `characters/` and `vehicles/`, and `CREDITS.md`. The web server serves it as `/scenario-assets/library/`; the API reads it from the checkout (`QBL_LIBRARY_DIR`, in the containers `/repo/scenarios/assets/library`).

`tools/make-questlab-assets.py` builds it from art published on OpenGameArt.org (CC0, or CC BY with the credit kept): it downloads the originals, cuts out frames, removes flat backgrounds, faces everything right, crops all of an asset's frames alike, scales pixel art in whole steps, sets car wheels turning, works out where a vehicle's rider sits, and writes the sheets, close-ups and animated card previews. To add to the pack, add a source and an entry there, run it, then `php artisan qbl:library import`.
