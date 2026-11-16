/**
 * QBL scenario JSON types.
 *
 * Fields documented in the original QBL JSON docs keep their names and
 * meaning. Fields marked [ext] are extensions added for the walk-around
 * multiplayer runtime; they are all optional and documented in
 * docs/docs/extensions.md.
 */

export type Id = number;
export type VarValue = string | number;
export type Params = Record<string, unknown>;

// ---------------------------------------------------------------- media

export type MediaType = 'audio' | 'image' | 'video';

export interface Media {
  id: Id;
  scenario_id?: Id;
  file_id?: Id | Id[];
  user_id?: Id;
  folder_id?: Id;
  type: MediaType;
  filename?: string;
  filepath?: string;
  /** Absolute URL, or a path relative to the scenario's asset_base_url. */
  url?: string | null;
  scale_x?: number;
  scale_y?: number;
  params?: Params;
  /** Lower numbers load first. Present on entries of scenario.assets. */
  priority?: number;
  /** [ext] Pixel size of the file, when known. */
  width?: number;
  height?: number;
}

// ------------------------------------------------------------ spritemap

export interface Spritemap {
  position_x?: number;
  position_y?: number;
  scale_x?: number;
  scale_y?: number;
  spritemap_tiles_num?: number;
  spritemap_tiles_horizontal?: number;
  spritemap_tiles_vertical?: number;
  spritemap_height?: number;
  spritemap_width?: number;
  spritemap_tile_sequence?: number[];
  spritemap_duration?: number;
  spritemap_repeat?: boolean;
  spritemap_show_first_as_fixed?: boolean;
}

// ----------------------------------------------------------- conditions

export type ConditionOperator = '=' | '!=' | '>' | '<' | '>=' | '<=';

export interface Condition {
  id?: Id;
  event_id?: Id;
  type?: 'variable';
  variable: string;
  operator: ConditionOperator;
  operand: VarValue;
}

// ------------------------------------------------------------ variables

export type VariableOperator = 'set' | '+' | '-' | '*' | '/' | '%' | 'random';
/** [ext] player = each player has their own value; room = shared by everyone in the instance. */
export type VariableScope = 'player' | 'room';

export interface Variable {
  id?: Id;
  scenario_id?: Id;
  variable_name: string;
  default_value: VarValue;
  /** [ext] default 'player' */
  scope?: VariableScope;
  /** [ext] default true. If false the value resets on every visit. */
  persist?: boolean;
}

// -------------------------------------------------------------- actions

export type ActionType =
  | 'award'
  | 'shop'
  | 'dialogue'
  | 'avatar'
  | 'freeze'
  | 'audio'
  | 'cancel'
  | 'image_fixed'
  | 'image_overlay'
  | 'infobox'
  | 'jump'
  | 'repeat'
  | 'run_event'
  | 'spritemap'
  | 'text_overlay'
  | 'translate'
  | 'variable'
  | 'video'
  | 'wait';

export type Alignment =
  | 'top left' | 'top center' | 'top right'
  | 'center left' | 'center center' | 'center right'
  | 'bottom left' | 'bottom center' | 'bottom right';

interface ActionBase {
  id: Id;
  event_id?: Id;
  sequence?: number;
  /** default true */
  blocking?: boolean;
  media_id?: Id;
  /** Conditions may be placed on single actions as well as events. */
  conditions?: Condition[];
}

export interface AudioAction extends ActionBase {
  type: 'audio';
  volume?: number;
  repeat?: boolean;
  /**
   * Keep playing across jumps: this is how background music is done. Only one
   * persistent track plays at a time. Starting another replaces it, unless it
   * is the same media, in which case the music simply carries on.
   */
  persist?: boolean;
}
export interface CancelAction extends ActionBase {
  type: 'cancel';
  action_id: Id;
}
/** [ext] 'above' draws over avatars and foregrounds (default); 'sorted' depth-sorts with avatars by position_y. */
export type WorldLayer = 'above' | 'sorted';

