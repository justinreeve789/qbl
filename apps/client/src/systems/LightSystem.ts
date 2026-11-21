import type * as Phaser from 'phaser';
import { colorNumber, type SceneLight } from '@qbl/shared';
import { Depth } from '../core/depth';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { SkySystem } from './SkySystem';

const GLOW = 'qbl-glow';
const ADD = 1; // Phaser.BlendModes.ADD

/** Whether the player's system asks for less motion: lights then glow steadily, without embers. */
export function moving(): boolean {
  return !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

interface Lit {
  def: SceneLight;
  halo: Phaser.GameObjects.Image;
  core: Phaser.GameObjects.Image;
  /** Flicker: where the brightness is heading, and when it next changes. */
  target: number;
  level: number;
  next: number;
  phase: number;
}

interface Ember { x: number; y: number; vx: number; vy: number; life: number; age: number; color: number }

/**
 * Lights (Scene.lights): soft glows over the scene that flicker like a flame, burn like a campfire
 * with embers rising, breathe slowly, blink or twinkle. They shine fully in the dark and only a little
 * in daylight (SkySystem.light).
 */
export class LightSystem implements SceneSystem {
  private lights: Lit[] = [];
  private embers: Ember[] = [];
  private sparks?: Phaser.GameObjects.Graphics;
  private emberClock = 0;
  private motion = true;

  constructor(private rt: SceneRuntime) {}

  create() {
    const defs = this.rt.def.lights ?? [];
    if (!defs.length) return;
    const { scene } = this.rt;
    this.motion = moving();
    if (!scene.textures.exists(GLOW)) {
      // A soft round glow: many faint discs, smaller and smaller, adding up to a bright centre.
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      for (let i = 0; i < 32; i++) {
        g.fillStyle(0xffffff, 0.045);
        g.fillCircle(64, 64, 64 * (1 - i / 32) ** 1.4);
      }
      g.generateTexture(GLOW, 128, 128);
      g.destroy();
    }
    defs.forEach((def, i) => {
      const radius = def.radius ?? 90;
      const color = colorNumber(def.color ?? '#ffc46b');
      const halo = scene.add.image(def.x, def.y, GLOW).setDepth(Depth.label - 5).setTint(color).setDisplaySize(radius * 2, radius * 2);
      halo.setBlendMode?.(ADD);
      const core = scene.add.image(def.x, def.y, GLOW).setDepth(Depth.label - 4).setTint(0xffffff).setDisplaySize(radius * 0.45, radius * 0.45);
      core.setBlendMode?.(ADD);
      this.lights.push({ def, halo, core, target: 1, level: 1, next: 0, phase: i * 1.7 });
    });
    if (defs.some((d) => d.kind === 'fire') && this.motion) {
      this.sparks = scene.add.graphics().setDepth(Depth.label - 3);
      this.sparks.setBlendMode?.(ADD);
    }
    this.update(0, 0);
  }

  /** How bright a light is at this moment, before its strength and the daylight. */
  static brightness(light: Lit | { def: SceneLight; level: number; phase: number }, time: number, motion = true): number {
    const kind = light.def.kind ?? 'flicker';
    if (!motion) return kind === 'blink' ? 0.7 : 0.9;
    const t = time / 1000;
    switch (kind) {
      case 'glow': {
        const period = light.def.period ?? 4;
        return 0.85 + 0.15 * Math.sin((2 * Math.PI * t) / period + light.phase);
      }
      case 'blink': {
        const period = light.def.period ?? 1.4;
        const at = ((t + light.phase) % period) / period;
        // On for a short moment, with soft edges.
        return at < 0.22 ? Math.min(1, at / 0.04, (0.22 - at) / 0.04) : 0;
      }
      case 'twinkle':
        return 0.45 + 0.55 * Math.max(0, Math.sin(t * 2.3 + light.phase)) ** 8;
      default:
        return light.level;
    }
  }

  update(time: number, delta: number) {
    if (!this.lights.length) return;
    const daylight = this.rt.system(SkySystem).light;
    for (const l of this.lights) {
      const kind = l.def.kind ?? 'flicker';
      if ((kind === 'flicker' || kind === 'fire') && this.motion) {
        // A flame: the brightness heads for a new value every tenth of a second or so.
        if (time >= l.next) {
          const low = kind === 'fire' ? 0.68 : 0.8;
          l.target = low + Math.random() * (1.06 - low);
          l.next = time + 60 + Math.random() * 110;
        }
        l.level += (l.target - l.level) * Math.min(1, delta / 70);
      }
      const b = LightSystem.brightness(l, time, this.motion);
      const alpha = Math.max(0, Math.min(1, ((l.def.strength ?? 70) / 100) * b * daylight));
      const radius = l.def.radius ?? 90;
      const swell = kind === 'blink' ? 1 : 0.94 + 0.06 * b;
      l.halo.setAlpha(alpha).setDisplaySize(radius * 2 * swell, radius * 2 * swell);
      l.core.setAlpha(Math.min(1, alpha * 1.2));
    }
    if (this.sparks) this.burn(time, delta);
  }

  /** Embers rising from campfires, glowing and fading as they go. */
  private burn(time: number, delta: number) {
    this.emberClock += delta;
    for (const l of this.lights) {
      if (l.def.kind !== 'fire') continue;
      if (this.emberClock > 110 && this.embers.length < 40) {
        const r = (l.def.radius ?? 90) * 0.18;
        this.embers.push({
          x: l.def.x + (Math.random() - 0.5) * r, y: l.def.y, vx: (Math.random() - 0.5) * 14, vy: -(28 + Math.random() * 36),
          life: 1200 + Math.random() * 1100, age: 0, color: Math.random() < 0.5 ? 0xffb347 : 0xff7a2a,
        });
      }
    }
    if (this.emberClock > 110) this.emberClock = 0;
    const g = this.sparks!;
    g.clear();
    const daylight = this.rt.system(SkySystem).light;
    this.embers = this.embers.filter((e) => {
      e.age += delta;
      if (e.age >= e.life) return false;
      const s = delta / 1000;
      e.x += (e.vx + Math.sin((time + e.life) / 300) * 10) * s;
      e.y += e.vy * s;
      const fade = 1 - e.age / e.life;
      g.fillStyle(e.color, fade * daylight);
      g.fillCircle(e.x, e.y, 1.4 + fade * 1.4);
      return true;
    });
  }

  destroy() {
    for (const l of this.lights) {
      l.halo.destroy();
      l.core.destroy();
    }
    this.lights = [];
    this.embers = [];
    this.sparks?.destroy();
    this.sparks = undefined;
  }
}
