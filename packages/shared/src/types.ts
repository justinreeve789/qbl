/**
 * QBL scenario JSON types.
 *
 * Fields documented in the original QBL JSON docs keep their names and
 * meaning. Fields marked [ext] are extensions added for the walk-around
 * multiplayer runtime; they are all optional and documented in
 * docs/src/content/docs/developers/extensions.md.
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
  /**
   * [ext] The picture is a sprite sheet: a grid of equal frames, numbered from 0 at the top left,
   * left to right and then down (as on the Spritemaps page).
   */
  sheet?: MediaSheet;
  /** [ext] Named animations over the sheet's frames. Anything drawn with this media can play them. */
  animations?: MediaAnimation[];
  /**
   * [ext] The picture is an animated PNG: how many frames it has and how long one pass takes, as
   * the file says. Set when the file is uploaded. The game cuts it into frames as it loads, so it
   * plays like a sprite sheet whose animation is the whole file.
   */
  apng?: MediaApng;
  /** [ext] Pixel size of the file, when known. */
  width?: number;
  height?: number;
}

/** [ext] What an animated PNG holds. */
export interface MediaApng {
  frames: number;
  /** Milliseconds one pass of every frame takes, at the file's own speed. */
  duration: number;
  /** How many times the file says to play: 0 is forever. */
  plays?: number;
}

// ----------------------------------------------------------- animations

/** [ext] How a sprite sheet is cut into frames. */
export interface MediaSheet {
  /** Frames across. */
  columns: number;
  /** Frames down. */
  rows: number;
  /** How many frames there are, when the last row is not full. Default columns x rows. */
  count?: number;
}

/** How many frames a picture has: a sheet's or an animated PNG's, or 1 for a still picture. */
export function frameCount(media: Pick<Media, 'sheet' | 'apng'> | null | undefined): number {
  if (media?.sheet) return Math.max(1, media.sheet.count ?? media.sheet.columns * media.sheet.rows);
  if (media?.apng) return Math.max(1, media.apng.frames);
  return 1;
}

/**
 * [ext] One animation on a sprite sheet. A few names have a meaning of their own: `idle` plays
 * while the figure stands, `walk` while it moves (mirrored for the other direction unless
 * `walk_left` and `walk_right` are given). Any other name (`jump`, `dance`...) is played when
 * an `animate` action or the player asks for it.
 */
export interface MediaAnimation {
  name: string;
  /** Frame numbers, in the order they are shown. A frame may appear more than once. */
  frames: number[];
  /** Milliseconds one pass takes. Default: 100 per frame. */
  duration?: number;
  /** Play again from the start when it ends. Default: true for idle and the walks, false for everything else. */
  repeat?: boolean;
}

/** Animations a figure plays by itself. */
export const AUTOMATIC_ANIMATIONS = ['idle', 'walk', 'walk_left', 'walk_right'] as const;

/**
 * Moves every figure can make, sheet or no sheet: the picture itself hops, turns, ducks, sways
 * or waves. A sheet animation with the same name is played instead when the figure has one.
 */
export const BUILT_IN_MOVES: Record<string, { label: string; icon: string; duration: number; repeat: boolean }> = {
  jump: { label: 'Jump', icon: '⤴️', duration: 600, repeat: false },
  spin: { label: 'Spin', icon: '🌀', duration: 700, repeat: false },
  crouch: { label: 'Crouch', icon: '⤵️', duration: 900, repeat: false },
  wave: { label: 'Wave', icon: '👋', duration: 1200, repeat: false },
  dance: { label: 'Dance', icon: '💃', duration: 1600, repeat: true },
};

export const ANIMATION_NAME = /^[a-z][a-z0-9_]{0,31}$/;

/** The animation of that name on a media's sheet, if it has one. */
export function findAnimation(media: Pick<Media, 'sheet' | 'animations'> | null | undefined, name: string): MediaAnimation | undefined {
  return media?.sheet ? media.animations?.find((a) => a.name === name) : undefined;
}

/** Whether an animation loops: as it says, or else by its name. */
export function animationRepeats(animation: Pick<MediaAnimation, 'name' | 'repeat'>): boolean {
  return animation.repeat ?? ((AUTOMATIC_ANIMATIONS as readonly string[]).includes(animation.name) || BUILT_IN_MOVES[animation.name]?.repeat === true);
}

