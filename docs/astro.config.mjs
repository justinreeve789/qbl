// The QBL documentation: a static Starlight site served under /docs/ by the `docs` container.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

const developers = [
  'scenario', 'scene', 'event', 'action', 'media', 'character', 'item', 'variable', 'condition', 'spritemap', 'label',
  'extensions', 'save-data', 'generation', 'architecture', 'api', 'api-v1', 'protocol',
];

export default defineConfig({
  base: '/docs',
  trailingSlash: 'always',
  // The old MkDocs addresses (/docs/scenario/, /docs/tooling/ ...) still work.
  redirects: {
    ...Object.fromEntries(
      [...developers.filter((p) => p !== 'save-data'), 'session'].map((p) => [`/${p}`, `/docs/developers/${p === 'session' ? 'save-data' : p}/`]),
    ),
    '/labels': '/docs/developers/label/',
    '/classes': '/docs/editor/classes/',
    '/tooling': '/docs/editor/backups-and-copies/',
  },
  integrations: [
    starlight({
      title: 'QBL Docs',
      description: 'How to build and run missions in QBL, and how the scenario JSON works.',
      // Fails the build on a broken link, as `mkdocs build --strict` did.
      plugins: [starlightLinksValidator({ errorOnLocalLinks: false })],
      customCss: ['./src/styles/qbl.css'],
      lastUpdated: false,
      sidebar: [
        {
          label: 'Build a mission',
          items: [
            { label: 'The editor at a glance', slug: 'editor' },
            { label: 'Scenarios and scenes', slug: 'editor/scenarios-and-scenes' },
            { label: 'The scene editor', slug: 'editor/scene-editor' },
            { label: 'Events and actions', slug: 'editor/events-and-actions' },
            { label: 'The library', slug: 'editor/library' },
            { label: 'Settings, testing and publishing', slug: 'editor/settings-and-publishing' },
            { label: 'Backups, copies and the starship hub', slug: 'editor/backups-and-copies' },
          ],
        },
        {
          label: 'Walkthrough: The Cloudy Pond',
          items: [
            { label: '1. Set up the scenario', slug: 'editor/walkthrough/set-up' },
            { label: '2. Build the schoolyard', slug: 'editor/walkthrough/schoolyard' },
            { label: '3. Build the pond', slug: 'editor/walkthrough/pond' },
            { label: '4. Test, publish and assign', slug: 'editor/walkthrough/publish' },
          ],
        },
        {
          label: 'Teaching',
          items: [{ label: 'Classes, missions and teams', slug: 'editor/classes' }],
        },
        {
          label: 'Developers',
          items: [
            { label: 'Overview', slug: 'developers' },
            {
              label: 'Scenario JSON',
              items: [
                'scenario', 'scene', 'event', 'action', 'media', 'character', 'item', 'variable', 'condition', 'spritemap', 'label',
              ].map((p) => ({ slug: `developers/${p}` })),
            },
            { label: 'Runtime extensions (spec v2)', slug: 'developers/extensions' },
            { label: 'Save data', slug: 'developers/save-data' },
            { label: 'Generating missions with AI', slug: 'developers/generation' },
            { label: "Characters' voices (text-to-speech)", slug: 'developers/voices' },
            { label: 'Architecture', slug: 'developers/architecture' },
            { label: 'HTTP API contract', slug: 'developers/api' },
            { label: 'Public API (v1) for schools', slug: 'developers/api-v1' },
            { label: 'Multiplayer protocol', slug: 'developers/protocol' },
          ],
        },
      ],
    }),
  ],
});
