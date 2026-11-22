import * as Phaser from 'phaser';
import {
  BENCH_TOOLS, fillHeight, outlineBand, toolSize, vesselCapacity, vesselHeight, vesselName, vesselOutline, vesselWidth,
  type BenchSim, type BenchTool, type BenchVessel, type Point, type SceneBench,
} from '@qbl/shared';

/** The bench is drawn over the backgrounds and figures, under foreground layers. */
const DEPTH = 90_000;
const GLASS = 0xffffff;
const HELD = 0xffd34d;
/** The dark edge that makes glass show against a pale background. */
const EDGE = 0x24364a;
const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Montserrat, system-ui, sans-serif', fontSize: '18px', color: '#ffffff', stroke: '#1b1b2f', strokeThickness: 4, fontStyle: '700', align: 'center',
};
const SMALL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = { ...LABEL_STYLE, fontSize: '13px', strokeThickness: 3 };

/** What the player is doing, which the drawing shows. */
export interface BenchDrawState {
  /** The container or tool in the player's hand. */
  held: string | null;
  /** What the pointer is over. */
  hover: string | null;
  /** A pour going on: from, into, its colour, and how far through it is (0 to 1). */
  pour: { from: string; to: string; color: string; t: number } | null;
  /** Seconds since the scene began, for what flickers and bubbles. */
  time: number;
}

export function colorNumber(css: string | undefined, fallback = 0x9ec9f5): number {
  const m = /^#?([0-9a-f]{6})$/i.exec((css ?? '').trim());
  return m ? parseInt(m[1]!, 16) : fallback;
}

/** Phaser's types ask for its own vectors; plain points are what it reads. */
const v2 = (points: Point[]) => points as unknown as Phaser.Math.Vector2[];

/** A number that looks random but is the same every time for the same seed: bubbles keep their places between frames. */
const noise = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Where a container is drawn: lifted when it is in the hand, moved over and tipped while it pours. */
interface Pose {
  dx: number;
  dy: number;
  angle: number;
}

/**
 * Draws a close-up bench from its simulation: each container with what is in it in layers, what
 * its reactions look like, the burners, the stirring rod, the sink, and what is in the player's
 * hand. Everything is redrawn each frame; a dozen containers cost nothing.
 */
export class BenchRenderer {
  private back: Phaser.GameObjects.Graphics;
  private liquid: Phaser.GameObjects.Graphics;
  private front: Phaser.GameObjects.Graphics;
  private texts = new Map<string, Phaser.GameObjects.Text>();
  private used = new Set<string>();
  private poses = new Map<string, Pose>();
  private outlines = new Map<string, Point[]>();
  private heated = new Set<string>();

  constructor(private scene: Phaser.Scene, private def: SceneBench) {
    this.back = scene.add.graphics().setDepth(DEPTH);
    this.liquid = scene.add.graphics().setDepth(DEPTH + 1);
    this.front = scene.add.graphics().setDepth(DEPTH + 2);
    for (const v of def.vessels ?? []) this.outlines.set(v.id, vesselOutline(v.shape, vesselWidth(v), vesselHeight(v)));
    for (const t of def.tools ?? []) if (t.kind === 'burner' && t.vessel_id) this.heated.add(t.vessel_id);
  }

  /** Where the mouth of a container is right now, in the scene: where a stirring rod goes in, where a stream leaves. */
  private pose(v: BenchVessel, state: BenchDrawState, delta: number): Pose {
    const target: Pose = { dx: 0, dy: 0, angle: 0 };
    const pour = state.pour;
    if (pour && pour.from === v.id) {
      const into = this.def.vessels?.find((x) => x.id === pour.to);
      if (into) {
        // Over the other container, to one side of its mouth, tipped towards it.
        const side = v.x <= into.x ? -1 : 1;
        const reach = vesselWidth(into) / 2 + vesselHeight(v) * 0.45;
        target.dx = into.x + side * reach - v.x;
        target.dy = into.y - vesselHeight(into) - 40 - (v.y - vesselHeight(v) * 0.5);
        target.angle = -side * 1.15;
      }
    } else if (state.held === v.id) target.dy = -28;
    const now = this.poses.get(v.id) ?? { dx: 0, dy: 0, angle: 0 };
    const k = Math.min(1, delta / 110);
    const next = { dx: now.dx + (target.dx - now.dx) * k, dy: now.dy + (target.dy - now.dy) * k, angle: now.angle + (target.angle - now.angle) * k };
    this.poses.set(v.id, next);
    return next;
  }

