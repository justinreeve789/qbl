import { ApiError, type Row, type VoiceChoice, type VoiceRecording, type VoiceStatus } from '../api';
import { params } from '../describe';
import { h, help, toast } from '../dom';
import type { FormContext } from '../fields';

/**
 * Characters' voices. A character can be given a voice from the server's list (its `tts_voice`);
 * "Record voices" then has the server's text-to-speech service record every line that character
 * says (its dialogue, and its lines in conversations), with the time of each word, so the game
 * plays the recording and lights each word as it is said. Lines are recorded on the server, a few
 * per request, and kept with the scenario: players never wait on the service. A line with no
 * recording is read by the browser's voice, as before.
 */

const ABOUT = 'Pick a voice and press “Record voices”: every line this character says is recorded once on the server, and players hear it with each word lit as it is spoken. Lines that show a variable other than the player’s name can’t be recorded ahead of time; the browser’s voice reads those. Change a line or the voice and record again: only what changed is recorded.';

/** The voice list and how far recording has got, asked once per scenario and again after recording. */
const status = new Map<number, Promise<VoiceStatus | null>>();

function voiceStatus(ctx: FormContext, fresh = false): Promise<VoiceStatus | null> {
  const id = ctx.store.scenarioId;
  if (fresh || !status.has(id)) {
    // A server without voices answers 503: the section then says so instead of failing.
    status.set(id, ctx.store.api.voices(id).catch((e) => (e instanceof ApiError ? null : Promise.reject(e))));
  }
  return status.get(id)!;
}

/** The "🔊 Voice" part of a character's panel: which voice, a sample to hear, and recording its lines. */
export function voiceSection(ctx: FormContext, row: Row): HTMLElement {
  const { store } = ctx;
  const id = row.id;
  const chosen = String(params(row, 'settings').tts_voice ?? '');
  const select = h('select', { disabled: true }, h('option', { value: chosen }, chosen ? 'Loading…' : 'None: the browser reads its lines'));
  const listen = h('button', { type: 'button', disabled: true, title: 'Hear this voice' }, '▶ Listen');
  const record = h('button', { type: 'button', disabled: true }, '🎙️ Record its lines');
  const note = h('p', { class: 'muted voice-note' });
  const about = h('p', { class: 'muted voice-about' });

  void voiceStatus(ctx).then((s) => {
    if (!s) {
      select.replaceChildren(h('option', { value: '' }, 'Not available on this server'));
      note.textContent = 'This server has no text-to-speech service, so the browser’s voice reads every line (see the settings below).';
      return;
    }
    const voices = s.voices;
    const known = voices.some((v) => v.key === chosen);
    select.replaceChildren(
      h('option', { value: '', selected: !chosen }, 'None: the browser reads its lines'),
      ...groups(voices).map(([label, list]) => {
        const group = h('optgroup', { label });
        group.append(...list.map((v) => h('option', { value: v.key, selected: v.key === chosen, title: v.description }, `${v.label} · ${v.traits.slice(0, 3).join(', ')}`)));
        return group;
      }),
    );
    if (chosen && !known) select.append(h('option', { value: chosen, selected: true }, `${chosen} (not on this server)`));
    select.disabled = false;
    const describe = () => {
      const v = voices.find((x) => x.key === select.value);
      about.textContent = v ? v.description : '';
      listen.disabled = !v || !s.engine;
      record.disabled = !v || !s.engine;
    };
    describe();
    select.onchange = () => {
      describe();
      const settings = { ...params(store.byId('characters', id)!, 'settings') };
      if (select.value) settings.tts_voice = select.value;
      else delete settings.tts_voice;
      void store.patch('characters', id, { settings });
    };
    if (!s.engine) note.textContent = 'Recording is switched off on this server: these voices are only kept for later.';
    else note.textContent = linesNote(ctx, id);
  });

  listen.onclick = () => void play(ctx, select.value, listen);
  record.onclick = () => void recordVoices(ctx, { character_id: id }, record);

  return h('section', { class: 'panel-section voice-section', style: '--tone: var(--tone-character)' },
    h('h4', null, '🔊 Voice', help(ABOUT)),
    h('label', { class: 'field wide', 'data-field': 'tts_voice' }, h('span', { class: 'field-label' }, 'Recorded in the voice of'), select),
    about,
    h('div', { class: 'row-actions' }, listen, record),
    note);
}

/**
 * The narrator's voice, for the scenario's settings: the server's default narrator (left empty),
 * one of its voices, or none (the browser reads the narration). ▶ Listen plays the one chosen.
 */
