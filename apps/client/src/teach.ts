import { icon } from './ui/icons';
import { dueLabel, dueRank } from './home';

/**
 * The teacher's part of the missions page. Students land on the page to play; teachers and
 * admins land there to assign and watch too, so for them the page opens with the missions they
 * have assigned (with a "Look in" per team), each scenario once. The editor, Classes and the
 * docs are in the bar at the top of the page. Everything here comes from the APIs the editor
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
  /** The mission waits for its teacher and has not been launched: its students do not see it yet. */
  waiting?: boolean;
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

/**
 * What the teacher's part of the page needs: their assignments, and the scenarios they may edit
 * (whose mission cards get "Edit"). Each list is null when it could not be loaded.
 */
export interface TeacherDesk {
  assignments: TeachAssignment[] | null;
  scenarios: TeachScenario[] | null;
}

/** Where the teacher's links go. The editor keeps its pages in the fragment. */
export const TEACH_PATHS = {
  newScenario: '/editor/#/new',
  classes: '/editor/#/classes',
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
export function assignmentTags(a: TeachAssignment, now: Date, locale?: string): Array<{ text: string; tone: 'plain' | 'team' | 'due' | 'late' | 'waiting' }> {
  const tags: Array<{ text: string; tone: 'plain' | 'team' | 'due' | 'late' | 'waiting' }> = [];
  // Students do not see it yet: the teacher launches it from the game, or shows it on the Classes page.
  if (a.waiting) tags.push({ text: 'Waiting for you to launch it', tone: 'waiting' });
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
  return [...list].sort((x, y) => {
    const [a1, a2] = dueRank(x.due_at, now);
    const [b1, b2] = dueRank(y.due_at, now);
    return a1 - b1 || a2 - b2 || y.id - x.id;
  });
}

/**
 * The teacher's assignments, one entry per scenario: a mission given to two classes (or twice to
 * one) is listed once, with each assignment under it. In `sortAssignments` order, a scenario
 * where its soonest assignment would be; one whose scenario is gone stays on its own.
 */
export function assignmentsByScenario(list: TeachAssignment[], now: Date): TeachAssignment[][] {
  const out: TeachAssignment[][] = [];
  const at = new Map<number, TeachAssignment[]>();
  for (const a of sortAssignments(list, now)) {
    const same = a.scenario ? at.get(a.scenario.id) : undefined;
    if (same) {
      same.push(a);
      continue;
    }
    const entry = [a];
    out.push(entry);
    if (a.scenario) at.set(a.scenario.id, entry);
  }
  return out;
}

/** The scenarios the teacher may edit; the shared samples are left to the editor's list. An admin may edit all of them. */
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

/** One assignment's line: its labels, the teacher's note and the ways to look in. */
function assignmentLine(a: TeachAssignment, now: Date): HTMLElement[] {
  const out: HTMLElement[] = [];
  const tags = el('div', 'qbl-mission-tags');
  for (const t of assignmentTags(a, now)) tags.appendChild(el('span', `qbl-tag ${t.tone}`, t.text));
  out.push(tags);
  if (a.note) out.push(el('p', 'qbl-mission-note', a.note));
  const ways = lookInLinks(a);
  if (ways.length) {
    const actions = el('div', 'qbl-teach-actions');
    actions.appendChild(el('span', 'qbl-teach-label', ways.length > 1 ? 'Look in:' : ''));
    for (const w of ways) {
      const go = link(w.href, 'qbl-teach-look', w.label, 'look-in');
      go.title = ways.length > 1 ? `Join team ${w.label}'s game` : 'Join this class\'s game';
      actions.appendChild(go);
    }
    out.push(actions);
  }
  return out;
}

/**
 * The missions the teacher has assigned, at the top of their page: each scenario once, soonest
 * due first, with the due date, the students and a way to look in on each team.
 */
export function teacherAssignments(desk: TeacherDesk, now: Date): HTMLElement {
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
    p.append(link(TEACH_PATHS.classes, '', 'Classes page'), document.createTextNode(', or browse the missions below.'));
    wrap.appendChild(p);
    return wrap;
  }
  const list = el('div', 'qbl-teach-list');
  for (const group of assignmentsByScenario(desk.assignments, now)) {
    const first = group[0]!;
    const row = el('article', 'qbl-teach-row');
    row.dataset.assignment = group.map((a) => a.id).join(' ');
    const art = el('div', 'qbl-teach-art');
    if (first.scenario?.image) art.style.backgroundImage = `url("${first.scenario.image}")`;
    const body = el('div', 'qbl-teach-body');
    body.appendChild(el('h3', undefined, first.scenario?.title ?? 'A scenario that is no longer published'));
    if (group.length === 1) body.append(...assignmentLine(first, now));
    else {
      // The same mission given more than once: a line for each assignment, under the one title.
      for (const a of group) {
        const line = el('div', 'qbl-teach-line');
        line.dataset.assignment = String(a.id);
        line.append(...assignmentLine(a, now));
        body.appendChild(line);
      }
    }
    row.append(art, body);
    list.appendChild(row);
  }
  wrap.appendChild(list);
  wrap.appendChild(el('p', 'qbl-teach-hint', 'Students see these on their own missions page when they sign in. Looking in, you join their game as a visible player.'));
  return wrap;
}
