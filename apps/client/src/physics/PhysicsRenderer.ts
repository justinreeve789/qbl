import * as Phaser from 'phaser';
import {
  isAnchor, materialOf, millilitresPerPixel, outlineAt, waterContainer,
  type PhysicsBody, type PhysicsBuild, type PhysicsLayout, type PhysicsSnapshot, type PhysicsUnits, type Point, type ScenePhysics,
} from '@qbl/shared';
import { mediaKey } from '../core/assets';

/** Physics is drawn over the backgrounds and figures, under foreground layers. */
const DEPTH = 90_000;
const STRAINED = 0xe53935;
const WATER = 0x3d9be0;
const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Montserrat, system-ui, sans-serif', fontSize: '18px', color: '#ffffff', stroke: '#1b1b2f', strokeThickness: 4, fontStyle: '700',
};
const SMALL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = { ...LABEL_STYLE, fontSize: '13px', strokeThickness: 3 };

/** What the player is doing, which the drawing shows: a beam being drawn, a body being pointed at. */
export interface DrawState {
  ghost: { a: Point; b: Point; ok: boolean; label: string } | null;
  erasing: boolean;
  /** A beam under the pointer while erasing. */
  hover: string | null;
}

export function colorNumber(css: string | undefined, fallback = 0x999999): number {
  if (!css) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  return m ? parseInt(m[1]!, 16) : fallback;
}

