import { BUILT_IN_SOUND_NAMES, BUILT_IN_SOUNDS, isBuiltInSound, type BuiltInSound } from '@qbl/shared';
import { Synth, type Voice } from '../../client/src/audio/synth';
import type { Row } from './api';
import { mediaLabel, mediaUrl, params } from './describe';
import { h, toast } from './dom';
import { emojiIcon } from './icons';
import { openPanel } from './panel';
import type { Store } from './store';

/**
 * Choosing a sound for a field: a button that shows the one chosen, and a pop-up listing the
 * scenario's sounds, grouped by what they are for (music, sound effects, recorded voices), each with
 * a ▶ to hear it first. Only one plays at a time. Where a field can also take one of the game's own
 * sounds (an Audio action), those are a group of their own.
 */

export type SoundGroup = 'music' | 'effect' | 'voice' | 'other' | 'game';
export type SoundTab = 'all' | SoundGroup;

export const SOUND_TABS: ReadonlyArray<readonly [SoundTab, string, string]> = [
  ['all', 'All', '🗂️'], ['music', 'Music', '🎵'], ['effect', 'Sound effects', '🔔'], ['voice', 'Voices', '🗣️'], ['other', 'Not used yet', '📁'], ['game', 'Game’s own sounds', '✨'],
];
const FILED = new Set<string>(['music', 'effect', 'voice']);
export const soundTabLabel = (tab: SoundTab) => SOUND_TABS.find(([key]) => key === tab)!;

/** What was chosen: a file, one of the game's own sounds, or nothing. */
export type SoundPick = { media: number } | { sound: BuiltInSound } | null;

export interface SoundChoice {
  /** The file chosen now. */
  selected?: number | null;
  /** The game's own sound chosen now (an Audio action's `sound`). */
  sound?: string | null;
  /** Offer the game's own sounds too. */
  builtIn?: boolean;
  /** The group the pop-up opens on: what the field is for. Default: all of them. */
  group?: SoundTab;
  /** The pop-up's heading. */
  title?: string;
  /** What choosing nothing means ("The browser’s voice"). Without it there is no way to choose nothing. */
  none?: string;
}

/**
 * How each sound is used, to group it: as music (the scenario's, a scene's, an Audio action kept
 * playing as background music), as a sound effect (any other Audio action), or as a recording of a
 * line (a narration, a line of dialogue or of a conversation). Searched through every action's
 * params, so a sound in a button's action or in a choice counts too.
 */
