import { LINE_ID, newLineId, reachableLines, startLineId } from '@qbl/shared';
import { params } from '../describe';
import { confirmDelete, h, help, redraw } from '../dom';
import { form, select, withValue, type Field, type FormContext, type Values } from '../fields';
import { emojiIcon } from '../icons';
import { openPanel, type Panel } from '../panel';
import type { Store } from '../store';
import { inlineActions } from './actions';
import { inlineConditions, type ConditionValue } from './conditions';

/**
 * A conversation (a dialogue tree) is one action whose lines are kept inside it. The action's card
 * in the event shows the tree as a map you can follow from the start, branch by branch; any line
 * in it opens the conversation's panel at that line. The panel lists every line on the left, in
 * an order the author sets (drag, or ↑ ↓), and edits one on the right: who says it, what they say,
 * and what comes next, either the player's choices (each leading to another line, or ending the
 * talk) or simply the line after. Lines that follow one another with no choice between them are
 * one part of the talk, several boxes said in a row before the player answers: "Add another box"
 * makes one, and the panel shows the boxes of the part together.
 */

interface Choice {
  text?: string;
  next?: string | null;
  actions?: Values[];
  conditions?: ConditionValue[];
  correct?: boolean;
}
interface Line {
  id: string;
  speaker?: string;
  character_id?: number | null;
  text?: string;
  narration_media_id?: number | null;
  conditions?: ConditionValue[];
  choices?: Choice[];
  next?: string | null;
}

const NEW = '__new__';
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Who says a line, in a word or two. */
function speakerName(store: Store, line: Line): string {
  if (line.speaker !== 'character') return 'Player';
  return String(store.byId('characters', line.character_id ?? null)?.name ?? 'A character');
}

/** A round badge for the speaker: the player in blue, characters in pink with their initial. */
function whoBadge(store: Store, line: Line): HTMLElement {
  const player = line.speaker !== 'character';
  return h('span', { class: `talk-who${player ? ' player' : ''}`, title: speakerName(store, line), 'aria-hidden': 'true' }, player ? emojiIcon('🧑') : speakerName(store, line).slice(0, 1).toUpperCase());
}

/** Reading and changing one conversation action's lines. */
function talkOf(store: Store, actionId: number) {
  const values = (): Values => {
    const row = store.byId('actions', actionId);
    return row ? params(row) : {};
  };
  const lines = (): Line[] => (Array.isArray(values().lines) ? (values().lines as Line[]) : []);
  const save = (next: Values, structural = true) => void store.patch('actions', actionId, { params: next }, structural);
  return {
    exists: () => store.byId('actions', actionId) != null,
    values,
    lines,
    line: (id: string | null | undefined) => lines().find((l) => l.id === id),
    start: () => startLineId({ lines: lines() as never, start: values().start as string | undefined }),
    save,
    setLines: (list: Line[], structural = true) => save({ ...values(), lines: list }, structural),
    change: (id: string, edit: (line: Line) => Line, structural = false) => save({ ...values(), lines: lines().map((l) => (l.id === id ? edit({ ...l }) : l)) }, structural),
  };
}

/** The lines that lead to a line: its choices and "then"s, for "Reached from". */
function arrivals(lines: Line[], id: string): Array<{ from: Line; choice?: Choice; index?: number }> {
  const out: Array<{ from: Line; choice?: Choice; index?: number }> = [];
  for (const l of lines) {
    (l.choices ?? []).forEach((c, index) => {
      if (c.next === id) out.push({ from: l, choice: c, index });
    });
    if (l.next === id) out.push({ from: l });
  }
  return out;
}

/**
 * The boxes said in a row with the line `id`: the lines before it and after it that follow on with
 * no choice between them, each reached only from the one before. The last one is where the
 * player answers (or the talk goes on elsewhere, or ends).
 */
