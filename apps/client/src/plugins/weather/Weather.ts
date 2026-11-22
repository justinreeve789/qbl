import type * as Phaser from 'phaser';
import { weatherSettings, type WeatherLike, type WeatherSettings } from '@qbl/shared';
import { synthFor, type Voice } from '../../audio/synth';

/**
 * Weather for any Phaser scene: rain with splashes on the ground, snow, a storm (heavy rain blown by
 * the wind, the light going, lightning and thunder), a blizzard, fog drifting by. It is drawn over the
 * scene in the part of it the camera is looking at, changes smoothly from one weather to another, and
 * makes its own sound (rain, wind, thunder) with the game's synth.
 *
 *   const weather = new Weather(scene, { ground: () => ({ top: 800, bottom: 1200 }) });
 *   weather.set({ kind: 'rain', intensity: 0.5 });           // starts over 2.5 s
 *   weather.set({ kind: 'storm' }, 6000);                     // blows up into a storm
 *   weather.clear();                                          // and passes
 *   // every frame: weather.update(time, delta); when done: weather.destroy()
 *
 * WeatherPlugin wraps it as a scene plugin (`this.weather.rain()`). In QBL, WeatherSystem drives it
 * from a scene's `weather` and the weather action.
 */
export interface WeatherOptions {
  /** Draw order: over the scene, under what is drawn above it. Default 9000. */
  depth?: number;
  /** Where the ground is, in world pixels down: raindrops splash between top and bottom. Default: the lower third of the view. */
  ground?: () => { top: number; bottom: number } | null;
  /** Its sound. Default true. */
  sound?: boolean;
  /** Draw nothing that moves or flashes, only the darkening (and the sound). Default: as the player's system asks (prefers-reduced-motion). */
  reducedMotion?: boolean;
  /** Each lightning flash, as it happens, with its brightness from 0 to 1: to light other things. */
  onFlash?: (brightness: number) => void;
}

interface Drop { x: number; y: number; z: number; len: number; speed: number; land: number | null }
interface Flake { x: number; y: number; z: number; size: number; phase: number; speed: number }
interface Puff { x: number; y: number; r: number; z: number; phase: number }
interface Splash { x: number; y: number; z: number; age: number }
interface Flash { at: number; strength: number; bolt: Array<{ x: number; y: number }>; branch: Array<{ x: number; y: number }> }

/** One weather, fading in or out. */
interface Front {
  s: WeatherSettings;
  /** How much of it there is now, 0 to 1, and where that is heading. */
  level: number;
  target: number;
  /** Per millisecond. */
  rate: number;
  /** Settings it is gliding to (the same weather, heavier or lighter), and how far it has got. */
  from: WeatherSettings | null;
  to: WeatherSettings | null;
  glide: number;
  glideRate: number;
  drops: Drop[];
  flakes: Flake[];
  puffs: Puff[];
  nextFlash: number;
  voices: Map<string, { voice: Voice; volume: number }>;
}

const MAX = { drops: 320, flakes: 420, puffs: 10 };

export class Weather {
  private fronts: Front[] = [];
  private splashes: Splash[] = [];
  private flashes: Flash[] = [];
  private g: Phaser.GameObjects.Graphics;
  private shade: Phaser.GameObjects.Graphics;
  private time = 0;
  private still: boolean;
  private sound: boolean;
  private waiters: Array<{ until: number; resolve: () => void }> = [];

