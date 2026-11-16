import type { ActionType } from '@qbl/shared';
import type { Field } from './fields';

/**
 * What can be edited, as data. Each list here becomes a form. The attributes are the ones in
 * docs/docs (action.md, scene.md, event.md, ...) plus the extensions in docs/docs/extensions.md.
 */

const ALIGNMENTS = ['top left', 'top center', 'top right', 'center left', 'center center', 'center right', 'bottom left', 'bottom center', 'bottom right']
  .map((a) => [a, a] as const);

const position: Field[] = [
  { key: 'position_x', label: 'X', kind: 'number', hint: 'Scene pixels from the left. You can also drag the marker on the canvas.' },
  { key: 'position_y', label: 'Y', kind: 'number', hint: 'Scene pixels from the top.' },
];
const scale: Field[] = [
  { key: 'scale_x', label: 'Scale X', kind: 'number', placeholder: '1', step: 0.05 },
  { key: 'scale_y', label: 'Scale Y', kind: 'number', placeholder: '1', step: 0.05 },
];
const duration = (hint: string): Field => ({ key: 'duration', label: 'Duration (ms)', kind: 'number', min: 0, placeholder: 'Until cancelled', hint });
const layer: Field = {
  key: 'layer', label: 'Drawn', kind: 'select', placeholder: 'Above avatars',
  options: [['above', 'Above avatars'], ['sorted', 'Among avatars, by Y']],
};

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

export interface ActionDef {
  label: string;
  /** One sentence for the "add action" menu. */
  about: string;
  fields: Field[];
}

