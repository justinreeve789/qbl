---
title: Scenarios and scenes
description: The scenarios list, creating and copying scenarios, and managing a scenario's scenes.
---

## The scenarios list

The **Editor** page lists every scenario you may edit as a card. Each card shows its title, whether it is a **Draft** or **Published**, and its 16-letter code, with these buttons:

| Button | What it does |
| ------ | ------------ |
| **Edit** | Opens the scenario |
| **Play** | Opens the published mission in the game (only once published) |
| **Duplicate** | Makes a copy as a new draft of your own |
| **Export** | Downloads the scenario as a ZIP backup |

At the top right are **Import a ZIP** and **New scenario**. Under your own scenarios, **Public missions by others** lists missions other teachers have published for everyone. You cannot change those, but **Make my own copy** gives you a draft of your own to rebuild as you like. The original is not affected.

Duplicating, exporting and importing are described in [Backups, copies and the starship hub](/docs/editor/backups-and-copies/).

### Creating a scenario

**New scenario** asks for a title and how to start:

* **Start aboard the starship** (the default) begins as your own copy of the starship hub: eight rooms, a crew and a marketplace you can change freely. Choose this when your mission is launched from the ship.
* **Start empty** gives one blank scene. Choose this for a self-contained mission, as the [walkthrough](/docs/editor/walkthrough/set-up/) does.

Either way the scenario gets its permanent code and opens on its **Scenes** page.

:::tip
Teachers also reach this dialog from the **New scenario** button on their missions page, which opens the editor straight into it.
:::

## The Scenes page

The Scenes page shows one card per scene, with its background as a thumbnail, its size, and how many hotspots, other events and spawn points it has.

* **New scene** asks for a short name (for example `forest-path`) and opens the new scene.
* **Edit** opens the [scene editor](/docs/editor/scene-editor/). **▶ Test** plays the draft starting in that scene.
* **←** and **→** change the scene's place in the list. The order is for your own tidiness; players move between scenes only through jump actions.
* **Start here** makes a scene the one players arrive in. The current one carries a **Start scene** badge.
* **Delete** removes the scene and everything in it. A scenario always keeps at least one scene.

### Scene groups

Scenes that belong together, such as the rooms of the starship or the places on one planet, can be put in a **scene group** (the card at the top of the page: **New group**). Pick a scene's group on its card. A group has one setting, **Players see only their own team in these scenes**, for missions a teacher runs with teams: a limited scene shows each player only their teammates, while a meeting place stays open to everyone. A single scene can override its group in its own settings. See [Teams in a scene](/docs/developers/extensions/#teams-in-a-scene).
