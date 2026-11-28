import type { ActivityLine, Api, Assignment, MessageLine, Report, StudentReport } from '../api';
import { ApiError } from '../api';
import { clear, h, help, toast } from '../dom';
import { emojiIcon } from '../icons';

/** "1 h 5 min", "12 min", "40 s". */
export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { timeStyle: 'short' });
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then the date. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const seconds = (now - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86400);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The report's table of students as CSV: one line per student, for a gradebook or a spreadsheet. */
export function reportCsv(report: Report): string {
  const cell = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Student', 'Team', 'Started', 'Finished', 'Minutes', 'Visits', 'Objectives done', 'Objectives', 'Hotspots used', 'Questions answered', 'Answered in one try', 'Words learned', 'Words', 'Stars earned', 'XP earned', 'Badges', 'Messages', 'First seen', 'Last seen'];
  const rows = report.students.map((s) => [
    s.name, s.team ?? '', s.started ? 'yes' : 'no', s.finished ? 'yes' : 'no', Math.round(s.time_spent / 60), s.visits, s.objectives_done, s.objectives_total, s.hotspots_used,
    s.questions.length, s.questions.filter((q) => q.attempts === 1).length, s.words_learned, s.words_total, s.stars_earned, s.xp_earned, s.badges.join('; '), s.messages, s.first_seen ?? '', s.last_seen ?? '',
  ]);
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}

function download(name: string, text: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/** What each logged step says, and its icon, in the step-by-step timeline. */
const ACTIVITY: Record<string, [string, string]> = {
  join: ['Came in', '👋'], leave: ['Left', '🚪'], scene: ['Went to', '🧭'], hotspot: ['Used', '👆'], choice: ['Answered', '💬'],
  objective: ['Completed', '✅'], glossary: ['Learned the word', '📖'], award: ['Earned', '🏅'], narration: ['Listened to', '🔊'],
  reset: ['Progress reset by', '↺'],
};

/** What the teacher is asked before resetting a student's progress: what goes, and what stays. */
export function resetQuestion(student: Pick<StudentReport, 'name' | 'team'>, mission: string): string {
  return [
    `Reset ${student.name}’s progress in ${mission}?`,
    '',
    'Their saved game in this assignment is deleted: next time they play, they start again from the beginning. If they are playing now, they are sent back to the start within a minute. What they built and wrote in their notebook here goes too.',
    '',
    'What stays:',
    '• the step-by-step log and their messages (the report counts again from the reset),',
    '• the stars, XP and badges they earned (awards they already had are not given twice),',
    ...(student.team ? [`• what ${student.team} did together: the team’s world is shared, so a path they cleared stays cleared.`] : []),
    '',
    'This cannot be undone.',
  ].join('\n');
}

type Status = 'finished' | 'progress' | 'idle';
const STATUS: Record<Status, string> = { finished: 'Finished', progress: 'In progress', idle: 'Not started' };
const statusOf = (s: StudentReport): Status => (!s.started ? 'idle' : s.finished ? 'finished' : 'progress');

type Sort = 'name' | 'progress' | 'time' | 'recent';
const SORTS: Record<Sort, string> = { name: 'Name', progress: 'Progress', time: 'Time in mission', recent: 'Last seen' };
const RANK: Record<Status, number> = { finished: 2, progress: 1, idle: 0 };
const sorters: Record<Sort, (a: StudentReport, b: StudentReport) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  progress: (a, b) => RANK[statusOf(b)] - RANK[statusOf(a)] || b.objectives_done - a.objectives_done || a.name.localeCompare(b.name),
  time: (a, b) => b.time_spent - a.time_spent || a.name.localeCompare(b.name),
  recent: (a, b) => (b.last_seen ?? '').localeCompare(a.last_seen ?? '') || a.name.localeCompare(b.name),
};

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
/** A student's avatar keeps its color wherever it appears (it follows the student, not the row). */
const avatar = (id: number, name: string, small = false) => h('span', { class: `report-avatar${small ? ' small' : ''}`, 'data-hue': String(Math.abs(id) % 8), 'aria-hidden': 'true' }, initials(name));

