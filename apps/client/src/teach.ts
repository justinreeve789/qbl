import { editsAllScenarios } from '@qbl/shared';
import { icon } from './ui/icons';
import { dueLabel, type Mission } from './home';

/**
 * The teacher's part of the missions page. Students land on the page to play; teachers and
 * admins land there to build, assign and watch, so for them the page opens with what they
 * look after: shortcuts into the editor, the missions they have assigned (with a "Look in" per
 * team) and the scenarios they are writing. Everything here comes from the APIs the editor
 * already uses, read with the same sign-in.
 */

/** One of the teacher's assignments, as `GET /api/teach/assignments` lists it. */
export interface TeachAssignment {
  id: number;
  scenario: { id: number; code: string; title: string; image?: string | null } | null;
  due_at: string | null;
  note: string | null;
  /** The instance of students who are in no team. */
  group: string;
  students: Array<{ id: number; name: string; team_id: number | null }>;
  teams: Array<{ id: number; name: string; group?: string; student_ids: number[] }>;
}

/** A scenario the teacher can edit, as `GET /api/editor/scenarios` lists it. */
export interface TeachScenario {
  id: number;
  code: string;
  title: string;
  subtitle?: string | null;
  user_id: number | null;
  published_at: string | null;
  updated_at?: string | null;
}

/** What the teacher's part of the page shows. Each list is null when it could not be loaded. */
export interface TeacherDesk {
  assignments: TeachAssignment[] | null;
  scenarios: TeachScenario[] | null;
  students: number | null;
}

/** Where the teacher's shortcuts go. The editor keeps its pages in the fragment. */
export const TEACH_PATHS = {
  newScenario: '/editor/#/new',
  scenarios: '/editor/#/',
  classes: '/editor/#/classes',
  docs: '/docs/',
  edit: (id: number) => `/editor/#/s/${id}`,
  play: (code: string) => `/${encodeURIComponent(code)}`,
} as const;

/**
 * The ways into an assignment's game: one per team, plus "No team" for students in none, or a
 * single one when it has no teams. Each opens the scenario in that group's instance, where the
 * teacher joins as a visible participant (as "Look in" on the Classes page does).
 */
export function lookInLinks(a: TeachAssignment): Array<{ label: string; href: string }> {
  if (!a.scenario) return [];
  const at = (group: string) => `${TEACH_PATHS.play(a.scenario!.code)}?group=${encodeURIComponent(group)}`;
  const teams = a.teams.filter((t) => t.group);
  if (!teams.length) return [{ label: 'Look in', href: at(a.group) }];
  const out = teams.map((t) => ({ label: t.name, href: at(t.group!) }));
  if (a.students.some((s) => s.team_id == null)) out.push({ label: 'No team', href: at(a.group) });
  return out;
}

/** The short labels under an assignment's title: due date, how many students, how many teams. */
export function assignmentTags(a: TeachAssignment, now: Date, locale?: string): Array<{ text: string; tone: 'plain' | 'team' | 'due' | 'late' }> {
  const tags: Array<{ text: string; tone: 'plain' | 'team' | 'due' | 'late' }> = [];
  if (a.due_at) {
    const due = dueLabel(a.due_at, now, locale);
    tags.push({ text: due.text, tone: due.late ? 'late' : 'due' });
  }
  const n = a.students.length;
  tags.push({ text: n === 1 ? '1 student' : `${n} students`, tone: 'plain' });
  if (a.teams.length) tags.push({ text: a.teams.length === 1 ? '1 team' : `${a.teams.length} teams`, tone: 'team' });
  return tags;
}

/** Assignments still to come first (soonest due), then those without a date, then past ones. */
export function sortAssignments(list: TeachAssignment[], now: Date): TeachAssignment[] {
  const rank = (a: TeachAssignment): [number, number] => {
    if (!a.due_at) return [1, 0];
    const t = new Date(`${a.due_at.replace(' ', 'T')}Z`).getTime();
    return t >= now.getTime() ? [0, t] : [2, -t];
  };
  return [...list].sort((x, y) => {
    const [a1, a2] = rank(x);
    const [b1, b2] = rank(y);
    return a1 - b1 || a2 - b2 || y.id - x.id;
  });
}

