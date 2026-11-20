import type { SignUpRole } from '../net/Api';
import { emojiIcon } from './icons';

/** The two choices, as the sign-up form shows them. */
export const SIGN_UP_ROLES: readonly { role: SignUpRole; emoji: string; name: string; hint: string }[] = [
  { role: 'student', emoji: '🧑‍🎓', name: 'Student', hint: 'Play missions, earn stars' },
  { role: 'teacher', emoji: '🧑‍🏫', name: 'Teacher', hint: 'Build missions, run classes' },
];

export interface RolePicker {
  node: HTMLFieldSetElement;
  /** The role chosen, or null before one is. */
  value(): SignUpRole | null;
  /** Draw attention to the picker when the form is sent without a choice. */
  nudge(): void;
  /** The line under the cards: what the choice means. */
  say(text: string): void;
}

/**
 * "I'm a… Student / Teacher" on the sign-up form: two big cards that work as radio buttons
 * (arrow keys move between them, the label is the whole card). Neither is chosen at first, so a
 * teacher does not end up with a student's account by not noticing the question.
 */
export function rolePicker(onChange: (role: SignUpRole) => void): RolePicker {
  const node = document.createElement('fieldset');
  node.className = 'qbl-roles';
  const legend = document.createElement('legend');
  legend.textContent = 'I’m a…';
  const grid = document.createElement('div');
  grid.className = 'qbl-roles-grid';
  for (const r of SIGN_UP_ROLES) {
    const label = document.createElement('label');
    label.className = 'qbl-role';
    label.dataset.role = r.role;
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'role';
    input.value = r.role;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      node.classList.remove('nudge');
      onChange(r.role);
    });
    const art = document.createElement('span');
    art.className = 'qbl-role-art';
    art.appendChild(emojiIcon(r.emoji, { size: 40 }));
    const name = document.createElement('span');
    name.className = 'qbl-role-name';
    name.textContent = r.name;
    const hint = document.createElement('span');
    hint.className = 'qbl-role-hint';
    hint.textContent = r.hint;
    const check = document.createElement('span');
    check.className = 'qbl-role-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '✓';
    label.append(input, check, art, name, hint);
    grid.appendChild(label);
  }
  // Said under the cards, so the cards stay put when it changes; read out when it does.
  const note = document.createElement('p');
  note.className = 'qbl-roles-note';
  note.setAttribute('aria-live', 'polite');
  node.append(legend, grid, note);
  return {
    node,
    value: () => (node.querySelector<HTMLInputElement>('input[name="role"]:checked')?.value as SignUpRole | undefined) ?? null,
    nudge: () => {
      node.classList.remove('nudge');
      // Restart the animation: a second nudge should be seen too.
      void node.offsetWidth;
      node.classList.add('nudge');
      node.querySelector<HTMLInputElement>('input[name="role"]')?.focus();
    },
    say: (text) => {
      note.textContent = text;
      note.hidden = !text;
    },
  };
}
