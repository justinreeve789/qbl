import { audioCrop, cropClock, makeCrop, MIN_CROP_SECONDS, type AudioCrop } from '@qbl/shared';
import type { Row } from '../api';
import { mediaUrl, params } from '../describe';
import { h } from '../dom';
import type { FormContext } from '../fields';

/**
 * Cropping a sound, in its media pop-up: the sound drawn as a wave with a handle at each end of
 * the part kept, Start and End boxes for exact times, ▶ to hear only that part, and a button to
 * keep the whole sound again. The file is not changed: the crop is kept on the media
 * (`params.crop`, see packages/shared/src/audioCrop.ts) and the game plays only that part.
 */

/** A sound read for drawing: the loudest sample in each of `peaks.length` slices, and its length. */
interface Wave {
  peaks: Float32Array;
  duration: number;
}

const SLICES = 800;
/** Read once per address: opening the pop-up again, or a redraw, draws at once. */
const waves = new Map<string, Promise<Wave | null>>();

function readWave(url: string): Promise<Wave | null> {
  let wave = waves.get(url);
  if (!wave) {
    wave = (async () => {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      const res = await fetch(url);
      if (!res.ok) return null;
      const bytes = await res.arrayBuffer();
      const ctx = new Ctx();
      try {
        const buffer = await ctx.decodeAudioData(bytes);
        const peaks = new Float32Array(SLICES);
        const per = buffer.length / SLICES;
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          const data = buffer.getChannelData(c);
          for (let i = 0; i < SLICES; i++) {
            let top = peaks[i]!;
            const from = Math.floor(i * per);
            const to = Math.min(data.length, Math.floor((i + 1) * per));
            // Every sample of a long file is too many: a few hundred from each slice show its shape.
            const step = Math.max(1, Math.floor((to - from) / 400));
            for (let j = from; j < to; j += step) {
              const v = Math.abs(data[j]!);
              if (v > top) top = v;
            }
            peaks[i] = top;
          }
        }
        let loudest = 0;
        for (const p of peaks) loudest = Math.max(loudest, p);
        if (loudest > 0) for (let i = 0; i < SLICES; i++) peaks[i] = peaks[i]! / loudest;
        return { peaks, duration: buffer.duration };
      } finally {
        void ctx.close();
      }
    })().catch(() => null);
    waves.set(url, wave);
  }
  return wave;
}

