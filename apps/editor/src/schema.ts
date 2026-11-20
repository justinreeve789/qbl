import type { ActionType } from '@qbl/shared';
import type { Field } from './fields';

/**
 * What can be edited, as data. Each list here becomes a form. The attributes are the ones in
 * docs/src/content/docs/developers (action.md, scene.md, event.md, ...) plus the extensions in docs/src/content/docs/developers/extensions.md.
 */

const ALIGNMENTS = ['top left', 'top center', 'top right', 'center left', 'center center', 'center right', 'bottom left', 'bottom center', 'bottom right']
  .map((a) => [a, a] as const);

const position: Field[] = [
  { key: 'position_x', label: 'X', kind: 'number', hint: 'Scene pixels from the left. You can also drag the marker on the canvas.' },
  { key: 'position_y', label: 'Y', kind: 'number', hint: 'Scene pixels from the top.' },
];
/** Where an action shows something: as `position`, and the spot can be picked by clicking the scene. */
const shownAt: Field[] = [
  { ...position[0]!, spot: { y: 'position_y', prompt: 'Click where it should appear.' } },
  position[1]!,
];
const scale: Field[] = [
  { key: 'scale_x', label: 'Scale X', kind: 'number', placeholder: '1', step: 0.05, slider: { min: 0.1, max: 3 } },
  { key: 'scale_y', label: 'Scale Y', kind: 'number', placeholder: '1', step: 0.05, slider: { min: 0.1, max: 3 } },
];
const duration = (hint: string): Field => ({ key: 'duration', label: 'Duration (ms)', kind: 'number', min: 0, placeholder: 'Until cancelled', hint });
const layer: Field = {
  key: 'layer', label: 'Drawn', kind: 'select', placeholder: 'Above avatars',
  options: [['above', 'Above avatars'], ['sorted', 'Among avatars, by Y'], ['behind', 'Behind avatars: part of the background']],
};

/** Reading a text aloud: these two go on every action that shows text. */
const narration: Field[] = [
  {
    key: 'narrate', label: 'Read aloud', kind: 'tristate', placeholder: 'As the scenario’s setting says', options: [['true', 'Yes: read this aloud'], ['false', 'No: never read this aloud']],
    hint: 'The browser’s voice reads the text and each word lights up as it is spoken. Players can switch reading aloud off for themselves. A character’s voice (pitch, pace) is set on the Characters page.',
  },
  { key: 'narration_media_id', label: 'Recording to play instead', kind: 'media', mediaType: 'audio', placeholder: 'The browser’s voice', hint: 'A recording of this text. The words are then lit at an even pace over its length.' },
];

const spritemap: Field[] = [
  { key: 'spritemap_tiles_num', label: 'Tiles in total', kind: 'number', min: 1 },
  { key: 'spritemap_tiles_horizontal', label: 'Tiles across', kind: 'number', min: 1 },
  { key: 'spritemap_tiles_vertical', label: 'Tiles down', kind: 'number', min: 1 },
  { key: 'spritemap_width', label: 'Tile width (px)', kind: 'number', min: 1 },
  { key: 'spritemap_height', label: 'Tile height (px)', kind: 'number', min: 1 },
  { key: 'spritemap_duration', label: 'One pass (ms)', kind: 'number', min: 0 },
  { key: 'spritemap_tile_sequence', label: 'Tile order', kind: 'numbers', placeholder: 'In order', hint: 'Tile numbers separated by commas, e.g. 0, 1, 2, 1.', wide: true },
  { key: 'spritemap_repeat', label: 'Repeat', kind: 'bool' },
  { key: 'spritemap_show_first_as_fixed', label: 'Show the first tile before it plays', kind: 'bool' },
];

/**
 * Where a walk goes, for a walk action and a routine's walk step. `here` lists the spawn points of
 * the scene being edited (for a routine: of every scene, since the character may be anywhere).
 */
const to = (v: Record<string, unknown>) => (v.to as string | undefined) ?? 'point';
export const WALK_FIELDS: Field[] = [
  {
    key: 'to', label: 'Walk to', kind: 'select', wide: true, structural: true, default: 'point',
    options: [['point', 'A spot in the scene'], ['spawn', 'A spawn point in the scene'], ['scene', 'Another scene, through its doors']],
    hint: 'To another scene, the walker heads for a hotspot whose jump goes there (a door), goes through it and arrives at the spawn point that jump names, as a player would. A character that walks around on its own can go through several rooms to get there; anyone else only through a door of this scene.',
  },
  {
    key: 'position_x', label: 'X', kind: 'number', when: (v) => to(v) === 'point', spot: { y: 'position_y', prompt: 'Click where the walker should go.' },
    hint: 'Scene pixels from the left. The walker goes around whatever is in the way, and stops at the nearest spot it can stand on. “Pick on the scene” chooses the spot with a click; in the scene editor you can also drag its marker.',
  },
  { key: 'position_y', label: 'Y', kind: 'number', hint: 'Scene pixels from the top.', when: (v) => to(v) === 'point' },
  { key: 'spawn_point', label: 'Spawn point', kind: 'spawn', sceneKey: 'here', placeholder: 'Choose a spawn point', when: (v) => to(v) === 'spawn' },
  { key: 'scene_id', label: 'Scene', kind: 'scene', structural: true, when: (v) => to(v) === 'scene' },
  {
    key: 'spawn_point', label: 'Then walk on to', kind: 'spawn', sceneKey: 'scene_id', placeholder: 'Stop where the door brings it', when: (v) => to(v) === 'scene',
    hint: 'A spawn point of that scene to walk to once there. Only a character that walks around on its own goes on; the player and other characters leave this scene through the door.',
  },
  { key: 'speed', label: 'Speed (pixels per second)', kind: 'number', min: 1, placeholder: 'The walker’s own', slider: { min: 50, max: 1000, step: 10 }, hint: 'Players walk at the scenario’s speed (420 unless the Scenario page says otherwise). A player is never walked faster than that.' },
  { key: 'facing', label: 'Face on arriving', kind: 'select', placeholder: 'The way it walked', options: [['left', 'Left'], ['right', 'Right']] },
];

