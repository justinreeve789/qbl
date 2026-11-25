# QuestLab documentation

The site served at `/docs/`, built with [Astro Starlight](https://starlight.astro.build/).

| Section | Where | For |
| ------- | ----- | --- |
| **Build a mission** and the **Cloudy Pond walkthrough** | `src/content/docs/editor/` | Teachers and content creators using the editor |
| **Teaching** | `src/content/docs/editor/classes.mdx` | Classes, assignments, teams and reports |
| **Developers** | `src/content/docs/developers/` | Grouped in the sidebar as Scenario JSON (`structure`, the reference pages, and the spec v2 pages in `extensions/`), The platform, and AI, voices and the library; plus `local-development` and the `index` hub |

The sidebar is in `astro.config.mjs`. Pages are Markdown (`.md`), or `.mdx` where they use components (Starlight's numbered steps, a section host, a diagram). In `.mdx`, `{` and `<` in prose start code: put `{{variable}}` in backticks.

## Working on it

```sh
cd docs
npm install
npm run dev      # http://localhost:4321/docs/ with live reload
npm run build    # into docs/dist; fails on a broken link or anchor
```

Pages link to each other with addresses that include the `/docs` base, for example `/docs/editor/scene-editor/#spawn-points`. The build checks them (starlight-links-validator).

## The cast and the diagrams

The nine player avatars host the docs. Each page names its host in its frontmatter, and they appear under the title, standing at one end of a speech card and breaking out over its edges:

```yaml
host:
  who: lucy            # asimov, buck, gil, lucy, mallory, pinta, riona, sam or val
  says: "The school pond has turned brown!"
  side: right          # optional; left by default
```

In an `.mdx` page a host can also introduce a section: `<Host who="buck" side="right">Tokens last an hour.</Host>` (import it from `src/components/Host.astro`). The pictures are copies of `scenarios/assets/platform/{avatars,portraits}` in `src/assets/cast/` (the docs image builds from `docs/` alone), and who looks after which part of the docs, their colours and which way each picture faces are in `src/components/cast.ts`.

The diagrams are Astro components in `src/components/diagrams/`, drawn in HTML and inline SVG so they follow the light and dark themes:

| Component | What it draws | Used in |
| --------- | ------------- | ------- |
| `Flow` | Steps joined by arrows; a loop arrow (`loop=`); a timeline when every step has `minutes` | Concepts, facilitation, lesson plan, publishing, the generator |
| `Sequence` | Who calls whom, in order (`actors`, `steps` with `reply` and `note`) | Authentication, launch links, multiplayer protocol |
| `MissionAnatomy` | The Cloudy Pond taken apart: scenario, scenes, events, actions, library | Concepts, the editor at a glance, walkthrough |
| `SceneAnatomy` | A labelled scene: background, walkable area, spawn points, hotspot, character, exit, start event | Scene editor, walkthrough |
| `EventFlow` | The gate run twice: trigger, conditions, actions with their own conditions | Events and actions |
| `ConversationTree` | A branching conversation with a right answer and loops back | Conversations |
| `TeamsLookIn`, `SaveLayers` | Teams as copies of the world; where progress is kept | Classes, assignments API, instances |
| `PrivacySplit`, `Architecture` | What QuestLab holds about a student; the containers | Privacy, architecture |

## Things to keep in step with the editor

The editor guide describes the editor's own wording (button and field names). When you change a label in `apps/editor/src` (`schema.ts`, `views/`), search these pages for the old one.

The walkthrough's finished mission is `public/files/cloudy-pond.zip` (a ZIP that `Import a ZIP` accepts). Validate any change to it with `npm run validate -- scenario.json` from the repository root.

## Old addresses

The MkDocs site had its JSON pages at `/docs/scenario/`, `/docs/tooling/` and so on. They redirect to their new places (`redirects` in `astro.config.mjs`).
