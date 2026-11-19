---
title: Developers
description: The scenario JSON, how the pieces fit together, and the HTTP and multiplayer contracts.
---

This section is for people who work with QBL's data and code: writing or generating scenarios as JSON, running the platform, or building against its APIs. If you only want to make missions, start with [the editor](/docs/editor/).

QBL scenarios are interactive experiences built around media: audio, images, text, sprite sheets and video. On the backend the QBL API outputs a scenario as one JSON document; the Phaser game reads it and runs the scenario as scripted. The editor writes this JSON for you (**Publish** generates it), and a ZIP with a `scenario.json` can bring a hand-written or generated one in whole (see [Backups, copies and the starship hub](/docs/editor/backups-and-copies/#making-a-zip-by-hand)).

## The JSON reference

A scenario holds scenes; a scene holds events; an event holds actions that run in order.

* [Scenarios](/docs/developers/scenario/)
* [Scenes](/docs/developers/scene/)
* [Events](/docs/developers/event/)
* [Actions](/docs/developers/action/)
* [Media](/docs/developers/media/)
* [Characters](/docs/developers/character/)
* [Items](/docs/developers/item/)
* [Variables](/docs/developers/variable/)
* [Conditions](/docs/developers/condition/)
* [Spritemaps](/docs/developers/spritemap/)
* [Labels](/docs/developers/label/)

The original pages describe the first version of the format. Everything the walk-around runtime added is **optional and additive** and is described in [Runtime extensions (spec v2)](/docs/developers/extensions/).

## The platform

* [Save data](/docs/developers/save-data/): what a player's save holds and how it is delivered with the scenario.
* [Generating missions with AI](/docs/developers/generation/): the `qbl:generate` command.
* [Architecture](/docs/developers/architecture/): the containers and how they talk.
* [HTTP API contract](/docs/developers/api/) and [Multiplayer protocol](/docs/developers/protocol/).

## Validating a scenario

From the repository root:

```sh
npm run validate -- path/to/scenario.json
```

This runs the same checks the editor's **Publish** button runs.
