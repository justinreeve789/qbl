---
title: "Glossary"
description: "The scenario glossary, and the glossary action that gives the player a word."
---

`type`: `glossary`

A scenario can teach words. `glossary` on the scenario lists them; players see the ones they have in the side panel, in alphabetical order, and can search them.

Parameter | Type | Description
--------- | ---- | -----------
id | string or int | Unique within the scenario.
term | string | The word.
definition | string | What it means. `{{variable}}` placeholders work.
media_id | int | A picture, optional.
initial | bool | In every player's glossary from the start. Otherwise a `glossary` action adds it.

The `glossary` action gives the player a word:

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
entry_id | string or int | | The entry's `id`.
quiet | bool | false | Add it without telling the player.

```json
{ "type": "glossary", "entry_id": "ph" }
```

A player gets each word once (they are told, and the word is marked as new in the panel). Words are kept with the player's save, as flags (`glossary:<id>`), so they are still there next visit. The action never holds up the sequence. Which words each student has is part of the teacher's report.
