import { emojiIcon } from './icons';
import type { PhysicsPanelActions, PhysicsPanelHandle, PhysicsPanelSpec, PhysicsPanelView } from './UiPort';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label: string, emoji: string | null, onClick: () => void, title?: string): HTMLButtonElement {
  const b = el('button', 'qbl-physics-button');
  b.type = 'button';
  if (emoji) b.append(emojiIcon(emoji, { size: 20 }));
  b.append(el('span', '', label));
  if (title) b.title = title;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  // A press on a control must not also reach the game beneath it.
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
}

/** Set text and attributes only when they change: update() runs every frame. */
function setText(node: HTMLElement, text: string) {
  if (node.textContent !== text) node.textContent = text;
}
function setFlag(node: HTMLElement, name: string, on: boolean) {
  const value = String(on);
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/**
 * The controls of a physics experiment, over the game: what is measured (top left), and a bar of
 * controls across the top: play and pause, reset, slow motion, drop, gravity, the move and press
 * tools, the tray, and while a bridge is being built, the beams and the Test button.
 */
export function physicsPanel(root: HTMLElement, spec: PhysicsPanelSpec, on: PhysicsPanelActions): PhysicsPanelHandle {
  const box = el('div', 'qbl-physics');
  const readings = el('dl', 'qbl-physics-readings');
  const values = new Map<string, HTMLElement>();
  for (const r of spec.readouts) {
    const row = el('div', 'qbl-physics-reading');
    const value = el('dd', '', '—');
    row.append(el('dt', '', r.label), value);
    row.dataset.readout = r.id;
    readings.append(row);
    values.set(r.id, value);
  }
  readings.hidden = spec.readouts.length === 0;
  if (spec.shared) {
    const note = el('p', 'qbl-physics-shared');
    note.append(emojiIcon('👥', { size: 16 }), el('span', '', 'Everyone here shares this experiment'));
    readings.hidden = false;
    readings.prepend(note);
  }

  const bar = el('div', 'qbl-physics-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Experiment controls');
  let view: PhysicsPanelView | null = null;
  let shownPlaying: boolean | null = null;

  const play = button('Play', '▶', () => on.control(view?.paused ? 'play' : 'pause'));
  play.dataset.control = 'play';
  const reset = button('Reset', '🔄', () => on.control('reset'), 'Put everything back where it started');
  reset.dataset.control = 'reset';
  const slow = button('Slow motion', '🐢', () => on.control(view?.slow ? 'normal' : 'slow'));
  slow.dataset.control = 'slow';
  const drop = button('Drop', '⬇', () => on.control('release'), 'Let go of everything that is held in place');
  drop.dataset.control = 'drop';
  const main = el('div', 'qbl-physics-group');
  if (spec.play) main.append(play);
  if (spec.drop) main.append(drop);
  if (spec.slow) main.append(slow);
  if (spec.reset) main.append(reset);

  let gravity: HTMLSelectElement | null = null;
  if (spec.gravity) {
    gravity = el('select', 'qbl-physics-gravity');
    gravity.setAttribute('aria-label', 'Gravity');
    for (const [name, g] of spec.gravity) {
      const option = el('option', '', `${name} (${g} m/s²)`);
      option.value = String(g);
      gravity.append(option);
    }
    gravity.addEventListener('change', () => on.control('gravity', Number(gravity!.value)));
    gravity.addEventListener('pointerdown', (e) => e.stopPropagation());
    const label = el('label', 'qbl-physics-group qbl-physics-label');
    label.append(emojiIcon('🌍', { size: 20 }), gravity);
    main.append(label);
  }

  const tools = el('div', 'qbl-physics-group');
  const move = button('Move', '✋', () => on.tool('move'), 'Pick things up and move them');
  const press = button('Press', '👇', () => on.tool('press'), 'Hold on something to push down on it, harder the longer you hold');
  move.dataset.tool = 'move';
  press.dataset.tool = 'press';
  if (spec.press) tools.append(move, press);

  const tray = el('div', 'qbl-physics-group qbl-physics-tray');
  const trayButtons = new Map<string, { node: HTMLButtonElement; count: HTMLElement }>();
  for (const entry of spec.tray) {
    const count = el('small', 'qbl-physics-count');
    const node = button(entry.label, null, () => on.take(entry.id), `Take ${entry.label} and put it in the experiment`);
    const swatch = el('span', 'qbl-physics-swatch');
    swatch.style.background = entry.color;
    node.prepend(swatch);
    node.append(count);
    node.dataset.tray = entry.id;
    tray.append(node);
    trayButtons.set(entry.id, { node, count });
  }

  // Building a bridge.
  const building = el('div', 'qbl-physics-group qbl-physics-build');
  const beamButtons: HTMLButtonElement[] = [];
  const cost = el('span', 'qbl-physics-cost');
  const test = button('Test it', '🎯', () => on.control('test'), 'Stop building and see if it holds');
  test.classList.add('primary');
  test.dataset.control = 'test';
  const back = button('Back to building', '🧱', () => on.control('build'), 'Go back to your design');
  back.dataset.control = 'build';
  const erase = button('Remove beams', '✂', () => on.erase(!view?.erasing), 'Tap a beam to take it away');
  erase.dataset.control = 'erase';
  const clear = button('Clear', null, () => on.clear(), 'Take every beam away');
  clear.dataset.control = 'clear';
  if (spec.build) {
    spec.build.beams.forEach((b, i) => {
      const node = button(b.label, null, () => on.beam(i), b.cost ? `${b.label}: ${b.cost}` : b.label);
      const swatch = el('span', 'qbl-physics-swatch beam');
      swatch.style.background = b.color;
      node.prepend(swatch);
      if (b.cost) node.append(el('small', 'qbl-physics-count', b.cost));
      node.dataset.beam = String(i);
      beamButtons.push(node);
      building.append(node);
    });
    building.append(erase, clear, cost, test);
  }

  // Going back to building sits in a group of its own, like every other control.
  const backGroup = el('div', 'qbl-physics-group');
  backGroup.append(back);
  bar.append(main, tools, tray, building, backGroup);
  box.append(readings, bar);
  root.append(box);

  return {
    update(next: PhysicsPanelView) {
      view = next;
      for (const [id, node] of values) setText(node, next.readings[id] ?? '—');
      const playing = !next.paused;
      if (shownPlaying !== playing) {
        shownPlaying = playing;
        setText(play.querySelector('span')!, playing ? 'Pause' : 'Play');
        play.querySelector('.qbl-icon')?.replaceWith(emojiIcon(playing ? '⏸' : '▶', { size: 20 }));
      }
      setFlag(play, 'aria-pressed', playing);
      setFlag(slow, 'aria-pressed', next.slow);
      drop.hidden = !next.held || next.building;
      play.hidden = next.building;
      slow.hidden = next.building;
      if (gravity && gravity.value !== String(next.gravity) && document.activeElement !== gravity) {
        const exists = [...gravity.options].some((o) => o.value === String(next.gravity));
        if (exists) gravity.value = String(next.gravity);
      }
      setFlag(move, 'aria-pressed', next.tool === 'move' && !next.taking);
      setFlag(press, 'aria-pressed', next.tool === 'press' && !next.taking);
      tools.hidden = next.building || !spec.press;
      tray.hidden = next.building || spec.tray.length === 0;
      for (const [id, b] of trayButtons) {
        const left = next.tray[id];
        setText(b.count, left == null ? '' : `× ${left}`);
        b.node.disabled = left != null && left <= 0;
        setFlag(b.node, 'aria-pressed', next.taking === id);
      }
      building.hidden = !spec.build || !next.building;
      back.hidden = !spec.build || next.building;
      backGroup.hidden = back.hidden;
      beamButtons.forEach((b, i) => setFlag(b, 'aria-pressed', !next.erasing && next.beam === i));
      setFlag(erase, 'aria-pressed', next.erasing);
      const budget = spec.build?.budget;
      setText(cost, next.cost == null ? '' : budget != null ? `Cost ${Math.round(next.cost)} of ${Math.round(budget)}` : `Cost ${Math.round(next.cost)}`);
      cost.classList.toggle('over', budget != null && (next.cost ?? 0) > budget * 0.9);
    },
    close() {
      box.remove();
    },
  };
}
