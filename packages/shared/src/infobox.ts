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
 * Everything here is free of the DOM, so the validator and the server-side tools can use it.
 */

/** The `data-qbl` kinds the game knows. */
export const INFOBOX_BLOCKS = ['page', 'gallery', 'flip', 'callout', 'answer', 'word'] as const;
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
  return [...html.matchAll(/<[a-z][^>]*\sdata-qbl\s*=\s*["']?([a-z_]+)["']?[^>]*>/gi)].filter((m) => m[1]!.toLowerCase() === kind).map((m) => m[0]);
}

export function infoboxRefs(html: string | null | undefined): InfoboxRefs {
  const text = html ?? '';
  const media = [...new Set([...text.matchAll(MEDIA)].map((m) => Number(m[1])))];
  const answers = [...new Set(tagsOf(text, 'answer').map((t) => attr(t, 'data-var')?.trim() ?? '').filter(Boolean))];
  const words = [...new Set(tagsOf(text, 'word').map((t) => attr(t, 'data-word')?.trim() ?? '').filter(Boolean))];
  return { media, answers, words, pages: tagsOf(text, 'page').length + 1 };
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