/** The fourteen action types of docs/docs/action.md. `media_id` and `blocking` are columns; the rest are params. */
export const ACTIONS: Record<ActionType, ActionDef> = {
  infobox: {
    label: 'Infobox',
    about: 'A box of text, with optional buttons.',
    fields: [
      { key: 'content', label: 'Content (HTML)', kind: 'html', wide: true, hint: 'Use {{variable_name}} to show a variable and {{media:ID}} for an image.' },
      { key: 'dismissible', label: 'Can be closed without choosing a button', kind: 'bool', default: true, wide: true },
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
      { key: 'volume', label: 'Volume (0 to 1)', kind: 'number', min: 0, max: 1, step: 0.05, placeholder: '1' },
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
      { key: 'text_font_size', label: 'Font size (px)', kind: 'number', min: 6 },
      { key: 'text_font_color', label: 'Color', kind: 'color' },
      { key: 'text_font_style', label: 'Style', kind: 'text', placeholder: 'bold, italic…' },
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
    fields: [{ key: 'media_id', label: 'Image', kind: 'media', mediaType: 'image', wide: true }, ...position, ...scale, duration('Leave empty to keep it until it is cancelled.'), layer],
  },
  spritemap: {
    label: 'Spritemap',
    about: 'An animated sprite sheet placed in the scene.',
    fields: [{ key: 'media_id', label: 'Sprite sheet', kind: 'media', mediaType: 'image', wide: true }, ...position, ...scale, ...spritemap, layer],
  },
  video: {
    label: 'Video',
    about: 'Play a video over the screen.',
    fields: [
      { key: 'media_id', label: 'Video', kind: 'media', mediaType: 'video', wide: true },
      { key: 'alignment', label: 'Where', kind: 'select', options: ALIGNMENTS, placeholder: 'center center' },
      { key: 'volume', label: 'Volume (0 to 1)', kind: 'number', min: 0, max: 1, step: 0.05, placeholder: '1' },
      ...scale,
    ],
  },
  freeze: {
    label: 'Freeze or release player',
    about: 'Stop the player from walking (while a character talks), or let them walk again.',
    fields: [
      { key: 'frozen', label: 'The player', kind: 'select', options: [['true', 'Cannot move'], ['false', 'Can move again']], wide: true, hint: 'A freeze ends at a “Can move again” action, when the event that froze the player finishes, or on leaving the scene, whichever comes first. Nobody can be left stuck.' },
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
  translate: {
    label: 'Translate',
    about: 'Move, resize or fade something another action is showing.',
    fields: [
      { key: 'target_id', label: 'Action to animate', kind: 'action', wide: true },
      { key: 'position_x', label: 'To X', kind: 'number' },
      { key: 'position_y', label: 'To Y', kind: 'number' },
      ...scale,
      { key: 'alpha', label: 'Opacity (0 to 1)', kind: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'duration', label: 'Over (ms)', kind: 'number', min: 0 },
    ],
  },
};

export const ACTION_TYPES = Object.keys(ACTIONS) as ActionType[];

/** An icon and a colour for each action type, by what kind of thing it does. */
const SAY = '#2f6fed', SHOW = '#8e5bd6', SOUND = '#0f9d8a', FLOW = '#c77b12', PLAYER = '#d6457a', STATE = '#3b8f4a';
export const ACTION_LOOK: Record<ActionType, readonly [icon: string, tone: string]> = {
  infobox: ['💬', SAY], text_overlay: ['🔤', SAY],
  image_overlay: ['🖼️', SHOW], image_fixed: ['📌', SHOW], spritemap: ['🎞️', SHOW], video: ['🎬', SHOW], translate: ['↔️', SHOW],
  audio: ['🔊', SOUND],
  jump: ['🚪', FLOW], wait: ['⏳', FLOW], run_event: ['▶️', FLOW], repeat: ['🔁', FLOW], cancel: ['✖️', FLOW],
  avatar: ['👤', PLAYER], freeze: ['✋', PLAYER],
  variable: ['🔢', STATE],
};

/** Attributes every action row has. */
export const ACTION_COMMON: Field[] = [
  { key: 'blocking', label: 'Wait for this to finish before the next action', kind: 'bool', default: true, wide: true },
];

/** Starting values for a new action of each type, so it is valid as soon as it is added. */
export function actionDefaults(type: ActionType): Record<string, unknown> {
  switch (type) {
    case 'freeze':
      return { frozen: true };
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
  { key: 'shortname', label: 'Short name', kind: 'text', hint: 'A readable name for the scenario. Players use the 16-letter code.' },
  { key: 'enable_save_session', label: 'Save each player’s progress between visits', kind: 'bool', default: true, wide: true },
  { key: 'require_login', label: 'Players must sign in (no guests)', kind: 'bool', default: true, wide: true },
  { key: 'allow_groups', label: 'Players can be split into groups, each in its own room', kind: 'bool', wide: true },
  { key: 'intro_media_landscape_id', label: 'Intro image (landscape)', kind: 'media', mediaType: 'image' },
  { key: 'intro_media_portrait_id', label: 'Intro image (portrait)', kind: 'media', mediaType: 'image' },
];

/** Kept in the scenario's `settings` column. */
export const SCENARIO_SETTINGS_FIELDS: Field[] = [
  { key: 'chat_mode', label: 'Chat', kind: 'select', placeholder: 'Emotes only', options: [['off', 'Off'], ['emotes', 'Emotes only'], ['free', 'Typed messages (filtered)']] },
  { key: 'move_speed', label: 'Walking speed (px per second)', kind: 'number', min: 50, placeholder: '420' },
  { key: 'asset_base_url', label: 'Base address for media', kind: 'text', wide: true, hint: 'Media whose address is not absolute is loaded from here. Uploaded files do not need it.' },
];

// --------------------------------------------------------------------- scene

export const SCENE_FIELDS: Field[] = [
  { key: 'shortname', label: 'Short name', kind: 'text' },
  { key: 'subtitle', label: 'Subtitle', kind: 'text' },
  { key: 'description', label: 'Description', kind: 'textarea', wide: true },
  { key: 'width', label: 'Width (px)', kind: 'number', min: 1, placeholder: 'Background width', hint: 'A scene wider or taller than the screen scrolls as the avatar walks.' },
  { key: 'height', label: 'Height (px)', kind: 'number', min: 1, placeholder: 'Background height' },
  { key: 'zoom', label: 'Zoom', kind: 'number', min: 0.1, step: 0.05, placeholder: '1' },
  { key: 'group_id', label: 'Group', kind: 'number', placeholder: 'None' },
  { key: 'show_avatars', label: 'Show avatars', kind: 'bool', default: true },
  { key: 'is_intro_scene', label: 'Intro scene', kind: 'bool' },
];

/** A background or foreground layer (docs/docs/extensions.md). */
export const LAYER_FIELDS: Field[] = [
  { key: 'media_id', label: 'Image', kind: 'media', mediaType: 'image', wide: true },
  { key: 'position_x', label: 'X', kind: 'number', placeholder: '0' },
  { key: 'position_y', label: 'Y', kind: 'number', placeholder: '0' },
  { key: 'display_width', label: 'Shown width (px)', kind: 'number', min: 1, placeholder: 'Scene width', hint: 'Empty: the image is stretched to the size of the scene.' },
  { key: 'display_height', label: 'Shown height (px)', kind: 'number', min: 1, placeholder: 'Scene height' },
  { key: 'tile', label: 'Repeat the image at its own size instead of stretching it', kind: 'bool', wide: true },
  { key: 'scroll_speed_x', label: 'Drift right (px per second)', kind: 'number', placeholder: '0', hint: 'For repeated images: clouds, water, stars. Negative drifts left.' },
  { key: 'scroll_speed_y', label: 'Drift down (px per second)', kind: 'number', placeholder: '0' },
  { key: 'parallax', label: 'Parallax', kind: 'number', min: 0, step: 0.05, placeholder: '1', hint: '1 moves with the scene. Less than 1 moves slower, as if far away. 0 stays put on the screen.', wide: true },
];

export const SPAWN_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', hint: '"default" is where players arrive when no spawn point is named.' },
  { key: 'facing', label: 'Facing', kind: 'select', placeholder: 'Right', options: [['left', 'Left'], ['right', 'Right']] },
  ...position,
];

/** A box in which things are drawn smaller or larger depending on how far up it they stand. */
export const SCALE_AREA_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'scale_top', label: 'Size at the top edge (%)', kind: 'number', min: 1, hint: '100 is normal size. 50 draws things half size, as if far away.' },
  { key: 'scale_bottom', label: 'Size at the bottom edge (%)', kind: 'number', min: 1, hint: 'In between, the size changes evenly from one to the other.' },
  { key: 'speed_effect', label: 'Walking speed follows size (%)', kind: 'number', min: 0, max: 100, placeholder: '100', wide: true, hint: '100: one to one, so a half-size figure walks at half speed. 0: speed is not affected. Around 50 to 70 lets distant figures cover ground a little faster without looking like they are racing.' },
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
];

export const HOTSPOT_FIELDS: Field[] = [
  {
    key: 'activate_by_trigger', label: 'Fires when', kind: 'select', wide: true,
    options: [['true', 'A player clicks or taps inside it'], ['false', 'A player’s avatar walks into it']],
  },
  { key: 'position_x', label: 'X', kind: 'number', placeholder: 'Whole width', hint: 'Empty: the hotspot spans the whole width, for a top or bottom edge.' },
  { key: 'position_y', label: 'Y', kind: 'number', placeholder: 'Whole height', hint: 'Empty: the hotspot spans the whole height, for a left or right edge.' },
  { key: 'radius', label: 'Radius (px)', kind: 'number', min: -1, hint: '-1 covers the whole scene.' },
  { key: 'once', label: 'Walk-in only: fire once per visit to the scene', kind: 'bool', wide: true },
  { key: 'reveal_radius', label: 'Appears within (px)', kind: 'number', min: 1, placeholder: 'Always there', hint: 'The hotspot is invisible and cannot be clicked until the player’s avatar is this close. Drawn as the outer dashed ring.' },
  { key: 'reveal_full_radius', label: 'Fully visible within (px)', kind: 'number', min: 0, placeholder: 'Half of that', hint: 'Between the two distances its labels fade in and out. The inner dashed ring.' },
];

export const LABEL_FIELDS: Field[] = [
  { key: 'type', label: 'Kind', kind: 'select', structural: true, options: [['text', 'Text'], ['image', 'Image'], ['spritemap', 'Spritemap']] },
  ...position,
  ...scale,
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
  { key: 'scope', label: 'Belongs to', kind: 'select', options: [['player', 'Each player'], ['room', 'Everyone in the room']] },
  { key: 'persist', label: 'Kept between visits', kind: 'bool', default: true },
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
  { key: 'scale', label: 'Image scale', kind: 'number', min: 0.01, step: 0.05, placeholder: '1' },
  { key: 'blocking_radius', label: 'Blocking radius (px)', kind: 'number', min: 1, placeholder: 'A third of its width' },
  { key: 'attach_offset_x', label: 'Worn or ridden: offset X', kind: 'number', placeholder: '0' },
  { key: 'attach_offset_y', label: 'Offset Y', kind: 'number', placeholder: '0' },
  { key: 'attach_layer', label: 'Drawn', kind: 'select', placeholder: 'In front of the avatar', options: [['front', 'In front of the avatar'], ['behind', 'Behind the avatar']] },
  { key: 'art_faces', label: 'The artwork faces', kind: 'select', placeholder: 'Right', options: [['left', 'Left'], ['right', 'Right']] },
  { key: 'speed_multiplier', label: 'Vehicle speed multiplier', kind: 'number', min: 0.1, step: 0.1, placeholder: '1.5' },
];

export const CHARACTER_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'media_id', label: 'Image', kind: 'media', mediaType: 'image' },
];
export const CHARACTER_SETTINGS_FIELDS: Field[] = [{ key: 'scale', label: 'Image scale', kind: 'number', min: 0.01, step: 0.05, placeholder: '1' }];

export const OBJECTIVE_FIELDS: Field[] = [
  { key: 'text', label: 'Text', kind: 'text', wide: true, hint: 'Use {{variable_name}} to show progress, e.g. Collect samples ({{samples}}/3).' },
  { key: 'optional', label: 'Bonus: not needed to finish', kind: 'bool', wide: true },
];
