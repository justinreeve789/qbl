import { Room, type AuthContext, type Client } from 'colyseus';
import {
  C2S, CloseCodes, normalizeScenario, S2C, validateScenario, World,
  type ChatBroadcast, type EmoteBroadcast, type AnimateMessage, type AvatarMessage, type AwardMessage, type ItemMessage, type JoinOptions, type MoveMessage,
  type NoticeMessage, type ProgressMessage, type SceneMessage, type ShowBroadcast, type ShowMessage, type SnapMessage, type VariableMessage,
  type WelcomeMessage,
} from '@qbl/shared';
import type { Backend, User } from '../backend/Backend.js';
import { config } from '../config.js';
import { ChatFilter } from './chat.js';
import { ItemState, Player, RoomState } from './state.js';

/** Set once at boot by index.ts. */
export const services: { backend: Backend; chat: ChatFilter } = {
  backend: undefined as unknown as Backend,
  chat: new ChatFilter(),
};

const CHAT_INTERVAL_MS = 800;

/**
 * One instance of a scenario for one group of players. Players in every
 * scene of the scenario share the room; clients draw only the avatars whose
 * scene_id matches their own.
 *
 * The room is a thin adapter: rules live in World, which is unit-tested
 * without Colyseus.
 */
export class ScenarioRoom extends Room<{ state: RoomState }> {
  state = new RoomState();
  maxMessagesPerSecond = 40;

  private world!: World;
  private group = 'public';
  private lastChat = new Map<string, number>();

  async onCreate(options: JoinOptions) {
    const raw = await services.backend.getScenario(String(options.scenario));
    const check = validateScenario(raw);
    if (!check.ok) {
      const first = check.errors.slice(0, 5).map((e) => `${e.path}: ${e.message}`).join('; ');
      throw new Error(`Scenario "${options.scenario}" is not playable: ${first}`);
    }
    const scenario = normalizeScenario(raw);
    this.group = String(options.group ?? 'public').slice(0, 64);
    this.state.scenario = scenario.shortname;
    this.state.group = this.group;
    if (scenario.max_players && scenario.max_players > 0) this.maxClients = scenario.max_players;

    const instance = await services.backend.loadInstance(scenario.id, this.group).catch(() => null);
    this.world = new World(
      scenario,
      {
        state: this.state,
        newPlayer: () => new Player(),
        newItem: () => new ItemState(),
        now: () => Date.now(),
      },
      instance,
    );

    this.onMessage(C2S.Move, (client: Client, msg: MoveMessage) => {
      const result = this.world.move(client.sessionId, msg);
      if (!result.ok) this.snap(client);
    });

    this.onMessage(C2S.Scene, (client: Client, msg: SceneMessage) => {
      if (!this.world.changeScene(client.sessionId, msg)) this.snap(client);
    });

    this.onMessage(C2S.Variable, (client: Client, msg: VariableMessage) => {
      this.world.setVariable(client.sessionId, msg);
    });

    this.onMessage(C2S.Item, (client: Client, msg: ItemMessage) => {
      if (!this.world.item(client.sessionId, msg)) {
        this.notice(client, 'item_unavailable', 'That is not available right now.');
      }
    });

    // An award action ran in the player's browser. The backend decides whether it is granted.
    this.onMessage(C2S.Award, async (client: Client, msg: AwardMessage) => {
      const user = this.world.userOf(client.sessionId);
      if (!user || user.role === 'guest' || !Number.isFinite(Number(msg?.action_id))) return;
      const result = await services.backend.award(this.world.scenario.id, user.id, Number(msg.action_id)).catch(() => null);
      if (result) client.send(S2C.Progress, result);
    });

    // The player changed what they wear in the marketplace. What they wear is read from the backend, not taken on trust.
    this.onMessage(C2S.Look, async (client: Client) => {
      const user = this.world.userOf(client.sessionId);
      if (!user || user.role === 'guest') return;
      this.world.setLook(client.sessionId, await services.backend.look(user.id).catch(() => ''));
    });

    // An event meant for the whole scene reached an action: pass it to the other players there.
    this.onMessage(C2S.Show, (client: Client, msg: ShowMessage) => {
      const others = this.world.show(client.sessionId, msg);
      if (!others?.length) return;
      const out: ShowBroadcast = { session_id: client.sessionId, event_id: Number(msg.event_id), action_id: Number(msg.action_id) };
      for (const c of this.clients) if (others.includes(c.sessionId)) c.send(S2C.Show, out);
    });

    // A move from the player's screen, or an animate action aimed at their avatar.
    this.onMessage(C2S.Animate, (client: Client, msg: AnimateMessage) => {
      this.world.animate(client.sessionId, msg);
    });

    this.onMessage(C2S.Avatar, (client: Client, msg: AvatarMessage) => {
      this.world.setAvatarVisible(client.sessionId, msg);
    });

    this.onMessage(C2S.Progress, (client: Client, msg: ProgressMessage) => {
      this.world.progress(client.sessionId, msg);
    });

    this.onMessage(C2S.Emote, (client: Client, msg: { emoji?: unknown }) => {
      if (scenario.chat_mode === 'off' || !services.chat.isEmote(msg?.emoji) || !this.mayChat(client)) return;
      const out: EmoteBroadcast = { session_id: client.sessionId, emoji: msg.emoji };
      this.broadcast(S2C.Emote, out);
    });

    this.onMessage(C2S.Chat, (client: Client, msg: { text?: unknown }) => {
      if (scenario.chat_mode !== 'free' || !this.mayChat(client)) return;
      const text = services.chat.clean(msg?.text);
      if (!text) return;
      const out: ChatBroadcast = { session_id: client.sessionId, text };
      this.broadcast(S2C.Chat, out);
    });

    this.clock.setInterval(() => void this.saveAll(), config.saveIntervalSeconds * 1000);
  }