  constructor(private scene: Phaser.Scene, private o: WeatherOptions = {}) {
    const depth = o.depth ?? 9000;
    this.shade = scene.add.graphics().setDepth(depth);
    this.g = scene.add.graphics().setDepth(depth + 1);
    this.still = o.reducedMotion ?? (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    this.sound = o.sound !== false;
  }

  /** The weather it is heading for, or null when it is clearing. */
  get current(): WeatherSettings | null {
    const f = this.fronts.find((x) => x.target > 0);
    return f ? (f.to ?? f.s) : null;
  }

  /**
   * Change the weather over `ms`: to `w` (a scene's weather, or a weather action's), or with null (or
   * kind "clear") to none. The same kind changes how heavy it is; another kind fades the old one out
   * as the new one comes in. Settles when the change is complete.
   */
  set(w: WeatherLike | null, ms = 2500): Promise<void> {
    const next = weatherSettings(w);
    const rate = 1 / Math.max(1, ms);
    const same = next ? this.fronts.find((f) => f.target > 0 && f.s.kind === next.kind) : undefined;
    for (const f of this.fronts) {
      if (f !== same) {
        f.target = 0;
        f.rate = rate;
      }
    }
    if (same && next) {
      same.from = { ...(same.to ?? same.s) };
      same.to = next;
      same.glide = 0;
      same.glideRate = rate;
      same.target = 1;
      same.rate = rate;
    } else if (next) {
      this.fronts.push(this.front(next, rate));
    }
    return new Promise((resolve) => this.waiters.push({ until: this.time + ms, resolve }));
  }

  rain(intensity = 0.6, more: Partial<WeatherLike> = {}, ms?: number) {
    return this.set({ ...more, kind: 'rain', intensity }, ms);
  }

  snow(intensity = 0.6, more: Partial<WeatherLike> = {}, ms?: number) {
    return this.set({ ...more, kind: 'snow', intensity }, ms);
  }

  storm(intensity = 0.85, more: Partial<WeatherLike> = {}, ms?: number) {
    return this.set({ ...more, kind: 'storm', intensity }, ms);
  }

  blizzard(intensity = 0.85, more: Partial<WeatherLike> = {}, ms?: number) {
    return this.set({ ...more, kind: 'blizzard', intensity }, ms);
  }

  fog(intensity = 0.6, more: Partial<WeatherLike> = {}, ms?: number) {
    return this.set({ ...more, kind: 'fog', intensity }, ms);
  }

  clear(ms?: number) {
    return this.set(null, ms);
  }

  /** A flash of lightning now (and its thunder a moment later), whatever the weather. */
  lightning(strength = 1) {
    if (this.still) return;
    const x = 0.15 + Math.random() * 0.7;
    const bolt = [{ x, y: -0.02 }];
    let px = x;
    const bottom = 0.35 + Math.random() * 0.25;
    for (let y = 0.05; y < bottom; y += 0.04 + Math.random() * 0.05) {
      px += (Math.random() - 0.5) * 0.05;
      bolt.push({ x: px, y });
    }
    const from = bolt[Math.floor(bolt.length / 2)]!;
    const branch = [from];
    let bx = from.x;
    for (let y = from.y + 0.04; y < from.y + 0.2; y += 0.04) {
      bx += (Math.random() < 0.5 ? -1 : 1) * 0.025;
      branch.push({ x: bx, y });
    }
    this.flashes.push({ at: this.time, strength, bolt, branch });
    if (this.sound) {
      const synth = synthFor(this.scene);
      globalThis.setTimeout(() => synth.play('thunder', { volume: 0.45 + 0.4 * strength }), 400 + Math.random() * 1200);
    }
  }

  update(_time: number, delta: number) {
    const dt = Math.min(delta, 100);
    this.time += dt;
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    this.g.clear();
    this.shade.clear();

    let dark = 0;
    for (const f of [...this.fronts]) {
      // Fade in or out, and glide to new settings.
      f.level = f.target > f.level ? Math.min(f.target, f.level + f.rate * dt) : Math.max(f.target, f.level - f.rate * dt);
      if (f.to && f.from) {
        f.glide = Math.min(1, f.glide + f.glideRate * dt);
        const k = f.glide;
        f.s = { ...f.to, intensity: f.from.intensity + (f.to.intensity - f.from.intensity) * k, wind: f.from.wind + (f.to.wind - f.from.wind) * k, darken: f.from.darken + (f.to.darken - f.from.darken) * k };
        if (k >= 1) {
          f.s = f.to;
          f.from = f.to = null;
        }
      }
      this.voice(f);
      if (f.level <= 0 && f.target === 0) {
        for (const v of f.voices.values()) v.voice.stop(300);
        this.fronts.splice(this.fronts.indexOf(f), 1);
        continue;
      }
      dark = Math.max(dark, f.s.darken * f.level * (0.55 + 0.45 * f.s.intensity));
      if (this.still) continue;
      const wind = f.s.wind + this.gust(f.s.wind);
      switch (f.s.kind) {
        case 'rain':
        case 'storm':
          this.drawRain(f, wind, dt, view);
          break;
        case 'snow':
        case 'blizzard':
          this.drawSnow(f, wind, dt, view);
          break;
        case 'fog':
          this.drawFog(f, wind, dt, view);
          break;
      }
      if (f.s.lightning && f.level > 0.6 && this.time >= f.nextFlash) {
        this.lightning(0.6 + Math.random() * 0.4);
        f.nextFlash = this.time + (7000 + Math.random() * 9000) * (1.4 - 0.6 * f.s.intensity);
      }
    }

    // The light going: the scene darkened (and a little blue), under the rain.
    if (dark > 0.002) {
      this.shade.fillStyle(0x0e1626, Math.min(0.7, dark));
      this.shade.fillRect(view.x - 4, view.y - 4, view.width + 8, view.height + 8);
    }
    this.drawSplashes(dt);
    this.drawFlashes(view);

    for (const w of [...this.waiters]) {
      if (this.time >= w.until) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve();
      }
    }
  }

