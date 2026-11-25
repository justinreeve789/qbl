---
title: "Bench"
description: "Works the scene's close-up bench: add, empty, stir, light the burner, reset."
---

`type`: `bench`

`{ "type": "bench", "op": "reset" | "add" | "empty" | "stir" | "burner", … }` works the scene's [close-up bench](/docs/developers/extensions/bench/): `reset` puts everything back as it started; `add` puts `amount` of `substance` into `vessel_id`; `empty` and `stir` take a `vessel_id`; `burner` lights or puts out `tool_id` (`on`: true or false; absent, it changes over). In a scene with no bench it does nothing, and the validator says so.
