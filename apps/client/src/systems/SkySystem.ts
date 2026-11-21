import type * as Phaser from 'phaser';
import { colorNumber, mixColor, skyHour, skyLook, type SceneSky, type SkyLook } from '@qbl/shared';
import { Depth } from '../core/depth';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { LayerSystem } from './LayerSystem';

/** When each scene's sky started moving on, for this player: it carries on, not over, when they come back. */
const started = new Map<string, number>();

/**
 * The living sky (Scene.sky): a gradient for the time of day behind every background, the sun going
 * down or the moon and twinkling stars, moving slowly on to what the sky becomes (a sunset through
 * gold, orange, pink and purple). Layers that are part of the sky (clouds, a far view) take on its
 * light, and the scene in front a little of it. Other systems ask how dark it is (`light`).
 */
export class SkySystem implements SceneSystem {
  private sky: SceneSky | null = null;
  private gradient?: Phaser.GameObjects.Graphics;
  private stars?: Phaser.GameObjects.Graphics;
  private sun?: Phaser.GameObjects.Graphics;
  private shade?: Phaser.GameObjects.Rectangle;
  private starField: Array<{ x: number; y: number; r: number; phase: number; speed: number }> = [];
  private look: SkyLook | null = null;
  private hour = -1;
  private since = 0;
  private drawnAt = -1e9;

  constructor(private rt: SceneRuntime) {}

  /**
   * How strongly lights shine, from 0.35 in full daylight to 1 at night: 1 without a sky (indoors, a
   * cave), where lights are always lit.
   */
  get light(): number {
    return this.look ? 0.35 + 0.65 * this.look.dark : 1;
  }

  /** How dark it is, 0 to 1 (0 without a sky). */
  get dark(): number {
    return this.look?.dark ?? 0;
  }

  create() {
    const sky = this.rt.def.sky;
    if (!sky) return;
    this.sky = sky;
    const { scene, size } = this.rt;
    const key = String(this.rt.def.id);
    if (!started.has(key)) started.set(key, Date.now());
    this.since = started.get(key)!;
    // Behind every background layer.
    this.gradient = scene.add.graphics().setDepth(Depth.background - 300);
    this.stars = scene.add.graphics().setDepth(Depth.background - 290);
    this.sun = scene.add.graphics().setDepth(Depth.background - 280);
    const horizon = size.height * (sky.horizon ?? 0.6);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) {
      this.starField.push({ x: rand(), y: rand() * horizon * 0.85, r: 0.8 + rand() * 1.6, phase: rand() * Math.PI * 2, speed: 0.6 + rand() * 1.8 });
    }
    // The scene takes on a little of the sky's light: over everything in it, under the labels.
    this.shade = scene.add.rectangle(0, 0, size.width, size.height, 0xffffff, 0).setOrigin(0, 0).setDepth(Depth.label - 10);
    this.shade.setBlendMode?.(2); // MULTIPLY
    this.update(0);
  }

  update(time: number) {
    if (!this.sky || !this.gradient) return;
    const hour = skyHour(this.sky, Date.now() - this.since);
    // The colours move slowly: redraw the gradient now and then, the stars and the sun every frame.
    if (Math.abs(hour - this.hour) > 0.004 || !this.look) {
      this.hour = hour;
      this.look = skyLook(hour);
    }
    const look = this.look!;
    if (time - this.drawnAt > 400 || this.drawnAt < 0) {
      this.drawnAt = time;
      this.paint(look);
    }
    this.paintSun(look, time);
    this.paintStars(look, time);
  }

  private paint(look: SkyLook) {
    const { size } = this.rt;
    const horizon = size.height * (this.sky!.horizon ?? 0.6);
    const g = this.gradient!;
    g.clear();
    const top = colorNumber(look.top);
    const middle = colorNumber(look.middle);
    const low = colorNumber(look.horizon);
    const split = horizon * 0.55;
    g.fillGradientStyle(top, top, middle, middle, 1);
    g.fillRect(0, 0, size.width, split);
    g.fillGradientStyle(middle, middle, low, low, 1);
    g.fillRect(0, split - 1, size.width, horizon - split + 1);
    g.fillStyle(low, 1);
    g.fillRect(0, horizon, size.width, size.height - horizon);
    // Sky layers take on its light; the scene in front a little of it.
    const tint = colorNumber(look.tint);
    for (const layer of this.rt.system(LayerSystem).skyLayers) layer.setTint?.(tint);
    const shade = (this.sky!.shade ?? 60) / 100;
    this.shade?.setFillStyle(colorNumber(look.shade), Math.min(0.6, look.shadeAlpha * shade * 1.6));
  }

  private paintSun(look: SkyLook, time: number) {
    const sun = this.sun!;
    sun.clear();
    if (this.sky!.sun === false) return;
    const { size } = this.rt;
    const view = this.rt.scene.cameras.main.worldView;
    const horizon = size.height * (this.sky!.horizon ?? 0.6);
    // Far away: it stays where it is on the screen as the view moves.
    const x = view.x + view.width * (this.sky!.sun_x ?? 0.72);
    if (look.sun > -0.2) {
      const y = horizon - look.sun * horizon * 0.85;
      // Bigger and redder as it sinks, with a wide soft glow.
      const low = 1 - Math.max(0, Math.min(1, look.sun / 0.5));
      const r = 34 + 14 * low;
      const color = colorNumber(look.sunColor);
      // Many faint discs, so the glow fades smoothly rather than in rings.
      for (let i = 18; i >= 1; i--) {
        sun.fillStyle(color, 0.018 + 0.008 * low);
        sun.fillCircle(x, y, r * (1 + i * 0.18 * (1 + low)));
      }
      sun.fillStyle(colorNumber(mixColor(look.sunColor, '#ffffff', 0.45 * (1 - low))), 1);
      sun.fillCircle(x, y, r);
    }
    if (look.stars > 0.05) {
      // The moon, high on the other side.
      const mx = view.x + view.width * (1 - (this.sky!.sun_x ?? 0.72));
      const my = horizon * 0.28;
      const a = look.stars;
      for (let i = 12; i >= 1; i--) {
        sun.fillStyle(0xdfe8ff, 0.014 * a);
        sun.fillCircle(mx, my, 26 * (1 + i * 0.16));
      }
      sun.fillStyle(0xf4f1e2, a);
      sun.fillCircle(mx, my, 26);
      sun.fillStyle(0xd8d2bc, 0.5 * a);
      sun.fillCircle(mx - 8, my - 5, 6);
      sun.fillCircle(mx + 7, my + 8, 4);
    }
    void time;
  }

  private paintStars(look: SkyLook, time: number) {
    const stars = this.stars!;
    stars.clear();
    if (this.sky!.stars === false || look.stars <= 0.02) return;
    const view = this.rt.scene.cameras.main.worldView;
    const t = time / 1000;
    for (const s of this.starField) {
      const twinkle = 0.55 + 0.45 * Math.sin(t * s.speed + s.phase);
      stars.fillStyle(0xffffff, look.stars * twinkle);
      stars.fillCircle(view.x + s.x * view.width, s.y, s.r);
    }
  }

  destroy() {
    this.gradient?.destroy();
    this.stars?.destroy();
    this.sun?.destroy();
    this.shade?.destroy();
    this.starField = [];
    this.sky = null;
    this.look = null;
  }
}
