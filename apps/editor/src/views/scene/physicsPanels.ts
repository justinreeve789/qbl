import { PHYSICS_MATERIALS, PHYSICS_MEASURES, type PhysicsBody, type PhysicsBuild, type PhysicsJoint, type PhysicsWater, type ScenePhysics } from '@qbl/shared';
import { confirmDelete, h, help, toast } from '../../dom';
import { form, type Field, type FormContext, type Values } from '../../fields';
import {
  flatten, parsePoints, PHYSICS_BEAM_FIELDS, PHYSICS_BODY_FIELDS, PHYSICS_BUILD_FIELDS, PHYSICS_JOINT_FIELDS, PHYSICS_READOUT_FIELDS, PHYSICS_SETTINGS_FIELDS,
  PHYSICS_TRAY_FIELDS, PHYSICS_WATCH_FIELDS, PHYSICS_WATER_FIELDS, setPath, showPoints, withMaterialPlaceholders,
} from '../../physicsSchema';
import type { SceneModel, Selection } from './model';

export interface PhysicsPanelHost {
  select(selection: Selection): void;
}

type Item = { id: string } & Record<string, unknown>;

const gone = () => h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'This no longer exists.'));

/** An id not yet used in the experiment, from a readable start ("ball", "ball-2"). */
export function freshId(physics: ScenePhysics | null, start: string): string {
  const used = new Set<string>();
  for (const key of ['bodies', 'water', 'joints', 'tray', 'readouts', 'watches'] as const) for (const t of physics?.[key] ?? []) used.add(String(t.id));
  const base = start.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'thing';
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Folded sections stay folded (or open) across redraws. */
const openItems = new Set<string>();

/**
 * A list of things edited in place: each in a section that folds, with its form and a delete
 * button, and an add button at the end. Used for readouts, the tray, watches and beam kinds.
 */
function listEditor<T extends Record<string, unknown>>(o: {
  key: string;
  title: string;
  about: string;
  items: T[];
  /** The list as it is now: edits are made to it, not to what was drawn. */
  current(): T[];
  label(item: T, index: number): string;
  fields(item: T): Field[];
  flat?: string[];
  values?(item: T): Values;
  change(next: T[], structural: boolean): void;
  make(): T;
  ctx: FormContext;
  addLabel: string;
}): HTMLElement {
  const rows = o.items.map((item, index) => {
    const id = `${o.key}:${String(item.id ?? index)}`;
    const commit = (key: string, value: unknown, field: Field) => {
      const next = o.current().map((x, i) => (i === index ? setPath(x, key, value) : x));
      o.change(next, field.structural === true || field.kind === 'media');
    };
    const details = h(
      'details',
      { class: 'physics-item', open: openItems.has(id), 'data-physics-item': id },
      h('summary', null, o.label(item, index)),
      form(o.fields(item), o.values ? o.values(item) : o.flat ? flatten(item, o.flat) : (item as Values), commit, o.ctx),
      h('div', { class: 'row-actions' }, h('button', {
        type: 'button', class: 'danger',
        onclick: () => {
          if (!confirmDelete(`“${o.label(item, index)}”`)) return;
          o.change(o.current().filter((_, i) => i !== index), true);
        },
      }, 'Delete')),
    );
    details.addEventListener('toggle', () => (details.open ? openItems.add(id) : openItems.delete(id)));
    return details;
  });
  return h(
    'section',
    { 'data-section': o.key },
    h('div', { class: 'sub-head' }, h('span', null, o.title, help(o.about)), h('button', {
      type: 'button', class: 'link',
      onclick: () => {
        const made = o.make();
        openItems.add(`${o.key}:${String(made.id ?? o.items.length)}`);
        o.change([...o.current(), made], true);
      },
    }, o.addLabel)),
    rows.length ? h('div', { class: 'physics-list' }, ...rows) : h('p', { class: 'muted' }, 'None yet.'),
  );
}

// ------------------------------------------------------------------ the experiment

export function physicsSettingsPanel(model: SceneModel, ctx: FormContext, host: PhysicsPanelHost): HTMLElement {
  const physics = model.physics();
  if (!physics) return gone();
  const write = (next: ScenePhysics, structural: boolean) => void model.setPhysics(next, structural);
  const values: Values = {
    ...flatten(physics as Record<string, unknown>, ['controls', 'press']),
    _floor: physics.floor_y === null ? 'none' : physics.floor_y == null ? 'bottom' : 'at',
  };
  const commit = (key: string, value: unknown, field: Field) => {
    const current = model.physics() ?? physics;
    if (key === '_floor') {
      const next = { ...current } as ScenePhysics;
      if (value === 'none') next.floor_y = null;
      else if (value === 'at') next.floor_y = current.floor_y ?? Math.round(model.size(() => null).height * 0.9);
      else delete next.floor_y;
      return write(next, true);
    }
    write(setPath(current as Record<string, unknown>, key, value) as ScenePhysics, field.structural === true);
  };
  const part = <K extends 'readouts' | 'tray' | 'watches'>(key: K) => (next: NonNullable<ScenePhysics[K]>, structural: boolean) =>
    void model.setPhysicsPart(key, next as ScenePhysics[K], structural);
  const bodyName = (id: unknown) => physics.bodies?.find((b) => b.id === id)?.name ?? String(id ?? '');

  return h(
    'div',
    { class: 'panel', 'data-physics': 'settings' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Physics experiment', help(
      'Real physics in metres, kilograms and seconds: bodies fall, bounce, float, swing and break. Place bodies, water, joints and a bridge-building area on the scene; players drag, drop, press and build. Readouts show what is measured, and watches set variables and run events when something happens.',
    ))),
    form([{ key: 'enabled', label: 'Physics switched on in this scene', kind: 'bool', wide: true, structural: true }], physics as Values, (key, value) => {
      write({ ...(model.physics() ?? physics), enabled: value === true }, true);
    }, ctx),
    form(PHYSICS_SETTINGS_FIELDS, values, commit, ctx),
    listEditor({
      key: 'readouts', title: 'Readouts', addLabel: '+ Add readout', ctx,
      about: 'Numbers shown in the corner while the experiment runs: how high a ball bounced, how far the water rose, what a bridge carries. Each can also be kept in a variable.',
      items: (physics.readouts ?? []) as unknown as Item[],
      current: () => (model.physics()?.readouts ?? []) as unknown as Item[],
      label: (r) => {
        const m = PHYSICS_MEASURES[r.measure as keyof typeof PHYSICS_MEASURES];
        const of = r.body_id ? ` of ${bodyName(r.body_id)}` : '';
        return `${String(r.label || m?.label || r.measure)}${of}${r.variable ? ` → ${String(r.variable)}` : ''}`;
      },
      fields: () => PHYSICS_READOUT_FIELDS,
      change: (next, structural) => part('readouts')(next as never, structural),
      make: () => ({ id: freshId(model.physics(), 'readout'), measure: physics.bodies?.length ? 'height' : 'time', ...(physics.bodies?.[0] ? { body_id: physics.bodies[0].id } : {}) }),
    }),
    listEditor({
      key: 'tray', title: 'Tray', addLabel: '+ Add to the tray', ctx, flat: ['body'],
      about: 'Things players take out and put into the experiment: weights, balls, rocks. A button for each appears on screen; it can be limited to so many.',
      items: (physics.tray ?? []) as unknown as Item[],
      current: () => (model.physics()?.tray ?? []) as unknown as Item[],
      label: (e) => {
        const body = (e.body ?? {}) as Partial<PhysicsBody>;
        return `${String(e.label || PHYSICS_MATERIALS[body.material ?? 'wood']?.label || e.id)}${e.count != null ? ` × ${String(e.count)}` : ''}`;
      },
      fields: (e) => withMaterialPlaceholders(PHYSICS_TRAY_FIELDS, { material: (e.body as Values | undefined)?.material }).map((f) => (f.key === 'body.points' ? { ...f, key: 'body._points' } : f)),
      values: (e) => ({ ...flatten(e, ['body']), 'body._points': showPoints((e.body as Values | undefined)?.points) }),
      change: (next, structural) => {
        // Corners are typed as text; they are kept as points.
        const fixed = next.map((e) => {
          const typed = (e.body as Values | undefined)?._points;
          if (typed == null) return e;
          const { _points, ...body } = e.body as Values;
          const points = parsePoints(String(_points));
          if (!points) toast('Type the corners as pairs of x,y separated by spaces.', 'error');
          return { ...e, body: points ? { ...body, points } : body };
        });
        part('tray')(fixed as never, structural);
      },
      make: () => ({ id: freshId(model.physics(), 'weight'), label: '1 kg', body: { shape: 'box', width: 40, height: 40, mass: 1, material: 'steel', label: '1 kg' } }),
    }),
    listEditor({
      key: 'watches', title: 'Watches', addLabel: '+ Add watch', ctx, flat: ['region'],
      about: 'Something to notice while the experiment runs: a joint breaking, water spilling, a reading passing a value, a beam balancing. When it happens, a variable is set and an indirect event of this scene runs.',
      items: (physics.watches ?? []) as unknown as Item[],
      current: () => (model.physics()?.watches ?? []) as unknown as Item[],
      label: (w) => String(w.name || `When ${String(w.when)}`),
      fields: () => PHYSICS_WATCH_FIELDS,
      change: (next, structural) => part('watches')(next as never, structural),
      make: () => ({ id: freshId(model.physics(), 'watch'), when: 'break' }),
    }),
    h('div', { class: 'row-actions' }, h('button', {
      type: 'button', class: 'danger',
      onclick: async () => {
        if (!confirmDelete('this scene’s physics experiment and everything in it')) return;
        host.select({ kind: 'scene' });
        await model.setPhysics(null, true);
      },
    }, 'Delete the experiment')),
  );
}

