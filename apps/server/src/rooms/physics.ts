import {
  S2C, scenePhysics,
  type Id, type PhysicsInput, type PhysicsMessage, type PhysicsStateMessage, type PhysicsTickMessage, type PhysicsWatchMessage, type Scenario, type Scene, type ScenePhysics,
} from '@qbl/shared';
import { PhysicsSim } from '@qbl/shared/physics-sim';

/** How often players are told where everything is. */
const SNAPSHOT_MS = 50;
/** Ticks come every sixtieth of a second: a snapshot due within half of one is sent now, not a tick late. */
const SLACK_MS = 8;
/** An experiment nobody is looking at is kept this long, then forgotten (it starts afresh). */
const KEEP_EMPTY_MS = 2 * 60_000;
const OPS = new Set(['grab', 'drag', 'drop', 'press', 'unpress', 'take', 'beam', 'unbeam', 'clear', 'sync', 'control']);

interface Lab {
  sim: PhysicsSim;
  team: string;
  sceneId: Id;
  /** The layout changed since players were last sent it. */
  dirty: boolean;
  lastSnapshot: number;
  emptySince: number | null;
}

/** What the room tells the experiments about the players. */
export interface PhysicsRoomPort {
  /** Session ids of the players of this team in this scene. */
  members(team: string, sceneId: Id): string[];
  /** The scene and team a player is in now, if they are playing. */
  whereIs(sessionId: string): { team: string; sceneId: Id } | null;
  send(sessionIds: string[], type: string, message: unknown): void;
}

/**
 * The shared physics experiments of a room: one per team and scene whose physics is `shared`.
 * The game server runs them so everyone in the scene sees and changes the same one; each player's
 * browser only draws what it is sent. Scenes whose physics is each player's own never get here.
 */
export class SharedExperiments {
  private labs = new Map<string, Lab>();
  private scenes = new Map<Id, { scene: Scene; physics: ScenePhysics; size: { width: number; height: number } }>();

  constructor(scenario: Scenario, private port: PhysicsRoomPort, private now: () => number = () => Date.now()) {
    for (const scene of scenario.scenes) {
      const physics = scenePhysics(scene);
      if (physics?.mode !== 'shared') continue;
      this.scenes.set(scene.id, { scene, physics, size: { width: scene.width ?? 1920, height: scene.height ?? 1080 } });
    }
  }

  /** The scenario has any shared experiments at all. */
  get any(): boolean {
    return this.scenes.size > 0;
  }

  private lab(team: string, sceneId: Id): Lab | null {
    const key = `${team}|${sceneId}`;
    let lab = this.labs.get(key);
    if (lab) return lab;
    const found = this.scenes.get(sceneId);
    if (!found) return null;
    const made: Lab = {
      sim: null as unknown as PhysicsSim, team, sceneId, dirty: true, lastSnapshot: 0, emptySince: null,
    };
    made.sim = new PhysicsSim(found.physics, found.size, {
      changed: () => (made.dirty = true),
      fired: (watch, value) => {
        const msg: PhysicsWatchMessage = { scene_id: sceneId, watch_id: watch.id, value };
        this.port.send(this.port.members(team, sceneId), S2C.PhysicsWatch, msg);
      },
    });
    this.labs.set(key, (lab = made));
    return lab;
  }

  /** A player did something to the experiment in their scene. */
  input(sessionId: string, msg: PhysicsMessage) {
    if (!msg || typeof msg !== 'object' || !OPS.has(String(msg.op))) return;
    const at = this.port.whereIs(sessionId);
    // Only the experiment of the scene the player is in, never another's.
    if (!at || Number(msg.scene_id) !== at.sceneId) return;
    const lab = this.lab(at.team, at.sceneId);
    if (!lab) return;
    if (msg.op === 'sync') {
      this.port.send([sessionId], S2C.PhysicsState, this.state(lab));
      return;
    }
    const input = clean(msg);
    if (!input) return;
    lab.sim.input(sessionId, input);
  }

  /** A player left the scene or the room: let go of whatever they held. */
  release(sessionId: string) {
    for (const lab of this.labs.values()) {
      lab.sim.input(sessionId, { op: 'drop' });
      lab.sim.input(sessionId, { op: 'unpress' });
    }
  }

  /** Move every experiment someone is looking at on by `seconds`, and tell its players. */
  tick(seconds: number) {
    const now = this.now();
    for (const [key, lab] of this.labs) {
      const members = this.port.members(lab.team, lab.sceneId);
      if (!members.length) {
        lab.emptySince ??= now;
        if (now - lab.emptySince > KEEP_EMPTY_MS) this.labs.delete(key);
        continue;
      }
      lab.emptySince = null;
      lab.sim.advance(seconds);
      if (lab.dirty) {
        lab.dirty = false;
        lab.lastSnapshot = now;
        this.port.send(members, S2C.PhysicsState, this.state(lab));
      } else if (now - lab.lastSnapshot >= SNAPSHOT_MS - SLACK_MS) {
        lab.lastSnapshot = now;
        const msg: PhysicsTickMessage = { scene_id: lab.sceneId, version: lab.sim.version, snap: lab.sim.snapshot() };
        this.port.send(members, S2C.PhysicsTick, msg);
      }
    }
  }

  private state(lab: Lab): PhysicsStateMessage {
    return { scene_id: lab.sceneId, ...lab.sim.layout(), snap: lab.sim.snapshot() };
  }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const point = (p: unknown) => (p && typeof p === 'object' && finite((p as { x: unknown }).x) && finite((p as { y: unknown }).y) ? { x: (p as { x: number }).x, y: (p as { y: number }).y } : null);

/** Only well-formed inputs reach the simulation; what is in them is checked there. */
function clean(msg: PhysicsMessage): PhysicsInput | null {
  const m = msg as unknown as Record<string, unknown>;
  const str = (k: string) => (typeof m[k] === 'string' ? (m[k] as string).slice(0, 80) : null);
  switch (msg.op) {
    case 'grab':
    case 'press': {
      const body = str('body');
      return body && finite(m.x) && finite(m.y) ? { op: msg.op, body, x: m.x, y: m.y } : null;
    }
    case 'drag':
      return finite(m.x) && finite(m.y) ? { op: 'drag', x: m.x, y: m.y } : null;
    case 'drop':
    case 'unpress':
    case 'clear':
      return { op: msg.op };
    case 'take': {
      const entry = str('entry');
      return entry && finite(m.x) && finite(m.y) ? { op: 'take', entry, x: m.x, y: m.y } : null;
    }
    case 'beam': {
      const a = point(m.a);
      const b = point(m.b);
      return a && b && Number.isInteger(m.kind) ? { op: 'beam', a, b, kind: m.kind as number } : null;
    }
    case 'unbeam': {
      const id = str('id');
      return id ? { op: 'unbeam', id } : null;
    }
    case 'control': {
      const control = str('control');
      if (!control) return null;
      return {
        op: 'control', control: control as never,
        value: finite(m.value) ? m.value : undefined, body: str('body') ?? undefined, entry: str('entry') ?? undefined,
        x: finite(m.x) ? m.x : undefined, y: finite(m.y) ? m.y : undefined,
      };
    }
    default:
      return null;
  }
}