export interface ImageFixedAction extends ActionBase {
  type: 'image_fixed';
  position_x: number;
  position_y: number;
  scale_x?: number;
  scale_y?: number;
  duration?: number;
  layer?: WorldLayer;
}
export interface ImageOverlayAction extends ActionBase {
  type: 'image_overlay';
  alignment?: Alignment;
  scale_x?: number;
  scale_y?: number;
  duration?: number;
}
export interface CallToAction {
  /** Button label. May contain {{variable}} placeholders. */
  text: string;
  /** Action performed when the button is clicked or tapped. Needs no id. */
  action?: Omit<Action, 'id'> & { id?: Id };
  /** [ext] The button is only offered while these hold. */
  conditions?: Condition[];
}
export interface InfoboxAction extends ActionBase {
  type: 'infobox';
  /** HTML. May contain {{variable}} and {{media:ID}} placeholders. */
  content: string;
  call_to_actions?: CallToAction[] | null;
  /**
   * [ext] Default true. When false the box has no close button and cannot be
   * dismissed: the player must pick one of the buttons. Used for questions.
   */
  dismissible?: boolean;
}
export interface JumpAction extends ActionBase {
  type: 'jump';
  scene_id: Id;
  /** [ext] Named spawn point in the target scene. */
  spawn_point?: string;
}
export interface RepeatAction extends ActionBase {
  type: 'repeat';
}
export interface RunEventAction extends ActionBase {
  type: 'run_event';
  /** The event to run. `target_event_id` is accepted as an alias to avoid clashing with the parent event_id. */
  event_id?: Id;
  target_event_id?: Id;
}
export interface SpritemapAction extends ActionBase, Spritemap {
  type: 'spritemap';
  layer?: WorldLayer;
}
export interface TextOverlayAction extends ActionBase {
  type: 'text_overlay';
  text: string;
  alignment?: Alignment;
  text_font_size?: number;
  text_font_color?: string;
  text_font_style?: string;
  duration?: number;
}
export interface TranslateAction extends ActionBase {
  type: 'translate';
  target_id: Id;
  /** [ext] Any of these, when present, are tweened on the target over `duration` ms. */
  position_x?: number;
  position_y?: number;
  scale_x?: number;
  scale_y?: number;
  alpha?: number;
  duration?: number;
}
export interface VariableAction extends ActionBase {
  type: 'variable';
  name: string;
  operator: VariableOperator;
  operand?: VarValue;
}
export interface VideoAction extends ActionBase {
  type: 'video';
  alignment?: Alignment;
  scale_x?: number;
  scale_y?: number;
  volume?: number;
}
export interface WaitAction extends ActionBase {
  type: 'wait';
  duration: number;
}

/**
 * [ext] Show or hide the player's own avatar. Every player in the scene sees the change, because
 * it goes through the game server. Avatars are shown again whenever a player enters a scene, so a
 * scene that wants them hidden says so in a start event.
 */
export interface AvatarAction extends ActionBase {
  type: 'avatar';
  visible: boolean;
  /** Fade time in milliseconds. 0 or absent: at once. */
  duration?: number;
}

/**
 * [ext] Stop the player from walking, or let them walk again: for a conversation with a
 * character, a cutscene, a countdown. It lasts until a freeze action with `frozen: false`, or
 * until the event that froze the player ends, whichever comes first, so a player can never be
 * left stuck. Leaving the scene also ends it.
 */
export interface FreezeAction extends ActionBase {
  type: 'freeze';
  frozen: boolean;
}

/**
 * [ext] A speech bubble over whoever is speaking: the player's avatar, or a character placed in
 * the scene. The bubble keeps itself on screen: it sits above the speaker, moves below when the
 * speaker is near the top, and to one side when there is no room above or below.
 */
export interface DialogueAction extends ActionBase {
  type: 'dialogue';
  text: string;
  /** Who speaks. Default: the player. */
  speaker?: 'player' | 'character';
  /** For `speaker: "character"`: a character placed in this scene. */
  character_id?: Id;
  /** How long it stays, in milliseconds. Absent: long enough to read it. A click closes it sooner. */
  duration?: number;
  /**
   * `bubble` (default): a speech bubble over the speaker. `portrait`: a dialogue box across the
   * screen with the speaker's close-up portrait and name, for the characters and moments that
   * carry the story. A portrait box stays until the player clicks to continue, unless `duration` is set.
   */
  style?: 'bubble' | 'portrait';
}

/**
 * [ext] Give the player stars (currency) and/or XP (experience), or take them away with negative
 * numbers. Stars and XP belong to the player's account and carry across every scenario. The
 * game server grants each award action once per player, unless it is marked `repeatable`.
 */
export interface AwardAction extends ActionBase {
  type: 'award';
  stars?: number;
  xp?: number;
  /** Grant it every time the action runs, instead of once per player. */
  repeatable?: boolean;
  /** Shown to the player with the award, e.g. "Sample collected". */
  note?: string;
}

