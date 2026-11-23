import type * as Phaser from 'phaser';
import { sortDepth, type PlacedSortLine } from '@qbl/shared';

/**
 * The sort lines of the items standing in each Phaser scene now (see `sort_line` on items). Items
 * put theirs here as they are drawn and moved; figures ask `figureDepth` where to be drawn.
 */
const lines = new WeakMap<Phaser.Scene, Map<unknown, PlacedSortLine>>();

/** Set, move or (with null) remove the sort line of something standing in `scene`. */
export function setSortLine(scene: Phaser.Scene, key: unknown, line: PlacedSortLine | null) {
  let map = lines.get(scene);
  if (!line) {
    map?.delete(key);
    return;
  }
  if (!map) lines.set(scene, (map = new Map()));
  map.set(key, line);
}

/** The depth for a figure whose feet are at (`x`, `y`), `halfWidth` wide either side: `y`, unless an item's sort line says otherwise. */
export function figureDepth(scene: Phaser.Scene, x: number, y: number, halfWidth = 0): number {
  const map = lines.get(scene);
  return map && map.size > 0 ? sortDepth(map.values(), x, y, halfWidth) : y;
}