function uses(store: Store): Map<number, Set<SoundGroup>> {
  const found = new Map<number, Set<SoundGroup>>();
  const add = (id: unknown, group: SoundGroup) => {
    const n = Number(id);
    if (!id || !Number.isFinite(n)) return;
    if (!found.has(n)) found.set(n, new Set());
    found.get(n)!.add(group);
  };
  add(store.settings.music_media_id, 'music');
  for (const s of store.rows('scenes')) add(params(s).music_media_id, 'music');
  const walk = (v: unknown, depth = 0): void => {
    if (depth > 8 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const o = v as Record<string, unknown>;
    if (o.type === 'audio' && o.media_id != null) add(o.media_id, o.persist ? 'music' : 'effect');
    if (o.narration_media_id != null) add(o.narration_media_id, 'voice');
    for (const x of Object.values(o)) if (x && typeof x === 'object') walk(x, depth + 1);
  };
  for (const a of store.rows('actions')) {
    const p = params(a);
    if (a.type === 'audio' && a.media_id != null) add(a.media_id, p.persist ? 'music' : 'effect');
    walk(p);
  }
  return found;
}

/**
 * The group a sound is listed under: the one it was filed under by hand (an upload from a group's
 * tab), else a recording made from a line, else how it is used (music first), else "Not used yet".
 */
export function soundGroup(row: Row, used: Map<number, Set<SoundGroup>>): Exclude<SoundGroup, 'game'> {
  const p = params(row);
  const filed = p.sound_group as string | undefined;
  if (filed && FILED.has(filed)) return filed as 'music' | 'effect' | 'voice';
  if (p.speech) return 'voice';
  const how = used.get(row.id);
  if (how?.has('music')) return 'music';
  if (how?.has('voice')) return 'voice';
  if (how?.has('effect')) return 'effect';
  return 'other';
}

/** Lengths of the files heard so far (or whose details were loaded), by address, in seconds. */
const lengths = new Map<string, number>();
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function lengthOf(row: Row, url: string | null): number | null {
  const ms = Number((params(row).speech as { duration?: number } | undefined)?.duration);
  if (ms > 0) return ms / 1000;
  return url ? lengths.get(url) ?? null : null;
}

/** What a recording says, for a voice. */
const saying = (row: Row): string => {
  const speech = params(row).speech as { text?: string; line?: string } | undefined;
  return String(speech?.line ?? speech?.text ?? '').trim();
};

/**
 * One sound playing at a time, for the pop-up: files through one <audio>, the game's own sounds
 * through the game's synthesizer. Playing another stops the one before; `changed` redraws the
 * rows' buttons and progress.
 */
class Player {
  private audio = new Audio();
  private ctx: AudioContext | null = null;
  private synth = new Synth(() => {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    this.ctx ??= new Ctx();
    void this.ctx.resume();
    return { ctx: this.ctx, destination: this.ctx.destination };
  });
  private voice: Voice | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** What is playing: a file's address, or `game:<name>`. */
  playing: string | null = null;

  constructor(private changed: () => void, private progress: (key: string, fraction: number) => void) {
    this.audio.preload = 'none';
    this.audio.addEventListener('ended', () => this.stop());
    this.audio.addEventListener('timeupdate', () => {
      if (this.playing && this.audio.duration > 0) this.progress(this.playing, this.audio.currentTime / this.audio.duration);
    });
    this.audio.addEventListener('loadedmetadata', () => {
      if (this.playing && Number.isFinite(this.audio.duration)) lengths.set(this.playing, this.audio.duration);
    });
    this.audio.addEventListener('error', () => {
      if (!this.playing || this.playing.startsWith('game:')) return;
      toast('That sound could not be played.', 'error');
      this.stop();
    });
  }

  toggle(key: string): void {
    const again = this.playing === key;
    this.stop();
    if (again) return;
    this.playing = key;
    if (key.startsWith('game:')) {
      const name = key.slice(5) as BuiltInSound;
      this.voice = this.synth.play(name, { volume: 0.8 });
      // A sound that goes on by itself is heard for a few seconds.
      const voice = this.voice;
      void voice.done.then(() => this.voice === voice && this.stop());
      if (BUILT_IN_SOUNDS[name].loop) this.timer = setTimeout(() => this.stop(), 5000);
    } else {
      this.audio.src = key;
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {
        if (this.playing === key) this.stop();
      });
    }
    this.changed();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.voice) {
      const v = this.voice;
      this.voice = null;
      v.stop(250);
    }
    if (!this.audio.paused) this.audio.pause();
    const was = this.playing;
    this.playing = null;
    if (was) {
      this.progress(was, 0);
      this.changed();
    }
  }

  close(): void {
    this.stop();
    this.audio.removeAttribute('src');
    void this.ctx?.close();
    this.ctx = null;
  }
}

/**
 * Choose a sound in a pop-up. Settles with what was chosen, null when "nothing" was chosen, or
 * undefined when the pop-up was closed without a choice.
 */