/**
 * A walk's attributes once `to` has changed: only those of the new destination are kept, so a
 * walk to another scene does not carry the X and Y it had as a walk to a spot.
 */
export function tidyWalk<T extends Record<string, unknown>>(values: T): T {
  const next: Record<string, unknown> = { ...values };
  const to = (values.to as string | undefined) ?? 'point';
  if (to !== 'point') {
    delete next.position_x;
    delete next.position_y;
  }
  if (to !== 'scene') delete next.scene_id;
  // A spawn point's name belongs to the scene it was chosen in.
  delete next.spawn_point;
  return next as T;
}

export interface ActionDef {
  label: string;
  /** One sentence for the "add action" menu. */
  about: string;
  fields: Field[];
}

/** The fourteen action types of docs/src/content/docs/developers/action.md. `media_id` and `blocking` are columns; the rest are params. */
export const ACTIONS: Record<ActionType, ActionDef> = {
  infobox: {
    label: 'Infobox',
    about: 'A box of text, with optional buttons.',
    fields: [
      { key: 'content', label: 'Content (HTML)', kind: 'html', wide: true, hint: 'Use {{variable_name}} to show a variable and {{media:ID}} for an image.' },
      { key: 'dismissible', label: 'Can be closed without choosing a button', kind: 'bool', default: true, wide: true },
      ...narration,
    ],
  },
  jump: {
    label: 'Jump',
    about: 'Go to another scene.',
    fields: [
      { key: 'scene_id', label: 'Scene', kind: 'scene', structural: true },
      { key: 'spawn_point', label: 'Arrive at', kind: 'spawn', sceneKey: 'scene_id' },
    ],
  },
  variable: {
    label: 'Variable',
    about: 'Set or change a variable.',
    fields: [
      { key: 'name', label: 'Variable', kind: 'variable' },
      {
        key: 'operator', label: 'Change', kind: 'select',
        options: [['set', 'Set to'], ['+', 'Add'], ['-', 'Subtract'], ['*', 'Multiply by'], ['/', 'Divide by'], ['%', 'Remainder of dividing by'], ['random', 'Random whole number up to']],
      },
      { key: 'operand', label: 'Value', kind: 'value' },
    ],
  },
  audio: {
    label: 'Audio',
    about: 'Play a sound, or background music.',
    fields: [
      { key: 'media_id', label: 'Sound', kind: 'media', mediaType: 'audio', wide: true },
      { key: 'volume', label: 'Volume (0 to 1)', kind: 'number', min: 0, max: 1, step: 0.05, placeholder: '1', slider: { min: 0, max: 1 } },
      { key: 'repeat', label: 'Loop', kind: 'bool' },
      { key: 'persist', label: 'Background music: keep playing across scenes', kind: 'bool', wide: true, hint: 'One music track plays at a time. Starting the same track again in the next scene does not restart it.' },
    ],
  },
  text_overlay: {
    label: 'Text overlay',
    about: 'Text over the screen.',
    fields: [
      { key: 'text', label: 'Text', kind: 'textarea', wide: true, hint: 'Use {{variable_name}} to show a variable.' },
      { key: 'alignment', label: 'Where', kind: 'select', options: ALIGNMENTS, placeholder: 'center center' },
      duration('Leave empty to keep it until the scene changes or it is cancelled.'),
      { key: 'text_font_size', label: 'Font size (px)', kind: 'number', min: 6, slider: { min: 8, max: 72 } },
      { key: 'text_font_color', label: 'Color', kind: 'color' },
      { key: 'text_font_style', label: 'Style', kind: 'text', placeholder: 'bold, italic…' },
      ...narration,
    ],
  },
  image_overlay: {
    label: 'Image overlay',
    about: 'An image over the screen.',
    fields: [
      { key: 'media_id', label: 'Image', kind: 'media', mediaType: 'image', wide: true },
      { key: 'alignment', label: 'Where', kind: 'select', options: ALIGNMENTS, placeholder: 'center center' },
      duration('Leave empty to keep it until it is cancelled.'),
      ...scale,
    ],
  },
  image_fixed: {
    label: 'Image in scene',
    about: 'An image placed in the scene.',
    fields: [{ key: 'media_id', label: 'Image', kind: 'media', mediaType: 'image', wide: true }, ...shownAt, ...scale, duration('Leave empty to keep it until it is cancelled.'), layer],
  },
  spritemap: {
    label: 'Spritemap',
    about: 'An animated sprite sheet placed in the scene.',
    fields: [{ key: 'media_id', label: 'Sprite sheet', kind: 'media', mediaType: 'image', wide: true }, ...shownAt, ...scale, ...spritemap, layer],
  },
  video: {
    label: 'Video',
    about: 'Play a video over the screen.',
    fields: [
      { key: 'media_id', label: 'Video', kind: 'media', mediaType: 'video', wide: true },
      { key: 'alignment', label: 'Where', kind: 'select', options: ALIGNMENTS, placeholder: 'center center' },
      { key: 'volume', label: 'Volume (0 to 1)', kind: 'number', min: 0, max: 1, step: 0.05, placeholder: '1', slider: { min: 0, max: 1 } },
      ...scale,
    ],
  },
  award: {
    label: 'Award stars or XP',
    about: 'Give the player stars and XP, or take them away.',
    fields: [
      { key: 'stars', label: 'Stars', kind: 'number', step: 1, placeholder: '0', hint: 'Stars are spent in the marketplace. A negative number takes stars away.' },
      { key: 'xp', label: 'XP', kind: 'number', step: 1, placeholder: '0', hint: 'XP adds up to ranks and is never spent. A negative number takes XP away.' },
      { key: 'note', label: 'Shown with the award', kind: 'text', wide: true, placeholder: 'Sample collected' },
      { key: 'badge', label: 'Badge that comes with it', kind: 'text', placeholder: 'No badge', hint: 'A badge is earned once and is shown on the player’s profile, where other players can see it.' },
      { key: 'badge_media_id', label: 'Badge picture', kind: 'media', mediaType: 'image' },
      { key: 'badge_description', label: 'What the badge is for', kind: 'text', wide: true, placeholder: 'Found out why the stream wilted' },
      { key: 'repeatable', label: 'Give it every time this runs', kind: 'bool', wide: true, hint: 'Normally a player gets each award once, however often the event runs. Stars and XP belong to the player’s account and carry across all scenarios; guests do not earn them. Put awards in an event, not on an infobox button.' },
    ],
  },
  glossary: {
    label: 'Add a glossary word',
    about: 'Give the player a word and its meaning, where they meet it.',
    fields: [
      { key: 'entry_id', label: 'Word', kind: 'glossary', wide: true, hint: 'Words are defined on the Glossary page. A word marked “from the start” needs no action. A player gets each word once.' },
      { key: 'quiet', label: 'Add it without telling the player', kind: 'bool', wide: true },
    ],
  },
  shop: {
    label: 'Open the marketplace',
    about: 'Open the shop where players spend stars and dress their avatar.',
    fields: [],
  },
  dialogue: {
    label: 'Dialogue',
    about: 'A speech bubble over the speaker, or a story box with their portrait.',
    fields: [
      { key: 'text', label: 'What they say', kind: 'textarea', wide: true, hint: 'Use {{variable_name}} to show a variable.' },
      {
        key: 'style', label: 'Shown as', kind: 'select', wide: true, placeholder: 'A speech bubble over the speaker', options: [['portrait', 'A story box with the speaker’s portrait']],
        hint: 'A bubble stays on screen by moving below or beside the speaker. A story box crosses the bottom of the screen with the speaker’s close-up and name, and waits for the player to continue: for the characters and moments that carry the story. A character’s close-up is its “portrait” animation, on the Characters page; avatars come with theirs.',
      },
      { key: 'speaker', label: 'Who speaks', kind: 'select', placeholder: 'The player', options: [['character', 'A character']], structural: true },
      { key: 'character_id', label: 'Character', kind: 'character', hint: 'For a bubble the character must be placed in this scene. A story box can carry a voice from anywhere.' },
      { key: 'duration', label: 'Stays for (ms)', kind: 'number', min: 0, placeholder: 'Bubble: long enough to read. Story box: until the player continues', hint: 'A click closes it sooner. Read aloud, a bubble stays until the voice has finished.' },
      ...narration,
    ],
  },
  freeze: {
    label: 'Freeze or release player',
    about: 'Stop the player from walking (while a character talks), or let them walk again.',
    fields: [
      { key: 'frozen', label: 'The player', kind: 'select', options: [['true', 'Cannot move'], ['false', 'Can move again']], wide: true, hint: 'A freeze ends at a “Can move again” action, when the event that froze the player finishes, or on leaving the scene, whichever comes first. Nobody can be left stuck.' },
    ],
  },
  animate: {
    label: 'Play an animation',
    about: 'Make the player’s avatar, an item, a vehicle or a character jump, dance or play any animation it has.',
    fields: [
      {
        key: 'target', label: 'On', kind: 'select', wide: true, structural: true, placeholder: 'The player’s avatar',
        options: [['item', 'An item or vehicle'], ['character', 'A character in this scene'], ['action', 'A picture another action is showing']],
        hint: 'The player’s avatar is animated for everyone in the scene. An item being ridden or worn is animated too, wherever it is.',
      },
      // Structural: the animation list below is the chosen item's or character's.
      { key: 'item_id', label: 'Item', kind: 'item', structural: true },
      { key: 'character_id', label: 'Character', kind: 'character', structural: true },
      { key: 'target_id', label: 'Action', kind: 'action' },
      {
        key: 'animation', label: 'Animation', kind: 'animation', wide: true, placeholder: 'None: stop what is playing',
        hint: 'For a character, one of the animations defined for it on the Characters page. For an item, one from its picture’s sprite sheet (on the Media page) or a built-in move: jump, spin, crouch, wave, dance. None stops what is playing. With “Wait for it” ticked, the next action waits until a one-pass animation has finished.',
      },
    ],
  },
  avatar: {
    label: 'Show or hide avatar',
    about: 'Hide the player’s avatar (stepping into a rocket), or show it again.',
    fields: [
      { key: 'visible', label: 'The avatar is', kind: 'select', options: [['false', 'Hidden'], ['true', 'Shown']], wide: true, hint: 'Everyone in the scene sees the change. Avatars are always shown again on arriving in a scene, so to keep them hidden in a scene, hide them in one of its start events.' },
      { key: 'duration', label: 'Fade (ms)', kind: 'number', min: 0, placeholder: 'At once' },
    ],
  },
  wait: {
    label: 'Wait',
    about: 'Pause before the next action.',
    fields: [{ key: 'duration', label: 'Duration (ms)', kind: 'number', min: 0 }],
  },
  run_event: {
    label: 'Run event',
    about: 'Run another event, usually an indirect one.',
    fields: [{ key: 'target_event_id', label: 'Event', kind: 'event', wide: true, hint: 'An event that is already running is not started again.' }],
  },
  repeat: {
    label: 'Repeat',
    about: 'Start this event again from its first action.',
    fields: [],
  },
  cancel: {
    label: 'Cancel',
    about: 'Stop another action: remove an image, stop a sound.',
    fields: [{ key: 'action_id', label: 'Action to stop', kind: 'action', wide: true }],
  },
  walk: {
    label: 'Walk',
    about: 'Walk a character or the player to a spot, a spawn point, or another scene.',
    fields: [
      {
        key: 'target', label: 'Who walks', kind: 'select', wide: true, structural: true, placeholder: 'A character', options: [['player', 'The player']],
        hint: 'Unlike Translate, a walk goes around things, plays the walking poses and turns the walker the way it goes. The player is walked even while frozen: freeze them first for a cutscene.',
      },
      {
        key: 'character_id', label: 'Character', kind: 'character', wide: true, when: (v) => v.target !== 'player',
        hint: 'A character set to walk around on its own (Characters page, “Getting around”) walks for everyone, can go to other scenes and stays where it went. Any other character walks on this player’s screen (or the whole scene’s, when the event’s audience is the scene) and is back in its place next time.',
      },
      ...WALK_FIELDS,
    ],
  },
  translate: {
    label: 'Translate',
    about: 'Move, resize or fade something another action is showing.',
    fields: [
      { key: 'target_id', label: 'Action to animate', kind: 'action', wide: true },
      { key: 'position_x', label: 'To X', kind: 'number', spot: { y: 'position_y', prompt: 'Click where it should move to.' }, hint: 'Scene pixels from the left. Empty: it keeps its X. “Pick on the scene” chooses both with a click.' },
      { key: 'position_y', label: 'To Y', kind: 'number' },
      ...scale,
      { key: 'alpha', label: 'Opacity (0 to 1)', kind: 'number', min: 0, max: 1, step: 0.05, slider: { min: 0, max: 1 } },
      { key: 'duration', label: 'Over (ms)', kind: 'number', min: 0 },
    ],
  },
};