/**
 * Which animation a figure shows while standing or walking, and whether the picture is mirrored
 * for it. `faces` is the way the art looks (default right). Null: the sheet has nothing for
 * this, so the figure keeps its current frame.
 */
export function automaticAnimation(
  media: Pick<Media, 'sheet' | 'animations'> | null | undefined, moving: boolean, facing: 'left' | 'right', faces: 'left' | 'right' = 'right',
): { name: string | null; flip: boolean } {
  const has = (name: string) => findAnimation(media, name) !== undefined;
  const mirrored = facing !== faces;
  if (moving) {
    // A walk drawn for this direction is used as it is; otherwise the other one is mirrored.
    if (has(`walk_${facing}`)) return { name: `walk_${facing}`, flip: false };
    if (has('walk')) return { name: 'walk', flip: mirrored };
    const other = facing === 'left' ? 'walk_right' : 'walk_left';
    if (has(other)) return { name: other, flip: true };
  }
  return { name: has('idle') ? 'idle' : null, flip: mirrored };
}

/**
 * [ext] Something a player can do whenever they like, from a button on their screen: jump,
 * crouch, dance. Shown while its conditions hold, so a scenario can teach a move by setting a
 * variable. Moves bought in the marketplace are added to these and work in every scenario.
 */
export interface Move {
  /** The animation to play: one on the avatar's sheet, or a built-in move. */
  animation: string;
  label?: string;
  icon?: string;
  conditions?: Condition[];
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
  | 'glossary'
  | 'shop'
  | 'dialogue'
  | 'avatar'
  | 'animate'
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
/**
 * [ext] 'above' draws over avatars and foregrounds (default); 'sorted' depth-sorts with avatars by
 * position_y; 'behind' is part of the background: avatars always pass in front of it.
 */
export type WorldLayer = 'above' | 'sorted' | 'behind';

/**
 * [ext] Where something placed in a scene stands relative to the players.
 * `background`: it is part of the floor or the far wall, and players always walk in front of it
 * (a hotspot's icon, a rug, a marking). `object`: it is a thing standing in the scene, so a player
 * lower on the screen is drawn in front of it and one higher up behind it. `front`: it is drawn
 * over everything, as a sign floating above the scene (how text labels have always been drawn).
 */
export type Placement = 'background' | 'object' | 'front';

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
/**
 * [ext] Reading text aloud. `narrate` overrides the scenario's `narration` setting for one action.
 * `narration_media_id` is a recording to play instead of the browser's voice; the words are then
 * highlighted at an even pace over the recording's length.
 */
export interface Narrated {
  narrate?: boolean;
  narration_media_id?: Id;
}

export interface InfoboxAction extends ActionBase, Narrated {
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
export interface TextOverlayAction extends ActionBase, Narrated {
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
 * [ext] Play an animation on something in the scene: the player's avatar, a placed item or
 * vehicle, a placed character, or a picture another action is showing. `animation` is a name
 * from that thing's sprite sheet, or a built-in move. An empty name stops what is playing and
 * returns the figure to standing and walking.
 */
export interface AnimateAction extends ActionBase {
  type: 'animate';
  /** Default: the player. */
  target?: 'player' | 'item' | 'character' | 'action';
  item_id?: Id;
  character_id?: Id;
  /** For `target: "action"`: the id of an image_fixed or spritemap action that is showing. */
  target_id?: Id;
  animation: string;
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
export interface DialogueAction extends ActionBase, Narrated {
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
  /**
   * A badge that comes with the award: its name. A player earns each badge once, and it is shown
   * on their profile for the other players to see.
   */
  badge?: string;
  badge_description?: string;
  /** The badge's picture, one of the scenario's media. */
  badge_media_id?: Id;
}

/**
 * [ext] Add a word to the player's glossary. Words marked `initial` in the scenario are there from
 * the start; the others arrive through this action as the player meets them.
 */
export interface GlossaryAction extends ActionBase {
  type: 'glossary';
  /** The `id` of an entry in the scenario's `glossary`. */
  entry_id: Id | string;
  /** Add it without telling the player. */
  quiet?: boolean;
}

/** [ext] Open the marketplace, where the player spends stars and changes what their avatar wears. */
export interface ShopAction extends ActionBase {
  type: 'shop';
}

export type Action =
  | AnimateAction | AwardAction | GlossaryAction | ShopAction | DialogueAction | FreezeAction | AvatarAction | AudioAction | CancelAction | ImageFixedAction | ImageOverlayAction
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
  /**
   * [ext] Where the label stands relative to the players. Default: `background`, so players are
   * always drawn in front of it, wherever they walk. `object` sorts it among the players by its
   * bottom edge; `front` draws it over everything.
   */
  placement?: Placement;
  /**
   * [ext] Players cannot walk through it and are led around it. The obstacle is a circle at the
   * picture's base. It does not change how the label is drawn: that is `placement`.
   */
  solid?: boolean;
  /** [ext] Radius of that obstacle in scene pixels. Default: 35% of the picture's width. */
  solid_radius?: number;
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
export const SHOWN_TO_SCENE = ['audio', 'image_fixed', 'image_overlay', 'text_overlay', 'spritemap', 'video', 'dialogue', 'translate', 'cancel', 'animate'] as const;

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

export type ShopItemKind = 'wearable' | 'pet' | 'animation' | 'ability' | 'move';
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
  /** Moves: the animation the player can then play from their screen, in every scenario. */
  move?: string;
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
  /** Badges earned, newest first. */
  badges?: Badge[];
}

/** A badge a player earned through an award action. */
export interface Badge {
  name: string;
  description?: string;
  image_url?: string | null;
  /** The mission it was earned in. */
  scenario?: string;
  earned_at?: string;
}

/** What other players may see of a player: who they are, how they look and what they have achieved. */
export interface PlayerProfile {
  user_id: string;
  name: string;
  avatar_media_id?: Id | null;
  /** Ids of the marketplace items they have on. */
  look: Id[];
  stars: number;
  xp: number;
  rank: string;
  next_rank_xp?: number | null;
  badges: Badge[];
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
  /**
   * [ext] `object` (default): sorted among the players by where it stands, so they walk behind and
   * in front of it. `background`: it lies on the floor and players always walk over it.
   */
  placement?: 'object' | 'background';
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

/**
 * [ext] One of a character's animations: a still picture, an animated PNG, or a run of frames on a
 * sprite sheet. The picture is ordinary media, so one sheet can serve several characters, each
 * taking the frames it needs.
 */
export interface CharacterAnimation {
  /** The picture: an image, an animated PNG, or a sprite sheet (an image with `sheet`). */
  media_id: Id;
  /** Sheets and animated PNGs: frame numbers, in the order they are shown. Default: every frame. */
  frames?: number[];
  /** Milliseconds one pass takes. Default: an animated PNG's own speed, a sheet's `duration`, or 100 per frame. */
  duration?: number;
  /** Play again from the start when it ends. Default: true for the poses and looping moves, false for everything else. */
  repeat?: boolean;
  /** Draw the picture mirrored, so art drawn facing one way can serve the other. */
  flip?: boolean;
}

/**
 * [ext] Anyone who walks around a scene: a player's avatar or a character the scenario places (an
 * NPC). Both are drawn the same way, from their animations. Five of those have a meaning of their
 * own, the poses (CHARACTER_POSES): standing and walking each way, and the close-up shown in a story
 * box. Any other name (`jump`, `wave`, `dig`...) is played when an `animate` action or a move asks
 * for it. A pose that is missing is filled in from another one (see `resolvePose`), so a single
 * picture is enough to make a character.
 */
export interface Character {
  id: Id;
  name: string;
  /** Display scale of the pictures. Default 1. */
  scale?: number;
  /** By name: the poses, and any others. */
  animations?: Record<string, CharacterAnimation>;
  /** [ext] How the character sounds when its lines are read aloud: 0 to 2, 1 is the voice's own. */
  voice_pitch?: number;
  voice_rate?: number;
  /** [ext] Part of the name of a browser voice to prefer for this character, e.g. "female" or "Daniel". */
  voice_name?: string;
  params?: Params;
}

/** A character a scenario defines and places in its scenes. */
export interface Npc extends Character {
  scenario_id?: Id;
  /** The character is there only while these hold. */
  conditions?: Condition[];
  /**
   * [ext] Before animations: the character's picture. Read when `animations` is empty: a still
   * picture faces right; on a sprite sheet the media's `idle`, `walk`, `walk_left` and `walk_right`
   * become the poses and its other animations the character's.
   */
  media_id?: Id;
  /** [ext] Before animations: the close-up shown in portrait dialogue. Read when `animations` is empty. */
  portrait_media_id?: Id;
}

/**
 * [ext] An avatar players choose from. Avatars belong to the platform, not to a scenario, so a
 * player keeps theirs everywhere; the server adds the set, and the pictures it uses, to every
 * document it serves. A player's choice (`avatar_media_id` on their account, `avatar` in the room)
 * is an avatar's `id`.
 */
export interface AvatarCharacter extends Character {
  /** Set on avatars the platform supplies; absent on ones a document defines for itself. */
  platform?: boolean;
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

/**
 * [ext] A patch of shade: a circle (or, with `radius_y`, an ellipse lying on the floor). A figure
 * standing in it is darkened by up to `strength` percent at the centre, fading to nothing at the edge.
 */
export interface ShadowSpot {
  name?: string;
  x: number;
  y: number;
  radius: number;
  /** Vertical radius, for a shadow seen at an angle. Default: the same as `radius`. */
  radius_y?: number;
  /** How dark the centre is, 0 to 100. Default 60. */
  strength?: number;
}

/**
 * [ext] Scenes that belong together: the rooms of the starship, the places on one planet. A group
 * can say that its scenes show a player only their own team, which a scene may still override.
 */
export interface SceneGroup {
  id: Id;
  name: string;
  team_only?: boolean;
}

/** [ext] A word worth knowing, with what it means. Shown in the player's glossary once they have it. */
export interface GlossaryEntry {
  id: Id | string;
  term: string;
  definition: string;
  media_id?: Id | null;
  /** In the glossary from the start. Otherwise a `glossary` action adds it. */
  initial?: boolean;
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
  /** [ext] Patches of shade on the floor. A figure walking through one darkens, most at its centre. */
  shadow_spots?: ShadowSpot[];
  /**
   * [ext] Show a player only the members of their own team in this scene. Absent: as the scene's
   * group says (`scene_groups`), and failing that everyone playing is shown.
   */
  team_only?: boolean | null;
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
  characters?: Npc[];
  /** [ext] The avatars players can choose from. Normally the platform's, added as the document is served. */
  avatars?: AvatarCharacter[];
  /** [ext] Prefix for relative media urls. */
  asset_base_url?: string;
  /** [ext] default 'emotes' */
  chat_mode?: ChatMode;
  /** [ext] Avatar walking speed in scene pixels per second. Default 420. */
  move_speed?: number;
  /** [ext] Before `avatars`: media ids players can pick as their avatar. Read when `avatars` is absent. */
  avatar_media_ids?: Id[];
  /** [ext] What players can do from buttons on their screen while the conditions hold: jump, crouch, dance. */
  moves?: Move[];
  /** [ext] Before `avatars`: a close-up portrait for an avatar, by the avatar's media id. Read when `avatars` is absent. */
  avatar_portraits?: Record<string, Id>;
  /** [ext] The mission checklist. */
  objectives?: Objective[];
  /** [ext] Items this scenario sells in the marketplace, besides the platform's. */
  shop_items?: ShopItem[];
  /** [ext] Background music played in every scene that does not name its own. Events can still change it. */
  music_media_id?: Id | null;
  /** [ext] 0 to 1. Default 0.5. */
  music_volume?: number;
  /** [ext] Groups of scenes. A scene names its group with `group_id`. */
  scene_groups?: SceneGroup[];
  /** [ext] Words and their meanings. Players collect them as they play. */
  glossary?: GlossaryEntry[];
  /**
   * [ext] Read dialogue, infoboxes and text overlays aloud with the browser's voice, highlighting
   * each word as it is spoken. `on`: unless an action says otherwise. Default `off`: only actions
   * marked `narrate`. A player can always switch reading aloud off for themselves.
   */
  narration?: 'off' | 'on';
  /** [ext] Players may send typed messages to one other player. They are filtered and logged like chat. */
  private_messages?: boolean;
  /** [ext] Spec version this document was written against. */
  spec_version?: number;

  /** Save-game data for the requesting player, when there is any. */
  session?: Session | null;
  /**
   * The instance the requesting player is about to join, added when the document is served:
   * its group key, the room it belongs to and, for a team, the team's name.
   */
  instance?: { group: string; party: string; team_name?: string } | null;
}
