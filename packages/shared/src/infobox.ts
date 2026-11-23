/**
 * [ext] Rich infobox content. An infobox's `content` stays one string of HTML, so a scenario
 * written for the original spec still plays and an author can still type HTML by hand. Richer
 * things are ordinary HTML marked with `data-qbl`, which the game turns into something to play
 * with and any other reader shows as plain HTML:
 *
 *   <hr data-qbl="page">                       a new page: the box steps through its pages
 *   <div data-qbl="gallery"> <figure>… </div>  a slideshow of pictures, swiped or stepped through
 *   <details><summary>Q</summary> A </details> a card that opens to show what it hides
 *   <div data-qbl="flip"> <div>front</div> <div>back</div> </div>   a card that turns over
 *   <div data-qbl="callout" data-tone="tip">   a coloured note: tip, fact, warn or think
 *   <input data-qbl="answer" data-var="name">  a box to type in; saved in the variable on a button
 *   <span data-qbl="word" data-word="ID">      a glossary word: tapped, it says what it means
 *   <img>, <video>, <audio> with src="{{media:ID}}"
 *
 * Controls, for hands-on instruments with many parts side by side. Each has a variable
 * (`data-var`) its value is saved in when a button of the box is chosen, before the button's
 * action runs, as an answer box's is; until then the box shows what they would do:
 *
 *   <div data-qbl="panel">                     a bench: what is in it stands side by side
 *   <input data-qbl="slider" data-var="v" data-min="0" data-max="10" data-step="1"
 *          data-value="5" data-unit="cm" data-label="Rope">   a number, set by sliding
 *   <input data-qbl="switch" data-var="v" data-label="Battery">  on (1) or off (0)
 *   <div data-qbl="wheel" data-var="v" data-options="Sun|Rain|Wind" data-label="Weather">
 *                                               a wheel of chance, spun by the player: lands on
 *                                               one of its options (repeat one to make it likelier);
 *                                               data-value shows where it last landed
 *   <span data-qbl="value" data-var="v">        a control's value as it is now (or a variable's)
 *   <div data-qbl="meter" data-var="v" data-min="0" data-max="10" data-label="Light">   a bar
 *   <div data-qbl="when" data-when="v >= 4; battery = 1">   shown only while all of these hold, on
 *                                               the controls as they are now and on variables
 *
 * Science and maths. Formulas are worked out with math.js (see formula.ts), typeset with KaTeX
 * and drawn with JSXGraph; each is loaded only by a box that has one:
 *
 *   <span data-qbl="math" data-tex="E = mc^2">E = mc^2</span>   typeset maths in a line of text
 *   <div data-qbl="math" data-tex="\ce{2H2 + O2 -> 2H2O}">…</div>   typeset on a line of its own;
 *                                               \ce{…} sets chemistry. What is inside the tag is
 *                                               what a reader without KaTeX shows.
 *   <span data-qbl="calc" data-formula="mass / volume" data-digits="2" data-unit="g/mL"
 *         data-var="density">                   a formula's value, from the controls as they are now
 *                                               and from variables; with data-var it is saved there
 *                                               when a button is chosen
 *   <input data-qbl="answer" data-var="a" data-accept="9.8 m/s^2" data-tolerance="2%"
 *          data-check="a_right">                an answer box that is checked: data-check is set to 1
 *                                               (right) or 0 when a button is chosen. A quantity is
 *                                               right in any unit of its kind (980 cm/s^2)
 *   <div data-qbl="graph" data-fn="a*x^2; sin(x)" data-x="-5,5" data-y="-5,5"
 *        data-points="px,py=1,2; qx,qy=3,1" data-join="line" data-snap="1"
 *        data-series="log" data-xlabel="Time (s)" data-ylabel="Height (m)" data-label="Title">
 *                                               axes with curves (formulas of x; other names are
 *                                               controls and variables, so curves follow sliders),
 *                                               points the player drags (each saved in its two
 *                                               variables when a button is chosen), joined or not,
 *                                               and recorded data kept in a variable as "x,y;x,y"
 *
 * Everything here is free of the DOM, so the validator and the server-side tools can use it.
 */

import { isMultiple } from './variables.js';

/** The `data-qbl` kinds the game knows. */
export const INFOBOX_BLOCKS = ['page', 'gallery', 'flip', 'callout', 'answer', 'word', 'panel', 'slider', 'switch', 'wheel', 'value', 'meter', 'when', 'math', 'calc', 'graph'] as const;

/** The controls: what the player sets, each saved in its variable when a button is chosen. */
export const INFOBOX_CONTROLS = ['slider', 'switch', 'wheel'] as const;
export type InfoboxControl = (typeof INFOBOX_CONTROLS)[number];
export type InfoboxBlock = (typeof INFOBOX_BLOCKS)[number];