export const ACTION_TYPES = Object.keys(ACTIONS) as ActionType[];

/** An icon and a colour for each action type, by what kind of thing it does. */
const SAY = '#2f6fed', SHOW = '#8e5bd6', SOUND = '#0f9d8a', FLOW = '#c77b12', PLAYER = '#d6457a', STATE = '#3b8f4a';
export const ACTION_LOOK: Record<ActionType, readonly [icon: string, tone: string]> = {
  infobox: ['📋', SAY], dialogue: ['💬', SAY], text_overlay: ['🔤', SAY],
  image_overlay: ['🖼️', SHOW], image_fixed: ['📌', SHOW], spritemap: ['🎞️', SHOW], video: ['🎬', SHOW], translate: ['↔️', SHOW],
  audio: ['🔊', SOUND],
  jump: ['🚪', FLOW], wait: ['⏳', FLOW], run_event: ['▶️', FLOW], repeat: ['🔁', FLOW], cancel: ['✖️', FLOW],
  avatar: ['👤', PLAYER], freeze: ['✋', PLAYER], animate: ['🤸', PLAYER], walk: ['🚶', PLAYER], award: ['⭐', '#b8860b'], shop: ['🛍️', '#b8860b'], glossary: ['📖', STATE],
  variable: ['🔢', STATE],
};

