import {
  BENCH_EFFECTS, BENCH_KITS, BENCH_MEASURES, BENCH_SHAPES, BENCH_TOOLS, BENCH_WATCHES, equationText, mixText, parseEquation, parseMix, vesselName, withKit,
  type BenchReaction, type BenchSubstance, type BenchTool, type BenchVessel, type SceneBench,
} from '@qbl/shared';
import { confirmDelete, h, help, toast } from '../../dom';
import { form, select, type Field, type FormContext, type Values } from '../../fields';
import type { SceneModel, Selection } from './model';

export interface BenchPanelHost {
  select(selection: Selection): void;
}

type Item = { id: string } & Record<string, unknown>;

const gone = () => h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'This no longer exists.'));
const is = (key: string, ...values: string[]) => (v: Values) => values.includes(String(v[key] ?? ''));
const options = <T extends string>(map: Record<T, string | { label: string }>) => (Object.entries(map) as Array<[T, string | { label: string }]>).map(([key, v]) => [key, typeof v === 'string' ? v : v.label] as const);

/** An id not yet used in a list, from a readable start ("beaker", "beaker_2"). It can be written in a recipe or a formula. */
export function freshBenchId(bench: SceneBench | null, list: 'substances' | 'vessels' | 'tools' | 'reactions' | 'readouts' | 'watches', start: string): string {
  const used = new Set((bench?.[list] ?? []).map((t) => String(t.id)));
  let base = start.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'thing';
  if (/^\d/.test(base)) base = `n${base}`;
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** A bench in which something has a new id: everything that named it follows. */
function renamed(bench: SceneBench, what: 'substance' | 'readout', from: string, to: string): SceneBench {
  if (from === to || !to) return bench;
  if (what === 'substance') {
    const amounts = <T extends { substance: string }>(list: T[] | undefined) => list?.map((p) => (p.substance === from ? { ...p, substance: to } : p));
    return {
      ...bench,
      vessels: bench.vessels?.map((v) => ({ ...v, contents: amounts(v.contents) })),
      reactions: bench.reactions?.map((r) => ({ ...r, uses: amounts(r.uses) ?? [], makes: amounts(r.makes), when: r.when?.replace(new RegExp(`\\b${from}\\b`, 'g'), to) })),
      readouts: bench.readouts?.map((r) => (r.substance === from ? { ...r, substance: to } : r)),
      watches: bench.watches?.map((w) => (w.substance === from ? { ...w, substance: to } : w)),
    };
  }
  return {
    ...bench,
    readouts: bench.readouts?.map((r) => (r.formula ? { ...r, formula: r.formula.replace(new RegExp(`\\b${from}\\b`, 'g'), to) } : r)),
    watches: bench.watches?.map((w) => (w.readout_id === from ? { ...w, readout_id: to } : w)),
    graph: bench.graph ? { ...bench.graph, x: bench.graph.x === from ? to : bench.graph.x, y: bench.graph.y === from ? to : bench.graph.y } : bench.graph,
  };
}

/** An indicator's colours as text: "1:#e53935, 7:#43a047, 13:#8e24aa". */
const indicatorText = (stops: unknown) => (Array.isArray(stops) ? (stops as Array<{ ph: number; color: string }>).map((s) => `${s.ph}:${s.color}`).join(', ') : '');
function parseIndicator(text: string): Array<{ ph: number; color: string }> | null {
  const out: Array<{ ph: number; color: string }> = [];
  for (const part of text.split(',')) {
    if (!part.trim()) continue;
    const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(#[0-9a-f]{6})\s*$/i.exec(part);
    if (!m) return null;
    out.push({ ph: Number(m[1]), color: m[2]!.toLowerCase() });
  }
  return out;
}

// ------------------------------------------------------------------ the forms

const SETTINGS_FIELDS: Field[] = [
  { key: 'ambient', label: 'Room temperature (°C)', kind: 'number', placeholder: '20', slider: { min: 0, max: 40 } },
  { key: 'cooling', label: 'How fast things cool', kind: 'number', min: 0, max: 1, step: 0.01, placeholder: '0.02', hint: 'The share of the difference from room temperature lost each second. 0: things stay as hot as they were made.' },
  { key: '_reset', label: 'Offer a Start again button', kind: 'bool', default: true },
];

const SUBSTANCE_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', placeholder: 'What players read' },
  { key: 'id', label: 'Short name', kind: 'text', structural: true, hint: 'What it is called in recipes, reactions and conditions: letters, digits and _ (baking_soda). Changing it changes it everywhere on this bench.' },
  { key: 'state', label: 'It is a', kind: 'select', default: 'liquid', structural: true, options: [['liquid', 'Liquid (measured in mL)'], ['solid', 'Solid (measured in g; it lies at the bottom)'], ['gas', 'Gas (it leaves the container)']] },
  { key: 'formula', label: 'Formula', kind: 'text', placeholder: 'H₂O (optional)' },
  { key: 'color', label: 'Colour', kind: 'color', when: (v) => v.state !== 'gas' },
  { key: 'strength', label: 'How strongly it colours a mixture', kind: 'number', min: 0, step: 0.1, placeholder: '1 (hardly at all if it has no colour)', when: (v) => v.state !== 'gas', hint: '0.2 for water, which takes the colour of what is put in it. 10 for a dye, a drop of which colours a glassful.' },
  { key: 'opacity', label: 'How solid the colour is', kind: 'number', min: 0, max: 1, step: 0.05, placeholder: '0.75', slider: { min: 0, max: 1, step: 0.05 }, when: is('state', 'liquid', '') },
  { key: 'ph', label: 'pH', kind: 'number', min: 0, max: 14, step: 0.1, placeholder: 'It does not change the pH', slider: { min: 0, max: 14, step: 0.1 }, when: is('state', 'liquid', ''), hint: 'For an acid or a base. A mixture’s pH is worked out from what is in it: acids and bases cancel, and everything else dilutes them.' },
  { key: '_indicator', label: 'An indicator: its colour at each pH', kind: 'text', wide: true, placeholder: '1:#e53935, 7:#43a047, 13:#8e24aa', when: is('state', 'liquid', ''), hint: 'Leave empty unless this changes colour with the pH. Between the pH values given, the colours blend. A little of it colours the whole mixture.' },
  { key: 'density', label: 'Density (g/mL)', kind: 'number', min: 0.01, step: 0.01, placeholder: '1', when: is('state', 'liquid', '') },
  { key: 'separate', label: 'It does not mix: it lies in a layer of its own, by its density', kind: 'bool', wide: true, when: is('state', 'liquid', '') },
  { key: 'boils_at', label: 'Boils at (°C)', kind: 'number', placeholder: 'Never', when: is('state', 'liquid', ''), hint: 'A container holding this gets no hotter. Write a reaction to say what boiling does (water → steam).' },
];

const REACTION_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', placeholder: 'For you, and the list' },
  {
    key: '_equation', label: 'What turns into what', kind: 'text', wide: true, placeholder: '2 vinegar + 1 baking_soda -> 2 salty_water + 6 co2',
    hint: 'On the left, what has to be in a container together and how much of each one round uses up; on the right, what a round makes. Use the substances’ short names. An amount of 0 on the left: it has to be there, but is not used up. The right may be empty. A gas that is made leaves the container.',
  },
  {
    key: 'when', label: 'Only when', kind: 'text', wide: true, placeholder: 'Always (for example: temperature >= 60; stirred = 1)',
    hint: 'Conditions separated by ; that all have to hold. Names: temperature (°C), volume (mL), ph, stirred (1 for a few seconds after stirring), time (seconds), and any substance’s short name (how much of it is in the container).',
  },
  { key: 'rate', label: 'Rounds a second', kind: 'number', min: 0, step: 0.1, placeholder: 'All at once' },
  { key: 'heat', label: 'Heat a round gives 100 mL (°C)', kind: 'number', step: 0.1, placeholder: '0', hint: 'Negative: it gets colder.' },
  { key: 'effect', label: 'What it looks like', kind: 'select', default: 'bubbles', options: options(BENCH_EFFECTS), structural: true },
  { key: 'effect_color', label: 'In this colour', kind: 'color', when: (v) => v.effect !== 'none' },
  { key: 'note', label: 'Tell the player, the first time', kind: 'text', wide: true, placeholder: 'It fizzes!' },
];

