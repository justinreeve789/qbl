import type { SceneBench } from '@qbl/shared';
import type { Row } from '../../api';
import { mediaUrl, params } from '../../describe';
import type { Store } from '../../store';

/** What is selected in the scene editor. */
export type Selection =
  | { kind: 'scene' }
  | { kind: 'layer'; which: LayerList; index: number }
  | { kind: 'event'; id: number }
  | { kind: 'spawn'; index: number }
  | { kind: 'item'; index: number }
  | { kind: 'character'; index: number }
  | { kind: 'area'; which: AreaList; index: number }
  | { kind: 'scale'; index: number }
  | { kind: 'shadow'; index: number }
  | { kind: 'light'; index: number }
  | { kind: 'flow'; index: number }
  | { kind: 'water_light'; index: number }
  /** The scene's close-up bench: its settings, substances, reactions, readouts, watches and graph. */
  | { kind: 'bench' }
  | { kind: 'bench-vessel'; index: number }
  | { kind: 'bench-tool'; index: number };

export type LayerList = 'background_media' | 'foreground_media';
export type AreaList = 'walkable_areas' | 'blocked_areas';
export type LayoutList = 'spawn_points' | 'items' | 'characters' | 'scale_areas' | 'shadow_spots' | 'lights' | 'flows' | 'water_lights' | AreaList;

export interface Point { x: number; y: number }
export type Side = 'left' | 'right' | 'top' | 'bottom';
export type Bag = Record<string, unknown>;

export function sameSelection(a: Selection, b: Selection): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Reads and writes the parts of a scene that are kept as JSON in the scene's row. */
export class SceneModel {
  constructor(readonly store: Store, readonly sceneId: number) {}

  get row(): Row {
    return this.store.byId('scenes', this.sceneId)!;
  }

  get exists(): boolean {
    return this.store.byId('scenes', this.sceneId) !== undefined;
  }

  /** Background or foreground layers. Bare media objects from older documents are read as layers. */
  layers(which: LayerList): Bag[] {
    const list = this.row[which];
    return Array.isArray(list) ? (list as Bag[]).map((l) => ('media_id' in l ? l : { ...l, media_id: l.id })) : [];
  }

  setLayers(which: LayerList, layers: Bag[], structural = false) {
    return this.store.patch('scenes', this.sceneId, { [which]: layers }, structural);
  }

  layout<T = Bag>(key: LayoutList): T[] {
    const list = params(this.row, 'layout')[key];
    return Array.isArray(list) ? (list as T[]) : [];
  }

  setLayout(key: LayoutList, list: unknown[], structural = false) {
    return this.store.patch('scenes', this.sceneId, { layout: { ...params(this.row, 'layout'), [key]: list } }, structural);
  }

