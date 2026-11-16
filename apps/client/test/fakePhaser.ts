/**
 * A stand-in for the parts of Phaser the client uses, so scenes, systems and
 * presenters can run under Node with a manual clock and no canvas. It checks
 * the game's own logic end to end; it cannot tell whether real Phaser accepts
 * the same calls.
 */

export class Emitter {
  private handlers = new Map<string, Array<{ fn: (...a: any[]) => void; ctx: unknown; once: boolean }>>();
  on(event: string, fn: (...a: any[]) => void, ctx?: unknown) {
    this.add(event, fn, ctx, false);
    return this;
  }
  once(event: string, fn: (...a: any[]) => void, ctx?: unknown) {
    this.add(event, fn, ctx, true);
    return this;
  }
  off(event: string, fn?: (...a: any[]) => void) {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(event, fn ? list.filter((h) => h.fn !== fn) : []);
    return this;
  }
  emit(event: string, ...args: any[]) {
    for (const h of [...(this.handlers.get(event) ?? [])]) {
      if (h.once) this.off(event, h.fn);
      h.fn.apply(h.ctx, args);
    }
    return this;
  }
  removeAllListeners() {
    this.handlers.clear();
  }
  private add(event: string, fn: (...a: any[]) => void, ctx: unknown, once: boolean) {
    const list = this.handlers.get(event) ?? [];
    list.push({ fn, ctx, once });
    this.handlers.set(event, list);
  }
}

/** Any display object. Unknown methods are accepted and return the object, like Phaser's chainable setters. */
export class FakeObject extends Emitter {
  x = 0; y = 0; visible = true; destroyed = false;
  scaleX = 1; scaleY = 1; alpha = 1; flipX = false; depth = 0;
  displayWidth = 64; displayHeight = 128; width = 64; height = 128;
  tilePositionX = 0; tilePositionY = 0;
  text = '';
  input: { enabled: boolean } | null = null;
  anims = { isPlaying: false };

  constructor(readonly kind: string, readonly key: string = '', x = 0, y = 0) {
    super();
    this.x = x;
    this.y = y;
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target || typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
        return () => receiver; // setOrigin, setDepth-like calls and all graphics drawing
      },
    });
  }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setVisible(v: boolean) { this.visible = v; return this; }
  setScale(x: number, y = x) { this.scaleX = x; this.scaleY = y; return this; }
  setDepth(d: number) { this.depth = d; return this; }
  setFlipX(f: boolean) { this.flipX = f; return this; }
  setAlpha(a: number) { this.alpha = a; return this; }
  setText(t: string) { this.text = t; return this; }
  setInteractive() { this.input = { enabled: true }; return this; }
  getBounds() {
    const { x, y } = this;
    const abs = globalThis.Math.abs;
    return { contains: (px: number, py: number) => abs(px - x) <= 32 && abs(py - y) <= 32 };
  }
  play() { this.anims.isPlaying = true; return this; }
  destroy() { this.destroyed = true; this.removeAllListeners(); }
}

class FakeSprite extends FakeObject {}

export class FakeSound extends Emitter {
  isPlaying = false;
  constructor(readonly key: string, readonly config: { loop?: boolean; volume?: number }) { super(); }
  play() { this.isPlaying = true; }
  stop() { this.isPlaying = false; }
  destroy() { this.isPlaying = false; this.emit('destroy'); this.removeAllListeners(); }
}

export class Scene {
  [key: string]: any;
  constructor(readonly sceneKey: string) {}
}

export class Game {}

const key = (name: string) => name;
export const AUTO = 0;
export const Scenes = { Events: { SHUTDOWN: 'shutdown' } };
export const Scale = { RESIZE: 3, Events: { RESIZE: 'resize' } };
export const Input = {
  Events: {
    POINTER_DOWN: 'pointerdown', POINTER_MOVE: 'pointermove',
    GAMEOBJECT_POINTER_OVER: 'pointerover', GAMEOBJECT_POINTER_OUT: 'pointerout', GAMEOBJECT_POINTER_DOWN: 'pointerdown',
  },
  Keyboard: { KeyCodes: { UP: key('up'), DOWN: key('down'), LEFT: key('left'), RIGHT: key('right'), W: key('w'), A: key('a'), S: key('s'), D: key('d') } },
};
export const Cameras = { Scene2D: { Events: { FADE_OUT_COMPLETE: 'camerafadeoutcomplete' } } };
export const Loader = { Events: { COMPLETE: 'complete', PROGRESS: 'progress', FILE_LOAD_ERROR: 'loaderror' } };
export const Sound = { Events: { COMPLETE: 'complete', DESTROY: 'destroy' } };
export const Animations = { Events: { ANIMATION_COMPLETE: 'animationcomplete' } };
export const Math = { Vector2: class { constructor(public x: number, public y: number) {} } };
export const GameObjects = { Sprite: FakeSprite };

// ------------------------------------------------------------------ the world a scene runs in

interface Timer { at: number; fn: () => void; every?: number; removed: boolean }

/** Owns the clock, timers, loaded media and input for one fake game. */
export class FakeWorld {
  now = 0;
  private timers: Timer[] = [];
  readonly loaded = new Set<string>();
  readonly queued = new Set<string>();
  readonly audio = new Set<string>();
  readonly sounds: FakeSound[] = [];
  readonly objects: FakeObject[] = [];
  readonly keys: Record<string, { isDown: boolean }> = {};
  readonly registry = new Map<string, unknown>();
  private pendingRestart: unknown | undefined;
  cursor = 'default';

