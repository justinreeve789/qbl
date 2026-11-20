import { PHYSICS_OPS } from '@qbl/shared';
import { infoboxRefs, resolveMediaUrl, type Media } from '@qbl/shared';
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
    case 'award': {
      const part = (n: unknown, unit: string) => (Number(n) ? `${Number(n) > 0 ? '+' : ''}${Number(n)} ${unit}` : '');
      return [part(values.stars, '⭐'), part(values.xp, 'XP')].filter(Boolean).join('  ') + (values.repeatable ? ' (every time)' : '') || 'Award nothing';
    }
    case 'shop':
      return 'Open the marketplace';
    case 'dialogue':
      return `${values.speaker === 'character' ? String(store.byId('characters', values.character_id as number | null)?.name ?? 'Character') : 'Player'} ${values.style === 'portrait' ? 'says, in a story box' : 'says'}: ${clip(String(values.text ?? ''))}`;
    case 'conversation': {
      const lines = Array.isArray(values.lines) ? (values.lines as Array<Record<string, unknown>>) : [];
      const first = lines.find((l) => l.id === values.start) ?? lines[0];
      const choices = lines.reduce((n, l) => n + (Array.isArray(l.choices) ? l.choices.length : 0), 0);
      const who = first?.speaker === 'character' ? String(store.byId('characters', first.character_id as number | null)?.name ?? 'Character') : 'Player';
      return `${lines.length} line${lines.length === 1 ? '' : 's'}, ${choices} choice${choices === 1 ? '' : 's'}${first ? `: ${who}: ${clip(String(first.text ?? ''), 36)}` : ''}`;
    }
    case 'freeze':
      return values.frozen === false ? 'Let the player move again' : 'Stop the player from moving';
    case 'physics': {
      const op = String(values.op ?? 'play');
      const label = PHYSICS_OPS.find(([key]) => key === op)?.[1] ?? op;
      if (op === 'gravity') return `Physics: gravity ${values.value ?? '?'} m/s²`;
      if (op === 'spawn') return `Physics: add “${String(values.entry_id ?? '?')}” from the tray`;
      if (op === 'remove') return `Physics: remove “${String(values.body_id ?? '?')}”`;
      return `Physics: ${label.toLowerCase()}`;
    }
    case 'animate': {
      const who = values.target === 'item' ? String(store.byId('items', values.item_id as number | null)?.name ?? 'An item')
        : values.target === 'character' ? String(store.byId('characters', values.character_id as number | null)?.name ?? 'A character')
        : values.target === 'action' ? `Action #${values.target_id ?? '?'}` : 'The player';
      return values.animation ? `${who}: ${values.animation}` : `${who}: stop animating`;
    }
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
    case 'infobox': {
      const refs = infoboxRefs(String(values.content ?? ''));
      const extra = [refs.pages > 1 ? `${refs.pages} pages` : '', refs.media.length ? `${refs.media.length} ${refs.media.length === 1 ? 'picture' : 'pictures'}` : ''].filter(Boolean).join(', ');
      return `Infobox: ${clip(text(values.content)) || (refs.media.length ? '' : '(empty)')}${extra ? ` (${extra})` : ''}`;
    }
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
    case 'walk': {
      const who = values.target === 'player' ? 'The player' : String(store.byId('characters', values.character_id as number | null)?.name ?? 'A character');
      return `${who} walks ${walkDestination(store, values)}`;
    }
    default:
      return type;
  }
}

/** Where a walk goes, in a few words: "to 450, 300", "to spawn point door", "to the lab". */
export function walkDestination(store: Store, values: Record<string, unknown>): string {
  switch ((values.to as string | undefined) ?? 'point') {
    case 'spawn':
      return `to spawn point ${values.spawn_point ?? '?'}`;
    case 'scene': {
      const scene = sceneLabel(store.byId('scenes', values.scene_id as number | null));
      return values.spawn_point ? `to ${scene}, then to ${values.spawn_point}` : `to ${scene}`;
    }
    default:
      return `to ${values.position_x ?? '?'}, ${values.position_y ?? '?'}`;
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
