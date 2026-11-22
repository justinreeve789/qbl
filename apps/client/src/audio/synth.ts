import type { BuiltInSound } from '@qbl/shared';
import { BUILT_IN_SOUNDS } from '@qbl/shared';

/**
 * The game's own sounds (AudioAction.sound, the weather's rain and wind, a river's rushing), made
 * with Web Audio as they are played: noise shaped by filters for rain, wind and water; tones and
 * envelopes for a bell, a horn, a door. No files, so a scenario (and the weather plugin) needs no
 * recordings. Everything goes through the destination it is given (Phaser's master volume), and is
 * silent where there is no Web Audio (tests, old browsers).
 */

/** A sound that is playing. */
export interface Voice {
  /** Settles when it has stopped: by itself (a one-shot), or after stop(). */
  readonly done: Promise<void>;
  /** Fade it out over `fadeMs` and stop. */
  stop(fadeMs?: number): void;
  /** Change how loud it is, gliding over `ms`. */
  setVolume(volume: number, ms?: number): void;
}

export interface PlayOptions {
  volume?: number;
  /** Go on until stopped: a sound that goes on by itself (rain) plays on; a one-shot is played again and again. */
  loop?: boolean;
  /** -1 (left) to 1 (right), where the browser can place sounds. */
  pan?: number;
}

interface Out {
  ctx: AudioContext;
  destination: AudioNode;
}

const SILENT: Voice = { done: Promise.resolve(), stop() {}, setVolume() {} };

export class Synth {
  private noise: { white: AudioBuffer; brown: AudioBuffer; pink: AudioBuffer } | null = null;

  constructor(private out: () => Out | null) {}

  /** Play one of the game's own sounds. A silent voice when there is no Web Audio. */
  play(name: BuiltInSound, o: PlayOptions = {}): Voice {
    const out = this.out();
    if (!out || !BUILT_IN_SOUNDS[name]) return SILENT;
    try {
      return this.start(out, name, o);
    } catch (err) {
      console.warn(`[qbl] sound ${name}: ${String(err)}`);
      return SILENT;
    }
  }

  private start(out: Out, name: BuiltInSound, o: PlayOptions): Voice {
    const { ctx } = out;
    const master = ctx.createGain();
    master.gain.value = 0;
    let last: AudioNode = master;
    let panner: StereoPannerNode | undefined;
    if (typeof ctx.createStereoPanner === 'function') {
      panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
      master.connect(panner);
      last = panner;
    }
    last.connect(out.destination);
    const volume = Math.max(0, Math.min(1, o.volume ?? 1));
    const now = ctx.currentTime;
    const sources: AudioScheduledSourceNode[] = [];
    const timers: Array<ReturnType<typeof setInterval>> = [];
    let stopped = false;
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const kit: Kit = {
      ctx, master, now, noise: this.buffers(ctx), pan: panner?.pan,
      source: (s) => (sources.push(s), s),
      every: (ms, fn) => {
        const id = globalThis.setInterval(() => !stopped && fn(ctx.currentTime), ms);
        timers.push(id);
      },
    };
    const loops = BUILT_IN_SOUNDS[name].loop;
    // A sound that goes on by itself fades in; a one-shot starts at once.
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(volume, now + (loops ? 1.2 : 0.01));
    const length = SOUNDS[name](kit);
    const end = () => {
      if (stopped) return;
      stopped = true;
      for (const t of timers) globalThis.clearInterval(t);
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          // already stopped
        }
      }
      try {
        master.disconnect();
        if (last !== master) last.disconnect();
      } catch {
        // gone
      }
      resolve();
    };
    const fade = (ms: number) => {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + Math.max(0.02, ms / 1000));
      globalThis.setTimeout(end, Math.max(20, ms) + 60);
    };
    if (length != null) {
      if (o.loop) {
        // A one-shot again and again, until stopped.
        const again = () => {
          if (stopped) return;
          SOUNDS[name]({ ...kit, now: ctx.currentTime });
        };
        kit.every(Math.max(400, length * 1000 + 700), again);
      } else {
        globalThis.setTimeout(end, length * 1000 + 150);
      }
    } else if (!o.loop) {
      // Rain or a river played once: a few seconds of it.
      globalThis.setTimeout(() => fade(1500), 5000);
    }
    return {
      done,
      stop: (fadeMs = 400) => {
        if (!stopped) fade(fadeMs);
      },
      setVolume: (v, ms = 600) => {
        if (stopped) return;
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, v)), t + Math.max(0.02, ms / 1000));
      },
    };
  }

  /** Seconds of white, brown and pink noise, made once per audio context. */
  private buffers(ctx: AudioContext) {
    if (this.noise && this.noise.white.sampleRate === ctx.sampleRate) return this.noise;
    const n = ctx.sampleRate * 3;
    const make = () => ctx.createBuffer(1, n, ctx.sampleRate);
    const white = make();
    const brown = make();
    const pink = make();
    const w = white.getChannelData(0);
    const b = brown.getChannelData(0);
    const p = pink.getChannelData(0);
    let last = 0;
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.random() * 2 - 1;
      w[i] = r;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
      b0 = 0.99765 * b0 + r * 0.099046;
      b1 = 0.963 * b1 + r * 0.2965164;
      b2 = 0.57 * b2 + r * 1.0526913;
      p[i] = (b0 + b1 + b2 + r * 0.1848) * 0.18;
    }
    this.noise = { white, brown, pink };
    return this.noise;
  }
}

