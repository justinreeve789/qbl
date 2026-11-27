import type * as Phaser from 'phaser';
import { RIPPLES_FRAG, SHAFTS_FRAG, testConditions, waterLightArea, waterLightCornerData, waterLightSettings, type SceneWaterLight, type WaterLightArea, type WaterLightSettings } from '@qbl/shared';
import { Depth } from '../core/depth';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { LIGHT_FADE_MS, moving } from './LightSystem';

const ADD = 1; // Phaser.BlendModes.ADD
const WEBGL = 2; // Phaser.WEBGL
/** Time runs back to 0 after this many seconds, so it never grows past what a GPU's floats keep exact. */
const WRAP = 3600;
/** With less motion, the light is held still at this moment. */
const STILL_AT = 7.3;

interface Lit {
  def: SceneWaterLight;
  s: WaterLightSettings;
  /** Where it is drawn: its box, or its outline's bounds with the outline. */
  area: WaterLightArea;
  rgb: [number, number, number];
  /** Drawn by the GPU; null where the renderer cannot run shaders (then nothing is drawn). */
  shader: Phaser.GameObjects.Shader | null;
  /** Whether its conditions hold, and how far it has faded in (0 out, 1 fully on). */
  on: boolean;
  shown: number;
  /** Its own clock, in seconds, run at its speed. */
  time: number;
}

/** Whether this scene draws with WebGL, which shaders need. */
function canShade(scene: Phaser.Scene): boolean {
  const renderer = (scene.sys as { renderer?: { type?: number } } | undefined)?.renderer;
  return renderer?.type === WEBGL && typeof (scene.add as { shader?: unknown }).shader === 'function';
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Light under water (Scene.water_lights), drawn live on the GPU (shared waterLightShaders.ts): rippling
 * light dancing on the floor, behind every figure, and shafts of light slanting down from the surface,
 * in front of them. Ripples may have an outline of their own (SceneWaterLight.shape) instead of a box.
 * A light with conditions is on only while they hold, fading in and out as
 * variables change. With less motion it is held still. Without WebGL nothing is drawn.
 */
export class WaterLightSystem implements SceneSystem {
  readonly lights: Lit[] = [];
  private motion = true;

  constructor(private rt: SceneRuntime) {}

  create() {
    const defs = this.rt.def.water_lights ?? [];
    if (!defs.length) return;
    const { scene } = this.rt;
    this.motion = moving();
    const shade = canShade(scene);
    defs.forEach((def, i) => {
      const area = waterLightArea(def);
      if (!(area.width > 0) || !(area.height > 0)) return;
      const s = waterLightSettings(def);
      const on = this.holds(def);
      const corners = waterLightCornerData(area);
      const lit: Lit = { def, s, area, rgb: rgb(s.color), shader: null, on, shown: on ? 1 : 0, time: this.motion ? i * 11.3 : STILL_AT + i * 11.3 };
      if (shade) {
        const shafts = s.kind === 'shafts';
        lit.shader = scene.add
          .shader(
            {
              name: shafts ? 'QblWaterShafts' : 'QblWaterRipples',
              fragmentSource: shafts ? SHAFTS_FRAG : RIPPLES_FRAG,
              setupUniforms: (set: (name: string, value: unknown) => void) => {
                set('uTime', lit.time);
                set('uBox', [area.width, area.height]);
                set('uSize', lit.s.size);
                set('uShape', shafts ? lit.s.spread : lit.s.tilt);
                set('uOval', lit.s.edge === 'oval' ? 1 : 0);
                set('uColor', [...lit.rgb, lit.s.strength * lit.shown]);
                if (!shafts) {
                  set('uPoly[0]', corners);
                  set('uCorners', area.corners?.length ?? 0);
                }
              },
            },
            area.x,
            area.y,
            area.width,
            area.height,
          )
          .setOrigin(0, 0)
          // Ripples lie on the floor, behind every figure; shafts hang in the water in front of them.
          .setDepth(shafts ? Depth.label - 6 : Depth.floor - 40)
          .setBlendMode(ADD);
        lit.shader.setVisible(lit.shown > 0);
      }
      this.lights.push(lit);
    });
  }

  private holds(def: SceneWaterLight): boolean {
    return testConditions(def.conditions, this.rt.ctx.vars.get);
  }

  /** Lights whose conditions have started or stopped holding come on or go out. */
  variablesChanged() {
    for (const l of this.lights) l.on = this.holds(l.def);
  }

  update(_time: number, delta: number) {
    for (const l of this.lights) {
      const goal = l.on ? 1 : 0;
      if (l.shown !== goal) {
        const step = this.motion ? delta / LIGHT_FADE_MS : 1;
        l.shown = goal > l.shown ? Math.min(goal, l.shown + step) : Math.max(goal, l.shown - step);
      }
      if (this.motion) l.time = (l.time + (Math.min(delta, 100) / 1000) * l.s.speed) % WRAP;
      l.shader?.setVisible(l.shown > 0 && l.s.strength > 0);
    }
  }

  destroy() {
    for (const l of this.lights) l.shader?.destroy();
    this.lights.length = 0;
  }
}
