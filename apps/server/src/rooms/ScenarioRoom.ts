import { Room, type AuthContext, type Client } from 'colyseus';
import {
  C2S, CloseCodes, isStaff, normalizeScenario, S2C, scopedMap, TRACK_TYPES, validateScenario, World,
  type ActivityEntry, type ChatBroadcast, type EmoteBroadcast, type AnimateMessage, type AvatarMessage, type AwardMessage, type ItemMessage, type JoinOptions,
  type MessageEntry, type MoveMessage, type NoticeMessage, type ProgressMessage, type Scenario, type SceneMessage, type ShowBroadcast, type ShowMessage,
  type SnapMessage, type TrackMessage, type VariableMessage, type WelcomeMessage, type WhisperBroadcast, type WhisperMessage,
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
/** How often what players did and said is handed to the backend. */
const LOG_INTERVAL_MS = 5000;
/** Things a player can do in a second that are worth a line in the activity log. */
const TRACK_PER_SECOND = 5;

/** Who joined, and into which instance. Worked out in onAuth, handed to onJoin. */
interface Seat extends User {
  group: string;
  team_name?: string;
}

/**
 * One room for a scenario and a party: the public game, or everyone a mission was assigned to.
 * A party is made of one or more teams, and **each team is its own instance** of the scenario:
 * its own World, shared variables, items and save data. Teams share the room so that they can
 * meet in the scenes that are not limited to a team (an observation deck), while everywhere
 * else a player sees only their own team. Clients draw the avatars the scene lets them see.
 *
 * The room is a thin adapter: rules live in World, which is unit-tested without Colyseus.
 */
export class ScenarioRoom extends Room<{ state: RoomState }> {
  override state = new RoomState();
  override maxMessagesPerSecond = 40;

  private scenario!: Scenario;
  private party = 'public';
  /** One world per team, made when its first player arrives. */
  private worlds = new Map<string, Promise<World>>();
  private ready = new Map<string, World>();
  /** Which team each connected player is in. */
  private teamOf = new Map<string, string>();
  private teamNames = new Map<string, string>();
  private lastChat = new Map<string, number>();
  private tracked = new Map<string, { second: number; count: number }>();
  private activityLog: ActivityEntry[] = [];
  private messageLog: MessageEntry[] = [];

  override async onCreate(options: JoinOptions) {
    const raw = await services.backend.getScenario(String(options.scenario));
    const check = validateScenario(raw);
    if (!check.ok) {
      const first = check.errors.slice(0, 5).map((e) => `${e.path}: ${e.message}`).join('; ');
      throw new Error(`Scenario "${options.scenario}" is not playable: ${first}`);
    }
    const scenario = (this.scenario = normalizeScenario(raw));
    this.party = partyOf(options);
    this.state.scenario = scenario.shortname;
    this.state.group = this.party;
    if (scenario.max_players && scenario.max_players > 0) this.maxClients = scenario.max_players;

    this.onMessage(C2S.Move, (client: Client, msg: MoveMessage) => {
      const result = this.world(client)?.move(client.sessionId, msg);
      if (result && !result.ok) this.snap(client);
    });

    this.onMessage(C2S.Scene, (client: Client, msg: SceneMessage) => {
      const world = this.world(client);
      if (!world) return;
      if (!world.changeScene(client.sessionId, msg)) return this.snap(client);
      const scene = world.index.scene(Number(msg.scene_id));
      this.log(client, { type: 'scene', ref: String(msg.scene_id), label: scene?.shortname });
    });

    this.onMessage(C2S.Variable, (client: Client, msg: VariableMessage) => {
      this.world(client)?.setVariable(client.sessionId, msg);
    });

    this.onMessage(C2S.Item, (client: Client, msg: ItemMessage) => {
      const world = this.world(client);
      if (world && !world.item(client.sessionId, msg)) {
        this.notice(client, 'item_unavailable', 'That is not available right now.');
      }
    });

    // An award action ran in the player's browser. The backend decides whether it is granted.
    this.onMessage(C2S.Award, async (client: Client, msg: AwardMessage) => {
      const user = this.world(client)?.userOf(client.sessionId);
      if (!user || user.role === 'guest' || !Number.isFinite(Number(msg?.action_id))) return;
      const result = await services.backend.award(scenario.id, user.id, Number(msg.action_id)).catch(() => null);
      if (!result) return;
      client.send(S2C.Progress, result);
      if (result.delta_stars || result.delta_xp || result.badge) {
        this.log(client, { type: 'award', ref: String(msg.action_id), label: result.badge?.name ?? result.note, value: result.delta_stars });
      }
    });

    // The player changed what they wear in the marketplace. What they wear is read from the backend, not taken on trust.
    this.onMessage(C2S.Look, async (client: Client) => {
      const world = this.world(client);
      const user = world?.userOf(client.sessionId);
      if (!world || !user || user.role === 'guest') return;
      world.setLook(client.sessionId, await services.backend.look(user.id).catch(() => ''));
    });

    // An event meant for the whole scene reached an action: pass it to the other players who can see this one.
    this.onMessage(C2S.Show, (client: Client, msg: ShowMessage) => {
      const others = this.world(client)?.show(client.sessionId, msg);
      if (!others?.length) return;
      const out: ShowBroadcast = { session_id: client.sessionId, event_id: Number(msg.event_id), action_id: Number(msg.action_id) };
      this.sendTo(others, S2C.Show, out);
    });

    // A move from the player's screen, or an animate action aimed at their avatar.
    this.onMessage(C2S.Animate, (client: Client, msg: AnimateMessage) => {
      this.world(client)?.animate(client.sessionId, msg);
    });

    this.onMessage(C2S.Avatar, (client: Client, msg: AvatarMessage) => {
      this.world(client)?.setAvatarVisible(client.sessionId, msg);
    });

    this.onMessage(C2S.Progress, (client: Client, msg: ProgressMessage) => {
      this.world(client)?.progress(client.sessionId, msg);
    });

    // Emotes and chat reach the players who can see the sender: those in the same scene, and in
    // the same team where the scene is limited to teams.
    this.onMessage(C2S.Emote, (client: Client, msg: { emoji?: unknown }) => {
      const world = this.world(client);
      if (!world || scenario.chat_mode === 'off' || !services.chat.isEmote(msg?.emoji) || !this.mayChat(client)) return;
      const out: EmoteBroadcast = { session_id: client.sessionId, emoji: msg.emoji };
      this.sendTo([client.sessionId, ...world.audience(client.sessionId)], S2C.Emote, out);
      this.keep(client, { kind: 'emote', text: msg.emoji });
    });

    this.onMessage(C2S.Chat, (client: Client, msg: { text?: unknown }) => {
      const world = this.world(client);
      if (!world || scenario.chat_mode !== 'free' || !this.mayChat(client)) return;
      const text = services.chat.clean(msg?.text);
      if (!text) return;
      const out: ChatBroadcast = { session_id: client.sessionId, text };
      this.sendTo([client.sessionId, ...world.audience(client.sessionId)], S2C.Chat, out);
      this.keep(client, { kind: 'chat', text });
    });

    // A private message: to one player anywhere in the scenario, where the scenario allows them.
    this.onMessage(C2S.Whisper, (client: Client, msg: WhisperMessage) => {
      const from = this.state.players.get(client.sessionId);
      const to = typeof msg?.to === 'string' ? this.state.players.get(msg.to) : undefined;
      if (!from || !to || msg.to === client.sessionId || scenario.private_messages !== true || !this.mayChat(client)) return;
      const text = services.chat.clean(msg.text);
      if (!text) return;
      const out: WhisperBroadcast = { from: client.sessionId, to: msg.to, from_name: from.name, to_name: to.name, text, at: Date.now() };
      this.sendTo([client.sessionId, msg.to], S2C.Whisper, out);
      this.keep(client, { kind: 'private', text, to_user_id: to.user_id, to_name: to.name });
    });

    // Something the player did that a teacher's report counts: a hotspot, an answer, an objective.
    this.onMessage(C2S.Track, (client: Client, msg: TrackMessage) => {
      if (!msg || !(TRACK_TYPES as readonly string[]).includes(msg.type) || !this.mayTrack(client)) return;
      this.log(client, {
        type: msg.type,
        ref: typeof msg.ref === 'string' ? msg.ref.slice(0, 64) : undefined,
        label: typeof msg.label === 'string' ? msg.label.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) : undefined,
        value: typeof msg.value === 'number' && Number.isFinite(msg.value) ? msg.value : undefined,
      });
    });

    this.clock.setInterval(() => void this.saveAll(), config.saveIntervalSeconds * 1000);
    this.clock.setInterval(() => void this.flushLogs(), LOG_INTERVAL_MS);
  }

  override async onAuth(_client: Client, options: JoinOptions, context: AuthContext): Promise<Seat> {
    const token = options?.token ?? context?.token;
    if (token) {
      const user = await services.backend.verifyToken(String(token));
      // With the real API, guest tokens are only good for scenarios that do not require a login.
      const guestBlocked = user?.role === 'guest' && config.backend === 'api' && this.scenario.require_login !== false;
      if (user && !guestBlocked) {
        const group = String(options?.group ?? 'public').slice(0, 64) || 'public';
        // A team's or an assignment's instance is for its members (and their teacher).
        const access = await services.backend.mayJoin(this.scenario.id, user, group, partyOf(options)).catch(() => null);
        if (!access?.allowed) throw new Error('You are not in that team.');
        // The backend says which room an instance belongs to; a client cannot put its team into another party's room.
        if (access.party !== this.party) throw new Error('That team plays in another room.');
        return { ...user, group, team_name: access.team_name };
      }
    }
    throw new Error('Please sign in to join this scenario.');
  }

  override async onJoin(client: Client, options: JoinOptions, seat: Seat) {
    const { group, team_name, ...user } = seat;
    // One seat per account: a second tab takes over from the first, whichever team it was in.
    for (const [team, other] of this.ready) {
      const existing = other.findSessionByUser(user.id);
      if (!existing) continue;
      await this.persist(existing);
      this.remove(existing, team);
      this.clients.find((c: Client) => c.sessionId === existing)?.leave(CloseCodes.ReplacedByNewSession);
    }

    const scenario = this.scenario;
    const world = await this.instance(group);
    if (team_name) this.teamNames.set(group, team_name);
    // Its players carry the team's name, so a teacher looking in can tell the teams apart.
    world.teamName = this.teamNames.get(group) ?? '';
    const saved = scenario.enable_save_session !== false
      ? await services.backend.loadSession(scenario.id, user.id, group).catch(() => null)
      : null;
    this.teamOf.set(client.sessionId, group);
    // A teacher switching to another team asks to arrive in the scene where that team is.
    const startScene = isStaff(user.role) ? Number(options?.scene_id) || undefined : undefined;
    const session = world.addPlayer(client.sessionId, user, saved, Number(options?.avatar_media_id) || undefined, startScene);
    const welcome: WelcomeMessage = {
      session_id: client.sessionId,
      session,
      chat_mode: scenario.chat_mode ?? 'emotes',
      team: { key: group, name: this.teamNames.get(group) },
      private_messages: scenario.private_messages === true,
    };
    client.send(S2C.Welcome, welcome);
    this.log(client, { type: 'join', ref: String(session.scene_id ?? '') });
  }

  override async onDrop(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = false;
    await this.persist(client.sessionId);
    await this.allowReconnection(client, config.reconnectSeconds);
  }

  override onReconnect(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = true;
  }

  override async onLeave(client: Client) {
    this.lastChat.delete(client.sessionId);
    this.tracked.delete(client.sessionId);
    const team = this.teamOf.get(client.sessionId);
    if (team == null) return;
    const elapsed = this.ready.get(team)?.sessionOf(client.sessionId)?.time_elapsed;
    this.log(client, { type: 'leave', value: elapsed });
    await this.persist(client.sessionId);
    this.remove(client.sessionId, team);
  }

  override async onDispose() {
    await Promise.all([...this.ready.keys()].map((team) => this.saveInstance(team, true)));
    await this.flushLogs();
  }

  // -------------------------------------------------------------- instances

  /** The world of one team, loading what the team left behind the first time it is asked for. */
  private instance(team: string): Promise<World> {
    let world = this.worlds.get(team);
    if (!world) {
      world = (async () => {
        const data = await services.backend.loadInstance(this.scenario.id, team).catch(() => null);
        const made = new World(
          this.scenario,
          {
            // Everyone in the room is in one list; variables and items are the team's own.
            state: { players: this.state.players, items: scopedMap(this.state.items, team), vars: scopedMap(this.state.vars, team) },
            newPlayer: () => new Player(),
            newItem: () => new ItemState(),
            now: () => Date.now(),
          },
          data,
          team,
        );
        this.ready.set(team, made);
        return made;
      })();
      this.worlds.set(team, world);
    }
    return world;
  }

  /** The world the client's player is in, once they have joined. */
  private world(client: Client): World | undefined {
    const team = this.teamOf.get(client.sessionId);
    return team == null ? undefined : this.ready.get(team);
  }

  private remove(sessionId: string, team: string) {
    this.ready.get(team)?.removePlayer(sessionId);
    this.teamOf.delete(sessionId);
  }

  // -------------------------------------------------------------- helpers

  private sendTo(sessionIds: string[], type: string, message: unknown) {
    const to = new Set(sessionIds);
    for (const c of this.clients) if (to.has(c.sessionId)) c.send(type, message);
  }

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

  private mayTrack(client: Client): boolean {
    const second = Math.floor(Date.now() / 1000);
    const t = this.tracked.get(client.sessionId);
    if (!t || t.second !== second) {
      this.tracked.set(client.sessionId, { second, count: 1 });
      return true;
    }
    return ++t.count <= TRACK_PER_SECOND;
  }

  /** Add a line to the activity log: who, in which instance and scene, did what, when. */
  private log(client: Client, entry: Pick<ActivityEntry, 'type' | 'ref' | 'label' | 'value'>) {
    const p = this.state.players.get(client.sessionId);
    const team = this.teamOf.get(client.sessionId);
    if (!p || team == null) return;
    this.activityLog.push({ ...entry, user_id: p.user_id, group: team, scene_id: p.scene_id, at: new Date().toISOString() });
  }

  /** Keep a message for auditing, whether it was said in a scene or sent privately. */
  private keep(client: Client, entry: Pick<MessageEntry, 'kind' | 'text' | 'to_user_id' | 'to_name'>) {
    const p = this.state.players.get(client.sessionId);
    const team = this.teamOf.get(client.sessionId);
    if (!p || team == null) return;
    this.messageLog.push({ ...entry, user_id: p.user_id, name: p.name, group: team, scene_id: p.scene_id, at: new Date().toISOString() });
  }

  private async flushLogs() {
    const activity = this.activityLog.splice(0);
    const messages = this.messageLog.splice(0);
    try {
      if (activity.length) await services.backend.logActivity(this.scenario.id, activity);
    } catch (err) {
      // Lines that could not be written are tried again with the next batch, up to a limit.
      if (this.activityLog.length < 5000) this.activityLog.unshift(...activity);
      console.error(`[${this.roomId}] could not write the activity log:`, err);
    }
    try {
      if (messages.length) await services.backend.logMessages(this.scenario.id, messages);
    } catch (err) {
      if (this.messageLog.length < 5000) this.messageLog.unshift(...messages);
      console.error(`[${this.roomId}] could not write the message log:`, err);
    }
  }

  /** Save one player's progress, in the instance they are playing. Guests are saved too, keyed by their guest id. */
  private async persist(sessionId: string) {
    if (this.scenario.enable_save_session === false) return;
    const team = this.teamOf.get(sessionId);
    const world = team == null ? undefined : this.ready.get(team);
    const user = world?.userOf(sessionId);
    const session = world?.sessionOf(sessionId);
    if (team == null || !user || !session) return;
    try {
      await services.backend.saveSession(this.scenario.id, user.id, team, session);
    } catch (err) {
      console.error(`[${this.roomId}] could not save session for ${user.id}:`, err);
    }
  }

  private async saveInstance(team: string, force = false) {
    const world = this.ready.get(team);
    if (!world || (!force && !world.dirty)) return;
    world.dirty = false;
    try {
      await services.backend.saveInstance(this.scenario.id, team, world.instanceData());
    } catch (err) {
      world.dirty = true;
      console.error(`[${this.roomId}] could not save instance ${team}:`, err);
    }
  }

  private async saveAll() {
    await Promise.all(this.clients.map((c: Client) => this.persist(c.sessionId)));
    await Promise.all([...this.ready.keys()].map((team) => this.saveInstance(team)));
  }
}

/** The room a player asks for: their party, or failing that their group, a room of its own. */
function partyOf(options: JoinOptions | undefined): string {
  return String(options?.party ?? options?.group ?? 'public').slice(0, 64) || 'public';
}
