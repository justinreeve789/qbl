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
 * Everything here is free of the DOM, so the validator and the server-side tools can use it.
 */

/** The `data-qbl` kinds the game knows. */
export const INFOBOX_BLOCKS = ['page', 'gallery', 'flip', 'callout', 'answer', 'word', 'panel', 'slider', 'switch', 'wheel', 'value', 'meter', 'when'] as const;

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
  /** Variables shown or tested (values, meters, `when` blocks). */
  reads: string[];
  /** How many pages the box has. */
  pages: number;
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
  const controls = [...new Set(varsOf([...INFOBOX_CONTROLS]))];
  const tested = tagsOf(text, 'when').flatMap((t) => parseWhen(attr(t, 'data-when') ?? '').map((c) => c.variable));
  const reads = [...new Set([...varsOf(['value', 'meter']), ...tested])];
  return { media, answers, words, controls, reads, pages: tagsOf(text, 'page').length + 1 };
}

/** A condition of a `when` block: `name op value`. */
export interface WhenCondition {
  variable: string;
  operator: '=' | '!=' | '<' | '>' | '<=' | '>=';
  operand: string | number;
}

/**
 * A `when` block's conditions, from `data-when`: separated by `;` (or `,`), each `name op value`
 * with op one of = != < > <= >=. A value that reads as a number is one. Parts that do not read are
 * left out.
 */
export function parseWhen(spec: string): WhenCondition[] {
  const out: WhenCondition[] = [];
  for (const part of spec.split(/[;,]/)) {
    const m = /^\s*([A-Za-z_]\w*)\s*(!=|<=|>=|=|<|>)\s*(.*?)\s*$/.exec(part);
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
