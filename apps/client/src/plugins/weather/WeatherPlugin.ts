import * as Phaser from 'phaser';
import type { WeatherLike } from '@qbl/shared';
import { Weather, type WeatherOptions } from './Weather';

/**
 * The weather as a Phaser scene plugin, for any scene of any game:
 *
 *   new Phaser.Game({
 *     plugins: { scene: [{ key: 'WeatherPlugin', plugin: WeatherPlugin, mapping: 'weather' }] },
 *   });
 *   // in a scene:
 *   this.weather.rain(0.5);
 *   this.weather.storm();                     // heavier, with lightning and thunder
 *   this.weather.snow(0.7, { wind: -0.4 });   // blown to the left
 *   this.weather.clear(4000);                 // passes over four seconds
 *
 * It updates itself every frame and goes away with the scene. `configure()` sets where the ground is
 * (for the rain's splashes), its depth and whether it makes sound, before the first change.
 */
export class WeatherPlugin extends Phaser.Plugins.ScenePlugin {
  private engine: Weather | null = null;
  private options: WeatherOptions = {};

  boot() {
    const events = this.systems!.events;
    events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    // A scene that restarts gets fresh weather; the plugin stays.
    events.on(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    events.once(Phaser.Scenes.Events.DESTROY, this.destroyed, this);
  }

  /** Where the ground is, the depth and the sound: before the first change of weather. */
  configure(options: WeatherOptions): this {
    this.options = options;
    return this;
  }

  /** The weather, made the first time it is needed. */
  get weather(): Weather {
    return (this.engine ??= new Weather(this.scene!, this.options));
  }

  set(w: WeatherLike | null, ms?: number) {
    return this.weather.set(w, ms);
  }

  rain(intensity?: number, more?: Partial<WeatherLike>, ms?: number) {
    return this.weather.rain(intensity, more, ms);
  }

  snow(intensity?: number, more?: Partial<WeatherLike>, ms?: number) {
    return this.weather.snow(intensity, more, ms);
  }

  storm(intensity?: number, more?: Partial<WeatherLike>, ms?: number) {
    return this.weather.storm(intensity, more, ms);
  }

  blizzard(intensity?: number, more?: Partial<WeatherLike>, ms?: number) {
    return this.weather.blizzard(intensity, more, ms);
  }

  fog(intensity?: number, more?: Partial<WeatherLike>, ms?: number) {
    return this.weather.fog(intensity, more, ms);
  }

  lightning(strength?: number) {
    this.weather.lightning(strength);
  }

  clear(ms?: number) {
    return this.engine ? this.engine.clear(ms) : Promise.resolve();
  }

  private update(time: number, delta: number) {
    this.engine?.update(time, delta);
  }

  private shutdown() {
    this.engine?.destroy();
    this.engine = null;
  }

  private destroyed() {
    const events = this.systems?.events;
    events?.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    events?.off(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.shutdown();
  }
}