const needsVessel = (v: Values) => BENCH_MEASURES[String(v.measure ?? 'volume') as keyof typeof BENCH_MEASURES]?.vessel === true;
const READOUT_FIELDS: Field[] = [
  { key: 'label', label: 'Label', kind: 'text', placeholder: 'What it measures' },
  { key: 'measure', label: 'Measures', kind: 'select', default: 'volume', structural: true, options: options(BENCH_MEASURES) },
  { key: 'vessel_id', label: 'In', kind: 'bench', bench: 'vessels', when: needsVessel },
  { key: 'substance', label: 'Of', kind: 'bench', bench: 'substances', when: is('measure', 'amount', 'released'), placeholder: 'Choose a substance' },
  { key: 'formula', label: 'Formula', kind: 'text', wide: true, when: is('measure', 'formula'), placeholder: 'salt / volume * 100', hint: 'Worked out from the other readouts, by their short names, and time. Sums as on a calculator: + - * / ^, brackets, sqrt(x), round(x, 1).' },
  { key: 'id', label: 'Short name', kind: 'text', structural: true, hint: 'What it is called in formulas: letters, digits and _.' },
  { key: 'unit', label: 'Unit shown', kind: 'text', placeholder: 'mL, °C, g…' },
  { key: 'digits', label: 'Decimal places', kind: 'number', min: 0, max: 6, step: 1 },
  { key: 'variable', label: 'Keep it in the variable', kind: 'variable', placeholder: 'None' },
  { key: 'hidden', label: 'Measure it without showing it', kind: 'bool' },
];

