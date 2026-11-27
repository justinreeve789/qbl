import { BUILD_LIMITS } from '@qbl/shared';
import { emojiIcon } from './icons';
import type { BuildPanelActions, BuildPanelHandle, BuildPanelSpec, BuildPanelView } from './UiPort';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** A button that does not let its press reach the game beneath it. */
function button(label: string, emoji: string | null, onClick: () => void, o: { title?: string; className?: string } = {}): HTMLButtonElement {
  const b = el('button', `qbl-build-button${o.className ? ` ${o.className}` : ''}`);
  b.type = 'button';
  if (emoji) b.append(emojiIcon(emoji, { size: 18 }));
  if (label) b.append(el('span', '', label));
  if (o.title) {
    b.title = o.title;
    b.setAttribute('aria-label', o.title);
  }
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
}

/** A row of colour swatches; `onPick` with the chosen colour. */
function swatches(colors: readonly string[], chosen: string, onPick: (color: string) => void): HTMLElement & { set(color: string): void } {
  const row = el('div', 'qbl-build-swatches') as unknown as HTMLElement & { set(color: string): void };
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', 'Colour');
  const buttons = colors.map((c) => {
    const b = el('button', 'qbl-build-swatch');
    b.type = 'button';
    b.style.background = c;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', c);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      row.set(c);
      onPick(c);
    });
    return b;
  });
  row.set = (color) => buttons.forEach((b, i) => b.setAttribute('aria-checked', String(colors[i] === color)));
  row.append(...buttons);
  row.set(chosen);
  return row;
}

/**
 * The build palette: what a student can add to the scene, how to change what they picked, and
 * Undo, Redo, Cancel and Done. A panel at the side (along the bottom on a phone), so the scene
 * stays in view and the student's pieces can be dragged around it.
 */