  destroy() {
    for (const f of this.fronts) for (const v of f.voices.values()) v.voice.stop(200);
    this.fronts = [];
    for (const w of this.waiters) w.resolve();
    this.waiters = [];
    this.g.destroy();
    this.shade.destroy();
  }

  // ------------------------------------------------------------ fronts

  private front(s: WeatherSettings, rate: number): Front {
    const r = Math.random;
    const f: Front = {
      s, level: 0, target: 1, rate, from: null, to: null, glide: 1, glideRate: rate,
      drops: [], flakes: [], puffs: [], nextFlash: this.time + 2500 + r() * 4000, voices: new Map(),
    };
    if (s.kind === 'rain' || s.kind === 'storm') for (let i = 0; i < MAX.drops; i++) f.drops.push(this.drop(r()));
    if (s.kind === 'snow' || s.kind === 'blizzard') for (let i = 0; i < MAX.flakes; i++) f.flakes.push(this.flake(r()));
    if (s.kind === 'fog') for (let i = 0; i < MAX.puffs; i++) f.puffs.push({ x: r() * 1.4 - 0.2, y: 0.35 + r() * 0.6, r: 0.18 + r() * 0.2, z: 0.4 + r() * 0.6, phase: r() * 6 });
    return f;
  }

  private drop(y: number): Drop {
    const r = Math.random;
    // Nearer drops (z towards 1) are longer, faster and brighter; only they are seen to splash.
    const z = 0.35 + r() * 0.65;
    return { x: r() * 1.3 - 0.15, y, z, len: 0.03 + 0.05 * z, speed: 1.1 + 1.1 * z + r() * 0.3, land: null };
  }

  private flake(y: number): Flake {
    const r = Math.random;
    const z = 0.3 + r() * 0.7;
    return { x: r() * 1.3 - 0.15, y, z, size: 1.6 + 4 * z * z, phase: r() * Math.PI * 2, speed: 0.04 + 0.08 * z + r() * 0.02 };
  }

  /** The wind gusting about its own strength. */
  private gust(wind: number): number {
    const t = this.time / 1000;
    return (Math.sin(t * 0.37) * 0.6 + Math.sin(t * 1.13 + 1.7) * 0.4) * (0.08 + Math.abs(wind) * 0.25);
  }