const WATCH_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', placeholder: 'For you, and the list' },
  { key: 'when', label: 'When', kind: 'select', default: 'reaction', structural: true, options: options(BENCH_WATCHES) },
  { key: 'reaction_id', label: 'Which reaction', kind: 'bench', bench: 'reactions', when: is('when', 'reaction', ''), placeholder: 'Any' },
  { key: 'readout_id', label: 'Which readout', kind: 'bench', bench: 'readouts', when: is('when', 'reading') },
  { key: 'operator', label: 'Is', kind: 'select', default: '>=', when: is('when', 'reading'), options: [['>=', 'at least'], ['>', 'more than'], ['<=', 'at most'], ['<', 'less than'], ['=', 'exactly'], ['!=', 'not']] },
  { key: 'value', label: 'This value', kind: 'number', step: 0.1, when: is('when', 'reading') },
  { key: 'substance', label: 'Holds', kind: 'bench', bench: 'substances', when: is('when', 'contains') },
  { key: 'amount', label: 'At least (mL or g)', kind: 'number', min: 0, step: 0.1, placeholder: 'Any at all', when: is('when', 'contains') },
  { key: 'vessel_id', label: 'In', kind: 'bench', bench: 'vessels', when: is('when', 'reaction', 'contains', 'overflow', ''), placeholder: 'Any container' },
  { key: 'variable', label: 'Set the variable', kind: 'variable', placeholder: 'None' },
  { key: 'set', label: 'To', kind: 'value', placeholder: '1 (a reading: its value)' },
  { key: 'event_id', label: 'And run the event', kind: 'event', eventKinds: ['indirect'], eventHere: true, placeholder: 'None' },
  { key: 'repeat', label: 'Every time it happens, not only the first', kind: 'bool', wide: true },
];

const GRAPH_FIELDS: Field[] = [
  { key: 'x', label: 'Across', kind: 'bench', bench: 'axes' },
  { key: 'y', label: 'Up', kind: 'bench', bench: 'readouts' },
  { key: 'title', label: 'Title', kind: 'text', placeholder: 'Optional' },
  { key: 'record', label: 'A point is added', kind: 'select', default: 'button', options: [['button', 'When the player presses Record'], ['live', 'Twice a second, by itself']] },
  { key: 'variable', label: 'Keep the points in the variable', kind: 'variable', placeholder: 'None', hint: 'As text, "x,y;x,y". A Graph block in an infobox can then show what was recorded, and it is still there on the next visit.' },
];

