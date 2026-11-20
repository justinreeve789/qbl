import { distance, isWalkable, MoveBudget, nearestWalkable, walkContext, type Circle, type WalkContext } from './geometry.js';
import { isShownToScene } from './engine.js';
import type { AnimateMessage, AvatarMessage, ItemMessage, MoveMessage, ProgressMessage, SceneMessage, ShowMessage, VariableMessage } from './protocol.js';
import { sceneSize, sceneTeamOnly, ScenarioIndex } from './scenario.js';
import { ANIMATION_NAME, type Id, type Item, type Scenario, type Scene, type Session, type VarValue } from './types.js';
import { applyOperator } from './variables.js';

/** Who is playing. `id` is the stable key for save data. */
export interface User {
  id: string;
  name: string;
  role: 'student' | 'teacher' | 'admin' | 'guest';
  avatar_media_id?: Id;
  /** Ids of the shop items the player has equipped, comma-separated: what their avatar wears. */
  look?: string;
  /**
   * What an account is told about itself only (sign-in, `GET /api/me`; never other players):
   * its address, and what its profile page may change.
   */
  email?: string;
  has_password?: boolean;
  uses_google?: boolean;
  name_locked?: boolean;
}

/** State shared by everyone in one group's instance of a scenario. */
export interface InstanceData {
  variables: Record<string, VarValue>;
  /** Where unique items were left. */
  items: Record<string, { scene_id: Id; x: number; y: number }>;
  updated_at?: string;
}

export interface PlayerRec {
  user_id: string; name: string; role: string; avatar: number; scene_id: number;
  x: number; y: number; facing: string; attachments: string; connected: boolean;
  /**
   * The instance the player is in (a team's, an assignment's, or `public`). Players of several
   * teams can be in one room; scenes limited to a team show a player only those with the same value.
   */
  team?: string;
  /** What the player's team is called ("Comets"), or empty where the instance has no name. */
  team_name?: string;
  /** True while an avatar action has hidden this player. Cleared on every scene change. */
  hidden: boolean;
  /** Equipped shop item ids, comma-separated. Drawn on the avatar by every client. */
  look: string;
  /**
   * The animation the avatar was last asked to play, as `name:count`, or empty. The count makes
   * the same move asked for twice two different values, so it plays twice. Cleared when the
   * player walks or changes scene.
   */
  anim: string;
}
export interface ItemRec { item_id: number; scene_id: number; x: number; y: number; holder: string }
export interface MapLike<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): unknown;
  delete(key: string): unknown;
  forEach(cb: (value: T, key: string) => void): void;
}
export interface WorldState {
  players: MapLike<PlayerRec>;
  items: MapLike<ItemRec>;
  vars: MapLike<string>;
}
export interface WorldDeps {
  state: WorldState;
  newPlayer(): PlayerRec;
  newItem(): ItemRec;
  now(): number;
  random?(): number;
}

/** How close an avatar must be to pick an item up, in scene pixels. */
const REACH = 260;
const DEFAULT_SIZE = { width: 1920, height: 1080 };
const MAX_FLAGS = 500;

interface Meta {
  user: User;
  budget: MoveBudget;
  progress: ProgressMessage;
  /** When this player's avatar was last asked to animate, and how many times in all. */
  lastAnimation: number;
  animations: number;
}

/**
 * The rules of a scenario instance, independent of Colyseus: who is where,
 * what moves are legal, who holds which item and what the shared variables
 * are. It mutates the state object it is given: the synchronized room state
 * on the game server, plain Maps in tests and in the client's offline mode.
 */
export class World {
  readonly index: ScenarioIndex;
  private meta = new Map<string, Meta>();
  private staticObstacles = new Map<Id, Circle[]>();
  dirty = false;

  /**
   * `team` names the instance this world is: several can run side by side in one room, each over
   * its own shared variables and items (see `scopedMap`) and the room's one list of players.
   */
  /** What this instance's team is called, when it is a named team. Copied onto its players. */
  teamName = '';

