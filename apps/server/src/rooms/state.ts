import { schema, t, type SchemaType } from '@colyseus/schema';

/** One avatar. Keyed by Colyseus session id in RoomState.players. */
export const Player = schema({
  user_id: t.string(),
  name: t.string(),
  role: t.string(),
  /** Media id of the avatar image, 0 for the default. */
  avatar: t.int32(),
  scene_id: t.int32(),
  x: t.number(),
  y: t.number(),
  /** "left" or "right" */
  facing: t.string(),
  /** Comma-separated item ids currently worn or ridden. */
  attachments: t.string(),
  /** False while the connection is dropped and the seat is held for reconnection. */
  connected: t.boolean(),
  /** The instance the player is in: their team's key, their assignment's, or "public". */
  team: t.string(),
  /** What that team is called, or "" for an assignment's or the public instance. */
  team_name: t.string(),
  hidden: t.boolean(),
  look: t.string(),
  /** The animation the avatar was last asked to play, as name:count. */
  anim: t.string(),
}, 'Player');
export type Player = SchemaType<typeof Player>;

/** A unique item: one exists per room, and it stays where it was left. */
export const ItemState = schema({
  item_id: t.int32(),
  scene_id: t.int32(),
  x: t.number(),
  y: t.number(),
  /** Session id of the player holding it, or "" when it is free. */
  holder: t.string(),
}, 'ItemState');
export type ItemState = SchemaType<typeof ItemState>;

/**
 * A character that walks around on its own (`roams`): one exists per team, kept by the World.
 * Clients draw it where this says, and smooth the steps in between.
 */
export const NpcState = schema({
  character_id: t.int32(),
  scene_id: t.int32(),
  x: t.number(),
  y: t.number(),
  facing: t.string(),
  moving: t.boolean(),
  /** The animation it was last asked to play, as name:count. */
  anim: t.string(),
  /** The routine line it is saying, as count:step. */
  line: t.string(),
  /** The ticket of the player's walk action it is carrying out, or "". */
  trip: t.string(),
}, 'NpcState');
export type NpcState = SchemaType<typeof NpcState>;

export const RoomState = schema({
  scenario: t.string(),
  group: t.string(),
  players: t.map(Player),
  /** Unique items, one set per team: keyed by `team|item id`. */
  items: t.map(ItemState),
  /** Shared variables, one set per team: keyed by `team|name`. Values are JSON-encoded so numbers stay numbers. */
  vars: t.map('string'),
  /** Characters that roam, one set per team: keyed by `team|character id`. */
  npcs: t.map(NpcState),
}, 'RoomState');
export type RoomState = SchemaType<typeof RoomState>;