  /** A point of a container's inside (pixels from the middle of its foot, y up) in the scene, as the container is posed. */
  private place(v: BenchVessel, pose: Pose, p: Point): Point {
    const h = vesselHeight(v);
    // It turns about the middle of its body.
    const px = p.x;
    const py = p.y - h / 2;
    const c = Math.cos(pose.angle);
    const s = Math.sin(pose.angle);
    return { x: v.x + pose.dx + px * c + py * s, y: v.y + pose.dy - h / 2 - (-px * s + py * c) };
  }

  draw(sim: BenchSim, state: BenchDrawState, delta: number) {
    this.used.clear();
    const { back, liquid, front } = this;
    back.clear();
    liquid.clear();
    front.clear();

    for (const t of this.def.tools ?? []) this.drawTool(t, sim, state);

    // What is in the hand is drawn last, over the rest.
    const vessels = [...(this.def.vessels ?? [])].sort((a, b) => Number(a.id === state.held) - Number(b.id === state.held));
    let lip: Point | null = null;
    for (const v of vessels) {
      const pose = this.pose(v, state, delta);
      const outline = this.outlines.get(v.id)!;
      const view = sim.view(v.id);
      const to = (p: Point) => this.place(v, pose, p);
      const w = vesselWidth(v);
      const h = vesselHeight(v);

      // The glass, faintly, behind what is in it.
      back.fillStyle(GLASS, 0.3);
      back.fillPoints(v2(outline.map(to)), true);

      let top = 0;
      for (const layer of view.layers) {
        const from = fillHeight(outline, layer.from);
        // What has settled is never too thin to see.
        top = Math.max(fillHeight(outline, layer.to), layer.solid ? from + 7 : 0);
        const band = outlineBand(outline, from, top);
        if (band.length < 3) continue;
        liquid.fillStyle(colorNumber(layer.color), layer.solid ? 1 : Math.max(0.5, layer.alpha));
        liquid.fillPoints(v2(band.map(to)), true);
        if (layer.solid) {
          // A powder on the bottom: an edge along its top, so a little of it still shows.
          const crust = outlineBand(outline, Math.max(from, top - 3), top);
          if (crust.length >= 3) {
            liquid.fillStyle(EDGE, 0.35);
            liquid.fillPoints(v2(crust.map(to)), true);
          }
        }
      }
      if (view.layers.length && top > 0) {
        // The surface catches the light.
        const surface = outlineBand(outline, Math.max(0, top - 3), top);
        if (surface.length >= 3) {
          liquid.fillStyle(0xffffff, 0.28);
          liquid.fillPoints(v2(surface.map(to)), true);
        }
      }
      this.drawEffects(v, view, outline, top, to, state.time);
      if (view.stirred && top > 0) {
        // A rod in it, going round.
        const sway = Math.sin(state.time * 9) * w * 0.18;
        const rod: [number, number, number, number] = [to({ x: sway, y: top * 0.25 }).x, to({ x: sway, y: top * 0.25 }).y, to({ x: -sway * 0.6 + w * 0.12, y: h + 46 }).x, to({ x: -sway * 0.6 + w * 0.12, y: h + 46 }).y];
        front.lineStyle(9, EDGE, 0.55);
        front.lineBetween(...rod);
        front.lineStyle(5, 0xd8dee9, 1);
        front.lineBetween(...rod);
      }

      // The glass itself: its walls (open at the mouth), a rim, and a scale if it has one. A dark
      // line under a light one, so it shows against a pale wall and a dark one alike.
      const strong = state.held === v.id;
      const lit = strong || state.hover === v.id;
      const first = outline[0]!;
      const last = outline.at(-1)!;
      const rim = 6;
      const walls = v2([{ x: first.x - rim, y: first.y }, ...outline, { x: last.x + rim, y: last.y }].map(to));
      front.lineStyle(strong ? 9 : 7, EDGE, lit ? 0.75 : 0.55);
      front.strokePoints(walls, false);
      front.lineStyle(strong ? 5 : 3, strong ? HELD : GLASS, 1);
      front.strokePoints(walls, false);
      this.drawExtras(v, outline, to, view.layers.at(-1)?.color);
      if (v.marks) this.drawMarks(v, outline, to, pose);

      // What stands on a burner has the burner's name under it instead.
      if (v.label !== false && !this.heated.has(v.id) && Math.abs(pose.angle) < 0.05 && Math.abs(pose.dx) < 2) {
        this.text(`name:${v.id}`, v.x + pose.dx, v.y + 10, vesselName(v), LABEL_STYLE, 0.5, 0);
      }
      if (state.pour?.from === v.id) lip = to(pose.angle > 0 ? last : first);
    }

    // The stream, from the lip of what is being tipped down to the surface of what it goes into.
    const pour = state.pour;
    const into = pour ? this.def.vessels?.find((x) => x.id === pour.to) : undefined;
    const fromPose = pour ? this.poses.get(pour.from) : undefined;
    if (pour && into && lip && fromPose && Math.abs(fromPose.angle) > 0.6 && pour.t > 0.25 && pour.t < 0.85) {
      const surface = into.y - sim.surface(into.id);
      const colour = colorNumber(pour.color);
      liquid.lineStyle(7, colour, 0.9);
      liquid.beginPath();
      liquid.moveTo(lip.x, lip.y);
      const landX = Math.max(into.x - vesselWidth(into) * 0.3, Math.min(into.x + vesselWidth(into) * 0.3, lip.x));
      liquid.lineTo(landX, lip.y + 14);
      liquid.lineTo(landX, Math.max(lip.y + 14, surface));
      liquid.strokePath();
    }

    for (const [key, text] of this.texts) text.setVisible(this.used.has(key));
  }