export function narratorPicker(ctx: FormContext, chosen: string, set: (key: string) => void): HTMLElement {
  const select = h('select', { disabled: true, 'aria-label': 'The narrator’s voice' }, h('option', { value: chosen }, 'Loading…'));
  const listen = h('button', { type: 'button', disabled: true, title: 'Hear this voice' }, '▶ Listen');
  const about = h('p', { class: 'muted voice-about' });
  void voiceStatus(ctx).then((s) => {
    if (!s) {
      select.replaceChildren(h('option', { value: '' }, 'Not available on this server: the browser reads the narration'));
      return;
    }
    const voices = s.voices;
    const fallback = voices.find((v) => v.key === s.narrator);
    select.replaceChildren(
      h('option', { value: '', selected: chosen === '' }, fallback ? `The default narrator: ${fallback.name}` : 'The default narrator (the browser reads it)'),
      h('option', { value: 'none', selected: chosen === 'none' }, 'None: the browser reads the narration'),
      ...groups(voices).map(([label, list]) => {
        const group = h('optgroup', { label });
        group.append(...list.map((v) => h('option', { value: v.key, selected: v.key === chosen, title: v.description }, `${v.label} · ${v.traits.slice(0, 3).join(', ')}`)));
        return group;
      }),
    );
    if (chosen && chosen !== 'none' && !voices.some((v) => v.key === chosen)) select.append(h('option', { value: chosen, selected: true }, `${chosen} (not on this server)`));
    select.disabled = false;
    const voice = () => (select.value === '' ? s.narrator ?? '' : select.value === 'none' ? '' : select.value);
    const describe = () => {
      const v = voices.find((x) => x.key === voice());
      about.textContent = v ? v.description : 'The browser’s own voice reads it, and each word lights up as it is spoken.';
      listen.disabled = !v || !s.engine;
    };
    describe();
    select.onchange = () => {
      describe();
      set(select.value);
    };
    listen.onclick = () => void play(ctx, voice(), listen);
  });
  return h('div', { class: 'narrator-voice' }, select, about, h('div', { class: 'row-actions' }, listen));
}

/**
 * "Record voices" for the editor header: records every character's lines. It shows only when the server
 * has a text-to-speech service and the scenario has characters. `refresh` re-checks after the rows change.
 */
export function recordVoicesButton(ctx: FormContext): { button: HTMLButtonElement; refresh(): void } {
  const button = h('button', { type: 'button', class: 'record-voices', hidden: true, title: 'Record what characters with a voice say' }, '🎙️ Record voices');
  const refresh = () => {
    void voiceStatus(ctx).then((s) => {
      button.hidden = !s?.engine || ctx.store.rows('characters').length === 0;
    });
  };
  button.onclick = () => void recordVoices(ctx, {}, button);
  refresh();
  return { button, refresh };
}

/** The Characters page's voice tools: how many lines are recorded, and a voice for each character that has none. (Recording itself is in the header.) */
export function recordAllButton(ctx: FormContext): HTMLElement {
  const chip = h('span', { class: 'chip', hidden: true });
  const assign = h('button', { type: 'button', hidden: true, title: 'Give a different voice to each character that has none' }, '🎭 Give everyone a voice');
  void voiceStatus(ctx).then((s) => {
    if (!s?.engine) return;
    const voiceless = ctx.store.rows('characters').filter((c) => !params(c, 'settings').tts_voice).length;
    assign.hidden = voiceless === 0;
    if (s.lines && s.lines.total) {
      chip.hidden = false;
      chip.className = `chip ${s.lines.to_record ? 'warn' : 'ok'}`;
      chip.textContent = s.lines.to_record ? `🎙️ ${s.lines.recorded} of ${s.lines.total} lines recorded` : `🎙️ All ${s.lines.total} lines recorded`;
    }
  });
  assign.onclick = async () => {
    assign.disabled = true;
    try {
      const given = await ctx.store.api.assignVoices(ctx.store.scenarioId);
      toast(`Gave ${Object.keys(given).length} character${Object.keys(given).length === 1 ? '' : 's'} a voice. Press “Record voices” in the header to record their lines.`);
      status.delete(ctx.store.scenarioId);
      await ctx.store.load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      assign.disabled = false;
    }
  };
  return h('span', { class: 'voice-tools' }, chip, assign);
}

/**
 * Record lines a few at a time until none are left, then load the scenario again to show them.
 *
 * A request that takes longer than the proxy waits (a long line, a slow service) fails with a 504
 * here but keeps going on the server, which saves what it records. So such a failure is not the
 * end: wait, and ask again. Until that request finishes the server answers `busy`.
 */