const VESSEL_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', placeholder: 'Shown under it' },
  { key: 'shape', label: 'Kind', kind: 'select', default: 'beaker', structural: true, options: options(BENCH_SHAPES) },
  { key: 'x', label: 'Middle of its foot: X', kind: 'number', spot: { y: 'y', prompt: 'Click where it should stand' } },
  { key: 'y', label: 'Y', kind: 'number' },
  { key: 'width', label: 'Width (px)', kind: 'number', min: 10, slider: { min: 20, max: 600 } },
  { key: 'height', label: 'Height (px)', kind: 'number', min: 10, slider: { min: 20, max: 800 } },
  { key: 'capacity', label: 'It holds (mL)', kind: 'number', min: 1 },
  { key: '_contents', label: 'In it to begin with', kind: 'text', wide: true, placeholder: 'Empty (for example: 50 water + 5 salt)', hint: 'Amounts in mL (g for a solid) of the bench’s substances, by their short names, joined with +.' },
  { key: 'supply', label: 'A stock bottle: it never runs out, and nothing is poured into it', kind: 'bool', wide: true, structural: true },
  { key: 'pour', label: 'One tip pours (mL)', kind: 'number', min: 0.1, step: 0.5, hint: 'A dropper gives a drop; a beaker gives a splash.' },
  { key: 'fixed', label: 'It stays where it is: things are poured into it, never out of it', kind: 'bool', wide: true, when: (v) => v.supply !== true },
  { key: 'temperature', label: 'Its temperature to begin with (°C)', kind: 'number', placeholder: 'The room’s' },
  { key: 'marks', label: 'A scale up its side', kind: 'bool' },
  { key: 'label', label: 'Show its name under it', kind: 'bool', default: true },
];

const TOOL_FIELDS: Field[] = [
  { key: 'kind', label: 'Kind', kind: 'select', default: 'burner', structural: true, options: options(BENCH_TOOLS) },
  { key: 'name', label: 'Name', kind: 'text', placeholder: 'Shown under it' },
  { key: 'x', label: 'Middle of its foot: X', kind: 'number', spot: { y: 'y', prompt: 'Click where it should stand' } },
  { key: 'y', label: 'Y', kind: 'number' },
  { key: 'vessel_id', label: 'It heats', kind: 'bench', bench: 'vessels', when: is('kind', 'burner', ''), hint: 'The container standing on it. Players tap the burner to light it and to put it out.' },
  { key: 'power', label: 'It warms 100 mL by (°C a second)', kind: 'number', min: 0.1, step: 0.5, placeholder: '4', when: is('kind', 'burner', '') },
  { key: 'on', label: 'Lit to begin with', kind: 'bool', when: is('kind', 'burner', '') },
];

// ------------------------------------------------------------------ lists edited in place

/** Folded sections stay folded (or open) across redraws. */
const openItems = new Set<string>();