  /** What a reaction looks like: bubbles rising, foam, smoke, a glow, a flash. */
  private drawEffects(v: BenchVessel, view: ReturnType<BenchSim['view']>, outline: Point[], top: number, to: (p: Point) => Point, time: number) {
    const { liquid, front } = this;
    const w = vesselWidth(v);
    const h = vesselHeight(v);
    const seed = [...v.id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    // Where the inside is narrower than the container (a flask's neck), bubbles keep to the middle.
    const half = (y: number) => {
      const band = outlineBand(outline, Math.max(0, y - 1), y + 1);
      return band.length ? Math.max(4, (Math.max(...band.map((p) => p.x)) - Math.min(...band.map((p) => p.x))) / 2 - 5) : w / 2 - 5;
    };
    for (const effect of view.effects) {
      const colour = colorNumber(effect.color, 0xffffff);
      if ((effect.kind === 'bubbles' || effect.kind === 'fizz') && top > 4) {
        const count = Math.round((effect.kind === 'fizz' ? 26 : 14) * effect.strength);
        for (let i = 0; i < count; i++) {
          const speed = 0.5 + noise(seed + i * 3.1) * 0.9;
          const phase = (time * speed + noise(seed + i * 7.7)) % 1;
          const y = phase * top;
          const x = (noise(seed + i * 1.3) * 2 - 1) * half(y) + Math.sin(time * 5 + i) * 2;
          liquid.fillStyle(colour, 0.75 * (1 - phase * 0.5));
          const at = to({ x, y });
          liquid.fillCircle(at.x, at.y, 2 + noise(seed + i * 5.9) * 3.5);
        }
      }
      if (effect.kind === 'fizz' && top > 0) {
        // A head of foam on top.
        for (let i = 0; i < 9; i++) {
          const x = ((i + 0.5) / 9 * 2 - 1) * half(top);
          const at = to({ x, y: top + 3 + Math.sin(time * 6 + i * 1.7) * 2.5 });
          front.fillStyle(colour, 0.85 * effect.strength);
          front.fillCircle(at.x, at.y, 7 + noise(seed + i) * 4);
        }
      }
      if (effect.kind === 'smoke') {
        for (let i = 0; i < 8; i++) {
          const phase = (time * (0.25 + noise(seed + i * 2.3) * 0.2) + noise(seed + i * 9.1)) % 1;
          const at = to({ x: (noise(seed + i * 4.4) * 2 - 1) * w * 0.25 + Math.sin(time * 1.5 + i) * 10 * phase, y: h + phase * 150 });
          front.fillStyle(colour, 0.45 * (1 - phase) * effect.strength);
          front.fillCircle(at.x, at.y, 12 + phase * 26);
        }
      }
      if (effect.kind === 'glow' || effect.kind === 'flash') {
        const at = to({ x: 0, y: Math.max(top / 2, 10) });
        const beat = effect.kind === 'flash' ? effect.strength : 0.75 + Math.sin(time * 4) * 0.25;
        for (let r = 0; r < 4; r++) {
          front.fillStyle(colour, 0.11 * beat * effect.strength);
          front.fillCircle(at.x, at.y, Math.max(w, 60) * (0.45 + r * 0.22));
        }
      }
    }
    // Hot enough to steam, whatever is in it.
    if (view.temperature >= 80 && top > 0 && !view.effects.some((e) => e.kind === 'smoke')) {
      for (let i = 0; i < 4; i++) {
        const phase = (time * 0.3 + i / 4) % 1;
        const at = to({ x: Math.sin(time * 1.3 + i * 2) * w * 0.2, y: h + phase * 90 });
        front.fillStyle(0xb9c4ce, 0.32 * (1 - phase));
        front.fillCircle(at.x, at.y, 9 + phase * 16);
      }
    }
  }

  /** What makes a container look like what it is: a bottle's label, a dropper's bulb, a cylinder's foot. */
  private drawExtras(v: BenchVessel, outline: Point[], to: (p: Point) => Point, colour: string | undefined) {
    const { front } = this;
    const w = vesselWidth(v);
    const h = vesselHeight(v);
    const quad = (x0: number, y0: number, x1: number, y1: number) => v2([to({ x: x0, y: y0 }), to({ x: x1, y: y0 }), to({ x: x1, y: y1 }), to({ x: x0, y: y1 })]);
    if (v.shape === 'bottle' || v.shape === 'jar') {
      // A paper label, with a band of what is inside.
      front.fillStyle(0xfdfaf0, 0.95);
      front.fillPoints(quad(-w * 0.36, h * 0.2, w * 0.36, h * 0.5), true);
      front.fillStyle(colorNumber(colour, 0x9aa5b1), 1);
      front.fillPoints(quad(-w * 0.36, h * 0.2, w * 0.36, h * 0.27), true);
      // A stopper or a lid.
      const top = outline[0]!;
      front.fillStyle(v.shape === 'bottle' ? 0x8d6e4a : 0x6b7a8f, 1);
      front.fillPoints(quad(top.x - 4, h, -top.x + 4, h + (v.shape === 'bottle' ? 22 : 12)), true);
    } else if (v.shape === 'dropper') {
      const at = to({ x: 0, y: h + w * 0.55 });
      front.fillStyle(0xc0392b, 1);
      front.fillCircle(at.x, at.y, w * 0.62);
    } else if (v.shape === 'cylinder') {
      front.fillStyle(GLASS, 0.85);
      front.fillPoints(quad(-w * 0.9, -6, w * 0.9, 0), true);
    }
  }

  /** A scale up the side: ticks at round amounts, numbered in mL. */
  private drawMarks(v: BenchVessel, outline: Point[], to: (p: Point) => Point, pose: Pose) {
    const capacity = vesselCapacity(v);
    // Four to six ticks, at 1, 2 or 5 times a power of ten.
    const rough = capacity / 5;
    const power = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].map((m) => m * power).find((s) => capacity / s <= 6) ?? rough;
    for (let amount = step; amount <= capacity + 1e-9; amount += step) {
      const i = amount;
      const y = fillHeight(outline, amount / capacity);
      const band = outlineBand(outline, Math.max(0, y - 1), y + 1);
      const right = band.length ? Math.max(...band.map((p) => p.x)) : vesselWidth(v) / 2;
      const a = to({ x: right - 14, y });
      const b = to({ x: right - 2, y });
      this.front.lineStyle(4, EDGE, 0.5);
      this.front.lineBetween(a.x, a.y, b.x, b.y);
      this.front.lineStyle(2, GLASS, 1);
      this.front.lineBetween(a.x, a.y, b.x, b.y);
      if (Math.abs(pose.angle) < 0.05) this.text(`mark:${v.id}:${i}`, b.x + 12, b.y, String(Math.round(amount * 10) / 10), SMALL_STYLE, 0, 0.5);
    }
  }