export function boxesWith(lines: Line[], id: string, start: string | undefined): Line[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const only = (l: Line) => {
    const from = arrivals(lines, l.id);
    return l.id !== start && from.length === 1 && !from[0]!.choice ? from[0]!.from : undefined;
  };
  const here = byId.get(id);
  if (!here) return [];
  const run = [here];
  const seen = new Set([id]);
  for (let before = only(here); before && !before.choices?.length && !seen.has(before.id); before = only(before)) {
    run.unshift(before);
    seen.add(before.id);
  }
  for (let last = here; !last.choices?.length && last.next;) {
    const after = byId.get(last.next);
    if (!after || seen.has(after.id) || only(after) !== last) break;
    run.push(after);
    seen.add(after.id);
    last = after;
  }
  return run;
}

// --------------------------------------------------------------- the map

/** How deep the map follows branches before it says "…" instead. */
const MAP_DEPTH = 8;
/** How many lines the map shows before it stops. */
const MAP_LINES = 40;

/**
 * The tree, followed from its first line: each line, and under a line with choices, each choice
 * with where it leads. A line already shown is not shown again: the map says it goes back there.
 */
export function conversationMap(ctx: FormContext, actionId: number): HTMLElement {
  const { store } = ctx;
  const talk = talkOf(store, actionId);
  const lines = talk.lines();
  const open = (lineId?: string) => openConversation(ctx, actionId, lineId);
  const shown = new Set<string>();
  let count = 0;

  const lineRow = (line: Line, start: boolean) =>
    h('button', { type: 'button', class: 'talk-map-line', 'data-line': line.id, title: 'Edit this line', onclick: () => open(line.id) },
      whoBadge(store, line),
      h('span', { class: 'talk-map-text' }, h('b', null, `${speakerName(store, line)}: `), clip(line.text?.trim() || '(nothing said yet)', 90)),
      start ? h('span', { class: 'chip talk-start' }, emojiIcon('▶️'), ' Start') : null,
      line.conditions?.length ? h('span', { class: 'chip', title: 'Said only when its conditions hold' }, emojiIcon('🔒')) : null);
  const stub = (cls: string, icon: string, text: string, lineId?: string) =>
    h('li', { class: `talk-map-stub ${cls}` }, lineId
      ? h('button', { type: 'button', class: 'link', 'data-goes': lineId, onclick: () => open(lineId) }, emojiIcon(icon), ` ${text}`)
      : h('span', null, emojiIcon(icon), ` ${text}`));

  /** One line and what follows it, as list items; a line without choices runs straight on. */
  const follow = (id: string | null | undefined, depth: number): HTMLElement[] => {
    const items: HTMLElement[] = [];
    let current = id ?? null;
    while (current) {
      const line = talk.line(current);
      if (!line) {
        items.push(stub('missing', '❌', `A line that is not there (${current})`));
        return items;
      }
      if (shown.has(line.id)) {
        items.push(stub('back', '🔁', `Back to “${clip(line.text ?? line.id, 40)}”`, line.id));
        return items;
      }
      if (count >= MAP_LINES || depth > MAP_DEPTH) {
        items.push(stub('more', '✨', 'And more: open the conversation to see it all', line.id));
        return items;
      }
      shown.add(line.id);
      count++;
      const item = h('li', { class: 'talk-map-item' }, lineRow(line, line.id === talk.start()));
      items.push(item);
      if (line.choices?.length) {
        item.append(h('ul', { class: 'talk-map-choices' }, ...line.choices.map((c, i) =>
          h('li', { class: 'talk-map-choice' },
            h('span', { class: 'talk-map-say' }, h('span', { class: 'talk-key' }, i + 1), clip(c.text?.trim() || '(no text)', 60), c.correct ? h('span', { class: 'chip ok', title: 'A right answer' }, emojiIcon('✅')) : null, c.conditions?.length ? h('span', { class: 'chip', title: 'Offered only when its conditions hold' }, emojiIcon('🔒')) : null),
            c.next ? h('ul', null, ...follow(c.next, depth + 1)) : h('ul', null, stub('end', '🚩', 'Ends the conversation'))))));
        return items;
      }
      if (!line.next) items.push(stub('end', '🚩', 'Ends the conversation'));
      current = line.next ?? null;
    }
    return items;
  };

  const tree = follow(talk.start(), 0);
  const reached = reachableLines({ lines: lines as never, start: talk.start() });
  const never = lines.filter((l) => !reached.has(l.id));

  return h('div', { class: 'talk-map wide' },
    h('div', { class: 'sub-head' },
      h('span', null, emojiIcon('🗺️'), ' The conversation', help('Follow it from the start. Each choice the player can make is listed under the line it answers, with where it leads. Click any line to edit it.')),
      h('button', { type: 'button', class: 'primary talk-open', onclick: () => open() }, emojiIcon('🔀'), ' Edit the conversation')),
    lines.length ? h('ul', { class: 'talk-map-tree' }, ...tree) : h('p', { class: 'muted' }, 'No lines yet.'),
    never.length ? h('p', { class: 'talk-map-never' }, emojiIcon('❓'), ` Never said: ${never.map((l) => `“${clip(l.text ?? l.id, 30)}”`).join(', ')}. No choice leads there.`) : null);
}