function listEditor(o: {
  key: string;
  title: string;
  about: string;
  items: Item[];
  /** The list as it is now: edits are made to it, not to what was drawn. */
  current(): Item[];
  label(item: Item, index: number): string;
  fields: Field[];
  values?(item: Item): Values;
  /** Turn an edit into the list: the default sets the key on the item. Return null to refuse it. */
  commit?(items: Item[], index: number, key: string, value: unknown): Item[] | null;
  change(next: Item[], structural: boolean): void;
  make(): Item;
  ctx: FormContext;
  addLabel: string;
}): HTMLElement {
  const rows = o.items.map((item, index) => {
    const id = `${o.key}:${String(item.id ?? index)}`;
    const commit = (key: string, value: unknown, field: Field) => {
      const now = o.current();
      const next = o.commit
        ? o.commit(now, index, key, value)
        : now.map((x, i) => (i === index ? withKey(x, key, value) : x));
      if (next) o.change(next, field.structural === true || key.startsWith('_') || key === 'id');
    };
    const details = h(
      'details',
      { class: 'bench-item', open: openItems.has(id), 'data-bench-item': id },
      h('summary', null, o.label(item, index)),
      form(o.fields, o.values ? o.values(item) : (item as Values), commit, o.ctx),
      h('div', { class: 'row-actions' }, h('button', {
        type: 'button', class: 'danger',
        onclick: () => {
          if (!confirmDelete(`“${o.label(item, index)}”`)) return;
          o.change(o.current().filter((_, i) => i !== index), true);
        },
      }, 'Delete')),
    );
    details.addEventListener('toggle', () => (details.open ? openItems.add(id) : openItems.delete(id)));
    return details;
  });
  return h(
    'section',
    { 'data-section': o.key },
    h('div', { class: 'sub-head' }, h('span', null, o.title, help(o.about)), h('button', {
      type: 'button', class: 'link', 'data-add': o.key,
      onclick: () => {
        const made = o.make();
        openItems.add(`${o.key}:${String(made.id)}`);
        o.change([...o.current(), made], true);
      },
    }, o.addLabel)),
    rows.length ? h('div', { class: 'bench-list' }, ...rows) : h('p', { class: 'muted' }, 'None yet.'),
  );
}

/** An item with a key set, or taken out when it is left empty. */
function withKey<T extends object>(item: T, key: string, value: unknown): T {
  const next: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  if (value == null || value === '' || value === false) delete next[key];
  else next[key] = value;
  return next as T;
}

const NAME = /^[A-Za-z_]\w*$/;

/** Say why an edit is not taken, and take none of it. */
function refuse(message: string): null {
  toast(message, 'error');
  return null;
}

// ------------------------------------------------------------------ the bench