/** The tones of a callout, with the icon each is drawn with. */
export const CALLOUT_TONES = { tip: '💡', fact: '🔎', warn: '⚠️', think: '🤔' } as const;
export type CalloutTone = keyof typeof CALLOUT_TONES;

/** How wide an infobox is. */
export const INFOBOX_SIZES = ['small', 'medium', 'large'] as const;
export type InfoboxSize = (typeof INFOBOX_SIZES)[number];

/**
 * How an infobox button behaves when it is chosen. `right` and `wrong` show the answer was
 * right or wrong before the box closes; `try_again` shows it was wrong and leaves the box open
 * so the player can choose again.
 */
export const BUTTON_MARKS = ['right', 'wrong', 'try_again'] as const;
export type ButtonMark = (typeof BUTTON_MARKS)[number];

/** How long a marked button shows its mark before the box goes on, in milliseconds. */
export const MARK_MS = 650;

/** What an infobox's content refers to, read from its HTML. */
export interface InfoboxRefs {
  /** `{{media:ID}}` placeholders, in order, without repeats. */
  media: number[];
  /** Variables answer boxes write to. */
  answers: string[];
  /** Glossary entry ids of tappable words. */
  words: string[];
  /** Variables controls (sliders, switches, wheels) write to. */
  controls: string[];
  /** Variables shown or tested (values, meters, `when` blocks, formulas, curves, recorded data). */
  reads: string[];
  /** Variables the box also saves to: dragged graph points, worked-out values, whether a checked answer was right. */
  writes: string[];
  /** How many pages the box has. */
  pages: number;
  /** Formulas (calc blocks, graph curves, answers to accept) that could not be read at a glance: unbalanced brackets, nothing in them. */
  problems: string[];
  /** Whether the box needs math.js, KaTeX or JSXGraph. */
  uses: { formula: boolean; math: boolean; graph: boolean };
}

