import type { Id, PhysicsInput, PhysicsLayout, PhysicsPose, PhysicsSnapshot, PhysicsWatch, ScenePhysics } from '@qbl/shared';
import { PhysicsSim } from '@qbl/shared/physics-sim';
import type { GameConnection } from '../net/Connection';

/**
 * Where a scene's experiment comes from: run here (each player their own), or run by the game
 * server and shown here (shared). Both give the same layout and snapshots, so drawing and the
 * controls do not care which.
 */
export interface PhysicsSource {
  readonly shared: boolean;
  /** Move time on (local) or work out where things are now between two snapshots (shared). */
  update(deltaMs: number): void;
  layout(): PhysicsLayout;
  /** How things stand now, or null while a shared experiment has not arrived yet. */
  frame(): PhysicsSnapshot | null;
  /** Do something to the experiment. Returns why it was refused, when that is known at once. */
  input(msg: PhysicsInput): string | null;
  destroy(): void;
}

/** Called when a watch fires, with the reading that made it fire. */
export type WatchHandler = (watch: PhysicsWatch, value: number | null) => void;

/** The experiment run in this browser. */
export class LocalPhysics implements PhysicsSource {
  readonly shared = false;
  readonly sim: PhysicsSim;
  private snap: PhysicsSnapshot | null = null;

  constructor(def: ScenePhysics, size: { width: number; height: number }, onWatch: WatchHandler, onBreak?: (id: string) => void) {
    this.sim = new PhysicsSim(def, size, { fired: onWatch, broke: onBreak });
  }

  update(deltaMs: number) {
    this.sim.advance(deltaMs / 1000);
    this.snap = null;
  }

  layout(): PhysicsLayout {
    return this.sim.layout();
  }

  frame(): PhysicsSnapshot {
    return (this.snap ??= this.sim.snapshot());
  }

  input(msg: PhysicsInput): string | null {
    const problem = this.sim.input('me', msg);
    this.snap = null;
    return problem;
  }

  destroy() {}
}

/** Snapshots are drawn this far behind the newest, so there are two to move smoothly between. */
const INTERPOLATION_MS = 110;

/** The experiment the game server runs for everyone in the scene: shown here, changed by messages. */
export class SharedPhysics implements PhysicsSource {
  readonly shared = true;
  private current: PhysicsLayout = { version: 0, spawned: [], removed: [], design: [], tray: {} };
  private snaps: Array<{ at: number; snap: PhysicsSnapshot }> = [];
  private shown: PhysicsSnapshot | null = null;
  private off: Array<() => void> = [];

  constructor(private connection: GameConnection, private sceneId: Id, onWatch: WatchHandler, def: ScenePhysics, private now: () => number = () => performance.now()) {
    this.off.push(
      connection.on('physicsState', (m) => {
        if (m.scene_id !== sceneId) return;
        this.current = { version: m.version, spawned: m.spawned, removed: m.removed, design: m.design, tray: m.tray };
        // A new layout (a reset, a design tested) is drawn as it is, not blended with what came before.
        this.snaps = [{ at: this.now(), snap: m.snap }];
      }),
      connection.on('physicsTick', (m) => {
        if (m.scene_id !== sceneId || m.version !== this.current.version) return;
        this.snaps.push({ at: this.now(), snap: m.snap });
        if (this.snaps.length > 6) this.snaps.shift();
      }),
      connection.on('physicsWatch', (m) => {
        if (m.scene_id !== sceneId) return;
        const watch = (def.watches ?? []).find((w) => w.id === m.watch_id);
        if (watch) onWatch(watch, m.value);
      }),
    );
    // Ask for the experiment as it stands: the server answers with its state.
    connection.physics({ op: 'sync', scene_id: sceneId });
  }

  update() {
    if (!this.snaps.length) return;
    const at = this.now() - INTERPOLATION_MS;
    let i = this.snaps.length - 1;
    while (i > 0 && this.snaps[i - 1]!.at > at) i--;
    const b = this.snaps[i]!;
    const a = this.snaps[i - 1];
    if (!a || b.at <= a.at || at >= b.at) {
      this.shown = b.snap;
      return;
    }
    const f = Math.max(0, Math.min(1, (at - a.at) / (b.at - a.at)));
    this.shown = blend(a.snap, b.snap, f);
  }

  layout(): PhysicsLayout {
    return this.current;
  }

  frame(): PhysicsSnapshot | null {
    return this.shown ?? this.snaps[this.snaps.length - 1]?.snap ?? null;
  }

  input(msg: PhysicsInput): string | null {
    this.connection.physics({ ...msg, scene_id: this.sceneId });
    return null;
  }

  destroy() {
    for (const off of this.off) off();
  }
}

/** Poses part of the way from one snapshot to the next; everything else is the newer one's. */
function blend(a: PhysicsSnapshot, b: PhysicsSnapshot, f: number): PhysicsSnapshot {
  const before = new Map(a.bodies.map((p) => [p[0], p]));
  const bodies = b.bodies.map((p): PhysicsPose => {
    const q = before.get(p[0]);
    if (!q) return p;
    let da = p[3] - q[3];
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    return [p[0], q[1] + (p[1] - q[1]) * f, q[2] + (p[2] - q[2]) * f, q[3] + da * f];
  });
  const waterBefore = new Map(a.water.map((w) => [w[0], w]));
  const water = b.water.map((w): [string, number, number] => {
    const q = waterBefore.get(w[0]);
    return q ? [w[0], q[1] + (w[1] - q[1]) * f, w[2]] : w;
  });
  return { ...b, bodies, water };
}
