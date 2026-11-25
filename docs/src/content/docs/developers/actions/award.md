---
title: "Award"
description: "Gives stars, XP and badges; ranks; and how rewards are kept honest."
---

`type`: `award`

Players earn **stars** and **XP** through `award` actions. Stars are spent in the marketplace. XP is never spent: its total decides the player's **rank**. Both are kept on the player's account by the backend and are the same in every scenario.

The `award` action gives the player stars, XP, or both. A negative number takes them away.

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

## How it is kept honest

The game client never changes stars or XP itself. When an award action runs, the client tells the game server the action's id; the game server asks the backend, which looks the action up **in the published document**, checks whether this player already had it, and records the change in a ledger. A player can therefore not invent an award or collect a once-only award twice. What they *can* do is trigger an award whose event they have not really reached, because events run in the browser (see the trust model on the [protocol](/docs/developers/protocol/) page). Treat stars as encouragement, not as grades.

Purchases go straight from the browser to the backend, which takes the stars and hands over the item in one step.

While testing a draft from the editor, awards and purchases are pretend: the preview starts with 500 stars and nothing is written to the account.
