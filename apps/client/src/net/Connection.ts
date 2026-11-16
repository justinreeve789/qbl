import { Client, type Room } from '@colyseus/sdk';
import {
  C2S, ROOM_NAME, S2C, World,
  type ChatBroadcast, type EmoteBroadcast, type Id, type ItemMessage, type ItemRec, type JoinOptions,
  type MoveMessage, type NoticeMessage, type PlayerRec, type ProgressMessage, type RewardMessage, type Scenario, type SceneMessage,
  type ShowBroadcast, type ShowMessage, type SnapMessage, type User, type VariableMessage, type WelcomeMessage, type WorldState,
} from '@qbl/shared';

export interface ConnectionEvents {
  chat: ChatBroadcast;
  emote: EmoteBroadcast;
  snap: SnapMessage;
  notice: NoticeMessage;
  /** The server granted (or declined) an award: the player's new totals and what changed. */
  reward: RewardMessage;
  /** Another player's event, meant for the whole scene, reached this action. */
  show: ShowBroadcast;
  /** Connection lost; the SDK is retrying. */
  drop: void;
  reconnect: void;
  /** Gone for good, with the close code. */
  leave: number;
}

type Handlers = { [K in keyof ConnectionEvents]: Set<(payload: ConnectionEvents[K]) => void> };

/**
 * What the game needs from "the room", online or not. Scenes read `state`
 * every frame rather than subscribing to individual schema changes, so the
 * rendering code is identical in both modes.
 */
export abstract class GameConnection {
  abstract readonly online: boolean;
  abstract readonly sessionId: string;
  abstract readonly state: WorldState;
  abstract readonly welcome: WelcomeMessage;
  protected abstract send(type: string, payload: unknown): void;
  abstract leave(): void;

  private handlers: Handlers = {
    chat: new Set(), emote: new Set(), snap: new Set(), notice: new Set(), reward: new Set(), show: new Set(),
    drop: new Set(), reconnect: new Set(), leave: new Set(),
  };

  on<K extends keyof ConnectionEvents>(event: K, handler: (payload: ConnectionEvents[K]) => void): () => void {
    this.handlers[event].add(handler);
    return () => this.handlers[event].delete(handler);
  }

  protected emit<K extends keyof ConnectionEvents>(event: K, payload: ConnectionEvents[K]) {
    for (const h of [...this.handlers[event]]) h(payload);
  }

  get me(): PlayerRec | undefined {
    return this.state.players.get(this.sessionId);
  }

  move(msg: MoveMessage) { this.send(C2S.Move, msg); }
  changeScene(msg: SceneMessage) { this.send(C2S.Scene, msg); }
  chat(text: string) { this.send(C2S.Chat, { text }); }
  emote(emoji: string) { this.send(C2S.Emote, { emoji }); }
  variable(msg: VariableMessage) { this.send(C2S.Variable, msg); }
  item(msg: ItemMessage) { this.send(C2S.Item, msg); }
  progress(msg: ProgressMessage) { this.send(C2S.Progress, msg); }
  /** An award action ran: ask the server to grant it. */
  award(actionId: Id) { this.send(C2S.Award, { action_id: actionId }); }
  /** The player changed what they wear. Online the server reads it from the backend; offline it is taken as given. */
  lookChanged(look: string) { this.send(C2S.Look, { look }); }
  /** An event meant for the whole scene reached this action: the server passes it to the other players there. */
  share(eventId: Id, actionId: Id) { this.send(C2S.Show, { event_id: eventId, action_id: actionId }); }
  /** Show or hide this player's avatar for everyone in the scene. */
  avatarVisible(visible: boolean) { this.send(C2S.Avatar, { visible }); }
}

/** A Colyseus room on the game server. */
export class OnlineConnection extends GameConnection {
  readonly online = true;

  private constructor(private room: Room, readonly welcome: WelcomeMessage) {
    super();
    room.onMessage(S2C.Chat, (m: ChatBroadcast) => this.emit('chat', m));
    room.onMessage(S2C.Emote, (m: EmoteBroadcast) => this.emit('emote', m));
    room.onMessage(S2C.Snap, (m: SnapMessage) => this.emit('snap', m));
    room.onMessage(S2C.Notice, (m: NoticeMessage) => this.emit('notice', m));
    room.onMessage(S2C.Progress, (m: RewardMessage) => this.emit('reward', m));
    room.onMessage(S2C.Show, (m: ShowBroadcast) => this.emit('show', m));
    room.onDrop(() => this.emit('drop', undefined));
    room.onReconnect(() => this.emit('reconnect', undefined));
    room.onLeave((code: number) => this.emit('leave', code));
  }