/** [ext] Open the marketplace, where the player spends stars and changes what their avatar wears. */
export interface ShopAction extends ActionBase {
  type: 'shop';
}

export type Action =
  | AwardAction | ShopAction | DialogueAction | FreezeAction | AvatarAction | AudioAction | CancelAction | ImageFixedAction | ImageOverlayAction
  | InfoboxAction | JumpAction | RepeatAction | RunEventAction
  | SpritemapAction | TextOverlayAction | TranslateAction
  | VariableAction | VideoAction | WaitAction;

// --------------------------------------------------------------- labels

export interface Label extends Spritemap {
  id?: Id;
  event_id?: Id;
  type: 'text' | 'image' | 'spritemap';
  position_x: number;
  position_y: number;
  scale_x?: number;
  scale_y?: number;
  text?: string | null;
  /** A media id, or an inline media object. */
  media?: Id | Media | null;
}

// --------------------------------------------------------------- events

export interface GameEvent {
  id: Id;
  shortname?: string;
  scene_id?: Id;
  /** If true, starting another event interrupts this one. Default false. */
  overridable?: boolean;
  block_hotspots?: boolean;
  /**
   * [ext] Who sees what this event shows. `player` (default): only the player who set it off.
   * `scene`: every player in the scene sees and hears its pictures, text, sounds and dialogue as
   * they happen. What an event *does* (variables, awards, jumps, infoboxes) is always the player's own.
   */
  audience?: EventAudience;
  conditions?: Condition[];
  actions: Action[];
}

export type EventAudience = 'player' | 'scene';

/** The action types other players are shown when an event's audience is the scene. */
export const SHOWN_TO_SCENE = ['audio', 'image_fixed', 'image_overlay', 'text_overlay', 'spritemap', 'video', 'dialogue', 'translate', 'cancel'] as const;

export interface Hotspot extends GameEvent {
  position_x?: number | null;
  position_y?: number | null;
  radius?: number;
  /** true: fires on click/tap inside the radius. false: fires when the avatar walks into the radius. */
  activate_by_trigger?: boolean;
  labels?: Label[];
  /** [ext] For walk-in hotspots: fire once per visit to the scene instead of on every entry. */
  once?: boolean;
  /**
   * [ext] The hotspot is only there when the player's avatar is near. Beyond this distance from its
   * position (scene pixels) its labels are invisible and it cannot be clicked. Absent: always there.
   */
  reveal_radius?: number | null;
  /**
   * [ext] The distance at which the hotspot is fully visible. Between here and `reveal_radius` its
   * labels fade in and out with the avatar's distance. Absent: half of `reveal_radius`.
   */
  reveal_full_radius?: number | null;
}

/**
 * [ext] A box of the scene with a size gradient. Whatever stands in it is drawn at `scale_top`
 * percent of its normal size at the box's top edge and `scale_bottom` percent at its bottom edge,
 * and in proportion in between: with 60 and 100, an avatar walking up the screen shrinks as if
 * walking away. It is separate from walkable areas so that it also covers things placed where
 * nobody can walk. Where boxes overlap, the first one listed applies.
 */
export interface ScaleArea {
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Percent of normal size at the top edge. 100 is unchanged. */
  scale_top: number;
  /** Percent of normal size at the bottom edge. */
  scale_bottom: number;
  /**
   * How much walking speed follows size, in percent. 100 (the default): one to one, so a figure
   * drawn at half size walks at half speed and looks right. 0: speed is not affected. In between,
   * distant figures cover ground a little faster than their size suggests, which saves players
   * time without looking like they are racing around.
   */
  speed_effect?: number;
}

// ------------------------------------------------- progression and shop

export type ShopItemKind = 'wearable' | 'pet' | 'animation' | 'ability';
export type WearableSlot = 'head' | 'body' | 'back' | 'hand';
/** Ways an avatar can move on the spot. */
export type AvatarAnimation = 'bounce' | 'sway' | 'pulse' | 'float';

/**
 * Something the marketplace sells for stars. Platform items are sold everywhere; a scenario's own
 * items (`scenario_id` set) are sold only in that scenario. What a player owns and has equipped
 * belongs to their account.
 */