/** The teacher's own scenarios, most recently changed first; the shared samples are left to the editor's list. */
export function ownScenarios(list: TeachScenario[], userId: number | string | undefined, isAdmin: boolean): TeachScenario[] {
  const mine = isAdmin ? list : list.filter((s) => s.user_id != null && String(s.user_id) === String(userId));
  return [...mine].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function link(href: string, className: string, label: string, iconName?: Parameters<typeof icon>[0]): HTMLAnchorElement {
  const a = el('a', className);
  a.href = href;
  if (iconName) a.appendChild(icon(iconName, { size: 18 }));
  a.appendChild(el('span', undefined, label));
  return a;
}

/** The row of shortcuts at the top of the teacher's page. Counts fill in once the desk has loaded. */
function tiles(): { root: HTMLElement; fill(desk: TeacherDesk, own: TeachScenario[]): void } {
  const root = el('nav', 'qbl-teach-tiles');
  root.setAttribute('aria-label', 'Teaching');
  const tile = (key: string, href: string, iconName: Parameters<typeof icon>[0], title: string, hint: string) => {
    const a = el('a', `qbl-teach-tile ${key}`);
    a.href = href;
    a.dataset.tile = key;
    const text = el('span', 'qbl-teach-tile-text');
    const note = el('small', undefined, hint);
    text.append(el('strong', undefined, title), note);
    a.append(icon(iconName, { size: 28 }), text);
    root.appendChild(a);
    return note;
  };
  tile('new', TEACH_PATHS.newScenario, 'new', 'New scenario', 'Start from the starship or a blank page');
  const scenariosNote = tile('scenarios', TEACH_PATHS.scenarios, 'scenarios', 'Your scenarios', 'Edit, publish and export');
  const classesNote = tile('classes', TEACH_PATHS.classes, 'classes', 'Classes', 'Students, assignments, teams, reports');
  tile('docs', TEACH_PATHS.docs, 'docs', 'Docs', 'How scenarios and the editor work');
  return {
    root,
    fill(desk, own) {
      if (desk.scenarios) scenariosNote.textContent = own.length === 1 ? '1 of your own · edit, publish, export' : `${own.length} of your own · edit, publish, export`;
      if (desk.students != null) classesNote.textContent = desk.students === 1 ? '1 student · assignments, teams, reports' : `${desk.students} students · assignments, teams, reports`;
    },
  };
}

function assignmentsSection(desk: TeacherDesk, now: Date): HTMLElement {
  const wrap = el('section', 'qbl-home-section qbl-teach-assignments');
  const head = el('div', 'qbl-teach-head');
  head.append(el('h2', undefined, 'Your assignments'), link(TEACH_PATHS.classes, 'qbl-teach-more', 'Manage in Classes'));
  wrap.appendChild(head);
  if (!desk.assignments) {
    wrap.appendChild(el('p', 'qbl-teach-empty', 'Your assignments could not be loaded. They are on the Classes page.'));
    return wrap;
  }
  if (!desk.assignments.length) {
    const p = el('p', 'qbl-teach-empty', 'You have not assigned a mission yet. Add your students and assign one on the ');
    p.append(link(TEACH_PATHS.classes, '', 'Classes page'), document.createTextNode('.'));
    wrap.appendChild(p);
    return wrap;
  }
  const list = el('div', 'qbl-teach-list');
  for (const a of sortAssignments(desk.assignments, now)) {
    const row = el('article', 'qbl-teach-row');
    row.dataset.assignment = String(a.id);
    const art = el('div', 'qbl-teach-art');
    if (a.scenario?.image) art.style.backgroundImage = `url("${a.scenario.image}")`;
    const body = el('div', 'qbl-teach-body');
    body.appendChild(el('h3', undefined, a.scenario?.title ?? 'A scenario that is no longer published'));
    const tags = el('div', 'qbl-mission-tags');
    for (const t of assignmentTags(a, now)) tags.appendChild(el('span', `qbl-tag ${t.tone}`, t.text));
    body.appendChild(tags);
    if (a.note) body.appendChild(el('p', 'qbl-mission-note', a.note));
    const actions = el('div', 'qbl-teach-actions');
    const ways = lookInLinks(a);
    if (ways.length) {
      actions.appendChild(el('span', 'qbl-teach-label', ways.length > 1 ? 'Look in:' : ''));
      for (const w of ways) {
        const go = link(w.href, 'qbl-teach-look', w.label, 'look-in');
        go.title = ways.length > 1 ? `Join team ${w.label}'s game` : 'Join this class\'s game';
        actions.appendChild(go);
      }
    }
    body.appendChild(actions);
    row.append(art, body);
    list.appendChild(row);
  }
  wrap.appendChild(list);
  wrap.appendChild(el('p', 'qbl-teach-hint', 'Students see these on their own missions page when they sign in with their own accounts. Looking in, you join their game as a visible player.'));
  return wrap;
}

function scenariosSection(desk: TeacherDesk, own: TeachScenario[]): HTMLElement {
  const wrap = el('section', 'qbl-home-section qbl-teach-scenarios');
  const head = el('div', 'qbl-teach-head');
  head.append(el('h2', undefined, 'Your scenarios'), link(TEACH_PATHS.scenarios, 'qbl-teach-more', 'All scenarios'));
  wrap.appendChild(head);
  if (!desk.scenarios) {
    wrap.appendChild(el('p', 'qbl-teach-empty', 'Your scenarios could not be loaded. They are in the editor.'));
    return wrap;
  }
  const grid = el('div', 'qbl-teach-grid');
  for (const s of own.slice(0, 5)) {
    const card = el('article', 'qbl-teach-card');
    card.dataset.scenario = String(s.id);
    const title = el('div', 'qbl-teach-card-title');
    title.append(el('h3', undefined, s.title), el('span', `qbl-tag ${s.published_at ? 'team' : 'plain'}`, s.published_at ? 'Published' : 'Draft'));
    card.appendChild(title);
    if (s.subtitle) card.appendChild(el('p', 'qbl-mission-about', s.subtitle));
    const actions = el('div', 'qbl-teach-actions');
    actions.appendChild(link(TEACH_PATHS.edit(s.id), 'qbl-teach-look primary', 'Edit', 'editor'));
    if (s.published_at) actions.appendChild(link(TEACH_PATHS.play(s.code), 'qbl-teach-look', 'Play', 'play'));
    card.appendChild(actions);
    grid.appendChild(card);
  }
  // Always last: the way to make another.
  const add = link(TEACH_PATHS.newScenario, 'qbl-teach-card qbl-teach-add', own.length ? 'New scenario' : 'Make your first scenario', 'new');
  add.dataset.tile = 'new-card';
  grid.appendChild(add);
  wrap.appendChild(grid);
  return wrap;
}

/**
 * The teacher's part of the page, drawn at once with the shortcuts and filled in when `desk`
 * arrives. `user` decides which scenarios are "yours" (an admin's list is every scenario).
 */
export function buildTeacherDesk(desk: Promise<TeacherDesk>, user: { id?: number | string; role: string }, now = new Date()): HTMLElement {
  const root = el('div', 'qbl-teach');
  const top = tiles();
  const slot = el('div', 'qbl-teach-slot');
  slot.appendChild(el('p', 'qbl-teach-empty', 'Loading your classes…'));
  root.append(top.root, slot);
  void desk
    .catch((): TeacherDesk => ({ assignments: null, scenarios: null, students: null }))
    .then((d) => {
      const own = d.scenarios ? ownScenarios(d.scenarios, user.id, editsAllScenarios(user.role)) : [];
      top.fill(d, own);
      slot.replaceChildren(assignmentsSection(d, now), scenariosSection(d, own));
    });
  return root;
}

/** The missions a teacher can play, under a heading that says what they are for. */
export function teacherMissionsHeading(missions: Mission[]): string {
  return missions.some((m) => m.kind === 'assigned') ? 'Missions to play' : 'Missions to try';
}
