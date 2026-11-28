// The QuestLab documentation: a static Starlight site served under /docs/ by the `docs` container.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

const developers = [
  'scenario', 'scene', 'event', 'media', 'character', 'item', 'variable', 'condition', 'spritemap', 'label',
  'save-data', 'generation', 'architecture', 'api', 'protocol',
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
    // Actions used to be on /developers/action/ and four pages under /developers/extensions/.
    '/action': '/docs/developers/actions/',
    '/developers/action': '/docs/developers/actions/',
    '/developers/extensions': '/docs/developers/structure/',
    '/developers/extensions/actions': '/docs/developers/actions/',
    '/developers/extensions/actions-world': '/docs/developers/actions/',
    '/developers/extensions/dialogue': '/docs/developers/actions/dialogue/',
    '/developers/extensions/rewards': '/docs/developers/actions/award/',
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
      // Each page's host (frontmatter `host:`) speaks first.
      components: {
        MarkdownContent: './src/components/MarkdownContent.astro',
        // A way back to the QuestLab site (/) beside the docs title.
        SiteTitle: './src/components/SiteTitle.astro',
      },
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
            { label: 'How students learn', slug: 'educators/how-students-learn' },
            { label: 'You are in the room: facilitating', slug: 'educators/facilitation' },
            { label: 'A class period, step by step', slug: 'educators/lesson-plan' },
            { label: 'Maximizing learning', slug: 'educators/maximize-learning' },
            { label: 'Mission ideas', slug: 'educators/ideas' },
            { label: 'Designing missions that teach', slug: 'educators/design-for-learning' },
            { label: 'Game design rules for missions', slug: 'educators/game-design-rules' },
          ],
        },
        {
          label: 'Mission blueprints',
          items: [
            { label: 'All 24 blueprints', slug: 'blueprints' },
            { label: 'Why a mission, and when not', slug: 'blueprints/why-questlab' },
            { label: 'Standards and objectives', slug: 'blueprints/standards' },
            { label: 'Running the prompts', slug: 'blueprints/run-the-prompts' },
            { label: 'Grades K to 2', collapsed: true, items: [
              { label: '1. The Long Shadow Clock', slug: 'blueprints/long-shadow-clock' },
              { label: '2. Signal Hill', slug: 'blueprints/signal-hill' },
              { label: '3. Hitchhiker Seeds', slug: 'blueprints/hitchhiker-seeds' },
            ] },
            { label: 'Grades 3 to 5', collapsed: true, items: [
              { label: '4. The Pier of Parts', slug: 'blueprints/pier-of-parts' },
              { label: '5. Market Day at Three Rivers', slug: 'blueprints/market-day-at-three-rivers' },
              { label: '6. Four Skies', slug: 'blueprints/four-skies' },
              { label: '7. The Canyon That Kept a Diary', slug: 'blueprints/canyon-that-kept-a-diary' },
              { label: '8. The Word Forge', slug: 'blueprints/word-forge' },
              { label: '9. Two Sides of the Garden Wall', slug: 'blueprints/two-sides-of-the-garden-wall' },
              { label: '10. Bridge the Gap at Kessa Gorge', slug: 'blueprints/bridge-the-gap-at-kessa-gorge' },
              { label: "11. The Cartographer's Island", slug: 'blueprints/cartographers-island' },
              { label: '12. The Pond That Went Quiet', slug: 'blueprints/pond-that-went-quiet' },
              { label: '13. The Case of the Vanishing Grams', slug: 'blueprints/case-of-the-vanishing-grams' },
            ] },
            { label: 'Grades 6 to 8', collapsed: true, items: [
              { label: '14. Festival Colors', slug: 'blueprints/festival-colors' },
              { label: '15. The Moths of Ashgrove', slug: 'blueprints/moths-of-ashgrove' },
              { label: '16. The Snapdragon Greenhouse', slug: 'blueprints/snapdragon-greenhouse' },
              { label: '17. Gravity Games', slug: 'blueprints/gravity-games' },
              { label: '18. One Sky, Two Views', slug: 'blueprints/one-sky-two-views' },
              { label: '19. Drift', slug: 'blueprints/drift' },
              { label: '20. The Well on Brackwater Lane', slug: 'blueprints/well-on-brackwater-lane' },
              { label: '21. The Mill Fire Inquiry', slug: 'blueprints/mill-fire-inquiry' },
              { label: '22. The Glimmerfruit Rumor', slug: 'blueprints/glimmerfruit-rumor' },
            ] },
            { label: 'Grades 8 to 12', collapsed: true, items: [
              { label: '23. The Bloom', slug: 'blueprints/the-bloom' },
              { label: '24. Titration at Tarn Lake', slug: 'blueprints/titration-at-tarn-lake' },
            ] },
            { label: 'Before you build', slug: 'blueprints/build-notes' },
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
            { label: 'Student building', slug: 'editor/student-building' },
            { label: 'The student notebook', slug: 'editor/student-notebook' },
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
            { label: 'Run QuestLab locally', slug: 'developers/local-development' },
            {
              label: 'Scenario JSON',
              items: [
                { label: 'How a scenario fits together', slug: 'developers/structure' },
                {
                  label: 'Scenarios and scenes',
                  items: [
                    { label: 'Scenario', slug: 'developers/scenario' },
                    { label: 'Scenario fields', slug: 'developers/extensions/scenario' },
                    { label: 'Scene', slug: 'developers/scene' },
                    { label: 'Scenes, layers and spawn points', slug: 'developers/extensions/scenes' },
                    { label: 'Skies, weather, water, stories', slug: 'developers/extensions/atmosphere' },
                    { label: 'The close-up bench', slug: 'developers/extensions/bench' },
                  ],
                },
                {
                  label: 'Events and conditions',
                  items: [
                    { label: 'Event', slug: 'developers/event' },
                    { label: 'Events and hotspots', slug: 'developers/extensions/events' },
                    { label: 'Condition', slug: 'developers/condition' },
                    { label: 'Label', slug: 'developers/label' },
                  ],
                },
                {
                  label: 'Actions',
                  items: [
                    { label: 'All actions', slug: 'developers/actions' },
                    { label: 'Talking and storytelling', collapsed: true, items: [
                      { label: 'Dialogue', slug: 'developers/actions/dialogue' },
                      { label: 'Narration', slug: 'developers/actions/narration' },
                      { label: 'Conversation', slug: 'developers/actions/conversation' },
                      { label: 'Reading text aloud', slug: 'developers/actions/reading-aloud' },
                    ] },
                    { label: 'Boxes and words on screen', collapsed: true, items: [
                      { label: 'Infobox', slug: 'developers/actions/infobox' },
                      { label: 'Text overlay', slug: 'developers/actions/text-overlay' },
                    ] },
                    { label: 'Characters and the player', collapsed: true, items: [
                      { label: 'Walk', slug: 'developers/actions/walk' },
                      { label: 'Animate', slug: 'developers/actions/animate' },
                      { label: 'Freeze', slug: 'developers/actions/freeze' },
                      { label: 'Avatar', slug: 'developers/actions/avatar' },
                    ] },
                    { label: 'Pictures, video and sound', collapsed: true, items: [
                      { label: 'Image fixed', slug: 'developers/actions/image-fixed' },
                      { label: 'Image overlay', slug: 'developers/actions/image-overlay' },
                      { label: 'Spritemap', slug: 'developers/actions/spritemap' },
                      { label: 'Video', slug: 'developers/actions/video' },
                      { label: 'Audio', slug: 'developers/actions/audio' },
                      { label: 'Translate', slug: 'developers/actions/translate' },
                    ] },
                    { label: 'Scenes, camera and weather', collapsed: true, items: [
                      { label: 'Jump', slug: 'developers/actions/jump' },
                      { label: 'Camera', slug: 'developers/actions/camera' },
                      { label: 'Shake', slug: 'developers/actions/shake' },
                      { label: 'Weather', slug: 'developers/actions/weather' },
                      { label: 'Travel', slug: 'developers/actions/travel' },
                      { label: 'Open URL', slug: 'developers/actions/open-url' },
                    ] },
                    { label: 'Timing and flow', collapsed: true, items: [
                      { label: 'Wait', slug: 'developers/actions/wait' },
                      { label: 'Run event', slug: 'developers/actions/run-event' },
                      { label: 'Repeat', slug: 'developers/actions/repeat' },
                      { label: 'Cancel action', slug: 'developers/actions/cancel' },
                      { label: 'Cancel event', slug: 'developers/actions/cancel-event' },
                    ] },
                    { label: 'Rewards and progress', collapsed: true, items: [
                      { label: 'Award', slug: 'developers/actions/award' },
                      { label: 'Glossary', slug: 'developers/actions/glossary' },
                      { label: 'Variable', slug: 'developers/actions/variable' },
                      { label: 'Shop', slug: 'developers/actions/shop' },
                    ] },
                    { label: 'Science', collapsed: true, items: [
                      { label: 'Bench', slug: 'developers/actions/bench' },
                    ] },
                  ],
                },
                {
                  label: 'Variables',
                  items: [
                    { label: 'Global variables', slug: 'developers/variable' },
                    { label: 'Player and shared variables', slug: 'developers/extensions/variables' },
                  ],
                },
                {
                  label: 'Media, characters and items',
                  items: [
                    { label: 'Media', slug: 'developers/media' },
                    { label: 'Spritemap', slug: 'developers/spritemap' },
                    { label: 'Animations', slug: 'developers/extensions/animations' },
                    { label: 'Character', slug: 'developers/character' },
                    { label: 'Characters in the world', slug: 'developers/extensions/characters' },
                    { label: 'Item', slug: 'developers/item' },
                    { label: 'Items, the bag and vehicles', slug: 'developers/extensions/items' },
                  ],
                },
                { label: 'The side panel and messages', slug: 'developers/extensions/player-interface' },
                { label: 'Patterns, and not built yet', slug: 'developers/extensions/patterns' },
              ],
            },
            {
              label: 'The platform',
              items: [
                { label: 'Architecture', slug: 'developers/architecture' },
                { label: 'Save data', slug: 'developers/save-data' },
                { label: 'Instances, teams and save data', slug: 'developers/instances' },
                { label: 'Multiplayer protocol', slug: 'developers/protocol' },
                { label: 'HTTP API contract (internal)', slug: 'developers/api' },
                { label: 'Billing, credits and district sign-in', slug: 'developers/billing' },
              ],
            },
            {
              label: 'AI, voices and the library',
              items: [
                { label: 'Generating missions with AI', slug: 'developers/generation' },
                { label: 'Generation methods and traces', slug: 'developers/generation-methods' },
                { label: "Characters' voices (text-to-speech)", slug: 'developers/voices' },
                { label: 'The asset library', slug: 'developers/asset-library' },
              ],
            },
          ],
        },
        {
          label: 'Codebase guide',
          items: [
            { label: 'Start here', slug: 'codebase' },
            { label: 'The lifecycle of a scenario', slug: 'codebase/lifecycle' },
            { label: 'The event engine', slug: 'codebase/event-engine' },
            { label: 'Shared rules (packages/shared)', slug: 'codebase/shared' },
            { label: 'The game client', slug: 'codebase/client' },
            { label: 'The game server', slug: 'codebase/server' },
            { label: 'The editor: architecture', slug: 'codebase/editor' },
            { label: 'The editor: pages and views', slug: 'codebase/editor-views' },
            { label: 'The API (PHP)', slug: 'codebase/api' },
            { label: 'The data model', slug: 'codebase/data-model' },
            { label: 'Other API subsystems', slug: 'codebase/subsystems' },
            { label: 'Curriculum standards library', slug: 'codebase/standards-library' },
            { label: 'Infrastructure and tooling', slug: 'codebase/infrastructure' },
            { label: 'Testing', slug: 'codebase/testing' },
            { label: 'Recipes', slug: 'codebase/recipes' },
            { label: 'Conventions and gotchas', slug: 'codebase/conventions' },
          ],
        },
      ],
    }),
  ],
});