export function audioCropper(ctx: FormContext, media: Row): HTMLElement {
  const { store } = ctx;
  const id = media.id;
  const url = mediaUrl(store, media);
  const saved = audioCrop(media);
  /** The file's length in seconds, once known. */
  let duration = 0;
  let start = saved?.start ?? 0;
  /** Where the part ends; null until the length is known when there is no end. */
  let end: number | null = saved?.end ?? null;
  let wave: Wave | null = null;

  const section = h('section', { class: 'panel-section audio-crop', 'data-section': 'crop', style: '--tone: var(--tone-audio)' });
  if (!url) {
    section.append(h('h3', { class: 'section-head' }, '✂️ Crop'), h('p', { class: 'muted' }, 'The sound has no address, so there is nothing to crop.'));
    return section;
  }

  const audio = h('audio', { preload: 'auto', src: url });
  const canvas = h('canvas', { class: 'crop-wave', 'aria-hidden': 'true' });
  const shadeBefore = h('div', { class: 'crop-shade before' });
  const shadeAfter = h('div', { class: 'crop-shade after' });
  const kept = h('div', { class: 'crop-kept' });
  const playhead = h('div', { class: 'crop-playhead', hidden: true });
  const handle = (which: 'start' | 'end') => h('button', {
    type: 'button', class: `crop-handle ${which}`, role: 'slider', 'data-handle': which,
    'aria-label': which === 'start' ? 'Start of the part kept' : 'End of the part kept',
    title: 'Drag, or use the arrow keys (Shift for whole seconds)',
  });
  const startHandle = handle('start');
  const endHandle = handle('end');
  const status = h('p', { class: 'crop-status muted' }, 'Reading the sound…');
  const track = h('div', { class: 'crop-track loading' }, canvas, shadeBefore, shadeAfter, kept, playhead, startHandle, endHandle);

  const box = (which: 'start' | 'end') => h('input', {
    type: 'number', min: '0', step: '0.1', inputmode: 'decimal', 'data-crop': which, disabled: true,
    'aria-label': which === 'start' ? 'Start (seconds)' : 'End (seconds)',
  });
  const startBox = box('start');
  const endBox = box('end');
  const play = h('button', { type: 'button', class: 'crop-play', disabled: true, onclick: () => (playing ? stop() : listen()) }, '▶ Play the part kept');
  const whole = h('button', {
    type: 'button', class: 'crop-reset', disabled: true, title: 'Take the crop off: the whole sound plays',
    onclick: () => {
      start = 0;
      end = duration;
      commit();
      show();
    },
  }, 'Keep the whole sound');

  section.append(
    h('h3', { class: 'section-head' }, '✂️ Crop'),
    h('p', { class: 'muted crop-about' }, 'Drag the handles to keep only part of the sound. The game plays just that part (and loops just that part); the file itself is not changed.'),
    track,
    h('div', { class: 'crop-controls' },
      h('label', { class: 'crop-time' }, h('span', null, 'Start'), startBox, h('small', { class: 'muted' }, 's')),
      h('label', { class: 'crop-time' }, h('span', null, 'End'), endBox, h('small', { class: 'muted' }, 's')),
      play, whole),
    status);

  const endAt = () => end ?? duration;
  const fraction = (t: number) => (duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0);

  /** Draw the handles, the shading, the boxes and the line saying what plays. */
  function show() {
    if (!duration) return;
    const a = fraction(start) * 100;
    const b = fraction(endAt()) * 100;
    startHandle.style.left = `${a}%`;
    endHandle.style.left = `${b}%`;
    shadeBefore.style.width = `${a}%`;
    shadeAfter.style.left = `${b}%`;
    kept.style.left = `${a}%`;
    kept.style.width = `${b - a}%`;
    for (const [node, value] of [[startHandle, start], [endHandle, endAt()]] as const) {
      node.setAttribute('aria-valuemin', '0');
      node.setAttribute('aria-valuemax', duration.toFixed(2));
      node.setAttribute('aria-valuenow', value.toFixed(2));
      node.setAttribute('aria-valuetext', cropClock(value));
    }
    if (document.activeElement !== startBox) startBox.value = start.toFixed(1);
    if (document.activeElement !== endBox) endBox.value = endAt().toFixed(1);
    startBox.max = endBox.max = duration.toFixed(2);
    const cropped = makeCrop(start, endAt(), duration) !== null;
    whole.disabled = !cropped;
    track.classList.toggle('cropped', cropped);
    status.textContent = cropped
      ? `Plays ${cropClock(start)} to ${cropClock(endAt())}: ${cropClock(endAt() - start)} of the sound’s ${cropClock(duration)}.`
      : `Plays the whole sound, ${cropClock(duration)}.`;
  }

  function drawWave() {
    const width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
    const height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, width, height);
    g.fillStyle = getComputedStyle(canvas).getPropertyValue('--tone-audio').trim() || '#b18cff';
    const mid = height / 2;
    if (!wave) {
      g.fillRect(0, mid - devicePixelRatio, width, 2 * devicePixelRatio);
      return;
    }
    const bar = Math.max(1, Math.floor(devicePixelRatio));
    for (let x = 0; x < width; x += bar + Math.max(1, Math.floor(devicePixelRatio / 2))) {
      const i = Math.min(SLICES - 1, Math.floor((x / width) * SLICES));
      const half = Math.max(devicePixelRatio, wave.peaks[i]! * (mid - 2));
      g.fillRect(x, mid - half, bar, half * 2);
    }
  }

  /** Keep the crop on the media (or take it off), unless it is what is kept already. */
  function commit() {
    const row = store.byId('media', id);
    if (!row || !duration) return;
    const crop = makeCrop(start, endAt(), duration);
    const before = (params(row).crop as AudioCrop | undefined) ?? null;
    if (JSON.stringify(before) === JSON.stringify(crop)) return;
    const next: Record<string, unknown> = { ...params(row) };
    if (crop) next.crop = crop;
    else delete next.crop;
    void store.patch('media', id, { params: next });
  }

  /** Put one end of the part kept at `t`, keeping the two ends apart. */
  function move(which: 'start' | 'end', t: number) {
    if (which === 'start') start = Math.min(Math.max(0, t), endAt() - MIN_CROP_SECONDS);
    else end = Math.max(Math.min(duration, t), start + MIN_CROP_SECONDS);
    start = Math.max(0, start);
    show();
  }

  const timeAt = (clientX: number) => {
    const r = track.getBoundingClientRect();
    return r.width > 0 ? ((clientX - r.left) / r.width) * duration : 0;
  };

  // Drag a handle; a press elsewhere on the wave moves the nearer handle there and drags it.
  track.addEventListener('pointerdown', (e) => {
    if (!duration || e.button !== 0) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]');
    const t = timeAt(e.clientX);
    const which: 'start' | 'end' = target ? (target.dataset.handle as 'start' | 'end') : Math.abs(t - start) <= Math.abs(t - endAt()) ? 'start' : 'end';
    if (!target) move(which, t);
    (which === 'start' ? startHandle : endHandle).focus({ preventScroll: true });
    track.setPointerCapture(e.pointerId);
    track.classList.add('dragging');
    const drag = (ev: PointerEvent) => move(which, timeAt(ev.clientX));
    const done = () => {
      track.removeEventListener('pointermove', drag);
      track.classList.remove('dragging');
      commit();
    };
    track.addEventListener('pointermove', drag);
    track.addEventListener('pointerup', done, { once: true });
    track.addEventListener('pointercancel', done, { once: true });
    e.preventDefault();
  });

  for (const [node, which] of [[startHandle, 'start'], [endHandle, 'end']] as const) {
    node.addEventListener('keydown', (e) => {
      if (!duration) return;
      const step = e.shiftKey ? 1 : 0.1;
      const now = which === 'start' ? start : endAt();
      const to = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? now - step
        : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? now + step
        : e.key === 'Home' ? 0 : e.key === 'End' ? duration : null;
      if (to === null) return;
      e.preventDefault();
      move(which, to);
    });
    node.addEventListener('keyup', (e) => e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' ? commit() : undefined);
  }

  for (const [node, which] of [[startBox, 'start'], [endBox, 'end']] as const) {
    node.addEventListener('change', () => {
      const t = Number(node.value);
      if (Number.isFinite(t)) move(which, t);
      commit();
      show();
      node.value = (which === 'start' ? start : endAt()).toFixed(1);
    });
  }

  // ▶: only the part kept, with a line showing where it has got to.
  let playing = false;
  let frame = 0;
  function listen() {
    playing = true;
    play.textContent = '■ Stop';
    play.classList.add('playing');
    playhead.hidden = false;
    playhead.style.left = `${fraction(start) * 100}%`;
    audio.currentTime = start;
    const follow = () => {
      if (!playing) return;
      if (audio.currentTime >= endAt() || audio.ended) return stop();
      playhead.style.left = `${fraction(audio.currentTime) * 100}%`;
      frame = requestAnimationFrame(follow);
    };
    audio.play().then(() => (frame = requestAnimationFrame(follow))).catch(() => stop());
  }
  function stop() {
    playing = false;
    cancelAnimationFrame(frame);
    if (!audio.paused) audio.pause();
    play.textContent = '▶ Play the part kept';
    play.classList.remove('playing');
    playhead.hidden = true;
  }

  // The pop-up closing (or redrawing) takes the section away: stop the sound with it.
  const gone = new MutationObserver(() => {
    if (section.isConnected) return;
    stop();
    gone.disconnect();
    resize.disconnect();
  });
  const resize = new ResizeObserver(() => drawWave());
  gone.observe(document.body, { childList: true, subtree: true });
  resize.observe(canvas);

  /** The length is known: from the decoded sound, or (when it cannot be read, as for a file on another site) from the player. */
  function ready(seconds: number) {
    if (duration || !(seconds > 0) || !Number.isFinite(seconds)) return;
    duration = seconds;
    start = Math.min(start, duration);
    if (end !== null) end = Math.min(end, duration);
    if (endAt() - start < MIN_CROP_SECONDS) {
      start = 0;
      end = duration;
    }
    track.classList.remove('loading');
    startBox.disabled = endBox.disabled = play.disabled = false;
    drawWave();
    show();
  }
  audio.addEventListener('loadedmetadata', () => ready(audio.duration), { once: true });
  audio.addEventListener('error', () => {
    if (!duration) status.textContent = 'This sound could not be loaded, so it cannot be cropped.';
  });
  void readWave(url).then((w) => {
    wave = w;
    if (w) ready(w.duration);
    drawWave();
  });

  return section;
}

/** The crop as a short line for a card: "✂️ 0:01.0–0:04.5", or null when the whole sound plays. */
export function cropSummary(media: Row): string | null {
  const crop = audioCrop(media);
  if (!crop) return null;
  return `✂️ ${cropClock(crop.start)}–${crop.end === null ? 'end' : cropClock(crop.end)}`;
}
