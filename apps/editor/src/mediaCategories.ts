import type { Row } from './api';
import { characterMediaIds } from './characters';
import { params } from './describe';
import type { Store } from './store';

/**
 * The kinds of file the Media page sorts the scenario's media into, shared with the media picker
 * so a field that wants a background opens on the backgrounds.
 */
export const MEDIA_TABS = [
  ['all', 'All', '🗂️'], ['sprites', 'Sprites', '🎞️'], ['background', 'Backgrounds', '🏞️'], ['character', 'NPCs', '🧑‍🚀'],
  ['item', 'Items', '🎒'], ['vehicle', 'Vehicles', '🚙'], ['audio', 'Sounds and music', '🔊'], ['video', 'Video', '🎬'], ['shop', 'Shop items', '🛍️'], ['other', 'Other images', '🖼️'],
] as const;
export type MediaTab = (typeof MEDIA_TABS)[number][0];
/**
 * Sprites is a view across the other tabs, not a place a file is filed: every picture cut into a
 * sprite sheet, and every animated PNG, whatever else it is used for.
 */
export type MediaCategory = Exclude<MediaTab, 'all' | 'sprites'>;
export const isCategory = (key: string): key is MediaCategory => MEDIA_TABS.some(([k]) => k === key && k !== 'all' && k !== 'sprites');
export const isSprite = (media: Row) => media.type === 'image' && Boolean(params(media).sheet || params(media).apng);
export const tabLabel = (tab: MediaTab) => MEDIA_TABS.find(([key]) => key === tab)!;

/**
 * Which tab a file belongs under. By default this follows how it is used (a scene layer is a
 * background, a character's picture is an NPC, and so on); a file can also be filed by hand,
 * which is what puts a fresh upload under the tab it was uploaded from.
 */
export function mediaCategory(store: Store, media: Row): MediaCategory {
  const chosen = params(media).category as string | undefined;
  if (chosen && isCategory(chosen)) return chosen;
  if (media.type === 'audio') return 'audio';
  if (media.type === 'video') return 'video';
  const id = media.id;
  const layers = store.rows('scenes').flatMap((s) => [...((s.background_media as Array<Record<string, unknown>> | null) ?? []), ...((s.foreground_media as Array<Record<string, unknown>> | null) ?? [])]);
  if (layers.some((l) => (l.media_id ?? l.id) === id)) return 'background';
  if (store.rows('characters').some((c) => characterMediaIds(store, c).includes(id))) return 'character';
  const item = store.rows('items').find((i) => i.media_id === id);
  if (item) return item.vehicle ? 'vehicle' : 'item';
  if (store.rows('shop_items').some((i) => i.media_id === id)) return 'shop';
  return 'other';
}

/** Whether a file shows under a tab. */
export function inTab(store: Store, media: Row, tab: MediaTab, category = mediaCategory(store, media)): boolean {
  return tab === 'all' ? true : tab === 'sprites' ? isSprite(media) : category === tab;
}
