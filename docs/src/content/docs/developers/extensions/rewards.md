---
title: "Stars, XP, awards and the marketplace"
description: "The award and shop actions, ranks, what the marketplace sells and how rewards are kept honest."
host:
  who: gil
  says: "Stars to spend, XP for rank, and how the game keeps score honestly."
  side: right
---

Players earn **stars** and **XP** through `award` actions. Stars are spent in the marketplace. XP is never spent: its total decides the player's **rank**. Both are kept on the player's account by the backend and are the same in every scenario.

## Award

A new action type, `award`, gives the player stars, XP, or both. A negative number takes them away.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
stars | int | 0 | Stars to give (or take, if negative). Stars are the currency of the marketplace.
xp | int | 0 | Experience points to give (or take). XP is never spent; it adds up to a rank.
note | string | | A few words shown with the award: "Sample collected".
repeatable | bool | false | By default a player gets each award **once**, however often its event runs and in however many visits. Set this to give it every time.

```json
{ "type": "award", "stars": 3, "xp": 10, "note": "Sample collected" }
```

Stars and XP belong to the player's **account**, not to a scenario: they carry across every scenario on the platform. See [How it is kept honest](#how-it-is-kept-honest) for how that is checked.

**Badges.** An award can carry a badge: `badge` (its name), and optionally `badge_description` and `badge_media_id` (its picture). A player earns each badge once, and it is shown on their [profile](/docs/editor/classes/#profiles), where other players can see it.

```json
{ "type": "award", "stars": 10, "xp": 40, "badge": "Stream Saver", "badge_description": "Found out why the stream wilted", "badge_media_id": 46 }
```

* Neither total goes below zero. Taking away more than a player has leaves them with none.
* **Guests earn nothing.** Stars and XP need a signed-in account.
* Put awards in an event's own actions. An award placed directly on an infobox button is not given (the validator warns): make the button run an event (`run_event`) that contains the award.
* Awards never hold up the sequence, whatever `blocking` says.

## Ranks

Ranks are platform-wide. The defaults are in `apps/api/config/qbl.php` (`ranks`):

XP | Rank
-- | ----
0 | Cadet
100 | Explorer
300 | Navigator
700 | Specialist
1500 | Commander
3000 | Admiral

## Shop

A new action type, `shop`, opens the marketplace. It has no parameters. The sequence waits until the player closes the window.

```json
{ "type": "shop" }
```

Players can also open the marketplace at any time from the stars shown in the corner of the screen, so a scenario needs no shop action; it is there for scenarios that want a place for it, as the demo's marketplace room does.

Addition | Applies to | Description
-------- | ---------- | -----------
dismissible | infobox | Default true. See below.
media_id, size, accent | infobox | A picture or video (`media_id`) drawn across the top; `small`, `medium` (default) or `large`; a CSS colour for the edge and main buttons. See [Rich infoboxes](/docs/developers/extensions/dialogue/#rich-infoboxes).
mark | an infobox's `call_to_actions` | `right`, `wrong` or `try_again`. See [Rich infoboxes](/docs/developers/extensions/dialogue/#rich-infoboxes).
spawn_point | jump | Spawn point to arrive at in the target scene.
target_event_id | run_event | The event to run. Use this rather than `event_id`, which the base action attributes already use for "the event this action belongs to". `event_id` is still read if `target_event_id` is absent.
layer | image_fixed, spritemap | `above` (default) draws over avatars and foregrounds. `sorted` depth-sorts with avatars using `position_y`, so players can walk in front of it.
position_x, position_y, scale_x, scale_y, alpha, duration | translate | Values present are animated on the target over `duration` milliseconds. Position applies to `image_fixed` and `spritemap` targets; overlays support scale and alpha.
alignment, scale_x, scale_y, volume | video | Video plays as an overlay with browser controls. It blocks until it ends.

Clarifications of documented behaviour:

* An action with no end (an image or text with `duration` 0, repeating audio, a repeating spritemap) never holds up the sequence, whatever `blocking` says. It stays until a cancel or a jump.
* A `repeat` with no `wait` in its loop runs about once per frame rather than freezing the page.
* `call_to_actions` is a list of `{"text": "...", "action": {...}, "conditions": [...]}`. The action needs no `id`. A button with `conditions` is only offered while they hold, so one infobox can serve as a menu that changes.
* An infobox has a close button unless `dismissible` is `false`. A box that cannot be dismissed must be answered with one of its buttons, which is how questions are asked.
* An infobox action is not finished until the box is closed **and** the chosen button's action has run to its end. A sequence such as "ask a question, then open a menu" therefore waits for the feedback the answer triggers.
* Infobox `content` is sanitised. Formatting, lists, tables, links, images, video, sound and the blocks below are kept; scripts, styles, classes, frames, forms and event handlers are removed.

## What the marketplace sells

Every scenario sells the platform's catalogue (`apps/api/database/seeders/data/shop.php`). A scenario can also sell items of its own, which exist only there: a mission badge, a tool for this planet. Authors add them on the editor's **Shop** page; they are in the document as `shop_items`.

Parameter | Type | Description
--------- | ---- | -----------
id | int |
name, description | string |
kind | string | `wearable`, `pet`, `animation`, `move` or `ability`.
price | int | In stars.
media_id | int | The item's picture, one of the scenario's media. (Platform items have an `image_url` instead.)
slot | string | Wearables: `head`, `body`, `back` or `hand`. One item per slot is worn at a time.
scale | decimal | Wearables and pets: height as a fraction of the avatar's height, so an item fits avatars of any size.
offset_x, offset_y | decimal | Wearables and pets: a nudge forward and down, in avatar heights.
animation | string | Animations: `bounce`, `float`, `sway` or `pulse`. How the avatar moves while standing.
move | string | Moves: the animation a button on the player's screen plays, in every scenario. See [Moves](/docs/developers/extensions/animations/#moves-what-players-can-do-themselves).
ability | string | Abilities: a key. While equipped, `QL_Ability_<key>` is 1.

```json
"shop_items": [
  { "id": 101, "name": "Wilting Stream patch", "kind": "wearable", "slot": "body", "price": 20, "media_id": 46, "scale": 0.14 },
  { "id": 102, "name": "Stream survey map", "kind": "ability", "price": 15, "media_id": 47, "ability": "stream_map" }
]
```

A player owns what they buy for good, and chooses what to have on: one wearable per slot, one pet, one animation (a way of standing: bounce, float, sway, pulse), and any number of moves and abilities. What a player wears is drawn on their avatar in every scenario and is seen by the other players.

**Abilities do nothing by themselves.** They are a flag scenarios can test, so what an ability unlocks is up to each author: a hotspot only its owners see, an extra line of dialogue, a shortcut. They never change walking speed or how far away a hotspot is revealed. In the demo, the survey map makes a map table appear at the landing site:

```json
{ "shortname": "survey-map", "conditions": [{ "variable": "QL_Ability_stream_map", "operator": "=", "operand": 1 }], "...": "..." }
```

## How it is kept honest

The game client never changes stars or XP itself. When an award action runs, the client tells the game server the action's id; the game server asks the backend, which looks the action up **in the published document**, checks whether this player already had it, and records the change in a ledger. A player can therefore not invent an award or collect a once-only award twice. What they *can* do is trigger an award whose event they have not really reached, because events run in the browser (see the trust model on the [protocol](/docs/developers/protocol/) page). Treat stars as encouragement, not as grades.

Purchases go straight from the browser to the backend, which takes the stars and hands over the item in one step.

While testing a draft from the editor, awards and purchases are pretend: the preview starts with 500 stars and nothing is written to the account.