  static async join(serverUrl: string, options: JoinOptions): Promise<OnlineConnection> {
    const client = new Client(serverUrl);
    const room = await client.joinOrCreate(ROOM_NAME, options);
    // The welcome message carries the authoritative save data; wait for it and the first state.
    const welcome = await new Promise<WelcomeMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The game server did not respond.')), 10_000);
      room.onMessage(S2C.Welcome, (m: WelcomeMessage) => {
        clearTimeout(timer);
        resolve(m);
      });
      room.onLeave((code: number) => {
        clearTimeout(timer);
        reject(new Error(`Disconnected (${code}).`));
      });
    });
    const connection = new OnlineConnection(room, welcome);
    // The first state patch follows the join; scenes need our own player record to exist.
    for (let i = 0; i < 200 && !connection.me; i++) await new Promise((r) => setTimeout(r, 25));
    if (!connection.me) throw new Error('The game server did not send the room state.');
    return connection;
  }

  get sessionId(): string {
    return this.room.sessionId;
  }

  get state(): WorldState {
    return this.room.state as unknown as WorldState;
  }

  override get me() {
    // Before the first patch the state's collections may not exist yet.
    return this.state?.players?.get(this.sessionId);
  }

  protected send(type: string, payload: unknown) {
    this.room.send(type, payload);
  }

  leave() {
    void this.room.leave();
  }
}

/**
 * Single-player mode: the same World rules the server runs, executed in the
 * browser against plain Maps. Nothing is saved.
 */
export class OfflineConnection extends GameConnection {
  readonly online = false;
  readonly sessionId = 'local';
  readonly state: WorldState = {
    players: new Map<string, PlayerRec>(),
    items: new Map<string, ItemRec>(),
    vars: new Map<string, string>(),
  };
  readonly welcome: WelcomeMessage;
  /** What this player's events would have shown to the rest of the scene. */
  readonly shared: ShowMessage[] = [];
  private world: World;

  constructor(scenario: Scenario, user: User, avatarId?: Id, now: () => number = () => Date.now()) {
    super();
    this.world = new World(scenario, {
      state: this.state,
      newPlayer: () => ({}) as PlayerRec,
      newItem: () => ({}) as ItemRec,
      now,
    });
    const session = this.world.addPlayer(this.sessionId, user, scenario.session ?? null, avatarId);
    this.welcome = { session_id: this.sessionId, session, chat_mode: scenario.chat_mode ?? 'emotes' };
  }

  protected send(type: string, payload: unknown) {
    const id = this.sessionId;
    switch (type) {
      case C2S.Move:
        if (!this.world.move(id, payload as MoveMessage).ok) this.snap();
        break;
      case C2S.Scene:
        if (!this.world.changeScene(id, payload as SceneMessage)) this.snap();
        break;
      case C2S.Variable:
        this.world.setVariable(id, payload as VariableMessage);
        break;
      case C2S.Item:
        if (!this.world.item(id, payload as ItemMessage)) {
          this.emit('notice', { code: 'item_unavailable', message: 'That is not available right now.' });
        }
        break;
      case C2S.Show:
        // Nobody else to show it to; kept so a preview and the tests can see what would be sent.
        if (this.world.show(id, payload as ShowMessage)) this.shared.push(payload as ShowMessage);
        break;
      case C2S.Look:
        this.world.setLook(this.sessionId, (payload as { look: string }).look);
        break;
      case C2S.Avatar:
        this.world.setAvatarVisible(this.sessionId, payload as { visible: boolean });
        break;
      case C2S.Progress:
        this.world.progress(id, payload as ProgressMessage);
        break;
      case C2S.Chat:
        this.emit('chat', { session_id: id, text: (payload as { text: string }).text });
        break;
      case C2S.Emote:
        this.emit('emote', { session_id: id, emoji: (payload as { emoji: string }).emoji });
        break;
      default:
    }
  }

  private snap() {
    const p = this.me;
    if (p) this.emit('snap', { x: p.x, y: p.y, scene_id: p.scene_id });
  }

  /** Another player's shown action arriving, as the server would deliver it. */
  deliver(show: ShowBroadcast) {
    this.emit('show', show);
  }

  leave() {}
}
