---
title: "The side panel and messages"
description: "The panels at the side of the screen, how icons are drawn, and how chat and private messages are kept."
host:
  who: val
  says: "The rail of icons at the side of the screen, and what is kept when players talk."
  side: right
---

Everything that used to float over the scene is in one panel at the side of the screen: a rail of icons that is always there, each opening its panel and closing it again (Escape closes it too). The panel that was open is remembered between visits.

Panel | Holds | Shown when
----- | ----- | ----------
Mission | The objectives checklist | The scenario has objectives. Open at first, as the checklist always was
Inventory | What the player is wearing or riding, with a button to leave each, and the way into the wardrobe and marketplace | There is anything to show
Moves and emotes | The move buttons and the emote pad | The scenario has moves, or chat is not `off`
Players | Everyone in the scenario with the player: teammates first, each with where they are. A name opens that player's profile | Always
Messages | What was said in the scene, and private conversations | `chat_mode` is `free`, or `private_messages` is on
Glossary | The player's words | The scenario has a glossary

After the tabs, the **📒 notebook** button opens the player's notebook over the game instead of a panel (see [The notebook](#the-notebook)); the read-aloud switch sits at the foot of the rail.

**Icons.** Every icon in the game and the editor is an emoji from one set, Twemoji, drawn through the [Twemoji Awesome](https://github.com/iamludal/twemoji-awesome) stylesheet (MIT, vendored in `packages/shared/assets/twemoji-awesome.css`): `<i class="twa twa-rocket"></i>`. They look the same on every device, where plain emoji characters differ from one system to the next. The interface's own icons are named in `packages/shared/src/icons.ts`; the emote pad, move buttons and the editor's tabs and lists are drawn the same way. After using a new emoji as an icon, run `node tools/make-twemoji-map.mjs <checkout of twemoji-awesome>` so it has its class; one without is shown as the plain character. The stylesheet loads each picture from `twitter.github.io/twemoji`: a site that must work without reaching that address should host the SVGs itself and replace the address in the stylesheet. Emoji drawn inside the scene (a speech bubble over an avatar) are still the device's own.

## Messages

With `chat_mode: free`, what is typed is said in the scene: it shows as a bubble over the speaker and in the Messages panel, for the players who can see the speaker (those in the scene, and only teammates where the scene is limited to teams). With `private_messages: true`, a player can also write to **one** other player anywhere in the scenario, from the Players panel or that player's profile; only the two of them see it.

Every message is cleaned and length-limited by the game server like chat, and **every message is logged**, scene or private, with who wrote it, to whom, where and when, so that it can be audited later. A teacher reads the log of an assignment on the Classes page. Players are told on the panel that messages are kept.

## The notebook

Unless the scenario says `notebook: false`, each player has a notebook for this scenario: pages (with subpages, three levels deep), and on each page sticky notes, flip cards and to-dos, each with a small note saying when it was last written. [The student notebook](/docs/editor/student-notebook/) describes it as teachers and students see it.

- **Format and limits:** `packages/shared/src/notebook.ts` (`Notebook`, `NOTEBOOK_LIMITS`, `cleanNotebook`). The API keeps it ([Notebooks](/docs/developers/api/#notebooks)), with the player's save.
- **In the game:** `NotebookModel` (`apps/client/src/core/Notebook.ts`) holds it, makes every change, and keeps the whole notebook 1.2 seconds after the last change, one request at a time, trying again after a failure; `flush` keeps it at once (closing the notebook, hiding or leaving the page, which sends the request with `keepalive`). Nothing can be written until what was kept has arrived, so a failed load never overwrites a notebook. A preview keeps it in memory; offline play in the browser's storage.
- **Drawing it:** `ui/notebook/view.ts` and `notebook.css`. It redraws the contents and tabs as the player types a page's name, but never the box being typed in. The opening (the book grows out of its button, then the cover swings open on the spiral while the book slides to the middle) and closing use the Web Animations API; with reduced motion they are a fade.
- **Handwriting:** `ui/notebook/look.ts`. Playpen Sans by default, Patrick Hand and Andika to choose instead (all from Fontsource, SIL Open Font License), fetched the first time the notebook opens. The choice and the size are kept per device in `localStorage` (`qbl.notebook.look`).

