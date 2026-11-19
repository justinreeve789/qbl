---
title: The library
description: Media, variables, items, characters, objectives, the glossary, moves and the shop.
---

The tabs after **Scenes** hold the things a scenario defines once and uses in many places. Define them here, then pick them from lists in the scene editor and in actions.

## Media

The images, sounds and videos the scenario uses. **Upload files** (pictures: PNG, JPEG, WebP, GIF; sound: MP3, WAV, OGG; video: MP4, WebM) or **Add by address** to point at a file already on the web.

Media is filed under sub-tabs by what it is used for: **Backgrounds**, **NPCs**, **Items**, **Vehicles**, **Sounds and music**, **Video**, **Shop items** and **Other images**. A file follows how you use it; one uploaded while a sub-tab is open is filed there until its use says otherwise, and **Details → Filed under** overrides it.

Each card previews the file and has two folds:

* **🎞️ Sprite sheet and animations** (images). A sprite sheet is one picture holding the frames of an animation in a grid. Say how many **Frames across** and **Frames down**, then add named animations and click frames on the sheet to put them in order. Shift-click adds every frame up to the one you click. A small preview plays the animation. Names such as `idle` and `walk` are played automatically, and `jump`, `spin`, `crouch`, `wave` and `dance` are built-in moves. An animated PNG is converted to a sheet on upload.
* **Details**: name, address, type, load order, scale and size.

:::caution
Deleting media leaves anything that used it without a picture.
:::

## Variables

What the scenario remembers. Each has a **Name**, a **Starting value** and:

* **Whose it is**: *Each player has their own*, or *Shared: one value for everyone playing together*.
* **Kept between visits**: a player's own variable is kept with their save; a shared one is kept with the group's game.

Conditions and actions refer to variables by name, so renaming one does **not** update the conditions and actions that already use it. Text can show a variable's value with `{{variable_name}}`.

A few reserved names are always there, such as `{{QBLPlayerName}}`. See [Variables](/docs/developers/extensions/#variables).

## Items

Things players can pick up, wear or ride: **Unique** (only one player can hold it), **Blocking** (avatars walk around it), **Wearable** and **Vehicle**. A vehicle is always a single object: it goes where it is driven and stays where it is left. Below those are the picture's scale, where it stands, the blocking radius, wear offsets and a vehicle's speed multiplier. Place items in scenes from the scene editor.

## Characters

People and creatures players meet. Give a character a **Name**, an **Image** and a scale. Two things make them better:

* **Close-up portrait**: shown beside what the character says in a *story box*. Without one, the ordinary image is used.
* **Voice**: pitch, pace and a preferred voice name, for when a line is read aloud by the browser.

Place characters in scenes, where a click can run an indirect event.

## Objectives

The checklist players see while they play. Each objective has its text (which may show a variable: `Collect samples ({{samples}}/3)`), a **Bonus** tick for optional ones, and two lists of conditions:

* **Listed only when**: reveal a step later. Empty means always listed.
* **Ticked off when**: the objective is complete while these hold. Empty means it is never ticked.

Use **↑ Earlier** and **↓ Later** to order them. A mission is finished when every non-bonus objective is complete, which is what the teacher's report shows.

## Glossary

The words the mission teaches. Each has a **Word**, an optional **Picture** and **What it means**. A word marked **In every player's glossary from the start** needs no action; any other word is given by an **Add a glossary word** action where the player meets it, and its card tells you how many actions give it, so you can spot a word nobody will ever get. Players read their words in the game's side panel, and a teacher's report counts them.

## Moves

What players can do from buttons on their screen: pick an **Animation** (a built-in move or a name from avatar sprite sheets), the text **On the button** and an **Icon**. Each move can have conditions.

## Shop

What only this scenario sells in the marketplace: something to **wear**, a **pet**, **a way of standing**, a **move** or an **ability**, priced in stars. Take an item off sale with **On sale** instead of deleting it, so players who bought it keep it. An ability sets the variable `QBLAbility_<key>` while it is equipped, which conditions can use to offer extras. See [Stars, XP and the marketplace](/docs/developers/extensions/#stars-xp-and-the-marketplace).
