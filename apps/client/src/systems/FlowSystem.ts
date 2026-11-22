import type * as Phaser from 'phaser';
import { colorNumber, flowSettings, flowSound, mixColor, type FlowSettings, type SceneFlow } from '@qbl/shared';
import { synthFor, type Voice } from '../audio/synth';
import { Depth } from '../core/depth';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { moving } from './LightSystem';
import { SkySystem } from './SkySystem';

/** A ripple: a short streak of light (or shadow) on the water, carried along. */
interface Ripple {
  /** Across and down the box, 0 to 1. */
  u: number;
  v: number;
  len: number;
  light: boolean;
  phase: number;
}

interface Glint { u: number; v: number; age: number; life: number }

interface Water {
  def: SceneFlow;
  s: FlowSettings;
  base: Phaser.GameObjects.Graphics | null;
  g: Phaser.GameObjects.Graphics;
  ripples: Ripple[];
  glints: Glint[];
  /** How dark the sky was when the base was last painted. */
  painted: number;
}

/**
 * Water that flows (Scene.flows): rivers and streams carried along, a waterfall pouring down with foam
 * at its foot, the sea and lakes lapping. Behind the scene's picture, the water is painted and moves
 * wherever the picture is see-through (its banks are the picture's); over it, only glints and ripples
 * move, on water already painted. Darker as the sky darkens. Each kind of water has its sound.
 */
export class FlowSystem implements SceneSystem {
  private waters: Water[] = [];
  private voices: Voice[] = [];
  private time = 0;

  constructor(private rt: SceneRuntime) {}

  create() {
    const { scene, def } = this.rt;
    const flows = def.flows ?? [];
    if (!flows.length) return;
    // Behind the scene's own picture (the last background layer), in front of everything behind it.
    const behind = Depth.background + Math.max(0, (def.background_media ?? []).length - 1) - 0.5;
    const sounds = new Set<string>();
    for (const f of flows) {
      const s = flowSettings(f);
      const over = s.layer === 'over';
      const base = over ? null : scene.add.graphics().setDepth(behind - 0.1);
      const g = scene.add.graphics().setDepth(over ? Depth.floor - 50 : behind);
      const w: Water = { def: f, s, base, g, ripples: [], glints: [], painted: -1 };
      // As many ripples as fit, fewer for slow, still water.
      const n = Math.max(12, Math.min(700, Math.round((f.width * f.height) / (s.direction === 'still' ? 2600 : 1500))));
      for (let i = 0; i < n; i++) w.ripples.push(this.ripple(Math.random()));
      this.waters.push(w);
      this.paint(w, 0);
      const sound = s.sound ? flowSound(s.kind) : null;
      if (sound) sounds.add(sound);
    }
    const synth = synthFor(scene);
    for (const name of sounds) this.voices.push(synth.play(name as 'river', { volume: name === 'waves' ? 0.35 : 0.28, loop: true }));
  }

  update(_time: number, delta: number) {
    if (!this.waters.length) return;
    const dt = Math.min(delta, 100);
    this.time += dt;
    const still = !moving();
    let dark = 0;
    try {
      dark = this.rt.system(SkySystem).dark;
    } catch {
      // no sky system
    }
    for (const w of this.waters) {
      if (Math.abs(w.painted - dark) > 0.03) this.paint(w, dark);
      w.g.clear();
      this.flow(w, still ? 0 : dt, dark);
    }
  }

  destroy() {
    for (const w of this.waters) {
      w.base?.destroy();
      w.g.destroy();
    }
    this.waters = [];
    for (const v of this.voices) v.stop(300);
    this.voices = [];
  }

  /** The water's colour, darker and bluer at night. */
  private colour(w: Water, dark: number): string {
    return mixColor(w.s.color, '#0d1a33', dark * 0.65);
  }

