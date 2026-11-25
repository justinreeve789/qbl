---
title: "Runtime extensions (spec v2)"
description: "What the walk-around multiplayer runtime adds to the original scenario JSON, and where each part is documented."
host:
  who: asimov
  says: "The full runtime spec, version 2, now in pieces you can actually find things in."
  side: right
---

The [original reference pages](/docs/developers/structure/) describe the JSON as first designed. The walk-around multiplayer runtime needs a few things those pages do not cover: where avatars can walk, where they appear, how scenes connect, where items and characters stand, and which state is shared between players. This section is that spec, split by what you are trying to write.

## Ground rules

* Everything in this section is **optional and additive**. A document that uses none of it still plays: the whole scene is walkable, players appear in the centre, and all variables are per-player.
* Set `"spec_version": 2` on scenarios that use these fields.
* All coordinates are scene pixels with the origin at the top left. An avatar's position is the position of its **feet**.
* `npm run validate -- path/to/scenario.json` checks a document against all of it. See [Run QuestLab locally](/docs/developers/local-development/#check-a-scenario).

## The pages

### The document

Page | What it covers
---- | --------------
[Scenario fields](/docs/developers/extensions/scenario/) | `code`, `visibility`, `chat_mode`, avatars, objectives, glossary, narration, `curriculum`, and `{{placeholders}}` in text
[Scenes, layers and spawn points](/docs/developers/extensions/scenes/) | World size, walkable and blocked areas, what stands in front of what, layers, music, scale areas, spawn points, moving between scenes, teams in a scene
[Skies, weather, water and story scenes](/docs/developers/extensions/atmosphere/) | Living skies, lights, particles in the air, weather, flowing water, story scenes
[Events and hotspots](/docs/developers/extensions/events/) | How hotspots fire (walk in or click), reveal distances, `once`, and `audience`: who sees an event

### Actions

Page | What it covers
---- | --------------
[Actions overview](/docs/developers/extensions/actions/) | Every action the runtime adds, in one table, with where each is described
[Dialogue, conversations and infoboxes](/docs/developers/extensions/dialogue/) | `dialogue`, `narration`, `conversation`, reading text aloud, the glossary, rich infoboxes
[Actions that move, change and travel](/docs/developers/extensions/actions-world/) | `animate`, `walk`, `weather`, `camera`, `freeze`, `cancel_event`, `travel`, `avatar`, the game's own sounds
[Stars, XP, awards and the marketplace](/docs/developers/extensions/rewards/) | `award`, `shop`, ranks, what the marketplace sells, how rewards are kept honest
[The close-up bench](/docs/developers/extensions/bench/) | Hands-on experiments: substances, vessels, reactions, readouts, and the `bench` action

### Things in the world

Page | What it covers
---- | --------------
[Variables](/docs/developers/extensions/variables/) | Player and shared variables, extra reserved variables and operators
[Items, the bag and vehicles](/docs/developers/extensions/items/) | Placing and blocking items, wearables, the bag, vehicles
[Characters that live in the world](/docs/developers/extensions/characters/) | Avatars, a character's animations, characters that walk around on their own
[Animations](/docs/developers/extensions/animations/) | Sprite sheets, named animations, built-in moves, how animations reach other players

### The player's screen, and recipes

Page | What it covers
---- | --------------
[The side panel and messages](/docs/developers/extensions/player-interface/) | The rail of panels, icons, chat and private messages (and what is logged)
[Patterns, and what is not built yet](/docs/developers/extensions/patterns/) | Scored questions, menus, experiments, collecting things; and the list of things the spec describes but does not do yet
