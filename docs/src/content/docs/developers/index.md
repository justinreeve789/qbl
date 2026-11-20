---
title: Developers
description: The scenario JSON, how the pieces fit together, and the HTTP and multiplayer contracts.
---

This section is for people who work with QuestLab's data and code: writing or generating scenarios as JSON, running the platform, or building against its APIs. If you only want to make missions, start with [the editor](/docs/editor/).

QuestLab scenarios are interactive experiences built around media: audio, images, text, sprite sheets and video. On the backend the QuestLab API outputs a scenario as one JSON document; the Phaser game reads it and runs the scenario as scripted. The editor writes this JSON for you (**Publish** generates it), and a ZIP with a `scenario.json` can bring a hand-written or generated one in whole (see [Backups, copies and the starship hub](/docs/editor/backups-and-copies/#making-a-zip-by-hand)).

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
* [Instances, teams and save data](/docs/developers/instances/): how a team's copy of a mission is kept, and which tables hold it.
* [Generating missions with AI](/docs/developers/generation/): the `qbl:generate` command.
* [Architecture](/docs/developers/architecture/): the containers and how they talk.
* [HTTP API contract](/docs/developers/api/) (internal: used by the player, editor and game server) and [Multiplayer protocol](/docs/developers/protocol/).

## Connecting a school's systems

Rostering classes from a student information system, assigning missions from an LMS, signing students in and reading grades and learning reports are done through the supported, versioned **[public API (v1)](/docs/api-v1/)** under `/api/v1`. It takes no personal data about students. Start with its [quickstart](/docs/api-v1/#your-first-ten-minutes) and the [authentication](/docs/api-v1/authentication/) page. An [OpenAPI description](/docs/api/v1/openapi.yaml) is available.

## Validating a scenario

From the repository root:

```sh
npm run validate -- path/to/scenario.json
```

This runs the same checks the editor's **Publish** button runs.