  private voice(f: Front) {
    if (!this.sound) return;
    const want: Record<string, number> = {};
    const amount = f.level * f.s.intensity;
    if (f.s.sound) {
      switch (f.s.kind) {
        case 'rain':
          want[f.s.intensity > 0.7 ? 'heavy_rain' : 'rain'] = 0.25 + 0.5 * amount;
          break;
        case 'storm':
          want.heavy_rain = 0.3 + 0.55 * amount;
          want.wind = 0.15 + 0.35 * amount;
          break;
        case 'snow':
          if (Math.abs(f.s.wind) > 0.3) want.wind = 0.1 + 0.2 * amount;
          break;
        case 'blizzard':
          want.wind = 0.25 + 0.5 * amount;
          break;
      }
    }
    const synth = synthFor(this.scene);
    for (const [name, v] of f.voices) {
      if (!(name in want)) {
        v.voice.stop(800);
        f.voices.delete(name);
      }
    }
    for (const [name, volume] of Object.entries(want)) {
      const v = f.voices.get(name);
      if (!v) f.voices.set(name, { voice: synth.play(name as 'rain', { volume, loop: true }), volume });
      else if (Math.abs(v.volume - volume) > 0.04) {
        // Only when it has changed enough: setting it every frame would fight the glide.
        v.voice.setVolume(volume, 700);
        v.volume = volume;
      }
    }
  }

  // ------------------------------------------------------------ drawing

  private drawRain(f: Front, wind: number, dt: number, view: Phaser.Geom.Rectangle) {
    const g = this.g;
    const s = dt / 1000;
    const n = Math.round(f.drops.length * Math.min(1, f.s.intensity * 1.1) * f.level);
    const ground = this.ground(view);
    const slant = wind * 0.55;
    const storm = f.s.kind === 'storm' ? 1.15 : 1;
    for (let i = 0; i < n; i++) {
      const d = f.drops[i]!;
      d.y += d.speed * storm * s;
      d.x += slant * d.speed * storm * s;
      const wx = view.x + d.x * view.width;
      const wy = view.y + d.y * view.height;
      // Near drops land on the ground somewhere between its back and its front, and splash.
      if (d.land == null && d.z > 0.7 && ground) d.land = ground.top + Math.random() * (ground.bottom - ground.top);
      if ((d.land != null && wy >= d.land) || d.y > 1.08 || d.x < -0.25 || d.x > 1.25) {
        if (d.land != null && wy >= d.land && this.splashes.length < 160) this.splashes.push({ x: wx, y: d.land, z: d.z, age: 0 });
        Object.assign(d, this.drop(-0.05 - Math.random() * 0.1));
        if (wind > 0.2) d.x -= 0.2 * wind;
        if (wind < -0.2) d.x -= 0.2 * wind;
        continue;
      }
      const len = d.len * view.height;
      g.lineStyle(0.8 + 1.4 * d.z, 0xc8dcff, (0.16 + 0.34 * d.z) * Math.min(1, f.level * 1.5));
      g.lineBetween(wx, wy, wx - slant * len, wy - len);
    }
  }

  private drawSnow(f: Front, wind: number, dt: number, view: Phaser.Geom.Rectangle) {
    const g = this.g;
    const s = dt / 1000;
    const t = this.time / 1000;
    const blizzard = f.s.kind === 'blizzard';
    const n = Math.round(f.flakes.length * Math.min(1, f.s.intensity * 1.1) * f.level);
    for (let i = 0; i < n; i++) {
      const p = f.flakes[i]!;
      const fall = p.speed * (blizzard ? 1.8 : 1);
      p.y += fall * s;
      p.x += (wind * (blizzard ? 0.55 : 0.18) * p.z + Math.sin(t * (0.8 + p.z) + p.phase) * 0.02) * s;
      if (p.y > 1.04 || p.x < -0.2 || p.x > 1.2) {
        Object.assign(p, this.flake(-0.03 - Math.random() * 0.05));
        if (wind > 0.3) p.x -= 0.25 * wind;
        if (wind < -0.3) p.x -= 0.25 * wind;
        continue;
      }
      const x = view.x + p.x * view.width + Math.sin(t * 1.3 + p.phase) * 5 * p.z;
      const y = view.y + p.y * view.height;
      const alpha = (0.55 + 0.4 * p.z) * Math.min(1, f.level * 1.5);
      if (blizzard && p.z > 0.6) {
        // Driven snow streaks.
        g.lineStyle(p.size * 0.9, 0xffffff, alpha * 0.7);
        g.lineBetween(x, y, x - wind * 18 * p.z, y - 6 * p.z);
      } else {
        g.fillStyle(0xffffff, alpha);
        g.fillCircle(x, y, p.size);
      }
    }
  }

