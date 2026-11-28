import type * as Phaser from 'phaser';
import {
  FOG_FRAG, fogArea, fogCornerData, fogDirectionVector, fogRadial, fogSettings, fogTravelWrap, testConditions,
  type FogArea, type FogSettings, type SceneFog,
} from '@qbl/shared';
import { Depth } from '../core/depth';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { moving } from './LightSystem';

const WEBGL = 2; // Phaser.WEBGL
/** Its churning clock runs back to 0 after this many seconds, so it never grows past what a GPU's floats keep exact. */
const WRAP = 3600;
/** With less motion, fog is held still at this moment. */
const STILL_AT = 23.7;
/** How long fog takes to roll in or clear when its conditions change, in ms. */
export const FOG_FADE_MS = 2500;

/** Fog in front of everyone (just behind labels and names); fog behind them lies on the floor, over its pictures. */
export const FOG_DEPTH = { front: Depth.label - 8, behind: Depth.floor - 30 } as const;

export interface Fog {
  def: SceneFog;
  s: FogSettings;
  area: FogArea;
  rgb: [number, number, number];
  /** Drawn by the GPU; null where the renderer cannot run shaders (then nothing is drawn). */
  shader: Phaser.GameObjects.Shader | null;
  /** Whether its conditions hold, and how far it has faded in (0 gone, 1 fully there). */
  on: boolean;
  shown: number;
  /** Seconds, for its churning. */
  time: number;
  /** How far it has drifted, in pixels (negative gathering inward). */
  travel: number;
}

function canShade(scene: Phaser.Scene): boolean {
  const renderer = (scene.sys as { renderer?: { type?: number } } | undefined)?.renderer;
  return renderer?.type === WEBGL && typeof (scene.add as { shader?: unknown }).shader === 'function';
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Patches of fog (Scene.fogs), drawn live on the GPU (shared fog.ts): wisps drifting across their
 * outline, or spreading out from a point (gathering in to one), fading out softly at the edges. In
 * front of everyone, or behind them on the floor. A fog with conditions is there only while they
 * hold, fading in and out as variables change. With less motion it is held still. Without WebGL
 * nothing is drawn.
 */
export class FogSystem implements SceneSystem {
  readonly fogs: Fog[] = [];
  private motion = true;

  constructor(private rt: SceneRuntime) {}

  create() {
    const defs = this.rt.def.fogs ?? [];
    if (!defs.length) return;
    const { scene } = this.rt;
    this.motion = moving();
    const shade = canShade(scene);
    defs.forEach((def, i) => {
      const area = fogArea(def);
      if (!area.corners || !(area.width > 0) || !(area.height > 0)) return;
      const s = fogSettings(def);
      const on = this.holds(def);
      const fog: Fog = { def, s, area, rgb: rgb(s.color), shader: null, on, shown: on ? 1 : 0, time: STILL_AT + i * 17.1, travel: i * 0.37 * s.size };
      if (shade) {
        const corners = fogCornerData(area);
        const dir = fogDirectionVector(s.direction);
        const radial = fogRadial(s.direction) ? 1 : 0;
        fog.shader = scene.add
          .shader(
            {
              name: 'QblFog',
              fragmentSource: FOG_FRAG,
              setupUniforms: (set: (name: string, value: unknown) => void) => {
                set('uTime', fog.time);
                set('uTravel', fog.travel);
                set('uBox', [area.width, area.height]);
                set('uSize', fog.s.size);
                set('uDir', dir);
                set('uRadial', radial);
                set('uOrigin', [fog.s.origin.x - area.x, fog.s.origin.y - area.y]);
                set('uDensity', fog.s.density);
                set('uColor', [...fog.rgb, fog.s.opacity * fog.shown]);
                set('uPoly[0]', corners);
                set('uCorners', area.corners!.length);
              },
            },
            area.x,
            area.y,
            area.width,
            area.height,
          )
          .setOrigin(0, 0)
          .setDepth(FOG_DEPTH[s.layer]);
        fog.shader.setVisible(fog.shown > 0 && s.opacity > 0);
      }
      this.fogs.push(fog);
    });
  }

  private holds(def: SceneFog): boolean {
    return testConditions(def.conditions, this.rt.ctx.vars.get);
  }

  /** Fog whose conditions have started or stopped holding rolls in or clears. */
  variablesChanged() {
    for (const f of this.fogs) f.on = this.holds(f.def);
  }

  update(_time: number, delta: number) {
    const dt = Math.min(delta, 100) / 1000;
    for (const f of this.fogs) {
      const goal = f.on ? 1 : 0;
      if (f.shown !== goal) {
        const step = this.motion ? delta / FOG_FADE_MS : 1;
        f.shown = goal > f.shown ? Math.min(goal, f.shown + step) : Math.max(goal, f.shown - step);
      }
      if (this.motion) {
        f.time = (f.time + dt) % WRAP;
        const sign = f.s.direction === 'inward' ? -1 : 1;
        const wrap = fogTravelWrap(f.s.size);
        f.travel = (((f.travel + sign * f.s.speed * dt) % wrap) + wrap) % wrap;
      }
      f.shader?.setVisible(f.shown > 0 && f.s.opacity > 0);
    }
  }

  destroy() {
    for (const f of this.fogs) f.shader?.destroy();
    this.fogs.length = 0;
  }
}
