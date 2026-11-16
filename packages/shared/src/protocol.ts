/**
 * Messages exchanged between the Phaser client and the Colyseus room.
 * Continuous state (positions, attachments, shared variables) travels
 * through the synchronized room state instead; see apps/server/src/rooms/state.ts.
 */
import type { Progress } from './types.js';
import type { Id, Session, VarValue, VariableOperator } from './types.js';

export const ROOM_NAME = 'scenario';

/** Options sent with joinOrCreate. */
export interface JoinOptions {
  /** Scenario shortname. Rooms are matched on scenario + group. */
  scenario: string;
  /** Group/instance key. Players with the same key share a room. */
  group?: string;
  /** API bearer token. */
  token?: string;
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
} as const;

export const S2C = {
  Welcome: 'welcome',
  Chat: 'chat',
  Emote: 'emote',
  Snap: 'snap',
  Notice: 'notice',
  Progress: 'progress',
  Show: 'show',
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
export interface RewardMessage extends Progress { delta_stars: number; delta_xp: number; note?: string; rank_up?: boolean }
/**
 * An event whose audience is the scene reached one of its actions on the sender's side. The server
 * checks the action belongs to such an event in the sender's scene and passes it to the other players there.
 */
export interface ShowMessage { event_id: Id; action_id: Id }
/** Another player's event is showing this action. `session_id` is who set it off. */
export interface ShowBroadcast extends ShowMessage { session_id: string }
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
} as const;