  async onAuth(_client: Client, options: JoinOptions, context: AuthContext): Promise<User> {
    const token = options?.token ?? context?.token;
    if (token) {
      const user = await services.backend.verifyToken(String(token));
      // With the real API, guest tokens are only good for scenarios that do not require a login.
      const guestBlocked = user?.role === 'guest' && config.backend === 'api' && this.world.scenario.require_login !== false;
      if (user && !guestBlocked) return user;
    }
    throw new Error('Please sign in to join this scenario.');
  }

  async onJoin(client: Client, options: JoinOptions, user: User) {
    // One seat per account: a second tab takes over from the first.
    const existing = this.world.findSessionByUser(user.id);
    if (existing) {
      await this.persist(existing);
      this.world.removePlayer(existing);
      this.clients.find((c: Client) => c.sessionId === existing)?.leave(CloseCodes.ReplacedByNewSession);
    }

    const scenario = this.world.scenario;
    const saved = scenario.enable_save_session !== false
      ? await services.backend.loadSession(scenario.id, user.id).catch(() => null)
      : null;
    const session = this.world.addPlayer(client.sessionId, user, saved, Number(options?.avatar_media_id) || undefined);
    const welcome: WelcomeMessage = {
      session_id: client.sessionId,
      session,
      chat_mode: scenario.chat_mode ?? 'emotes',
    };
    client.send(S2C.Welcome, welcome);
  }

  async onDrop(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = false;
    await this.persist(client.sessionId);
    await this.allowReconnection(client, config.reconnectSeconds);
  }

  onReconnect(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = true;
  }

  async onLeave(client: Client) {
    this.lastChat.delete(client.sessionId);
    await this.persist(client.sessionId);
    this.world.removePlayer(client.sessionId);
  }

  async onDispose() {
    await this.saveInstance(true);
  }

  // -------------------------------------------------------------- helpers

  private snap(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const msg: SnapMessage = { x: p.x, y: p.y, scene_id: p.scene_id };
    client.send(S2C.Snap, msg);
  }

  private notice(client: Client, code: string, message: string) {
    const msg: NoticeMessage = { code, message };
    client.send(S2C.Notice, msg);
  }

  private mayChat(client: Client): boolean {
    const now = Date.now();
    if (now - (this.lastChat.get(client.sessionId) ?? 0) < CHAT_INTERVAL_MS) return false;
    this.lastChat.set(client.sessionId, now);
    return true;
  }

  /** Save one player's progress. Guests are saved too, keyed by their guest id. */
  private async persist(sessionId: string) {
    if (!this.world || this.world.scenario.enable_save_session === false) return;
    const user = this.world.userOf(sessionId);
    const session = this.world.sessionOf(sessionId);
    if (!user || !session) return;
    try {
      await services.backend.saveSession(this.world.scenario.id, user.id, session);
    } catch (err) {
      console.error(`[${this.roomId}] could not save session for ${user.id}:`, err);
    }
  }

  private async saveInstance(force = false) {
    if (!this.world || (!force && !this.world.dirty)) return;
    this.world.dirty = false;
    try {
      await services.backend.saveInstance(this.world.scenario.id, this.group, this.world.instanceData());
    } catch (err) {
      this.world.dirty = true;
      console.error(`[${this.roomId}] could not save instance:`, err);
    }
  }

  private async saveAll() {
    await Promise.all(this.clients.map((c: Client) => this.persist(c.sessionId)));
    await this.saveInstance();
  }
}
