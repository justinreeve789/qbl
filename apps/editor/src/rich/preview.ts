import { escapeHtml, interpolate, embedBareMedia, type ButtonMark } from '@qbl/shared';
import { mediaUrl } from '../describe';
import { h } from '../dom';
import type { FormContext, Values } from '../fields';
import { infoboxView, type BoxView } from './game';

interface CtaValues { text?: string; mark?: ButtonMark }

/**
 * The infobox as a player will see it, drawn by the game's own code over a stand-in for the
 * scene. Its buttons, pages, slideshows and cards all work; choosing a button shows what was
 * chosen and puts the box back. Variables show their starting values.
 */
export function previewBox(ctx: FormContext, values: () => Values, content: () => string): { node: HTMLElement; refresh(still?: boolean): void } {
  const store = ctx.store;
  const stage = h('div', { class: 'rt-stage', 'data-preview': 'infobox' });
  const note = h('p', { class: 'rt-stage-note', 'aria-live': 'polite' }, 'As players see it. Try the buttons, pages and cards.');
  const again = h('button', { type: 'button', onclick: () => refresh(false) }, '↻ Show it again');
  let view: BoxView | null = null;
  let page = 0;
  let timer = 0;

  const vars = () => {
    const out = new Map<string, string | number>([['QBLPlayerName', 'Alex']]);
    for (const v of store.rows('variables')) out.set(String(v.variable_name), (v.default_value as string | number | null) ?? '');
    return out;
  };
  const urlOf = (id: number) => mediaUrl(store, store.byId('media', id));

  function refresh(still = true) {
    window.clearTimeout(timer);
    const v = values();
    const known = vars();
    const fill = (text: string, html: boolean) => interpolate(text, (n) => known.get(n), { mediaUrl: urlOf, escape: html ? escapeHtml : undefined });
    const html = fill(embedBareMedia(content(), (id) => store.byId('media', id)?.type as string), true);
    const ctas = ((v.call_to_actions as CtaValues[] | null | undefined) ?? []);
    const top = v.media_id != null ? store.byId('media', Number(v.media_id)) : undefined;
    const topUrl = top ? mediaUrl(store, top) : null;
    const glossary = (store.settings.glossary as Array<{ id: string | number; term?: string; definition?: string; media_id?: number | null }> | undefined) ?? [];
    stage.replaceChildren();
    view = infoboxView(html, ctas.map((c) => ({ label: fill(c.text ?? '', false) || 'OK', mark: c.mark })), {
      dismissible: v.dismissible !== false,
      hero: top && topUrl && (top.type === 'image' || top.type === 'video') ? { url: topUrl, type: top.type } : null,
      size: (v.size as 'small' | 'medium' | 'large' | undefined) ?? null,
      accent: (v.accent as string | undefined) ?? null,
      layer: stage,
      still,
      page: still ? page : 0,
      onPage: (_, i) => (page = i),
      word: (id) => {
        const e = glossary.find((g) => String(g.id) === id);
        return e ? { term: String(e.term ?? id), definition: fill(String(e.definition ?? ''), false), image: e.media_id != null ? urlOf(e.media_id) : null } : null;
      },
    });
    stage.append(view.node);
    view.start();
    void view.result.then((index) => {
      note.textContent = index == null ? 'Closed. It comes back in a moment.' : `Chose “${fill(ctas[index]?.text ?? '', false)}”. It comes back in a moment.`;
      void view?.leave();
      page = 0;
      timer = window.setTimeout(() => {
        note.textContent = 'As players see it. Try the buttons, pages and cards.';
        refresh(false);
      }, 1100);
    });
  }

  // Keys go to the box first (Escape closes a zoomed picture, ← and → turn pages), not the panel.
  stage.addEventListener('keydown', (e) => {
    if (view?.key(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  const node = h('div', { class: 'rt-preview' }, stage, h('div', { class: 'rt-stage-bar' }, note, again));
  return { node, refresh };
}
