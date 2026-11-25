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

**Icons.** Every icon in the game and the editor is an emoji from one set, Twemoji, drawn through the [Twemoji Awesome](https://github.com/iamludal/twemoji-awesome) stylesheet (MIT, vendored in `packages/shared/assets/twemoji-awesome.css`): `<i class="twa twa-rocket"></i>`. They look the same on every device, where plain emoji characters differ from one system to the next. The interface's own icons are named in `packages/shared/src/icons.ts`; the emote pad, move buttons and the editor's tabs and lists are drawn the same way. After using a new emoji as an icon, run `node tools/make-twemoji-map.mjs <checkout of twemoji-awesome>` so it has its class; one without is shown as the plain character. The stylesheet loads each picture from `twitter.github.io/twemoji`: a site that must work without reaching that address should host the SVGs itself and replace the address in the stylesheet. Emoji drawn inside the scene (a speech bubble over an avatar) are still the device's own.

## Messages

With `chat_mode: free`, what is typed is said in the scene: it shows as a bubble over the speaker and in the Messages panel, for the players who can see the speaker (those in the scene, and only teammates where the scene is limited to teams). With `private_messages: true`, a player can also write to **one** other player anywhere in the scenario, from the Players panel or that player's profile; only the two of them see it.

Every message is cleaned and length-limited by the game server like chat, and **every message is logged**, scene or private, with who wrote it, to whom, where and when, so that it can be audited later. A teacher reads the log of an assignment on the Classes page. Players are told on the panel that messages are kept.
