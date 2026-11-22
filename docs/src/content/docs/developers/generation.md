---
title: "Generating missions with AI"
---

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
3. Draw | Draws every picture: each character's design and animation strips (their portrait is cut from the design); the mission's small things, several to a picture; doors and holes; every background; the mission patch | `assets/` in the work folder, `scenario_generations.manifest`
4. Build | Turns the blueprint into rows of the QuestLab tables, using the patterns from [Runtime extensions](/docs/developers/extensions/#patterns). Gives each character a voice from what the blueprint says of them, a different one each | 
4½. Voice | Records every line the characters say, with the time of every word, on the server's text-to-speech service ([Characters' voices](/docs/developers/voices/)). Free with Kokoro. If the service is down this is a warning, not a failure | `voices/` in the work folder
5. Package | Compiles the rows into `scenario.json` and packs it with its pictures as an import ZIP, plus a preview of each scene | `scenario.zip`, `previews/`
6. Import | Imports the ZIP exactly as the editor's "Import a ZIP" does, as a private draft owned by `--owner`; records its standards; publishes it if `--publish` | `scenarios` and the rest; `scenario_standards`

Each run has a work folder (`QuestLab_GEN_WORK_DIR`, `/data/generations/{id}` in Docker). If a run stops (a service is down, a key runs out of credit) carry on where it stopped, without paying for anything twice:

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
`--style=` | The art style (a folder in `resources/art-styles`). Default `QuestLab_GEN_STYLE`, `qbl-adventure`.
`--images=` | `gemini`, `openai`, `scenario` or `placeholder`.
`--design-only` | Stop after the blueprint, to review the plan cheaply before any picture is drawn. Then `--resume`.
`--no-import` | Make the ZIP but do not import it.
`--publish` | Publish the imported draft.
`--no-judge` | Do not check pictures against the style (cheaper, less consistent).
`--no-voices` | Do not record the characters' lines; the browser reads them aloud instead.
`--attempts=` | Attempts per picture before the best is kept (default 3).
`--budget=` | Most to spend on AI services for this run, in US dollars (default `QuestLab_GEN_BUDGET_USD`, 5; `0` for none). See [What it costs](#what-it-costs).

## What it costs

A run reports what it spends on AI services, priced from list prices (`Spend`): after the design it says how many pictures drawing the mission will take and roughly what they will cost (so `--design-only` is a cheap way to see the price first), and at the end what it spent, split into pictures and language model. The running total is kept in the work folder (`spend.json`), so a resumed run carries on counting, and goes in the ZIP's README. The figures are estimates, not a bill.

Pictures are most of the cost. How it is kept down:

- **Small things several to a picture.** A mission's items, the tables and rocks small things stand on, and the poses of its creatures are drawn up to six to a picture, in a grid that is cut apart (`QuestLab_GEN_PROP_SHEETS`); the grid is judged once. A thing whose cell came out empty or spilled into the next is drawn on its own.
- **A cheaper model for small cut-outs.** Things, sheets of things, doors and holes and the badge end up a few hundred pixels across: with Gemini they go to `QuestLab_GEN_GEMINI_PROPS_MODEL` (default `gemini-3.1-flash-image`) at `QuestLab_GEN_GEMINI_PROPS_SIZE` (1K, or 2K for a sheet with big things), about half the price of Gemini 3 Pro Image. Backgrounds, characters and their animations stay on `QuestLab_GEN_GEMINI_MODEL`, and so do style anchors. Every picture is still judged.
- **Only the animations the mission plays.** Every character walks; a gesture is drawn only if it is seen: `wave` for a character students talk to, `cheer` for the guide at the end, and any a cutscene asks of them. Their standing picture is their idle (`QuestLab_GEN_IDLE_FRAMES=true` draws a breathing idle as well).
- **Portraits cut from the character sheet** (`QuestLab_GEN_PORTRAITS=crop`): the sheet is drawn large, so its head and shoulders make a sharp portrait that is exactly the character's design. `draw` draws one more picture per character instead.
- **A budget** (`QuestLab_GEN_BUDGET_USD`, `--budget=`). Once a run has spent it, no picture is redrawn for a better score (the best attempt is kept and flagged, as after the last attempt) and gestures are left out (the built-in moves stand in). Everything the mission needs is still made. At twice the budget the run stops; resume it with a higher one.

The language model costs less, and is kept down too:

- **Corrections as changes.** When the blueprint has problems, the model answers with only the changes that fix them (set this field, remove that one, add to a list) rather than writing the whole blueprint again, which cost as much as writing it the first time. Only if three rounds of changes do not fix it is it rewritten once.
- **Prompt caching.** The instructions are cached on every call, the brief across the designer's corrections, and the style anchors across the judge's calls, so repeated calls read them at a twentieth of the price.
- **A smaller model where it is enough.** Aligning to standards uses `QuestLab_GEN_ALIGN_MODEL` (default Sonnet); the judge uses `QuestLab_GEN_JUDGE_MODEL` (Sonnet). The mission itself is still written by `QuestLab_GEN_LLM_MODEL` (Opus).

For a mission like the test one (five scenes, two characters, eleven small things, three doors and holes), drawing once takes 17 pictures, about $1.95 at list prices, where it took 31, about $4.27, before; redraws come on top, up to the budget. Prices change: `QuestLab_GEN_PRICES` overrides any of them (JSON, the shape of `Spend::PRICES`).

## The audit log

`spend.json` is a running total. For auditing, every run also writes **one row per thing it did that took time or money** to the `generation_events` table (`GenerationEvents`; the migration is `2026_11_21_000100_create_generation_events_table`, and `php artisan migrate` creates it). The rows go in as it works, so a run that fails or is cancelled leaves its log up to that point, and a resumed run carries on numbering (`seq`) where it left off.

| Column | What it holds |
|---|---|
| `generation_id`, `seq`, `stage` | The run, the order things happened in, and the stage (aligning, designing, drawing, building, voicing, importing). |
| `type` | `llm` (a language-model call, the judge's too), `picture`, `voice` (a recorded line), `stage` (the clock on the wall for a stage), `estimate` (what drawing was expected to cost, to compare with what it did). |
| `kind`, `step`, `label`, `attempt` | What it was for. For a call: its purpose (`curriculum_alignment`, `mission_blueprint`, `style_review`...). For a picture: what was drawn (`background`, `sheet`, `strip`...). `step` is the picture's key (`strip:keeper:walk`); a judge call carries the key and attempt of the picture it judged. |
| `model`, `size`, `references` | The model, a picture's size, how many reference pictures were sent. |
| `started_at`, `duration_ms` | When it began (UTC, to the millisecond) and how long it took. |
| `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` | A call's tokens. Output includes the model's thinking. |
| `usd` | What it cost at list prices (see `Spend::PRICES`): an estimate, not a bill. A picture or call that failed is logged with the error and what was charged. |
| `score`, `outcome`, `note` | The judge's score for a picture attempt, and how it ended: `ok`, `error`, `truncated` (cut off by `max_tokens`), `refused`, `kept`, `discarded` (a better attempt was kept), `rejected` (a problem found before judging), `cancelled`, `failed`. |

Read it with `php artisan qbl:generation-log` (recent runs, with time and cost), `qbl:generation-log 42` (one run by stage and by kind of work), `--steps` (every event in order, `--type=llm` to filter) or `--json`. Administrators also get it from the editor's API: `GET /api/editor/generations/{id}/events`. Teachers do not see costs. A few queries:

```sql
-- where a run's money went
SELECT type, kind, COUNT(*) AS calls, SUM(duration_ms) / 1000 AS seconds, SUM(usd) AS usd
FROM generation_events WHERE generation_id = 42 AND type IN ('llm', 'picture', 'voice') GROUP BY type, kind ORDER BY usd DESC;

-- what the judge costs, across runs
SELECT generation_id, COUNT(*) AS calls, SUM(usd) AS usd FROM generation_events WHERE type = 'llm' AND kind = 'style_review' GROUP BY generation_id;

-- pictures that took several attempts
SELECT step, COUNT(*) AS attempts, SUM(usd) AS usd FROM generation_events WHERE type = 'picture' GROUP BY generation_id, step HAVING COUNT(*) > 1;
```

Logging never stops a run: a row that cannot be written is dropped (and noted in the PHP error log). Calls made outside a generation (voicing a scenario from the editor, say) are not in it.

## What a generated mission contains

The model writes a **blueprint**, never event ids or action lists. MissionBuilder turns it into rows with fixed patterns, so the result always passes the validator and plays:

Interaction | Built as
----------- | --------
talk | The character's click runs a conversation in a story box with their portrait (freeze, lines, unfreeze). A character with several conversations has the next that applies; with none left, a short reminder in a bubble.
collect | A click hotspot showing the item, which disappears once taken, then an infobox with what the student observes.
inspect | A click hotspot that opens an infobox; it can be looked at again. A `quiet` one has no question mark, only its name near it, like a detail: for something that looks like nothing much but turns out to matter.
question | A non-dismissible infobox with a button per answer. Every answer is explained; a wrong one invites another try. It can pop up by itself after another interaction (`after`). A **prediction** (`purpose: predict`) accepts every answer and records it, before students find out. A **debrief question** (`at_report`) is asked by the guide in the final report.
experiment | A hands-on **instrument** (`instrument`): a large box with its controls side by side on one panel, made for the scene. Sliders set a number (no typing), switches turn something on or off, a wheel of chance is spun; meters show a slider's value as a bar. What it shows changes the moment a control moves (`shows`: "💡 the bulb glows dimly"). Its test button tries it: with the `goal`'s settings it is done and the success is explained; otherwise the first `misses` entry whose settings fit says why not (or a general nudge), and the box opens again as it was left. Each control is saved in `c_<experiment>_<control>`. An older blueprint's single value moved up and down to a target becomes an instrument with one slider.
use | A thing from the **bag** used on something in the scene (`uses`, at `x`, on a drawn `item` or on something painted into the background, `look`), or given to a character (`character`). A hotspot that takes the thing (it tests `QL_Holding`): the student walks over, the thing leaves the bag unless it `keeps`, what happens is said or shown, and anything it `gives` goes into the bag. Clicked without the thing, or with the wrong one, it says what is needed (`hint`); a character who wants something turns down anything else and says what they need.
team_task | A shared (`room`) counter each student adds to once, shown to everyone in the scene: several students must each do their part.

Around the interactions:

- **Ways between scenes, not only at the edges.** A scene's exit is either an edge (walk off it; a top exit is a doorway at the centre of the back) or a **passage standing in the scene** where the blueprint puts it: a `door` into a building, a `gate`, a `cave` mouth, a `portal`, a `tunnel`, a `ladder` or `stairs_up` to somewhere higher, or a `hole`, `hatch` or `stairs_down` in the floor. Clicked, the student walks over, (hops into a hole,) fades out and arrives at the other end. Every connection is listed once and is two-way; the way back is added: out of a building towards the viewer (its bottom edge), back up a ladder out of a hole, down a hatch from a ladder, unless the blueprint says otherwise (`back`). Passages are drawn as cut-outs and stood in the scene, so they are always where the hotspot is; the background is asked to leave room for them. `Connections` works all of this out for the validator, the art and the builder alike.
- **Scenes of different kinds**: `outdoor`, `indoor`, `underground`, `up_high`, `underwater`, which the background prompt describes.
- **Things at their real size, in sensible places.** Each item has `size_cm`, its real longest side, and is drawn to scale beside students 130 cm tall (`Sizes`): a 12 cm vial is about 62 pixels, a crate is waist-high, a door is taller than a person (small things are drawn a little larger than true so they can still be seen and clicked). Where an interaction's item goes (`placement`): `ground` (out on the floor, at varied depths, so students can walk behind it), `back` (where the floor meets the scenery), `surface` (small things, on a table indoors or a flat rock outside, which is drawn and placed for them and is solid) or `wall` (hung on the back wall, only in indoor and underground scenes). Without a placement, or with one that does not suit the thing's size or the scene, it goes by size: small things on a surface, middling ones on the floor, big ones at the back.
- **Backgrounds at the same scale as the people in them.** An image model left to itself paints scenery at any size, so a house can dwarf the students or a doorway come up to their knees. Every background prompt says how tall a 130 cm child is at the back and the front of the floor, as a share of the picture's height, and how big a doorway, a table and a grown-up are beside them (`AssetDirector::scaleNotes`), and sends a **scale guide** with it: a grey picture of the floor with child-sized figures and a doorway outline, at the shape the background is drawn (`ImageTools::scaleGuide`; `QBL_GEN_SCALE_GUIDE=false` leaves it out). The style judge is told to mark down scenery out of scale with the people.
- **A point-and-click adventure.** What students `collect` goes into their **bag** (a bar of things at the foot of the screen); an interaction can hand something over too (`gives`: the keeper gives a key, the chest holds a map). Things are used on the scene or given to characters (`use`, above), and two can be put together to make a third (`combinations`: a hook and some twine make a hook on a string), which the checklist can count. The validator plays the mission through with the bag: nothing is used before something puts it in the bag, and nothing is used up before the last thing that needs it.
- **Cutscenes.** After an interaction, a twist or the finale, a little scene can play for everyone there (`cutscene`): characters, or the student, walk somewhere, say a line in a bubble, make a gesture (drawn if the character has it, else a move every figure can make: jump, spin, dance, wave), wait, leave for good (walking off an edge), or **fall** (slip out of sight, crying out: off a cliff, into a crevasse). A shared `away_<character>` hides someone who has left or fallen. The guide never leaves or falls, and nobody leaves while students still need them.
- **Arrivals and rescues.** The first time anyone comes into a scene, something can happen for everyone there (`arrival`: a title, lines, a cutscene), once (a shared `arrival_<scene>`). Use it for a tense moment: the robot rolls over to say hello and slips off the edge of the terrace. Whoever falls is out of reach until an interaction that `rescues` them is done in that scene (a use on the spot, an instrument, a team task or an inspect; never a gift to them, since they cannot be reached): it shows only while they are in trouble (its item is best a picture of them hanging on), and once anyone has done it they fade back in where they stood, for everyone (a shared `saved_<rescue>`, which is what the checklist reads). Talks with them and things given to them wait for the rescue (tidy adds it to their `requires`), and someone who falls stands still until then. The validator checks that everyone who falls has a rescue, and that nothing needs them while they are away.
- **Every thing in the bag is used.** What goes into the bag is used on something, given to someone, or put together into something that is; anything else is an error ("make it an inspect instead"). Red herrings are only to look at.
- **Details.** Up to five things per scene that are only to look at (`details`): painted into the background, named when a student is near or points at them, and clicked, what the student notices in a bubble. Colour, jokes, red herrings; never collected, never counted.
- **Living skies, lights and the air.** An outdoor or up-high scene can have a living `sky` (a time of day, and what it slowly becomes over ten minutes: a sunset from `golden` until `dusk`), with `clouds` (`none`, `few`, `many`). Its background, and its far view if it has one, are painted with a flat chroma sky that is cut out, so the game's sky shows behind them; one band of white clouds is drawn for the whole mission (`clouds`, 2400 pixels wide, empty at both ends so it repeats) and drifts across, tinted with the sky's light, a second lower band for `many`. `lights` (up to four) are things drawn and stood in the scene, lit (`lantern`, `torch`, `candle`, `campfire`, `lamp`, `beacon`, `crystal`, `screen`, each with its own colour, reach, height and way of moving); the glow is put on the brightest part of the picture (`ImageTools::brightSpot`), or where such a light usually is, at the size the thing is drawn there. A campfire is in the way; a lantern is not. `atmosphere` (up to two: fireflies, leaves, snow, rain, dust, bubbles) goes straight into the scene. The validator keeps them to places that make sense: no sky indoors, no rain in a greenhouse, bubbles only under water, nothing hung on a wall outdoors.
- **Rich observations.** What students observe (`info`) can add a coloured note (`callout`: tip, fact, warn, think), flip cards (`cards`), a card that opens (`reveal`) and a large `picture` of one of the mission's items; a box with any of these is large.
- **No crew roles.** Every student can do everything; a teacher who wants to split the work does it in class. (Blueprints with `roles`, `role` or `share` from before are tidied: those are dropped.)
- **Scenes that feel alive.** Creatures come and go now and then (`ambient`: a bird lands, hops about and flies off; moths flit by; a beetle crosses the floor), each a little sprite sheet of its poses drawn with the props. Characters can stroll between spots in their scene (`walks`) and say lines to themselves (`chatter`), and extra characters who are not needed for the plot give a place its colour. A fun thing to look at needs no object: its `look` is painted into the background, with a question mark over it (or none, for a detail).
- **Depth.** A scene can be `wide` (3600 pixels instead of 2250, drawn 21:9 and kept from the bottom) with a far view behind it (`distance`): the background is asked for a flat chroma sky, which is cut out, and the far view is drawn on its own and drifts slower than the scene (parallax) as students walk. Something close to the viewer can stand in front (`foreground`: a strip along the bottom, such as the top of a wall, or a piece in a corner), and students walk behind it; a strip along the bottom lets them come until their legs are hidden, no further. Figures and things are drawn a little smaller at the back of the floor than at its front (a scale area, 90% to 108%), and the floor can end at walls or a drop (`floor.left`, `floor.right`) and have things lying in it that students walk around (`floor.blocked`, painted in and blocked off).
- **Quiet marks.** A thing to click shows a small question mark (drawn in code, the same in every mission, not by the image model) and its name only while a student is near it or the pointer is over it (`show_near`). Nothing pulses: every label the generator makes says `pulse: false`.
- **Twists and turns, and their pace.** A twist makes things harder; a turn changes luck or a heart. For each mission, six ideas are picked at random from `Design/TwistIdeas.php` (26 of them: swapped labels, a confident mistake, a power cut, the tide turning, a collector animal, fog, a misread map, a code, a hollow echo, an unexpected ally, a lucky gust...) and shown in the brief to show the range, and at least one twist must be **invented** for the mission, out of its place, story and topic (`invented: true`; the validator refuses one copied from the ideas). **Big tense moments** (someone falls, is trapped or swept away, and students save them) are kept rare: whether a mission may have one is decided by chance before it is designed (`QBL_GEN_BIG_MOMENT_CHANCE`, 0.25 by default) and written into the blueprint (`pace.big_moment`); without it, a fall is an error, and with it, there is at most one.
- **Twists.** A surprise right after an interaction or step (`after`): flashed across the screen of everyone in the scene, with a startled hop and the characters' reactions. It can close a way out of that scene (`blocks`) and put a solid obstacle in front of it (`obstacle`) until an interaction that `resolves` it is done; students elsewhere hear about it when they next arrive somewhere. The far side of a blocked way stays open, so nobody is ever shut out.
- **Hidden discoveries** (`hidden`) appear only when a student walks close.
- **Characters at their size, that move.** Every character is drawn standing (idle), walking and as a portrait, as tall as `height_cm` says beside 130 cm students: a grown-up is taller than the students, a small robot comes up to their waist. One that `walks` strolls between its spots (a routine run by the game server, seen by everyone); an older blueprint's `wanders` paces either side of its spot; `chatter` lines are said in a bubble now and then.
- **The debrief.** Once every required step is done, the guide's label changes to the report. The guide asks the debrief questions not yet answered right, and only then celebrates and completes the mission, showing how many questions the student got right first time. With an answer still wrong, the student is sent to think again and comes back.

Also built: exits that stay closed until something is done (with a message), spawn points for arriving through every way in, the guide's briefing on first arrival, the checklist (with counts), awards, and a mission patch in the marketplace.

The validator also checks the new parts: passages have a place and a look and keep apart, two scenes connect once, there are one to three debrief questions and none is part of a step, every twist that blocks a way has something that sets it right, reachable without going through that way, what the bag holds comes from somewhere and lasts as long as it is needed, cutscenes only use characters who are there, an instrument's goal can be reached with its controls' ranges and options (and is not met before students change anything) and what it shows and its misses read controls it has, everyone who falls is rescued, every thing in the bag is used, a far view is only behind an outdoor scene, a foreground along the bottom never walls off a way out towards the viewer, and the floor reaches every edge students leave by and is clear in front of passages.

**Variables** a teacher report can read: `done_<interaction or combination>` (1 once done; for a question, once answered correctly), `q_<question>_first` (the first answer chosen, 1-based), `q_<question>_answer` (its text, predictions included), `q_<question>_tries`, `score` (questions right first time), `team_<task>` (shared), `has_<item>` (1 while it is in the student's bag), `twist_<key>`, `away_<character>` (shared), `saved_<rescue>` (shared), `arrival_<scene>` (shared), `c_<experiment>_<control>` (what each control of an instrument was left at), `mission_complete`. `curriculum.evidence` lists, for each objective, its questions (debrief ones marked), predictions and experiments; `curriculum.scored_questions` is there too.

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

1. **A style bible.** `resources/art-styles/<style>/style.php` says how pictures look: medium, outlines, shading, shapes, proportions, lighting, a named palette, what each kind of picture shows and how it is framed, and what to avoid. `ArtStyle` writes **every** prompt from it, in the same words and the same order, with only the subject changing.
2. **Anchors.** A few approved pictures (an environment, a character, a set of props, a portrait) in `anchors/` go with every request as references, and every result is **judged against them** by a vision model acting as art director (`StyleJudge`): line, shading, colour, shapes, rendering, subject and composition, each out of 10. A picture under the bar (7 by default, and no criterion under 5) is drawn again with the judge's corrections added. After the last attempt the best one is kept and flagged in the README and the command's output.
3. **Design before motion.** Each character is drawn once as a character sheet. Every animation strip is drawn *from* that sheet (it is the first reference), judged against it, and colour-matched to it, and their portrait is cut from it, so a character looks the same in every frame and in the story box. The mission's first background goes with every later background, and its first character with every later character.
4. **One finish.** Cut-outs are drawn on a flat chroma colour (`#FF00FF`) and keyed out (or drawn transparent, where the provider can), trimmed, and scaled to fixed sizes (characters on 240 × 320 frames, items to their real size, passages to fixed heights such as a door at 360 pixels, portraits 320 square on the same backdrop, backgrounds 2250 × 1200). Every picture is pulled part of the way towards the palette (`post.palette_pull`), keeping its shading.
5. **A trained model, later.** Once 15-30 approved pictures exist (the anchors and the best of the generated ones), train a style model on them in Scenario and use `--images=scenario`: the most consistent option of all.

### The styles

- **`qbl-adventure`** (the default): hand-painted cartoon art in the spirit of classic 1990s point-and-click adventure games: vibrant, intricate, whimsical, with lots of open floor. Written from a prompt that gave good results in Recraft.
- **`qbl-cartoon`**: a flatter, cleaner vector cartoon with cel shading.

A new style is a new folder with a `style.php`; copy one of these and change the words.

### Setting up the anchors

Do this once, before generating missions with a real image service (the command refuses otherwise, unless `--without-anchors`):

```sh
php artisan qbl:art-style qbl-adventure --bootstrap                 # 3 candidates each for environment, character, props
php artisan qbl:art-style qbl-adventure --approve=environment:2 --approve=character:1 --approve=props:3
php artisan qbl:art-style qbl-adventure --bootstrap --role=portrait # drawn from the approved character
php artisan qbl:art-style qbl-adventure --approve=portrait:1
```

The candidates are in the work folder under `anchors/`. **Commit the approved anchors** with the style: they define it. In Docker, approving writes into the container; copy them out with `docker compose cp app:/app/resources/art-styles ./apps/api/resources/` and commit them.

Changing the bible or the anchors changes every picture made after it, so bump the style's `version` when you do; every picture records the version it was made with.

The platform's avatars (in `scenarios/assets/platform/`) and the demo's art were made before this style existed and do not match it yet.

### Sprite sheets

Each character gets `walk` (6 frames), with their standing picture as `idle` (or a drawn 4-frame idle, with `QuestLab_GEN_IDLE_FRAMES=true`), plus the gestures the designer chose that the mission plays (`wave` for a character students talk to, `cheer` for the guide). **Every character walks, stands and has a portrait**, whatever happens: a walk that cannot be drawn in six frames is tried in four, and failing that it is made from the standing picture (it bobs, leans and swings its legs). The portrait is the head and shoulders cut from the character sheet (or drawn, with `QuestLab_GEN_PORTRAITS=draw`; one that cannot be drawn is cut from the sheet and flagged in the README). Each animation is drawn as one strip, from the character sheet. The strip is cut out and its figures found by connected regions (pieces such as a separately drawn hand are joined to their figure); a strip with the wrong number of figures is drawn again. Each frame is colour-matched to the sheet, scaled so the character keeps one size across animations, centred by its centre of mass and stood on a common baseline, then laid out one animation per row as an ordinary QuestLab sheet with `sheet` and `animations` (see [Animations](/docs/developers/extensions/#animations)). A gesture that cannot be drawn well is left out, and the built-in move of that name is used instead.

## Image services

Driver | Model (default) | Notes
------ | --------------- | -----
`gemini` | `gemini-3-pro-image-preview` | Up to 14 reference images per request: the best fit for anchors plus a character sheet. No transparency, so cut-outs use the chroma colour. `GEMINI_API_KEY`.
`openai` | `gpt-image-2` | Up to 16 reference images; draws transparent backgrounds itself. `OPENAI_API_KEY`.
`scenario` | your trained model | `SCENARIO_API_KEY`, `SCENARIO_API_SECRET`, `SCENARIO_MODEL_ID`. Not yet run against the live API: check its request fields against Scenario's documentation first.
`placeholder` | | Draws labelled shapes locally, for free, through the same cutting, slicing and packaging. For trying the pipeline, laying out a mission before paying for art, and the tests.

The language model is Claude (`ANTHROPIC_API_KEY`): `QuestLab_GEN_LLM_MODEL` writes the mission, `QuestLab_GEN_ALIGN_MODEL` aligns it to standards, `QuestLab_GEN_JUDGE_MODEL` judges pictures.

These models think before they answer (on Opus 5.5 thinking is always on), and the thinking counts toward each answer's token limit, however short the teacher's prompt is. So every call gets `QuestLab_GEN_THINKING_TOKENS` (default 32000) on top of the room for its answer, up to the model's 128000. The mission blueprint, for instance, gets 32000 for the answer plus that room. It is only a ceiling, so unused room is not paid for. `QuestLab_GEN_LLM_EFFORT` (low, medium, high, xhigh, max; empty means each model's default) sets how hard they think. If a run stops with "ran out of room", the message says whether the model was still thinking. Raise `QuestLab_GEN_THINKING_TOKENS` or lower the effort. `QuestLab_GEN_LLM_TIMEOUT` (default 1800 seconds) is how long to wait for one answer.

**Every setting is in `.env`**: keys, models, API addresses, image sizes, the art style, judging, the budget, prices, which pictures are drawn, and limits. `.env.example` lists them all with their defaults; an empty value means the default. `docker-compose.yml` passes them to the `app` container, and `apps/api/config/qbl_generation.php` reads them.

Gemini's image models are not on its free tier: the key's project needs billing turned on in Google AI Studio. Without it every request is refused with a quota of 0, and the generator says so.

## From the editor: the queue, progress and cancelling

The editor's **Generate** page (`apps/editor/src/views/generate.ts`) calls `App\Qbl\Generation\GenerationApi` under `/api/editor/generations`. Starting one checks the plan (`Entitlements`), takes the credits (`Credits`) and dispatches `App\Jobs\RunGeneration` to the queue worker in the app container, which runs the same `ScenarioGenerator` as `qbl:generate`.

Route | What
----- | ----
`GET editor/generations` | my runs, the cost, my plan and credits
`POST editor/generations` | start one (202)
`GET editor/generations/active` | the one being made now, or null (the editor's header chip asks every 4 seconds while there is one)
`GET editor/generations/all` | administrators: everyone's latest 50, with who asked and `usd` spent
`GET editor/generations/{id}` | one run
`POST editor/generations/{id}/cancel` | stop it

**Progress** (`GenerationProgress`) is kept on the run's row, `scenario_generations.progress`: the stage, the stages it will go through, the percent, what it is doing, pictures (or lines) done of the total, and when it and the stage started. Each stage owns a slice of the bar weighted by how long it usually takes (drawing is 26-88%). Drawing is counted in the same pictures as the cost estimate (`AssetDirector::estimate`), reported before each one. The bar never goes back. Between reports the editor creeps it forward within the step it is in, never past the next report.

**Cancelling** sets `scenario_generations.cancelled_at`. A run still queued is cancelled at once; a running one checks at every progress report, throws `GenerationCancelled`, and the job marks it `cancelled`. Either way the credits are given back once. A busy run with no progress for 30 minutes (`GenerationApi::STALE_SECONDS`: its worker went away) is marked failed, with its credits back, so the teacher can start another.

Without Docker, the dev server (`npm run dev:editor`) cannot make missions; with `QuestLab_DEV_GENERATOR=1` it pretends, moving a run through every stage in about 70 seconds and ending with an empty draft (a number of seconds above 1 sets how long).

## Testing

`npm run test:generation` runs the whole pipeline with no network, and checks every progress report it makes: a stand-in model answers from `apps/api/tests/fixtures/generation/blueprint.php` (a mission with every feature: a door, a hole, a twist, predictions, a debrief, the bag, cutscenes, a wide scene with a far view, foregrounds...), and the placeholder draws the pictures. With the JavaScript side installed (`npm install`), it then checks the generated scenario with the game's own validator, and plays it **from the briefing to the debrief through the real engine** (`apps/client/test/generated-mission.test.ts`): a student goes through the door, picks up twine, sees the twist, digs the channel, jumps into the hole, finds a hook, puts the two together, fishes a battery out of a crack with them, gives it to the robot (after offering him the wrong thing), makes a prediction, runs the experiment, answers the debrief wrong and then right, and watches the pilot leave.

## Reviewing a generated mission

Before publishing, look at:

- `previews/` in the ZIP or the work folder: each scene as it will look, with its walkable floor (green), hotspots (red) and spawn points (blue). Doors, holes and twists' obstacles are drawn too (an obstacle is only there once its twist has happened).
- The README in the ZIP: its standards and objectives, the puzzles with the bag and their answers, the twists, every question (scored, prediction or debrief), and any picture kept below the style bar.
- The mission itself, with the editor's "Test this scene".

Generated content is a first draft from a language model: check facts, reading level and tone as you would anyone else's work.

## Not done yet

- Music and sound effects (scenes have none; add them in the editor).
- Starting a generated mission from a copy of the starship hub, with a console that launches it.
- Regenerating one picture or one scene of an imported mission from the editor.
- Regenerating from where a failed editor run stopped (the editor starts afresh; `qbl:generate --resume` can carry on).