const MEDIA = /\{\{\s*media:(\d+)\s*\}\}/g;

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/** The opening tags in some HTML whose `data-qbl` is `kind`. */
function tagsOf(html: string, kind: InfoboxBlock): string[] {
  // A tag runs to the first ">" outside quotes: a `when` block's conditions may hold one.
  return [...html.matchAll(/<[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /\sdata-qbl\s*=/i.test(tag) && (attr(tag, 'data-qbl') ?? '').toLowerCase() === kind);
}

export function infoboxRefs(html: string | null | undefined): InfoboxRefs {
  const text = html ?? '';
  const media = [...new Set([...text.matchAll(MEDIA)].map((m) => Number(m[1])))];
  const answers = [...new Set(tagsOf(text, 'answer').map((t) => attr(t, 'data-var')?.trim() ?? '').filter(Boolean))];
  const words = [...new Set(tagsOf(text, 'word').map((t) => attr(t, 'data-word')?.trim() ?? '').filter(Boolean))];
  const varsOf = (kinds: InfoboxBlock[]) => kinds.flatMap((k) => tagsOf(text, k).map((t) => attr(t, 'data-var')?.trim() ?? '')).filter(Boolean);
  const problems: string[] = [];
  const names = (source: string | null, what: string, skip: string[] = []): string[] => {
    const src = (source ?? '').trim();
    if (!src) return [];
    const problem = formulaGlance(src);
    if (problem) problems.push(`${what} “${src}”: ${problem}`);
    return formulaNames(src).filter((n) => !skip.includes(n));
  };
  const calcs = tagsOf(text, 'calc');
  const graphs = tagsOf(text, 'graph').map((t) => graphSpec((name) => attr(t, name)));
  const checked = tagsOf(text, 'answer').filter((t) => attr(t, 'data-accept') != null);
  const controls = [...new Set(varsOf([...INFOBOX_CONTROLS]))];
  const writes = [...new Set([
    ...varsOf(['calc']),
    ...graphs.flatMap((g) => g.points.flatMap((p) => [p.xVar, p.yVar])),
    ...checked.map((t) => attr(t, 'data-check')?.trim() ?? '').filter(Boolean),
  ])];
  for (const t of calcs) if (!(attr(t, 'data-formula') ?? '').trim()) problems.push('A calc block has no formula');
  const tested = tagsOf(text, 'when').flatMap((t) => parseWhen(attr(t, 'data-when') ?? '').map((c) => c.variable));
  const reads = [...new Set([
    ...varsOf(['value', 'meter']), ...tested,
    ...calcs.flatMap((t) => names(attr(t, 'data-formula'), 'The formula')),
    ...graphs.flatMap((g) => [...g.functions.flatMap((f) => names(f, 'The curve', ['x'])), ...(g.series ? [g.series] : [])]),
  ])];
  const maths = tagsOf(text, 'math');
  return {
    media, answers, words, controls, reads, writes, pages: tagsOf(text, 'page').length + 1, problems,
    uses: { formula: calcs.length > 0 || checked.length > 0 || graphs.some((g) => g.functions.length > 0), math: maths.length > 0, graph: graphs.length > 0 },
  };
}

// ------------------------------------------------------------------ formulas, at a glance

/** Words of a formula that are math.js's own, not names to look up. */
const MATH_WORDS = new Set([
  'pi', 'e', 'tau', 'phi', 'i', 'Infinity', 'NaN', 'true', 'false', 'null', 'and', 'or', 'not', 'xor', 'mod', 'to', 'in',
  // Units an author is likely to write in a formula; any other unit only earns a warning.
  'm', 'cm', 'mm', 'km', 'g', 'kg', 'mg', 's', 'min', 'h', 'ms', 'L', 'l', 'mL', 'ml', 'N', 'J', 'W', 'Pa', 'K', 'degC', 'degF', 'mol', 'V', 'A', 'ohm', 'Hz', 'deg', 'rad',
]);

/**
 * The names a formula reads, found without math.js (which the validator does not load): every
 * word that is not a function being called, a constant or a common unit.
 */
export function formulaNames(source: string): string[] {
  const out = new Set<string>();
  const text = source.replace(/"[^"]*"|'[^']*'/g, ' ');
  for (const m of text.matchAll(/[A-Za-z_]\w*/g)) {
    const after = text.slice(m.index + m[0].length).trimStart();
    const before = text.slice(0, m.index);
    // 1e5 is a number, not the name e5; a.b reads a, not b.
    if (/\d\.?$/.test(before) && /^[eE]\d*$/.test(m[0])) continue;
    if (before.endsWith('.')) continue;
    if (after.startsWith('(') || MATH_WORDS.has(m[0])) continue;
    out.add(m[0]);
  }
  return [...out];
}

/** What is plainly wrong with a formula, seen without math.js: brackets that do not match. Null when nothing is. */
export function formulaGlance(source: string): string | null {
  let depth = 0;
  for (const ch of source.replace(/"[^"]*"|'[^']*'/g, '')) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (depth < 0) return 'a bracket is closed that was never opened';
  }
  return depth > 0 ? 'a bracket is never closed' : null;
}

// ------------------------------------------------------------------ graphs

/** How a graph's points are joined, in the order they are written. */
export const GRAPH_JOINS = ['none', 'line', 'segment', 'polygon'] as const;
export type GraphJoin = (typeof GRAPH_JOINS)[number];

/** A point of a graph the player drags: saved in two variables. */
export interface GraphPoint {
  xVar: string;
  yVar: string;
  x: number;
  y: number;
}

/** A graph block, read from its attributes. */
export interface GraphSpec {
  /** Formulas of x, one curve each. */
  functions: string[];
  x: [min: number, max: number];
  y: [min: number, max: number];
  points: GraphPoint[];
  join: GraphJoin;
  /** A variable holding recorded data as "x,y;x,y". */
  series: string | null;
  /** Dragged points land on multiples of this (0: anywhere). */
  snap: number;
  xLabel: string;
  yLabel: string;
  label: string;
}

function range(spec: string | null, fallback: [number, number]): [number, number] {
  const [a, b] = (spec ?? '').split(',').map((v) => Number(v.trim()));
  return a != null && b != null && Number.isFinite(a) && Number.isFinite(b) && a < b ? [a, b] : fallback;
}

/** A graph block's settings, from its attributes (`get('data-fn')` and so on). */
export function graphSpec(get: (name: string) => string | null | undefined): GraphSpec {
  const points: GraphPoint[] = [];
  for (const part of (get('data-points') ?? '').split(';')) {
    const m = /^\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*(?:=\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?))?\s*$/.exec(part);
    if (m && m[1] !== m[2]) points.push({ xVar: m[1]!, yVar: m[2]!, x: Number(m[3] ?? 0), y: Number(m[4] ?? 0) });
  }
  const join = (get('data-join') ?? '').trim().toLowerCase();
  const series = (get('data-series') ?? '').trim();
  const snap = Number(get('data-snap') ?? 0);
  return {
    functions: (get('data-fn') ?? '').split(';').map((f) => f.trim()).filter(Boolean),
    x: range(get('data-x') ?? null, [-10, 10]),
    y: range(get('data-y') ?? null, [-10, 10]),
    points,
    join: (GRAPH_JOINS as readonly string[]).includes(join) ? (join as GraphJoin) : 'none',
    series: /^[A-Za-z_]\w*$/.test(series) ? series : null,
    snap: Number.isFinite(snap) && snap > 0 ? snap : 0,
    xLabel: (get('data-xlabel') ?? '').trim(),
    yLabel: (get('data-ylabel') ?? '').trim(),
    label: (get('data-label') ?? '').trim(),
  };
}

/** The most points a recorded series keeps: older ones make way. */
export const SERIES_MAX = 300;

/** Recorded data as it is kept in a variable: "x,y;x,y". What does not read as a pair of numbers is left out. */
export function parseSeries(text: unknown): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const part of String(text ?? '').split(';')) {
    const [a, b, ...rest] = part.split(',');
    const x = Number(a);
    const y = Number(b);
    if (rest.length === 0 && a?.trim() && b?.trim() && Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

/** Recorded data as text for a variable, each number to three decimal places at most. */
export function seriesText(points: Array<[number, number]>): string {
  const n = (v: number) => String(Math.round(v * 1000) / 1000);
  return points.slice(-SERIES_MAX).map(([x, y]) => `${n(x)},${n(y)}`).join(';');
}

/** A condition of a `when` block: `name op value`. */
export interface WhenCondition {
  variable: string;
  operator: '=' | '!=' | '<' | '>' | '<=' | '>=' | '%' | '!%';
  operand: string | number;
}

/**
 * A `when` block's conditions, from `data-when`: separated by `;` (or `,`), each `name op value`
 * with op one of = != < > <= >= % !% (`%`: a whole multiple of the value; `!%`: not one). A value that reads as a number is one. Parts that do not read are
 * left out.
 */
export function parseWhen(spec: string): WhenCondition[] {
  const out: WhenCondition[] = [];
  for (const part of spec.split(/[;,]/)) {
    const m = /^\s*([A-Za-z_]\w*)\s*(!%|!=|<=|>=|=|<|>|%)\s*(.*?)\s*$/.exec(part);
    if (!m) continue;
    out.push({ variable: m[1]!, operator: m[2] as WhenCondition['operator'], operand: answerValue(m[3]!.replace(/^["']|["']$/g, '')) });
  }
  return out;
}

/** Whether every condition holds, reading values with `get`. Numbers compare as numbers; text by equality. */
export function testWhen(conditions: WhenCondition[], get: (name: string) => unknown): boolean {
  return conditions.every((c) => {
    const raw = get(c.variable);
    const value = typeof raw === 'string' ? answerValue(raw) : raw;
    const a = typeof value === 'number' ? value : typeof value === 'boolean' ? Number(value) : value ?? '';
    const b = c.operand;
    if (c.operator === '=') return String(a) === String(b);
    if (c.operator === '!=') return String(a) !== String(b);
    const x = Number(a);
    const y = Number(b);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (c.operator === '%') return isMultiple(x, y);
    if (c.operator === '!%') return y !== 0 && !isMultiple(x, y);
    return c.operator === '<' ? x < y : c.operator === '>' ? x > y : c.operator === '<=' ? x <= y : x >= y;
  });
}

/** A wheel's options, from `data-options` (separated by `|`). */
export function wheelOptions(spec: string | null | undefined): string[] {
  return (spec ?? '').split('|').map((o) => o.trim()).filter(Boolean);
}

/** Point every `{{media:ID}}` in a text at another id. Ids `map` returns null for are left as they are. */
export function remapMediaPlaceholders(text: string, map: (id: number) => number | null | undefined): string {
  return text.replace(MEDIA, (whole, id: string) => {
    const to = map(Number(id));
    return to == null ? whole : `{{media:${to}}}`;
  });
}

/**
 * A `{{media:ID}}` written on its own in the text, not inside a tag (as the editor's hint once
 * suggested), shows the media itself rather than its address: a picture, a video or a sound.
 * `typeOf` says what the media is; placeholders it does not know are left as they are.
 */
export function embedBareMedia(html: string, typeOf: (id: number) => 'image' | 'video' | 'audio' | string | null | undefined): string {
  if (!html.includes('{{')) return html;
  return html.split(/(<[^>]*>)/).map((part) => {
    if (part.startsWith('<')) return part;
    return part.replace(MEDIA, (whole, id: string) => {
      const type = typeOf(Number(id));
      if (type === 'image') return `<img src="${whole}" alt="">`;
      if (type === 'video') return `<video src="${whole}"></video>`;
      if (type === 'audio') return `<audio src="${whole}"></audio>`;
      return whole;
    });
  }).join('');
}

/** An answer typed into an answer box, as it is saved: a number when it reads as one, otherwise trimmed text. */
export function answerValue(typed: string): string | number {
  const t = typed.trim();
  return t !== '' && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}