// ------------------------------------------------------------------ what is placed

function placedPanel<T extends { id: string }>(o: {
  model: SceneModel;
  ctx: FormContext;
  host: PhysicsPanelHost;
  list: 'bodies' | 'water' | 'joints';
  index: number;
  title: string;
  about: string;
  fields(item: T): Field[];
  values?(item: T): Values;
  commit?(item: T, key: string, value: unknown): T;
  remove?(physics: ScenePhysics, item: T): ScenePhysics;
}): HTMLElement {
  const { model, ctx, host, list, index } = o;
  const items = model.physicsList(list) as unknown as T[];
  const item = items[index];
  if (!item) return gone();
  const commit = (key: string, value: unknown, field: Field) => {
    const current = model.physicsList(list) as unknown as T[];
    const next = current.map((x, i) => (i === index ? (o.commit ? o.commit(x, key, value) : setPath(x as unknown as Record<string, unknown>, key, value) as unknown as T) : x));
    void model.setPhysicsPart(list, next as never, field.structural === true || field.kind === 'media' || field.kind === 'physics');
  };
  return h(
    'div',
    { class: 'panel', 'data-physics': list },
    h('div', { class: 'panel-head' }, h('h2', null, o.title, help(o.about)), h('small', { class: 'muted' }, `id: ${item.id}`)),
    form(o.fields(item), o.values ? o.values(item) : (item as unknown as Values), commit, ctx),
    h(
      'div',
      { class: 'row-actions' },
      h('button', { type: 'button', onclick: () => host.select({ kind: 'physics' }) }, '⚙️ Experiment settings'),
      h('button', {
        type: 'button', class: 'danger',
        onclick: async () => {
          if (!confirmDelete(`“${String((item as Values).name || item.id)}”`)) return;
          host.select({ kind: 'physics' });
          const physics = model.physics()!;
          const kept = { ...physics, [list]: (physics[list] ?? []).filter((_, i) => i !== index) } as ScenePhysics;
          await model.setPhysics(o.remove ? o.remove(kept, item) : kept, true);
        },
      }, 'Delete'),
    ),
  );
}