export function benchSettingsPanel(model: SceneModel, ctx: FormContext, host: BenchPanelHost): HTMLElement {
  const bench = model.bench();
  if (!bench) return gone();
  const now = () => model.bench() ?? bench;
  const write = (next: SceneBench, structural: boolean) => void model.setBench(next, structural);
  const substanceName = (id: unknown) => bench.substances?.find((s) => s.id === id)?.name ?? String(id ?? '');
  const vessel = (id: unknown) => {
    const v = bench.vessels?.find((x) => x.id === id);
    return v ? vesselName(v) : String(id ?? '');
  };

  const kits = select([['', '+ Add a ready-made set…'], ...Object.entries(BENCH_KITS).map(([key, kit]) => [key, kit.label] as const)], '', (key) => {
    kits.value = '';
    const kit = BENCH_KITS[key];
    if (!kit) return;
    write(withKit(now(), kit), true);
    toast(`Added: ${kit.label}. ${kit.about}`);
  });
  kits.setAttribute('aria-label', 'Add a ready-made set of substances and reactions');
  kits.dataset.benchKits = '';

  return h(
    'div',
    { class: 'panel', 'data-bench': 'settings' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Close-up bench', help(
      'An experiment worked with the hands: players pick a container up and tip it into another, light a burner, stir, and watch what happens. You say what there is (substances), where it stands (containers and tools, placed on the scene) and what happens when things meet (reactions). Readouts show what is measured; watches set variables and run events when something happens; a graph plots one reading against another.',
    ))),
    form([{ key: 'enabled', label: 'The bench is switched on in this scene', kind: 'bool', wide: true, structural: true }], bench as unknown as Values, (_key, value) => write({ ...now(), enabled: value === true }, true), ctx),
    form(SETTINGS_FIELDS, { ...(bench as unknown as Values), _reset: bench.controls?.reset !== false }, (key, value, field) => {
      if (key === '_reset') return write({ ...now(), controls: { ...now().controls, reset: value !== false } }, false);
      write(withKey(now() as unknown as Record<string, unknown>, key, value) as unknown as SceneBench, field.structural === true);
    }, ctx),
    h('div', { class: 'row-actions' }, kits),

    listEditor({
      key: 'substances', title: 'Substances', addLabel: '+ Add substance', ctx,
      about: 'Everything that can be in a container: liquids, solids and gases, each with a colour and, for acids and bases, a pH. Containers and reactions name them by their short names.',
      items: (bench.substances ?? []) as unknown as Item[],
      current: () => (now().substances ?? []) as unknown as Item[],
      label: (s) => `${String(s.name || s.id)}${s.formula ? ` (${String(s.formula)})` : ''} · ${String(s.id)}`,
      fields: SUBSTANCE_FIELDS,
      values: (s) => ({ ...s, _indicator: indicatorText(s.indicator) }),
      commit: (items, index, key, value) => {
        const item = items[index]!;
        if (key === 'id') {
          const id = String(value ?? '').trim();
          if (!NAME.test(id)) return refuse('A short name is letters, digits and _, starting with a letter: baking_soda.');
          if (items.some((x, i) => i !== index && x.id === id)) return refuse(`Another substance is already called ${id}.`);
          // Everything that names it follows; the list is written with the rest of the bench.
          write({ ...renamed(now(), 'substance', item.id, id), substances: items.map((x, i) => (i === index ? { ...x, id } : x)) as unknown as BenchSubstance[] }, true);
          return null;
        }
        if (key === '_indicator') {
          const stops = parseIndicator(String(value ?? ''));
          if (!stops) return refuse('Write an indicator’s colours as pH:colour pairs, like 1:#e53935, 7:#43a047.');
          return items.map((x, i) => (i === index ? withKey(x, 'indicator', stops.length ? stops : null) : x));
        }
        return items.map((x, i) => (i === index ? withKey(x, key, value) : x));
      },
      change: (next, structural) => void model.setBenchPart('substances', next as unknown as BenchSubstance[], structural),
      make: () => ({ id: freshBenchId(now(), 'substances', 'substance'), name: 'New substance', color: '#7cc4f0' }),
    }),

    listEditor({
      key: 'reactions', title: 'Reactions', addLabel: '+ Add reaction', ctx,
      about: 'What happens when the right things are in a container together. Only what is written here happens: two substances with no reaction simply mix.',
      items: (bench.reactions ?? []) as unknown as Item[],
      current: () => (now().reactions ?? []) as unknown as Item[],
      label: (r) => String(r.name || equationText(r as unknown as BenchReaction)),
      fields: REACTION_FIELDS,
      values: (r) => ({ ...r, _equation: equationText(r as unknown as BenchReaction) }),
      commit: (items, index, key, value) => {
        if (key !== '_equation') return items.map((x, i) => (i === index ? withKey(x, key, value) : x));
        const read = parseEquation(String(value ?? ''));
        if (!read) return refuse('Write it like: 2 vinegar + 1 baking_soda -> 2 salty_water + 6 co2');
        const known = new Set((now().substances ?? []).map((s) => s.id));
        const unknown = [...read.uses, ...read.makes].map((p) => p.substance).filter((s) => !known.has(s));
        if (unknown.length) toast(`Not a substance of this bench yet: ${[...new Set(unknown)].join(', ')}. Add ${unknown.length === 1 ? 'it' : 'them'} under Substances.`, 'error');
        return items.map((x, i) => (i === index ? { ...x, uses: read.uses, makes: read.makes } : x));
      },
      change: (next, structural) => void model.setBenchPart('reactions', next as unknown as BenchReaction[], structural),
      make: () => ({ id: freshBenchId(now(), 'reactions', 'reaction'), uses: [], makes: [], effect: 'bubbles' }),
    }),

    listEditor({
      key: 'readouts', title: 'Readouts', addLabel: '+ Add readout', ctx,
      about: 'Numbers shown beside the bench while it is worked: a volume, a temperature, a pH, how much gas was given off, or something worked out from those. Each can also be kept in a variable.',
      items: (bench.readouts ?? []) as unknown as Item[],
      current: () => (now().readouts ?? []) as unknown as Item[],
      label: (r) => {
        const m = BENCH_MEASURES[r.measure as keyof typeof BENCH_MEASURES];
        const of = r.substance && (r.measure === 'amount' || r.measure === 'released') ? ` of ${substanceName(r.substance)}` : '';
        const where = r.vessel_id && m?.vessel ? ` in ${vessel(r.vessel_id)}` : '';
        return `${String(r.label || m?.label || r.measure)}${r.label ? '' : `${of}${where}`}${r.variable ? ` → ${String(r.variable)}` : ''}`;
      },
      fields: READOUT_FIELDS,
      commit: (items, index, key, value) => {
        if (key !== 'id') return items.map((x, i) => (i === index ? withKey(x, key, value) : x));
        const id = String(value ?? '').trim();
        if (!NAME.test(id)) return refuse('A short name is letters, digits and _, starting with a letter.');
        if (id === 'time' || items.some((x, i) => i !== index && x.id === id)) return refuse(`Something is already called ${id}.`);
        write({ ...renamed(now(), 'readout', items[index]!.id, id), readouts: items.map((x, i) => (i === index ? { ...x, id } : x)) as never }, true);
        return null;
      },
      change: (next, structural) => void model.setBenchPart('readouts', next as never, structural),
      make: () => {
        const first = (now().vessels ?? []).find((v) => !v.supply);
        return { id: freshBenchId(now(), 'readouts', 'volume'), measure: 'volume', ...(first ? { vessel_id: first.id } : {}) };
      },
    }),

    listEditor({
      key: 'watches', title: 'Watches', addLabel: '+ Add watch', ctx,
      about: 'Something to notice while the bench is worked: a reaction happening, a reading passing a value, a container holding something or running over. When it happens, a variable is set and an indirect event of this scene runs: to tick off an objective, say something, or open a box.',
      items: (bench.watches ?? []) as unknown as Item[],
      current: () => (now().watches ?? []) as unknown as Item[],
      label: (w) => String(w.name || BENCH_WATCHES[w.when as keyof typeof BENCH_WATCHES] || w.when),
      fields: WATCH_FIELDS,
      change: (next, structural) => void model.setBenchPart('watches', next as never, structural),
      make: () => ({ id: freshBenchId(now(), 'watches', 'watch'), when: 'reaction' }),
    }),

    h('section', { 'data-section': 'graph' },
      h('div', { class: 'sub-head' }, h('span', null, 'Graph', help('A graph beside the bench: one reading against another, or against time. Players press Record to put a point on it for how things are now, so they choose what to measure and when.')),
        bench.graph
          ? h('button', { type: 'button', class: 'link danger', onclick: () => void model.setBenchPart('graph', null, true) }, 'Remove')
          : h('button', {
              type: 'button', class: 'link', 'data-add': 'graph',
              onclick: () => {
                const readouts = now().readouts ?? [];
                if (!readouts.length) return toast('Add a readout first: a graph plots readouts.', 'error');
                void model.setBenchPart('graph', { x: readouts.length > 1 ? readouts[0]!.id : 'time', y: readouts.at(-1)!.id }, true);
              },
            }, '+ Add a graph')),
      bench.graph
        ? form(GRAPH_FIELDS, bench.graph as unknown as Values, (key, value, field) => void model.setBenchPart('graph', withKey({ ...(now().graph ?? bench.graph!) }, key, value), field.structural === true), ctx)
        : h('p', { class: 'muted' }, 'None.')),

    h('div', { class: 'row-actions' }, h('button', {
      type: 'button', class: 'danger',
      onclick: async () => {
        if (!confirmDelete('this scene’s close-up bench and everything on it')) return;
        host.select({ kind: 'scene' });
        await model.setBench(null, true);
      },
    }, 'Delete the bench')),
  );
}

