import { CALLOUT_TONES, type CalloutTone } from '@qbl/shared';
import { mediaUrl } from '../describe';
import { h } from '../dom';
import type { FormContext } from '../fields';
import { emojiIcon } from '../icons';
import { openPanel } from '../panel';
import { parse, serialize, type Block, type BlockKind, type PictureSize, type Slide } from './model';
import { mediaGrid, mediaThumb, pickMedia, pickVariable, type MediaKind } from './pickers';

/** What each kind of block is called, its icon, and one line on what it is for. */
export const BLOCKS: Record<BlockKind, { icon: string; name: string; about: string; tone: string }> = {
  picture: { icon: '🖼️', name: 'Picture', about: 'A picture, with a caption. Players can tap it to see it large.', tone: '#3e9b5c' },
  gallery: { icon: '🎞️', name: 'Slideshow', about: 'Several pictures to swipe through.', tone: '#3e9b5c' },
  video: { icon: '🎬', name: 'Video', about: 'A video players can play in the box.', tone: '#d14b4b' },
  audio: { icon: '🔊', name: 'Sound', about: 'A sound or a recording to play.', tone: '#9b6bff' },
  callout: { icon: '💡', name: 'Callout', about: 'A coloured note: a tip, a fact, a warning, or something to think about.', tone: '#c98500' },
  reveal: { icon: '👆', name: 'Reveal card', about: 'A question or a prompt that opens to show what it hides.', tone: '#2f8fd6' },
  flip: { icon: '🃏', name: 'Flip card', about: 'A card with a front and a back. Tap it to turn it over.', tone: '#e07b39' },
  answer: { icon: '✏️', name: 'Answer box', about: 'A box to type an answer in, saved in a variable when a button is pressed.', tone: '#2bb3a0' },
  controls: { icon: '🎛️', name: 'Controls', about: 'Hands-on controls players set (sliders, switches, a wheel of chance) and what shows their effect at once (values, meters, text that appears when the settings are right). They are saved in their variables when a button is pressed.', tone: '#5b6ee1' },
  page: { icon: '📄', name: 'New page', about: 'What comes after is on the next page. Players step through with Next.', tone: '#7d8492' },
};

export const TONE_NAMES: Record<CalloutTone, string> = { tip: 'Tip', fact: 'Fact', warn: 'Careful', think: 'Think' };

/** A new block of a kind, as it starts. Media blocks start with what was chosen. */
export function newBlock(kind: BlockKind, media: number[] = []): Block {
  switch (kind) {
    case 'picture':
      return { kind, media: media[0] ?? null, alt: '', caption: '', size: 'large' };
    case 'gallery':
      return { kind, slides: media.map((id) => ({ media: id, alt: '', caption: '' })) };
    case 'video':
      return { kind, media: media[0] ?? null, autoplay: false, loop: false, caption: '' };
    case 'audio':
      return { kind, media: media[0] ?? null, autoplay: false, loop: false };
    case 'callout':
      return { kind, tone: 'tip', html: '<p>Did you know…?</p>' };
    case 'reveal':
      return { kind, prompt: 'What do you think?', html: '<p>The answer…</p>' };
    case 'flip':
      return { kind, front: '<p>A word or a question</p>', back: '<p>What it means, or the answer</p>' };
    case 'answer':
      return { kind, variable: '', placeholder: 'Type your answer' };
    case 'controls':
      return { kind, html: '<div data-qbl="panel"><input data-qbl="slider" data-var="amount" data-min="0" data-max="10" data-value="5" data-label="Amount"><div data-qbl="meter" data-var="amount" data-max="10" data-label="Shows"></div></div><div data-qbl="when" data-when="amount >= 8">That is a lot!</div>' };
    case 'page':
      return { kind };
  }
}

/** The media a media block needs chosen first, if any. */
export const MEDIA_OF: Partial<Record<BlockKind, MediaKind>> = { picture: 'image', gallery: 'image', video: 'video', audio: 'audio' };

// ---------------------------------------------------------------- little editors

/** A small box of formatted text (bold, italic, lists), for what is inside a card or a callout. */
export function miniEditor(ctx: FormContext, html: string, onChange: (html: string) => void, label: string): HTMLElement {
  const area = h('div', { class: 'rt-mini', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, spellcheck: 'true' });
  const content = parse(html, (id) => ctx.store.byId('media', id)?.type as string);
  for (const img of content.querySelectorAll('img')) {
    const id = /qbl-media\/(\d+)$/.exec(img.getAttribute('src') ?? '')?.[1];
    if (id) {
      img.setAttribute('data-rt-media', id);
      img.setAttribute('src', mediaUrl(ctx.store, ctx.store.byId('media', Number(id))) ?? '');
    }
  }
  area.append(document.adoptNode(content));
  if (!area.firstChild) area.append(h('p', null, h('br')));
  const command = (name: string, icon: string, title: string) =>
    h('button', { type: 'button', class: 'rt-tool', title, 'aria-label': title, onmousedown: (e: Event) => e.preventDefault(), onclick: () => {
      area.focus();
      document.execCommand(name);
      onChange(serialize(area.childNodes));
    } }, icon);
  area.addEventListener('input', () => onChange(serialize(area.childNodes)));
  area.addEventListener('focus', () => document.execCommand('defaultParagraphSeparator', false, 'p'));
  return h('div', { class: 'rt-mini-wrap' },
    h('div', { class: 'rt-mini-tools' }, command('bold', 'B', 'Bold (Ctrl+B)'), command('italic', 'I', 'Italic (Ctrl+I)'), command('insertUnorderedList', '•', 'List')),
    area,
  );
}