/** Attributes every action row has. */
export const ACTION_COMMON: Field[] = [
  { key: 'blocking', label: 'Wait for this to finish before the next action', kind: 'bool', default: true, wide: true },
];

/** Starting values for a new action of each type, so it is valid as soon as it is added. */
export function actionDefaults(type: ActionType): Record<string, unknown> {
  switch (type) {
    case 'award':
      return { stars: 5, xp: 10 };
    case 'glossary':
      return {};
    case 'dialogue':
      return { text: 'Hello!' };
    case 'freeze':
      return { frozen: true };
    case 'animate':
      return { animation: 'jump' };
    case 'avatar':
      return { visible: false, duration: 400 };
    case 'infobox':
      return { content: '<p>Text…</p>' };
    case 'variable':
      return { operator: 'set', operand: 1 };
    case 'text_overlay':
      return { text: 'Text…', duration: 3000 };
    case 'wait':
      return { duration: 1000 };
    case 'image_fixed':
    case 'spritemap':
      return { position_x: 200, position_y: 200 };
    case 'translate':
      return { duration: 1000 };
    case 'walk':
      return { to: 'point', position_x: 400, position_y: 400 };
    default:
      return {};
  }
}

export const OPERATORS = (['=', '!=', '>', '<', '>=', '<='] as const).map((o) => [o, o] as const);

// ------------------------------------------------------------------ scenario

