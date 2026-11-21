import { CALLOUT_TONES, embedBareMedia, escapeHtml, type CalloutTone } from '@qbl/shared';
import { sanitizeHtml } from './game';

/**
 * An infobox's content as the visual editor holds it: ordinary editable text (paragraphs,
 * headings, lists, links) with blocks between the paragraphs that are edited as a whole
 * (pictures, slideshows, videos, sounds, cards, callouts, answer boxes, page breaks).
 *
 * Content is stored as the HTML the game reads (see packages/shared/src/infobox.ts). It is
 * read here through the game's own sanitiser, so the editor never shows anything the game
 * would not, and written back from scratch, so what is saved is always tidy.
 */

export type PictureSize = 'small' | 'medium' | 'large';
export interface Slide {
  media: number | null;
  /** A picture given by address rather than from the media library. */
  src?: string;
  alt: string;
  caption: string;
}
export type Block =
  | { kind: 'picture'; media: number | null; src?: string; alt: string; caption: string; size: PictureSize }
  | { kind: 'video'; media: number | null; src?: string; autoplay: boolean; loop: boolean; caption: string }
  | { kind: 'audio'; media: number | null; src?: string; autoplay: boolean; loop: boolean }
  | { kind: 'gallery'; slides: Slide[] }
  | { kind: 'reveal'; prompt: string; html: string }
  | { kind: 'flip'; front: string; back: string }
  | { kind: 'callout'; tone: CalloutTone; html: string }
  | { kind: 'answer'; variable: string; placeholder: string }
  /** Sliders, switches, wheels, meters and `when` blocks: kept as their HTML, edited as HTML. */
  | { kind: 'controls'; html: string }
  | { kind: 'page' };
export type BlockKind = Block['kind'];

/** What a media id is (image, video, audio), from the scenario's media. */
export type MediaType = (id: number) => string | null | undefined;

const MEDIA = /\{\{\s*media:(\d+)\s*\}\}/g;
/**
 * While the editor holds content, `{{media:ID}}` in an address is written `qbl-media/ID`: the
 * sanitiser only lets ordinary addresses through, and the editor puts the real one in for show.
 */
const HELD = /(?:^|\/)qbl-media\/(\d+)$/;

/** The media id an element's address stands for, if it is one of the scenario's. */
export function heldMedia(el: Element): number | null {
  const own = el.getAttribute('data-rt-media');
  if (own && /^\d+$/.test(own)) return Number(own);
  const m = HELD.exec(el.getAttribute('src') ?? '');
  return m ? Number(m[1]) : null;
}

/** Made in a document of their own, the nodes load nothing until they are put on the page. */
let inert: Document | null = null;

/**
 * Author HTML, cleaned as the game cleans it, as nodes to edit. The nodes belong to an inert
 * document: point their pictures at real addresses before putting them on the page.
 */
export function parse(html: string, typeOf: MediaType): DocumentFragment {
  inert ??= document.implementation.createHTMLDocument('');
  return sanitizeHtml(embedBareMedia(html ?? '', typeOf).replace(MEDIA, 'qbl-media/$1'), inert);
}

const only = (el: Element, selector: string): Element | null => {
  const kids = [...el.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !(n.textContent ?? '').trim()) && !(n instanceof HTMLBRElement));
  return kids.length === 1 && kids[0] instanceof Element && kids[0].matches(selector) ? kids[0] : null;
};
const sizeOf = (...els: Array<Element | null | undefined>): PictureSize => {
  for (const e of els) {
    const s = e?.getAttribute('data-size');
    if (s === 'small' || s === 'medium' || s === 'large') return s;
  }
  return 'large';
};
const srcOf = (el: Element) => (heldMedia(el) == null ? el.getAttribute('src') ?? undefined : undefined);