function mix(a: number, b: number, f: number): number {
  const t = Math.max(0, Math.min(1, f));
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Phaser's types ask for its own vectors; plain points are what it reads. */
const v2 = (points: Point[]) => points as unknown as Phaser.Math.Vector2[];

function darker(c: number, by = 0.35): number {
  return mix(c, 0x000000, by);
}

/**
 * Draws an experiment from its layout and a snapshot: bodies, water with its scale, joints and
 * strings, how strained beams are, presses, and while building, the grid, footings and the beam
 * being drawn. Everything is redrawn each frame; a few dozen bodies cost nothing.
 */
export class PhysicsRenderer {
  private back: Phaser.GameObjects.Graphics;
  private water: Phaser.GameObjects.Graphics;
  private front: Phaser.GameObjects.Graphics;
  private texts = new Map<string, Phaser.GameObjects.Text>();
  private images = new Map<string, Phaser.GameObjects.Image>();
  private used = new Set<string>();

  constructor(private scene: Phaser.Scene, private def: ScenePhysics, private units: PhysicsUnits) {
    this.back = scene.add.graphics().setDepth(DEPTH);
    this.water = scene.add.graphics().setDepth(DEPTH + 1);
    this.front = scene.add.graphics().setDepth(DEPTH + 2);
  }

  draw(bodies: Map<string, PhysicsBody>, layout: PhysicsLayout, snap: PhysicsSnapshot, state: DrawState) {
    this.used.clear();
    const { back, water, front } = this;
    back.clear();
    water.clear();
    front.clear();
    const poses = new Map(snap.bodies.map((p) => [p[0], p]));
    const stress = new Map(snap.stress);
    const pose = (b: PhysicsBody) => {
      const p = poses.get(b.id);
      return p ? { x: p[1], y: p[2], angle: p[3] } : { x: b.x, y: b.y, angle: ((b.angle ?? 0) * Math.PI) / 180 };
    };
    const building = snap.building && !!this.def.build;

    // Bodies, then the water over them (what is under water looks under water), then the glass of cups.
    const cups: PhysicsBody[] = [];
    for (const body of bodies.values()) {
      if (body.hidden || (body.id.startsWith('beam:') && building)) continue;
      if (body.shape === 'cup') {
        cups.push(body);
        continue;
      }
      const at = pose(body);
      const beamId = body.id.startsWith('beam:') ? body.id.slice(5) : null;
      const strain = beamId ? stress.get(beamId) ?? 0 : 0;
      const broken = beamId ? snap.broken.includes(beamId) : false;
      this.drawBody(back, body, at, { strain, broken, held: snap.held.includes(body.id), hover: false });
    }

    for (const w of this.def.water ?? []) {
      const cup = w.body_id ? bodies.get(w.body_id) : undefined;
      const box = waterContainer(w, cup ? { def: cup, ...pose(cup) } : null);
      if (!box) continue;
      const level = snap.water.find((x) => x[0] === w.id)?.[1] ?? w.level;
      const color = colorNumber(w.color, WATER);
      const top = box.y + box.height - level;
      water.fillStyle(color, 0.45);
      water.fillRect(box.x, top, box.width, level);
      water.lineStyle(3, mix(color, 0xffffff, 0.5), 0.9);
      water.lineBetween(box.x, top, box.x + box.width, top);
      if (w.marks) this.drawScale(box, millilitresPerPixel(box.width, this.units), `${w.id}`);
    }

    for (const cup of cups) {
      if (cup.hidden) continue;
      const at = pose(cup);
      this.drawBody(front, cup, at, { strain: 0, broken: false, held: false, hover: false, glass: true });
    }

    // Strings, ropes, springs and pins.
    for (const [id, x1, y1, x2, y2, kind] of snap.links) {
      const strain = stress.get(id) ?? 0;
      const color = strain > 0.5 ? mix(0x3b2f2a, STRAINED, (strain - 0.5) * 2) : 0x3b2f2a;
      if (kind === 'pin') {
        front.fillStyle(0x2d2d3a, 1);
        front.fillCircle(x1, y1, 7);
        front.fillStyle(0xd0d4dc, 1);
        front.fillCircle(x1, y1, 3);
      } else if (kind === 'spring') {
        this.zigzag(front, x1, y1, x2, y2, color);
      } else {
        front.lineStyle(kind === 'rope' ? 4 : 2, kind === 'rope' ? 0xb8925a : color, 1);
        front.lineBetween(x1, y1, x2, y2);
        front.fillStyle(0x2d2d3a, 1);
        front.fillCircle(x2, y2, 4);
      }
    }

    // A bridge: footings always; while building, the grid, the design and the beam being drawn.
    const build = this.def.build;
    if (build) this.drawBuild(build, layout, snap, state, building);

    for (const p of snap.presses) {
      front.lineStyle(6, 0xffd34d, 1);
      front.lineBetween(p.x, p.y - 70, p.x, p.y - 14);
      front.fillStyle(0xffd34d, 1);
      front.fillTriangle(p.x - 14, p.y - 18, p.x + 14, p.y - 18, p.x, p.y);
      this.text(`press:${p.x | 0}`, p.x, p.y - 88, `${p.force} N`, LABEL_STYLE);
    }

    // Labels and pictures not used this frame go away.
    for (const [key, t] of this.texts) if (!this.used.has(key)) t.setVisible(false);
    for (const [key, img] of this.images) if (!this.used.has(key)) img.setVisible(false);
  }


  private drawBody(g: Phaser.GameObjects.Graphics, body: PhysicsBody, at: { x: number; y: number; angle: number }, o: { strain: number; broken: boolean; held: boolean; hover: boolean; glass?: boolean }) {
    const material = materialOf(body.material);
    let fill = colorNumber(body.color, colorNumber(material.color));
    if (o.strain > 0.4 && !o.broken) fill = mix(fill, STRAINED, (o.strain - 0.4) / 0.6);
    if (o.broken) fill = mix(fill, 0x555555, 0.5);
    const outline = darker(fill);
    const picture = body.media_id != null ? this.picture(body, at) : false;
    const parts = outlineAt(body, at.x, at.y, at.angle);
    for (const points of parts) {
      if (!picture) {
        g.fillStyle(fill, o.glass ? 0.35 : 1);
        g.fillPoints(v2(points), true);
      }
      g.lineStyle(o.glass ? 3 : 2, o.held ? 0xffd34d : o.glass ? 0xe8f6ff : outline, o.glass ? 0.9 : 1);
      g.strokePoints(v2(points), true, true);
    }
    // Something to see a ball turn by.
    if (body.shape === 'circle' && !picture) {
      const r = body.radius ?? 40;
      g.lineStyle(Math.max(2, r / 8), mix(fill, 0xffffff, 0.45), 0.9);
      g.lineBetween(at.x, at.y, at.x + Math.cos(at.angle) * r * 0.8, at.y + Math.sin(at.angle) * r * 0.8);
    }
    if (body.marks) this.drawRuler(g, body, at);
    if (body.label) {
      const t = this.text(`label:${body.id}`, at.x, at.y, body.label, LABEL_STYLE);
      t.setRotation(body.shape === 'circle' ? 0 : at.angle);
    }
  }

  /** A picture stretched over the body. False until it has loaded, so the shape is drawn meanwhile. */
  private picture(body: PhysicsBody, at: { x: number; y: number; angle: number }): boolean {
    const key = mediaKey(body.media_id!);
    if (!this.scene.textures.exists(key)) return false;
    const id = `img:${body.id}`;
    let img = this.images.get(id);
    if (!img) {
      img = this.scene.add.image(at.x, at.y, key).setDepth(DEPTH + 0.5);
      this.images.set(id, img);
    }
    const w = body.shape === 'circle' ? (body.radius ?? 40) * 2 : body.width ?? 80;
    const h = body.shape === 'circle' ? (body.radius ?? 40) * 2 : body.height ?? 80;
    img.setVisible(true).setPosition(at.x, at.y).setRotation(at.angle).setDisplaySize(w, h);
    this.used.add(id);
    return true;
  }

  /** A tick every 10 cm along the body from its middle, numbered every 50 cm. */
  private drawRuler(g: Phaser.GameObjects.Graphics, body: PhysicsBody, at: { x: number; y: number; angle: number }) {
    const half = (body.width ?? 80) / 2;
    const step = this.units.ppm / 10;
    const cos = Math.cos(at.angle);
    const sin = Math.sin(at.angle);
    const top = -(body.height ?? 10) / 2;
    g.lineStyle(2, 0x1b1b2f, 0.9);
    for (let i = -Math.floor(half / step); i <= Math.floor(half / step); i++) {
      const along = i * step;
      const major = i % 5 === 0;
      const len = major ? 10 : 5;
      const x1 = at.x + along * cos - top * sin;
      const y1 = at.y + along * sin + top * cos;
      const x2 = at.x + along * cos - (top - len) * sin;
      const y2 = at.y + along * sin + (top - len) * cos;
      g.lineBetween(x1, y1, x2, y2);
      if (major && i !== 0) {
        // Numbers go under the body, where what is put on it does not cover them.
        const below = -top + 14;
        const t = this.text(`ruler:${body.id}:${i}`, at.x + along * cos - below * sin, at.y + along * sin + below * cos, `${Math.abs(i / 10).toFixed(1)} m`, SMALL_STYLE);
        t.setRotation(at.angle);
      }
    }
  }

  /** Millilitres up the side of a container, every so many so the marks are not crowded. */
  private drawScale(box: { x: number; y: number; width: number; height: number }, mlPerPx: number, id: string) {
    const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    const step = steps.find((s) => s / mlPerPx >= 28) ?? steps[steps.length - 1]!;
    const g = this.water;
    g.lineStyle(2, 0xffffff, 0.8);
    const floor = box.y + box.height;
    for (let ml = step, i = 1; ml / mlPerPx <= box.height + 0.5; ml += step, i++) {
      const y = floor - ml / mlPerPx;
      g.lineBetween(box.x, y, box.x + 12, y);
      this.text(`scale:${id}:${i}`, box.x + 18, y, ml >= 1000 ? `${ml / 1000} L` : `${ml} mL`, SMALL_STYLE).setOrigin(0, 0.5);
    }
  }

  private drawBuild(build: PhysicsBuild, layout: PhysicsLayout, snap: PhysicsSnapshot, state: DrawState, building: boolean) {
    const g = this.front;
    const grid = build.grid && build.grid > 0 ? build.grid : 25;
    if (building) {
      g.fillStyle(0xffffff, 0.35);
      for (let x = build.x; x <= build.x + build.width + 0.5; x += grid) {
        for (let y = build.y; y <= build.y + build.height + 0.5; y += grid) g.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      g.lineStyle(2, 0xffffff, 0.35);
      g.strokeRect(build.x, build.y, build.width, build.height);
      // The design, flat: as drawn, not yet put to the test.
      for (const beam of layout.design) {
        const kind = build.beams[beam.kind];
        const color = colorNumber(materialOf(kind?.material).color);
        const thick = kind?.thickness ?? (materialOf(kind?.material).tension_only ? 5 : 12);
        const hovered = state.erasing && state.hover === beam.id;
        g.lineStyle(thick, hovered ? STRAINED : color, hovered ? 0.6 : 1);
        g.lineBetween(beam.a.x, beam.a.y, beam.b.x, beam.b.y);
        if (kind?.deck) {
          g.lineStyle(2, 0xffffff, 0.6);
          g.lineBetween(beam.a.x, beam.a.y - thick / 2, beam.b.x, beam.b.y - thick / 2);
        }
      }
      const ends = new Map<string, Point>();
      for (const beam of layout.design) for (const p of [beam.a, beam.b]) if (!isAnchor(build, p)) ends.set(`${p.x},${p.y}`, p);
      for (const p of ends.values()) {
        g.fillStyle(0xffffff, 1);
        g.fillCircle(p.x, p.y, 6);
        g.lineStyle(2, 0x1b1b2f, 1);
        g.strokeCircle(p.x, p.y, 6);
      }
      if (state.ghost) {
        const { a, b, ok, label } = state.ghost;
        g.lineStyle(10, ok ? 0xffffff : STRAINED, 0.6);
        g.lineBetween(a.x, a.y, b.x, b.y);
        this.text('ghost', (a.x + b.x) / 2, (a.y + b.y) / 2 - 22, label, LABEL_STYLE);
      }
    }
    for (const a of build.anchors) {
      g.fillStyle(0x2d2d3a, 1);
      g.fillTriangle(a.x - 14, a.y + 18, a.x + 14, a.y + 18, a.x, a.y);
      g.fillStyle(0xffd34d, 1);
      g.fillCircle(a.x, a.y, 7);
    }
    void snap;
  }

  private zigzag(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, color: number) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const turns = Math.max(4, Math.round(len / 14));
    const points: Point[] = [{ x: x1, y: y1 }];
    for (let i = 1; i < turns; i++) {
      const side = i % 2 ? 9 : -9;
      points.push({ x: x1 + ux * (len * i) / turns - uy * side, y: y1 + uy * (len * i) / turns + ux * side });
    }
    points.push({ x: x2, y: y2 });
    g.lineStyle(3, color, 1);
    g.strokePoints(v2(points), false, false);
  }

  private text(key: string, x: number, y: number, value: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    let t = this.texts.get(key);
    if (!t) {
      t = this.scene.add.text(x, y, value, style).setOrigin(0.5).setDepth(DEPTH + 3);
      this.texts.set(key, t);
    }
    if (t.text !== value) t.setText(value);
    t.setVisible(true).setPosition(x, y);
    this.used.add(key);
    return t;
  }

  destroy() {
    this.back.destroy();
    this.water.destroy();
    this.front.destroy();
    for (const t of this.texts.values()) t.destroy();
    for (const i of this.images.values()) i.destroy();
  }
}
