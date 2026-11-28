import { notebookContents, writtenWhen, type Notebook, type NoteCard, type NotebookPage } from '@qbl/shared';
import { ApiError, type Api, type Assignment, type NotebookSummary, type StudentNotebook } from '../api';
import { clear, h, help } from '../dom';
import { emojiIcon } from '../icons';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => Array.from(w)[0]!.toUpperCase()).join('') || '?';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 pages · 5 cards · today at 2:41 PM", or that nothing is written yet. */
export function notebookLine(s: Pick<NotebookSummary, 'pages' | 'cards' | 'updated_at'>, now = Date.now()): string {
  if (!s.pages || !s.updated_at) return 'Nothing written yet';
  return [plural(s.pages, 'page', 'pages'), s.cards ? plural(s.cards, 'card', 'cards') : null, writtenWhen(s.updated_at, now)].filter(Boolean).join(' · ');
}

/** One card as the student made it: a flip card shows its front and back together, a to-do whether it is done. */
function cardView(card: NoteCard): HTMLElement {
  const edited = `Written ${writtenWhen(card.updated_at)}`;
  if (card.kind === 'flash') {
    return h('li', { class: 'nbr-card flash', 'data-color': card.color, title: edited },
      h('span', { class: 'nbr-card-kind' }, emojiIcon('🔄'), 'Flip card'),
      h('p', { class: 'nbr-flash-side' }, h('b', null, 'Front'), card.text || h('span', { class: 'nbr-blank' }, 'Nothing written')),
      h('p', { class: 'nbr-flash-side' }, h('b', null, 'Back'), card.back || h('span', { class: 'nbr-blank' }, 'Nothing written')));
  }
  if (card.kind === 'check') {
    return h('li', { class: `nbr-card check${card.done ? ' done' : ''}`, 'data-color': card.color, title: edited },
      h('span', { class: 'nbr-check', role: 'img', 'aria-label': card.done ? 'Done' : 'Not done yet' }, card.done ? '✓' : ''),
      h('p', null, card.text || h('span', { class: 'nbr-blank' }, 'Nothing written')));
  }
  return h('li', { class: 'nbr-card note', 'data-color': card.color, title: edited },
    h('p', null, card.text || h('span', { class: 'nbr-blank' }, 'Nothing written')));
}

function pageView(page: NotebookPage, depth: number, trail: string[]): HTMLElement {
  return h('article', { class: 'nbr-page', id: `nbr-${page.id}`, 'data-color': page.color, 'data-page': page.id },
    h('header', { class: 'nbr-page-head' },
      trail.length ? h('p', { class: 'nbr-trail' }, trail.join(' › ')) : null,
      h(depth ? 'h4' : 'h3', null, emojiIcon(page.icon), page.title || 'Untitled page'),
      h('p', { class: 'nbr-when' }, `Last written ${writtenWhen(page.updated_at)}`)),
    page.text.trim() ? h('div', { class: 'nbr-text' }, page.text) : (page.cards.length ? null : h('p', { class: 'nbr-blank' }, 'This page is empty.')),
    page.cards.length ? h('ul', { class: 'nbr-cards' }, ...page.cards.map(cardView)) : null);
}