// ------------------------------------------------------------- the panel

/** The line each conversation's panel has open, and the lines visited before it (for Back). */
const selected = new Map<number, string>();
const visited = new Map<number, string[]>();

/** Open a conversation's panel, at a line (default: the one last open there, else the first). */
export function openConversation(ctx: FormContext, actionId: number, lineId?: string): Panel {
  const { store } = ctx;
  const talk = talkOf(store, actionId);
  if (lineId) go(actionId, lineId);
  const key = `conversation-${actionId}`;
  // Going to another line changes nothing in the store, so the panel is redrawn here.
  const draw = () => {
    const body = document.querySelector<HTMLElement>(`dialog[data-key="${key}"] .panel-body`);
    const content = body ? conversationBody(ctx, actionId, draw) : null;
    if (body && content) redraw(body, content);
  };
  return openPanel({
    key,
    kind: 'conversation',
    store,
    tone: 'var(--tone-talk)',
    title: () => {
      if (!talk.exists()) return null;
      const event = store.byId('events', store.byId('actions', actionId)?.event_id as number);
      return h('span', null, emojiIcon('🔀'), ' Conversation', h('small', { class: 'muted' }, ` in ${String(event?.shortname || `event #${event?.id ?? '?'}`)} · action #${actionId}`));
    },
    body: () => (talk.exists() ? conversationBody(ctx, actionId, draw) : null),
    opened: (dialog) => {
      // Opened at a line: go there, even if the panel was already open.
      if (lineId) draw();
      dialog.querySelector<HTMLElement>('.talk-nav-item.current')?.scrollIntoView({ block: 'nearest' });
    },
  });
}

/** Make a line the open one, remembering the one before so Back can return to it. */
function go(actionId: number, lineId: string) {
  const now = selected.get(actionId);
  if (now === lineId) return;
  if (now) visited.set(actionId, [...(visited.get(actionId) ?? []), now].slice(-30));
  selected.set(actionId, lineId);
}

function conversationBody(ctx: FormContext, actionId: number, draw: () => void): HTMLElement | null {
  const { store } = ctx;
  const talk = talkOf(store, actionId);
  const lines = talk.lines();
  if (!lines.some((l) => l.id === selected.get(actionId))) selected.set(actionId, talk.start() ?? '');
  const current = talk.line(selected.get(actionId));
  const goTo = (id: string) => {
    go(actionId, id);
    draw();
  };
  const addLine = (from?: Line): string => {
    const id = newLineId(talk.lines());
    // A reply usually comes from whoever said the line it answers.
    const who = from ? { speaker: from.speaker, character_id: from.character_id } : {};
    talk.setLines([...talk.lines(), withValue(withValue({ id, text: '' }, 'speaker', who.speaker), 'character_id', who.character_id) as unknown as Line], false);
    return id;
  };

  // ---- the lines, on the left
  const reached = reachableLines({ lines: lines as never, start: talk.start() });
  const leads = (line: Line) => {
    if (line.choices?.length) return h('span', { class: 'chip' }, emojiIcon('❓'), ` ${line.choices.length} choice${line.choices.length === 1 ? '' : 's'}`);
    if (line.next) return h('span', { class: 'chip' }, '→ ', clip(talk.line(line.next)?.text || line.next, 18));
    return h('span', { class: 'chip end' }, emojiIcon('🚩'), ' Ends');
  };
  /**
   * The lines in a new order. The order is the author's (the game goes by the links, not by it),
   * except that a conversation with no "Starts with" starts at the first line: the start is kept
   * where it was.
   */
  const reorder = (order: Line[]) => {
    const start = talk.start();
    talk.save(withValue({ ...talk.values(), lines: order }, 'start', start === order[0]?.id ? null : start), true);
  };
  const moveLine = (lineId: string, to: number) => {
    const order = talk.lines().filter((l) => l.id !== lineId);
    const line = talk.line(lineId);
    if (!line) return;
    order.splice(Math.max(0, Math.min(order.length, to)), 0, line);
    reorder(order);
  };
  let dragging: string | null = null;
  const navRow = (l: Line, index: number) => {
    const from = arrivals(lines, l.id);
    // A box that follows straight on from the one above it is drawn as part of it.
    const follows = index > 0 && from.length === 1 && !from[0]!.choice && from[0]!.from.id === lines[index - 1]!.id && !lines[index - 1]!.choices?.length && l.id !== talk.start();
    const grip = h('span', { class: 'grip', draggable: 'true', title: 'Drag to change the order', 'aria-hidden': 'true' }, '⠿');
    const row = h('li', { class: `talk-nav-row${follows ? ' follows' : ''}`, 'data-row': l.id },
      grip,
      h('button', {
        type: 'button', class: `talk-nav-item${l.id === current?.id ? ' current' : ''}${reached.has(l.id) ? '' : ' unreached'}`, 'data-line': l.id,
        'aria-current': l.id === current?.id ? 'true' : null, onclick: () => goTo(l.id),
      },
      whoBadge(store, l),
      h('span', { class: 'talk-nav-main' },
        h('span', { class: 'talk-nav-name' }, follows ? h('span', { class: 'talk-follows', title: 'Said straight after the line above' }, '↳') : null, speakerName(store, l), l.id === talk.start() ? h('span', { class: 'chip talk-start' }, emojiIcon('▶️'), ' Start') : null, reached.has(l.id) ? null : h('span', { class: 'chip warn' }, 'never said')),
        h('span', { class: 'talk-nav-text' }, clip(l.text?.trim() || '(nothing said yet)', 70))),
      leads(l)),
      h('span', { class: 'talk-nav-move' },
        h('button', { type: 'button', class: 'icon', title: 'Move up', 'aria-label': 'Move this line up', disabled: index === 0, onclick: () => moveLine(l.id, index - 1) }, '↑'),
        h('button', { type: 'button', class: 'icon', title: 'Move down', 'aria-label': 'Move this line down', disabled: index === lines.length - 1, onclick: () => moveLine(l.id, index + 1) }, '↓')));
    grip.addEventListener('dragstart', (e) => {
      dragging = l.id;
      e.dataTransfer?.setData('text/plain', l.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer?.setDragImage(row, 12, 12);
      row.classList.add('dragging');
    });
    grip.addEventListener('dragend', () => {
      dragging = null;
      row.classList.remove('dragging');
      for (const el of row.parentElement?.querySelectorAll('.drop-before, .drop-after') ?? []) el.classList.remove('drop-before', 'drop-after');
    });
    const half = (e: DragEvent) => (e.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2 ? 'before' : 'after');
    row.addEventListener('dragover', (e) => {
      if (dragging == null || dragging === l.id) return;
      e.preventDefault();
      row.classList.toggle('drop-before', half(e) === 'before');
      row.classList.toggle('drop-after', half(e) === 'after');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
    row.addEventListener('drop', (e) => {
      if (dragging == null || dragging === l.id) return;
      e.preventDefault();
      const moved = dragging;
      dragging = null;
      const order = talk.lines().filter((x) => x.id !== moved);
      moveLine(moved, order.findIndex((x) => x.id === l.id) + (half(e) === 'after' ? 1 : 0));
    });
    return row;
  };

  const nav = h('section', { class: 'panel-section talk-nav', style: '--tone: var(--tone-talk)' },
    h('h3', { class: 'section-head' }, emojiIcon('🗺️'), ' Lines', help('Every line of the conversation, in the order you choose: drag a line by its ⠿, or use ↑ and ↓. The order only helps you find your way; the conversation starts at the line marked Start and goes where the player’s choices lead. ↳ marks a box said straight after the one above it. Lines marked “never said” have nothing leading to them yet.')),
    h('label', { class: 'field wide talk-start-field' }, h('span', { class: 'field-label' }, 'Starts with'),
      select(lines.map((l) => [l.id, `${speakerName(store, l)}: ${clip(l.text || l.id, 40)}`] as const), talk.start() ?? '', (v) => talk.save(withValue(talk.values(), 'start', v === lines[0]?.id ? null : v), true))),
    h('ol', { class: 'talk-nav-list' }, ...lines.map((l, index) => navRow(l, index))),
    h('button', { type: 'button', class: 'talk-add-line', onclick: () => goTo(addLine(current)) }, emojiIcon('➕'), ' Add a line'));

  if (!current) return h('div', { class: 'talk-panel' }, nav, h('section', { class: 'panel-section talk-line' }, h('p', { class: 'muted' }, 'Add a line to begin.')));

  // ---- the open line, on the right
  const id = current.id;
  const lineFields: Field[] = [
    { key: 'speaker', label: 'Who says it', kind: 'select', placeholder: 'The player', options: [['character', 'A character']], structural: true },
    { key: 'character_id', label: 'Character', kind: 'character', structural: true, when: (v) => v.speaker === 'character', hint: 'In a story box any character can speak. As a bubble, the character must be placed in this scene.' },
    { key: 'text', label: 'What they say', kind: 'textarea', wide: true, hint: 'Use {{variable_name}} to show a variable, and {{QL_PlayerName}} for the player’s name (see “Built in” under 🔢 Variable in an infobox for the rest).' },
    { key: 'narration_media_id', label: 'Recording of this line', kind: 'media', mediaType: 'audio', soundGroup: 'voice', placeholder: 'The browser’s voice', hint: 'Played when lines are read aloud, instead of the browser’s voice.' },
  ];
  const lineForm = form(lineFields, current as unknown as Values, (key, value, field) => {
    talk.change(id, (l) => withValue(l as unknown as Values, key, value, field) as unknown as Line, field.structural === true || key === 'narration_media_id');
    // The list on the left shows what is said; keep it up to date without redrawing the panel under the typing.
    if (key === 'text') {
      const text = String(value ?? '').trim();
      for (const el of document.querySelectorAll(`dialog[data-panel="conversation"] .talk-nav-item[data-line="${CSS.escape(id)}"] .talk-nav-text`)) el.textContent = clip(text || '(nothing said yet)', 70);
    }
  }, ctx);

  const back = visited.get(actionId) ?? [];
  const previous = [...back].reverse().find((l) => l !== id && talk.line(l));
  const from = arrivals(lines, id);
  const fromList = h('div', { class: 'talk-from' },
    h('span', { class: 'field-label' }, 'Reached from'),
    id === talk.start() ? h('span', { class: 'chip talk-start' }, emojiIcon('▶️'), ' The start') : null,
    ...from.map((a) => h('button', { type: 'button', class: 'chip talk-from-link', title: 'Go to that line', onclick: () => goTo(a.from.id) },
      '← ', `${speakerName(store, a.from)}: ${clip(a.from.text || a.from.id, 28)}`, a.choice ? h('em', null, ` · “${clip(a.choice.text || '', 24)}”`) : h('em', null, ' · then'))),
    !from.length && id !== talk.start() ? h('span', { class: 'muted small' }, 'Nothing leads here yet: pick this line in a choice’s “Leads to”.') : null);

  const rename = h('input', {
    type: 'text', value: id, class: 'talk-id', 'aria-label': 'Line id', title: 'The line’s id: what choices point at. Letters, digits, - and _.',
    onchange: () => {
      const next = rename.value.trim();
      if (next === id) return;
      if (!LINE_ID.test(next) || talk.line(next)) {
        rename.value = id;
        rename.setCustomValidity('Use 1 to 32 letters, digits, - or _, not the id of another line');
        rename.reportValidity();
        return;
      }
      // Everything that pointed at the old id points at the new one.
      const swap = (v: string | null | undefined) => (v === id ? next : v);
      selected.set(actionId, next);
      talk.save({
        ...talk.values(),
        start: swap(talk.values().start as string | undefined),
        lines: talk.lines().map((l) => ({ ...l, id: swap(l.id)!, next: swap(l.next), choices: l.choices?.map((c) => ({ ...c, next: swap(c.next) })) })),
      });
    },
  });

  const head = h('div', { class: 'talk-line-head' },
    whoBadge(store, current),
    h('h3', { class: 'section-head' }, `${speakerName(store, current)} says`),
    h('label', { class: 'talk-id-label', title: 'What choices point at. Letters, digits, - and _.' }, 'Line id', rename),
    previous ? h('button', { type: 'button', class: 'talk-back', title: 'Back to the line you were on', onclick: () => {
      visited.set(actionId, back.slice(0, back.lastIndexOf(previous)));
      selected.set(actionId, previous);
      draw();
    } }, '← Back') : null,
    id !== talk.start() ? h('button', { type: 'button', onclick: () => talk.save(withValue(talk.values(), 'start', id === lines[0]?.id ? null : id), true) }, emojiIcon('▶️'), ' Start here') : null,
    h('button', { type: 'button', class: 'danger', onclick: () => {
      if (!confirmDelete('this line')) return;
      // Choices and lines that led here go on to the line after it, when it simply runs on to
      // one (a box in a row of boxes); otherwise they end the conversation instead.
      const gone = talk.line(id);
      const onTo = !gone?.choices?.length && gone?.next && gone.next !== id ? gone.next : undefined;
      const unlink = (v: string | null | undefined) => (v === id ? onTo : v);
      const rest = talk.lines().filter((l) => l.id !== id).map((l) => {
        const out = { ...l, choices: l.choices?.map((c) => withValue({ ...c }, 'next', unlink(c.next)) as Choice) };
        return withValue(out as unknown as Values, 'next', unlink(l.next)) as unknown as Line;
      });
      selected.delete(actionId);
      talk.save(withValue({ ...talk.values(), lines: rest }, 'start', unlink(talk.values().start as string | undefined)));
    } }, 'Delete line'));

  /** Where something goes next: another line, a new line, or the end. `set` gets the id, or null for the end. */
  const target = (value: string | null | undefined, set: (next: string | null) => void, endLabel: string) => {
    const options = lines.map((l) => [l.id, `${l.id === id ? '↺ ' : ''}${speakerName(store, l)}: ${clip(l.text || '(nothing yet)', 44)}`] as const);
    const pick = select([...options, [NEW, '➕ A new line…']], value ?? '', (v) => {
      if (v === NEW) {
        const made = addLine(current);
        set(made);
        goTo(made);
        return;
      }
      set(v || null);
    }, endLabel);
    return h('span', { class: 'talk-target' }, pick,
      value && talk.line(value) ? h('button', { type: 'button', class: 'talk-go', title: 'Go to that line', onclick: () => goTo(value) }, 'Go →') : null);
  };

  // ---- boxes said in a row, before the player answers
  /** A new box straight after this one: what this line led to (its choices, or its next) moves on to the new box. */
  const addBox = () => {
    const here = talk.line(id);
    if (!here) return;
    const made = newLineId(talk.lines());
    let box = { id: made, text: '' } as Values;
    box = withValue(box, 'speaker', here.speaker);
    box = withValue(box, 'character_id', here.character_id);
    box = withValue(box, 'choices', here.choices?.length ? here.choices : null);
    box = withValue(box, 'next', here.next);
    const list = talk.lines().flatMap((l) => (l.id === id
      ? [withValue(withValue(l as unknown as Values, 'choices', null), 'next', made) as unknown as Line, box as unknown as Line]
      : [l]));
    go(actionId, made);
    talk.setLines(list, true);
    draw();
  };
  const boxes = boxesWith(lines, id, talk.start());
  const at = boxes.findIndex((b) => b.id === id);
  const last = boxes.at(-1);
  const strip = boxes.length > 1
    ? h('nav', { class: 'talk-boxes', 'aria-label': 'Boxes said in a row' },
      h('span', { class: 'field-label' }, `Box ${at + 1} of ${boxes.length}`, help('These lines are said one after another, each in its own box, before anything else happens. The player answers after the last one.')),
      ...boxes.flatMap((b, i) => [
        i ? h('span', { class: 'talk-boxes-arrow', 'aria-hidden': 'true' }, '→') : null,
        h('button', { type: 'button', class: `chip talk-box${b.id === id ? ' current' : ''}`, 'data-box': b.id, 'aria-current': b.id === id ? 'true' : null, title: b.text || '(nothing said yet)', onclick: () => goTo(b.id) },
          h('b', null, i + 1), ` ${speakerName(store, b)}: ${clip(b.text?.trim() || '…', 22)}`),
      ]),
      h('span', { class: 'talk-boxes-arrow', 'aria-hidden': 'true' }, '→'),
      h('span', { class: 'chip' }, last?.choices?.length ? h('span', null, emojiIcon('❓'), ' The player answers') : last?.next ? '↪ Goes on' : h('span', null, emojiIcon('🚩'), ' Ends')))
    : null;
  const more = h('div', { class: 'talk-more' },
    h('button', { type: 'button', class: 'talk-add-box', onclick: addBox }, emojiIcon('➕'), ' Add another box after this one'),
    help(current.choices?.length
      ? 'Another line said straight after this one, before the player answers: the choices move on to the new box.'
      : 'Another line said straight after this one, before the conversation goes on.'));

  // ---- the player's choices
  const choices = current.choices ?? [];
  const readChoices = (): Choice[] => talk.line(id)?.choices ?? [];
  const writeChoices = (list: Choice[], structural = true) => talk.change(id, (l) => withValue(l as unknown as Values, 'choices', list.length ? list : null) as unknown as Line, structural);
  const changeChoice = (index: number, edit: (c: Choice) => Choice, structural = false) => writeChoices(readChoices().map((c, i) => (i === index ? edit({ ...c }) : c)), structural);
  const move = (index: number, by: number) => {
    const list = [...readChoices()];
    const [c] = list.splice(index, 1);
    list.splice(index + by, 0, c!);
    writeChoices(list);
  };

  const choiceCards = choices.map((c, index) => {
    const text = h('input', { type: 'text', value: c.text ?? '', placeholder: 'What the player says', 'aria-label': `Choice ${index + 1}`, onchange: () => changeChoice(index, (x) => ({ ...x, text: text.value })) });
    const correct = h('input', { type: 'checkbox', checked: c.correct === true, onchange: () => changeChoice(index, (x) => withValue(x as Values, 'correct', correct.checked ? true : null) as Choice, true) });
    return h('div', { class: `talk-choice${c.correct ? ' correct' : ''}`, 'data-choice': index },
      h('div', { class: 'talk-choice-head' },
        h('span', { class: 'talk-key' }, index + 1),
        text,
        h('button', { type: 'button', class: 'icon', title: 'Move up', 'aria-label': 'Move up', disabled: index === 0, onclick: () => move(index, -1) }, '↑'),
        h('button', { type: 'button', class: 'icon', title: 'Move down', 'aria-label': 'Move down', disabled: index === choices.length - 1, onclick: () => move(index, 1) }, '↓'),
        h('button', { type: 'button', class: 'icon', title: 'Remove this choice', 'aria-label': 'Remove this choice', onclick: () => writeChoices(readChoices().filter((_, i) => i !== index)) }, '×')),
      h('div', { class: 'talk-choice-row' },
        h('span', { class: 'field-label' }, 'Leads to'),
        target(c.next, (next) => changeChoice(index, (x) => withValue(x as Values, 'next', next) as Choice, true), '🚩 Ends the conversation')),
      h('label', { class: 'field check' }, correct, h('span', null, 'A right answer'), help('For the teacher’s report: when any choice of a line is marked right, the report says whether each student’s first answer to it was right. The player is not told.')),
      inlineActions(ctx, () => readChoices()[index]?.actions ?? [], (list, structural) => changeChoice(index, (x) => withValue(x as Values, 'actions', list.length ? list : null) as Choice, structural)),
      inlineConditions(ctx, () => readChoices()[index]?.conditions, (list, structural) => changeChoice(index, (x) => withValue(x as Values, 'conditions', list.length ? list : null) as Choice, structural), 'Offered only when', 'Always offered.'));
  });

  const next = h('section', { class: 'talk-then' },
    h('h4', null, emojiIcon('❓'), ' Then the player says…', help('Once this line has been said, the player’s answers come up in a box of their own, and the player picks one. Each can lead to another line, or end the conversation, and can do things too (set a variable, run an event). Choices whose conditions do not hold are not offered; when none is, the conversation goes on as if the line had no choices.')),
    choiceCards.length ? h('div', { class: 'talk-choices' }, ...choiceCards) : h('p', { class: 'muted' }, 'No choices: the player clicks to go on. To say more before the player answers, add another box above.'),
    h('button', { type: 'button', class: 'talk-add-choice', onclick: () => writeChoices([...readChoices(), { text: '' }]) }, emojiIcon('➕'), ' Add a choice'),
    h('div', { class: `talk-choice-row talk-next${choices.length ? ' quiet' : ''}` },
      h('span', { class: 'field-label' }, choices.length ? 'When none is offered, go on to' : 'Then go on to'),
      target(current.next, (v) => talk.change(id, (l) => withValue(l as unknown as Values, 'next', v) as unknown as Line, true), '🚩 The end of the conversation')));

  const said = h('section', { class: 'panel-section talk-line', 'data-line': id, style: '--tone: var(--tone-talk)' },
    head,
    strip,
    fromList,
    lineForm,
    more,
    inlineConditions(ctx, () => talk.line(id)?.conditions, (list, structural) => talk.change(id, (l) => withValue(l as unknown as Values, 'conditions', list.length ? list : null) as unknown as Line, structural), 'Said only when', 'Always said.'),
    current.conditions?.length ? h('p', { class: 'muted small' }, 'When these do not hold, the conversation passes over this line to its “Then go on to” line.') : null,
    next);

  return h('div', { class: 'talk-panel' }, nav, said);
}