  constructor(readonly scenario: Scenario, private deps: WorldDeps, instance: InstanceData | null = null, readonly team = '') {
    this.index = new ScenarioIndex(scenario);
    const { state } = deps;

    for (const def of scenario.global_variables ?? []) {
      if ((def.scope ?? 'player') !== 'room') continue;
      const saved = def.persist === false ? undefined : instance?.variables?.[def.variable_name];
      state.vars.set(def.variable_name, JSON.stringify(saved ?? def.default_value));
    }

    for (const scene of scenario.scenes) {
      const obstacles: Circle[] = [];
      for (const placement of scene.items ?? []) {
        const item = this.index.items.get(placement.item_id);
        if (!item) continue;
        if (item.unique) {
          const key = String(item.id);
          if (state.items.get(key)) continue; // a unique item exists once, at its first placement
          const rec = deps.newItem();
          const saved = instance?.items?.[key];
          const savedOk = saved && this.index.scene(saved.scene_id);
          rec.item_id = item.id;
          rec.scene_id = savedOk ? saved.scene_id : scene.id;
          rec.x = savedOk ? saved.x : placement.position_x;
          rec.y = savedOk ? saved.y : placement.position_y;
          rec.holder = '';
          state.items.set(key, rec);
        } else if (blocksForEveryone(item)) {
          obstacles.push({ x: placement.position_x, y: placement.position_y, radius: blockingRadius(item) });
        }
      }
      this.staticObstacles.set(scene.id, obstacles);
    }
  }

  // ------------------------------------------------------------ players

  findSessionByUser(userId: string): string | null {
    for (const [sessionId, m] of this.meta) if (m.user.id === userId) return sessionId;
    return null;
  }

  /** Add a player and return the save data they start from. */
  addPlayer(sessionId: string, user: User, saved: Session | null, avatarId?: Id, startSceneId?: Id): Session {
    const { state } = this.deps;
    const useSave = this.scenario.enable_save_session !== false ? saved : null;
    // A scene asked for at the door (a teacher joining a team where its players are) wins over the save.
    const asked = startSceneId != null ? this.index.scene(startSceneId) : undefined;
    const scene = asked || (useSave?.scene_id != null && this.index.scene(useSave.scene_id)) || this.index.startScene();
    const wanted =
      useSave && scene.id === useSave.scene_id && useSave.position_x != null && useSave.position_y != null
        ? { x: useSave.position_x, y: useSave.position_y }
        : this.spawnPosition(scene);
    const pos = nearestWalkable(this.ctx(scene.id), wanted) ?? wanted;

    const attachments = (useSave?.attachments ?? []).filter((id) => {
      const item = this.index.items.get(id);
      return item && !item.unique && (item.vehicle || item.wearable);
    });

    const p = this.deps.newPlayer();
    p.user_id = user.id;
    p.name = user.name;
    p.role = user.role;
    p.avatar = this.pickAvatar(avatarId ?? user.avatar_media_id);
    p.scene_id = scene.id;
    p.x = pos.x;
    p.y = pos.y;
    p.facing = 'right';
    p.attachments = attachments.join(',');
    p.connected = true;
    p.team = this.team;
    p.team_name = this.teamName;
    p.hidden = false;
    p.anim = '';
    p.look = cleanLook(user.look);
    state.players.set(sessionId, p);

    const progress: ProgressMessage = {
      variables: this.cleanVariables(useSave?.variables ?? {}),
      flags: (useSave?.flags ?? []).slice(0, MAX_FLAGS),
      time_elapsed: useSave?.time_elapsed ?? 0,
    };
    this.meta.set(sessionId, { user, budget: new MoveBudget(this.deps.now()), progress, lastAnimation: -Infinity, animations: 0 });
    return this.sessionOf(sessionId)!;
  }

  /** Remove a player, leaving any unique items they held where they stood. Returns their save data. */
  removePlayer(sessionId: string): Session | null {
    const { state } = this.deps;
    const p = state.players.get(sessionId);
    if (!p) return null;
    const session = this.sessionOf(sessionId);
    for (const id of parseIds(p.attachments)) this.release(sessionId, p, id);
    state.players.delete(sessionId);
    this.meta.delete(sessionId);
    return session;
  }

  userOf(sessionId: string): User | undefined {
    return this.meta.get(sessionId)?.user;
  }

  /** Current save data for a player. Unique items are not saved with the player; they belong to the room. */
  sessionOf(sessionId: string): Session | null {
    const p = this.deps.state.players.get(sessionId);
    const m = this.meta.get(sessionId);
    if (!p || !m) return null;
    return {
      scene_id: p.scene_id,
      position_x: Math.round(p.x),
      position_y: Math.round(p.y),
      variables: m.progress.variables,
      flags: m.progress.flags,
      attachments: parseIds(p.attachments).filter((id) => !this.index.items.get(id)?.unique),
      time_elapsed: m.progress.time_elapsed,
      updated_at: new Date(this.deps.now()).toISOString(),
    };
  }

  // ----------------------------------------------------------- messages