  /** The scene's close-up bench as stored (switched on or not), or null when it has none. */
  bench(): SceneBench | null {
    const b = params(this.row, 'layout').bench;
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as SceneBench) : null;
  }

  setBench(bench: SceneBench | null, structural = false) {
    const layout = { ...params(this.row, 'layout') };
    if (bench) layout.bench = bench;
    else delete layout.bench;
    return this.store.patch('scenes', this.sceneId, { layout }, structural);
  }

  /** Replace one part of the bench (a list, its graph), switching the bench on if the scene had none. */
  setBenchPart<K extends keyof SceneBench>(key: K, value: SceneBench[K], structural = false) {
    const bench: SceneBench = { enabled: true, ...(this.bench() ?? {}) };
    if (value == null) delete bench[key];
    else bench[key] = value;
    return this.setBench(bench, structural);
  }

  events(kind?: string): Row[] {
    return this.store
      .where('events', 'scene_id', this.sceneId)
      .filter((e) => !kind || e.kind === kind)
      .sort((a, b) => Number(a.sequence) - Number(b.sequence) || a.id - b.id);
  }

  /**
   * Give the scene a new size and move everything in it to match, so a walkable area along the
   * bottom is still along the bottom and a spawn point in the middle is still in the middle.
   */
  async resize(from: { width: number; height: number }, width: number, height: number) {
    const sx = width / from.width;
    const sy = height / from.height;
    const x = (v: unknown) => (v == null ? v : Math.round(Number(v) * sx));
    const y = (v: unknown) => (v == null ? v : Math.round(Number(v) * sy));
    const moved = <T extends Bag>(e: T): T => ({ ...e, position_x: x(e.position_x), position_y: y(e.position_y) });
    const area = (polygon: Point[]) => polygon.map((p) => ({ x: Math.round(p.x * sx), y: Math.round(p.y * sy) }));
    const layout = params(this.row, 'layout');
    await this.store.patch('scenes', this.sceneId, {
      width,
      height,
      layout: {
        ...layout,
        walkable_areas: this.layout<Point[]>('walkable_areas').map(area),
        blocked_areas: this.layout<Point[]>('blocked_areas').map(area),
        spawn_points: this.layout('spawn_points').map(moved),
        scale_areas: this.layout('scale_areas').map((a) => ({ ...a, x: x(a.x), y: y(a.y), width: x(a.width), height: y(a.height) })),
        shadow_spots: this.layout('shadow_spots').map((a) => ({ ...a, x: x(a.x), y: y(a.y), radius: x(a.radius), ...(a.radius_y != null ? { radius_y: y(a.radius_y) } : {}) })),
        lights: this.layout('lights').map((a) => ({ ...a, x: x(a.x), y: y(a.y), ...(a.radius != null ? { radius: x(a.radius) } : {}) })),
        flows: this.layout('flows').map((a) => ({ ...a, x: x(a.x), y: y(a.y), width: x(a.width), height: y(a.height) })),
        water_lights: this.layout('water_lights').map((a) => ({ ...a, x: x(a.x), y: y(a.y), width: x(a.width), height: y(a.height), ...(Array.isArray(a.shape) ? { shape: (a.shape as Point[]).map((p) => ({ x: Math.round(p.x * sx), y: Math.round(p.y * sy) })) } : {}) })),
        items: this.layout('items').map(moved),
        characters: this.layout('characters').map(moved),
        // A bench's containers and tools move with the scene; their sizes stay: a beaker stays a beaker.
        ...(this.bench()
          ? { bench: { ...this.bench()!, vessels: this.bench()!.vessels?.map((v) => ({ ...v, x: x(v.x) as number, y: y(v.y) as number })), tools: this.bench()!.tools?.map((t) => ({ ...t, x: x(t.x) as number, y: y(t.y) as number })) } }
          : {}),
      },
    }, true);
    for (const event of this.events('hotspot')) {
      void this.store.patch('events', event.id, { position_x: x(event.position_x), position_y: y(event.position_y) }, true);
      for (const label of this.store.where('labels', 'event_id', event.id)) {
        void this.store.patch('labels', label.id, { position_x: x(label.position_x), position_y: y(label.position_y) }, true);
      }
    }
  }

  /**
   * The size of the scene in pixels: its own width and height, or failing that the size its first
   * background is shown at. `natural` supplies the pixel size of an image once it has loaded.
   */
  size(natural: (url: string) => Point | null): { width: number; height: number; known: boolean } {
    const row = this.row;
    if (row.width && row.height) return { width: Number(row.width), height: Number(row.height), known: true };
    const layer = this.layers('background_media')[0];
    if (layer) {
      const shown = this.layerSize(layer, natural);
      if (shown) return { width: shown.x, height: shown.y, known: true };
    }
    return { width: 1920, height: 1080, known: false };
  }

  /**
   * Where a walk-in exit along one edge goes, as event columns. Left and right exits are a band
   * down the whole edge; top and bottom exits sit on the edge of where avatars can walk, not of
   * the picture. Used by the scene editor's "Exit along the … edge" and by the scene map.
   */
  edgeHotspot(side: Side, size: { width: number; height: number }): { shortname: string; activate_by_trigger: false; position_x: number | null; position_y: number | null; radius: number } {
    const ys = this.layout<Point[]>('walkable_areas').flat().map((p) => p.y);
    const where = {
      left: { position_x: 0, position_y: null, radius: 120 },
      right: { position_x: size.width, position_y: null, radius: 120 },
      top: { position_x: null, position_y: ys.length ? Math.min(...ys) : 0, radius: 30 },
      bottom: { position_x: null, position_y: ys.length ? Math.max(...ys) : size.height, radius: 30 },
    }[side];
    return { shortname: `edge-${side}`, activate_by_trigger: false, ...where };
  }

  /** The size a layer is drawn at, if it can be worked out yet. */
  layerSize(layer: Bag, natural: (url: string) => Point | null): Point | null {
    if (layer.display_width && layer.display_height) return { x: Number(layer.display_width), y: Number(layer.display_height) };
    const media = this.store.byId('media', layer.media_id as number | null);
    if (!media) return null;
    const scaleX = Number(media.scale_x ?? 1) || 1;
    const scaleY = Number(media.scale_y ?? 1) || 1;
    if (media.width && media.height) return { x: Number(media.width) * scaleX, y: Number(media.height) * scaleY };
    const url = mediaUrl(this.store, media);
    const size = url ? natural(url) : null;
    return size ? { x: size.x * scaleX, y: size.y * scaleY } : null;
  }
}

/** Remove empty values from a JSON object so optional attributes are simply absent. */
export function compact(bag: Bag): Bag {
  return Object.fromEntries(Object.entries(bag).filter(([, v]) => v != null && v !== '' && v !== false));
}