async function recordVoices(ctx: FormContext, attrs: { character_id?: number; force?: boolean }, button: HTMLButtonElement) {
  const { store } = ctx;
  const label = button.textContent;
  button.disabled = true;
  let removed = 0;
  let total = 0;
  let changed = false;
  const skipped = new Set<string>();
  let failures = 0;
  /** One request, asked again while the answer is "not in time" (the server carries on regardless). */
  const ask = async (extra: { dry?: boolean; limit?: number }): Promise<VoiceRecording> => {
    for (;;) {
      try {
        const r = await store.api.recordVoices(store.scenarioId, { ...attrs, ...extra });
        failures = 0;
        return r;
      } catch (e) {
        // Give up after about three minutes without an answer: the server is down, not just slow.
        if (!stillWorking(e) || ++failures > 36) throw e;
        changed = true;
        await wait(5000);
      }
    }
  };
  const show = (remaining: number) => {
    if (total) button.textContent = `🎙️ Recording… ${Math.max(0, total - remaining)} of ${total}`;
  };
  try {
    await store.settled();
    // How many there are to record, first: so the count is right even when an answer is lost.
    total = (await ask({ dry: true })).remaining;
    let remaining = total;
    show(remaining);
    for (;;) {
      const r = await ask({ limit: 4 });
      remaining = r.remaining;
      show(remaining);
      if (r.busy) {
        changed = true;
        await wait(3000);
        continue;
      }
      if (r.recorded || r.removed) changed = true;
      removed += r.removed;
      for (const s of r.skipped) skipped.add(`${s.action_id}:${s.line ?? ''}`);
      if (r.remaining === 0 || r.recorded === 0) break;
    }
    // Lines recorded by a request whose answer was lost count too: the server saved them.
    const done = Math.max(0, total - remaining);
    const parts = [done ? `Recorded ${done} line${done === 1 ? '' : 's'}` : 'Every line was already recorded'];
    if (removed) parts.push(`removed ${removed} no longer needed`);
    if (skipped.size) parts.push(`${skipped.size} left to the browser’s voice (they show a variable or play an uploaded recording)`);
    if (remaining) parts.push(`${remaining} not recorded yet: press “Record voices” to try again`);
    toast(`${parts.join('; ')}.${done ? ' Publish to give players the new recordings.' : ''}`);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  } finally {
    button.textContent = label;
    button.disabled = false;
    status.delete(store.scenarioId);
    if (changed) await store.load();
  }
}

/** A failure that means "no answer in time", not "no": the proxy gave up, or the connection dropped. */
function stillWorking(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  return e instanceof ApiError && (e.status === 504 || e.status === 502 || (e.fromProxy && e.status === 503));
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

let playing: HTMLAudioElement | null = null;

async function play(ctx: FormContext, key: string, button: HTMLButtonElement) {
  if (!key) return;
  playing?.pause();
  button.disabled = true;
  try {
    const url = await ctx.store.api.voiceSample(ctx.store.scenarioId, key);
    const audio = new Audio(url);
    playing = audio;
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  } finally {
    button.disabled = false;
  }
}

/** How many of a character's lines (its dialogue, and its lines in conversations) play a recording. */
function linesNote(ctx: FormContext, characterId: number): string {
  type Said = { speaker?: unknown; character_id?: unknown; narration_media_id?: unknown };
  const by = (l: Said) => l.speaker === 'character' && Number(l.character_id) === characterId;
  const lines: Said[] = ctx.store.rows('actions').flatMap((a) =>
    a.type === 'dialogue' ? [params(a) as Said].filter(by) : a.type === 'conversation' ? ((params(a).lines as Said[] | undefined) ?? []).filter(by) : []);
  if (!lines.length) return 'It says no lines yet.';
  const voiced = lines.filter((l) => l.narration_media_id != null).length;
  return `${voiced} of its ${lines.length} line${lines.length === 1 ? '' : 's'} play a recording.`;
}

/** Voices grouped for the list: the theatrical ones first, then women, men, children, and the rest. */
function groups(voices: VoiceChoice[]): Array<[string, VoiceChoice[]]> {
  const theatrical = (v: VoiceChoice): boolean => (v.flair ?? 0) >= 2;
  const everyday = voices.filter((v) => !theatrical(v));
  const out: Array<[string, VoiceChoice[]]> = [
    ['Larger than life', voices.filter(theatrical)],
    ['Women', everyday.filter((v) => v.gender === 'female' && v.age !== 'child')],
    ['Men', everyday.filter((v) => v.gender === 'male' && v.age !== 'child')],
    ['Children', everyday.filter((v) => v.age === 'child' && v.gender !== 'neutral')],
    ['Robots and creatures', everyday.filter((v) => v.gender === 'neutral')],
  ];
  return out.filter(([, list]) => list.length);
}
