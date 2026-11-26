/**
 * Messages exchanged between the Phaser client and the Colyseus room.
 * Continuous state (positions, attachments, shared variables) travels
 * through the synchronized room state instead; see apps/server/src/rooms/state.ts.
 */
import type { Badge, Progress } from './types.js';
import type { Id, Session, VarValue, VariableOperator, WalkAction } from './types.js';

export const ROOM_NAME = 'scenario';

/** Options sent with joinOrCreate. */
export interface JoinOptions {
  /** Scenario shortname. Rooms are matched on scenario + group. */
  scenario: string;
  /**
   * The instance the player plays in: their team's (`t7`), their assignment's (`a12`) or `public`.
   * Shared variables and save data belong to it.
   */
  group?: string;
  /**
   * The room to join: everyone with the same party is in one room, so the teams of one assignment
   * can meet in scenes that are not limited to a team. Default: the group, a room of its own.
   */
  party?: string;
  /** API bearer token. */
  token?: string;
  /**
   * Start in this scene instead of the saved one. Honoured for teachers and admins only: it is
   * how a teacher switching to another team arrives where that team is.
   */
  scene_id?: number;
  /** Display name for guests when the scenario does not require login. */
  name?: string;
  /** Media id of the chosen avatar. */
  avatar_media_id?: Id;
}

export const C2S = {
  Move: 'move',
  Scene: 'scene',
  Chat: 'chat',
  Emote: 'emote',
  Variable: 'var',
  Item: 'item',
  Progress: 'progress',
  Avatar: 'avatar',
  Award: 'award',
  Look: 'look',
  Show: 'show',
  Animate: 'animate',
  Whisper: 'whisper',
  Track: 'track',
  Walk: 'walk',
  Launch: 'launch',
} as const;

export const S2C = {
  Welcome: 'welcome',
  Chat: 'chat',
  Emote: 'emote',
  Snap: 'snap',
  Notice: 'notice',
  Progress: 'progress',
  Show: 'show',
  Whisper: 'whisper',
  Launch: 'launch',
} as const;

export interface MoveMessage { x: number; y: number; facing: 'left' | 'right' }
export interface SceneMessage { scene_id: Id; spawn_point?: string }
export interface ChatMessage { text: string }
export interface EmoteMessage { emoji: string }
export interface VariableMessage { name: string; operator: VariableOperator; operand?: VarValue }
export interface ItemMessage { item_id: Id; action: 'attach' | 'detach' }
/** An award action ran on the sender's side. The server checks it against the scenario before granting it. */
export interface AwardMessage { action_id: Id }
/** The server's answer to an award: the player's new totals, and what changed. */
export interface RewardMessage extends Progress { delta_stars: number; delta_xp: number; note?: string; rank_up?: boolean; badge?: Badge }
/**
 * An event whose audience is the scene reached one of its actions on the sender's side. The server
 * checks the action belongs to such an event in the sender's scene and passes it to the other players there.
 */
export interface ShowMessage { event_id: Id; action_id: Id }
/** Another player's event is showing this action. `session_id` is who set it off. */
export interface ShowBroadcast extends ShowMessage { session_id: string }
/** Play an animation on the sender's avatar, for everyone in their scene. An empty name stops it. */
export interface AnimateMessage { name: string }
/**
 * A walk action of the sender's event, aimed at a character that roams: the game server walks it,
 * for everyone. The server checks that the sender's scene has such a walk action. `ticket` is the
 * sender's name for this request: the character's `trip` carries it until it arrives.
 */
export interface WalkMessage extends Pick<WalkAction, 'character_id' | 'to' | 'position_x' | 'position_y' | 'spawn_point' | 'scene_id' | 'speed' | 'facing'> {
  ticket: string;
}
/**
 * A teacher (or admin) launches one of their assignments for the players in this room: the
 * students of that assignment who are here go into it, as does the teacher unless `stay`. With
 * `scene_id`, a scene of this scenario they are first taken to, which plays their departure and
 * ends with a travel action; without, they go straight there.
 */