/** The block a top-level node is, or null when it is ordinary text to edit. */
export function blockOf(node: Node): Block | null {
  if (!(node instanceof Element)) return null;
  const kind = node.getAttribute('data-qbl');
  const tag = node.tagName.toLowerCase();
  if (tag === 'hr' && kind === 'page') return { kind: 'page' };
  if (tag === 'div' && kind === 'gallery') {
    const slides = [...node.querySelectorAll('img')].map((img) => ({
      media: heldMedia(img), src: srcOf(img), alt: img.getAttribute('alt') ?? '', caption: img.closest('figure')?.querySelector('figcaption')?.textContent?.trim() ?? '',
    }));
    return { kind: 'gallery', slides };
  }
  if (tag === 'details') {
    const summary = node.querySelector(':scope > summary');
    const rest = [...node.childNodes].filter((n) => n !== summary);
    return { kind: 'reveal', prompt: summary?.textContent?.trim() ?? '', html: serialize(rest) };
  }
  if (tag === 'div' && kind === 'flip') {
    const [front, back] = [...node.children];
    return { kind: 'flip', front: front ? serialize([...front.childNodes]) : '', back: back ? serialize([...back.childNodes]) : '' };
  }
  if (tag === 'div' && kind === 'callout') {
    const tone = node.getAttribute('data-tone');
    return { kind: 'callout', tone: tone && tone in CALLOUT_TONES ? (tone as CalloutTone) : 'tip', html: serialize([...node.childNodes]) };
  }
  if (tag === 'input' && kind === 'answer') return { kind: 'answer', variable: node.getAttribute('data-var') ?? '', placeholder: node.getAttribute('placeholder') ?? '' };
  if ((tag === 'div' && ['panel', 'wheel', 'meter', 'when'].includes(kind ?? '')) || (tag === 'input' && (kind === 'slider' || kind === 'switch'))) {
    return { kind: 'controls', html: controlsHtml(node) };
  }
  if (tag === 'figure') {
    const caption = node.querySelector('figcaption')?.textContent?.trim() ?? '';
    const img = node.querySelector('img');
    if (img) return { kind: 'picture', media: heldMedia(img), src: srcOf(img), alt: img.getAttribute('alt') ?? '', caption, size: sizeOf(node, img) };
    const video = node.querySelector('video');
    if (video) return { kind: 'video', media: heldMedia(video), src: srcOf(video), autoplay: video.hasAttribute('autoplay'), loop: video.hasAttribute('loop'), caption };
    return null;
  }
  if (tag === 'img') return { kind: 'picture', media: heldMedia(node), src: srcOf(node), alt: node.getAttribute('alt') ?? '', caption: '', size: sizeOf(node) };
  if (tag === 'video') return { kind: 'video', media: heldMedia(node), src: srcOf(node), autoplay: node.hasAttribute('autoplay'), loop: node.hasAttribute('loop'), caption: '' };
  if (tag === 'audio') return { kind: 'audio', media: heldMedia(node), src: srcOf(node), autoplay: node.hasAttribute('autoplay'), loop: node.hasAttribute('loop') };
  // A paragraph holding nothing but a picture, a video, a sound or an answer box is that thing.
  if (tag === 'p') {
    const inner = only(node, 'img, video, audio, input[data-qbl="answer"], input[data-qbl="slider"], input[data-qbl="switch"]');
    if (inner) return blockOf(inner);
  }
  return null;
}

/** A control's HTML as the game reads it: as the sanitiser left it, its media placeholders put back. */
function controlsHtml(node: Element): string {
  const copy = node.cloneNode(true) as Element;
  // The sanitiser gives inputs their type; the game gives it again.
  for (const input of [copy, ...copy.querySelectorAll('input')]) if (input.tagName === 'INPUT' && input.getAttribute('data-qbl') !== 'answer') input.removeAttribute('type');
  return copy.outerHTML.replace(/(?:^|\/)?qbl-media\/(\d+)/g, '{{media:$1}}');
}

// ------------------------------------------------------------------ writing

const attr = (name: string, value: string | number | null | undefined | boolean) =>
  value == null || value === false || value === '' ? '' : value === true ? ` ${name}` : ` ${name}="${escapeHtml(String(value))}"`;