export const SCENARIO_FIELDS: Field[] = [
  { key: 'title', label: 'Title', kind: 'text', wide: true },
  { key: 'subtitle', label: 'Subtitle', kind: 'text', wide: true },
  { key: 'description', label: 'Description', kind: 'textarea', wide: true },
  { key: 'start_scene_id', label: 'Start scene', kind: 'scene' },
  { key: 'max_players', label: 'Most players in one room', kind: 'number', min: 1, placeholder: 'No limit' },
  { key: 'default_language', label: 'Language', kind: 'text', placeholder: 'en-us' },
  { key: 'shortname', label: 'Short name', kind: 'text', hint: 'A readable name for the scenario. Players use its code, which you can change on the Publish page.' },
  { key: 'enable_save_session', label: 'Save each player’s progress between visits', kind: 'bool', default: true, wide: true },
  { key: 'require_login', label: 'Players must sign in (no guests)', kind: 'bool', default: true, wide: true },
  { key: 'allow_groups', label: 'Players can be split into groups, each in its own room', kind: 'bool', wide: true },
  { key: 'intro_media_landscape_id', label: 'Intro image (landscape)', kind: 'media', mediaType: 'image' },
  { key: 'intro_media_portrait_id', label: 'Intro image (portrait)', kind: 'media', mediaType: 'image' },
];

/** Kept in the scenario's `settings` column. */
export const SCENARIO_SETTINGS_FIELDS: Field[] = [
  { key: 'music_media_id', label: 'Background music', kind: 'media', mediaType: 'audio', hint: 'Plays in every scene that does not have its own. Events can change it with an Audio action marked as background music.' },
  { key: 'music_volume', label: 'Music volume (0 to 1)', kind: 'number', min: 0, max: 1, step: 0.05, placeholder: '0.5', slider: { min: 0, max: 1 } },
  {
    key: 'visibility', label: 'Who can play it', kind: 'select', placeholder: 'Everyone: it is on every player’s missions page', wide: true,
    options: [['public', 'Everyone: it is on every player’s missions page'], ['private', 'Only students it is assigned to']],
    hint: 'A private mission is run by a teacher: it appears only for the students it was assigned to on the Classes page, and only its owner can assign it. This applies as soon as it is changed, without publishing.',
  },
  {
    key: 'tier', label: 'Free or curricular', kind: 'select', placeholder: 'Free: anyone can play it', wide: true,
    options: [['free', 'Free: anyone can play it'], ['curricular', 'Curricular: it comes with a teacher plan']],
    hint: 'Curricular missions are what the teacher plans sell: teachers with a plan (and their students, through assignments) can play them. Only administrators set this.',
  },
  { key: 'chat_mode', label: 'Chat', kind: 'select', placeholder: 'Emotes only', options: [['off', 'Off'], ['emotes', 'Emotes only'], ['free', 'Typed messages (filtered)']] },
  {
    key: 'private_messages', label: 'Players can send each other private messages', kind: 'bool', wide: true,
    hint: 'A typed message for one other player, wherever in the scenario they are. Private messages are filtered like chat, and every message, private or not, is kept: a teacher can read them on the Classes page.',
  },
  {
    key: 'narration', label: 'Read text aloud', kind: 'select', placeholder: 'Only where an action says so', options: [['on', 'Everything: dialogue, infoboxes and text overlays'], ['off', 'Only where an action says so']], wide: true,
    hint: 'The browser’s own voice reads the text and highlights each word as it is spoken. It needs no recordings. Any action can say otherwise for itself, and players can switch it off.',
  },
  { key: 'move_speed', label: 'Walking speed (px per second)', kind: 'number', min: 50, placeholder: '420', slider: { min: 50, max: 1000, step: 10 } },
  { key: 'asset_base_url', label: 'Base address for media', kind: 'text', wide: true, hint: 'Media whose address is not absolute is loaded from here. Uploaded files do not need it.' },
];

// --------------------------------------------------------------------- scene

export const SCENE_FIELDS: Field[] = [
  { key: 'shortname', label: 'Short name', kind: 'text' },
  { key: 'subtitle', label: 'Subtitle', kind: 'text' },
  { key: 'description', label: 'Description', kind: 'textarea', wide: true },
  { key: 'width', label: 'Width (px)', kind: 'number', min: 1, placeholder: 'Background width', hint: 'A scene wider or taller than the screen scrolls as the avatar walks.' },
  { key: 'height', label: 'Height (px)', kind: 'number', min: 1, placeholder: 'Background height' },
  { key: 'zoom', label: 'Zoom', kind: 'number', min: 0.1, step: 0.05, placeholder: '1', slider: { min: 0.25, max: 3 } },
  { key: 'group_id', label: 'Group', kind: 'group', placeholder: 'None', hint: 'Scenes that belong together: the rooms of the starship, the places on a planet. Groups are made on the Scenes page.' },
  { key: 'show_avatars', label: 'Show avatars', kind: 'bool', default: true },
  { key: 'is_intro_scene', label: 'Intro scene', kind: 'bool' },
];

/** Kept in the scene's `params` column. */
export const SCENE_MUSIC_FIELDS: Field[] = [
  { key: 'music_media_id', label: 'Background music for this scene', kind: 'media', mediaType: 'audio', hint: 'Leave empty to use the scenario’s music (Settings).' },
  { key: 'music_volume', label: 'Music volume (0 to 1)', kind: 'number', min: 0, max: 1, step: 0.05, placeholder: 'The scenario’s', slider: { min: 0, max: 1 } },
  {
    key: 'team_only', label: 'Who players see here', kind: 'tristate', wide: true, placeholder: 'As the scene’s group says (everyone, if it has none)',
    options: [['true', 'Only their own team'], ['false', 'Everyone playing, whatever their team']],
    hint: 'When a teacher puts students into teams, a scene limited to teams shows each player only their teammates, so a small room does not feel crowded. A meeting place such as an observation deck shows everyone. Shared variables and items are always the team’s own.',
  },
];