/**
 * The report on one assignment: how each student did (time, objectives, answers, words,
 * evidence of what the mission teaches), what they did step by step, and what they wrote to
 * each other. It is read from the activity the game server logs and from the save data.
 */
export function reportView(api: Api, assignment: Assignment, back: () => void): HTMLElement {
  const body = h('div', { class: 'report-body' }, h('p', { class: 'muted report-loading' }, 'Loading the report…'));
  const title = assignment.scenario?.title ?? 'Assignment';
  let tab: 'students' | 'messages' = 'students';
  let report: Report | null = null;
  let messages: MessageLine[] | null = null;
  let filter: Status | 'all' = 'all';
  let sort: Sort = 'name';
  const open = new Set<number>();
  const logs = new Map<number, ActivityLine[]>();

  // ------------------------------------------------------------ small pieces
  /** A labelled panel in the overview. */
  const panel = (heading: string, note: string | null, ...children: Array<Node | null>) =>
    h('section', { class: 'report-panel' }, h('header', null, h('h3', null, heading), note ? help(note) : null), ...children);

  /** A ratio against its whole: a same-hue track, filled to the share. */
  const meter = (done: number, total: number, hue: string, tip?: string) =>
    h('span', { class: 'report-meter', 'data-hue': hue, role: 'img', 'aria-label': tip ?? `${done} of ${total}`, 'data-tip': tip ?? null, tabindex: tip ? '0' : null },
      h('i', { style: `width:${pct(done, total)}%` }));

  const tile = (emoji: string, hue: string, value: string, unit: string | null, label: string, ratio?: [number, number]) =>
    h('div', { class: 'report-tile', 'data-hue': hue },
      h('span', { class: 'report-tile-icon' }, emojiIcon(emoji)),
      h('div', { class: 'report-tile-text' },
        h('strong', null, value, unit ? h('small', null, unit) : null),
        h('span', null, label)),
      ratio ? meter(ratio[0], ratio[1], hue) : null);

  // ---------------------------------------------------------------- overview
  const overview = (r: Report): HTMLElement => {
    const m = r.summary;
    const counts: Record<Status, number> = { finished: m.finished, progress: m.started - m.finished, idle: m.students - m.started };
    const segments = (['finished', 'progress', 'idle'] as Status[]).filter((k) => counts[k] > 0).map((k) => {
      const share = pct(counts[k], m.students);
      const tip = `${STATUS[k]}: ${counts[k]} of ${m.students} (${share}%)`;
      return h('span', { class: 'report-segment', 'data-status': k, style: `flex-grow:${counts[k]}`, tabindex: '0', 'data-tip': tip, 'aria-label': tip },
        share >= 12 ? h('b', null, `${share}%`) : null);
    });
    const progress = panel('Class progress', null,
      h('div', { class: 'report-hero' },
        h('strong', null, `${m.started}/${m.students}`),
        h('span', null, 'students have started')),
      h('div', { class: 'report-segments', role: 'group', 'aria-label': 'Students by progress' }, ...segments),
      h('ul', { class: 'report-legend' }, ...(['finished', 'progress', 'idle'] as Status[]).map((k) =>
        h('li', { 'data-status': k }, h('i', null), STATUS[k], h('b', null, String(counts[k]))))));

    const oneTry = pct(m.answered_in_one_try, m.questions_answered);
    const tiles = h('div', { class: 'report-tiles' },
      tile('⏱️', 'blue', m.started ? duration(m.average_time_spent) : '–', null, 'average time in the mission'),
      tile('🎯', 'green', m.objectives_total ? String(m.average_objectives_done) : '–', m.objectives_total ? `/ ${m.objectives_total}` : null, 'objectives done, on average', m.objectives_total ? [m.average_objectives_done, m.objectives_total] : undefined),
      tile('⚡', 'yellow', m.questions_answered ? `${oneTry}%` : '–', null, 'of questions answered in one try', m.questions_answered ? [m.answered_in_one_try, m.questions_answered] : undefined),
      tile('📖', 'violet', m.words_total ? String(m.average_words_learned) : '–', m.words_total ? `/ ${m.words_total}` : null, 'glossary words, on average', m.words_total ? [m.average_words_learned, m.words_total] : undefined));

    const objectiveList = r.objectives.length
      ? h('ul', { class: 'report-meters' }, ...r.objectives.map((o) =>
          h('li', null,
            h('span', { class: 'report-meter-label' }, o.optional ? h('span', { class: 'report-chip bonus' }, 'Bonus') : null, o.text),
            meter(o.completed_by, m.students, 'green', `${o.text}: ${o.completed_by} of ${m.students} students (${pct(o.completed_by, m.students)}%)`),
            h('span', { class: 'report-meter-value' }, h('b', null, String(o.completed_by)), ` of ${m.students}`))))
      : h('p', { class: 'muted' }, 'This mission has no objectives.');

    const learning = r.learning_objectives.length
      ? panel('What the mission teaches', 'Students with at least one piece of evidence recorded for each learning goal. Open a student to see the evidence itself.',
          h('ul', { class: 'report-meters' }, ...r.learning_objectives.map((lo) => {
            const shown = r.students.filter((s) => s.learning.some((x) => String(x.id) === String(lo.id) && x.evidence.length)).length;
            return h('li', null,
              h('span', { class: 'report-meter-label' }, lo.text, ...lo.standards.map((code) => h('span', { class: 'report-chip standard' }, code))),
              meter(shown, m.students, 'magenta', `${lo.text}: evidence from ${shown} of ${m.students} students`),
              h('span', { class: 'report-meter-value' }, h('b', null, String(shown)), ` of ${m.students}`));
          })))
      : null;

    return h('div', { class: 'report-summary' },
      h('div', { class: 'report-row lead' }, progress, tiles),
      h('div', { class: `report-row${learning ? '' : ' single'}` },
        panel('Objectives completed', 'How many students have completed each objective. Team members share what their team completes.', objectiveList),
        learning));
  };

  // ------------------------------------------------------- one student, open
  const detail = (s: StudentReport, r: Report): HTMLElement => {
    const log = logs.get(s.id);
    const fact = (emoji: string, value: string | number, label: string) => h('li', null, emojiIcon(emoji), h('b', null, String(value)), ` ${label}`);
    const facts = h('ul', { class: 'report-facts' },
      fact('⏱️', s.started ? duration(s.time_spent) : '0 min', 'in the mission'),
      fact('🔁', s.visits, s.visits === 1 ? 'visit' : 'visits'),
      fact('👆', s.hotspots_used, 'hotspots explored'),
      fact('⭐', s.stars_earned, 'stars'),
      fact('✨', s.xp_earned, 'XP'),
      fact('💬', s.messages, s.messages === 1 ? 'message' : 'messages'));

    const objectives = r.objectives.map((o) => {
      const done = Boolean(s.objectives.find((x) => String(x.id) === String(o.id))?.complete);
      return h('li', { class: done ? 'done' : null }, h('span', { class: 'report-check', 'aria-label': done ? 'Done' : 'Not done' }), o.optional ? h('span', { class: 'report-chip bonus' }, 'Bonus') : null, o.text);
    });
    const learning = r.learning_objectives.map((lo) => {
      const evidence = s.learning.find((x) => String(x.id) === String(lo.id))?.evidence ?? [];
      return h('li', null,
        h('div', { class: 'report-goal' }, lo.text, ...lo.standards.map((code) => h('span', { class: 'report-chip standard' }, code))),
        evidence.length
          ? h('div', { class: 'report-evidence' }, ...evidence.map((e) => h('dl', null,
              h('dt', { class: 'kind' }, e.interaction ?? e.type ?? 'Evidence'),
              ...(Object.entries(e.values).length
                ? Object.entries(e.values).flatMap(([k, v]) => [h('dt', null, k.replace(/_/g, ' ')), h('dd', null, v === '' ? '(none yet)' : String(v))])
                : [h('dd', { class: 'muted' }, 'nothing recorded yet')]))))
          : h('p', { class: 'muted small' }, 'No evidence yet.'));
    });

    const section = (heading: string, note: string | null, ...children: Array<Node | null>) =>
      h('section', null, h('h3', null, heading, note ? help(note) : null), ...children);

    const steps = (() => {
      if (!log) {
        return h('button', {
          type: 'button', class: 'report-load',
          onclick: async () => {
            logs.set(s.id, await api.activity(assignment.id, s.id).catch(() => []));
            draw();
          },
        }, emojiIcon('🕒'), 'Show what they did');
      }
      if (!log.length) return h('p', { class: 'muted' }, 'Nothing logged yet.');
      const latest = [...log].sort((a, b) => a.at.localeCompare(b.at)).slice(-60);
      const items: HTMLElement[] = [];
      let lastDay = '';
      for (const l of latest) {
        const d = day(l.at);
        if (d !== lastDay) items.push(h('li', { class: 'report-day' }, d));
        lastDay = d;
        const [verb, emoji] = ACTIVITY[l.type] ?? [l.type, '•'];
        items.push(h('li', { 'data-type': l.type },
          h('time', { datetime: l.at }, clock(l.at)),
          h('span', { class: 'report-step-icon' }, emojiIcon(emoji)),
          h('span', { class: 'report-step-text' }, verb, l.label ? h('b', null, ` ${l.label}`) : null, l.type === 'award' && l.value ? ` (${l.value} stars)` : null)));
      }
      return h('div', null,
        log.length > latest.length ? h('p', { class: 'muted small' }, `The latest ${latest.length} of ${log.length} steps.`) : null,
        h('ol', { class: 'report-timeline' }, ...items));
    })();

    return h('div', { class: 'report-detail' },
      facts,
      h('div', { class: 'report-detail-grid' },
        section('Objectives', null, objectives.length ? h('ul', { class: 'report-checklist' }, ...objectives) : h('p', { class: 'muted' }, 'This mission has no objectives.')),
        section('Questions', 'Every answer chosen in an infobox. The first answer is what the student thought before any feedback; one try means they got to go on at once.',
          s.questions.length
            ? h('ul', { class: 'report-answers' }, ...s.questions.map((q) => h('li', null,
                h('span', { class: `report-pill ${q.attempts === 1 ? 'good' : 'warn'}` }, q.attempts === 1 ? '⚡ First try' : `↻ ${q.attempts} tries`),
                q.attempts === 1 || q.first_answer === q.last_answer
                  ? h('span', null, `“${q.first_answer ?? ''}”`)
                  : h('span', null, h('s', null, `“${q.first_answer ?? ''}”`), ' → ', `“${q.last_answer ?? ''}”`))))
            : h('p', { class: 'muted' }, 'No questions answered yet.')),
        learning.length ? section('What the mission teaches', null, h('ul', { class: 'report-goals' }, ...learning)) : null,
        section('Where they went', null,
          s.scenes_visited.length
            ? h('ul', { class: 'report-trail' }, ...s.scenes_visited.map((name) => h('li', { class: name === s.scene ? 'here' : null, title: name === s.scene ? 'Last seen here' : null }, name)))
            : h('p', { class: 'muted' }, 'Nowhere yet'),
          s.badges.length ? h('ul', { class: 'report-badges' }, ...s.badges.map((b) => h('li', null, emojiIcon('🏅'), b))) : null,
          h('p', { class: 'muted small' }, s.first_seen ? `First played ${when(s.first_seen)}. Last seen ${when(s.last_seen)}${s.scene ? ` in ${s.scene}` : ''}.` : s.reset_at ? 'Has not played since the reset.' : 'Has not played yet.')),
        h('section', { class: 'report-steps' }, h('h3', null, 'Step by step'), steps)),
      h('div', { class: 'report-detail-foot' },
        s.reset_at ? h('p', { class: 'muted small', 'data-reset-at': s.reset_at }, `↺ Progress reset ${when(s.reset_at)}${s.reset_by ? ` by ${s.reset_by}` : ''}. The report counts from then.`) : h('span'),
        h('button', {
          type: 'button', class: 'danger', 'data-action': 'reset-progress',
          title: 'Delete this student’s saved game in this assignment, so they start the mission again',
          onclick: async (e: Event) => {
            if (!window.confirm(resetQuestion(s, title))) return;
            const button = e.currentTarget as HTMLButtonElement;
            button.disabled = true;
            try {
              await api.resetProgress(assignment.id, s.id);
              logs.delete(s.id);
              toast(`${s.name} will start ${title} again from the beginning.`);
              await reload();
            } catch (err) {
              button.disabled = false;
              toast(err instanceof ApiError || err instanceof Error ? err.message : 'Could not reset the progress.', 'error');
            }
          },
        }, '↺ Reset progress')));
  };

  // ------------------------------------------------------------ the students
  const students = (r: Report): HTMLElement => {
    const counts: Record<Status | 'all', number> = { all: r.students.length, finished: 0, progress: 0, idle: 0 };
    for (const s of r.students) counts[statusOf(s)]++;
    const shown = r.students.filter((s) => filter === 'all' || statusOf(s) === filter).sort(sorters[sort]);
    const toggle = (s: StudentReport) => {
      if (open.has(s.id)) open.delete(s.id);
      else open.add(s.id);
      draw();
    };

    const rows: HTMLElement[] = [];
    for (const s of shown) {
      const status = statusOf(s);
      const oneTry = s.questions.filter((q) => q.attempts === 1).length;
      const isOpen = open.has(s.id);
      const row = h('tr', { 'data-student': s.id, class: isOpen ? 'open' : null },
        h('td', null, h('div', { class: 'report-who' },
          avatar(s.id, s.name),
          h('div', null,
            h('button', { type: 'button', class: 'link', 'aria-expanded': String(isOpen), onclick: () => toggle(s) }, s.name),
            s.team ? h('span', { class: 'report-team' }, s.team) : null))),
        h('td', null, h('span', { class: 'report-status', 'data-status': status }, h('i', null), STATUS[status])),
        h('td', null, h('div', { class: 'report-cell-meter' }, meter(s.objectives_done, s.objectives_total, 'green'), h('span', null, h('b', null, String(s.objectives_done)), `/${s.objectives_total}`))),
        h('td', { class: 'num' }, s.started ? duration(s.time_spent) : h('span', { class: 'faint' }, '—')),
        h('td', null, s.questions.length
          ? h('div', { class: 'report-tries', title: `${oneTry} of ${s.questions.length} answered in one try` },
              s.questions.length <= 8 ? h('span', { class: 'report-dots', 'aria-hidden': 'true' }, ...s.questions.map((q) => h('i', { class: q.attempts === 1 ? 'good' : 'warn' }))) : null,
              h('span', null, h('b', null, String(oneTry)), `/${s.questions.length}`))
          : h('span', { class: 'faint' }, '—')),
        h('td', { class: 'num' }, s.words_total ? h('span', null, h('b', null, String(s.words_learned)), `/${s.words_total}`) : h('span', { class: 'faint' }, '—')),
        h('td', { class: 'num' }, s.stars_earned ? h('span', { class: 'report-stars' }, emojiIcon('⭐'), String(s.stars_earned)) : h('span', { class: 'faint' }, '—')),
        h('td', { class: 'num', title: when(s.last_seen) || null }, s.last_seen ? ago(s.last_seen) : h('span', { class: 'faint' }, 'Never')),
        h('td', { class: 'report-chevron', 'aria-hidden': 'true' }, '›'));
      row.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('button, a')) toggle(s);
      });
      rows.push(row);
      if (isOpen) rows.push(h('tr', { class: 'detail' }, h('td', { colspan: 9 }, detail(s, r))));
    }

    const chip = (key: Status | 'all', label: string) => h('button', {
      type: 'button', class: 'report-filter', 'data-status': key, 'aria-pressed': String(filter === key),
      onclick: () => { filter = key; draw(); },
    }, key === 'all' ? null : h('i', null), label, h('b', null, String(counts[key])));

    const sortSelect = h('select', { 'aria-label': 'Sort students', onchange: (e: Event) => { sort = (e.target as HTMLSelectElement).value as Sort; draw(); } },
      ...(Object.keys(SORTS) as Sort[]).map((k) => h('option', { value: k, selected: k === sort }, SORTS[k])));

    return h('section', { class: 'report-students' },
      h('header', { class: 'report-students-head' },
        h('h3', null, 'Students', help('Click a student for their objectives, answers, evidence and steps. Time is time in the mission; a first try is a question where the first answer let them go on. Activity is logged from when this version of the game server was installed.')),
        h('div', { class: 'report-filters', role: 'group', 'aria-label': 'Show students' },
          chip('all', 'All'), chip('finished', STATUS.finished), chip('progress', STATUS.progress), chip('idle', STATUS.idle)),
        h('label', { class: 'report-sort' }, h('span', null, 'Sort by'), sortSelect)),
      h('div', { class: 'report-scroll' }, h('table', { class: 'report-table' },
        h('thead', null, h('tr', null,
          h('th', null, 'Student'), h('th', null, 'Progress'), h('th', null, 'Objectives'), h('th', { class: 'num' }, 'Time'),
          h('th', { title: 'Questions answered in one try, of those answered' }, 'First try'), h('th', { class: 'num' }, 'Words'),
          h('th', { class: 'num' }, 'Stars'), h('th', { class: 'num' }, 'Last seen'), h('th', { 'aria-label': 'Open' }))),
        h('tbody', null, ...rows))),
      shown.length ? null : h('p', { class: 'empty' }, 'No students here.'));
  };

  // ------------------------------------------------------------ the messages
  const messageLog = (list: MessageLine[]): HTMLElement => {
    if (!list.length) return h('p', { class: 'empty' }, 'No messages have been sent in this assignment.');
    const items: HTMLElement[] = [];
    let lastDay = '';
    for (const l of [...list].sort((a, b) => a.at.localeCompare(b.at))) {
      const d = day(l.at);
      if (d !== lastDay) items.push(h('li', { class: 'report-day' }, d));
      lastDay = d;
      const name = l.name ?? `#${l.user_id}`;
      items.push(h('li', { class: 'report-message', 'data-kind': l.kind },
        avatar(l.user_id, name, true),
        h('div', null,
          h('div', { class: 'report-message-head' },
            h('b', null, name),
            l.kind === 'private' ? h('span', { class: 'report-chip private' }, emojiIcon('🔒'), `to ${l.to_name ?? `#${l.to_user_id ?? '?'}`}`) : null,
            h('time', { datetime: l.at, title: when(l.at) }, clock(l.at))),
          h('p', { class: 'report-bubble' }, l.kind === 'emote' ? `${name} ${l.text}` : l.text))));
    }
    const privateCount = list.filter((l) => l.kind === 'private').length;
    return h('section', { class: 'report-messages' },
      h('p', { class: 'muted small' }, `${list.length} ${list.length === 1 ? 'message' : 'messages'}${privateCount ? `, ${privateCount} of them private` : ''}. Private messages are marked with a lock.`),
      h('ol', { class: 'message-log' }, ...items));
  };

  // --------------------------------------------------------------- the page
  function draw() {
    const total = messages ? messages.length : report ? report.students.reduce((n, s) => n + s.messages, 0) : null;
    const tabLink = (key: typeof tab, label: string, count: number | null, go: () => void) =>
      h('a', { href: '#/classes', class: tab === key ? 'current' : null, onclick: (e: Event) => { e.preventDefault(); go(); } },
        label, count != null ? h('span', { class: 'report-count' }, String(count)) : null);
    const tabs = h('nav', { class: 'tabs report-tabs' },
      tabLink('students', 'Students', report?.students.length ?? null, () => { tab = 'students'; draw(); }),
      tabLink('messages', 'Messages', total, () => { tab = 'messages'; void loadMessages(); }));
    const loading = h('p', { class: 'muted report-loading' }, 'Loading…');
    clear(body, tabs, tab === 'students'
      ? (report ? h('div', { class: 'report-stack' }, overview(report), students(report)) : loading)
      : (messages ? messageLog(messages) : loading));
  }
  async function loadMessages() {
    draw();
    messages ??= await api.messageLog(assignment.id).catch(() => []);
    draw();
  }

  async function reload() {
    try {
      report = await api.report(assignment.id);
      draw();
    } catch (err) {
      clear(body, h('p', { class: 'issue error' }, err instanceof Error ? err.message : 'Could not load the report.'));
    }
  }
  void reload();

  const due = assignment.due_at ? new Date(`${assignment.due_at.replace(' ', 'T')}Z`) : null;
  const card = h('div', { class: 'card report', 'data-card': 'report' },
    h('div', { class: 'report-head' },
      h('div', null,
        h('span', { class: 'report-eyebrow' }, emojiIcon('📊'), 'Mission report'),
        h('h2', null, title, help('How students are doing in this mission. Team members share what their team shares (a path one of them cleared counts for all), and each has their own answers, words and time.')),
        h('p', { class: 'report-meta' },
          assignment.students.length ? h('span', null, `${assignment.students.length} ${assignment.students.length === 1 ? 'student' : 'students'}`) : null,
          assignment.teams.length ? h('span', null, `${assignment.teams.length} ${assignment.teams.length === 1 ? 'team' : 'teams'}`) : null,
          due ? h('span', { class: due.getTime() < Date.now() ? 'late' : null }, `Due ${due.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`) : h('span', null, 'No due date')),
        assignment.note ? h('p', { class: 'report-note' }, assignment.note) : null),
      h('div', { class: 'report-actions' },
        h('button', { type: 'button', onclick: () => report && download(`${title.replace(/[^\w-]+/g, '-').toLowerCase()}-report.csv`, reportCsv(report)) }, emojiIcon('⬇️'), 'Download as CSV'),
        h('button', { type: 'button', onclick: back }, '← Back to classes'))),
    body);

  // One tooltip for every chart mark: on hover and on keyboard focus.
  const tip = h('div', { class: 'report-tip', role: 'tooltip', hidden: true });
  card.append(tip);
  const show = (e: Event) => {
    const mark = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
    if (!mark) return;
    tip.textContent = mark.dataset.tip ?? '';
    tip.hidden = false;
    const box = mark.getBoundingClientRect();
    const x = Math.min(Math.max(box.left + box.width / 2, tip.offsetWidth / 2 + 8), window.innerWidth - tip.offsetWidth / 2 - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${box.top - 8}px`;
  };
  const hide = (e: Event) => {
    if ((e.target as HTMLElement).closest?.('[data-tip]')) tip.hidden = true;
  };
  card.addEventListener('pointerover', show);
  card.addEventListener('focusin', show);
  card.addEventListener('pointerout', hide);
  card.addEventListener('focusout', hide);
  return card;
}