  schedule(ms: number, fn: () => void, every?: number): Timer {
    const t: Timer = { at: this.now + ms, fn, every, removed: false };
    this.timers.push(t);
    return t;
  }

  /** Attach everything a Phaser.Scene expects to find on itself. */
  mount(scene: Scene) {
    const world = this;
    const make = (kind: string, Ctor: typeof FakeObject = FakeObject) => (x = 0, y = 0, ...rest: any[]) => {
      const textureKey = typeof rest[0] === 'string' ? rest[0] : typeof rest[2] === 'string' ? rest[2] : '';
      const o = new Ctor(kind, textureKey, x, y);
      if (kind === 'text') o.text = String(rest[0] ?? '');
      world.objects.push(o);
      return o;
    };
    scene.registry = { get: (k: string) => world.registry.get(k), set: (k: string, v: unknown) => world.registry.set(k, v) };
    scene.events = new Emitter();
    scene.add = {
      image: make('image'), text: make('text'), sprite: make('sprite', FakeSprite), tileSprite: make('tileSprite'),
      rectangle: make('rectangle'), graphics: () => make('graphics')(),
    };
    scene.make = { graphics: () => make('graphics')() };
    scene.textures = {
      exists: (k: string) => world.loaded.has(k),
      get: () => ({ getSourceImage: () => ({ width: 1024, height: 512 }) }),
      addSpriteSheet: (k: string) => world.loaded.add(k),
    };
    // generateTexture() is swallowed by the proxy, so the default avatar texture is treated as present.
    world.loaded.add('avatar-default');
    scene.cache = { audio: { exists: (k: string) => world.audio.has(k) } };
    scene.anims = { exists: () => true, create: () => {} };
    scene.sound = {
      add: (k: string, config: object) => {
        const s = new FakeSound(k, config);
        world.sounds.push(s);
        return s;
      },
    };
    const loader = new Emitter() as Emitter & Record<string, any>;
    loader.image = (k: string) => world.queued.add(k);
    loader.audio = (k: string) => world.queued.add('audio:' + k);
    loader.isLoading = () => false;
    loader.start = () => {
      for (const k of world.queued) k.startsWith('audio:') ? world.audio.add(k.slice(6)) : world.loaded.add(k);
      world.queued.clear();
      world.schedule(0, () => loader.emit('complete'));
    };
    scene.load = loader;
    scene.time = {
      delayedCall: (ms: number, fn: () => void) => {
        const t = world.schedule(ms, fn);
        return { remove: () => (t.removed = true) };
      },
      addEvent: (c: { delay: number; loop?: boolean; callback: () => void }) => {
        const t = world.schedule(c.delay, c.callback, c.loop ? c.delay : undefined);
        return { remove: () => (t.removed = true) };
      },
    };
    scene.tweens = {
      add: (c: Record<string, any>) => {
        const { targets, duration = 0, onComplete, yoyo, repeat, ease, ...props } = c;
        if (repeat === -1) return { stop() {} }; // decorative loops never finish
        const t = world.schedule(duration, () => {
          Object.assign(targets, props);
          onComplete?.();
        });
        return { stop: () => (t.removed = true) };
      },
      killTweensOf: () => {},
    };
    const camera = new Emitter() as Emitter & Record<string, any>;
    Object.assign(camera, {
      setBounds() {}, centerOn() {}, startFollow() {}, fadeIn() {}, setZoom() {},
      fadeOut: (ms: number) => world.schedule(ms, () => camera.emit('camerafadeoutcomplete')),
      getWorldPoint: (x: number, y: number) => ({ x, y }),
    });
    scene.cameras = { main: camera };
    const input = new Emitter() as Emitter & Record<string, any>;
    input.keyboard = { addKey: (code: string) => (world.keys[code] ??= { isDown: false }) };
    input.setDefaultCursor = (c: string) => (world.cursor = c);
    scene.input = input;
    const scale = new Emitter() as Emitter & Record<string, any>;
    scale.gameSize = { width: 1280, height: 720 };
    scene.scale = scale;
    scene.scene = { restart: (data: unknown) => (world.pendingRestart = data ?? {}), start: () => {} };
  }

  /** Advance time by `ms` in 16 ms frames, running timers, the scene's update and any pending restart. */
  async advance(scene: Scene, ms: number) {
    const end = this.now + ms;
    while (this.now < end) {
      this.now = globalThis.Math.min(end, this.now + 16);
      for (const t of [...this.timers]) {
        if (t.removed || t.at > this.now) continue;
        if (t.every) t.at += t.every;
        else t.removed = true;
        t.fn();
      }
      this.timers = this.timers.filter((t) => !t.removed);
      await settle();
      if (this.pendingRestart !== undefined) {
        const data = this.pendingRestart;
        this.pendingRestart = undefined;
        scene.events.emit('shutdown');
        this.timers = [];
        scene.input.removeAllListeners();
        scene.cameras.main.removeAllListeners();
        scene.load.removeAllListeners();
        scene.init?.();
        scene.create(data);
      } else {
        scene.update?.(this.now, 16);
      }
      await settle();
    }
  }
}

/** Let promise chains run to completion. */
export async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