const mediaSrc = (media: number | null, src?: string) => (media != null ? `{{media:${media}}}` : (src ?? ''));
const text = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** A block as the HTML the game reads. */
export function blockHtml(b: Block): string {
  switch (b.kind) {
    case 'page':
      return '<hr data-qbl="page">';
    case 'picture':
      return `<figure${attr('data-size', b.size === 'large' ? null : b.size)}><img${attr('src', mediaSrc(b.media, b.src))}${attr('alt', b.alt)}>${b.caption ? `<figcaption>${text(b.caption)}</figcaption>` : ''}</figure>`;
    case 'video': {
      const video = `<video${attr('src', mediaSrc(b.media, b.src))}${attr('autoplay', b.autoplay)}${attr('muted', b.autoplay)}${attr('loop', b.loop)}></video>`;
      return b.caption ? `<figure>${video}<figcaption>${text(b.caption)}</figcaption></figure>` : video;
    }
    case 'audio':
      return `<audio${attr('src', mediaSrc(b.media, b.src))}${attr('autoplay', b.autoplay)}${attr('loop', b.loop)}></audio>`;
    case 'gallery':
      return `<div data-qbl="gallery">${b.slides.map((s) => `<figure><img${attr('src', mediaSrc(s.media, s.src))}${attr('alt', s.alt)}>${s.caption ? `<figcaption>${text(s.caption)}</figcaption>` : ''}</figure>`).join('')}</div>`;
    case 'reveal':
      return `<details><summary>${text(b.prompt || 'Tap to reveal')}</summary>${b.html}</details>`;
    case 'flip':
      return `<div data-qbl="flip"><div>${b.front}</div><div>${b.back}</div></div>`;
    case 'callout':
      return `<div data-qbl="callout" data-tone="${b.tone}">${b.html}</div>`;
    case 'answer':
      return `<input data-qbl="answer"${attr('data-var', b.variable)}${attr('placeholder', b.placeholder)}>`;
    case 'controls':
      return b.html;
  }
}

/** Tags kept as they are when content is written; any other element is replaced by what is in it. */
const KEEP: Record<string, string[]> = {
  p: [], h1: [], h2: [], h3: [], h4: [], b: [], strong: [], i: [], em: [], u: [], s: [], del: [], mark: [], small: [], sub: [], sup: [], code: [], pre: [],
  blockquote: [], ul: [], ol: [], li: [], br: [], hr: [], a: ['href', 'title'], table: [], thead: [], tbody: [], tr: [], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'],
  img: ['alt', 'width', 'height', 'data-size'], div: [],
};
const VOID = new Set(['br', 'hr', 'img', 'input']);

/**
 * Content as HTML. `blocks` are the editor's blocks among the nodes; the rest is written from
 * what it is now, which tidies away whatever the browser added while it was edited.
 */
export function serialize(nodes: Iterable<Node>, blocks?: Map<Element, Block>): string {
  let out = '';
  for (const n of nodes) {
    // Between the editor's blocks, an empty paragraph is only somewhere for the cursor.
    if (blocks && n instanceof HTMLParagraphElement && !(n.textContent ?? '').trim() && !n.querySelector('img, .rt-var, input')) continue;
    out += write(n, blocks);
  }
  // A trailing empty paragraph is where the cursor waits; it is not content.
  return out.replace(/(<p>(<br>|\s|&nbsp;)*<\/p>)+$/, '').trim();
}

function write(n: Node, blocks?: Map<Element, Block>): string {
  // The browser types a space at the end of a line as a no-break space; it is an ordinary one.
  if (n.nodeType === Node.TEXT_NODE) return text((n.textContent ?? '').replace(/\u00a0/g, ' '));
  if (!(n instanceof Element)) return '';
  const block = blocks?.get(n);
  if (block) return blockHtml(block);
  if (n.classList.contains('rt-var')) return `{{${n.getAttribute('data-var-chip')}}}`;
  if (n.classList.contains('rt-ui')) return '';
  const tag = n.tagName.toLowerCase();
  const inner = () => [...n.childNodes].map((c) => write(c, blocks)).join('');
  // Without the editor's blocks (inside a card or a callout) these are written as the game reads them.
  if (!blocks) {
    const b = blockOf(n);
    if (b && tag !== 'p') return blockHtml(b);
  }
  if (tag === 'span') {
    if (n.getAttribute('data-qbl') === 'word' && n.getAttribute('data-word')) return `<span data-qbl="word"${attr('data-word', n.getAttribute('data-word'))}>${inner()}</span>`;
    if (n.getAttribute('data-qbl') === 'value' && n.getAttribute('data-var')) return `<span data-qbl="value"${attr('data-var', n.getAttribute('data-var'))}></span>`;
    return inner();
  }
  if (tag === 'hr' && n.getAttribute('data-qbl') === 'page') return '<hr data-qbl="page">';
  const keep = KEEP[tag];
  if (!keep) return inner();
  let attrs = '';
  if (tag === 'img') attrs += attr('src', mediaSrc(heldMedia(n), n.getAttribute('data-rt-src') ?? n.getAttribute('src') ?? undefined));
  for (const name of keep) attrs += attr(name, n.getAttribute(name));
  if (VOID.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${inner()}</${tag}>`;
}

/** The plain words of some HTML, for a block's summary. */
export function words(html: string, max = 80): string {
  const t = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
