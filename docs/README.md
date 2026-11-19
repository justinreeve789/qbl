# QBL documentation

The site served at `/docs/`, built with [Astro Starlight](https://starlight.astro.build/).

| Section | Where | For |
| ------- | ----- | --- |
| **Build a mission** and the **Cloudy Pond walkthrough** | `src/content/docs/editor/` | Teachers and content creators using the editor |
| **Teaching** | `src/content/docs/editor/classes.md` | Classes, assignments, teams and reports |
| **Developers** | `src/content/docs/developers/` | The scenario JSON, the runtime extensions, save data, and the architecture, HTTP and multiplayer contracts |

The sidebar is in `astro.config.mjs`. Pages are Markdown (`.md`), or `.mdx` where they use Starlight components such as the numbered steps.

## Working on it

```sh
cd docs
npm install
npm run dev      # http://localhost:4321/docs/ with live reload
npm run build    # into docs/dist; fails on a broken link or anchor
```

Pages link to each other with addresses that include the `/docs` base, for example `/docs/editor/scene-editor/#spawn-points`. The build checks them (starlight-links-validator).

## Things to keep in step with the editor

The editor guide describes the editor's own wording (button and field names). When you change a label in `apps/editor/src` (`schema.ts`, `views/`), search these pages for the old one.

The walkthrough's finished mission is `public/files/cloudy-pond.zip` (a ZIP that `Import a ZIP` accepts). Validate any change to it with `npm run validate -- scenario.json` from the repository root.

## Old addresses

The MkDocs site had its JSON pages at `/docs/scenario/`, `/docs/tooling/` and so on. They redirect to their new places (`redirects` in `astro.config.mjs`).