export interface ShopItem {
  id: Id;
  scenario_id?: Id | null;
  name: string;
  description?: string;
  kind: ShopItemKind;
  price: number;
  /** Wearables: where it is worn. One item per slot can be equipped. */
  slot?: WearableSlot;
  /** Its picture: a media id of the scenario, or an address for platform items. */
  media_id?: Id | null;
  image_url?: string | null;
  /** Wearables and pets: size relative to the artwork, and where it sits relative to its slot. */
  scale?: number;
  offset_x?: number;
  offset_y?: number;
  /** Animations: how the avatar moves when this is equipped. */
  animation?: AvatarAnimation;
  /**
   * Abilities: a key scenarios can test. While equipped, the variable `QBLAbility_<key>` is 1,
   * so a condition can offer a shortcut, a translation or a hidden hotspot to players who have it.
   */
  ability?: string;
}

/** A player's stars, XP and rank, and what they own. */
export interface Progress {
  stars: number;
  xp: number;
  rank: string;
  /** XP at which the next rank starts; null at the top rank. */
  next_rank_xp: number | null;
  owned: Id[];
  equipped: Id[];
}

export interface Rank { xp: number; name: string }
export const DEFAULT_RANKS: Rank[] = [
  { xp: 0, name: 'Cadet' }, { xp: 100, name: 'Explorer' }, { xp: 300, name: 'Navigator' },
  { xp: 700, name: 'Specialist' }, { xp: 1500, name: 'Commander' }, { xp: 3000, name: 'Admiral' },
];

/** The rank for an XP total, and where the next one starts. */
export function rankFor(xp: number, ranks: Rank[] = DEFAULT_RANKS): { rank: string; next_rank_xp: number | null } {
  const sorted = [...ranks].sort((a, b) => a.xp - b.xp);
  let current = sorted[0] ?? { xp: 0, name: '' };
  for (const r of sorted) if (xp >= r.xp) current = r;
  const next = sorted.find((r) => r.xp > xp);
  return { rank: current.name, next_rank_xp: next ? next.xp : null };
}

// ----------------------------------------------------- items/characters

export interface Item {
  id: Id;
  scenario_id?: Id;
  name: string;
  unique?: boolean;
  physical?: boolean;
  blocking?: boolean;
  wearable?: boolean;
  vehicle?: boolean;
  conditions?: Condition[];
  /** [ext] Image shown for the item. */
  media_id?: Id;
  /** [ext] Display scale of the item image. */
  scale?: number;
  /** [ext] Radius used for blocking, in scene pixels. Defaults to a third of the displayed width. */
  blocking_radius?: number;
  /** [ext] Where the item sits relative to the avatar's feet while worn or ridden. */
  attach_offset_x?: number;
  attach_offset_y?: number;
  /** [ext] Draw the attached item in front of or behind the avatar. Default 'front'. */
  attach_layer?: 'front' | 'behind';
  /** [ext] Which way the item's artwork faces. It is mirrored to match the avatar. Default 'right'. */
  art_faces?: 'left' | 'right';
  /** [ext] Vehicles only: walking speed multiplier while riding. Default 1.5. */
  speed_multiplier?: number;
  params?: Params;
}

export interface Character {
  id: Id;
  scenario_id?: Id;
  name: string;
  conditions?: Condition[];
  /** [ext] */
  media_id?: Id;
  /** [ext] A close-up of the character's face, shown in portrait dialogue. */
  portrait_media_id?: Id;
  scale?: number;
  params?: Params;
}

// --------------------------------------------------------------- scenes

export interface Point { x: number; y: number }

/** [ext] A background or foreground layer. A bare media object is also accepted. */
export interface SceneLayer {
  media_id: Id;
  position_x?: number;
  position_y?: number;
  display_width?: number;
  display_height?: number;
  /** Repeat the image to fill the scene. */
  tile?: boolean;
  /** Pixels per second the tiled texture scrolls. */
  scroll_speed_x?: number;
  scroll_speed_y?: number;
  /** Camera scroll factor for parallax. 1 moves with the world, 0 is pinned to the screen. */
  parallax?: number;
}

export interface SpawnPoint {
  name: string;
  position_x: number;
  position_y: number;
  facing?: 'left' | 'right';
}

export interface ItemPlacement {
  item_id: Id;
  position_x: number;
  position_y: number;
}

export interface CharacterPlacement {
  character_id: Id;
  position_x: number;
  position_y: number;
  facing?: 'left' | 'right';
  /** Indirect event to run when the character is clicked. */
  event_id?: Id;
}

