import { CALLOUT_TONES, INFOBOX_BLOCKS } from '@qbl/shared';

/**
 * Infobox content is HTML written by scenario authors. It is rebuilt from an
 * allowlist before it reaches the page, so a compromised or careless author
 * account cannot run script in students' browsers. Styles, classes and event
 * handlers never survive; the richer parts of a box are marked with `data-qbl`
 * (see packages/shared/src/infobox.ts) and drawn by ui/infobox/content.ts.
 */
const TAGS = new Set([
  'a', 'audio', 'b', 'blockquote', 'br', 'code', 'del', 'details', 'div', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'hr', 'i', 'img', 'input', 'li',
  'mark', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul', 'video',
]);
const ATTRS: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height', 'data-size'],
  figure: ['data-size'],
  video: ['src', 'poster', 'loop', 'muted', 'autoplay', 'title'],
  audio: ['src', 'loop', 'autoplay', 'title'],
  details: ['open'],
  input: ['placeholder', 'data-var', 'maxlength', 'inputmode', 'aria-label', 'data-min', 'data-max', 'data-step', 'data-value', 'data-unit', 'data-label'],
  span: ['data-word', 'data-var'],
  div: ['data-var', 'data-options', 'data-value', 'data-label', 'data-min', 'data-max', 'data-unit', 'data-when', 'data-spins'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
};
/** Which element each `data-qbl` kind may be on. */
const BLOCK_TAGS: Record<string, string[]> = {
  page: ['hr'], gallery: ['div'], flip: ['div'], callout: ['div'], answer: ['input'], word: ['span'],
  panel: ['div'], slider: ['input'], switch: ['input'], wheel: ['div'], value: ['span'], meter: ['div'], when: ['div'],
};
/** Attributes only a control (or what shows one) may carry. */
const CONTROL_ATTRS = new Set(['data-min', 'data-max', 'data-step', 'data-value', 'data-unit', 'data-label', 'data-options', 'data-when', 'data-spins']);
const SIZES = new Set(['small', 'medium', 'large']);
const SAFE_URL = /^(https?:|mailto:|\/(?!\/)|\.{0,2}\/|[^:]*$)/i;
const URL_ATTRS = new Set(['href', 'src', 'poster']);

function copy(source: Node, target: Node, doc: Document) {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(doc.createTextNode(child.textContent ?? ''));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'embed', 'template', 'textarea', 'select', 'button', 'form'].includes(tag)) continue;
    if (!TAGS.has(tag)) {
      copy(el, target, doc); // keep the text of unknown wrappers
      continue;
    }
    const kind = el.getAttribute('data-qbl')?.trim().toLowerCase() ?? '';
    const block = (INFOBOX_BLOCKS as readonly string[]).includes(kind) && BLOCK_TAGS[kind]!.includes(tag) ? kind : null;
    // The only inputs there are: an answer box, a slider and a switch.
    if (tag === 'input' && block !== 'answer' && block !== 'slider' && block !== 'switch') continue;
    const out = doc.createElement(tag);
    if (block) out.setAttribute('data-qbl', block);
    for (const name of ATTRS[tag] ?? []) {
      const value = el.getAttribute(name);
      if (value == null) continue;
      if (URL_ATTRS.has(name) && !SAFE_URL.test(value.trim())) continue;
      if (name === 'data-size' && !SIZES.has(value)) continue;
      if (name === 'data-var' && !/^[A-Za-z_]\w*$/.test(value)) continue;
      if (name === 'data-word' && block !== 'word') continue;
      if (name === 'data-var' && tag !== 'input' && !['wheel', 'value', 'meter'].includes(block ?? '')) continue;
      if (CONTROL_ATTRS.has(name) && !block) continue;
      out.setAttribute(name, value);
    }
    if (block === 'callout') {
      const tone = el.getAttribute('data-tone') ?? '';
      out.setAttribute('data-tone', tone in CALLOUT_TONES ? tone : 'tip');
    }
    if (tag === 'a') {
      out.setAttribute('target', '_blank');
      out.setAttribute('rel', 'noopener noreferrer');
    }
    if (tag === 'input' && block === 'slider') {
      out.setAttribute('type', 'range');
    } else if (tag === 'input' && block === 'switch') {
      out.setAttribute('type', 'checkbox');
    } else if (tag === 'input') {
      out.setAttribute('type', 'text');
      out.setAttribute('autocomplete', 'off');
      out.setAttribute('spellcheck', 'false');
    }
    if (tag === 'video' || tag === 'audio') {
      out.setAttribute('controls', '');
      out.setAttribute('preload', 'metadata');
      if (tag === 'video') out.setAttribute('playsinline', '');
      // A video that starts by itself starts without sound, as browsers require.
      if (tag === 'video' && out.hasAttribute('autoplay')) out.setAttribute('muted', '');
    }
    if (tag === 'img') out.setAttribute('decoding', 'async');
    copy(el, out, doc);
    target.appendChild(out);
  }
}

/**
 * Returns a fragment containing only allowlisted markup. Plain text passes through with line
 * breaks kept. `doc` is the document the nodes are made in: an inert one (the editor's) loads
 * no pictures until they are moved into the page.
 */
export function sanitizeHtml(html: string, doc: Document = document): DocumentFragment {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const fragment = doc.createDocumentFragment();
  copy(parsed.body, fragment, doc);
  return fragment;
}
