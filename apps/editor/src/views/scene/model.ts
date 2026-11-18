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
  | { kind: 'shadow'; index: number };

export type LayerList = 'background_media' | 'foreground_media';
export type AreaList = 'walkable_areas' | 'blocked_areas';
export type LayoutList = 'spawn_points' | 'items' | 'characters' | 'scale_areas' | 'shadow_spots' | AreaList;

export interface Point { x: number; y: number }
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
        items: this.layout('items').map(moved),
        characters: this.layout('characters').map(moved),
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