export function chooseSound(store: Store, o: SoundChoice): Promise<SoundPick | undefined> {
  const opening: SoundTab = o.group ?? 'all';
  const files = () => store.rows('media').filter((m) => m.type === 'audio');
  const first = uses(store);
  const has = (t: SoundTab) => t === 'all' || (t === 'game' ? o.builtIn === true : files().some((m) => soundGroup(m, first) === t));
  // A field whose group has nothing yet opens on everything rather than on an empty page.
  let tab: SoundTab = has(opening) ? opening : 'all';
  let query = '';
  const uploading = new Set<string>();

  return new Promise((resolve) => {
    let done = false;
    const finish = (pick: SoundPick | undefined) => {
      if (done) return;
      done = true;
      player.close();
      resolve(pick);
      panel.close();
    };

    const file = h('input', { type: 'file', multiple: true, hidden: true, accept: 'audio/*' });
    const search = h('input', { type: 'search', class: 'mp-search', placeholder: 'Search by name or words', 'aria-label': 'Search by name or words' });
    const tabs = h('div', { class: 'mp-tabs', role: 'tablist', 'aria-label': 'Kinds of sound' });
    const list = h('div', { class: 'sp-list', role: 'listbox', 'aria-label': 'Choose a sound' });
    const note = h('p', { class: 'mp-note muted' });

    const progress = (key: string, fraction: number) => {
      for (const bar of list.querySelectorAll<HTMLElement>('.sp-progress')) {
        if (bar.dataset.key === key) bar.style.width = `${Math.round(fraction * 1000) / 10}%`;
      }
    };
    const player = new Player(() => {
      for (const b of list.querySelectorAll<HTMLButtonElement>('button.sp-play[data-key]')) {
        const on = b.dataset.key === player.playing;
        b.classList.toggle('playing', on);
        b.textContent = on ? '■' : '▶';
        b.setAttribute('aria-label', `${on ? 'Stop' : 'Play'} ${b.dataset.label ?? ''}`);
        b.closest('.sp-row')?.classList.toggle('playing', on);
      }
    }, progress);

    const playButton = (key: string, name: string) => h('button', {
      type: 'button', class: `sp-play${player.playing === key ? ' playing' : ''}`, 'data-key': key, 'data-label': name, 'aria-label': `${player.playing === key ? 'Stop' : 'Play'} ${name}`, title: 'Listen',
      onclick: (e: Event) => { e.stopPropagation(); player.toggle(key); },
    }, player.playing === key ? '■' : '▶');

    const fileRow = (row: Row, group: SoundGroup, showGroup: boolean) => {
      const url = mediaUrl(store, row);
      const key = url ?? `missing:${row.id}`;
      const current = row.id === o.selected && !o.sound;
      const length = lengthOf(row, url);
      const words = group === 'voice' ? saying(row) : '';
      const [, groupLabel, groupIcon] = soundTabLabel(group);
      const lengthNode = h('span', { class: 'sp-length', 'data-key': key }, length != null ? clock(length) : '');
      // The length, where it is not known yet, from the file's details.
      if (length == null && url) {
        const probe = new Audio();
        probe.preload = 'metadata';
        probe.addEventListener('loadedmetadata', () => {
          if (!Number.isFinite(probe.duration)) return;
          lengths.set(url, probe.duration);
          // Every row of this file, in case the list was drawn again meanwhile.
          for (const n of list.querySelectorAll<HTMLElement>('.sp-length')) if (n.dataset.key === url) n.textContent = clock(probe.duration);
          probe.removeAttribute('src');
        }, { once: true });
        probe.src = url;
      }
      return h('div', {
        class: `sp-row${current ? ' current' : ''}${player.playing === key ? ' playing' : ''}`, role: 'option', tabindex: '0', 'aria-selected': String(current),
        'data-sound-pick': row.id, 'data-name': mediaLabel(row), title: `Choose ${mediaLabel(row)}`,
        onclick: () => finish({ media: row.id }),
        onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish({ media: row.id }); } },
      },
      url ? playButton(key, mediaLabel(row)) : h('span', { class: 'sp-play missing', title: 'This file is missing' }, '?'),
      h('span', { class: 'sp-text' },
        h('span', { class: 'sp-name' }, mediaLabel(row)),
        words ? h('span', { class: 'sp-says' }, `“${words.length > 110 ? `${words.slice(0, 108)}…` : words}”`) : null,
        h('span', { class: 'sp-bar' }, h('span', { class: 'sp-progress', 'data-key': key }))),
      showGroup ? h('span', { class: 'sp-group' }, emojiIcon(groupIcon), ` ${groupLabel}`) : null,
      lengthNode,
      current ? h('span', { class: 'sp-current' }, '✓ Chosen') : h('span', { class: 'sp-choose' }, 'Choose'));
    };

    const gameRow = (name: BuiltInSound) => {
      const s = BUILT_IN_SOUNDS[name];
      const key = `game:${name}`;
      const current = o.sound === name;
      return h('div', {
        class: `sp-row game${current ? ' current' : ''}${player.playing === key ? ' playing' : ''}`, role: 'option', tabindex: '0', 'aria-selected': String(current),
        'data-sound-pick': key, 'data-name': s.label, title: `Choose ${s.label.toLowerCase()}`,
        onclick: () => finish({ sound: name }),
        onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish({ sound: name }); } },
      },
      playButton(key, s.label),
      h('span', { class: 'sp-text' },
        h('span', { class: 'sp-name' }, emojiIcon(s.icon), ` ${s.label}`),
        h('span', { class: 'sp-says' }, s.loop ? 'Goes on by itself: tick Loop to keep it playing' : 'Over in a moment'),
        h('span', { class: 'sp-bar' }, h('span', { class: 'sp-progress', 'data-key': key }))),
      h('span', { class: 'sp-length' }, s.loop ? '∞' : ''),
      current ? h('span', { class: 'sp-current' }, '✓ Chosen') : h('span', { class: 'sp-choose' }, 'Choose'));
    };

    const draw = () => {
      const rows = files();
      const used = uses(store);
      const groups = new Map(rows.map((m) => [m.id, soundGroup(m, used)]));
      const q = query.trim().toLowerCase();
      const matches = (m: Row) => !q || mediaLabel(m).toLowerCase().includes(q) || saying(m).toLowerCase().includes(q);
      const games = o.builtIn ? BUILT_IN_SOUND_NAMES.filter((n) => !q || BUILT_IN_SOUNDS[n].label.toLowerCase().includes(q) || n.includes(q)) : [];
      const count = (t: SoundTab) => (t === 'game' ? (o.builtIn ? BUILT_IN_SOUND_NAMES.length : 0) : t === 'all' ? rows.length + (o.builtIn ? BUILT_IN_SOUND_NAMES.length : 0) : rows.filter((m) => groups.get(m.id) === t).length);

      const shown = SOUND_TABS.filter(([key]) => (key === 'game' ? o.builtIn : key === 'all' || key === opening || key === tab || count(key) > 0));
      tabs.replaceChildren(...shown.map(([key, label, icon]) => h('button', {
        type: 'button', role: 'tab', class: `mp-tab${key === tab ? ' active' : ''}${key === opening && key !== 'all' ? ' wanted' : ''}`,
        'aria-selected': String(key === tab), 'data-sound-tab': key,
        title: key === opening && key !== 'all' ? 'The kind of sound this is for' : undefined,
        onclick: () => { tab = key; draw(); },
      }, emojiIcon(icon), ` ${label} `, h('span', { class: 'mp-count' }, String(count(key))))));

      // On All, the sounds in groups, each under its heading; on a group's tab, just that group.
      const sections: HTMLElement[] = [];
      let listed = 0;
      for (const [key, label, icon] of SOUND_TABS) {
        if (key === 'all' || (tab !== 'all' && key !== tab)) continue;
        const entries = key === 'game'
          ? games.map(gameRow)
          : rows.filter((m) => groups.get(m.id) === key && matches(m)).reverse().map((m) => fileRow(m, key, false));
        listed += entries.length;
        if (!entries.length) continue;
        sections.push(h('section', { class: 'sp-section', 'data-sound-group': key },
          tab === 'all' ? h('h3', { class: 'sp-heading' }, emojiIcon(icon), ` ${label} `, h('span', { class: 'mp-count' }, String(entries.length))) : null,
          ...entries));
      }
      const pending = [...uploading].map((name) => h('div', { class: 'sp-row uploading' }, h('span', { class: 'sp-play' }, h('span', { class: 'rt-spinner' })), h('span', { class: 'sp-text' }, h('span', { class: 'sp-name' }, name))));
      const nothing = o.none != null && !q
        ? h('div', {
          class: `sp-row sp-none${o.selected == null && !o.sound ? ' current' : ''}`, role: 'option', tabindex: '0', 'data-sound-pick': '',
          onclick: () => finish(null), onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(null); } },
        }, h('span', { class: 'sp-play none' }, '∅'), h('span', { class: 'sp-text' }, h('span', { class: 'sp-name' }, o.none)), o.selected == null && !o.sound ? h('span', { class: 'sp-current' }, '✓ Chosen') : h('span', { class: 'sp-choose' }, 'Choose'))
        : null;
      const upload = tab === 'game' ? null : h('button', { type: 'button', class: 'sp-row sp-upload', onclick: () => file.click() },
        h('span', { class: 'sp-play none' }, '⬆'),
        h('span', { class: 'sp-text' },
          h('span', { class: 'sp-name' }, 'Upload a sound…'),
          h('span', { class: 'sp-says' }, FILED.has(tab) ? `Filed under ${soundTabLabel(tab)[1]}. Or drop files here.` : 'MP3, WAV, OGG or M4A. Or drop files here.')));
      list.replaceChildren(...([upload, nothing].filter(Boolean) as HTMLElement[]), ...pending, ...sections);

      if (!listed && !pending.length) {
        const others = count('all');
        note.replaceChildren(q ? `Nothing here is named like “${query.trim()}”.` : tab === 'all' ? 'No sounds yet. Upload one, or drop files here.' : `No ${soundTabLabel(tab)[1].toLowerCase()} yet. Upload one, or drop files here.`,
          ...(tab !== 'all' && others ? [h('button', { type: 'button', class: 'link', onclick: () => { tab = 'all'; draw(); } }, ` Show all ${others}`)] : []));
      } else if (tab === 'all' && opening !== 'all' && !has(opening)) {
        note.replaceChildren(`No ${soundTabLabel(opening)[1].toLowerCase()} yet, so every sound is shown.`);
      } else note.replaceChildren();
      note.hidden = !note.childNodes.length;
      list.querySelector<HTMLElement>('.sp-row.current')?.scrollIntoView({ block: 'nearest' });
    };

    const take = async (picked: File[]) => {
      const wanted = picked.filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a)$/i.test(f.name));
      if (wanted.length < picked.length) toast('Only sounds can go here.', 'error');
      const added: Row[] = [];
      await Promise.all(wanted.map(async (f) => {
        uploading.add(f.name);
        draw();
        try {
          const row = await store.api.upload(store.scenarioId, f);
          store.bundle.media.push(row);
          if (row.type !== 'audio') {
            toast(`${f.name} is ${row.type}, not a sound. It was added to the media library.`, 'error');
            return;
          }
          // Filed under the group it was uploaded from.
          if (FILED.has(tab)) {
            row.params = { ...params(row), sound_group: tab };
            void store.patch('media', row.id, { params: row.params });
          }
          added.push(row);
        } catch (err) {
          toast(`${f.name}: ${err instanceof Error ? err.message : 'upload failed'}`, 'error');
        } finally {
          uploading.delete(f.name);
        }
      }));
      store.emit(false);
      // One file uploaded is the one chosen; several stay in the list to choose from.
      if (wanted.length === 1 && added.length === 1) return finish({ media: added[0]!.id });
      draw();
    };
    file.addEventListener('change', () => {
      void take([...(file.files ?? [])]);
      file.value = '';
    });
    search.addEventListener('input', () => { query = search.value; draw(); });

    const body = h('div', { class: 'mp sp' }, h('div', { class: 'mp-head' }, tabs, search), note, list, file);
    body.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      body.classList.add('dropping');
    });
    body.addEventListener('dragleave', (e) => {
      if (!body.contains(e.relatedTarget as Node)) body.classList.remove('dropping');
    });
    body.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      body.classList.remove('dropping');
      void take([...e.dataTransfer.files]);
    });

    const panel = openPanel({
      key: 'sound-choose', kind: 'sound-choose', store, quiet: true, tone: '#c98a2e', size: 'medium',
      title: () => o.title ?? 'Choose a sound',
      body: () => body,
      opened: () => search.focus({ preventScroll: true }),
    });
    panel.dialog.addEventListener('close', () => finish(undefined));
    draw();
    requestAnimationFrame(() => search.focus({ preventScroll: true }));
  });
}