  private drawTool(t: BenchTool, sim: BenchSim, state: BenchDrawState) {
    const { back, front } = this;
    const { w, h } = toolSize(t);
    const lit = state.hover === t.id || state.held === t.id;
    if (t.kind === 'burner') {
      const on = sim.burnerOn(t.id);
      back.fillStyle(0x3b4252, 1);
      back.fillRoundedRect(t.x - w / 2, t.y - 16, w, 16, 6);
      back.fillStyle(0x596275, 1);
      back.fillRect(t.x - 12, t.y - h * 0.55, 24, h * 0.55 - 14);
      if (lit) {
        back.lineStyle(3, HELD, 1);
        back.strokeRoundedRect(t.x - w / 2, t.y - 16, w, 16, 6);
      }
      if (on) {
        const flick = Math.sin(state.time * 17) * 4 + Math.sin(state.time * 29) * 2;
        const base = t.y - h * 0.55;
        back.fillStyle(0xff9f1c, 0.9);
        back.fillTriangle(t.x - 20, base, t.x + 20, base, t.x + flick * 0.5, base - 50 - flick);
        back.fillStyle(0x4dabf7, 0.95);
        back.fillTriangle(t.x - 11, base, t.x + 11, base, t.x, base - 26 - flick * 0.5);
      }
      this.text(`tool:${t.id}`, t.x, t.y + 6, `${t.name || BENCH_TOOLS.burner.label}: ${on ? 'on' : 'off'}`, SMALL_STYLE, 0.5, 0);
    } else if (t.kind === 'sink') {
      back.fillStyle(0xcfd8dc, 1);
      back.fillRoundedRect(t.x - w / 2, t.y - h, w, h, 14);
      back.fillStyle(0x90a4ae, 1);
      back.fillRoundedRect(t.x - w / 2 + 12, t.y - h + 12, w - 24, h - 24, 10);
      back.fillStyle(0x455a64, 1);
      back.fillCircle(t.x, t.y - h / 2, 9);
      if (lit) {
        back.lineStyle(3, HELD, 1);
        back.strokeRoundedRect(t.x - w / 2, t.y - h, w, h, 14);
      }
      this.text(`tool:${t.id}`, t.x, t.y + 6, t.name || BENCH_TOOLS.sink.label, SMALL_STYLE, 0.5, 0);
    } else {
      // A stirring rod, standing in a holder until it is picked up.
      const lift = state.held === t.id ? -24 : 0;
      back.fillStyle(0x596275, 1);
      back.fillRoundedRect(t.x - w / 2, t.y - 14, w, 14, 5);
      front.lineStyle(10, EDGE, 0.55);
      front.lineBetween(t.x - 6, t.y - 6 + lift, t.x + 10, t.y - h + lift);
      front.lineStyle(6, state.held === t.id ? HELD : 0xd8dee9, 1);
      front.lineBetween(t.x - 6, t.y - 6 + lift, t.x + 10, t.y - h + lift);
      if (lit && state.held !== t.id) {
        front.lineStyle(2, HELD, 1);
        front.strokeRoundedRect(t.x - w / 2, t.y - h, w, h, 6);
      }
      this.text(`tool:${t.id}`, t.x, t.y + 6, t.name || BENCH_TOOLS.stirrer.label, SMALL_STYLE, 0.5, 0);
    }
  }

  private text(key: string, x: number, y: number, value: string, style: Phaser.Types.GameObjects.Text.TextStyle, ox: number, oy: number) {
    let text = this.texts.get(key);
    if (!text) {
      text = this.scene.add.text(x, y, value, style).setDepth(DEPTH + 3).setOrigin(ox, oy);
      this.texts.set(key, text);
    }
    if (text.text !== value) text.setText(value);
    text.setPosition(x, y);
    this.used.add(key);
  }

  destroy() {
    this.back.destroy();
    this.liquid.destroy();
    this.front.destroy();
    for (const t of this.texts.values()) t.destroy();
    this.texts.clear();
  }
}
