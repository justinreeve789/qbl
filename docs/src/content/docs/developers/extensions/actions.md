---
title: "Actions overview (spec v2)"
description: "Every action the runtime adds to the original fourteen, with the page that describes each."
host:
  who: mallory
  says: "Fourteen original actions, and a drawer full of new ones. Here is the whole list."
  side: right
---

Action `type` values are matched loosely: `Image Fixed`, `imageFixed` and `image_fixed` are the same. The canonical names are `audio`, `cancel`, `image_fixed`, `image_overlay`, `infobox`, `jump`, `repeat`, `run_event`, `spritemap`, `text_overlay`, `translate`, `variable`, `video` and `wait`.

Actions may carry their own `conditions` array (the Conditions page allows this; the Actions page did not list it). An action whose conditions fail is skipped.

The original actions are described on [Actions](/docs/developers/action/). These are the ones the walk-around runtime adds, or extends.

`type` | What it does | Described in
------ | ------------ | ------------
`dialogue` | Says a line: a speech bubble over someone, or a story box with their portrait | [Dialogue](/docs/developers/extensions/dialogue/#dialogue)
`narration` | The narrator speaks: a story box with no portrait | [The narrator](/docs/developers/extensions/dialogue/#the-narrator)
`conversation` | A dialogue tree the player takes part in | [Conversations](/docs/developers/extensions/dialogue/#conversations-dialogue-trees)
`infobox` (richer) | Pages, questions, formulas, graphs and more, as marked-up HTML | [Rich infoboxes](/docs/developers/extensions/dialogue/#rich-infoboxes)
`animate` | Plays an animation on something in the scene | [Animate](/docs/developers/extensions/actions-world/#animate)
`walk` | Walks a character or the player somewhere, around obstacles | [Walk](/docs/developers/extensions/actions-world/#walk)
`weather` | Changes the weather slowly while the player is there | [Weather action](/docs/developers/extensions/actions-world/#weather-action)
`camera` | Points the player's view | [Camera](/docs/developers/extensions/actions-world/#camera)
`audio` with `sound` | Plays a sound the game makes itself, with no file | [The game's own sounds](/docs/developers/extensions/actions-world/#the-games-own-sounds)
`freeze` | Stops the player from walking, or lets them walk again | [Freeze](/docs/developers/extensions/actions-world/#freeze)
`cancel_event` | Stops a whole running event | [Cancel event](/docs/developers/extensions/actions-world/#cancel-event)
`travel` | Takes the player to the mission their teacher launched | [Travel](/docs/developers/extensions/actions-world/#travel)
`avatar` | Shows or hides the player's own avatar | [Avatar](/docs/developers/extensions/actions-world/#avatar)
`award` | Gives stars, XP and badges | [Award](/docs/developers/extensions/rewards/#award)
`shop` | Opens the marketplace | [Shop](/docs/developers/extensions/rewards/#shop)
`bench` | Works the scene's close-up bench | [The bench action](/docs/developers/extensions/bench/#the-bench-action)

Text can also be read aloud with each word highlighted as it is spoken: see [Reading text aloud](/docs/developers/extensions/dialogue/#reading-text-aloud).