/** A patch of shade on the floor: figures walking through it darken, most at its centre. */
export const SHADOW_SPOT_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'x', label: 'Centre X', kind: 'number' },
  { key: 'y', label: 'Centre Y', kind: 'number' },
  { key: 'radius', label: 'Radius (px)', kind: 'number', min: 1, hint: 'How far the shade reaches across.', slider: { min: 1, max: 'scene' } },
  { key: 'radius_y', label: 'Radius up and down (px)', kind: 'number', min: 1, placeholder: 'The same', slider: { min: 1, max: 'scene' }, hint: 'Smaller than the radius for a shadow lying on the floor, seen at an angle.' },
  { key: 'strength', label: 'Darkness at the centre (%)', kind: 'number', min: 0, max: 100, placeholder: '60', slider: { min: 0, max: 100 }, wide: true, hint: 'A figure at the centre is darkened by this much; towards the edge the shade fades to nothing. Put spots where the picture already shows shade: under a tree, behind a pillar, in a doorway.' },
];

/** A background or foreground layer (docs/src/content/docs/developers/extensions.md). */
export const LAYER_FIELDS: Field[] = [
  { key: 'media_id', label: 'Image', kind: 'media', mediaType: 'image', wide: true },
  { key: 'position_x', label: 'X', kind: 'number', placeholder: '0' },
  { key: 'position_y', label: 'Y', kind: 'number', placeholder: '0' },
  { key: 'display_width', label: 'Shown width (px)', kind: 'number', min: 1, placeholder: 'Scene width', hint: 'Empty: the image is stretched to the size of the scene.' },
  { key: 'display_height', label: 'Shown height (px)', kind: 'number', min: 1, placeholder: 'Scene height' },
  { key: 'tile', label: 'Repeat the image at its own size instead of stretching it', kind: 'bool', wide: true },
  { key: 'scroll_speed_x', label: 'Drift right (px per second)', kind: 'number', placeholder: '0', slider: { min: -200, max: 200 }, hint: 'For repeated images: clouds, water, stars. Negative drifts left.' },
  { key: 'scroll_speed_y', label: 'Drift down (px per second)', kind: 'number', placeholder: '0', slider: { min: -200, max: 200 } },
  { key: 'parallax', label: 'Parallax', kind: 'number', min: 0, step: 0.05, placeholder: '1', slider: { min: 0, max: 2 }, hint: '1 moves with the scene. Less than 1 moves slower, as if far away; 0 stays put on the screen. More than 1 moves faster, for a foreground close to the viewer.', wide: true },
];

export const SPAWN_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', hint: '"default" is where players arrive when no spawn point is named.' },
  { key: 'facing', label: 'Facing', kind: 'select', placeholder: 'Right', options: [['left', 'Left'], ['right', 'Right']] },
  ...position,
];

/** A box in which things are drawn smaller or larger depending on how far up it they stand. */
export const SCALE_AREA_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'scale_top', label: 'Size at the top edge (%)', kind: 'number', min: 1, slider: { min: 10, max: 200 }, hint: '100 is normal size. 50 draws things half size, as if far away.' },
  { key: 'scale_bottom', label: 'Size at the bottom edge (%)', kind: 'number', min: 1, slider: { min: 10, max: 200 }, hint: 'In between, the size changes evenly from one to the other.' },
  { key: 'speed_effect', label: 'Walking speed follows size (%)', kind: 'number', min: 0, max: 100, placeholder: '100', slider: { min: 0, max: 100 }, wide: true, hint: '100: one to one, so a half-size figure walks at half speed. 0: speed is not affected. Around 50 to 70 lets distant figures cover ground a little faster without looking like they are racing.' },
  { key: 'x', label: 'Left', kind: 'number' },
  { key: 'y', label: 'Top', kind: 'number' },
  { key: 'width', label: 'Width', kind: 'number', min: 1 },
  { key: 'height', label: 'Height', kind: 'number', min: 1 },
];

export const ITEM_PLACEMENT_FIELDS: Field[] = [{ key: 'item_id', label: 'Item', kind: 'item', wide: true }, ...position];

export const CHARACTER_PLACEMENT_FIELDS: Field[] = [
  { key: 'character_id', label: 'Character', kind: 'character', wide: true },
  ...position,
  { key: 'facing', label: 'Facing', kind: 'select', placeholder: 'Right', options: [['left', 'Left'], ['right', 'Right']] },
  { key: 'event_id', label: 'When clicked, run', kind: 'event', eventKinds: ['indirect'], placeholder: 'Nothing', hint: 'An indirect event of this scene.' },
];

// --------------------------------------------------------------------- events

export const EVENT_FIELDS: Field[] = [
  { key: 'shortname', label: 'Name', kind: 'text', wide: true },
  { key: 'overridable', label: 'Another event may interrupt this one', kind: 'bool', wide: true },
  { key: 'block_hotspots', label: 'Hotspots do nothing while this runs', kind: 'bool', wide: true },
  {
    key: 'audience', label: 'Who sees it', kind: 'select', wide: true,
    options: [['player', 'Only the player who sets it off'], ['scene', 'Everyone in the scene']],
    hint: 'Everyone in the scene: the other players there see and hear its pictures, text, sounds, video and dialogue as they happen. What the event does stays the player’s own: variables, awards, jumps, freezing and infoboxes. A conversation with a character is usually for one player; a rockfall is for everyone.',
  },
];

