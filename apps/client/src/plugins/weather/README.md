# The weather plugin

Rain, snow, storms, blizzards and fog for any Phaser 4 scene, drawn in code (no textures to load) and
with its own sound (made with Web Audio by `../../audio/synth.ts`, through the game's master volume).

- **Rain** falls in slanting streaks, nearer drops longer, faster and brighter, and splashes on the ground.
- **Snow** drifts and sways; a **blizzard** drives it across the screen in streaks.
- A **storm** is heavy rain blown by the wind, the light going, and lightning now and then (a soft double
  flash and a bolt) with thunder a moment later.
- **Fog** is a haze, thicker near the ground, with banks drifting by.
- The wind gusts about its strength. Changes are gradual: the same weather gets heavier or lighter, another
  fades out as the new one comes in.
- With `prefers-reduced-motion`, only the darkening and the sound remain: nothing falls or flashes.

## As a scene plugin

```ts
import { WeatherPlugin } from './plugins/weather';

new Phaser.Game({
  // ...
  plugins: { scene: [{ key: 'WeatherPlugin', plugin: WeatherPlugin, mapping: 'weather' }] },
});

// in a scene's create():
this.weather.configure({ ground: () => ({ top: 800, bottom: 1200 }) }); // where rain splashes (world y)
this.weather.rain(0.5);                         // starts over 2.5 s
this.weather.storm(0.9, { wind: -0.5 }, 6000);  // blows up into a storm over 6 s
await this.weather.clear(4000);                 // passes; resolves when it has
```

It updates itself every frame and is cleaned up with the scene.

## On its own

```ts
import { Weather } from './plugins/weather';

const weather = new Weather(scene, { depth: 9000, ground: () => ({ top: 800, bottom: 1200 }), sound: true });
weather.set({ kind: 'snow', intensity: 0.7, wind: 0.3 });
// every frame:
weather.update(time, delta);
// when done:
weather.destroy();
```

`set()` takes `{ kind, intensity (0-1), wind (-1 to 1), lightning, darken (0-100), sound }`; leave any out for
its default (`weatherSettings()` in `packages/shared/src/weather.ts`). `kind: 'clear'` (or `null`) clears it.
`lightning()` flashes once whatever the weather. `onFlash` in the options is told each flash's brightness,
to light other things with it.

In QBL, `WeatherSystem` drives it from a scene's `weather` (and rain or snow in its `atmosphere`) and from
the `weather` action.
