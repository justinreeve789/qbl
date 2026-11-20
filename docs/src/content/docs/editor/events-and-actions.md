---
title: Events and actions
description: How a hotspot or event is built from conditions and actions, with every action type explained.
---

Everything that *happens* in a mission is an **event**, and every event is an ordered list of **actions**. You edit an event by selecting it in the scene editor's outline (under **Start events**, **Hotspots**, **Indirect events** or **End events**); its form opens in the inspector, in folding sections that stay folded from event to event.

## The four kinds of event

| Kind | Runs when | Typical use |
| ---- | --------- | ----------- |
| **Start event** | A player arrives in the scene | A welcome message, music, placing a picture |
| **End event** | A player leaves the scene | A farewell, saving a flag |
| **Hotspot** | A player clicks it, or walks into it | Doors, things to read, things to collect, edge exits |
| **Indirect event** | Another event's **Run event** action starts it, or a click on a placed character | Conversations, answers to a question, anything used from more than one place |

You can change an event's **Kind** at any time under ⚙️ Settings.

## An event's settings

| Setting | What it does |
| ------- | ------------ |
| **Name** | A label for you. It is what the outline shows |
| **Another event may interrupt this one** | When any event starts, running events marked this way stop where they are |
| **Hotspots do nothing while this runs** | Stops players triggering other hotspots mid-conversation |
| **Who sees it** | *Only the player who sets it off* (the default) or *Everyone in the scene* |

