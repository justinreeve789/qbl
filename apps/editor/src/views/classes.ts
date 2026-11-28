import { ApiError, type Api, type Assignment, type MissionSummary, type Student, type Team } from '../api';
import { playUrl } from '../config';
import { clear, confirmDelete, h, help, toast } from '../dom';
import { notebooksView } from './notebooks';
import { reportView } from './reports';
import { studentBuildsCard } from './studentBuilds';

/** A due date as the API keeps it (UTC, "2026-12-01 15:00:00") to and from a date-and-time field's local value. */
export function toLocalInput(utc: string | null): string {
  if (!utc) return '';
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(local: string): string | null {
  return local ? new Date(local).toISOString() : null;
}

const fail = (err: unknown, fallback: string) => toast(err instanceof ApiError || err instanceof Error ? err.message : fallback, 'error');

/**
 * Classes: the teacher's students, and the missions given to them. A mission is a published
 * scenario; assigning it puts it on those students' missions page, with a due date if wanted.
 * Students can be put into teams, and each team then plays in its own copy of the world.
 */
export function classesView(api: Api): HTMLElement {
  let students: Student[] = [];
  let scenarios: MissionSummary[] = [];
  let assignments: Assignment[] = [];
  // Students' builds load on their own, and stay as they are while the rest of the page is redrawn.
  const builds = studentBuildsCard(api);
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading…'));

  const load = async () => {
    try {
      [students, scenarios, assignments] = await Promise.all([api.students(), api.assignable(), api.assignments()]);
      draw();
    } catch (err) {
      clear(body, h('p', { class: 'issue error' }, err instanceof Error ? err.message : 'Could not load your classes.'));
    }
  };

  // ---------------------------------------------------------------- students
  const studentsCard = () => {
    const email = h('input', { type: 'email', placeholder: 'student@school.example', 'aria-label': 'Student’s email address', required: true });
    const form = h('form', { class: 'inline-form', 'data-form': 'add-student' }, email, h('button', { type: 'submit', class: 'primary' }, 'Add student'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.addStudent(email.value.trim());
        await load();
      } catch (err) {
        fail(err, 'Could not add the student.');
      }
    });
    return h(
      'div',
      { class: 'card', 'data-card': 'students' },
      h('h2', null, `My students (${students.length})`),
      h('p', { class: 'muted' }, 'Add a student by the email address they sign in with. They need to have signed in once. How many you can have depends on your ', h('a', { href: '#/plan' }, 'plan'), '.'),
      form,
      students.length
        ? h('ul', { class: 'people' }, ...students.map((s) =>
            h('li', { 'data-student': s.id }, h('span', null, h('strong', null, s.name), ' ', h('span', { class: 'muted' }, s.email)),
              h('button', {
                type: 'button', class: 'link danger', 'aria-label': `Remove ${s.name}`,
                onclick: async () => {
                  if (!window.confirm(`Remove ${s.name} from your students? They also leave the missions you assigned them.`)) return;
                  await api.removeStudent(s.id).then(load, (err) => fail(err, 'Could not remove the student.'));
                },
              }, 'Remove'))))
        : h('p', { class: 'empty' }, 'No students yet.'),
    );
  };

  // ------------------------------------------------------------- one assignment
  /** The form for a new assignment (no `existing`) or for changing one. */
  const assignmentForm = (existing: Assignment | null, done: () => void) => {
    const chosen = new Set<number>(existing ? existing.students.map((s) => s.id) : students.map((s) => s.id));
    let teams: Team[] = existing ? existing.teams.map((t) => ({ ...t, student_ids: [...t.student_ids] })) : [];
    // Curricular missions the teacher's plan does not include are listed, but cannot be chosen.
    const scenario = h('select', { 'aria-label': 'Mission' }, ...scenarios.map((s) => h('option', { value: s.id, disabled: s.locked, title: s.locked ? 'Comes with a teacher plan' : null },
      `${s.title}${s.visibility === 'private' ? ' (private)' : ''}${s.waits_for_launch ? ' (waits for you to launch it)' : ''}${s.locked ? ' 🔒 teacher plan' : ''}`)));
    const due = h('input', { type: 'datetime-local', value: toLocalInput(existing?.due_at ?? null), 'aria-label': 'Due' });
    const note = h('input', { type: 'text', maxlength: 255, value: existing?.note ?? '', placeholder: 'Optional: shown on the student’s mission card', 'aria-label': 'Note' });
    const people = h('div', { class: 'assign-people' });
    const teamOf = (id: number) => teams.findIndex((t) => t.student_ids.includes(id));

    const drawPeople = () => {
      clear(
        people,
        ...students.map((s) => {
          const tick = h('input', { type: 'checkbox', checked: chosen.has(s.id) });
          tick.addEventListener('change', () => {
            if (tick.checked) chosen.add(s.id);
            else {
              chosen.delete(s.id);
              teams.forEach((t) => (t.student_ids = t.student_ids.filter((id) => id !== s.id)));
            }
            drawPeople();
          });
          const pick = h('select', { 'aria-label': `Team for ${s.name}`, disabled: !chosen.has(s.id) || !teams.length },
            h('option', { value: '-1' }, teams.length ? 'No team' : '—'),
            ...teams.map((t, i) => h('option', { value: i, selected: teamOf(s.id) === i }, t.name || `Team ${i + 1}`)));
          pick.addEventListener('change', () => {
            teams.forEach((t) => (t.student_ids = t.student_ids.filter((id) => id !== s.id)));
            const index = Number(pick.value);
            if (index >= 0) teams[index]!.student_ids.push(s.id);
          });
          return h('div', { class: 'assign-person', 'data-student': s.id }, h('label', { class: 'check' }, tick, h('span', null, s.name)), pick);
        }),
      );
    };

    const teamList = h('div', { class: 'team-list' });
    const drawTeams = () => {
      clear(
        teamList,
        ...teams.map((t, i) => {
          const name = h('input', { type: 'text', value: t.name, maxlength: 64, 'aria-label': `Name of team ${i + 1}` });
          name.addEventListener('input', () => {
            t.name = name.value;
          });
          name.addEventListener('change', drawPeople);
          return h('span', { class: 'team-chip' }, name, h('button', {
            type: 'button', class: 'link danger', 'aria-label': `Remove team ${t.name}`,
            onclick: () => {
              teams = teams.filter((x) => x !== t);
              drawTeams();
              drawPeople();
            },
          }, '✕'));
        }),
        h('button', {
          type: 'button', 'data-action': 'add-team',
          onclick: () => {
            teams.push({ name: `Team ${teams.length + 1}`, student_ids: [] });
            drawTeams();
            drawPeople();
          },
        }, '+ Add a team'),
        teams.length > 1 ? h('button', {
          type: 'button', 'data-action': 'deal',
          onclick: () => {
            // Deal the chosen students round the teams, in the order they are listed.
            teams.forEach((t) => (t.student_ids = []));
            students.filter((s) => chosen.has(s.id)).forEach((s, i) => teams[i % teams.length]!.student_ids.push(s.id));
            drawPeople();
          },
        }, 'Share students out evenly') : null,
      );
    };
    drawTeams();
    drawPeople();

    const form = h(
      'form',
      { class: 'assign-form', 'data-form': existing ? 'edit-assignment' : 'new-assignment' },
      existing ? null : h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Mission'), scenario),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Due (optional)'), due),
      h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Note'), note),
      h('div', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Teams', help('Each team plays in its own copy of the world and makes progress together. Without teams, everyone assigned shares one.')), teamList),
      h('div', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Students'), people),
      h('div', { class: 'row-actions' },
        h('button', { type: 'submit', class: 'primary' }, existing ? 'Save changes' : 'Assign'),
        h('button', { type: 'button', onclick: done }, 'Cancel')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const draft = {
        student_ids: students.filter((s) => chosen.has(s.id)).map((s) => s.id),
        due_at: fromLocalInput(due.value),
        note: note.value.trim() || null,
        teams: teams.map((t, i) => ({ ...(t.id ? { id: t.id } : {}), name: t.name.trim() || `Team ${i + 1}`, student_ids: t.student_ids.filter((id) => chosen.has(id)) })),
      };
      if (!draft.student_ids.length) return toast('Choose at least one student.', 'error');
      try {
        if (existing) await api.updateAssignment(existing.id, draft);
        else await api.assign({ scenario_id: Number(scenario.value), ...draft });
        await load();
      } catch (err) {
        fail(err, 'Could not save the assignment.');
      }
    });
    return form;
  };

  /**
   * For a mission that waits for its teacher: whether its students can see it yet, and the way to
   * show it to them (or hide it again). Launching it from the game does the same and sends the
   * students there into it.
   */
  const launchLine = (a: Assignment) => {
    if (!a.scenario?.waits_for_launch) return null;
    const flip = (on: boolean) => async () => {
      await api.showToStudents(a.id, on).then(load, (err) => fail(err, 'Could not change it.'));
    };
    return a.waiting
      ? h('p', { class: 'launch-state waiting', 'data-launch': 'waiting' },
          h('span', null, '⏳ Waiting for you: students do not see it yet. Launch it from the game you are playing with them (🚀 tab), or '),
          h('button', { type: 'button', class: 'link', 'data-action': 'show-to-students', onclick: flip(true) }, 'show it to them now'), '.')
      : h('p', { class: 'launch-state', 'data-launch': 'launched' },
          h('span', null, `🚀 Launched${a.launched_at ? ` ${new Date(`${a.launched_at.replace(' ', 'T')}Z`).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}: students see it. `),
          h('button', { type: 'button', class: 'link', 'data-action': 'hide-from-students', onclick: flip(false) }, 'Hide it again'));
  };

  const assignmentCard = (a: Assignment) => {
    const card = h('div', { class: 'card', 'data-assignment': a.id });
    const show = () => {
      const due = a.due_at ? new Date(`${a.due_at.replace(' ', 'T')}Z`) : null;
      const names = (ids: number[]) => a.students.filter((s) => ids.includes(s.id)).map((s) => s.name).join(', ') || 'nobody yet';
      const loose = a.students.filter((s) => s.team_id == null);
      const link = (group: string) => a.scenario ? h('a', { href: `${playUrl(a.scenario.code)}?group=${group}`, target: '_blank', rel: 'noopener' }, 'Look in') : null;
      clear(
        card,
        h('div', { class: 'card-title' }, h('strong', null, a.scenario?.title ?? 'A scenario that is no longer published'),
          due ? h('span', { class: `badge ${due.getTime() < Date.now() ? 'late' : ''}` }, `Due ${due.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`) : h('span', { class: 'muted' }, 'No due date')),
        a.note ? h('p', { class: 'muted' }, a.note) : null,
        launchLine(a),
        a.teams.length
          ? h('ul', { class: 'people' },
              ...a.teams.map((t) => h('li', { 'data-team': t.id }, h('span', null, h('strong', null, t.name), ': ', names(t.student_ids)), link(t.group!))),
              loose.length ? h('li', null, h('span', null, h('strong', null, 'No team'), ': ', loose.map((s) => s.name).join(', ')), link(a.group)) : null)
          : h('ul', { class: 'people' }, h('li', null, h('span', null, `${a.students.length} ${a.students.length === 1 ? 'student' : 'students'}, playing together: `, a.students.map((s) => s.name).join(', ') || 'nobody yet'), link(a.group))),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'primary', 'data-action': 'report', onclick: () => clear(body, reportView(api, a, draw)) }, '📊 Report'),
          h('button', { type: 'button', 'data-action': 'notebooks', onclick: () => clear(body, notebooksView(api, a, draw)) }, '📒 Notebooks'),
          h('button', { type: 'button', onclick: () => clear(card, h('h2', null, a.scenario?.title ?? 'Assignment'), assignmentForm(a, show)) }, 'Change'),
          h('button', {
            type: 'button', class: 'danger',
            onclick: async () => {
              if (!confirmDelete(`the assignment of ${a.scenario?.title ?? 'this mission'}`)) return;
              await api.unassign(a.id).then(load, (err) => fail(err, 'Could not delete the assignment.'));
            },
          }, 'Delete')),
      );
    };
    show();
    return card;
  };

  // ------------------------------------------------------------------ the page
  function draw() {
    const fresh = h('div', { class: 'card', 'data-card': 'assign', hidden: true });
    const open = h('button', {
      type: 'button', class: 'primary', disabled: !students.length || !scenarios.length,
      onclick: () => {
        fresh.hidden = false;
        clear(fresh, h('h2', null, 'Assign a mission'), assignmentForm(null, () => (fresh.hidden = true)));
      },
    }, 'Assign a mission');
    clear(
      body,
      h('div', { class: 'classes' },
        h('div', null, studentsCard(), builds),
        h('div', null,
          h('div', { class: 'page-head' }, h('div', null, h('h2', null, `Assigned missions (${assignments.length})`),
            !scenarios.length ? h('p', { class: 'muted' }, 'There is nothing to assign yet: publish a scenario first.')
            : !students.length ? h('p', { class: 'muted' }, 'Add your students first.') : null), open),
          fresh,
          ...(assignments.length ? assignments.map(assignmentCard) : [h('p', { class: 'empty' }, 'Nothing assigned yet.')]))),
    );
  }

  void load();
  return h(
    'div',
    { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Classes'),
      h('p', { class: 'muted' }, 'Give missions to your students. An assigned mission appears on their missions page beside the public ones; private missions appear only this way.'))),
    body,
  );
}
