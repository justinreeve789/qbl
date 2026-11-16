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

export const RoomState = schema({
  scenario: t.string(),
  group: t.string(),
  players: t.map(Player),
  /** Keyed by item id. */
  items: t.map(ItemState),
  /** Room-scoped variables. Values are JSON-encoded so numbers stay numbers. */
  vars: t.map('string'),
}, 'RoomState');
export type RoomState = SchemaType<typeof RoomState>;