/** What a sound is made with. */
interface Kit {
  ctx: AudioContext;
  /** Everything a sound makes goes into this. */
  master: GainNode;
  /** Where it is, left to right, where the browser can place sounds. */
  pan?: AudioParam;
  /** When it starts. */
  now: number;
  noise: { white: AudioBuffer; brown: AudioBuffer; pink: AudioBuffer };
  /** Register a source so stopping the sound stops it. */
  source<T extends AudioScheduledSourceNode>(s: T): T;
  /** Call `fn` every `ms` until the sound stops (for raindrops on a roof, a bird's next phrase). */
  every(ms: number, fn: (t: number) => void): void;
}

/** Each sound: builds itself into `kit.master` and returns how many seconds it lasts, or null when it goes on until stopped. */
const SOUNDS: Record<BuiltInSound, (k: Kit) => number | null> = {
  rain: (k) => {
    bed(k, 'pink', [['highpass', 500, 0.5], ['lowpass', 7000, 0.4]], 0.55, 0.23, 0.18);
    drips(k, 90, 0.35, 0.06);
    return null;
  },
  heavy_rain: (k) => {
    bed(k, 'pink', [['highpass', 300, 0.5], ['lowpass', 9000, 0.4]], 0.85, 0.31, 0.12);
    bed(k, 'brown', [['lowpass', 260, 0.7]], 0.5, 0.11, 0.25);
    drips(k, 50, 0.5, 0.08);
    return null;
  },
  wind: (k) => {
    const g = bed(k, 'brown', [['bandpass', 520, 0.9]], 0.9, 0.07, 0.45);
    // The wind rises and falls, and its pitch with it.
    const f = (g as GainNode & { filter?: BiquadFilterNode }).filter;
    if (f) lfo(k, f.frequency, 0.11, 260);
    return null;
  },
  river: (k) => {
    bed(k, 'pink', [['lowpass', 1500, 0.6], ['highpass', 120, 0.5]], 0.7, 0.19, 0.12);
    bed(k, 'brown', [['lowpass', 500, 0.6]], 0.5, 0.17, 0.2);
    return null;
  },
  stream: (k) => {
    const g = bed(k, 'white', [['bandpass', 2400, 2.5]], 0.32, 3.3, 0.35);
    const f = (g as GainNode & { filter?: BiquadFilterNode }).filter;
    if (f) {
      lfo(k, f.frequency, 2.7, 700);
      lfo(k, f.frequency, 4.3, 400);
    }
    bed(k, 'pink', [['lowpass', 900, 0.6]], 0.25, 0.3, 0.2);
    return null;
  },
  waves: (k) => {
    const g = bed(k, 'pink', [['lowpass', 900, 0.6]], 0.9, 0.11, 0.85);
    void g;
    bed(k, 'white', [['highpass', 3000, 0.5]], 0.08, 0.11, 0.9);
    return null;
  },
  fire: (k) => {
    bed(k, 'brown', [['lowpass', 420, 0.7]], 0.55, 0.4, 0.25);
    k.every(60, (t) => {
      if (Math.random() < 0.45) burst(k, t + Math.random() * 0.05, 'white', 'highpass', 1800 + Math.random() * 3000, 0.004 + Math.random() * 0.012, 0.25 + Math.random() * 0.5);
    });
    return null;
  },
  birds: (k) => {
    k.every(1700, (t) => {
      if (Math.random() < 0.75) phrase(k, t + Math.random() * 0.6, 2 + Math.floor(Math.random() * 4), 2200 + Math.random() * 1800);
    });
    phrase(k, k.now + 0.3, 3, 2900);
    return null;
  },
  crickets: (k) => {
    k.every(620, (t) => {
      const f = 4300 + Math.random() * 300;
      for (let i = 0; i < 3; i++) tone(k, t + i * 0.035, 'sine', f, f, 0.022, 0.18);
    });
    return null;
  },
  thunder: (k) => {
    const t = k.now;
    // A crack, close by; then the long rumble rolling away.
    burst(k, t, 'white', 'highpass', 1500, 0.18, 0.5);
    const src = k.source(noiseSource(k, 'brown'));
    const lp = k.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 3.5);
    const g = k.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.4, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.9);
    g.gain.linearRampToValueAtTime(0.9, t + 1.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
    src.connect(lp).connect(g).connect(k.master);
    src.start(t, Math.random());
    src.stop(t + 4.4);
    return 4.4;
  },
  car: (k) => {
    const t = k.now;
    const len = 4;
    // The engine, pitched up as it comes and down as it goes (a Doppler shift), loudest as it passes.
    const g = k.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + len * 0.48);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const lp = k.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(g).connect(k.master);
    for (const [type, f, v] of [['sawtooth', 62, 0.35], ['square', 124, 0.12]] as const) {
      const o = k.source(k.ctx.createOscillator());
      o.type = type;
      o.frequency.setValueAtTime(f * 1.12, t);
      o.frequency.linearRampToValueAtTime(f * 1.08, t + len * 0.45);
      o.frequency.linearRampToValueAtTime(f * 0.88, t + len * 0.55);
      o.frequency.linearRampToValueAtTime(f * 0.86, t + len);
      const og = k.ctx.createGain();
      og.gain.value = v;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + len);
    }
    const n = k.source(noiseSource(k, 'pink'));
    const ng = k.ctx.createGain();
    ng.gain.value = 0.35;
    n.connect(ng).connect(lp);
    n.start(t);
    n.stop(t + len);
    panAcross(k, t, len);
    return len;
  },
  horn: (k) => {
    const t = k.now;
    for (const [at, len] of [[0, 0.22], [0.32, 0.4]] as const) {
      for (const f of [392, 494]) tone(k, t + at, 'sawtooth', f, f, len, 0.12, 1800);
    }
    return 0.8;
  },
  hooves: (k) => {
    const t = k.now;
    const len = 4;
    const g = k.ctx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.linearRampToValueAtTime(1, t + len * 0.5);
    g.gain.linearRampToValueAtTime(0.1, t + len);
    g.connect(k.master);
    // Clip-clop, clip-clop: two beats close together, then a gap.
    for (let s = 0; s < len - 0.2; s += 0.5) {
      for (const [d, f] of [[0, 900], [0.12, 1300]] as const) burst(k, t + s + d, 'white', 'bandpass', f, 0.03, 0.9, g, 6);
    }
    panAcross(k, t, len);
    return len;
  },
  bell: (k) => {
    const t = k.now;
    for (const [ratio, v, decay] of [[1, 0.35, 2.6], [2, 0.2, 1.8], [2.76, 0.14, 1.2], [5.4, 0.06, 0.7]] as const) {
      tone(k, t, 'sine', 660 * ratio, 660 * ratio, decay, v, undefined, true);
    }
    return 2.7;
  },
  chime: (k) => {
    const t = k.now;
    [1047, 1319, 1568, 2093, 2637].forEach((f, i) => tone(k, t + i * 0.09, 'triangle', f, f, 1.1, 0.16, undefined, true));
    return 1.6;
  },
  knock: (k) => {
    const t = k.now;
    for (const at of [0, 0.2, 0.4]) {
      tone(k, t + at, 'sine', 180, 90, 0.12, 0.6, undefined, true);
      burst(k, t + at, 'white', 'lowpass', 1400, 0.03, 0.5);
    }
    return 0.6;
  },
  door: (k) => {
    const t = k.now;
    // A slow creak, then the door shuts.
    const o = k.source(k.ctx.createOscillator());
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(150, t);
    for (let i = 1; i <= 12; i++) o.frequency.linearRampToValueAtTime(160 + Math.random() * 110, t + i * 0.075);
    const bp = k.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 6;
    const g = k.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.1);
    g.gain.setValueAtTime(0.5, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    o.connect(bp).connect(g).connect(k.master);
    o.start(t);
    o.stop(t + 1);
    tone(k, t + 1, 'sine', 110, 55, 0.35, 0.8, undefined, true);
    burst(k, t + 1, 'brown', 'lowpass', 600, 0.25, 0.9);
    return 1.4;
  },
  footsteps: (k) => {
    const t = k.now;
    for (let i = 0; i < 6; i++) burst(k, t + i * 0.42, 'pink', 'bandpass', i % 2 ? 700 : 850, 0.07, 0.55 + (i % 2) * 0.15, undefined, 1.2);
    return 2.6;
  },
  splash: (k) => {
    const t = k.now;
    const src = k.source(noiseSource(k, 'white'));
    const bp = k.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(3500, t);
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.6);
    const g = k.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    src.connect(bp).connect(g).connect(k.master);
    src.start(t, Math.random());
    src.stop(t + 0.85);
    for (let i = 0; i < 6; i++) {
      const at = t + 0.15 + Math.random() * 0.6;
      const f = 900 + Math.random() * 1600;
      tone(k, at, 'sine', f, f * 1.8, 0.05, 0.12);
    }
    return 0.9;
  },
  whoosh: (k) => {
    const t = k.now;
    const src = k.source(noiseSource(k, 'pink'));
    const bp = k.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.3);
    bp.frequency.exponentialRampToValueAtTime(400, t + 0.65);
    const g = k.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.2, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    src.connect(bp).connect(g).connect(k.master);
    src.start(t, Math.random());
    src.stop(t + 0.75);
    return 0.75;
  },
  pop: (k) => {
    tone(k, k.now, 'sine', 700, 140, 0.09, 0.6, undefined, true);
    burst(k, k.now, 'white', 'highpass', 2500, 0.01, 0.3);
    return 0.15;
  },
  tweet: (k) => {
    phrase(k, k.now, 3, 3100);
    return 0.6;
  },
};

