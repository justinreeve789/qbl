import { CALLOUT_TONES } from '@qbl/shared';
import type { Row } from '../api';
import { mediaLabel, mediaUrl } from '../describe';
import { h, help, toast } from '../dom';
import type { FormContext, Values } from '../fields';
import { emojiIcon } from '../icons';
import { openPanel } from '../panel';
import { BLOCKS, editBlock, MEDIA_OF, newBlock, TONE_NAMES } from './blocks';
import { blockHtml, blockOf, parse, serialize, words, type Block, type BlockKind } from './model';
import { pickMedia, pickVariable, pickWord, upload, type MediaKind } from './pickers';
import { previewBox } from './preview';
import './rich.css';

/**
 * The infobox's content, edited as it will look rather than as HTML: type and format text, and
 * put pictures, slideshows, videos, sounds, cards, callouts, answer boxes and pages between the
 * paragraphs with ＋ Insert, or by dropping or pasting files. Each block is a card that opens a
 * pop-up to change it. ⤢ Designer opens it large with a live preview; </> shows the HTML.
 *
 * What is saved is the HTML the game reads (packages/shared/src/infobox.ts), written afresh
 * from the editor's content on each change.
 */
export interface RichOptions {
  value: string;
  set(html: string): void;
  ctx: FormContext;
  /** The action's other values (buttons, picture at the top, size), for the preview. */
  values: Values;
  /** Inside the designer: no designer button, and taller. */
  designer?: boolean;
  onChange?(html: string): void;
}

interface Instance {
  node: HTMLElement;
  current(): string;
  rebind(o: RichOptions): void;
}

/**
 * Editors whose page was redrawn while they were waiting for something (a picker, a new
 * variable). The redrawn page takes the same editor back when its content is the same, so what
 * was being done still lands, and the cursor stays where it was.
 */
const instances = new Set<Instance>();
/** Editors taken by the page being drawn now, so two boxes with the same text get one each. */
const claimed = new Set<Instance>();

export function richEditor(o: RichOptions): HTMLElement {
  // The page is drawn afresh before the old one is taken away, so the editor may still be on it.
  for (const old of instances) {
    if (!claimed.has(old) && old.current() === (o.value ?? '')) {
      old.rebind(o);
      remember(old);
      return old.node;
    }
  }
  const made = build(o);
  remember(made);
  return made.node;
}

function remember(i: Instance) {
  if (!claimed.size) queueMicrotask(() => claimed.clear());
  claimed.add(i);
  instances.add(i);
  // Forget editors that have been off the page a while.
  window.setTimeout(() => {
    for (const x of instances) if (!x.node.isConnected && x !== i) instances.delete(x);
  }, 4000);
}

const BLOCK_LEVEL = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'blockquote', 'pre', 'table', 'div', 'hr', 'figure', 'details']);