  /** The still body of the water: lighter far off (the top of the box), deeper near. */
  private paint(w: Water, dark: number) {
    w.painted = dark;
    const g = w.base;
    if (!g) return;
    const { x, y, width, height } = w.def;
    const c = this.colour(w, dark);
    const far = mixColor(c, '#ffffff', 0.22);
    const near = mixColor(c, '#06122a', 0.25);
    g.clear();
    const bands = 24;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      g.fillStyle(colorNumber(mixColor(far, near, w.s.direction === 'down' ? 0.3 + 0.4 * Math.sin(t * Math.PI) : t)), 1);
      g.fillRect(x, y + (height * i) / bands, width, Math.ceil(height / bands) + 1);
    }
  }

  private ripple(u: number): Ripple {
    const r = Math.random;
    return { u, v: r(), len: 0.4 + r() * 0.6, light: r() < 0.68, phase: r() * Math.PI * 2 };
  }

  private flow(w: Water, dt: number, dark: number) {
    const { x, y, width, height } = w.def;
    const g = w.g;
    const s = dt / 1000;
    const t = this.time / 1000;
    const c = this.colour(w, dark);
    const light = colorNumber(mixColor(c, '#ffffff', 0.7));
    const shadow = colorNumber(mixColor(c, '#041026', 0.5));
    const over = w.s.layer === 'over';
    const vertical = w.s.direction === 'down' || w.s.direction === 'up';
    const sign = w.s.direction === 'left' || w.s.direction === 'up' ? -1 : 1;
    for (const r of w.ripples) {
      // Far water (the top of the box) is slower, its ripples thinner and closer together.
      const near = vertical ? 1 : 0.35 + 0.65 * r.v;
      if (w.s.direction === 'still') {
        r.u += Math.sin(t * 0.6 + r.phase) * 0.0006 * near * (dt / 16);
      } else if (vertical) {
        r.v += (sign * w.s.speed * (0.7 + 0.3 * r.len) * s) / height;
        if (r.v > 1.05) Object.assign(r, this.ripple(Math.random()), { v: -0.05 });
        if (r.v < -0.05) Object.assign(r, this.ripple(Math.random()), { v: 1.05 });
      } else {
        r.u += (sign * w.s.speed * near * s) / width;
        if (r.u > 1.08) r.u -= 1.16;
        if (r.u < -0.08) r.u += 1.16;
      }
      const alpha = (over ? 0.6 : 1) * (r.light ? 0.4 + 0.4 * near : 0.3) * (w.s.direction === 'still' ? 0.55 + 0.45 * Math.sin(t * 0.9 + r.phase) : 1);
      if (alpha <= 0.02) continue;
      g.lineStyle(vertical ? 2 + 2 * r.len : 1.5 + 2.5 * near, r.light ? light : shadow, alpha);
      if (vertical) {
        const px = x + r.u * width;
        const py = y + r.v * height;
        g.lineBetween(px, Math.max(y, py - 26 * r.len), px, Math.min(y + height, py + 26 * r.len));
      } else {
        const half = (10 + 36 * near) * r.len;
        const px = x + r.u * width;
        const py = y + r.v * height + Math.sin(t * 1.7 + r.phase) * 1.5;
        g.lineBetween(Math.max(x, px - half), py, Math.min(x + width, px + half), py);
      }
    }
    // A waterfall foams where it lands.
    if (vertical && !over) {
      for (let i = 0; i < 14; i++) {
        const fx = x + ((i + 0.5) / 14) * width;
        const fy = y + height - 6 - Math.abs(Math.sin(t * 3 + i * 1.7)) * 10;
        g.fillStyle(0xffffff, 0.45 + 0.25 * Math.sin(t * 5 + i));
        g.fillEllipse(fx, fy, width / 10 + 6, 12);
      }
    }
    // Glints: the light catching the water, here and there.
    if (dt > 0 && Math.random() < (w.s.direction === 'still' ? 0.12 : 0.2) * Math.min(3, (width * height) / 200000)) {
      w.glints.push({ u: Math.random(), v: Math.random(), age: 0, life: 500 + Math.random() * 700 });
    }
    for (let i = w.glints.length - 1; i >= 0; i--) {
      const gl = w.glints[i]!;
      gl.age += dt;
      if (gl.age >= gl.life) {
        w.glints.splice(i, 1);
        continue;
      }
      const a = Math.sin((gl.age / gl.life) * Math.PI) * (1 - dark * 0.6);
      const px = x + gl.u * width;
      const py = y + gl.v * height;
      const size = 2 + 3 * gl.v;
      g.fillStyle(0xffffff, 0.85 * a);
      g.fillCircle(px, py, size * 0.5);
      g.lineStyle(1, 0xffffff, 0.55 * a);
      g.lineBetween(px - size * 1.8, py, px + size * 1.8, py);
      g.lineBetween(px, py - size, px, py + size);
    }
  }
}