// ------------------------------------------------------------------ parts

type Colour = 'white' | 'brown' | 'pink';

function noiseSource(k: Kit, colour: Colour): AudioBufferSourceNode {
  const src = k.ctx.createBufferSource();
  src.buffer = k.noise[colour];
  src.loop = true;
  return src;
}

/**
 * A bed of noise that goes on: filtered, at a level, swelling now and then (`swell` Hz, by `depth`).
 * Returns its gain, with its first filter attached, for the caller to move.
 */
function bed(k: Kit, colour: Colour, filters: Array<[BiquadFilterType, number, number]>, level: number, swell: number, depth: number): GainNode {
  const src = k.source(noiseSource(k, colour));
  let node: AudioNode = src;
  let first: BiquadFilterNode | undefined;
  for (const [type, f, q] of filters) {
    const filter = k.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = f;
    filter.Q.value = q;
    node.connect(filter);
    node = filter;
    first ??= filter;
  }
  const g = k.ctx.createGain();
  g.gain.value = level;
  node.connect(g).connect(k.master);
  if (depth > 0) lfo(k, g.gain, swell, level * depth);
  src.start(k.now, Math.random() * 2);
  return Object.assign(g, { filter: first });
}

/** Move a value up and down slowly around where it is. */
function lfo(k: Kit, param: AudioParam, hz: number, by: number) {
  const o = k.source(k.ctx.createOscillator());
  o.frequency.value = hz * (0.8 + Math.random() * 0.4);
  const g = k.ctx.createGain();
  g.gain.value = by;
  o.connect(g).connect(param);
  o.start(k.now);
}

