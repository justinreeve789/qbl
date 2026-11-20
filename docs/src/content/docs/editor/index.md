---
title: The editor at a glance
description: What the QBL editor is, who can use it, and where everything is.
---

The editor is where teachers and content creators build **scenarios**: whole missions made of scenes that students walk around, with the hotspots, characters, conversations, questions and rewards that happen in them. It is served at `/editor/` and, for teachers and admins, it is also the dashboard you land on after signing in.

Everything is **saved as you make it**. There is no save button: the word *Saving…* flickers beside the header while a change travels to the server, then *Saved*. Players do not see your changes until you press **Publish**.

## Getting in

Sign in on the missions page with the account you were given. If your account is a teacher or admin you go straight to the editor; students and guests stay on the missions page, and `/editor/` refuses them (the sign-in form tells you which account the browser is signed in as).

:::note
The game and the editor share one sign-in per browser. If the editor says you are signed in as a guest or a student, you probably played the demo, or tried a student account, in the same browser. Sign in again on the editor page, or use another browser or a private window when you want to see what a student sees.
:::

Roles are set by whoever runs the server, with `php artisan qbl:update-role <email> --role=teacher` (the repository README says how to run it).

## The header

The bar across the top has the places a teacher uses:

| Link | Where it goes |
| ---- | ------------- |
| **Missions** | The students' missions page, in the game |
| **Editor** | Your scenarios (this is the dashboard) |
| **Classes** | Your students, assignments, teams and reports |
| **Docs** | These pages |

On the right is your account menu.

## Inside a scenario

Open a scenario and a second bar of tabs appears. Each tab is one part of the mission:

| Tab | What you do there | Page |
| --- | ----------------- | ---- |
| **Scenes** | Add, order and open the places in the mission | [Scenarios and scenes](/docs/editor/scenarios-and-scenes/) |
| **Media** | Upload pictures, sounds and videos; cut sprite sheets into animations | [The library](/docs/editor/library/#media) |
| **Variables** | Name the things the mission remembers | [The library](/docs/editor/library/#variables) |
| **Items** | Define things players pick up, wear or ride | [The library](/docs/editor/library/#items) |
| **Characters** | Define the people and creatures players meet | [The library](/docs/editor/library/#characters) |
| **Objectives** | The checklist players see | [The library](/docs/editor/library/#objectives) |
| **Glossary** | The words the mission teaches | [The library](/docs/editor/library/#glossary) |
| **Moves** | Buttons players can press: jump, crouch, dance | [The library](/docs/editor/library/#moves) |
| **Shop** | What this mission sells in the marketplace | [The library](/docs/editor/library/#shop) |
| **Settings** | Title, chat, who can play, music, backups | [Settings, testing and publishing](/docs/editor/settings-and-publishing/) |
| **Publish** | Check the mission and give players the new version | [Settings, testing and publishing](/docs/editor/settings-and-publishing/#publishing) |
| **▶ Test** | Play the unpublished draft | [Settings, testing and publishing](/docs/editor/settings-and-publishing/#testing) |

The yellow **🚀 Publish** button is on every page, next to a badge that says whether the scenario is a **Draft**, has **Unpublished changes**, or is **Published**.

Open a scene and you are in the [scene editor](/docs/editor/scene-editor/), where you draw the place and add hotspots; each hotspot, and each start, end or indirect event, is edited as [events and actions](/docs/editor/events-and-actions/).

## The ? icons

Explanations are tucked behind a small **?** beside the field, heading or page title they belong to. Click it (or tab to it and press <kbd>Enter</kbd>) to read; click anywhere or press <kbd>Esc</kbd> to put it away. Hovering shows the same text as a tooltip.

## Learn by building

The quickest way in is to follow the [walkthrough](/docs/editor/walkthrough/set-up/), which builds a small two-scene mission, *The Cloudy Pond*, from an empty scenario to a published, assigned mission. The finished mission is also available as a [ZIP you can import](/docs/editor/walkthrough/publish/#the-finished-mission) to compare with your own.

## A mental model

* A **scenario** is a whole mission. It has a **code**, and players open it at `/{code}`. The code is 16 random letters until you change it on the Publish tab.
* A scenario has **scenes**: places with a background, somewhere to walk and things to find.
* A scene has **events**: *start* events run on arrival, *end* events on leaving, *hotspot* events when a player clicks or walks into a place, *indirect* events only when something else runs them.
* An event is a list of **actions** that run in order: say something, show a picture, ask a question, change a variable, award stars, jump to another scene.
* **Conditions** decide whether an event, an action or a button happens, by comparing **variables**. Variables are how the mission remembers what a player has done.

Those five ideas are the whole system. The [JSON reference](/docs/developers/) describes the same things as data.
