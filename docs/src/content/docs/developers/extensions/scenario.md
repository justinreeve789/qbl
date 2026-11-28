---
title: "Scenario fields"
description: "Everything v2 adds to the top of the document: code, visibility, chat, objectives, avatars, glossary, narration and placeholders."
host:
  who: asimov
  says: "The top of the tree, version 2: what a whole mission can say about itself."
  side: right
---

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
spec_version | int | 1 | Version of the spec the document was written against.
code | string | | The scenario's unique code and its address: players open `/{code}`. It is 16 random lowercase letters when the scenario is created; the editor can change it to 4 to 32 lowercase letters, digits and hyphens (starting with a letter, not one of the site's own paths), after which the old code no longer opens it. `shortname` stays as a readable name and can be edited freely.
items | array | | Item definitions (see [Items](/docs/developers/item/)). Scenes place them with `scenes[].items`.
characters | array | | Character definitions (see [Characters](/docs/developers/character/)). Scenes place them with `scenes[].characters`.
asset_base_url | string | | Prefix for media `url` values that are neither absolute nor rooted. A `url` that starts with `/` (such as `/media/12/ab12….png`, a file uploaded in the editor) is used as it is.
visibility | string | public | `public`: on every player's missions page. `private`: only for students a teacher assigned it to.
chat_mode | string | emotes | `off`: no chat. `emotes`: a fixed set of emoji only. `free`: typed text, filtered by the game server.
move_speed | decimal | 420 | Avatar walking speed in scene pixels per second.
avatars | array | | The avatars players choose from: characters (see [Characters](/docs/developers/extensions/characters/)) with an `id` and a `name`. The first is the default. With the Laravel API these are the platform's avatars, the same in every scenario, added when the document is served with the pictures they use (avatar ids from 900000, platform pictures from 800000); a scenario does not set them. See [Classes, missions and teams](/docs/editor/classes/).
avatar_media_ids | array | | *Before `avatars`.* Image media ids players may choose as their avatar; each is read as an avatar whose id is the picture's id, standing facing right. Read only when `avatars` is absent.
avatar_portraits | object | | *Before `avatars`.* A close-up for such an avatar: `{"<avatar media id>": <portrait media id>}`.
objectives | array | | The mission checklist shown to the player. See below.
music_media_id | int | | Background music for the scenario: it plays in every scene that does not have music of its own.
music_volume | decimal | 0.5 | Volume of that music, 0 to 1.
session | object | null | Save data for the requesting player. See [Save data](/docs/developers/save-data/).
curriculum | object | | What the mission teaches: `standards` (`framework`, `code`, `description`, `alignment`, `rationale`), `learning_objectives` (`id`, `text`, `standards`), `vocabulary`, and `evidence`: for each objective, the variables that record a student's evidence of it. Written by the [mission generator](/docs/developers/generation/); the runtime ignores it.

scene_groups | array | | Groups of scenes, each `{id, name, team_only}`. A scene names its group with `group_id`. See [Teams in a scene](/docs/developers/extensions/scenes/#teams-in-a-scene).
glossary | array | | Words the mission teaches. See [Glossary](/docs/developers/actions/glossary/).
narration | string | off | `on`: dialogue, infoboxes and text overlays are read aloud unless an action says otherwise. `off`: only actions marked `narrate`. See [Reading text aloud](/docs/developers/actions/reading-aloud/).
narrator_voice | string | the default narrator | The narrator's voice: what no character says (`narration` actions, and the text overlays and infoboxes read aloud) is recorded in it. A key of the server's voice catalog. Absent: the server's default narrator for the scenario's language (in English, "storyteller": dramatic and charismatic). `none`: no narrator, so the browser reads them. See [The narrator](/docs/developers/actions/narration/).
private_messages | bool | false | Players may send typed messages to one other player. See [Messages](/docs/developers/extensions/player-interface/#messages).
notebook | bool | true | Players have a notebook (📒) for their own notes on this scenario. `false` hides it; what was written is kept. See [The notebook](/docs/developers/extensions/player-interface/#the-notebook).
wait_for_launch | bool | false | Kept in the scenario's `settings`. Students see the mission, and can join it, only once their teacher launches their assignment of it (`assignments.launched_at`): from the game (the `launch` message, see [Travel](/docs/developers/actions/travel/)) or from the Classes page (`POST`/`DELETE /api/teach/assignments/{id}/launch`). Not listed to students as a public mission, and its public instance is closed to them. Applies at once, without publishing.

`jump_targets` is generated from jump actions (including those on infobox buttons), by the API when it builds the JSON and again by the runtime. It may be either an object keyed by scene id (`{"3": [4]}`) or an array of `{scene_id, targets}`.

The game server only lets a player move to a scene listed in the current scene's jump targets.

## Objectives

A scenario can define a checklist that is shown on screen while it is played. Objectives are driven by variables, so events move the mission along simply by changing variables.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
id | string or int | | Unique within the scenario.
text | string | | What the player reads. May contain placeholders, e.g. `Collect samples ({{samples}}/3)`.
show_when | array of conditions | always | The objective is listed only while these hold. Use it to reveal steps as the mission unfolds.
complete_when | array of conditions | | The objective is ticked while these hold. Required.
optional | bool | false | Shown as a bonus.

The player is told when an objective becomes complete.

## Placeholders in text

Text overlays, infobox content, infobox button labels, text labels and objective text may contain placeholders:

* `{{variable_name}}` is replaced with the variable's current value. Reserved variables work too.
* `{{media:ID}}` is replaced with the URL of a media asset, for use in infobox HTML: `<img src="{{media:40}}" alt="">`. Written on its own in an infobox's text, it shows the media itself. See [Rich infoboxes](/docs/developers/actions/infobox/#rich-infoboxes).

Values are escaped when inserted into HTML. A placeholder that names nothing is left as written, so a typo shows up.
