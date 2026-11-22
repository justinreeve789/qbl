import { deferred } from '../actions/Presenter';
import type { ActionHandle, SceneAtmosphere, WeatherAction, WeatherLike } from '@qbl/shared';
import { Depth } from '../core/depth';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { Weather } from '../plugins/weather/Weather';

/** How heavy rain or snow in the air (Scene.atmosphere) is, as weather. */
const AMOUNT: Record<NonNullable<SceneAtmosphere['amount']>, number> = { few: 0.3, some: 0.55, many: 0.85 };

/**
 * The scene's weather (Scene.weather), drawn by the weather plugin: rain splashing on the floor, snow,
 * a storm, fog. Rain or snow listed in the scene's `atmosphere` is weather too. A weather action
 * changes it while the player is here; leaving the scene ends it.
 */
export class WeatherSystem implements SceneSystem {
  private weather: Weather | null = null;

  constructor(private rt: SceneRuntime) {}

  create() {
    const start = this.rt.def.weather ?? this.fromAtmosphere();
    if (start) this.engine().set(start, 1);
  }

  /** What the weather is heading for now: for tests and the editor's preview. */
  get current() {
    return this.weather?.current ?? null;
  }

  /** A weather action: change it, over its duration. */
  change(action: WeatherAction): ActionHandle {
    const d = deferred();
    const ms = Math.max(1, action.duration ?? 3000);
    void this.engine().set(action.kind === 'clear' ? null : (action as WeatherLike), ms).then(d.resolve);
    return { done: d.done, cancel: d.resolve };
  }

  update(time: number, delta: number) {
    this.weather?.update(time, delta);
  }

  destroy() {
    this.weather?.destroy();
    this.weather = null;
  }

  private engine(): Weather {
    if (this.weather) return this.weather;
    const { def } = this.rt;
    // Raindrops splash on the floor: between the top and the bottom of the walkable areas.
    const ys = (def.walkable_areas ?? []).flat().map((p) => p.y);
    const floor = ys.length ? { top: Math.min(...ys), bottom: Math.max(...ys) } : null;
    this.weather = new Weather(this.rt.scene, { depth: Depth.label - 7, ground: floor ? () => floor : undefined });
    return this.weather;
  }

  private fromAtmosphere(): WeatherLike | null {
    const a = (this.rt.def.atmosphere ?? []).find((x) => x.kind === 'rain' || x.kind === 'snow');
    // Rain or snow in the air: weather, quietly (it had no sound before).
    return a ? { kind: a.kind as 'rain' | 'snow', intensity: AMOUNT[a.amount ?? 'some'], sound: a.kind === 'rain' } : null;
  }
}