const field = (label: string, ...control: Array<Node | null>) => h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, label), ...control);
const textInput = (value: string, placeholder: string, set: (v: string) => void, attrs: Record<string, string> = {}) => {
  const input = h('input', { type: 'text', value, placeholder, ...attrs });
  input.addEventListener('input', () => set(input.value));
  return input;
};
const check = (label: string, value: boolean, set: (v: boolean) => void) => {
  const input = h('input', { type: 'checkbox', checked: value });
  input.addEventListener('change', () => set(input.checked));
  return h('label', { class: 'field check wide' }, input, h('span', null, label));
};
/** A row of buttons, one of them chosen. */
function segmented<T extends string>(options: Array<[T, Node | string]>, value: T, set: (v: T) => void, label: string): HTMLElement {
  const row = h('div', { class: 'rt-segmented', role: 'radiogroup', 'aria-label': label });
  const draw = (current: T) => row.replaceChildren(...options.map(([v, text]) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(v === current), class: v === current ? 'on' : '', 'data-value': v,
    onclick: () => {
      draw(v);
      set(v);
    },
  }, text)));
  draw(value);
  return row;
}

// ------------------------------------------------------------------- the panel

/**
 * Edit a block in a pop-up. Every change is applied as it is made (`apply` with the block as it
 * is now); `Done` or Escape closes it.
 */
