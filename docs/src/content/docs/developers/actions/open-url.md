---
title: "Open URL"
description: "Opens a web address: the scenario a teacher launched, or any page."
---

`type`: `open_url`

The `open_url` action opens a web address. Its `url` may hold `{{variable}}` placeholders, filled in when it runs. The system variable `{{QL_SCENARIO_LAUNCH_URL}}` is the scenario the player's teacher has just launched for them, which makes this action the last step of a **launcher scene** (below).

Parameter | Type | Description
--------- | ---- | -----------
url | string | **Required.** The address. It starts with `https://`, `http://` or `/` (a page of this site), or is made of placeholders that fill in to one. Anything else (`javascript:`, `mailto:`) is never opened.
new_tab | bool | Open it in a new browser tab. Default `true`. Ignored when `url` is `{{QL_SCENARIO_LAUNCH_URL}}` and nothing else: that always opens in the same tab.

```json
{ "type": "open_url", "url": "{{QL_SCENARIO_LAUNCH_URL}}", "new_tab": false }
```

* **In a new tab** (the default) the game stays open where it is, and the event goes on to its next action. Browsers often block a tab that opens without a click (at the end of a cutscene, say); the player then gets a button that opens it.
* **The launched scenario on its own** (`url` is just `{{QL_SCENARIO_LAUNCH_URL}}`) always opens in the same tab. In a new tab the student would stay in this scenario's room as well, and a browser may block the tab at the end of a cutscene. The editor unticks **Open in new tab** and greys it out until the URL is edited to something else.
* **In the same tab** (`new_tab: false`) the player leaves the game: like `jump`, it ends the event, this scene's end events run, and the player's progress is saved before the page changes. To the launched scenario this is the same as a [`travel`](/docs/developers/actions/travel/) action.
* With an address that fills in empty (`{{QL_SCENARIO_LAUNCH_URL}}` with nothing launched) nothing opens and the event carries on, so put what to say then after it.
* In a preview the editor is never left: the same tab opens a new tab instead, and with nothing launched a toast says what would happen.

## Launcher scenes

A scene with **`launcher: true`** (in the editor: Scene settings › **Use as a scenario launcher scene**) is offered to a teacher who launches another scenario from this one in the game's 🚀 tab. After **Launch** they are asked where the class goes first: one of the launcher scenes, or **None** (straight into the scenario).

With a scene chosen, the game server puts every student of the teacher who is playing, in any room, into that scene, door or no door (a student playing another scenario has their page opened to it, with the launch carried along in `?launch=`), and each of them is sent `QL_SCENARIO_LAUNCH_URL`: the address of their own instance of the launched scenario (`https://…/{code}?group={team}`). The scene's events play the departure, and an `open_url` to `{{QL_SCENARIO_LAUNCH_URL}}` takes them on. `QL_SCENARIO_LAUNCH_URL` and `QL_NextMission` (its title) stay set until the player goes, and are empty otherwise, so a start event with the condition `QL_SCENARIO_LAUNCH_URL != ""` (an empty value) plays only for a launch.

A scene without the setting is a launcher scene when it has a `travel` action somewhere in its events, as departure scenes were before the setting existed. Unticking it (`launcher: false`) takes such a scene off the list. The publish check warns about a launcher scene with no `open_url` to `{{QL_SCENARIO_LAUNCH_URL}}` and no `travel`: students sent there would stay.
