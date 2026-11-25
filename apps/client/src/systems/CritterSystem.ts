import type * as Phaser from 'phaser';
import { findAnimation, isBuiltInSound, scaleAt, type Point, type SceneCritter } from '@qbl/shared';
import { synthFor } from '../audio/synth';
import { mediaKey } from '../core/assets';
import { Depth } from '../core/depth';
import { figureDepth } from '../core/sorting';
import { Figure } from '../entities/Figure';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { LocalPlayerSystem } from './LocalPlayerSystem';
import { moving } from './LightSystem';
import { PropsSystem } from './PropsSystem';
import { RemotePlayersSystem } from './RemotePlayersSystem';

/** What a critter does next, one step at a time. */
type Step =
  | { kind: 'move'; to: Point; speed: number; anim: Move; airborne?: boolean; hop?: boolean; climb?: boolean }
  | { kind: 'pause'; ms: number; anim: Move; turn?: boolean }
  | { kind: 'fade'; ms: number; to: number }
  | { kind: 'gone' };

type Move = 'idle' | 'walk' | 'run' | 'fly' | 'take_off' | 'land' | 'peck' | 'hop' | 'climb';

/** One creature on the screen (a flock is several). */
interface Body {
  figure: Figure;
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  x: number;
  y: number;
  /** Where it was when the step began, for hops. */
  from: Point;
  steps: Step[];
  /** Milliseconds into the current step. */
  t: number;
  facing: 'left' | 'right';
  airborne: boolean;
  climbing: boolean;
  /** The depth it keeps while climbing: just in front of its tree. */
  climbDepth: number;
  alpha: number;
  playing: string;
  scattered: boolean;
  /** Where it is in a flock: its offset from the leader's spot. */
  offset: Point;
}

/** A critter's visits: when the next one is, and who is on screen. */
interface Critter {
  def: SceneCritter;
  next: number;
  bodies: Body[];
}

/** How fast each behaviour moves by default, in scene pixels per second. */
const SPEED: Record<SceneCritter['behavior'], number> = {
  lands: 330, climbs: 260, hides: 210, walks_by: 80, flies_by: 280, swims_by: 130, drives_by: 380,
};

/** What to play when a sheet has no animation of the name wanted, in order. */
const FALLBACK: Record<Move, Move[]> = {
  idle: [],
  walk: ['idle'],
  run: ['walk', 'idle'],
  hop: ['walk', 'run', 'idle'],
  climb: ['run', 'walk'],
  fly: ['walk'],
  take_off: ['fly', 'walk'],
  land: ['fly', 'idle'],
  peck: ['idle'],
};

/**
 * Scene.critters: little life that has nothing to do with the lesson. Birds fly in, land, peck and
 * hop about, and fly off; a squirrel scampers about and runs up a tree; a rabbit pops out of a bush,
 * sits twitching its nose, and hops into another. Now and then, on each player's own screen (they
 * are not shared through the room). A shy critter scatters as soon as anyone comes near: a player,
 * another player or a character.
 *
 * Each critter is a Figure, so a sprite sheet's named animations play (idle, walk, fly, peck, hop...)
 * and a single picture still hops and glides. On the floor it is drawn among the figures by where its
 * feet are (and in front of or behind an item's sort line), and smaller at the back of the floor; up
 * in the air it is drawn over the scenery.
 *
 * With reduced motion asked for, there are none.
 */
export class CritterSystem implements SceneSystem {
  private critters: Critter[] = [];
  private clock = 0;

  constructor(private rt: SceneRuntime) {}

  create() {
    const defs = this.rt.def.critters ?? [];
    if (!defs.length || !moving()) return;
    // The first visits come soon, a little apart, so a scene feels alive from the start.
    this.critters = defs.map((def, i) => ({ def, next: 2500 + i * 3500 + Math.random() * 4000, bodies: [] }));
  }