/** Drops pattering now and then. */
function drips(k: Kit, ms: number, chance: number, level: number) {
  k.every(ms, (t) => {
    if (Math.random() < chance) {
      const f = 1800 + Math.random() * 3500;
      tone(k, t + Math.random() * (ms / 1000), 'sine', f, f * 0.6, 0.025, level);
    }
  });
}

/** A short burst of filtered noise: a crackle, a hoof, a footstep. */
function burst(k: Kit, at: number, colour: Colour, type: BiquadFilterType, f: number, length: number, level: number, into: AudioNode = k.master, q = 1) {
  const src = k.source(noiseSource(k, colour));
  const filter = k.ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = f;
  filter.Q.value = q;
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(level, at + Math.min(0.01, length / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  src.connect(filter).connect(g).connect(into);
  src.start(at, Math.random() * 2);
  src.stop(at + length + 0.05);
}

/** A tone gliding from one pitch to another, with a quick attack (and an exponential decay with `ring`). */
function tone(k: Kit, at: number, type: OscillatorType, from: number, to: number, length: number, level: number, lowpass?: number, ring = false) {
  const o = k.source(k.ctx.createOscillator());
  o.type = type;
  o.frequency.setValueAtTime(from, at);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + length);
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(level, at + 0.005);
  if (ring) g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  else {
    g.gain.setValueAtTime(level, at + Math.max(0.006, length - 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  }
  let node: AudioNode = o;
  if (lowpass) {
    const f = k.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    node.connect(f);
    node = f;
  }
  node.connect(g).connect(k.master);
  o.start(at);
  o.stop(at + length + 0.05);
}

/** A bird's phrase: quick rising chirps. */
function phrase(k: Kit, at: number, notes: number, pitch: number) {
  for (let i = 0; i < notes; i++) {
    const f = pitch * (0.9 + Math.random() * 0.3);
    tone(k, at + i * 0.13, 'sine', f, f * (1.25 + Math.random() * 0.3), 0.07, 0.14);
  }
}

/** Something going by: from the left to the right. */
function panAcross(k: Kit, t: number, len: number) {
  if (!k.pan) return;
  k.pan.setValueAtTime(-0.9, t);
  k.pan.linearRampToValueAtTime(0.9, t + len);
}

const synths = new WeakMap<object, Synth>();

/**
 * The game's synth: Phaser's own audio context and master volume, so the game's sounds are as loud
 * as its others. Silent when Phaser is not using Web Audio.
 */
export function synthFor(scene: { sound: unknown }): Synth {
  const manager = scene.sound as { context?: AudioContext; destination?: AudioNode } | null;
  const key = (manager ?? scene) as object;
  let synth = synths.get(key);
  if (!synth) {
    synth = new Synth(() => {
      const ctx = manager?.context;
      if (!ctx || typeof ctx.createGain !== 'function') return null;
      return { ctx, destination: manager?.destination ?? ctx.destination };
    });
    synths.set(key, synth);
  }
  return synth;
}