  /** Accept a reported position, or return where the client must snap back to. */
  move(sessionId: string, msg: MoveMessage): { ok: true } | { ok: false; x: number; y: number; scene_id: Id } {
    const p = this.deps.state.players.get(sessionId);
    const m = this.meta.get(sessionId);
    if (!p || !m) return { ok: false, x: 0, y: 0, scene_id: 0 };
    const reject = () => ({ ok: false as const, x: p.x, y: p.y, scene_id: p.scene_id });
    const x = Number(msg?.x);
    const y = Number(msg?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return reject();
    const dist = distance({ x: p.x, y: p.y }, { x, y });
    if (!m.budget.spend(this.deps.now(), dist, this.speedOf(p))) return reject();
    if (!isWalkable(this.ctx(p.scene_id), x, y)) return reject();
    // Walking ends a dance or any other move.
    if (p.anim && (p.x !== x || p.y !== y)) p.anim = '';
    p.x = x;
    p.y = y;
    p.facing = msg.facing === 'left' ? 'left' : 'right';
    return { ok: true };
  }

  /** Move a player to another scene. Only scenes reachable from the current one are allowed. */
  changeScene(sessionId: string, msg: SceneMessage): boolean {
    const p = this.deps.state.players.get(sessionId);
    const m = this.meta.get(sessionId);
    const target = this.index.scene(Number(msg?.scene_id));
    if (!p || !m || !target) return false;
    if (target.id !== p.scene_id && !this.index.jumpTargets(p.scene_id).includes(target.id)) return false;
    const spawn = this.spawnPosition(target, typeof msg.spawn_point === 'string' ? msg.spawn_point : undefined);
    const pos = nearestWalkable(this.ctx(target.id), spawn) ?? spawn;
    p.scene_id = target.id;
    p.x = pos.x;
    p.y = pos.y;
    // Avatars are shown on arrival. A scene that wants them hidden hides them in a start event.
    p.hidden = false;
    p.anim = '';
    m.budget.reset(this.deps.now());
    return true;
  }

  /** The player changed what they wear. `look` comes from the backend, never from the client. */
  /**
   * May this player show this action to the others in their scene? Only an action of an event
   * whose audience is the scene, in the scene the player is in. Returns the session ids to tell.
   */
  show(sessionId: string, msg: ShowMessage): string[] | null {
    const p = this.deps.state.players.get(sessionId);
    const found = this.index.events.get(Number(msg?.event_id));
    if (!p || !found || found.scene.id !== p.scene_id || found.event.audience !== 'scene') return null;
    const action = found.event.actions.find((a) => a.id === Number(msg.action_id));
    if (!action || !isShownToScene(action)) return null;
    return this.audience(sessionId);
  }

  /**
   * The other players who can see this one: those in the same scene, and, where the scene is
   * limited to teams, in the same team. They are who a chat message or a shown event reaches.
   * A teacher is in one team's game at a time (the one they follow), so this holds for them too.
   */
  audience(sessionId: string): string[] {
    const p = this.deps.state.players.get(sessionId);
    const scene = p ? this.index.scene(p.scene_id) : undefined;
    if (!p || !scene) return [];
    const teamOnly = sceneTeamOnly(this.scenario, scene);
    const others: string[] = [];
    this.deps.state.players.forEach((other, id) => {
      if (id !== sessionId && canSee(other, p, teamOnly)) others.push(id);
    });
    return others;
  }

  /** How many players are in this instance. */
  get playerCount(): number {
    return this.meta.size;
  }

  /**
   * Play an animation on the player's avatar. It is only something to look at, so the server
   * checks the name's shape and how often it is asked, not whether the player "has" the move.
   */
  animate(sessionId: string, msg: AnimateMessage): boolean {
    const p = this.deps.state.players.get(sessionId);
    const m = this.meta.get(sessionId);
    const name = String(msg?.name ?? '');
    if (!p || !m || (name !== '' && !ANIMATION_NAME.test(name))) return false;
    const now = this.deps.now();
    if (name !== '' && now - m.lastAnimation < 250) return false;
    m.lastAnimation = now;
    m.animations++;
    p.anim = name === '' ? '' : `${name}:${m.animations}`;
    return true;
  }

  setLook(sessionId: string, look: string | undefined): void {
    const p = this.deps.state.players.get(sessionId);
    if (p) p.look = cleanLook(look);
  }

  /** An avatar action: show or hide this player's avatar for everyone in the scene. */
  setAvatarVisible(sessionId: string, msg: AvatarMessage): boolean {
    const p = this.deps.state.players.get(sessionId);
    if (!p || typeof msg?.visible !== 'boolean') return false;
    p.hidden = !msg.visible;
    return true;
  }

  /** Apply a variable action to a room-scoped variable. */
  setVariable(_sessionId: string, msg: VariableMessage): boolean {
    const def = (this.scenario.global_variables ?? []).find((v) => v.variable_name === msg?.name);
    if (!def || (def.scope ?? 'player') !== 'room') return false;
    if (!['set', '+', '-', '*', '/', '%', 'random'].includes(msg.operator)) return false;
    const operand = typeof msg.operand === 'number' || typeof msg.operand === 'string' ? msg.operand : undefined;
    if (typeof operand === 'string' && operand.length > 1000) return false;
    const { vars } = this.deps.state;
    const current = decode(vars.get(def.variable_name)) ?? def.default_value;
    const next = applyOperator(current, msg.operator, operand, this.deps.random);
    vars.set(def.variable_name, JSON.stringify(next));
    this.dirty = true;
    return true;
  }

  /** Put on / climb into an item, or take it off. */
  item(sessionId: string, msg: ItemMessage): boolean {
    const { state } = this.deps;
    const p = state.players.get(sessionId);
    const item = this.index.items.get(Number(msg?.item_id));
    if (!p || !item || !(item.vehicle || item.wearable)) return false;
    const held = parseIds(p.attachments);

    if (msg.action === 'detach') {
      if (!held.includes(item.id)) return false;
      this.release(sessionId, p, item.id);
      p.attachments = held.filter((id) => id !== item.id).join(',');
      return true;
    }
    if (msg.action !== 'attach' || held.includes(item.id)) return false;
    if (item.vehicle && held.some((id) => this.index.items.get(id)?.vehicle)) return false;

    let at: { x: number; y: number } | null = null;
    const rec = item.unique ? state.items.get(String(item.id)) : undefined;
    if (item.unique) {
      if (!rec || rec.holder !== '' || rec.scene_id !== p.scene_id) return false;
      at = { x: rec.x, y: rec.y };
    } else {
      const placement = this.index.scene(p.scene_id)?.items?.find((pl) => pl.item_id === item.id);
      if (!placement) return false;
      at = { x: placement.position_x, y: placement.position_y };
    }
    if (distance(at, { x: p.x, y: p.y }) > REACH) return false;
    if (rec) {
      rec.holder = sessionId;
      this.dirty = true;
    }
    p.attachments = [...held, item.id].join(',');
    return true;
  }

  /** Remember the client's player-scoped progress for the next save. */
  progress(sessionId: string, msg: ProgressMessage): void {
    const m = this.meta.get(sessionId);
    if (!m || !msg || typeof msg !== 'object') return;
    m.progress = {
      variables: this.cleanVariables(msg.variables ?? {}),
      flags: Array.isArray(msg.flags) ? msg.flags.filter((f) => typeof f === 'string' && f.length <= 64).slice(0, MAX_FLAGS) : [],
      time_elapsed: Math.max(m.progress.time_elapsed, Number(msg.time_elapsed) || 0),
    };
  }

  /** Shared state worth keeping between sessions of this group. */
  instanceData(): InstanceData {
    const variables: Record<string, VarValue> = {};
    for (const def of this.scenario.global_variables ?? []) {
      if ((def.scope ?? 'player') !== 'room' || def.persist === false) continue;
      const v = decode(this.deps.state.vars.get(def.variable_name));
      if (v !== undefined) variables[def.variable_name] = v;
    }
    const items: InstanceData['items'] = {};
    this.deps.state.items.forEach((rec, key) => {
      // A held item is saved at its holder's feet, as if it had just been dropped.
      const holder = rec.holder ? this.deps.state.players.get(rec.holder) : undefined;
      items[key] = holder
        ? { scene_id: holder.scene_id, x: holder.x, y: holder.y }
        : { scene_id: rec.scene_id, x: rec.x, y: rec.y };
    });
    return { variables, items, updated_at: new Date(this.deps.now()).toISOString() };
  }

  // ------------------------------------------------------------ helpers

  private release(sessionId: string, p: PlayerRec, itemId: Id): void {
    const rec = this.deps.state.items.get(String(itemId));
    if (!rec || rec.holder !== sessionId) return;
    rec.holder = '';
    rec.scene_id = p.scene_id;
    rec.x = p.x;
    rec.y = p.y;
    this.dirty = true;
  }

  private pickAvatar(wanted?: Id): number {
    const allowed = this.scenario.avatar_media_ids ?? [];
    if (wanted != null && allowed.includes(wanted)) return wanted;
    return allowed[0] ?? 0;
  }

  private cleanVariables(input: Record<string, unknown>): Record<string, VarValue> {
    const out: Record<string, VarValue> = {};
    for (const def of this.scenario.global_variables ?? []) {
      if ((def.scope ?? 'player') !== 'player' || def.persist === false) continue;
      const v = input?.[def.variable_name];
      if (typeof v === 'number' && Number.isFinite(v)) out[def.variable_name] = v;
      else if (typeof v === 'string' && v.length <= 1000) out[def.variable_name] = v;
    }
    return out;
  }

  private size(scene: Scene): { width: number; height: number } {
    return sceneSize(this.scenario, scene) ?? DEFAULT_SIZE;
  }

  private spawnPosition(scene: Scene, name?: string): { x: number; y: number } {
    const spawn = this.index.spawn(scene, name);
    if (spawn) return { x: spawn.position_x, y: spawn.position_y };
    const size = this.size(scene);
    return { x: size.width / 2, y: size.height / 2 };
  }

  private speedOf(p: PlayerRec): number {
    let multiplier = 1;
    for (const id of parseIds(p.attachments)) {
      const item = this.index.items.get(id);
      if (item?.vehicle) multiplier = Math.max(multiplier, item.speed_multiplier ?? 1.5);
    }
    return (this.scenario.move_speed ?? 420) * multiplier;
  }

  private ctx(sceneId: Id): WalkContext {
    const scene = this.index.scene(sceneId)!;
    const obstacles = [...(this.staticObstacles.get(sceneId) ?? [])];
    this.deps.state.items.forEach((rec) => {
      if (rec.scene_id !== sceneId || rec.holder !== '') return;
      const item = this.index.items.get(rec.item_id);
      if (item && blocksForEveryone(item)) obstacles.push({ x: rec.x, y: rec.y, radius: blockingRadius(item) });
    });
    return walkContext(scene, this.size(scene), obstacles);
  }
}

/**
 * Whether the server treats an item as an obstacle. Items with conditions
 * may not exist for a given player, and those conditions can depend on
 * player-scoped variables the server does not evaluate, so the server stays
 * lenient there and leaves the blocking to the client.
 */
function blocksForEveryone(item: Item): boolean {
  return item.blocking === true && !(item.conditions && item.conditions.length > 0);
}

/** Teachers and admins. A teacher follows one team at a time, and can switch to another. */
export function isStaff(role: string | undefined): boolean {
  return role === 'teacher' || role === 'admin';
}

/**
 * Whether `viewer` is shown `subject`: they are in the same scene and, where the scene is
 * limited to teams, in the same team. The same for everyone: each team's scene can hold
 * different items, hotspots and events, so seeing another team's players there would show
 * them in a world that is not theirs. A teacher sees the team they follow, as a member of it.
 */
export function canSee(viewer: Pick<PlayerRec, 'scene_id' | 'team'>, subject: Pick<PlayerRec, 'scene_id' | 'team'>, teamOnly: boolean): boolean {
  return viewer.scene_id === subject.scene_id && (!teamOnly || (viewer.team ?? '') === (subject.team ?? ''));
}

const SCOPE_SEPARATOR = '|';

/**
 * One team's part of a map shared by a whole room: keys are stored as `team|key`. With it each
 * team's World, and each client, reads and writes its own shared variables and items as if it
 * had the map to itself.
 */
export function scopedMap<T>(map: MapLike<T>, scope: string): MapLike<T> {
  const prefix = `${scope}${SCOPE_SEPARATOR}`;
  return {
    get: (key) => map.get(prefix + key),
    set: (key, value) => map.set(prefix + key, value),
    delete: (key) => map.delete(prefix + key),
    forEach: (cb) => map.forEach((value, key) => {
      if (key.startsWith(prefix)) cb(value, key.slice(prefix.length));
    }),
  };
}

export function blockingRadius(item: Item): number {
  return item.blocking_radius ?? 40;
}

export function parseIds(csv: string): Id[] {
  return csv ? csv.split(',').map(Number).filter((n) => Number.isFinite(n)) : [];
}

function decode(raw: string | undefined): VarValue | undefined {
  if (raw === undefined) return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'number' || typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Keep a look string to what it should be: a short list of ids. */
function cleanLook(look: string | undefined): string {
  return parseIds(look ?? '').slice(0, 12).join(',');
}