export const HOTSPOT_FIELDS: Field[] = [
  {
    key: 'activate_by_trigger', label: 'Fires when', kind: 'select', wide: true,
    options: [['true', 'A player clicks or taps inside it'], ['false', 'A player’s avatar walks into it']],
  },
  { key: 'position_x', label: 'X', kind: 'number', placeholder: 'Whole width', hint: 'Empty: the hotspot spans the whole width, for a top or bottom edge.' },
  { key: 'position_y', label: 'Y', kind: 'number', placeholder: 'Whole height', hint: 'Empty: the hotspot spans the whole height, for a left or right edge.' },
  { key: 'radius', label: 'Radius (px)', kind: 'number', min: -1, slider: { min: 1, max: 'scene' }, hint: '-1 covers the whole scene.' },
  { key: 'once', label: 'Walk-in only: fire once per visit to the scene', kind: 'bool', wide: true },
  { key: 'reveal_radius', label: 'Appears within (px)', kind: 'number', min: 1, placeholder: 'Always there', slider: { min: 1, max: 'scene' }, hint: 'The hotspot is invisible and cannot be clicked until the player’s avatar is this close. Drawn as the outer dashed ring.' },
  { key: 'reveal_full_radius', label: 'Fully visible within (px)', kind: 'number', min: 0, placeholder: 'Half of that', slider: { min: 0, max: 'scene' }, hint: 'Between the two distances its labels fade in and out. The inner dashed ring.' },
];

export const LABEL_FIELDS: Field[] = [
  { key: 'type', label: 'Kind', kind: 'select', structural: true, options: [['text', 'Text'], ['image', 'Image'], ['spritemap', 'Spritemap']] },
  ...position,
  ...scale,
  {
    key: 'placement', label: 'Where it stands', kind: 'select', wide: true, placeholder: 'Background: players are always in front of it',
    options: [
      ['background', 'Background: players are always in front of it'],
      ['object', 'Object: players walk behind it and in front of it'],
      ['front', 'In front of everything, players included'],
    ],
    hint: 'A label is behind the players unless you choose otherwise, wherever they walk. An object stands on its bottom edge: a player lower on the screen is drawn in front of it, one higher up behind it.',
  },
];
/** For pictures that are objects: whether players have to walk around them. Kept in the label's params. */
export const LABEL_SOLID: Field[] = [
  { key: 'solid', label: 'Solid: players walk around it', kind: 'bool', structural: true, hint: 'Players cannot walk through it and are led around it. It stops being in the way when its hotspot’s conditions no longer hold (a rock that has been cleared). How it is drawn is still “Where it stands”.' },
  { key: 'solid_radius', label: 'Size of the obstacle (px)', kind: 'number', min: 1, placeholder: 'A third of its width', slider: { min: 1, max: 300 }, hint: 'The radius of the circle at its base that cannot be walked on.' },
];
export const LABEL_TEXT: Field = { key: 'text', label: 'Text', kind: 'text', wide: true };
export const LABEL_MEDIA: Field = { key: 'media_id', label: 'Image', kind: 'media', mediaType: 'image', wide: true };
export const LABEL_SPRITEMAP: Field[] = spritemap;

// ------------------------------------------------------------------- library

export const MEDIA_FIELDS: Field[] = [
  { key: 'filename', label: 'Name', kind: 'text', wide: true },
  { key: 'url', label: 'Address', kind: 'text', wide: true, hint: 'A full address, or a path under the scenario’s base address for media.' },
  { key: 'type', label: 'Type', kind: 'select', options: [['image', 'Image'], ['audio', 'Audio'], ['video', 'Video']] },
  { key: 'priority', label: 'Load order', kind: 'number', placeholder: '100', hint: 'Lower numbers load first.' },
  ...scale,
  { key: 'width', label: 'Width (px)', kind: 'number', min: 1 },
  { key: 'height', label: 'Height (px)', kind: 'number', min: 1 },
];

export const VARIABLE_FIELDS: Field[] = [
  { key: 'variable_name', label: 'Name', kind: 'text', hint: 'Renaming does not update the conditions and actions that use it.' },
  { key: 'default_value', label: 'Starting value', kind: 'value' },
  {
    key: 'scope', label: 'Whose it is', kind: 'select', structural: true,
    options: [['player', 'Each player has their own'], ['room', 'Shared: one value for everyone playing together']],
  },
  { key: 'persist', label: 'Kept between visits', kind: 'bool', default: true, hint: 'A player’s own variable is kept with their save. A shared one is kept with the group’s game, so it is still set when they come back.' },
];

export const ITEM_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'media_id', label: 'Image', kind: 'media', mediaType: 'image' },
  { key: 'unique', label: 'Unique: only one player can hold it', kind: 'bool', wide: true },
  { key: 'physical', label: 'Physical: it sits in the scene', kind: 'bool', wide: true },
  { key: 'blocking', label: 'Blocking: avatars walk around it', kind: 'bool', wide: true },
  { key: 'wearable', label: 'Wearable', kind: 'bool' },
  { key: 'vehicle', label: 'Vehicle', kind: 'bool', hint: 'A vehicle is always one object: it goes where it is driven, stays where it is left, and anyone can then use it.' },
];