  private drawFog(f: Front, wind: number, dt: number, view: Phaser.Geom.Rectangle) {
    const g = this.g;
    const s = dt / 1000;
    const t = this.time / 1000;
    const amount = f.level * (0.35 + 0.65 * f.s.intensity);
    // A thin haze everywhere, thicker towards the ground; then drifting banks.
    g.fillStyle(0xdde4ea, 0.16 * amount);
    g.fillRect(view.x, view.y, view.width, view.height);
    g.fillStyle(0xdde4ea, 0.14 * amount);
    g.fillRect(view.x, view.y + view.height * 0.55, view.width, view.height * 0.45);
    for (const p of f.puffs) {
      p.x += (wind * 0.04 + 0.006) * p.z * s;
      if (p.x > 1.35) p.x = -0.35;
      if (p.x < -0.35) p.x = 1.35;
      const cx = view.x + p.x * view.width;
      const cy = view.y + (p.y + Math.sin(t * 0.15 + p.phase) * 0.02) * view.height;
      const r = p.r * view.width;
      // A soft bank: rings of fog, faint at the edge.
      for (let k = 4; k >= 1; k--) {
        g.fillStyle(0xe9eef2, 0.075 * amount * p.z);
        g.fillEllipse(cx, cy, r * 2 * (k / 4) + r, r * 0.55 * (k / 4) + r * 0.25);
      }
    }
  }

  private drawSplashes(dt: number) {
    const g = this.g;
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const p = this.splashes[i]!;
      p.age += dt;
      const k = p.age / 260;
      if (k >= 1) {
        this.splashes.splice(i, 1);
        continue;
      }
      const w = (3 + 11 * k) * p.z;
      g.lineStyle(1.2, 0xdde8ff, 0.5 * (1 - k));
      g.strokeEllipse(p.x, p.y, w * 2, w * 0.5);
      // Two droplets thrown up.
      const up = Math.sin(k * Math.PI) * 9 * p.z;
      g.fillStyle(0xdde8ff, 0.6 * (1 - k));
      g.fillCircle(p.x - w * 0.6, p.y - up, 1.2 * p.z);
      g.fillCircle(p.x + w * 0.7, p.y - up * 0.8, 1.1 * p.z);
    }
  }

  private drawFlashes(view: Phaser.Geom.Rectangle) {
    const g = this.g;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      const age = this.time - f.at;
      if (age > 700) {
        this.flashes.splice(i, 1);
        this.o.onFlash?.(0);
        continue;
      }
      // Two quick pulses, the second fainter: soft enough not to dazzle.
      const pulse = age < 90 ? 1 - age / 90 : age > 160 && age < 300 ? 0.55 * (1 - (age - 160) / 140) : 0;
      const b = pulse * f.strength;
      this.o.onFlash?.(b);
      if (b > 0) {
        g.fillStyle(0xeef3ff, 0.32 * b);
        g.fillRect(view.x - 4, view.y - 4, view.width + 8, view.height + 8);
      }
      if (age < 260) {
        const a = 1 - age / 260;
        const at = (p: { x: number; y: number }) => [view.x + p.x * view.width, view.y + p.y * view.height] as const;
        for (const [line, width] of [[f.bolt, 4], [f.branch, 2]] as const) {
          g.lineStyle(width * 3, 0xaac4ff, 0.18 * a);
          this.polyline(line.map(at));
          g.lineStyle(width, 0xffffff, 0.9 * a);
          this.polyline(line.map(at));
        }
      }
    }
  }

  private polyline(points: ReadonlyArray<readonly [number, number]>) {
    for (let i = 1; i < points.length; i++) this.g.lineBetween(points[i - 1]![0], points[i - 1]![1], points[i]![0], points[i]![1]);
  }

  /** Where the ground is: as given, else the lower third of the view. */
  private ground(view: Phaser.Geom.Rectangle): { top: number; bottom: number } | null {
    const given = this.o.ground?.();
    if (given) {
      const top = Math.max(given.top, view.y);
      const bottom = Math.min(given.bottom, view.y + view.height);
      return bottom > top ? { top, bottom } : null;
    }
    return { top: view.y + view.height * 0.66, bottom: view.y + view.height };
  }
}
