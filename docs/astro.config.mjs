// The QuestLab documentation: a static Starlight site served under /docs/ by the `docs` container.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

const developers = [
  'scenario', 'scene', 'event', 'action', 'media', 'character', 'item', 'variable', 'condition', 'spritemap', 'label',
  'extensions', 'save-data', 'generation', 'architecture', 'api', 'protocol',
];

export default defineConfig({
  base: '/docs',
  trailingSlash: 'always',
  // The old MkDocs addresses (/docs/scenario/, /docs/tooling/ ...) still work, and so does the
  // address the public API reference had before it became a section of its own.
  redirects: {
    ...Object.fromEntries(
      [...developers.filter((p) => p !== 'save-data'), 'session'].map((p) => [`/${p}`, `/docs/developers/${p === 'session' ? 'save-data' : p}/`]),
    ),
    '/labels': '/docs/developers/label/',
    '/classes': '/docs/editor/classes/',
    '/tooling': '/docs/editor/backups-and-copies/',
    '/developers/api-v1': '/docs/api-v1/',
  },
  integrations: [
    starlight({
      title: 'QuestLab Docs',
      description: 'Build missions that students walk around, teach with them, and connect them to your school systems.',
      // Fails the build on a broken link, as `mkdocs build --strict` did.
      plugins: [starlightLinksValidator({ errorOnLocalLinks: false })],
      customCss: ['./src/styles/qbl.css'],
      lastUpdated: false,
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Your first class in 20 minutes', slug: 'start/quickstart' },
            { label: 'How QuestLab works', slug: 'start/concepts' },
          ],
        },
        {
          label: 'For educators',
          items: [
            { label: 'Why teach with QuestLab', slug: 'educators' },
            { label: 'You are in the room: facilitating', slug: 'educators/facilitation' },
            { label: 'A class period, step by step', slug: 'educators/lesson-plan' },
            { label: 'Maximizing learning', slug: 'educators/maximize-learning' },
            { label: 'Mission ideas', slug: 'educators/ideas' },
            { label: 'Designing missions that teach', slug: 'educators/design-for-learning' },
          ],
        },
        {
          label: 'Build a mission',
          items: [
            { label: 'The editor at a glance', slug: 'editor' },
            { label: 'Scenarios and scenes', slug: 'editor/scenarios-and-scenes' },
            { label: 'The scene editor', slug: 'editor/scene-editor' },
            { label: 'The scene map', slug: 'editor/scene-map' },
            { label: 'Events and actions', slug: 'editor/events-and-actions' },
            { label: 'Infoboxes and questions', slug: 'editor/infoboxes' },
            { label: 'Close-up experiments (the bench)', slug: 'editor/bench' },
            { label: 'Conversations', slug: 'editor/conversations' },
            { label: 'The library', slug: 'editor/library' },
            { label: 'Patterns that work', slug: 'editor/patterns' },
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
            { label: '5. Level it up', slug: 'editor/walkthrough/level-up' },
          ],
        },
        {
          label: 'Run your class',
          items: [
            { label: 'Classes, missions and teams', slug: 'editor/classes' },
            { label: 'Reading the reports', slug: 'editor/reports' },
            { label: 'Plans, credits and the AI generator', slug: 'editor/plans-and-generator' },
            { label: 'The district admin panel', slug: 'editor/district-admin' },
            { label: 'The asset library and content admins', slug: 'editor/asset-library' },
          ],
        },
        {
          label: 'The public API (v1)',
          items: [
            { label: 'Overview and quickstart', slug: 'api-v1' },
            { label: 'Authentication', slug: 'api-v1/authentication' },
            { label: 'People and classes', slug: 'api-v1/people' },
            { label: 'Missions, assignments and teams', slug: 'api-v1/assignments' },
            { label: 'Launch links (sign people in)', slug: 'api-v1/launch-links' },
            { label: 'Avatars', slug: 'api-v1/avatars' },
            { label: 'Reports and grades', slug: 'api-v1/reports' },
            { label: 'Activity, exports and the audit log', slug: 'api-v1/activity-and-privacy-requests' },
            { label: 'Recipes', slug: 'api-v1/recipes' },
            { label: 'Privacy by design', slug: 'api-v1/privacy' },
            { label: 'Conventions, errors and versioning', slug: 'api-v1/conventions' },
          ],
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
            { label: 'Instances, teams and save data', slug: 'developers/instances' },
            { label: 'Generating missions with AI', slug: 'developers/generation' },
            { label: "Characters' voices (text-to-speech)", slug: 'developers/voices' },
            { label: 'The asset library', slug: 'developers/asset-library' },
            { label: 'Architecture', slug: 'developers/architecture' },
            { label: 'HTTP API contract (internal)', slug: 'developers/api' },
            { label: 'Billing, credits and district sign-in', slug: 'developers/billing' },
            { label: 'Multiplayer protocol', slug: 'developers/protocol' },
          ],
        },
      ],
    }),
  ],
});