  update(_time: number, delta: number) {
    if (!this.critters.length) return;
    const dt = Math.min(delta, 100);
    this.clock += dt;
    const near = this.figures();
    for (const c of this.critters) {
      if (!c.bodies.length) {
        if (this.clock >= c.next) this.visit(c);
        continue;
      }
      for (const b of c.bodies) {
        if (!b.scattered && this.scares(c, b, near)) this.scatter(c, b, near);
        this.advance(c, b, dt);
      }
      // Once all of a visit is gone, the next one is a while off.
      if (c.bodies.every((b) => b.steps.length === 0 || b.steps[0]!.kind === 'gone')) {
        for (const b of c.bodies) b.figure.destroy();
        c.bodies = [];
        const [lo, hi] = c.def.every ?? [12, 28];
        c.next = this.clock + 1000 * (lo + Math.random() * Math.max(0, hi - lo));
      }
    }
  }

  destroy() {
    for (const c of this.critters) for (const b of c.bodies) b.figure.destroy();
    this.critters = [];
  }

  /** How many are on screen now (for tests). */
  get showing(): number {
    return this.critters.reduce((n, c) => n + c.bodies.length, 0);
  }

  // ---------------------------------------------------------------- a visit

  private visit(c: Critter) {
    const { def } = c;
    const W = this.rt.size.width;
    const H = this.rt.size.height;
    const fromLeft = Math.random() < 0.5;
    const edge = fromLeft ? -80 : W + 80;
    const other = fromLeft ? W + 80 : -80;
    const speed = def.speed ?? SPEED[def.behavior];
    const spots = def.spots ?? [];
    const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!;
    const floorY = spots.length ? spots.reduce((n, s) => n + s.y, 0) / spots.length : H * 0.78;
    const count = def.behavior === 'lands' ? Math.max(1, Math.min(6, def.count ?? 1)) : 1;
    const leaderSpot = spots.length ? pick(spots) : { x: W * (0.3 + Math.random() * 0.4), y: floorY };

    for (let n = 0; n < count; n++) {
      const offset = { x: n === 0 ? 0 : (Math.random() - 0.5) * 220, y: n === 0 ? 0 : (Math.random() - 0.5) * 50 };
      const steps: Step[] = [];
      let start: Point;
      switch (def.behavior) {
        case 'lands': {
          const land = { x: leaderSpot.x + offset.x, y: leaderSpot.y + offset.y };
          start = { x: edge, y: Math.max(40, land.y - 420 - Math.random() * 160) };
          steps.push({ kind: 'move', to: land, speed, anim: 'fly', airborne: true });
          steps.push({ kind: 'pause', ms: 450, anim: 'land' });
          let at = land;
          for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
            steps.push({ kind: 'pause', ms: 900 + Math.random() * 1400, anim: Math.random() < 0.6 ? 'peck' : 'idle', turn: Math.random() < 0.3 });
            at = { x: at.x + (Math.random() - 0.5) * 90, y: at.y + (Math.random() - 0.5) * 24 };
            steps.push({ kind: 'move', to: at, speed: 90, anim: 'hop', hop: true });
          }
          steps.push({ kind: 'pause', ms: 380, anim: 'take_off' });
          steps.push({ kind: 'move', to: { x: other, y: Math.max(-60, at.y - 520) }, speed: speed * 1.1, anim: 'fly', airborne: true });
          steps.push({ kind: 'gone' });
          break;
        }
        case 'climbs': {
          const trees = spots.filter((s) => s.top != null);
          const tree = trees.length ? pick(trees) : null;
          const y = tree ? tree.y + 20 : floorY;
          start = { x: edge, y };
          // In, a dart or two about the floor, a look round, then up the tree (or away off the far edge).
          const mid = { x: W * (0.25 + Math.random() * 0.5), y: y + (Math.random() - 0.3) * 60 };
          steps.push({ kind: 'move', to: mid, speed, anim: 'run' });
          steps.push({ kind: 'pause', ms: 700 + Math.random() * 1200, anim: 'idle', turn: true });
          const dart = { x: mid.x + (Math.random() - 0.5) * 300, y: mid.y + (Math.random() - 0.5) * 40 };
          steps.push({ kind: 'move', to: dart, speed: speed * 1.2, anim: 'run' });
          steps.push({ kind: 'pause', ms: 900 + Math.random() * 1500, anim: 'idle', turn: true });
          steps.push(...this.escape(def, dart, tree, other));
          break;
        }
        case 'hides': {
          const bushes = spots.slice();
          if (bushes.length >= 2) {
            const a = bushes.splice(Math.floor(Math.random() * bushes.length), 1)[0]!;
            const b = pick(bushes);
            // Out of the bush it was hidden in (drawn behind it), hopping out to sit in front.
            start = { x: a.x, y: a.y - 8 };
            const dir = b.x > a.x ? 1 : -1;
            const sit = { x: a.x + dir * (70 + Math.random() * 60), y: a.y + 28 };
            steps.push({ kind: 'move', to: sit, speed: speed * 0.6, anim: 'hop', hop: true });
            steps.push({ kind: 'pause', ms: 2200 + Math.random() * 2500, anim: 'idle' });
            steps.push({ kind: 'pause', ms: 900 + Math.random() * 900, anim: 'idle', turn: true });
            steps.push({ kind: 'pause', ms: 1200 + Math.random() * 1500, anim: 'idle', turn: true });
            steps.push(...this.escape(def, sit, b, other));
          } else {
            const spot = bushes[0] ?? leaderSpot;
            start = { x: edge, y: spot.y + 28 };
            const sit = { x: W * (0.3 + Math.random() * 0.4), y: spot.y + 28 };
            steps.push({ kind: 'move', to: sit, speed: speed * 0.6, anim: 'hop', hop: true });
            steps.push({ kind: 'pause', ms: 2500 + Math.random() * 3000, anim: 'idle', turn: true });
            steps.push(...this.escape(def, sit, bushes[0] ?? null, other));
          }
          break;
        }
        case 'flies_by':
        case 'swims_by': {
          const y = def.behavior === 'flies_by' ? H * (0.12 + Math.random() * 0.15) : H * (0.35 + Math.random() * 0.3);
          start = { x: edge, y: y + offset.y };
          steps.push({ kind: 'move', to: { x: other, y: y - 60 + offset.y }, speed, anim: 'fly', airborne: true });
          steps.push({ kind: 'gone' });
          break;
        }
        default: {
          // walks_by, drives_by: across the floor, at a spot's depth if it has one.
          const y = (spots.length ? pick(spots).y : floorY) + offset.y;
          start = { x: edge, y };
          steps.push({ kind: 'move', to: { x: other, y }, speed, anim: def.behavior === 'drives_by' ? 'walk' : Math.random() < 0.25 ? 'run' : 'walk' });
          steps.push({ kind: 'gone' });
        }
      }
      c.bodies.push(this.body(def, start, steps, offset));
    }
    if (def.sound && isBuiltInSound(def.sound)) {
      try {
        synthFor(this.rt.scene).play(def.sound, { volume: 0.55, loop: false });
      } catch {
        /* no sound here: the critter comes all the same */
      }
    }
  }

  /**
   * The way out: up its tree (a climber), into its bush (a hider), or off the far edge.
   * Faster when it is fleeing.
   */
  private escape(def: SceneCritter, from: Point, to: { x: number; y: number; top?: number } | null, edge: number, fleeing = false): Step[] {
    const speed = (def.speed ?? SPEED[def.behavior]) * (fleeing ? 1.6 : 1);
    if (def.behavior === 'climbs' && to?.top != null) {
      return [
        { kind: 'move', to: { x: to.x, y: to.y + 6 }, speed, anim: 'run' },
        { kind: 'move', to: { x: to.x, y: to.top }, speed: speed * 0.55, anim: 'climb', climb: true },
        { kind: 'fade', ms: 350, to: 0 },
        { kind: 'gone' },
      ];
    }
    if (def.behavior === 'hides' && to) {
      return [
        // Hopping to just behind its base: it is then drawn behind the bush, as if gone into it.
        { kind: 'move', to: { x: to.x, y: to.y - 8 }, speed: speed * (fleeing ? 1 : 0.6), anim: 'hop', hop: true },
        { kind: 'fade', ms: 250, to: 0 },
        { kind: 'gone' },
      ];
    }
    return [{ kind: 'move', to: { x: edge, y: from.y }, speed, anim: def.behavior === 'hides' ? 'hop' : 'run', hop: def.behavior === 'hides' }, { kind: 'gone' }];
  }

  private body(def: SceneCritter, at: Point, steps: Step[], offset: Point): Body {
    const media = this.rt.ctx.index.media.get(def.media_id);
    const figure = new Figure(this.rt.scene, media, mediaKey(def.media_id), at.x, at.y);
    const sprite = figure.object.setOrigin(0.5, 1);
    return {
      figure, sprite, x: at.x, y: at.y, from: { ...at }, steps, t: 0, facing: 'right', airborne: false, climbing: false, climbDepth: 0,
      alpha: 1, playing: '', scattered: false, offset,
    };
  }

  // ---------------------------------------------------------------- moving it on

  private advance(c: Critter, b: Body, dt: number) {
    const step = b.steps[0];
    b.figure.tick(dt);
    if (!step || step.kind === 'gone') {
      b.sprite.setVisible(false);
      return;
    }
    b.t += dt;
    let finished = false;
    switch (step.kind) {
      case 'move': {
        const dx = step.to.x - b.x;
        const dy = step.to.y - b.y;
        const dist = Math.hypot(dx, dy);
        const go = (step.speed * dt) / 1000;
        if (Math.abs(dx) > 1) b.facing = dx < 0 ? 'left' : 'right';
        b.airborne = !!step.airborne;
        if (step.climb && !b.climbing) {
          b.climbing = true;
          b.climbDepth = figureDepth(this.rt.scene, b.x, b.y + 4, 4) + 0.5;
        }
        if (dist <= go) {
          b.x = step.to.x;
          b.y = step.to.y;
          finished = true;
        } else {
          b.x += (dx / dist) * go;
          b.y += (dy / dist) * go;
        }
        this.show(c, b, step.anim);
        break;
      }
      case 'pause':
        if (step.turn && b.t - dt <= step.ms / 2 && b.t > step.ms / 2) b.facing = b.facing === 'left' ? 'right' : 'left';
        this.show(c, b, step.anim);
        finished = b.t >= step.ms;
        break;
      case 'fade':
        b.alpha = Math.max(0, Math.min(1, b.alpha + (step.to - b.alpha) * Math.min(1, dt / Math.max(1, step.ms - b.t + dt))));
        finished = b.t >= step.ms;
        if (finished) b.alpha = step.to;
        break;
    }
    this.draw(c, b);
    if (finished) {
      b.steps.shift();
      b.t = 0;
      b.from = { x: b.x, y: b.y };
    }
  }

  private draw(c: Critter, b: Body) {
    const { def } = c;
    const { scene, def: sceneDef, zoom } = this.rt;
    const step = b.steps[0];
    // Hops lift it off the floor a little, every 70 pixels or so: it hops even with one picture.
    let lift = 0;
    if (step?.kind === 'move' && step.hop) {
      const travelled = Math.hypot(b.x - b.from.x, b.y - b.from.y);
      lift = Math.abs(Math.sin((travelled / 70) * Math.PI)) * 16;
    }
    const ground = b.airborne ? Math.min(b.y, sceneDef.height ?? b.y) : b.y;
    const size = (def.scale ?? 1) * zoom * (b.airborne ? scaleAt(sceneDef, b.x, this.rt.size.height * 0.8) : scaleAt(sceneDef, b.x, ground));
    b.sprite.setVisible(b.alpha > 0.01).setAlpha(b.alpha).setPosition(b.x, b.y - lift).setScale(size);
    if (b.climbing) {
      // Up the trunk, head first: the picture turned to face up the tree, in front of it.
      b.sprite.setRotation(b.facing === 'left' ? Math.PI / 2 : -Math.PI / 2).setDepth(b.climbDepth);
    } else {
      b.sprite.setRotation(0);
      const half = (b.sprite.width * size) / 2;
      b.sprite.setDepth(b.airborne ? Depth.foreground - 50 : figureDepth(scene, b.x, b.y, half));
    }
    b.sprite.setFlipX((b.facing === 'left') !== ((def.faces ?? 'right') === 'left'));
  }

  /** Play the move asked for, or the nearest one the sheet has. */
  private show(c: Critter, b: Body, move: Move) {
    const media = this.rt.ctx.index.media.get(c.def.media_id);
    const names = [move, ...FALLBACK[move]].map((m) => c.def.animations?.[m] ?? m);
    const name = names.find((n) => findAnimation(media, n)) ?? '';
    // A move that does not loop is started again when it ends: a bird pecks, and pecks again.
    if (name && (name !== b.playing || !b.figure.acting)) {
      b.figure.play(name);
      b.playing = name;
    } else if (!name && b.playing) {
      b.figure.play('');
      b.playing = '';
    }
  }

  // ---------------------------------------------------------------- scattering

  /** Everyone in the scene who can frighten a critter: the player, other players, characters on the stage. */
  private figures(): Point[] {
    const out: Point[] = [];
    if (this.rt.def.show_avatars !== false) {
      const me = this.rt.system(LocalPlayerSystem).avatar;
      if (me) out.push({ x: me.x, y: me.y });
      out.push(...this.rt.system(RemotePlayersSystem).feet());
    }
    out.push(...this.rt.system(PropsSystem).onStage().map((c) => ({ x: c.x, y: c.y })));
    return out;
  }

  /** Whether anyone is too close: nearer than `shy`, measured flatter across than in depth (the floor is seen at a slant). */
  private scares(c: Critter, b: Body, near: Point[]): boolean {
    const shy = c.def.shy ?? 170;
    if (shy <= 0 || b.climbing || b.alpha < 0.5) return false;
    const step = b.steps[0];
    if (!step || step.kind === 'gone' || step.kind === 'fade') return false;
    // Already flying away, or only passing by up high.
    if (b.airborne && (c.def.behavior !== 'lands' || step.kind === 'move' && step.to.x < -40 || step.kind === 'move' && step.to.x > this.rt.size.width + 40)) return false;
    return near.some((p) => Math.hypot(p.x - b.x, (p.y - b.y) * 1.8) < shy);
  }

  /** Off it goes, now, away from whoever came near. */
  private scatter(c: Critter, b: Body, near: Point[]) {
    b.scattered = true;
    const W = this.rt.size.width;
    const who = near.reduce((best, p) => (Math.hypot(p.x - b.x, p.y - b.y) < Math.hypot(best.x - b.x, best.y - b.y) ? p : best), near[0]!);
    const away = who.x < b.x ? W + 80 : -80;
    const spots = c.def.spots ?? [];
    b.t = 0;
    b.from = { x: b.x, y: b.y };
    switch (c.def.behavior) {
      case 'lands':
        b.steps = [
          { kind: 'pause', ms: 160, anim: 'take_off' },
          { kind: 'move', to: { x: away, y: Math.max(-80, b.y - 560) }, speed: (c.def.speed ?? SPEED.lands) * 1.5, anim: 'fly', airborne: true },
          { kind: 'gone' },
        ];
        break;
      case 'climbs':
      case 'hides': {
        // The nearest tree or bush that is not past whoever frightened it; else away off the edge.
        const wanted = spots.filter((s) => (c.def.behavior === 'climbs' ? s.top != null : true) && Math.sign(s.x - who.x) === Math.sign(b.x - who.x) || Math.abs(s.x - b.x) < 60);
        const refuge = wanted.sort((p, q) => Math.abs(p.x - b.x) - Math.abs(q.x - b.x))[0] ?? null;
        b.steps = this.escape(c.def, { x: b.x, y: b.y }, refuge, away, true);
        break;
      }
      default:
        if (c.def.behavior === 'walks_by') b.steps = [{ kind: 'move', to: { x: away, y: b.y }, speed: (c.def.speed ?? SPEED.walks_by) * 3, anim: 'run' }, { kind: 'gone' }];
    }
  }
}