export function physicsBodyPanel(model: SceneModel, ctx: FormContext, index: number, host: PhysicsPanelHost): HTMLElement {
  return placedPanel<PhysicsBody>({
    model, ctx, host, list: 'bodies', index,
    title: 'Physics body',
    about: 'Something that falls, rolls, bounces, floats or sinks, or (fixed) something to land on. Drag it on the scene to move it. Its material sets how heavy, bouncy and slippery it is.',
    fields: (b) => withMaterialPlaceholders(PHYSICS_BODY_FIELDS, b as unknown as Values),
    values: (b) => ({ ...b, points: showPoints(b.points) }),
    commit: (b, key, value) => {
      if (key !== 'points') return setPath(b as unknown as Record<string, unknown>, key, value) as unknown as PhysicsBody;
      const points = parsePoints(String(value ?? ''));
      if (!points || points.length < 3) {
        toast('Type at least three corners, as x,y pairs separated by spaces.', 'error');
        return b;
      }
      return { ...b, points };
    },
    // Joints on it go with it, and water stops filling it.
    remove: (p, b) => ({
      ...p,
      joints: (p.joints ?? []).filter((j) => j.body_a !== b.id && j.body_b !== b.id),
      water: (p.water ?? []).map((w) => (w.body_id === b.id ? { ...w, body_id: null } : w)),
    }),
  });
}

export function physicsWaterPanel(model: SceneModel, ctx: FormContext, index: number, host: PhysicsPanelHost): HTMLElement {
  return placedPanel<PhysicsWater>({
    model, ctx, host, list: 'water', index,
    title: 'Water',
    about: 'Water in a cup or a tank. Whatever goes in pushes it up by its own volume; things lighter than water float, heavier ones sink. Water over the rim spills and is gone.',
    fields: () => PHYSICS_WATER_FIELDS,
  });
}