export function buildPanel(root: HTMLElement, spec: BuildPanelSpec, on: BuildPanelActions, closed: () => void): BuildPanelHandle {
  const box = el('section', 'qbl-build');
  box.setAttribute('aria-label', 'Build');
  // Typing in the panel must not move the player (arrow keys) or reach the game.
  box.addEventListener('keydown', (e) => e.stopPropagation());
  box.addEventListener('pointerdown', (e) => e.stopPropagation());

  const head = el('header', 'qbl-build-head');
  const title = el('h2', 'qbl-build-title');
  title.append(emojiIcon('🛠️', { size: 22 }), el('span', '', 'Build'));
  const count = el('span', 'qbl-build-count');
  head.append(title, count);
  box.append(head);
  if (spec.prompt) box.append(el('p', 'qbl-build-prompt', spec.prompt));
  const note = el('p', 'qbl-build-note');
  box.append(note);

  // ---- adding
  const add = el('div', 'qbl-build-add');
  if (spec.tools.includes('place') && spec.pieces.length) {
    const group = el('div', 'qbl-build-group');
    group.append(el('h3', '', 'Add a piece'));
    const grid = el('div', 'qbl-build-pieces');
    for (const p of spec.pieces) {
      const b = el('button', 'qbl-build-piece');
      b.type = 'button';
      b.title = `Add ${p.name}`;
      b.setAttribute('aria-label', `Add ${p.name}`);
      const img = el('img');
      img.src = p.url;
      img.alt = '';
      b.append(img);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        on.addSticker(p.mediaId);
      });
      grid.append(b);
    }
    group.append(grid);
    add.append(group);
  }
  let labelColor = spec.colors[0] ?? '#ffffff';
  if (spec.tools.includes('label')) {
    const group = el('div', 'qbl-build-group');
    group.append(el('h3', '', 'Add words'));
    const form = el('form', 'qbl-build-words');
    const input = el('input');
    input.type = 'text';
    input.maxLength = BUILD_LIMITS.labelLength;
    input.placeholder = 'A sign, a name, a fact…';
    input.setAttribute('aria-label', 'Words to add');
    form.append(input, button('Add', '➕', () => form.requestSubmit()));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      on.addLabel(input.value, labelColor);
      input.value = '';
    });
    group.append(form, swatches(spec.colors, labelColor, (c) => (labelColor = c)));
    add.append(group);
  }
  if (spec.tools.includes('picture')) {
    const group = el('div', 'qbl-build-group');
    group.append(el('h3', '', 'Add your own picture'));
    group.append(button('My pictures…', '🖼️', () => openPictures()));
    add.append(group);
  }
  box.append(add);

  // ---- what is picked
  const picked = el('div', 'qbl-build-picked');
  picked.hidden = true;
  const pickedTitle = el('h3', '', 'What you picked');
  const pickedButtons = el('div', 'qbl-build-row');
  pickedButtons.append(
    button('', '➕', () => on.resize(1.2), { title: 'Bigger' }),
    button('', '➖', () => on.resize(1 / 1.2), { title: 'Smaller' }),
    button('', '↩️', () => on.turn(-15), { title: 'Turn left' }),
    button('', '↪️', () => on.turn(15), { title: 'Turn right' }),
    button('Remove', '🗑️', () => on.remove(), { className: 'danger' }),
  );
  const relabel = el('form', 'qbl-build-words');
  const relabelInput = el('input');
  relabelInput.type = 'text';
  relabelInput.maxLength = BUILD_LIMITS.labelLength;
  relabelInput.setAttribute('aria-label', 'Change the words');
  let relabelColor = labelColor;
  const relabelSwatches = swatches(spec.colors, relabelColor, (c) => {
    relabelColor = c;
    on.relabel(relabelInput.value, c);
  });
  relabel.append(relabelInput, button('Change', '✏️', () => relabel.requestSubmit()));
  relabel.addEventListener('submit', (e) => {
    e.preventDefault();
    on.relabel(relabelInput.value, relabelColor);
  });
  const relabelBox = el('div');
  relabelBox.append(relabel, relabelSwatches);
  picked.append(pickedTitle, el('p', 'qbl-build-tip', 'Drag it in the scene to move it.'), pickedButtons, relabelBox);
  box.append(picked);
  const tip = el('p', 'qbl-build-tip', 'Tap something you added to pick it, then drag it where you want it.');
  box.append(tip);

  // ---- foot
  const undo = button('', '↶', () => on.undo(), { title: 'Undo' });
  const redo = button('', '↷', () => on.redo(), { title: 'Redo' });
  let clearArmed = false;
  const clear = button('Clear all', null, () => {
    if (!clearArmed) {
      clearArmed = true;
      clear.querySelector('span')!.textContent = 'Sure?';
      window.setTimeout(() => {
        clearArmed = false;
        clear.querySelector('span')!.textContent = 'Clear all';
      }, 3000);
      return;
    }
    clearArmed = false;
    clear.querySelector('span')!.textContent = 'Clear all';
    on.clear();
  });
  const cancel = button('Cancel', null, () => on.cancel());
  const done = button('Done', '✅', () => on.done(), { className: 'primary' });
  const foot = el('footer', 'qbl-build-foot');
  const left = el('div', 'qbl-build-row');
  left.append(undo, redo, clear);
  const right = el('div', 'qbl-build-row');
  right.append(cancel, done);
  foot.append(left, right);
  box.append(foot);
  root.append(box);

  // ---- the picture chooser
  let view: BuildPanelView | null = null;
  let chooser: { box: HTMLElement; draw(): void } | null = null;
  function openPictures() {
    if (chooser) return;
    const shade = el('div', 'qbl-build-chooser');
    shade.setAttribute('role', 'dialog');
    shade.setAttribute('aria-modal', 'true');
    shade.setAttribute('aria-label', 'Your pictures');
    shade.addEventListener('pointerdown', (e) => e.stopPropagation());
    shade.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') closePictures();
    });
    const card = el('div', 'qbl-build-chooser-card');
    const top = el('header', 'qbl-build-head');
    top.append(el('h2', 'qbl-build-title', 'Your pictures'), button('', '✖️', () => closePictures(), { title: 'Close' }));
    const warn = el('p', 'qbl-build-note', 'Pictures you made in another app, or a photo of your work. Do not show faces, names or where you live.');
    const grid = el('div', 'qbl-build-pictures');
    const status = el('p', 'qbl-build-tip');
    status.setAttribute('role', 'status');
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg,image/webp,image/gif';
    file.hidden = true;
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      status.textContent = 'Uploading…';
      try {
        await on.upload(f);
        status.textContent = '';
        closePictures();
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : 'Could not upload that picture.';
      }
    });
    card.append(top, warn, grid, status, file);
    shade.append(card);
    shade.addEventListener('click', (e) => {
      if (e.target === shade) closePictures();
    });
    root.append(shade);
    const draw = () => {
      grid.replaceChildren();
      const up = el('button', 'qbl-build-picture qbl-build-upload');
      up.type = 'button';
      up.append(emojiIcon('⬆️', { size: 28 }), el('span', '', 'Upload a picture'));
      up.addEventListener('click', () => file.click());
      grid.append(up);
      for (const p of view?.pictures ?? []) {
        const tile = el('div', 'qbl-build-picture');
        const pick = el('button', 'qbl-build-picture-pick');
        pick.type = 'button';
        pick.setAttribute('aria-label', 'Add this picture');
        const img = el('img');
        img.src = p.url;
        img.alt = '';
        pick.append(img);
        pick.addEventListener('click', () => {
          on.addPicture(p.id);
          closePictures();
        });
        let armed = false;
        const del = button('', '🗑️', async () => {
          if (!armed) {
            armed = true;
            del.title = 'Click again to remove it everywhere';
            del.classList.add('armed');
            return;
          }
          try {
            await on.removePicture(p.id);
          } catch (err) {
            status.textContent = err instanceof Error ? err.message : 'Could not remove that picture.';
          }
        }, { title: 'Remove this picture', className: 'qbl-build-picture-remove' });
        tile.append(pick, del);
        grid.append(tile);
      }
    };
    chooser = { box: shade, draw };
    draw();
    (grid.querySelector('button') as HTMLButtonElement | null)?.focus();
  }
  function closePictures() {
    chooser?.box.remove();
    chooser = null;
  }

  let shownSelection: string | null = null;
  return {
    update(next) {
      view = next;
      count.textContent = `${next.count} of ${spec.maxPieces}`;
      note.textContent = next.status === 'hidden'
        ? 'Your teacher took this build down. Change it and press Done to ask again.'
        : spec.approve
          ? (spec.shared ? 'Your teacher looks at your build before others see it.' : 'Your teacher looks at your build. Only you and your teacher see it.')
          : (spec.shared ? 'Everyone here sees your build when you press Done.' : 'Only you and your teacher see your build.');
      picked.hidden = !next.selected;
      tip.hidden = !!next.selected || next.count === 0;
      relabelBox.hidden = next.selected?.kind !== 'label';
      const key = next.selected ? `${next.selected.kind}|${next.selected.text ?? ''}` : null;
      if (key !== shownSelection && next.selected?.kind === 'label') {
        relabelInput.value = next.selected.text ?? '';
        relabelColor = next.selected.color ?? spec.colors[0] ?? '#ffffff';
        relabelSwatches.set(relabelColor);
      }
      shownSelection = key;
      undo.disabled = !next.canUndo || next.saving;
      redo.disabled = !next.canRedo || next.saving;
      clear.disabled = next.count === 0 || next.saving;
      done.disabled = next.saving;
      done.querySelector('span')!.textContent = next.saving ? 'Saving…' : 'Done';
      chooser?.draw();
    },
    close() {
      closePictures();
      box.remove();
      closed();
    },
  };
}