export function editBlock(ctx: FormContext, start: Block, apply: (b: Block) => void): void {
  let b: Block = structuredClone(start);
  const change = (next: Partial<Block>) => {
    b = { ...b, ...next } as Block;
    apply(b);
  };
  const meta = BLOCKS[b.kind];
  const panel = openPanel({
    key: 'rt-block', kind: 'rt-block', store: ctx.store, size: 'medium', tone: meta.tone, quiet: true,
    title: () => h('span', null, emojiIcon(meta.icon), ` ${meta.name}`),
    body: () => h('div', { class: 'rt-block-form' }, h('p', { class: 'muted' }, meta.about), ...form(), h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'primary', onclick: () => panel.close() }, 'Done'))),
  });

  function form(): Array<Node | null> {
    switch (b.kind) {
      case 'picture': {
        const p = b;
        return [
          mediaGrid(ctx, ['image'], { selected: p.media != null ? [p.media] : [], onPick: ([id]) => change({ media: id ?? null, src: undefined }) }),
          field('Size', segmented<PictureSize>([['small', 'Small'], ['medium', 'Medium'], ['large', 'Full width']], p.size, (size) => change({ size }), 'Size')),
          field('Caption', textInput(p.caption, 'Shown under the picture (optional)', (caption) => change({ caption }))),
          field('Description', textInput(p.alt, 'What it shows, for players who cannot see it', (alt) => change({ alt }))),
        ];
      }
      case 'video':
      case 'audio': {
        const m = b;
        return [
          mediaGrid(ctx, [m.kind], { selected: m.media != null ? [m.media] : [], onPick: ([id]) => change({ media: id ?? null, src: undefined }) }),
          m.kind === 'video' ? field('Caption', textInput(m.caption, 'Shown under the video (optional)', (caption) => change({ caption }))) : null,
          check(m.kind === 'video' ? 'Start by itself, without sound' : 'Start by itself', m.autoplay, (autoplay) => change({ autoplay })),
          check('Play it again and again', m.loop, (loop) => change({ loop })),
        ];
      }
      case 'gallery':
        return [slides()];
      case 'callout':
        return [
          field('Kind', segmented<CalloutTone>((Object.keys(CALLOUT_TONES) as CalloutTone[]).map((t) => [t, h('span', null, emojiIcon(CALLOUT_TONES[t]), ` ${TONE_NAMES[t]}`)]), b.tone, (tone) => change({ tone }), 'Kind')),
          field('Text', miniEditor(ctx, b.html, (html) => change({ html }), 'Callout text')),
        ];
      case 'reveal':
        return [
          field('On the card', textInput(b.prompt, 'What do you think?', (prompt) => change({ prompt }))),
          field('What it shows when opened', miniEditor(ctx, b.html, (html) => change({ html }), 'What it shows')),
        ];
      case 'flip':
        return [
          h('div', { class: 'rt-two' },
            field('Front', miniEditor(ctx, b.front, (front) => change({ front }), 'Front of the card')),
            field('Back', miniEditor(ctx, b.back, (back) => change({ back }), 'Back of the card'))),
        ];
      case 'answer': {
        const a = b;
        const name = h('code', { class: 'rt-var-name' }, a.variable ? `{{${a.variable}}}` : 'not chosen');
        return [
          field('Saved in the variable',
            h('div', { class: 'rt-inline' }, name, h('button', {
              type: 'button', onclick: async () => {
                const v = await pickVariable(ctx, 'Save the answer in…');
                if (!v) return;
                name.textContent = `{{${v}}}`;
                change({ variable: v });
              },
            }, a.variable ? 'Change…' : 'Choose…'))),
          field('Hint in the empty box', textInput(a.placeholder, 'Type your answer', (placeholder) => change({ placeholder }))),
          h('p', { class: 'muted' }, 'When the player presses one of the box’s buttons, what they typed is saved in the variable before the button’s action runs. A number is saved as a number. Show it with {{name}}, test it in a condition, and see it in the class report.'),
        ];
      }
      case 'controls': {
        const area = h('textarea', { class: 'rt-controls-html', rows: '10', spellcheck: 'false', 'aria-label': 'The controls as HTML' }) as HTMLTextAreaElement;
        area.value = b.html;
        area.addEventListener('change', () => change({ html: area.value.trim() }));
        return [
          field('As HTML', area),
          h('div', { class: 'muted rt-controls-help' },
            h('p', null, 'Each control saves to a variable (data-var) when a button of the box is pressed:'),
            h('ul', null,
              h('li', null, h('code', null, '<input data-qbl="slider" data-var="v" data-min="0" data-max="10" data-step="1" data-value="5" data-unit="cm" data-label="Rope">')),
              h('li', null, h('code', null, '<input data-qbl="switch" data-var="v" data-label="Battery">'), ' (1 on, 0 off)'),
              h('li', null, h('code', null, '<div data-qbl="wheel" data-var="v" data-options="Sun|Rain|Wind" data-label="Weather"></div>'), ' (a wheel of chance; repeat an option to make it likelier)'),
              h('li', null, h('code', null, '<span data-qbl="value" data-var="v"></span>'), ', ', h('code', null, '<div data-qbl="meter" data-var="v" data-min="0" data-max="10"></div>')),
              h('li', null, h('code', null, '<div data-qbl="when" data-when="v >= 6; battery = 1">…</div>'), ': shown only while all of these hold'),
              h('li', null, h('code', null, '<div data-qbl="panel">…</div>'), ' puts controls side by side')),
          ),
        ];
      }
      case 'page':
        return [];
    }
  }

  function slides(): HTMLElement {
    const list = h('div', { class: 'rt-slides' });
    const set = (next: Slide[]) => {
      change({ slides: next });
      draw();
    };
    const draw = () => {
      const now = (b as Extract<Block, { kind: 'gallery' }>).slides;
      list.replaceChildren(...now.map((s, i) => h('div', { class: 'rt-slide-row', 'data-slide': i },
        mediaThumb(ctx, s.media != null ? ctx.store.byId('media', s.media) : undefined),
        h('div', { class: 'rt-slide-fields' },
          textInput(s.caption, 'Caption (optional)', (caption) => change({ slides: now.map((x, j) => (j === i ? { ...x, caption } : x)) }), { 'aria-label': `Caption of picture ${i + 1}` }),
          textInput(s.alt, 'Description, for players who cannot see it', (alt) => change({ slides: now.map((x, j) => (j === i ? { ...x, alt } : x)) }), { 'aria-label': `Description of picture ${i + 1}` })),
        h('div', { class: 'rt-slide-tools' },
          h('button', { type: 'button', class: 'icon', title: 'Earlier', 'aria-label': 'Move earlier', disabled: i === 0, onclick: () => set(now.map((x, j) => (j === i - 1 ? now[i]! : j === i ? now[i - 1]! : x))) }, '↑'),
          h('button', { type: 'button', class: 'icon', title: 'Later', 'aria-label': 'Move later', disabled: i === now.length - 1, onclick: () => set(now.map((x, j) => (j === i + 1 ? now[i]! : j === i ? now[i + 1]! : x))) }, '↓'),
          h('button', { type: 'button', class: 'icon danger', title: 'Take out', 'aria-label': 'Take this picture out', onclick: () => set(now.filter((_, j) => j !== i)) }, '×')),
      )));
      if (!now.length) list.append(h('p', { class: 'muted' }, 'No pictures yet.'));
    };
    draw();
    return h('div', null, list, h('button', {
      type: 'button', class: 'rt-add-slides', onclick: async () => {
        const ids = await pickMedia(ctx, ['image'], { multi: true, title: 'Add pictures to the slideshow' });
        if (ids?.length) set([...(b as Extract<Block, { kind: 'gallery' }>).slides, ...ids.map((id) => ({ media: id, alt: '', caption: '' }))]);
      },
    }, '＋ Add pictures'));
  }
}
