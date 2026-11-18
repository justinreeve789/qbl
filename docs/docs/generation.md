# Generating missions with AI

`php artisan qbl:generate` makes a whole mission from a teacher's prompt: it aligns the mission to curriculum standards, writes the story, scenes, characters, dialogue, questions and events, draws every picture in the house art style, and imports the result as a private draft for the teacher to review.

```sh
docker compose exec app php artisan qbl:generate \
  "Students find out why an orchard on an alien planet has flowers but no fruit" \
  --grade=3 --subject=Science --framework=NGSS --players=2-6 --owner=teacher@school.org
```

It prints its progress and ends with the new scenario's id. The mission is **private and unpublished**: open it in the editor, play it with "Test this scene", change anything, then publish and assign it.

## What happens

Step | What | Kept in
---- | ---- | -------
1. Align | Chooses 1-3 primary standards (and up to 3 supporting ones) from those imported, and writes measurable learning objectives, vocabulary and misconceptions to address | `scenario_generations.alignment`
2. Design | Writes the **blueprint**: story, scenes and how they connect, characters, items, interactions, the checklist, the briefing and the final report. It is checked, and sent back to be corrected until it can be built | `scenario_generations.blueprint`, `blueprint.json`
3. Draw | Draws every picture: each character's design, portrait and animation strips; every item; every background; the mission patch | `assets/` in the work folder, `scenario_generations.manifest`
4. Build | Turns the blueprint into rows of the QBL tables, using the patterns from [Runtime extensions](extensions.md#patterns) | 
5. Package | Compiles the rows into `scenario.json` and packs it with its pictures as an import ZIP, plus a preview of each scene | `scenario.zip`, `previews/`
6. Import | Imports the ZIP exactly as the editor's "Import a ZIP" does, as a private draft owned by `--owner`; records its standards; publishes it if `--publish` | `scenarios` and the rest; `scenario_standards`

Each run has a work folder (`QBL_GEN_WORK_DIR`, `/data/generations/{id}` in Docker). If a run stops (a service is down, a key runs out of credit) carry on where it stopped, without paying for anything twice:

```sh
php artisan qbl:generate --resume=12
```

The ZIP is an ordinary scenario archive: it can be imported again, on another installation or by hand (`php artisan qbl:generate --import=path/to/scenario.zip`).

## Options

Option | Effect
------ | ------
`--grade=` | K, 1-12, or a range such as `6-8`. Only standards for that grade are offered.
`--subject=` | Helps choose standards and pitch the content.
`--framework=` | The standards set(s) to align to, as named when imported (repeatable).
`--standard=` | Exact standard codes to build the mission around, instead of choosing (repeatable). Each must be imported.
`--scenes=` | How many scenes. Default: the designer decides, usually 3 to 6.
`--players=2-6` | How many students play together. Team tasks never need more students than the minimum.
`--minutes=` | Rough playing time.
`--notes=` | Anything else for the designer ("set it in ancient Egypt", "no reading above grade 2").
`--owner=` | The teacher who owns the draft.
`--style=` | The art style (a folder in `resources/art-styles`). Default `qbl-cartoon`.
`--images=` | `gemini`, `openai`, `scenario` or `placeholder`.
`--design-only` | Stop after the blueprint, to review the plan cheaply before any picture is drawn. Then `--resume`.
`--no-import` | Make the ZIP but do not import it.
`--publish` | Publish the imported draft.
`--no-judge` | Do not check pictures against the style (cheaper, less consistent).
`--attempts=` | Attempts per picture before the best is kept (default 3).

## What a generated mission contains

The model writes a **blueprint**, never event ids or action lists. MissionBuilder turns it into rows with fixed patterns, so the result always passes the validator and plays:

Interaction | Built as
----------- | --------
talk | The character's click runs a conversation in a story box with their portrait (freeze, lines, unfreeze). A character with several conversations has the next that applies; with none left, a short reminder in a bubble.
collect | A click hotspot showing the item, which disappears once taken, then an infobox with what the student observes.
inspect | A click hotspot that opens an infobox; it can be looked at again.
question | A non-dismissible infobox with a button per answer. Every answer is explained; a wrong one invites another try. It can pop up by itself after another interaction (`after`).
experiment | The "hands-on experiment" loop: buttons move a value one step at a time; reaching the target completes it.
team_task | A shared (`room`) counter each student adds to once, shown to everyone in the scene: several students must each do their part.

Also built: scene exits (walk off an edge; a top exit is a doorway at the centre of the back), exits that stay closed until something is done (with a message), spawn points for arriving from each neighbour, the guide's briefing on first arrival, the checklist (with counts), the final report to the guide, awards, and a mission patch in the marketplace.

**Variables** a teacher report can read: `done_<interaction>` (1 once done; for a question, once answered correctly), `q_<question>_first` (the first answer chosen, 1-based), `q_<question>_tries`, `score` (questions right first time), `team_<task>` (shared), `mission_complete`.

**Curriculum** travels in the scenario document as `curriculum`: the standards, the learning objectives, vocabulary, and for each objective the variables that give evidence of it. The `scenario_standards` table holds the same alignment with its rationale and evidence, for reports and for finding missions by standard.

## Curriculum standards

Missions are only aligned to standards in the `curriculum_standards` table: the codes the model may choose from are an enum built from that table, so a code is never invented. Import standards first:

```sh
php artisan qbl:standards                                   # what is imported
php artisan qbl:standards file standards.json --framework=MY-DISTRICT-SCI
php artisan qbl:standards learning-commons <framework uuid> --framework=CA-MATH --grade=5
php artisan qbl:standards csp <standard set id> --framework=NGSS
```

- **A JSON file** needs no account: `[{"code": "...", "description": "...", "grades": ["05"], "subject": "Science"}]`.
- **Learning Commons** (`LEARNING_COMMONS_API_KEY`, from platform.learningcommons.org) has every US state's standards and CCSS, with CASE identifiers.
- **Common Standards Project** (`CSP_API_KEY`) serves standard sets by id.

Importing again updates rows in place. Without any standards for the grade and framework, a mission is still made, with learning objectives but no alignment, and the command says so.

## Keeping every picture in one style

This is the part that takes the most care. Five things work together:

1. **A style bible.** `resources/art-styles/qbl-cartoon/style.php` says how pictures look: medium, outlines, shading, shapes, proportions, lighting, a named palette, what each kind of picture shows and how it is framed, and what to avoid. `ArtStyle` writes **every** prompt from it, in the same words and the same order, with only the subject changing.
2. **Anchors.** A few approved pictures (an environment, a character, a set of props, a portrait) in `anchors/` go with every request as references, and every result is **judged against them** by a vision model acting as art director (`StyleJudge`): line, shading, colour, shapes, rendering, subject and composition, each out of 10. A picture under the bar (7 by default, and no criterion under 5) is drawn again with the judge's corrections added. After the last attempt the best one is kept and flagged in the README and the command's output.
3. **Design before motion.** Each character is drawn once as a character sheet. Their portrait and every animation strip are drawn *from* that sheet (it is the first reference), judged against it, and colour-matched to it, so a character looks the same in every frame and in the story box. The mission's first background goes with every later background, and its first character with every later character.
4. **One finish.** Cut-outs are drawn on a flat chroma colour (`#FF00FF`) and keyed out (or drawn transparent, where the provider can), trimmed, and scaled to fixed sizes (characters on 240 × 320 frames, items 130/230/400 pixels tall, portraits 320 square on the same backdrop, backgrounds 2250 × 1200). Every picture is pulled part of the way towards the palette (`post.palette_pull`), keeping its shading.
5. **A trained model, later.** Once 15-30 approved pictures exist (the anchors and the best of the generated ones), train a style model on them in Scenario and use `--images=scenario`: the most consistent option of all.

### Setting up the anchors

Do this once, before generating missions with a real image service (the command refuses otherwise, unless `--without-anchors`):

```sh
php artisan qbl:art-style qbl-cartoon --bootstrap                 # 3 candidates each for environment, character, props
php artisan qbl:art-style qbl-cartoon --approve=environment:2 --approve=character:1 --approve=props:3
php artisan qbl:art-style qbl-cartoon --bootstrap --role=portrait # drawn from the approved character
php artisan qbl:art-style qbl-cartoon --approve=portrait:1
```

The candidates are in the work folder under `anchors/`. **Commit the approved anchors** with the style: they define it. In Docker, approving writes into the container; copy them out with `docker compose cp app:/app/resources/art-styles ./apps/api/resources/` and commit them.

Changing the bible or the anchors changes every picture made after it, so bump the style's `version` when you do; every picture records the version it was made with.

The platform's avatars (in `scenarios/assets/platform/`) and the demo's art were made before this style existed and do not match it yet.

### Sprite sheets

Each character gets `idle` (4 frames) and `walk` (6), plus up to two gestures the designer chose (`wave`, `cheer`, `point`, `think`). Each animation is drawn as one strip, from the character sheet. The strip is cut out and its figures found by connected regions (pieces such as a separately drawn hand are joined to their figure); a strip with the wrong number of figures is drawn again. Each frame is colour-matched to the sheet, scaled so the character keeps one size across animations, centred by its centre of mass and stood on a common baseline, then laid out one animation per row as an ordinary QBL sheet with `sheet` and `animations` (see [Animations](extensions.md#animations)). An animation that cannot be drawn well is left out, and the built-in move of that name is used instead.

## Image services

Driver | Model (default) | Notes
------ | --------------- | -----
`gemini` | `gemini-3-pro-image-preview` | Up to 14 reference images per request: the best fit for anchors plus a character sheet. No transparency, so cut-outs use the chroma colour. `GEMINI_API_KEY`.
`openai` | `gpt-image-2` | Up to 16 reference images; draws transparent backgrounds itself. `OPENAI_API_KEY`.
`scenario` | your trained model | `SCENARIO_API_KEY`, `SCENARIO_API_SECRET`, `SCENARIO_MODEL_ID`. Not yet run against the live API: check its request fields against Scenario's documentation first.
`placeholder` | | Draws labelled shapes locally, for free, through the same cutting, slicing and packaging. For trying the pipeline, laying out a mission before paying for art, and the tests.

The language model is Claude (`ANTHROPIC_API_KEY`): `QBL_GEN_LLM_MODEL` writes and aligns the mission, `QBL_GEN_JUDGE_MODEL` judges pictures. Settings are in `apps/api/config/qbl_generation.php`.

## Reviewing a generated mission

Before publishing, look at:

- `previews/` in the ZIP or the work folder: each scene as it will look, with its walkable floor (green), hotspots (red) and spawn points (blue).
- The README in the ZIP: its standards and objectives, and any picture kept below the style bar.
- The mission itself, with the editor's "Test this scene".

Generated content is a first draft from a language model: check facts, reading level and tone as you would anyone else's work.

## Not done yet

- Music and sound effects (scenes have none; add them in the editor).
- Starting a generated mission from a copy of the starship hub, with a console that launches it.
- Regenerating one picture or one scene of an imported mission from the editor.
- Running generation from the editor as a queued job, with progress shown there.