/** A student's whole notebook, to read: its contents, then every page in that order, subpages under their page. */
export function notebookReader(book: Notebook): HTMLElement {
  const contents = notebookContents(book);
  if (!contents.length) return h('p', { class: 'empty' }, 'Nothing written in this notebook yet.');
  const titles = new Map(book.pages.map((p) => [p.id, p.title || 'Untitled page']));
  const trail = (page: NotebookPage) => {
    const out: string[] = [];
    for (let up = page.parent; up; up = book.pages.find((p) => p.id === up)?.parent ?? null) out.unshift(titles.get(up) ?? '');
    return out;
  };
  const toc = contents.length > 1
    ? h('nav', { class: 'nbr-contents', 'aria-label': 'Contents' },
        h('h3', null, 'Contents'),
        h('ol', null, ...contents.map(({ page, depth }) => h('li', { style: `--depth:${depth}` },
          h('a', {
            href: `#nbr-${page.id}`,
            onclick: (e: Event) => {
              e.preventDefault();
              document.getElementById(`nbr-${page.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            },
          }, emojiIcon(page.icon), page.title || 'Untitled page')))))
    : null;
  return h('div', { class: 'nbr-book' }, toc, ...contents.map(({ page, depth }) => pageView(page, depth, trail(page))));
}

/**
 * The notebooks of an assignment's students, for their teacher to read: on the Classes page,
 * from an assigned mission. Read only; what each student wrote in that mission's game (their
 * team's, or the assignment's), not their notes anywhere else.
 */
export function notebooksView(api: Api, assignment: Assignment, back: () => void): HTMLElement {
  const title = assignment.scenario?.title ?? 'Assignment';
  let students: NotebookSummary[] | null = null;
  let chosen: number | null = null;
  const opened = new Map<number, StudentNotebook>();
  const list = h('nav', { class: 'nbr-students', 'aria-label': 'Students' }, h('p', { class: 'muted' }, 'Loading…'));
  const reader = h('section', { class: 'nbr-reader', 'aria-live': 'polite' });

  const drawList = () => {
    if (!students) return;
    if (!students.length) return clear(list, h('p', { class: 'empty' }, 'No students in this assignment.'));
    clear(list, h('ul', null, ...students.map((s) => h('li', null,
      h('button', {
        type: 'button', class: s.id === chosen ? 'current' : null, 'data-student': s.id, 'aria-current': s.id === chosen ? 'true' : null,
        onclick: () => void choose(s.id),
      },
        h('span', { class: 'report-avatar small', 'data-hue': String(Math.abs(s.id) % 8), 'aria-hidden': 'true' }, initials(s.name)),
        h('span', { class: 'nbr-who' },
          h('strong', null, s.name),
          h('small', null, s.team ? `Team ${s.team} · ` : '', notebookLine(s))))))));
  };

  const drawReader = () => {
    const shown = chosen != null ? opened.get(chosen) : null;
    if (chosen == null) {
      clear(reader, h('p', { class: 'empty' }, students?.some((s) => s.pages) ? 'Choose a student to read their notebook.' : 'No one has written in their notebook in this mission yet.'));
      return;
    }
    if (!shown) return clear(reader, h('p', { class: 'muted' }, 'Opening the notebook…'));
    const s = shown.student;
    clear(reader,
      h('header', { class: 'nbr-reader-head' },
        h('h3', null, emojiIcon('📒'), `${s.name}’s notebook`),
        h('p', { class: 'muted' }, [s.team ? `Team ${s.team}` : null, shown.updated_at ? `Last written ${writtenWhen(shown.updated_at)}` : null].filter(Boolean).join(' · '))),
      notebookReader(shown.notebook));
  };

  const choose = async (id: number) => {
    chosen = id;
    drawList();
    drawReader();
    if (opened.has(id)) return;
    try {
      opened.set(id, await api.studentNotebook(assignment.id, id));
      if (chosen === id) drawReader();
    } catch (err) {
      if (chosen === id) clear(reader, h('p', { class: 'issue error' }, err instanceof Error ? err.message : 'Could not open that notebook.'));
    }
  };

  const load = async () => {
    try {
      students = await api.notebooks(assignment.id);
      drawList();
      // The first student who has written something opens at once.
      const first = students.find((s) => s.pages);
      if (first) void choose(first.id);
      else drawReader();
    } catch (err) {
      const message = err instanceof ApiError && err.status === 404 ? 'Notebooks are not available on this server yet.' : err instanceof Error ? err.message : 'Could not load the notebooks.';
      clear(list, h('p', { class: 'issue error' }, message));
    }
  };
  void load();

  return h('div', { class: 'card report notebooks', 'data-card': 'notebooks' },
    h('div', { class: 'report-head' },
      h('div', null,
        h('span', { class: 'report-eyebrow' }, emojiIcon('📒'), 'Students’ notebooks'),
        h('h2', null, title, help('What each student wrote in the notebook in this mission’s game: their team’s game, if they are in one. You can read it but not change it, and students are told their teacher can read it. Notes they keep in other games stay their own. Starting a student’s game again empties their notebook there.')),
        h('p', { class: 'report-meta' }, h('span', null, plural(assignment.students.length, 'student', 'students')), h('span', null, 'Read only'))),
      h('div', { class: 'report-actions' },
        h('button', { type: 'button', onclick: back }, '← Back to classes'))),
    h('div', { class: 'nbr-layout' }, list, reader));
}