export function physicsJointPanel(model: SceneModel, ctx: FormContext, index: number, host: PhysicsPanelHost): HTMLElement {
  return placedPanel<PhysicsJoint>({
    model, ctx, host, list: 'joints', index,
    title: 'Joint',
    about: 'Joins a body to another, or to a fixed point: a pendulum’s string, a seesaw’s pivot, a spring. Give it a strength and it breaks when pulled harder than that. Drag its ends on the scene.',
    fields: () => PHYSICS_JOINT_FIELDS,
  });
}

// ------------------------------------------------------------------ building

export function physicsBuildPanel(model: SceneModel, ctx: FormContext, host: PhysicsPanelHost): HTMLElement {
  const build = model.physics()?.build;
  if (!build) return gone();
  /** The building area as it is now: what was drawn may be out of date by the time of an edit. */
  const now = (): PhysicsBuild => model.physics()?.build ?? build;
  const write = (next: PhysicsBuild, structural = false) => void model.setPhysicsPart('build', next, structural);
  const anchors = build.anchors.map((a, i) => h(
    'li', null,
    `Footing ${i + 1}: ${a.x}, ${a.y} `,
    h('button', { type: 'button', class: 'link danger', onclick: () => write({ ...now(), anchors: now().anchors.filter((_, j) => j !== i) }, true) }, 'Remove'),
  ));
  return h(
    'div',
    { class: 'panel', 'data-physics': 'build' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Bridge building', help(
      'An area in which players build, beam by beam: each beam starts at a footing (a point fixed to the world, such as a cliff’s edge) or at the end of a beam already built. While they build nothing moves; Test it puts the design to work, and players load it with weights from the tray or press on it until something breaks.',
    ))),
    form(PHYSICS_BUILD_FIELDS, build as unknown as Values, (key, value, field) => write(setPath(now() as unknown as Record<string, unknown>, key, value) as unknown as PhysicsBuild, field.structural === true), ctx),
    h('section', { 'data-section': 'anchors' },
      h('div', { class: 'sub-head' }, h('span', null, 'Footings', help('Points fixed to the world that beams can start from. Drag them on the scene; they snap to the grid.')),
        h('button', {
          type: 'button', class: 'link',
          onclick: () => {
            const b = now();
            const g = b.grid && b.grid > 0 ? b.grid : 25;
            write({ ...b, anchors: [...b.anchors, { x: b.x + g, y: b.y + Math.round(b.height / 2 / g) * g }] }, true);
          },
        }, '+ Add footing')),
      anchors.length ? h('ul', { class: 'pick-list' }, ...anchors) : h('p', { class: 'muted' }, 'None yet: players need at least one.')),
    listEditor({
      key: 'beams', title: 'Beams offered', addLabel: '+ Add a kind of beam', ctx,
      about: 'What players can build with, each with its cost a metre. Mark the road as a road: weights rest on it. Steel is strong and heavy, wood light and cheaper, rope only pulls.',
      items: build.beams.map((b, i) => ({ ...b, id: String(i) })) as unknown as Item[],
      current: () => (now().beams.map((b, i) => ({ ...b, id: String(i) }))) as unknown as Item[],
      label: (b) => `${String(b.label || PHYSICS_MATERIALS[String(b.material)]?.label || b.material)}${b.deck ? ' (road)' : ''}${b.cost_per_meter ? ` · ${String(b.cost_per_meter)} a metre` : ''}`,
      fields: () => PHYSICS_BEAM_FIELDS,
      change: (next, structural) => write({ ...now(), beams: next.map(({ id: _id, ...b }) => b) as unknown as PhysicsBuild['beams'] }, structural),
      make: () => ({ id: String(build.beams.length), material: 'wood', cost_per_meter: 50 }),
    }),
    build.preset?.length
      ? h('p', { class: 'muted' }, `Players start from a design of ${build.preset.length} beam${build.preset.length === 1 ? '' : 's'}. `, h('button', { type: 'button', class: 'link', onclick: () => write({ ...now(), preset: [] }, true) }, 'Start from nothing instead'))
      : h('p', { class: 'muted' }, 'Players start with nothing built.'),
    h(
      'div',
      { class: 'row-actions' },
      h('button', { type: 'button', onclick: () => host.select({ kind: 'physics' }) }, '⚙️ Experiment settings'),
      h('button', {
        type: 'button', class: 'danger',
        onclick: async () => {
          if (!confirmDelete('the building area')) return;
          host.select({ kind: 'physics' });
          await model.setPhysicsPart('build', null);
        },
      }, 'Delete the building area'),
    ),
  );
}