export interface LaunchMessage { assignment_id: number; scene_id?: Id; stay?: boolean }
/**
 * To each player the launch sends: where they are going (the mission's code, its title, the instance
 * they play in), who sent them, and the departure scene, if any. The game server has already put
 * them in that scene; the player's game follows, and a travel action there takes them on.
 */
export interface LaunchBroadcast {
  code: string;
  title: string;
  group: string;
  by: string;
  /** The launcher scene the player was sent to first, if the teacher chose one. */
  scene_id?: Id;
  /** Where the launched scenario is played, on this site: `/{code}?group=…` (launchPath). */
  url?: string;
}

/** Show or hide the sender's avatar for everyone in their scene. */
export interface AvatarMessage { visible: boolean }
/** Sent periodically so the server can save player-scoped progress. */
export interface ProgressMessage {
  variables: Record<string, VarValue>;
  flags: string[];
  time_elapsed: number;
}

export interface WelcomeMessage {
  session_id: string;
  /** Authoritative save data: where to start and what the player had. */
  session: Session;
  chat_mode: 'off' | 'emotes' | 'free';
  /** The instance this player is in, and what it is called ("Red team") when it has a name. */
  team?: { key: string; name?: string };
  /** Players may send each other private messages here. */
  private_messages?: boolean;
}

/** A typed message for one other player, named by their session id. */
export interface WhisperMessage { to: string; text: string }
/** A private message as both ends receive it. */
export interface WhisperBroadcast { from: string; to: string; from_name: string; to_name: string; text: string; at: number }

/**
 * Something the player did, for the teacher's reports: a hotspot used, an answer chosen, an
 * objective completed, a word learned. Kept small; the server adds who, where and when.
 */
export interface TrackMessage {
  type: TrackType;
  /** The event, action, objective or glossary entry concerned. */
  ref?: string;
  /** A few words: the hotspot's name, the answer's text. */
  label?: string;
  value?: number;
}
export const TRACK_TYPES = ['hotspot', 'choice', 'objective', 'glossary', 'narration'] as const;
export type TrackType = (typeof TRACK_TYPES)[number];

/** One line of the activity log, as the game server hands it to the backend. */
export interface ActivityEntry {
  user_id: string;
  group: string;
  scene_id: Id | null;
  type: TrackType | 'join' | 'leave' | 'scene' | 'award';
  ref?: string;
  label?: string;
  value?: number;
  at: string;
}

/** One message, as the game server hands it to the backend to keep for auditing. */
export interface MessageEntry {
  user_id: string;
  name: string;
  group: string;
  scene_id: Id | null;
  kind: 'chat' | 'emote' | 'private';
  /** For a private message: who it was for. */
  to_user_id?: string;
  to_name?: string;
  text: string;
  at: string;
}
export interface ChatBroadcast { session_id: string; text: string }
export interface EmoteBroadcast { session_id: string; emoji: string }
/** The server rejected a move; the client must return to this position. */
export interface SnapMessage { x: number; y: number; scene_id: Id }
export interface NoticeMessage { code: string; message: string }

/** Emoji players may send. Anything else is dropped by the server. */
export const EMOTES = [
  '💗', '👍', '👎', '🏆', '😀', '😂', '😍', '🥺', '😎', '😊', '😢', '🐶', '😺',
  '😴', '😇', '🎂', '🍕', '👻', '👽', '🎃', '🤖', '👾', '🎉', '🎊', '🎈', '❓',
];

export const CHAT_MAX_LENGTH = 140;

/** Close codes in Colyseus' application range (4011-4999). */
export const CloseCodes = {
  ScenarioUnavailable: 4101,
  Unauthorized: 4102,
  ReplacedByNewSession: 4103,
  /** A teacher reset the player's progress in this mission: rejoining starts it again. */
  ProgressReset: 4104,
} as const;