// ------------------------------------------------------------------ what is placed

export function benchVesselPanel(model: SceneModel, ctx: FormContext, index: number, host: BenchPanelHost): HTMLElement {
  const bench = model.bench();
  const vessel = bench?.vessels?.[index];
  if (!bench || !vessel) return gone();
  const shape = BENCH_SHAPES[vessel.shape ?? 'beaker'] ?? BENCH_SHAPES.beaker;
  // What a kind usually is shows where nothing was given.
  const fields = VESSEL_FIELDS.map((f) => (f.key === 'width' || f.key === 'height' || f.key === 'capacity' || f.key === 'pour' ? { ...f, placeholder: String(shape[f.key]) } : f));
  const commit = (key: string, value: unknown, field: Field) => {
    const list = [...(model.bench()?.vessels ?? [])];
    const current = list[index];
    if (!current) return;
    let next: BenchVessel;
    if (key === '_contents') {
      const parts = parseMix(String(value ?? ''));
      if (!parts) return toast('Write what is in it like: 50 water + 5 salt', 'error');
      const known = new Set((model.bench()?.substances ?? []).map((s) => s.id));
      const unknown = parts.map((p) => p.substance).filter((s) => !known.has(s));
      if (unknown.length) toast(`Not a substance of this bench yet: ${[...new Set(unknown)].join(', ')}. Add ${unknown.length === 1 ? 'it' : 'them'} in the bench’s settings.`, 'error');
      next = withKey(current, 'contents', parts.length ? parts : null);
    } else if (key === 'shape') {
      // Another kind of container: its usual size, unless sizes were given.
      const { width: _w, height: _h, capacity: _c, pour: _p, ...rest } = current;
      next = { ...rest, shape: value as BenchVessel['shape'] };
    } else if (key === 'label') next = value === false ? { ...current, label: false } : (withKey(current, 'label', null) as BenchVessel);
    else next = withKey(current, key, value);
    list[index] = next;
    void model.setBenchPart('vessels', list, field.structural === true || key.startsWith('_'));
  };
  return h(
    'div',
    { class: 'panel', 'data-bench': 'vessel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Container', help('Something that holds things: a beaker to mix in, a test tube, a stock bottle to pour from, a dropper. Players tap one to pick it up and tap another to tip it in. Drag it on the scene to move it.'))),
    form(fields, { ...(vessel as unknown as Values), _contents: mixText(vessel.contents) }, commit, ctx),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'link', onclick: () => host.select({ kind: 'bench' }) }, 'Substances and reactions…'),
      h('button', {
        type: 'button', class: 'danger',
        onclick: async () => {
          if (!confirmDelete(`“${vesselName(vessel)}”`)) return;
          host.select({ kind: 'bench' });
          const b = model.bench()!;
          // What named it lets go of it.
          await model.setBench({
            ...b,
            vessels: (b.vessels ?? []).filter((_, i) => i !== index),
            tools: b.tools?.map((t) => (t.vessel_id === vessel.id ? withKey(t, 'vessel_id', null) : t)),
            readouts: b.readouts?.filter((r) => r.vessel_id !== vessel.id),
            watches: b.watches?.map((w) => (w.vessel_id === vessel.id ? withKey(w, 'vessel_id', null) : w)),
          }, true);
        },
      }, 'Delete')),
  );
}

