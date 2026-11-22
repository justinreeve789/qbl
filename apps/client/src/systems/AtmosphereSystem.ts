import type * as Phaser from 'phaser';
import { colorNumber, type SceneAtmosphere } from '@qbl/shared';
import { Depth } from '../core/depth';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { moving } from './LightSystem';
import { SkySystem } from './SkySystem';

type Kind = SceneAtmosphere['kind'];

interface Mote {
  /** Where it is, within the view (0 to 1 across and down), so the air is full wherever players look. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  phase: number;
  spin: number;
  color: number;
}

const COUNT: Record<Kind, number> = { fireflies: 18, leaves: 14, snow: 70, rain: 110, dust: 40, bubbles: 22 };
const AMOUNT = { few: 0.45, some: 1, many: 1.9 } as const;
const COLORS: Record<Kind, number[]> = {
  fireflies: [0xeaff7a, 0xfff38a],
  leaves: [0xd9822b, 0xe8b13a, 0xb5532a, 0x9aa83a],
  snow: [0xffffff, 0xeef4ff],
  rain: [0xaac8ff],
  dust: [0xfff2d0],
  bubbles: [0xd8f4ff],
};

/**
 * What is in the air (Scene.atmosphere): fireflies that wander and glow in the dark, leaves that
 * tumble down, snow, rain, dust floating in the light, bubbles rising under water. Drawn over the
 * scene, in the part of it players are looking at. Nothing moves when the player's system asks for
 * reduced motion.
 */
export class AtmosphereSystem implements SceneSystem {
  private layers: Array<{ def: SceneAtmosphere; motes: Mote[]; graphics: Phaser.GameObjects.Graphics }> = [];

  constructor(private rt: SceneRuntime) {}

  create() {
    const defs = this.rt.def.atmosphere ?? [];
    if (!defs.length || !moving()) return;
    for (const def of defs) {
      // Rain and snow are weather: the weather plugin draws them (WeatherSystem), with splashes and wind.
      if (def.kind === 'rain' || def.kind === 'snow') continue;
      const n = Math.round(COUNT[def.kind] * AMOUNT[def.amount ?? 'some']);
      const palette = def.color ? [colorNumber(def.color)] : COLORS[def.kind] ?? [0xffffff];
      const motes = Array.from({ length: n }, () => this.spawn(def.kind, palette, Math.random()));
      const graphics = this.rt.scene.add.graphics().setDepth(Depth.label - 8);
      if (def.kind === 'fireflies') graphics.setBlendMode?.(1); // ADD: they glow
      this.layers.push({ def, motes, graphics });
    }
  }

  private spawn(kind: Kind, palette: number[], y: number): Mote {
    const r = Math.random;
    const color = palette[Math.floor(r() * palette.length)] ?? 0xffffff;
    const base = { x: r(), y, phase: r() * Math.PI * 2, spin: (r() - 0.5) * 3, color };
    switch (kind) {
      case 'fireflies': return { ...base, y: 0.35 + r() * 0.6, vx: 0, vy: 0, size: 2 + r() * 1.5 };
      case 'leaves': return { ...base, vx: 0.02 + r() * 0.03, vy: 0.05 + r() * 0.05, size: 5 + r() * 4 };
      case 'snow': return { ...base, vx: (r() - 0.3) * 0.02, vy: 0.05 + r() * 0.07, size: 1.5 + r() * 2.5 };
      case 'rain': return { ...base, vx: 0.12, vy: 1.1 + r() * 0.5, size: 14 + r() * 10 };
      case 'dust': return { ...base, vx: (r() - 0.5) * 0.008, vy: (r() - 0.5) * 0.006, size: 1 + r() * 1.6 };
      case 'bubbles': return { ...base, vx: 0, vy: -(0.06 + r() * 0.08), size: 3 + r() * 6 };
    }
  }

  update(time: number, delta: number) {
    if (!this.layers.length) return;
    const view = this.rt.scene.cameras.main.worldView;
    const s = Math.min(0.05, delta / 1000);
    const t = time / 1000;
    const sky = this.rt.system(SkySystem);
    for (const layer of this.layers) {
      const { def, motes, graphics: g } = layer;
      g.clear();
      const palette = def.color ? [colorNumber(def.color)] : COLORS[def.kind];
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i]!;
        // Move, and come back in on the far side when gone.
        switch (def.kind) {
          case 'fireflies':
            m.x += Math.sin(t * 0.7 + m.phase) * 0.012 * s;
            m.y += Math.cos(t * 0.9 + m.phase * 1.3) * 0.01 * s;
            break;
          case 'leaves':
            m.x += (m.vx + Math.sin(t * 1.4 + m.phase) * 0.04) * s;
            m.y += m.vy * s;
            break;
          case 'dust':
            m.x += (m.vx + Math.sin(t * 0.3 + m.phase) * 0.004) * s;
            m.y += (m.vy + Math.cos(t * 0.25 + m.phase) * 0.004) * s;
            break;
          case 'bubbles':
            m.x += Math.sin(t * 2 + m.phase) * 0.01 * s;
            m.y += m.vy * s;
            break;
          default:
            m.x += m.vx * s;
            m.y += m.vy * s;
        }
        if (m.y > 1.05 || m.y < -0.1 || m.x > 1.08 || m.x < -0.08) motes[i] = this.spawn(def.kind, palette, def.kind === 'bubbles' ? 1.02 : -0.05);
        const x = view.x + m.x * view.width;
        const y = view.y + m.y * view.height;
        switch (def.kind) {
          case 'fireflies': {
            const glow = Math.max(0, Math.sin(t * 1.6 + m.phase)) * (0.35 + 0.65 * sky.dark);
            g.fillStyle(m.color, 0.16 * glow);
            g.fillCircle(x, y, m.size * 4);
            g.fillStyle(m.color, glow);
            g.fillCircle(x, y, m.size);
            break;
          }
          case 'leaves': {
            // A little leaf tumbling: a pointed oval turning as it falls.
            const a = t * m.spin + m.phase;
            const c = Math.cos(a) * m.size;
            const d = Math.sin(a) * m.size * 0.45;
            g.fillStyle(m.color, 0.9);
            g.fillTriangle(x - c, y - Math.sin(a) * m.size, x + d, y - Math.cos(a) * m.size * 0.45, x + c, y + Math.sin(a) * m.size);
            g.fillTriangle(x - c, y - Math.sin(a) * m.size, x - d, y + Math.cos(a) * m.size * 0.45, x + c, y + Math.sin(a) * m.size);
            break;
          }
          case 'snow':
            g.fillStyle(m.color, 0.85);
            g.fillCircle(x + Math.sin(t + m.phase) * 6, y, m.size);
            break;
          case 'rain':
            g.lineStyle(1.5, m.color, 0.35);
            g.lineBetween(x, y, x - m.size * 0.1, y - m.size);
            break;
          case 'dust':
            g.fillStyle(m.color, 0.25 + 0.2 * Math.sin(t + m.phase));
            g.fillCircle(x, y, m.size);
            break;
          case 'bubbles':
            g.lineStyle(1.5, m.color, 0.6);
            g.strokeCircle(x, y, m.size);
            g.fillStyle(0xffffff, 0.5);
            g.fillCircle(x - m.size * 0.35, y - m.size * 0.35, m.size * 0.25);
            break;
        }
      }
    }
  }

  destroy() {
    for (const l of this.layers) l.graphics.destroy();
    this.layers = [];
  }
}
