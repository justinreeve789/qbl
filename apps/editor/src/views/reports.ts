import type { ActivityLine, Api, Assignment, MessageLine, Report, StudentReport } from '../api';
import { clear, h, help } from '../dom';

/** "1 h 5 min", "12 min", "40 s". */
export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

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

const ACTIVITY: Record<string, string> = {
  join: 'Came in', leave: 'Left', scene: 'Went to', hotspot: 'Used', choice: 'Answered', objective: 'Completed', glossary: 'Learned the word', award: 'Earned', narration: 'Listened to',
};

/**
 * The report on one assignment: how each student did (time, objectives, answers, words,
 * evidence of what the mission teaches), what they did step by step, and what they wrote to
 * each other. It is read from the activity the game server logs and from the save data.
 */
export function reportView(api: Api, assignment: Assignment, back: () => void): HTMLElement {
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  const title = assignment.scenario?.title ?? 'Assignment';
  let tab: 'students' | 'messages' = 'students';
  let report: Report | null = null;
  let messages: MessageLine[] | null = null;
  const open = new Set<number>();
  const logs = new Map<number, ActivityLine[]>();

  const stat = (value: string | number, label: string) => h('div', { class: 'report-stat' }, h('strong', null, String(value)), h('span', null, label));
  const bar = (done: number, total: number) => h('span', { class: 'report-bar', title: `${done} of ${total}` }, h('i', { style: `width:${total ? Math.round((done / total) * 100) : 0}%` }));

  const detail = (s: StudentReport, r: Report): HTMLElement => {
    const log = logs.get(s.id);
    const objectives = r.objectives.map((o) => {
      const mine = s.objectives.find((x) => String(x.id) === String(o.id));
      return h('li', null, `${mine?.complete ? '✅' : '⬜'} ${o.optional ? 'Bonus: ' : ''}${o.text}`);
    });
    const learning = r.learning_objectives.map((lo) => {
      const mine = s.learning.find((x) => String(x.id) === String(lo.id));
      const evidence = (mine?.evidence ?? []).map((e) => h('li', null, `${e.interaction ?? e.type ?? 'evidence'}: ${Object.entries(e.values).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v === '' ? '(none yet)' : v}`).join(', ') || 'nothing recorded yet'}`));
      return h('li', null, lo.text, lo.standards.length ? h('span', { class: 'muted' }, ` (${lo.standards.join(', ')})`) : null, evidence.length ? h('ul', null, ...evidence) : null);
    });
    return h('div', { class: 'report-detail' },
      h('div', null, h('h3', null, 'Objectives'), objectives.length ? h('ul', null, ...objectives) : h('p', { class: 'muted' }, 'This mission has no objectives.')),
      h('div', null, h('h3', null, 'Questions', help('Every answer chosen in an infobox. The first answer is what the student thought before any feedback; one try means they got to go on at once.')),
        s.questions.length
          ? h('ul', null, ...s.questions.map((q) => h('li', null, q.attempts === 1 ? `“${q.first_answer ?? ''}” in one try` : `First “${q.first_answer ?? ''}”, then “${q.last_answer ?? ''}” after ${q.attempts} tries`)))
          : h('p', { class: 'muted' }, 'No questions answered yet.')),
      learning.length ? h('div', null, h('h3', null, 'What the mission teaches'), h('ul', null, ...learning)) : null,
      h('div', null, h('h3', null, 'Where they went'), h('p', null, s.scenes_visited.join(', ') || 'Nowhere yet'), s.badges.length ? h('p', null, `Badges: ${s.badges.join(', ')}`) : null,
        h('p', { class: 'muted' }, s.first_seen ? `First played ${when(s.first_seen)}; last seen ${when(s.last_seen)}${s.scene ? ` in ${s.scene}` : ''}.` : 'Has not played yet.')),
      h('div', null, h('h3', null, 'Step by step'),
        log
          ? log.length
            ? h('ul', null, ...[...log].reverse().slice(-60).map((l) => h('li', null, `${when(l.at)}: ${ACTIVITY[l.type] ?? l.type}${l.label ? ` “${l.label}”` : ''}${l.type === 'award' && l.value ? ` (${l.value} stars)` : ''}`)))
            : h('p', { class: 'muted' }, 'Nothing logged yet.')
          : h('button', {
              type: 'button',
              onclick: async () => {
                logs.set(s.id, await api.activity(assignment.id, s.id).catch(() => []));
                draw();
              },
            }, 'Show what they did')),
    );
  };

  const students = (r: Report): HTMLElement => {
    const rows: HTMLElement[] = [];
    for (const s of r.students) {
      const oneTry = s.questions.filter((q) => q.attempts === 1).length;
      rows.push(h('tr', { 'data-student': s.id },
        h('td', null, h('button', { type: 'button', class: 'link', 'aria-expanded': String(open.has(s.id)), onclick: () => {
          if (open.has(s.id)) open.delete(s.id);
          else open.add(s.id);
          draw();
        } }, s.name), s.team ? h('span', { class: 'badge team' }, s.team) : null),
        h('td', null, !s.started ? h('span', { class: 'muted' }, 'Not started') : s.finished ? '✅ Finished' : 'In progress'),
        h('td', { class: 'num' }, s.started ? duration(s.time_spent) : ''),
        h('td', null, bar(s.objectives_done, s.objectives_total), `${s.objectives_done}/${s.objectives_total}`),
        h('td', { class: 'num' }, s.questions.length ? `${oneTry}/${s.questions.length}` : ''),
        h('td', { class: 'num' }, s.words_total ? `${s.words_learned}/${s.words_total}` : ''),
        h('td', { class: 'num' }, String(s.hotspots_used)),
        h('td', { class: 'num' }, s.stars_earned ? `⭐ ${s.stars_earned}` : ''),
        h('td', { class: 'num' }, s.messages ? String(s.messages) : ''),
        h('td', null, when(s.last_seen))));
      if (open.has(s.id)) rows.push(h('tr', { class: 'detail' }, h('td', { colspan: 10 }, detail(s, r))));
    }
    const m = r.summary;
    return h('div', null,
      h('div', { class: 'report-summary' },
        stat(`${m.started}/${m.students}`, 'students have started'),
        stat(`${m.finished}/${m.students}`, 'have finished every objective'),
        stat(duration(m.average_time_spent), 'average time spent'),
        stat(m.objectives_total ? `${m.average_objectives_done}/${m.objectives_total}` : '–', 'objectives done, on average'),
        stat(m.questions_answered ? `${Math.round((m.answered_in_one_try / m.questions_answered) * 100)}%` : '–', 'of questions answered in one try'),
        stat(m.words_total ? `${m.average_words_learned}/${m.words_total}` : '–', 'glossary words, on average')),
      r.objectives.length
        ? h('p', { class: 'muted' }, 'Objectives completed: ', r.objectives.map((o) => `${o.text} (${o.completed_by}/${m.students})`).join(' · '))
        : null,
      h('div', { class: 'report-scroll' }, h('table', { class: 'report-table' },
        h('thead', null, h('tr', null, h('th', null, 'Student'), h('th', null, 'Progress'), h('th', { class: 'num' }, 'Time'), h('th', null, 'Objectives'),
          h('th', { class: 'num', title: 'Questions answered in one try, of those answered' }, 'One try'), h('th', { class: 'num' }, 'Words'), h('th', { class: 'num', title: 'Hotspots used' }, 'Explored'),
          h('th', { class: 'num' }, 'Stars'), h('th', { class: 'num' }, 'Messages'), h('th', null, 'Last seen'))),
        h('tbody', null, ...rows))),
      h('p', { class: 'muted' }, 'Click a name for that student’s objectives, answers, evidence and steps. Time is time in the mission; "one try" counts questions where the first answer let them go on. Activity is logged from when this version of the game server was installed.'));
  };

  const messageLog = (list: MessageLine[]): HTMLElement =>
    list.length
      ? h('div', { class: 'report-scroll message-log' }, h('table', { class: 'report-table' },
          h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'From'), h('th', null, 'To'), h('th', null, 'Message'))),
          h('tbody', null, ...list.map((l) => h('tr', { class: l.kind === 'private' ? 'private' : '' },
            h('td', null, when(l.at)), h('td', null, l.name ?? `#${l.user_id}`),
            h('td', null, l.kind === 'private' ? `${l.to_name ?? `#${l.to_user_id ?? '?'}`} (private)` : 'Everyone in the scene'),
            h('td', null, l.text))))))
      : h('p', { class: 'empty' }, 'No messages have been sent in this assignment.');

  function draw() {
    const tabs = h('nav', { class: 'tabs' },
      h('a', { href: '#/classes', class: tab === 'students' ? 'current' : null, onclick: (e: Event) => { e.preventDefault(); tab = 'students'; draw(); } }, 'Students'),
      h('a', { href: '#/classes', class: tab === 'messages' ? 'current' : null, onclick: (e: Event) => { e.preventDefault(); tab = 'messages'; void loadMessages(); } }, 'Messages'));
    clear(body, tabs, tab === 'students' ? (report ? students(report) : h('p', { class: 'muted' }, 'Loading…')) : (messages ? messageLog(messages) : h('p', { class: 'muted' }, 'Loading…')));
  }
  async function loadMessages() {
    draw();
    messages ??= await api.messageLog(assignment.id).catch(() => []);
    draw();
  }

  void api.report(assignment.id).then((r) => {
    report = r;
    draw();
  }, (err) => clear(body, h('p', { class: 'issue error' }, err instanceof Error ? err.message : 'Could not load the report.')));

  return h('div', { class: 'card', 'data-card': 'report' },
    h('div', { class: 'page-head' },
      h('div', null, h('h2', null, `Report: ${title}`, help('How students are doing in this mission. Team members share what their team shares (a path one of them cleared counts for all), and each has their own answers, words and time.'))),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', onclick: () => report && download(`${title.replace(/[^\w-]+/g, '-').toLowerCase()}-report.csv`, reportCsv(report)) }, 'Download as CSV'),
        h('button', { type: 'button', onclick: back }, '← Back to classes'))),
    body);
}
