/**
 * Infobox content is HTML written by scenario authors. It is rebuilt from an
 * allowlist before it reaches the page, so a compromised or careless author
 * account cannot run script in students' browsers.
 */
const TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'hr', 'i', 'img', 'li',
  'ol', 'p', 'pre', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
]);
const ATTRS: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
};
const SAFE_URL = /^(https?:|mailto:|\/(?!\/)|\.{0,2}\/|[^:]*$)/i;

function copy(source: Node, target: Node, doc: Document) {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(doc.createTextNode(child.textContent ?? ''));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'embed', 'template'].includes(tag)) continue;
    if (!TAGS.has(tag)) {
      copy(el, target, doc); // keep the text of unknown wrappers
      continue;
    }
    const out = doc.createElement(tag);
    for (const name of ATTRS[tag] ?? []) {
      const value = el.getAttribute(name);
      if (value == null) continue;
      if ((name === 'href' || name === 'src') && !SAFE_URL.test(value.trim())) continue;
      out.setAttribute(name, value);
    }
    if (tag === 'a') {
      out.setAttribute('target', '_blank');
      out.setAttribute('rel', 'noopener noreferrer');
    }
    copy(el, out, doc);
    target.appendChild(out);
  }
}

/** Returns a fragment containing only allowlisted markup. Plain text passes through with line breaks kept. */
export function sanitizeHtml(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const fragment = document.createDocumentFragment();
  copy(parsed.body, fragment, document);
  return fragment;
}
