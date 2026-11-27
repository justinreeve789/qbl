import { BUILD_LIMITS, type BuildUpload, type HotspotLook, type Id } from '@qbl/shared';
import { emojiIcon } from './icons';
import type { BuildPanelActions, BuildPanelHandle, BuildPanelSpec, BuildPanelView, HotspotFields } from './UiPort';

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

/** A row of choices, one picked: `onPick` with its value. */
function choices<T extends string>(label: string, options: Array<[T, string, string]>, chosen: T, onPick: (value: T) => void): HTMLElement {
  const row = el('div', 'qbl-build-choices');
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', label);
  const buttons = options.map(([value, text, emoji]) => {
    const b = button(text, emoji, () => {
      buttons.forEach((x, i) => x.setAttribute('aria-checked', String(options[i]![0] === value)));
      onPick(value);
    });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(value === chosen));
    return b;
  });
  row.append(...buttons);
  return row;
}

/** A grid of pictures to choose one from: the scene's pieces, or the player's own pictures. */
function pictureGrid<K>(items: Array<{ key: K; url: string; name: string }>, chosen: K | undefined, onPick: (key: K) => void, extra?: HTMLElement): HTMLElement {
  const grid = el('div', 'qbl-build-pieces');
  if (extra) grid.append(extra);
  for (const item of items) {
    const b = el('button', 'qbl-build-piece');
    b.type = 'button';
    b.title = item.name;
    b.setAttribute('aria-label', item.name);
    b.setAttribute('aria-pressed', String(item.key === chosen));
    const img = el('img');
    img.src = item.url;
    img.alt = '';
    b.append(img);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      grid.querySelectorAll('.qbl-build-piece').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onPick(item.key);
    });
    grid.append(b);
  }
  return grid;
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

  // ---- for a teacher: whose build to change
  let whoseSelect: HTMLSelectElement | null = null;
  if (spec.whose && spec.whose.length > 1) {
    const group = el('label', 'qbl-build-whose');
    group.append(el('span', '', 'Whose build'));
    whoseSelect = el('select');
    const state = { pending: ' (waiting)', hidden: ' (hidden)', approved: '' } as const;
    for (const w of spec.whose) {
      const o = el('option', '', `${w.name}${w.status ? state[w.status] : ''}`);
      o.value = w.id == null ? '' : String(w.id);
      whoseSelect.append(o);
    }
    const select = whoseSelect;
    select.addEventListener('change', () => on.switchTo(select.value ? Number(select.value) : null));
    group.append(select);
    box.append(group);
  }

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
  if (spec.tools.includes('hotspot')) {
    const group = el('div', 'qbl-build-group');
    group.append(el('h3', '', 'Add a hotspot'));
    group.append(el('p', 'qbl-build-tip', 'Something people click to hear the narrator, read words or see a picture.'));
    group.append(button('New hotspot…', '🔍', () => openHotspot(null)));
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
  const hotspotBox = el('div', 'qbl-build-row');
  hotspotBox.append(
    button('Change…', '✏️', () => {
      const p = view?.selected;
      if (p?.kind === 'hotspot') openHotspot({ look: p.look ?? 'none', media_id: p.media_id, upload_id: p.upload_id, text: p.text, color: p.color, opens: { ...p.opens } });
    }),
    button('Try it', '👆', () => on.tryHotspot()),
  );
  picked.append(pickedTitle, el('p', 'qbl-build-tip', 'Drag it in the scene to move it.'), pickedButtons, relabelBox, hotspotBox);
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
    const warn = el('p', 'qbl-build-note', view?.editingFor
      ? `${view.editingFor.name}’s pictures. Only they can upload or remove them.`
      : 'Pictures you made in another app, or a photo of your work. Do not show faces, names or where you live.');
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
        const up = await on.upload(f);
        on.addPicture(up.id);
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
      if (view?.canUpload !== false) {
        const up = el('button', 'qbl-build-picture qbl-build-upload');
        up.type = 'button';
        up.append(emojiIcon('⬆️', { size: 28 }), el('span', '', 'Upload a picture'));
        up.addEventListener('click', () => file.click());
        grid.append(up);
      } else if (!view.pictures.length) {
        grid.append(el('p', 'qbl-build-tip', 'They have not uploaded any pictures here.'));
      }
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
        tile.append(pick);
        if (view?.canUpload !== false) tile.append(del);
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

  // ---- the hotspot maker: what it looks like and what it opens
  let hotspot: { box: HTMLElement; draw(): void } | null = null;
  const pieceItems = spec.pieces.map((p) => ({ key: p.mediaId, url: p.url, name: p.name }));
  function openHotspot(initial: HotspotFields | null) {
    if (hotspot) return;
    const f: HotspotFields = initial ? { ...initial, opens: { ...initial.opens } } : { look: 'none', color: spec.colors[0], opens: {} };
    let openWith: 'none' | 'piece' | 'picture' = f.opens.media_id != null ? 'piece' : f.opens.upload_id != null ? 'picture' : 'none';
    const shade = el('div', 'qbl-build-chooser');
    shade.setAttribute('role', 'dialog');
    shade.setAttribute('aria-modal', 'true');
    shade.setAttribute('aria-label', 'Hotspot');
    shade.addEventListener('pointerdown', (e) => e.stopPropagation());
    shade.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') closeHotspot();
    });
    shade.addEventListener('click', (e) => {
      if (e.target === shade) closeHotspot();
    });
    const card = el('div', 'qbl-build-chooser-card qbl-build-hotspot');
    const top = el('header', 'qbl-build-head');
    const heading = el('h2', 'qbl-build-title');
    heading.append(emojiIcon('🔍', { size: 22 }), el('span', '', initial ? 'Change the hotspot' : 'New hotspot'));
    top.append(heading, button('', '✖️', () => closeHotspot(), { title: 'Close' }));

    // What people click on.
    const lookGroup = el('div', 'qbl-build-group');
    lookGroup.dataset.hotspot = 'look';
    const lookDetail = el('div', 'qbl-build-group');
    const looks: Array<[HotspotLook, string, string]> = [['none', 'Nothing', '👻'], ['label', 'Words', '🔤']];
    if (pieceItems.length) looks.push(['sticker', 'A piece', '🧩']);
    looks.push(['picture', 'My picture', '🖼️']);
    lookGroup.append(el('h3', '', 'What people click on'), choices('What people click on', looks, f.look, (v) => {
      f.look = v;
      drawLook();
    }), lookDetail);

    // What it opens.
    const opensGroup = el('div', 'qbl-build-group');
    opensGroup.dataset.hotspot = 'opens';
    const words = el('textarea', 'qbl-build-note-input');
    words.maxLength = BUILD_LIMITS.noteLength;
    words.rows = 4;
    words.placeholder = 'What people read when they click it…';
    words.setAttribute('aria-label', 'Words it shows');
    words.value = f.opens.text ?? '';
    const left = el('span', 'qbl-build-tip');
    const counted = () => (left.textContent = `${words.value.length} of ${BUILD_LIMITS.noteLength}`);
    words.addEventListener('input', counted);
    counted();
    const openDetail = el('div', 'qbl-build-group');
    const opens: Array<['none' | 'piece' | 'picture', string, string]> = [['none', 'No picture', '🚫']];
    if (pieceItems.length) opens.push(['piece', 'A piece', '🧩']);
    opens.push(['picture', 'My picture', '🖼️']);
    opensGroup.append(el('h3', '', 'What it shows when clicked'), words, left, choices('Picture it shows', opens, openWith, (v) => {
      openWith = v;
      drawOpens();
    }), openDetail);

    // What the narrator says first, in the story box: recorded in the narrator's voice once it is kept.
    const sayGroup = el('div', 'qbl-build-group');
    sayGroup.dataset.hotspot = 'say';
    const say = el('textarea', 'qbl-build-note-input');
    say.maxLength = BUILD_LIMITS.sayLength;
    say.rows = 3;
    say.placeholder = 'Words the narrator reads aloud, like “Long ago, a river ran here…”';
    say.setAttribute('aria-label', 'What the narrator says');
    say.value = f.opens.say ?? '';
    const sayLeft = el('span', 'qbl-build-tip');
    const sayCounted = () => (sayLeft.textContent = `${say.value.length} of ${BUILD_LIMITS.sayLength}`);
    say.addEventListener('input', sayCounted);
    sayCounted();
    sayGroup.append(
      el('h3', '', 'What the narrator says'),
      el('p', 'qbl-build-tip', 'The narrator reads it aloud in the story box when someone clicks, before the words or picture below open. Leave it empty for no narrator.'),
      say,
      sayLeft,
    );

    const status = el('p', 'qbl-build-tip');
    status.setAttribute('role', 'status');
    const file = el('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg,image/webp,image/gif';
    file.hidden = true;
    let uploadFor: ((id: number) => void) | null = null;
    file.addEventListener('change', async () => {
      const chosen = file.files?.[0];
      file.value = '';
      if (!chosen || !uploadFor) return;
      const then = uploadFor;
      status.textContent = 'Uploading…';
      try {
        const up = await on.upload(chosen);
        status.textContent = '';
        then(up.id);
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : 'Could not upload that picture.';
      }
    });
    const ownPictures = (chosen: number | undefined, pick: (id: number) => void) => {
      const items = (view?.pictures ?? []).map((p: BuildUpload) => ({ key: p.id, url: p.url, name: 'A picture you uploaded' }));
      let up: HTMLElement | undefined;
      if (view?.canUpload !== false) {
        up = el('button', 'qbl-build-piece qbl-build-upload');
        (up as HTMLButtonElement).type = 'button';
        up.append(emojiIcon('⬆️', { size: 22 }), el('span', '', 'Upload'));
        up.addEventListener('click', (e) => {
          e.stopPropagation();
          uploadFor = (id) => {
            pick(id);
            hotspot?.draw();
          };
          file.click();
        });
      }
      if (!items.length && !up) return el('p', 'qbl-build-tip', 'There are no pictures to choose from.');
      return pictureGrid(items, chosen, pick, up);
    };

    function drawLook() {
      lookDetail.replaceChildren();
      if (f.look === 'none') lookDetail.append(el('p', 'qbl-build-tip', 'An invisible spot. People find it when they point at it.'));
      if (f.look === 'label') {
        const input = el('input');
        input.type = 'text';
        input.maxLength = BUILD_LIMITS.labelLength;
        input.placeholder = 'Words to click, like “Read me!”';
        input.setAttribute('aria-label', 'Words to click');
        input.value = f.text ?? '';
        input.addEventListener('input', () => (f.text = input.value));
        const row = el('div', 'qbl-build-words');
        row.append(input);
        lookDetail.append(row, swatches(spec.colors, f.color ?? spec.colors[0] ?? '#ffffff', (c) => (f.color = c)));
      }
      if (f.look === 'sticker') lookDetail.append(pictureGrid(pieceItems, f.media_id as Id | undefined, (id) => (f.media_id = id)));
      if (f.look === 'picture') lookDetail.append(ownPictures(f.upload_id, (id) => (f.upload_id = id)));
    }
    function drawOpens() {
      openDetail.replaceChildren();
      if (openWith === 'piece') openDetail.append(pictureGrid(pieceItems, f.opens.media_id as Id | undefined, (id) => (f.opens.media_id = id)));
      if (openWith === 'picture') openDetail.append(ownPictures(f.opens.upload_id, (id) => (f.opens.upload_id = id)));
    }
    drawLook();
    drawOpens();

    const save = button(initial ? 'Change' : 'Add hotspot', '✅', () => {
      const out: HotspotFields = { look: f.look, opens: {} };
      if (f.look === 'label') {
        if (!(f.text ?? '').trim()) return void (status.textContent = 'Write the words people click on.');
        out.text = f.text;
        out.color = f.color;
      }
      if (f.look === 'sticker') {
        if (f.media_id == null) return void (status.textContent = 'Choose the piece people click on.');
        out.media_id = f.media_id;
      }
      if (f.look === 'picture') {
        if (f.upload_id == null || !view?.pictures.some((p) => p.id === f.upload_id)) return void (status.textContent = 'Choose the picture people click on.');
        out.upload_id = f.upload_id;
      }
      if (words.value.trim()) out.opens.text = words.value;
      if (say.value.trim()) out.opens.say = say.value;
      if (openWith === 'piece' && f.opens.media_id != null) out.opens.media_id = f.opens.media_id;
      if (openWith === 'picture' && f.opens.upload_id != null && view?.pictures.some((p) => p.id === f.opens.upload_id)) out.opens.upload_id = f.opens.upload_id;
      if (openWith !== 'none' && out.opens.media_id == null && out.opens.upload_id == null) return void (status.textContent = 'Choose the picture it shows, or pick No picture.');
      if (!out.opens.text && !out.opens.say && out.opens.media_id == null && out.opens.upload_id == null) return void (status.textContent = 'Write some words or choose a picture for it to show, or words for the narrator to say.');
      if (initial) on.rehotspot(out);
      else on.addHotspot(out);
      closeHotspot();
    }, { className: 'primary' });
    const foot = el('div', 'qbl-build-row qbl-build-hotspot-foot');
    foot.append(button('Cancel', null, () => closeHotspot()), save);
    card.append(top, lookGroup, sayGroup, opensGroup, status, foot, file);
    shade.append(card);
    root.append(shade);
    // New pictures (an upload) redraw the grids that show them.
    hotspot = { box: shade, draw: () => { drawLook(); drawOpens(); } };
    (card.querySelector('[role=radio]') as HTMLButtonElement | null)?.focus();
  }
  function closeHotspot() {
    hotspot?.box.remove();
    hotspot = null;
  }

  let shownSelection: string | null = null;
  const baseNote = (next: BuildPanelView) => next.editingFor
    ? `You are changing ${next.editingFor.name}’s build. Press Done to keep your changes.`
    : null;
  return {
    update(next) {
      view = next;
      count.textContent = `${next.count} of ${spec.maxPieces}`;
      note.textContent = baseNote(next) ?? (next.status === 'hidden'
        ? 'Your teacher took this build down. Change it and press Done to ask again.'
        : spec.approve
          ? (spec.shared ? 'Your teacher looks at your build before others see it.' : 'Your teacher looks at your build. Only you and your teacher see it.')
          : (spec.shared ? 'Everyone here sees your build when you press Done.' : 'Only you and your teacher see your build.'));
      picked.hidden = !next.selected;
      tip.hidden = !!next.selected || next.count === 0;
      relabelBox.hidden = next.selected?.kind !== 'label';
      hotspotBox.hidden = next.selected?.kind !== 'hotspot';
      pickedTitle.textContent = next.selected?.kind === 'hotspot' ? 'The hotspot you picked' : 'What you picked';
      if (whoseSelect) whoseSelect.value = next.editingFor ? String(next.editingFor.id) : '';
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
      hotspot?.draw();
    },
    close() {
      closePictures();
      closeHotspot();
      box.remove();
      closed();
    },
  };
}
