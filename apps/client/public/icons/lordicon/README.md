# LordIcon icons

The game and the editor draw their interface icons from the [LordIcon](https://lordicon.com) set,
with LordIcon's own `<lord-icon>` player (`@lordicon/element`). The icons themselves are not in
this repository: each is a small animation file (JSON) that comes from a LordIcon account, and
which icons may be used, and how, depends on that account's licence (the free set asks for
attribution; the Pro set does not).

To switch the icons on:

1. In LordIcon, pick an icon for each name in `manifest.example.json` (the names are the keys of
   `ICONS` in `packages/shared/src/icons.ts`, where each also has the character that is shown
   until its icon has loaded).
2. Either download each icon as **Lottie JSON** into this folder, named as in the example
   (`mission.json`, `players.json`, ...), or note the address LordIcon's "embed" gives for it
   (`https://cdn.lordicon.com/<id>.json`).
3. List them in `manifest.json` (it ships empty; `manifest.example.json` has every name): each
   value is the file name or the address of that icon. Names left out keep their character.

```json
{
  "mission": "mission.json",
  "players": "https://cdn.lordicon.com/xxxxxxxx.json"
}
```

While `manifest.json` is empty no icon file is fetched and every icon is its character, so the
interface is complete either way. To keep the icons somewhere else (a CDN, a shared folder for the game and
the editor), set `VITE_LORDICON_BASE` when building; the manifest is then read from
`<base>/manifest.json` and relative file names are resolved against it.

The editor reads the same manifest from its own `public/icons/lordicon/` (or the same
`VITE_LORDICON_BASE`).