export interface Scene {
  id: Id;
  shortname?: string;
  scenario_id?: Id;
  sequence?: number;
  group_id?: Id;
  subtitle?: string;
  description?: string;
  user_id?: Id;
  locked_by?: Id | null;
  is_intro_scene?: boolean;
  background_media?: Array<SceneLayer | Media>;
  foreground_media?: Array<SceneLayer | Media>;
  zoom?: number;
  show_avatars?: boolean;
  params?: Params;
  start_events?: GameEvent[];
  end_events?: GameEvent[];
  hotspots?: Hotspot[];
  indirect_events?: GameEvent[];

  /** [ext] World size in pixels. Defaults to the first background's display size. */
  width?: number;
  height?: number;
  /** [ext] Polygons the avatar may stand in. If omitted the whole scene is walkable. */
  walkable_areas?: Point[][];
  /** [ext] Polygons carved out of the walkable areas. */
  blocked_areas?: Point[][];
  /** [ext] The spawn point named "default" is used when none is requested. */
  spawn_points?: SpawnPoint[];
  /** [ext] Background music for this scene, instead of the scenario's. */
  music_media_id?: Id | null;
  music_volume?: number;
  /** [ext] Boxes in which avatars, what they wear or ride, items and characters are drawn smaller or larger, for depth. */
  scale_areas?: ScaleArea[];
  items?: ItemPlacement[];
  characters?: CharacterPlacement[];
}

// ------------------------------------------------------------- scenario

/** [ext] off = no chat; emotes = emoji only; free = typed text (filtered server-side). */
export type ChatMode = 'off' | 'emotes' | 'free';

/**
 * [ext] One line of the mission checklist shown to the player. Objectives are
 * driven entirely by variables, so events move the mission along by changing
 * variables, exactly as they gate anything else.
 */
export interface Objective {
  id: Id | string;
  /** May contain {{variable}} placeholders, e.g. "Collect samples ({{samples}}/3)". */
  text: string;
  /** Listed only while these hold. Omit to always list it. */
  show_when?: Condition[];
  /** Ticked off while these hold. */
  complete_when: Condition[];
  /** Marked as a bonus: not needed to finish the mission. */
  optional?: boolean;
}

/** Save-game data from previous visits, delivered with the scenario. */
export interface Session {
  scene_id?: Id;
  position_x?: number;
  position_y?: number;
  /** Player-scoped variable values. */
  variables?: Record<string, VarValue>;
  /** Item ids currently worn or ridden. */
  attachments?: Id[];
  /** Ids of walk-in hotspots flagged `once` that have already fired, and similar one-shot markers. */
  flags?: string[];
  time_elapsed?: number;
  updated_at?: string;
}

export interface Scenario {
  id: Id;
  /** [ext] The unique 16-letter code players use to open the scenario: /{code}. */
  code?: string;
  shortname: string;
  title: string;
  subtitle?: string;
  description?: string;
  user_id?: Id;
  start_scene_id: Id;
  enable_save_session?: boolean;
  require_login?: boolean;
  allow_groups?: boolean;
  max_players?: number | null;
  default_language?: string;
  intro_media_portrait_id?: Id | null;
  intro_media_landscape_id?: Id | null;
  global_variables?: Variable[];
  /** scene id -> scene ids reachable from it. Generated when absent. */
  jump_targets?: Record<string, Id[]> | Array<{ scene_id: Id; targets: Id[] }>;
  assets?: Media[];
  scenes: Scene[];

  /** [ext] */
  items?: Item[];
  characters?: Character[];
  /** [ext] Prefix for relative media urls. */
  asset_base_url?: string;
  /** [ext] default 'emotes' */
  chat_mode?: ChatMode;
  /** [ext] Avatar walking speed in scene pixels per second. Default 420. */
  move_speed?: number;
  /** [ext] Media ids players can pick as their avatar. */
  avatar_media_ids?: Id[];
  /** [ext] A close-up portrait for an avatar, by the avatar's media id. Shown when the player speaks in portrait dialogue. */
  avatar_portraits?: Record<string, Id>;
  /** [ext] The mission checklist. */
  objectives?: Objective[];
  /** [ext] Items this scenario sells in the marketplace, besides the platform's. */
  shop_items?: ShopItem[];
  /** [ext] Background music played in every scene that does not name its own. Events can still change it. */
  music_media_id?: Id | null;
  /** [ext] 0 to 1. Default 0.5. */
  music_volume?: number;
  /** [ext] Spec version this document was written against. */
  spec_version?: number;

  /** Save-game data for the requesting player, when there is any. */
  session?: Session | null;
}
