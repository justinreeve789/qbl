---
title: The library
description: Media, variables, items, characters, objectives, the glossary, moves and the shop.
---

The tabs after **Scenes** hold the things a scenario defines once and uses in many places. Define them here, then pick them from lists in the scene editor and in actions.

## Media

The images, sounds and videos the scenario uses. **Upload files** (pictures: PNG, JPEG, WebP, GIF; sound: MP3, WAV, OGG; video: MP4, WebM) or **Add by address** to point at a file already on the web.

Media is filed under sub-tabs by what it is used for: **Backgrounds**, **NPCs**, **Items**, **Vehicles**, **Sounds and music**, **Video**, **Shop items** and **Other images**. A file follows how you use it; one uploaded while a sub-tab is open is filed there until its use says otherwise, and **Details → Filed under** overrides it.

Each card previews the file, says what it is filed under and its size, and marks a sprite sheet or an animated PNG. Each kind has a colour, on its card and on its sub-tab. Click a picture or **✏️ Details** to open the file in a panel over the page; **🎞️ Sprite sheet** opens the same panel at its sprite sheet. Press Escape, the ×, or click outside the panel to close it. The panel has two parts:

* **📝 Details**: a large preview, then name, address, type, load order, scale, size and **Filed under**.
* **🎞️ Sprite sheet and animations** (images). A sprite sheet is one picture holding frames in a grid. Say how many **Frames across** and **Frames down**: characters can then take frames from it on the Characters page, and several characters can share one sheet. Animations named here are for items, vehicles and pictures: add one and click frames on the sheet to put them in order (shift-click adds every frame up to the one you click); a small preview plays it. `idle` and `walk` play by themselves, and `jump`, `spin`, `crouch`, `wave` and `dance` are built-in moves.

An **animated PNG** is kept as it is: its card says how many frames it has and how long it plays. It plays by itself wherever it is used, and on the Characters page an animation can take all of its frames or some of them.

The 🗑 on a card deletes the file, as does **Delete** in its panel.

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

People and creatures players meet. Each card shows the character **Standing** and its **Portrait**, its name, and a label for each pose: a solid one for a pose that is drawn (✓), a dashed one for a pose another stands in for, and how many more animations it has. Click the character or **✏️ Edit character** to open it in a panel; **New character** opens the new one straight away.

The panel has the character on one side (how it stands, walks and looks in close-up, its **Name**, size and voice, and when it is present) and its **🎬 Animations** on the other, grouped and coloured by kind: 🧍 standing (blue), 🚶 walking (orange), 🖼️ the close-up (gold) and ✨ moves and other animations (purple).

A character is drawn from its animations. Each is a picture (a still image, an animated PNG or a sprite sheet) and, for a sheet or an animated PNG, the frames to play. Five come first, the **poses**, which the game shows by itself:

* **Standing, facing right** and **Standing, facing left**: while it stands.
* **Walking right** and **Walking left**: while it moves.
* **Close-up portrait**: beside what it says in a *story box*.

You need not fill them all. A pose left empty says what it uses instead (*Uses Standing, facing right, mirrored*): one standing picture is enough for a character that stands, turns and glides; add walking frames, the other side and a close-up as you have them. The first time a character gets a standing picture, a close-up is cut from the top of it, which you can replace.

Each animation in the list shows a preview, its **Picture** (choose one there to draw a pose) and a summary: frames, speed, whether it loops, mirrored. **⚙️ Frames & timing** (or clicking its preview) opens the animation in a panel of its own, over the character's, with a large preview and:

* **Picture**. Sheets and animated PNGs are marked in the list.
* **Frames**, in the order they play: type `0 1 2` or `0-3`, or click them on the picture below (shift-click adds every frame up to the one you click). Each picked frame shows its place in the order, and the preview's caption reads it out (*Plays 2 → 0*). **Use every frame** empties the list. Empty: every frame.
* **One pass (ms)**: how long it takes. Empty: an animated PNG's own speed, or 100 ms a frame.
* **Repeats**: poses loop; other animations play once unless you say otherwise.
* **Mirror**: draw it flipped, so art facing one way serves the other.

**+ Add animation** adds one by name (`wave`, `dig`, `talk`...), starting from the standing picture, and opens it to pick its frames. A *Play an animation* action plays it; one named like a built-in move (`jump`, `wave`, `dance`...) replaces that move with your frames. The small preview beside each animation plays it as the game will.

**Voice**: pitch, pace and a preferred voice name, for when a line is read aloud by the browser.

Place characters in scenes, where a click can run an indirect event. Players' avatars are characters too, but they are the platform's, the same in every scenario: a scenario does not define them.

### Getting around

Tick **Walks around on its own** to make the character part of the world rather than of each scene. There is then one of it for everyone playing together: all players see it in the same place, a [Walk](/docs/editor/events-and-actions/#walking) action can send it to another scene, and it stays where it went, between visits too. It starts where it is first placed (taking the scenes in order); placing it in other scenes only says what clicking it does there. **Walking speed** is how fast it goes when a walk does not say.

A character that walks around on its own can have a **Routine**: steps it repeats by itself, for everyone, whether or not anyone is watching. **+ Add step** offers:

* 🚶 **Walk somewhere**: to a spot, a spawn point, or another scene through its doors, as the Walk action does.
* ⏳ **Wait**.
* 💬 **Say something**: a speech bubble over the character.
* 🤸 **Play an animation**.
* 🔢 **Change a shared variable**.

Each step can have conditions, and can let the next step start at once (untick **Wait for this to finish**, to talk while walking). Use the arrows to change the order. **Start again after the last step** makes it loop (it does unless you untick it).

**Keeps to its routine only when** stops the character where it is while its conditions do not hold; it carries on where it left off when they hold again. Only **shared variables** (marked *shared by everyone*) count here and in the steps, because a routine belongs to no one player. To stop a character for a conversation, set a shared variable in the event that starts it, test it here, and set it back at the end.

A player's Walk action comes first: the routine waits for the character to get there, then carries on.

## Objectives

The checklist players see while they play. Each objective has its text (which may show a variable: `Collect samples ({{samples}}/3)`), a **Bonus** tick for optional ones, and two lists of conditions:

* **Listed only when**: reveal a step later. Empty means always listed.
* **Ticked off when**: the objective is complete while these hold. Empty means it is never ticked.

Use **↑ Earlier** and **↓ Later** to order them. A mission is finished when every non-bonus objective is complete, which is what the teacher's report shows.

## Glossary

The words the mission teaches. Each has a **Word**, an optional **Picture** and **What it means**. A word marked **In every player's glossary from the start** needs no action; any other word is given by an **Add a glossary word** action where the player meets it, and its card tells you how many actions give it, so you can spot a word nobody will ever get. Players read their words in the game's side panel, and a teacher's report counts them.

## Moves

What players can do from buttons on their screen: pick an **Animation** (a built-in move or the name of one of the avatars' animations), the text **On the button** and an **Icon**. Each move can have conditions.

## Shop

What only this scenario sells in the marketplace: something to **wear**, a **pet**, **a way of standing**, a **move** or an **ability**, priced in stars. Take an item off sale with **On sale** instead of deleting it, so players who bought it keep it. An ability sets the variable `QBLAbility_<key>` while it is equipped, which conditions can use to offer extras. See [Stars, XP and the marketplace](/docs/developers/extensions/#stars-xp-and-the-marketplace).