**Who sees it** is for moments that belong to the room, such as a rockfall: the other players in the scene see and hear its pictures, text, sounds, video and dialogue as they happen. What the event *does* stays with the player who set it off: variables, awards, jumps, freezing and questions. See [Who sees an event](/docs/developers/extensions/#who-sees-an-event).

## Conditions

An event, an action, an objective and an infobox button can each have **conditions**. A condition compares a **variable** with a **value** using `=`, `!=`, `>`, `<`, `>=` or `<=`. Press **+ Add condition** and choose from the variables you have defined. **All** the conditions in a list must hold.

* On an **event**, conditions decide whether it runs. A hotspot whose conditions fail is not there at all: its labels disappear and it cannot be clicked. That is how a collected object vanishes (the hotspot is conditioned on `collected = 0`).
* On an **action**, the box is headed **Only when**, and a failing action is skipped while the rest run.
* On an **infobox button**, **Offered only when** hides the button.

Variables are defined on the [Variables](/docs/editor/library/#variables) tab. If a condition names a variable that is not defined, the list shows it marked *(not defined)*.

## Labels

A hotspot can have **labels** that mark it in the scene: a **Text**, an **Image** or a **Spritemap**. Press **+ Add label** under 🏷️ Labels, then set its position and scale (or drag it on the canvas). **Where it stands** says how it is layered:

* **Background**: players are always in front of it.
* **Object**: players walk behind it and in front of it, depending on how high up they are. It stands on its bottom edge.
* **In front of everything**, players included.

Picture labels can be made **Solid**, so players walk around them. A solid label stops being in the way when its hotspot's conditions no longer hold, such as a rock that has been cleared.

## Actions

Under 🎬 Actions, **+ Add action…** lists every type with a one-line description. A new action arrives with sensible starting values so it is valid straight away.

* Anything with an **X** and **Y** in the scene (**Walk** to a spot, **Translate**, **Image in scene**, **Spritemap**) has **📍 Pick on the scene** under them: press it, then click the scene to set both. While choosing, a click on a character or hotspot picks the spot under it instead of selecting it. These spots are drawn on the canvas while the event is selected, and can be dragged there.
* Actions run **in the order listed**. **Drag the ⠿ grip** at the left of a card to move it; drop it on the upper or lower half of another card to put it before or after.
* Click a card to open it. Its one-line summary tells you what it does when it is closed.
* **Wait for this to finish before the next action** (on by default) makes the event pause until this action is done. Turn it off to let the next action start at once, for a sound that plays under a conversation.
* **Duplicate** copies an action; **Delete** removes it.
* Text in any action can show variables with `{{variable_name}}` and pictures with `{{media:ID}}`.

### The action types

**Say something**

| Action | What it does |
| ------ | ------------ |
| 📋 **Infobox** | A box of text (HTML), with optional buttons. [Details below](#infobox-and-questions) |
| 💬 **Dialogue** | A speech bubble over the speaker, or a *story box* with a portrait. The speaker is the player or a **Character** |
| 🔀 **Conversation** | A dialogue tree: lines said by the player and characters, where the player picks what to say next. [Details below](#conversations) |
| 🔤 **Text overlay** | Text over the screen: where, how long, size, colour and style |

**Show something**

| Action | What it does |
| ------ | ------------ |
| 🖼️ **Image overlay** | A picture over the screen |
| 📌 **Image in scene** | A picture placed in the scene, and whether it is drawn above, among or behind avatars |
| 🎞️ **Spritemap** | An animated sprite sheet placed in the scene |
| 🎬 **Video** | A video over the screen |
| ↔️ **Translate** | Move, resize or fade something another action is showing |

**Sound**

| Action | What it does |
| ------ | ------------ |
| 🔊 **Audio** | A sound or music: volume, loop, and **Background music: keep playing across scenes** |

**Flow**

| Action | What it does |
| ------ | ------------ |
| 🚪 **Jump** | Go to another **Scene**, and **Arrive at** one of its spawn points |
| ⏳ **Wait** | Pause for a **Duration** in milliseconds |
| ▶️ **Run event** | Run another event, usually an indirect one. An event that is already running is not started again |
| 🔁 **Repeat** | Start this event again from its first action, usually with a condition so it can end |
| ✖️ **Cancel** | Stop another action: remove a picture, stop a sound |

**The player**

| Action | What it does |
| ------ | ------------ |
| ✋ **Freeze or release player** | Stop the player walking while a character talks, or let them walk again. A freeze always ends when the event finishes or the scene changes, so nobody is left stuck |
| 👤 **Show or hide avatar** | Hide the player's avatar (stepping into a rocket) or show it again |
| 🤸 **Play an animation** | Make the avatar, an item, a vehicle or a character jump, dance or do anything its sprite sheet has |
| 🚶 **Walk** | Walk a **Character** or **The player** to a spot, a spawn point, or **Another scene, through its doors**. [Details below](#walking) |

**What the mission remembers and gives**

| Action | What it does |
| ------ | ------------ |
| 🔢 **Variable** | Set a variable, or add, subtract, multiply, divide, take the remainder, or pick a random whole number up to a value |
| ⭐ **Award stars or XP** | Give stars (spent in the marketplace) and XP (adds up to ranks), with a note, and optionally a **badge** shown on the player's profile |
| 📖 **Add a glossary word** | Give the player a word from the [glossary](/docs/editor/library/#glossary) |
| 🛍️ **Open the marketplace** | Open the shop where players spend stars |

:::note
An **award** is given **once per student** by default, however often the event runs; tick **Give it every time this runs** to change that. Stars and XP belong to the player's account and carry across missions; guests earn none. Put awards in an event, not on an infobox button.
:::

### Walking

**Walk** moves someone on foot: around whatever is in the way, with their walking pictures, turning the way they go. Choose **Who walks** and **Walk to**; only the fields for that destination are shown.

* **A spot in the scene**: its **X** and **Y**. Press **📍 Pick on the scene** and click the scene where the walker should go, rather than typing the numbers; **Esc** or **Cancel** stops without changing them. While the event is selected, the spot is drawn on the canvas as a marker, with a dashed line from where the character stands, and the marker can be dragged.
* **A spawn point in the scene**: one of the scene's spawn points.
* **Another scene, through its doors**: the walker heads for a hotspot of this scene whose jump goes to that scene (an exit made on the scene map is one), goes through it and arrives at the spawn point the jump names. **Then walk on to** sends a character that walks around on its own on to a spawn point there.

**Speed** is in pixels per second (players walk at 420 unless the scenario says otherwise), and **Face on arriving** turns the walker at the end. With **Wait for this to finish** ticked, the next action waits until they get there.

What happens depends on the character. One set to **walk around on its own** (Characters page, *Getting around*) walks for everyone, can cross several rooms, and stays where it went. Any other character walks on this player's screen in this scene, and is back in its place next time; one that walks out through a door is gone until the scene is entered again. The player walks even while frozen, so **Freeze**, then **Walk** the player, makes a short cutscene; walked to another scene, they go through the door as if they had walked into it.

### Infobox and questions

An infobox has **Content (HTML)**, a tick for **Can be closed without choosing a button**, and **Buttons**. Each button has its text, an optional action it performs, and optional conditions. Leave a button's action as *Just close the box* for a plain "OK". A button's action can be any type, including another infobox with buttons of its own.

A **question** is a standard pattern built from these pieces:

1. A hotspot or indirect event holds an infobox with **Can be closed without choosing a button** *unticked*, and one button per answer.
2. Each button's action is **Run event**, pointing at its own indirect event.
3. The right-answer event sets a variable, gives the award and shows an explanation. A wrong-answer event just explains and lets the player try again.

The [walkthrough](/docs/editor/walkthrough/pond/#the-question) builds exactly this. Because the report records the first answer a student chose, a question works as a check on what they thought *before* any feedback. More patterns (a menu that stays open, a hands-on experiment, collecting things) are under [Patterns](/docs/developers/extensions/#patterns).

### Conversations

A **Conversation** is a talk the player takes part in: a character says something, the player picks a reply from a few **choices**, and each choice leads to what is said next. It is one action, however many lines it has. (A **Dialogue** says a single line; use it for remarks and short announcements.)

A new conversation starts as a small tree you can change: the character placed in the scene greets the player, who can ask *Who are you?* (the answer comes back round to the greeting) or say *Goodbye!*.

**In the action's card** the conversation is drawn as a **map**, followed from the start: each line with who says it, and under a line with choices, each choice and where it leads. 🔁 *Back to* marks a choice that returns to a line shown above it; 🚩 marks the end. Lines nothing leads to are listed as *Never said*. Click any line, or **Edit the conversation**, to open it.

**The conversation panel** lists every line on the left (▶ marks the start; *Starts with* changes it) and edits one line on the right:

* **Who says it** (the player or a character), **What they say**, and a **Recording of this line** if you have one. **Said only when** makes a line conditional: when its conditions do not hold, the conversation skips it and goes on to its *Then go on to* line. That is how to greet a returning player differently.
* **Reached from** shows the lines and choices that lead here; click one to go there. **← Back** returns to the line you were on.
* **Then the player says…** holds the choices. Each has the player's words, **Leads to** (another line, **➕ A new line…**, or *Ends the conversation*; **Go →** opens that line), **A right answer** for the report, **Also do** (actions done when it is picked, such as setting a variable or running an event), and **Offered only when** conditions. Use ↑ ↓ to order them.
* A line with no choices has **Then go on to**: the next line, or the end.
* **Line id** is the line's name in the scenario file (`l1`, `l2`…); renaming it keeps every choice that pointed at it. **Delete line** turns choices that led to it into endings.

Picking **➕ A new line…** creates the reply, said by whoever said the line it answers, and opens it, so you can write a branch from top to bottom and use **← Back** to return to the question.

In the game the line appears as the action's **Shown as** says: in a story box with the speaker's portrait and the choices listed under it (the default), or in a speech bubble with the choices in a box at the bottom of the screen. Players click a choice or press its number, and cannot walk away while choosing. The action waits until the conversation is over.

:::tip
Every line with choices counts as a **question** in the report: it shows each student's first answer and how many tries they took. Tick **A right answer** on the right choices and the report also says whether the first answer was right. A wrong answer that leads to a hint and back to the question is the pattern for "try again".
:::

:::note
To give stars or XP for a choice, put the award in an indirect event and have the choice **Run event** it: awards are only given for an event's own actions. A **Jump** in a choice ends the conversation.
:::

### Reading aloud

Text-showing actions have **Read aloud** and **Recording to play instead**. The browser's own voice reads the text and lights each word as it is spoken. Lines of characters who have a recorded voice (Characters, **🎙️ Record voices**) play their recording, lit word by word as it is said; a recording you attach yourself is lit at an even pace over its length. Set it for the whole mission in Settings, and override it per action. Players can switch it off for themselves.