/** What a field of each group asks for, in its button. */
const WANTED: Partial<Record<SoundTab, string>> = { music: 'music', effect: 'sound', voice: 'recording' };

/**
 * The control a field shows: the chosen sound's name with a ▶ to hear it, which opens the
 * pop-up, and a × to choose nothing where nothing is allowed.
 */
export function soundChoiceButton(store: Store, o: SoundChoice & { label: string; onChoose(pick: SoundPick): void }): HTMLElement {
  const chosen = o.sound ? null : store.byId('media', o.selected ?? null);
  const game = isBuiltInSound(o.sound) ? BUILT_IN_SOUNDS[o.sound] : null;
  const wanted = WANTED[o.group ?? 'all'] ?? 'sound';
  const url = chosen ? mediaUrl(store, chosen) : null;
  const length = chosen ? lengthOf(chosen, url) : null;
  let preview: HTMLAudioElement | null = null;
  let voice: Voice | null = null;
  let ctx: AudioContext | null = null;

  const listen = h('button', {
    type: 'button', class: 'sp-play sound-choice-play', title: 'Listen', 'aria-label': `Listen to ${chosen ? mediaLabel(chosen) : game?.label ?? ''}`, hidden: !(url || game),
    onclick: (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const stop = () => {
        preview?.pause();
        voice?.stop(250);
        voice = null;
        listen.textContent = '▶';
        listen.classList.remove('playing');
      };
      if (listen.classList.contains('playing')) return stop();
      listen.textContent = '■';
      listen.classList.add('playing');
      if (url) {
        preview ??= new Audio(url);
        preview.currentTime = 0;
        preview.onended = stop;
        preview.play().catch(stop);
      } else if (game && isBuiltInSound(o.sound)) {
        const name = o.sound;
        const synth = new Synth(() => {
          ctx ??= new AudioContext();
          void ctx.resume();
          return { ctx, destination: ctx.destination };
        });
        voice = synth.play(name, { volume: 0.8 });
        void voice.done.then(stop);
        if (game.loop) setTimeout(stop, 5000);
      }
    },
  }, '▶');

  const open = async () => {
    preview?.pause();
    voice?.stop(100);
    const pick = await chooseSound(store, { ...o, title: o.title ?? `${o.label}: choose ${wanted === 'music' ? 'music' : `a ${wanted}`}` });
    if (pick === undefined) return;
    const same = pick === null ? o.selected == null && !o.sound : 'media' in pick ? pick.media === o.selected && !o.sound : pick.sound === o.sound;
    if (!same) o.onChoose(pick);
  };
  const empty = !chosen && !game;
  const button = h('button', {
    type: 'button', class: `media-choice-open sound-choice-open${empty ? ' empty' : ''}`, 'data-sound-choice': chosen?.id ?? (game ? o.sound : ''),
    'aria-label': `${o.label}: ${chosen ? mediaLabel(chosen) : game ? game.label : o.selected != null ? 'missing file' : o.none ?? 'none chosen'}. Choose…`,
    onclick: (e: Event) => { e.preventDefault(); void open(); },
  },
  h('span', { class: 'sound-choice-icon' }, emojiIcon(game ? game.icon : chosen ? (params(chosen).speech ? '🗣️' : wanted === 'music' ? '🎵' : '🔊') : '🔇')),
  h('span', { class: 'media-choice-text' },
    h('span', { class: 'media-choice-name' }, chosen ? mediaLabel(chosen) : game ? game.label : o.selected != null ? '(missing file)' : o.none ?? 'No sound yet'),
    h('span', { class: 'media-choice-sub' },
      game ? h('span', null, 'The game’s own sound') : null,
      length != null ? h('span', null, clock(length)) : null,
      h('span', { class: 'media-choice-cta' }, empty ? `Choose ${wanted === 'music' ? 'music' : `a ${wanted}`}…` : 'Change…'))));
  const clear = o.none != null && (o.selected != null || o.sound)
    ? h('button', { type: 'button', class: 'icon media-choice-clear', title: `Clear: ${o.none}`, 'aria-label': `Clear ${o.label}`, onclick: (e: Event) => { e.preventDefault(); o.onChoose(null); } }, '×')
    : null;
  return h('div', { class: 'media-choice sound-choice' }, listen, button, clear);
}