export function benchToolPanel(model: SceneModel, ctx: FormContext, index: number, host: BenchPanelHost): HTMLElement {
  const bench = model.bench();
  const tool = bench?.tools?.[index];
  if (!bench || !tool) return gone();
  const commit = (key: string, value: unknown, field: Field) => {
    const list = [...(model.bench()?.tools ?? [])];
    if (!list[index]) return;
    list[index] = key === 'kind' ? ({ id: list[index]!.id, kind: value as BenchTool['kind'], x: list[index]!.x, y: list[index]!.y } as BenchTool) : withKey(list[index]!, key, value);
    void model.setBenchPart('tools', list, field.structural === true);
  };
  return h(
    'div',
    { class: 'panel', 'data-bench': 'tool' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Tool', help('A burner heats the container that stands on it: players tap it to light it. A stirring rod is picked up and tapped on a container to stir it. A sink is where a container that is in the hand is emptied.'))),
    form(TOOL_FIELDS, tool as unknown as Values, commit, ctx),
    h('div', { class: 'row-actions' }, h('button', {
      type: 'button', class: 'danger',
      onclick: async () => {
        if (!confirmDelete(`“${tool.name || BENCH_TOOLS[tool.kind]?.label || 'this tool'}”`)) return;
        host.select({ kind: 'bench' });
        await model.setBenchPart('tools', (model.bench()?.tools ?? []).filter((_, i) => i !== index), true);
      },
    }, 'Delete')),
  );
}
