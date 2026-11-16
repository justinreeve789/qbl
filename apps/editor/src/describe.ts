import { resolveMediaUrl, type Media } from '@qbl/shared';
import type { Row } from './api';
import type { Store } from './store';

/** Human-readable names for rows, used in lists and pickers. */

export function mediaLabel(row: Row | undefined): string {
  if (!row) return '(missing media)';
  const url = (row.url as string | null) ?? '';
  return (row.filename as string | null) || url.split('/').pop() || `Media ${row.id}`;
}

/** The address a media row can be loaded from, or null if it has none. */
export function mediaUrl(store: Store, row: Row | undefined): string | null {
  if (!row) return null;
  return resolveMediaUrl({ asset_base_url: store.settings.asset_base_url as string | undefined }, row as unknown as Media);
}

export function sceneLabel(row: Row | undefined): string {
  if (!row) return '(missing scene)';
  return (row.shortname as string | null) || (row.subtitle as string | null) || `Scene ${row.id}`;
}

export const EVENT_KINDS = {
  start: 'Start event',
  end: 'End event',
  hotspot: 'Hotspot',
  indirect: 'Indirect event',
} as const;

export function eventLabel(row: Row | undefined): string {
  if (!row) return '(missing event)';
  return (row.shortname as string | null) || `${EVENT_KINDS[row.kind as keyof typeof EVENT_KINDS]} ${row.id}`;
}

export function params(row: Row, column = 'params'): Record<string, unknown> {
  const value = row[column];
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const text = (html: unknown) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One line saying what an action does, e.g. `Jump to "control-room"`. Works for rows and for inline actions. */
export function actionSummary(store: Store, type: string, values: Record<string, unknown>): string {
  const media = () => mediaLabel(store.byId('media', values.media_id as number | null));
  switch (type) {
    case 'avatar':
      return values.visible === false ? 'Hide the player’s avatar' : 'Show the player’s avatar';
    case 'audio':
      return `Play ${media()}${values.persist ? ' as music' : ''}`;
    case 'cancel':
      return `Cancel action ${values.action_id ?? '?'}`;
    case 'image_fixed':
      return `Show ${media()} in the scene`;
    case 'image_overlay':
      return `Show ${media()} over the screen`;
    case 'infobox':
      return `Infobox: ${clip(text(values.content)) || '(empty)'}`;
    case 'jump':
      return `Jump to ${sceneLabel(store.byId('scenes', values.scene_id as number | null))}`;
    case 'repeat':
      return 'Repeat this event';
    case 'run_event':
      return `Run ${eventLabel(store.byId('events', (values.target_event_id ?? values.event_id) as number | null))}`;
    case 'spritemap':
      return `Animate ${media()}`;
    case 'text_overlay':
      return `Text: ${clip(String(values.text ?? '')) || '(empty)'}`;
    case 'translate':
      return `Move or fade action ${values.target_id ?? '?'}`;
    case 'variable':
      return `${values.name ?? '?'} ${values.operator ?? 'set'} ${values.operand ?? ''}`.trim();
    case 'video':
      return `Play video ${media()}`;
    case 'wait':
      return `Wait ${values.duration ?? 0} ms`;
    default:
      return type;
  }
}

/** The values of an action row as the game sees them: columns and params side by side. */
export function actionValues(row: Row): Record<string, unknown> {
  return { ...params(row), blocking: row.blocking, media_id: row.media_id };
}

export function actionLabel(store: Store, row: Row | undefined): string {
  if (!row) return '(missing action)';
  const event = store.byId('events', row.event_id as number);
  return `${eventLabel(event)} › ${actionSummary(store, row.type as string, actionValues(row))}`;
}

export function conditionText(c: Record<string, unknown>): string {
  return `${c.variable ?? '?'} ${c.operator ?? '='} ${c.operand ?? ''}`;
}