function build(start: RichOptions): Instance {
  let o = start;
  const ctx = () => o.ctx;
  const store = () => o.ctx.store;
  const typeOf = (id: number) => store().byId('media', id)?.type as string | undefined;
  const urlOf = (id: number | null | undefined) => (id == null ? null : mediaUrl(store(), store().byId('media', id)));

  let current = o.value ?? '';
  let mode: 'visual' | 'html' = 'visual';
  let self: Instance | null = null;
  /** A listener on the document, taken off once this editor has left the page for good. */
  const onDocument = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void, capture = false) => {
    const listener = (e: DocumentEventMap[K]) => {
      if (root.isConnected) return fn(e);
      if (!self || !instances.has(self)) document.removeEventListener(type, listener, capture);
    };
    document.addEventListener(type, listener, capture);
  };
  const blocks = new Map<Element, Block>();

  const surface = h('div', { class: 'rt-surface', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Content', spellcheck: 'true', 'data-placeholder': 'Write what the box says. ＋ Insert adds pictures, videos, cards and more.' });
  const source = h('textarea', { class: 'code rt-source', rows: 10, spellcheck: 'false', hidden: true, 'aria-label': 'Content as HTML' });
  const root = h('div', { class: `rt${o.designer ? ' rt-in-designer' : ''}` });

  // ------------------------------------------------------------ saving

  let frame = 0;
  const flush = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    const html = mode === 'html' ? source.value : serialize(surface.childNodes, blocks);
    surface.classList.toggle('rt-empty', mode === 'visual' && html === '' && !surface.querySelector('.rt-block'));
    if (html === current) return;
    current = html;
    o.set(html);
    o.onChange?.(html);
  };
  const commit = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(flush);
  };

  // ------------------------------------------------------------ loading

  /** Show `{{name}}` as a chip and the scenario's media as itself. */
  const decorate = (node: Node) => {
    const els = node instanceof Element ? [node, ...node.querySelectorAll('img, video, audio')] : node instanceof DocumentFragment ? [...node.querySelectorAll('img, video, audio')] : [];
    for (const el of els) {
      if (!el.matches('img, video, audio')) continue;
      const m = /(?:^|\/)qbl-media\/(\d+)$/.exec(el.getAttribute('src') ?? '');
      if (m) {
        el.setAttribute('data-rt-media', m[1]!);
        el.setAttribute('src', urlOf(Number(m[1])) ?? '');
      }
    }
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\{\{\s*[A-Za-z_]\w*\s*\}\}/.test(n.nodeValue ?? '')) texts.push(n as Text);
    if (node.nodeType === Node.TEXT_NODE && /\{\{\s*[A-Za-z_]\w*\s*\}\}/.test(node.nodeValue ?? '')) texts.push(node as Text);
    for (const t of texts) {
      const parts = (t.nodeValue ?? '').split(/\{\{\s*([A-Za-z_]\w*)\s*\}\}/);
      const frag = document.createDocumentFragment();
      parts.forEach((part, i) => frag.append(i % 2 ? chip(part) : part));
      t.replaceWith(frag);
    }
  };

  const load = (html: string) => {
    blocks.clear();
    surface.replaceChildren();
    const plain = !html.includes('<') && html.trim() !== '';
    const nodes = plain
      ? html.split(/\n{2,}/).map((para) => {
        const p = h('p');
        para.split('\n').forEach((line, i) => p.append(...(i ? [h('br'), line] : [line])));
        return p;
      })
      : (() => {
        // Pictures get their real addresses while the nodes are still in the inert document.
        const fragment = parse(html, typeOf);
        decorate(fragment);
        return [...document.adoptNode(fragment).childNodes];
      })();
    let loose: HTMLElement | null = null;
    for (const node of nodes) {
      const b = blockOf(node);
      if (b) {
        loose = null;
        surface.append(widget(b));
        continue;
      }
      if (node instanceof Element && BLOCK_LEVEL.has(node.tagName.toLowerCase())) {
        loose = null;
        decorate(node);
        surface.append(node);
        continue;
      }
      if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim() && !loose) continue;
      // Text and inline elements on their own go in a paragraph.
      if (!loose) surface.append((loose = h('p')));
      decorate(node);
      loose.append(node);
    }
    tidy();
    surface.classList.toggle('rt-empty', serialize(surface.childNodes, blocks) === '' && !surface.querySelector('.rt-block'));
  };

  /** Somewhere to type before, between and after blocks; page numbers. */
  const tidy = () => {
    const kids = [...surface.children];
    kids.forEach((kid, i) => {
      if (!kid.classList.contains('rt-block')) return;
      const next = kids[i + 1];
      if (!next || next.classList.contains('rt-block')) kid.after(h('p', { class: 'rt-gap' }, h('br')));
      if (i === 0) kid.before(h('p', { class: 'rt-gap' }, h('br')));
    });
    if (!surface.firstElementChild) surface.append(h('p', null, h('br')));
    let page = 1;
    for (const w of surface.querySelectorAll<HTMLElement>(':scope > .rt-b-page')) {
      page++;
      const label = w.querySelector('.rt-page-label');
      if (label) label.textContent = `Page ${page} starts here`;
    }
    root.dataset.pages = String(page);
  };

  // ------------------------------------------------------------ chips and blocks

  function chip(name: string): HTMLElement {
    const known = store().rows('variables').some((v) => v.variable_name === name) || name.startsWith('QBL');
    return h('span', { class: `rt-var${known ? '' : ' unknown'}`, contenteditable: 'false', 'data-var-chip': name, title: known ? `Shows the value of ${name}` : `${name} is not a variable of this scenario` }, name);
  }

  function widget(b: Block): HTMLElement {
    const node = h('div', { class: `rt-block rt-b-${b.kind}`, contenteditable: 'false', tabindex: '0', 'data-block': b.kind, style: `--tone:${BLOCKS[b.kind].tone}` });
    blocks.set(node, b);
    drawWidget(node);
    node.addEventListener('keydown', (e) => {
      if (e.target !== node) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeBlock(node);
      } else if (e.key === 'Enter' && b.kind !== 'page') {
        e.preventDefault();
        edit(node);
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        move(node, e.key === 'ArrowUp' ? -1 : 1);
      }
    });
    return node;
  }

  function drawWidget(node: HTMLElement) {
    const b = blocks.get(node)!;
    const meta = BLOCKS[b.kind];
    const tool = (label: string, icon: string, run: () => void, cls = '') => h('button', { type: 'button', class: `rt-block-tool ${cls}`, title: label, 'aria-label': label, onclick: (e: Event) => { e.stopPropagation(); run(); } }, icon);
    const bar = h('div', { class: 'rt-block-bar rt-ui' },
      h('span', { class: 'rt-block-tag' }, emojiIcon(meta.icon), ` ${meta.name}`),
      h('span', { class: 'spacer' }),
      b.kind === 'page' ? null : tool('Change', '✎', () => edit(node), 'edit'),
      tool('Move up', '↑', () => move(node, -1)),
      tool('Move down', '↓', () => move(node, 1)),
      tool('Delete', '×', () => removeBlock(node), 'danger'),
    );
    const view = h('div', { class: 'rt-block-view rt-ui' }, ...blockView(b));
    if (b.kind !== 'page') view.addEventListener('click', () => edit(node));
    node.replaceChildren(bar, view);
  }

  function blockView(b: Block): Array<Node | string | null> {
    const thumb = (media: number | null, src?: string) => {
      const url = urlOf(media) ?? src;
      return url ? h('img', { src: url, alt: '', draggable: 'false' }) : h('span', { class: 'rt-missing' }, 'Choose a picture');
    };
    switch (b.kind) {
      case 'picture':
        return [h('figure', { class: `rt-figure size-${b.size}` }, thumb(b.media, b.src), b.caption ? h('figcaption', null, b.caption) : null)];
      case 'video': {
        const url = urlOf(b.media) ?? b.src;
        return [url ? h('video', { src: url, controls: true, preload: 'metadata' }) : h('span', { class: 'rt-missing' }, 'Choose a video'), b.caption ? h('p', { class: 'rt-caption' }, b.caption) : null, b.autoplay || b.loop ? h('p', { class: 'rt-flags' }, [b.autoplay ? 'Starts by itself' : '', b.loop ? 'Repeats' : ''].filter(Boolean).join(' · ')) : null];
      }
      case 'audio': {
        const url = urlOf(b.media) ?? b.src;
        const row = b.media != null ? store().byId('media', b.media) : undefined;
        return [url ? h('audio', { src: url, controls: true, preload: 'metadata' }) : h('span', { class: 'rt-missing' }, 'Choose a sound'), row ? h('p', { class: 'rt-caption' }, mediaLabel(row)) : null];
      }
      case 'gallery':
        return [h('div', { class: 'rt-strip' }, ...b.slides.slice(0, 6).map((s) => thumb(s.media, s.src)), b.slides.length > 6 ? h('span', { class: 'rt-more' }, `+${b.slides.length - 6}`) : null), h('p', { class: 'rt-caption' }, b.slides.length ? `${b.slides.length} ${b.slides.length === 1 ? 'picture' : 'pictures'} to swipe through` : 'Add pictures')];
      case 'callout':
        return [h('div', { class: `rt-callout tone-${b.tone}` }, emojiIcon(CALLOUT_TONES[b.tone]), h('span', null, h('strong', null, `${TONE_NAMES[b.tone]}: `), words(b.html) || '…'))];
      case 'reveal':
        return [h('div', { class: 'rt-reveal-card' }, h('strong', null, `▾ ${b.prompt || 'Tap to reveal'}`), h('span', { class: 'rt-hidden-text' }, words(b.html) || '…'))];
      case 'flip':
        return [h('div', { class: 'rt-flip-card' }, h('span', { class: 'front' }, words(b.front, 50) || 'Front'), h('span', { class: 'turn' }, '↻'), h('span', { class: 'back' }, words(b.back, 50) || 'Back'))];
      case 'answer':
        return [h('div', { class: 'rt-answer-card' }, h('span', { class: 'rt-fake-input' }, b.placeholder || 'Type your answer'), b.variable ? h('span', { class: 'rt-saves' }, 'saved in ', h('code', null, `{{${b.variable}}}`)) : h('span', { class: 'rt-saves warn' }, '⚠ choose the variable it is saved in'))];
      case 'controls':
        return [h('div', { class: 'rt-controls-card' }, controlsSummary(b.html) || 'Controls')];
      case 'page':
        return [h('span', { class: 'rt-page-label' }, 'Page 2 starts here')];
    }
  }

  function edit(node: HTMLElement) {
    const b = blocks.get(node);
    if (!b || b.kind === 'page') return;
    editBlock(ctx(), b, (next) => {
      blocks.set(node, next);
      drawWidget(node);
      commit();
    });
  }

  function removeBlock(node: HTMLElement) {
    const after = node.nextElementSibling;
    blocks.delete(node);
    node.remove();
    if (after?.classList.contains('rt-gap') && after.textContent === '' && (after.previousElementSibling?.classList.contains('rt-gap') || !after.previousElementSibling)) after.remove();
    tidy();
    commit();
  }

  function move(node: HTMLElement, dir: -1 | 1) {
    // Past the next thing that is not an empty gap.
    let other = dir < 0 ? node.previousElementSibling : node.nextElementSibling;
    while (other && other.classList.contains('rt-gap') && !(other.textContent ?? '').trim()) other = dir < 0 ? other.previousElementSibling : other.nextElementSibling;
    if (!other) return;
    if (dir < 0) other.before(node);
    else other.after(node);
    tidy();
    node.focus();
    node.animate?.([{ transform: `translateY(${dir * -12}px)`, opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
    commit();
  }

  // ------------------------------------------------------------ where things go

  let saved: Range | null = null;
  const track = () => {
    if (!surface.isConnected) return;
    const sel = document.getSelection();
    if (sel && sel.rangeCount && surface.contains(sel.anchorNode)) {
      saved = sel.getRangeAt(0).cloneRange();
      states();
    }
  };
  onDocument('selectionchange', track);

  /** The top-level child of the surface the cursor is in. */
  const topAt = (range: Range | null): Element | null => {
    let n: Node | null = range?.startContainer ?? null;
    if (n === surface) return surface.children[Math.max(0, (range?.startOffset ?? 1) - 1)] ?? null;
    while (n && n.parentNode !== surface) n = n.parentNode;
    return n instanceof Element ? n : null;
  };

  function insertBlock(b: Block, at: Range | null = saved): HTMLElement {
    if (mode === 'html') toVisual();
    const node = widget(b);
    const anchor = at && surface.contains(at.startContainer) ? topAt(at) : surface.lastElementChild;
    const empty = anchor && !anchor.classList.contains('rt-block') && anchor.matches('p') && !(anchor.textContent ?? '').trim() && !anchor.querySelector('img, .rt-var');
    if (anchor && empty) anchor.replaceWith(node);
    else if (anchor) anchor.after(node);
    else surface.append(node);
    tidy();
    // On to the paragraph after it, ready to type.
    const after = node.nextElementSibling;
    if (after) {
      placeCaret(after);
      restore();
    }
    node.animate?.([{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    commit();
    return node;
  }

  const placeCaret = (el: Element) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(true);
    saved = r;
  };

  /** Put the cursor back where it was, in the surface, for a command or an inline insert. */
  const restore = () => {
    surface.focus({ preventScroll: true });
    const sel = document.getSelection();
    if (saved && surface.contains(saved.startContainer) && sel) {
      sel.removeAllRanges();
      sel.addRange(saved);
    }
  };

  function insertInline(node: Node, replaceSelection = false) {
    if (mode === 'html') toVisual();
    restore();
    const sel = document.getSelection();
    let range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !surface.contains(range.startContainer) || topAt(range)?.classList.contains('rt-block')) {
      const p = h('p');
      surface.append(p);
      range = document.createRange();
      range.selectNodeContents(p);
    }
    if (replaceSelection) range.deleteContents();
    range.collapse(false);
    range.insertNode(node);
    const space = document.createTextNode(' ');
    node.parentNode?.insertBefore(space, node.nextSibling);
    range.setStartAfter(space);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    saved = range.cloneRange();
    commit();
  }

  // ------------------------------------------------------------ commands

  const exec = (command: string, value?: string) => {
    if (mode === 'html') return;
    restore();
    document.execCommand(command, false, value);
    commit();
    states();
  };
  const toolButton = (label: string, content: Node | string, run: () => void, extra: Record<string, unknown> = {}) =>
    h('button', { type: 'button', class: 'rt-tool', title: label, 'aria-label': label, onmousedown: (e: Event) => e.preventDefault(), onclick: run, ...extra }, content);

  const bold = toolButton('Bold (Ctrl+B)', h('b', null, 'B'), () => exec('bold'), { 'aria-pressed': 'false', 'data-state': 'bold' });
  const italic = toolButton('Italic (Ctrl+I)', h('i', null, 'I'), () => exec('italic'), { 'aria-pressed': 'false', 'data-state': 'italic' });
  const under = toolButton('Underline (Ctrl+U)', h('u', null, 'U'), () => exec('underline'), { 'aria-pressed': 'false', 'data-state': 'underline' });
  const heading = toolButton('Heading', 'H', () => {
    const now = String(document.queryCommandValue('formatBlock')).toLowerCase();
    exec('formatBlock', now === 'h3' ? 'p' : 'h3');
  }, { 'aria-pressed': 'false', 'data-state': 'heading' });
  const bullets = toolButton('Bulleted list', '•', () => exec('insertUnorderedList'), { 'aria-pressed': 'false', 'data-state': 'insertUnorderedList' });
  const numbers = toolButton('Numbered list', '1.', () => exec('insertOrderedList'), { 'aria-pressed': 'false', 'data-state': 'insertOrderedList' });
  const highlight = toolButton('Highlight', h('mark', null, 'ab'), () => {
    restore();
    const sel = document.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return toast('Select some words to highlight first.');
    const range = sel.getRangeAt(0);
    const mark = h('mark');
    mark.append(range.extractContents());
    range.insertNode(mark);
    commit();
  });
  const link = toolButton('Link', emojiIcon('🔗'), () => {
    restore();
    const sel = document.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return toast('Select the words to make into a link first.');
    const url = window.prompt('Address of the page to link to (https://…):', 'https://')?.trim();
    if (!url || url === 'https://') return;
    if (!/^(https?:|mailto:)/i.test(url)) return toast('A link starts with https:// or mailto:', 'error');
    exec('createLink', url);
  });
  const states = () => {
    for (const b of [bold, italic, under, bullets, numbers]) {
      let on = false;
      try {
        on = document.queryCommandState(b.dataset.state!);
      } catch { /* not in a document that can say */ }
      b.setAttribute('aria-pressed', String(on));
    }
    heading.setAttribute('aria-pressed', String(String(document.queryCommandValue('formatBlock')).toLowerCase() === 'h3'));
  };

  // Insert: a palette of everything that can go in a box.
  const palette = h('div', { class: 'rt-palette', role: 'menu', hidden: true });
  const insertButton = h('button', { type: 'button', class: 'rt-insert primary', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onmousedown: (e: Event) => e.preventDefault(), onclick: () => togglePalette() }, '＋ Insert');
  const togglePalette = (show = palette.hidden) => {
    palette.style.top = `${toolbar.offsetHeight + 4}px`;
    palette.hidden = !show;
    insertButton.setAttribute('aria-expanded', String(show));
    if (show) (palette.querySelector('button') as HTMLElement | null)?.focus();
  };
  const choices: Array<{ icon: string; name: string; about: string; run: () => void; kind?: string }> = [
    ...(['picture', 'gallery', 'video', 'audio', 'callout', 'reveal', 'flip', 'answer', 'controls', 'page'] as BlockKind[]).map((kind) => ({ ...BLOCKS[kind], kind, run: () => void add(kind) })),
    { icon: '📖', name: 'Glossary word', about: 'A word players can tap to see what it means. Select it in the text first.', kind: 'word', run: () => void addWord() },
    { icon: '🔢', name: 'Variable', about: 'Shows a variable’s value, such as a score or the player’s name.', kind: 'variable', run: () => void addVariable() },
  ];
  palette.append(...choices.map((c) => h('button', {
    type: 'button', role: 'menuitem', class: 'rt-choice', 'data-insert': c.kind, onmousedown: (e: Event) => e.preventDefault(),
    onclick: () => {
      togglePalette(false);
      c.run();
    },
  }, h('span', { class: 'rt-choice-icon' }, emojiIcon(c.icon)), h('span', { class: 'rt-choice-text' }, h('strong', null, c.name), h('small', null, c.about)))));
  palette.addEventListener('keydown', (e) => {
    const items = [...palette.querySelectorAll<HTMLElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.stopPropagation();
      togglePalette(false);
      insertButton.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  });
  onDocument('pointerdown', (e) => {
    if (!palette.hidden && !palette.contains(e.target as Node) && e.target !== insertButton) togglePalette(false);
  }, true);

  async function add(kind: BlockKind) {
    const at = saved;
    const media = MEDIA_OF[kind];
    if (media) {
      const ids = await pickMedia(ctx(), [media], { multi: kind === 'gallery', title: kind === 'gallery' ? 'Choose pictures for the slideshow' : undefined });
      if (!ids?.length) return;
      // A slideshow of one picture is a picture.
      insertBlock(newBlock(kind === 'gallery' && ids.length === 1 ? 'picture' : kind, ids), at);
      return;
    }
    const node = insertBlock(newBlock(kind), at);
    if (kind === 'answer') {
      const v = await pickVariable(ctx(), 'Save the answer in…');
      const b = blocks.get(node);
      if (v && b?.kind === 'answer') {
        blocks.set(node, { ...b, variable: v });
        drawWidget(node);
        commit();
      }
    } else if (kind !== 'page') edit(node);
  }

  async function addWord() {
    const sel = document.getSelection();
    const selected = saved && !saved.collapsed && surface.contains(saved.startContainer) ? saved.toString() : '';
    const range = saved?.cloneRange() ?? null;
    const entry = await pickWord(ctx(), selected || (sel?.toString() ?? ''));
    if (!entry) return;
    saved = range;
    const span = h('span', { 'data-qbl': 'word', 'data-word': String(entry.id), class: 'rt-word', title: `Glossary: ${entry.term ?? entry.id}` }, selected.trim() || String(entry.term ?? entry.id));
    insertInline(span, selected !== '');
  }

  async function addVariable() {
    const range = saved?.cloneRange() ?? null;
    const name = await pickVariable(ctx(), 'Show the value of…');
    if (!name) return;
    saved = range;
    insertInline(chip(name));
  }

  // ------------------------------------------------------------ files

  const kindOf = (f: File): MediaKind | null => (f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : null);

  /** Upload files and put them in at `at`: a picture, a video, a sound, or a slideshow when several pictures come at once. */
  async function takeFiles(files: File[], at: Range | null) {
    const usable = files.filter(kindOf);
    if (usable.length < files.length) toast('Only pictures, videos and sounds can go in a box.', 'error');
    if (!usable.length) return;
    const holder = h('div', { class: 'rt-uploading rt-ui', contenteditable: 'false' }, h('span', { class: 'rt-spinner' }), ` Uploading ${usable.length === 1 ? usable[0]!.name : `${usable.length} files`}…`);
    const anchor = at && surface.contains(at.startContainer) ? topAt(at) : surface.lastElementChild;
    if (anchor) anchor.after(holder);
    else surface.append(holder);
    const rows = (await Promise.all(usable.map((f) => upload(ctx(), f)))).filter((r): r is Row => r != null);
    const here = document.createRange();
    if (holder.previousElementSibling) here.selectNodeContents(holder.previousElementSibling);
    else here.selectNodeContents(surface);
    here.collapse(false);
    holder.remove();
    const images = rows.filter((r) => r.type === 'image');
    if (images.length > 1) insertBlock(newBlock('gallery', images.map((r) => r.id)), here);
    else if (images[0]) insertBlock(newBlock('picture', [images[0].id]), here);
    for (const r of rows.filter((x) => x.type !== 'image')) insertBlock(newBlock(r.type === 'video' ? 'video' : 'audio', [r.id]), here);
  }

  surface.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    root.classList.add('dropping');
  });
  surface.addEventListener('dragleave', (e) => {
    if (!surface.contains(e.relatedTarget as Node)) root.classList.remove('dropping');
  });
  surface.addEventListener('drop', (e) => {
    root.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    const at = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(e.clientX, e.clientY) ?? saved;
    void takeFiles(files, at);
  });
  surface.addEventListener('paste', (e) => {
    const data = e.clipboardData;
    if (!data) return;
    const files = [...data.files];
    if (files.length) {
      e.preventDefault();
      void takeFiles(files, saved);
      return;
    }
    // Pasted text keeps its paragraphs, lists and bold, but none of the page it came from.
    const html = data.getData('text/html');
    e.preventDefault();
    if (html) document.execCommand('insertHTML', false, serialize(parse(html, typeOf).childNodes));
    else document.execCommand('insertText', false, data.getData('text/plain'));
    commit();
  });

  surface.addEventListener('input', commit);
  surface.addEventListener('focus', () => document.execCommand('defaultParagraphSeparator', false, 'p'));
  surface.addEventListener('blur', flush);
  surface.addEventListener('keydown', (e) => {
    // Shortcuts that the browser does not have.
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      link.click();
    }
  });

  // ------------------------------------------------------------ HTML view and designer

  const toVisual = () => {
    mode = 'visual';
    load(source.value);
    source.hidden = true;
    surface.hidden = false;
    codeButton.setAttribute('aria-pressed', 'false');
    root.classList.remove('rt-html');
  };
  const toHtml = () => {
    flush();
    mode = 'html';
    source.value = current;
    source.hidden = false;
    surface.hidden = true;
    codeButton.setAttribute('aria-pressed', 'true');
    root.classList.add('rt-html');
    source.focus();
  };
  source.addEventListener('input', commit);
  source.addEventListener('change', flush);
  const codeButton = h('button', { type: 'button', class: 'rt-tool rt-code', title: 'Show the HTML', 'aria-label': 'Show the HTML', 'aria-pressed': 'false', onclick: () => (mode === 'html' ? toVisual() : toHtml()) }, '</>');

  const designerButton = o.designer ? null : h('button', {
    type: 'button', class: 'rt-designer-open', title: 'Open large, beside a live preview', onclick: () => {
      flush();
      openDesigner(o, current, (html) => {
        // The designer saved as it went: show what it left.
        current = html;
        if (mode === 'html') source.value = html;
        else load(html);
      });
    },
  }, emojiIcon('👀'), ' Preview');

  const toolbar = h('div', { class: 'rt-toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    h('div', { class: 'rt-group' }, bold, italic, under, highlight),
    h('div', { class: 'rt-group' }, heading, bullets, numbers, link),
    h('div', { class: 'rt-group rt-insert-group' }, insertButton),
    h('span', { class: 'spacer' }),
    h('div', { class: 'rt-group' }, codeButton, designerButton),
  );
  root.append(toolbar, palette, surface, source, h('p', { class: 'rt-foot muted' }, 'Drop or paste pictures, videos and sounds straight in.', help('Several pictures dropped at once become a slideshow. Click a picture, card or callout to change it; select a block and press Delete to take it out, or Alt+↑ and Alt+↓ to move it. A new page starts at each 📄 New page.')));

  load(current);
  self = {
    node: root,
    current: () => current,
    rebind(next) {
      o = next;
    },
  };
  return self;
}

/**
 * The designer: the editor large on one side, the box as players see it on the other, the
 * preview following every change. `closed` gets the content as it was left.
 */
function openDesigner(o: RichOptions, start: string, closed: (html: string) => void) {
  let latest = start;
  let preview: ReturnType<typeof previewBox> | null = null;
  let timer = 0;
  const panel = openPanel({
    key: 'rt-designer', kind: 'infobox-designer', store: o.ctx.store, size: 'wide', tone: '#2f8fd6', quiet: true,
    title: () => h('span', null, emojiIcon('📋'), ' Infobox'),
    body: () => {
      preview = previewBox(o.ctx, () => o.values, () => latest);
      const editor = build({
        ...o, value: latest, designer: true,
        onChange: (html) => {
          latest = html;
          window.clearTimeout(timer);
          timer = window.setTimeout(() => preview?.refresh(true), 220);
        },
      });
      queueMicrotask(() => preview?.refresh(false));
      return h('div', { class: 'rt-designer' }, h('div', { class: 'rt-designer-edit' }, editor.node), preview.node);
    },
  });
  panel.dialog.addEventListener('close', () => closed(latest));
}

/** What a controls block holds, in a line: "Slider: Rope · Switch: Brake · Shows when rope >= 6". */
function controlsSummary(html: string): string {
  const parts: string[] = [];
  const names: Record<string, string> = { slider: 'Slider', switch: 'Switch', wheel: 'Wheel', meter: 'Meter', value: 'Value' };
  for (const m of html.matchAll(/<(?:input|div|span)(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const tag = m[0];
    const kind = /data-qbl\s*=\s*"([a-z]+)"/i.exec(tag)?.[1] ?? '';
    const label = /data-label\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /data-var\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    if (names[kind]) parts.push(`${names[kind]}${label ? `: ${label}` : ''}`);
    if (kind === 'when') parts.push(`Shows when ${/data-when\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '…'}`);
  }
  return parts.join(' · ');
}