/** Kept in the item's `settings` column. */
export const ITEM_SETTINGS_FIELDS: Field[] = [
  { key: 'scale', label: 'Image scale', kind: 'number', min: 0.01, step: 0.05, placeholder: '1', slider: { min: 0.1, max: 3 } },
  {
    key: 'placement', label: 'Where it stands', kind: 'select', placeholder: 'An object: players walk behind and in front of it',
    options: [['object', 'An object: players walk behind and in front of it'], ['background', 'On the floor: players always walk over it']],
  },
  { key: 'blocking_radius', label: 'Blocking radius (px)', kind: 'number', min: 1, placeholder: 'A third of its width', slider: { min: 1, max: 300 } },
  { key: 'attach_offset_x', label: 'Worn or ridden: offset X', kind: 'number', placeholder: '0' },
  { key: 'attach_offset_y', label: 'Offset Y', kind: 'number', placeholder: '0' },
  { key: 'attach_layer', label: 'Drawn', kind: 'select', placeholder: 'In front of the avatar', options: [['front', 'In front of the avatar'], ['behind', 'Behind the avatar']] },
  { key: 'art_faces', label: 'The artwork faces', kind: 'select', placeholder: 'Right', options: [['left', 'Left'], ['right', 'Right']] },
  {
    key: 'hide_rider_below', label: 'Hide the avatar below', kind: 'number', min: 0, max: 1, step: 0.05, placeholder: 'Show the whole avatar', slider: { min: 0, max: 1 },
    hint: 'How far down the item’s picture the avatar stops being drawn: 0 is the top of the picture, 1 the bottom. Use it so a rider sits in a UFO or a car instead of their legs showing beneath it.',
  },
  { key: 'speed_multiplier', label: 'Vehicle speed multiplier', kind: 'number', min: 0.1, step: 0.1, placeholder: '1.5', slider: { min: 0.1, max: 4 } },
];

/** Something this scenario sells in the marketplace, besides the platform's items. */
export const SHOP_ITEM_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'price', label: 'Price (stars)', kind: 'number', min: 0, step: 1 },
  { key: 'description', label: 'Description', kind: 'text', wide: true },
  { key: 'kind', label: 'Kind', kind: 'select', structural: true, options: [['wearable', 'Something to wear'], ['pet', 'A pet that follows the avatar'], ['animation', 'A way of standing'], ['move', 'A move: a button on the player’s screen'], ['ability', 'An ability']] },
  { key: 'media_id', label: 'Picture', kind: 'media', mediaType: 'image' },
  { key: 'active', label: 'On sale', kind: 'bool', default: true, wide: true, hint: 'Take an item off sale instead of deleting it: players who bought it keep it.' },
];
/** Kept in the shop item's `settings` column; which apply depends on the kind. */
export const SHOP_WEARABLE_FIELDS: Field[] = [
  { key: 'scale', label: 'Size (of the avatar’s height)', kind: 'number', min: 0.02, step: 0.02, placeholder: '0.3', slider: { min: 0.02, max: 1.5 }, hint: '0.3 makes it 30% as tall as the avatar, whatever size the avatar is.' },
  { key: 'offset_x', label: 'Nudge forward', kind: 'number', step: 0.02, placeholder: '0', slider: { min: -1, max: 1 } },
  { key: 'offset_y', label: 'Nudge down', kind: 'number', step: 0.02, placeholder: '0', slider: { min: -1, max: 1 } },
];
export const SHOP_SLOT: Field = { key: 'slot', label: 'Worn on', kind: 'select', options: [['head', 'Head'], ['body', 'Body'], ['back', 'Back'], ['hand', 'Hand']], hint: 'One item per place can be worn at a time.' };
export const SHOP_ANIMATION: Field = { key: 'animation', label: 'Movement', kind: 'select', options: [['bounce', 'Bounce'], ['float', 'Float'], ['sway', 'Sway'], ['pulse', 'Pulse']] };
export const SHOP_MOVE: Field = { key: 'move', label: 'Animation', kind: 'animation', hint: 'What the button plays: a built-in move (jump, spin, crouch, wave, dance), or a name avatars’ sprite sheets define. Bought here, it is only sold in this scenario, but once owned it works in every scenario.' };
export const SHOP_ABILITY: Field = { key: 'ability', label: 'Ability key', kind: 'text', placeholder: 'translator', hint: 'While a player has this ability equipped, the variable QBLAbility_<key> is 1. Use it in conditions to offer them something extra: a hidden hotspot, a translated sign, a shortcut.' };

export const CHARACTER_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
];
export const CHARACTER_SETTINGS_FIELDS: Field[] = [
  { key: 'scale', label: 'Image scale', kind: 'number', min: 0.01, step: 0.05, placeholder: '1', slider: { min: 0.1, max: 3 } },
  { key: 'voice_pitch', label: 'Voice: pitch (0 to 2)', kind: 'number', min: 0, max: 2, step: 0.1, placeholder: '1', slider: { min: 0, max: 2 }, hint: 'How the character sounds when its lines are read aloud. Lower is deeper.' },
  { key: 'voice_rate', label: 'Voice: pace (0.5 to 2)', kind: 'number', min: 0.5, max: 2, step: 0.1, placeholder: '1', slider: { min: 0.5, max: 2 } },
  { key: 'voice_name', label: 'Voice: prefer one called', kind: 'text', placeholder: 'Any', hint: 'Part of the name of a voice on the player’s device, such as “female”, “Daniel” or “Google UK”. Devices differ: where no voice matches, the default one reads.' },
];

/** Something players can do from a button on their screen while its conditions hold. */
export const MOVE_FIELDS: Field[] = [
  { key: 'animation', label: 'Animation', kind: 'animation', hint: 'A built-in move (jump, spin, crouch, wave, dance), or a name from the avatars’ sprite sheets. An avatar that has frames drawn for it plays them; any other makes the built-in move, if there is one of that name.' },
  { key: 'label', label: 'On the button', kind: 'text', placeholder: 'The animation’s name' },
  { key: 'icon', label: 'Icon', kind: 'text', placeholder: '✨' },
];

export const OBJECTIVE_FIELDS: Field[] = [
  { key: 'text', label: 'Text', kind: 'text', wide: true, hint: 'Use {{variable_name}} to show progress, e.g. Collect samples ({{samples}}/3).' },
  { key: 'optional', label: 'Bonus: not needed to finish', kind: 'bool', wide: true },
];
