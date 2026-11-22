import type {
  AvatarCharacter, Npc, Action, ActionType, GameEvent, GlossaryEntry, Hotspot, Id, Item, Label, Media, Placement, Scenario, Scene, SceneLayer, SpawnPoint,
} from './types.js';
import { characterMediaIds, normalizeNpc, scenarioAvatars } from './characters.js';
import { characterRoams, normalizeRoutine } from './walking.js';

const ACTION_TYPES: ActionType[] = [
  'animate', 'award', 'glossary', 'shop', 'dialogue', 'conversation', 'avatar', 'freeze', 'audio', 'cancel', 'image_fixed', 'image_overlay', 'infobox', 'jump', 'repeat',
  'run_event', 'spritemap', 'text_overlay', 'translate', 'variable', 'video', 'wait', 'walk', 'bench',
];

/** "Image Fixed", "imageFixed" and "image_fixed" all become "image_fixed". */
export function normalizeActionType(raw: unknown): ActionType | null {
  if (typeof raw !== 'string') return null;
  const key = raw
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return (ACTION_TYPES as string[]).includes(key) ? (key as ActionType) : null;
}

function bySequence<T extends { sequence?: number }>(list: T[]): T[] {
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.sequence ?? a.index) - (b.item.sequence ?? b.index) || a.index - b.index)
    .map((x) => x.item);
}

function normalizeEvent<T extends GameEvent>(event: T): T {
  const actions = bySequence(event.actions ?? []).map((a) => {
    const type = normalizeActionType(a.type) ?? a.type;
    return { ...a, type, blocking: a.blocking ?? true } as Action;
  });
  return {
    ...event,
    overridable: event.overridable ?? false,
    block_hotspots: event.block_hotspots ?? false,
    audience: event.audience === 'scene' ? 'scene' : 'player',
    conditions: event.conditions ?? [],
    actions,
  };
}

/** A layer entry may be a SceneLayer or a bare media object. */
export function layerMediaId(layer: SceneLayer | Media): Id {
  return 'media_id' in layer ? layer.media_id : layer.id;
}

/**
 * Fill in documented defaults, order scenes and actions by sequence and
 * canonicalise action type names. Returns a new object; the input is untouched.
 */
export function normalizeScenario(input: Scenario): Scenario {
  const scenes = bySequence(input.scenes ?? []).map((scene): Scene => ({
    ...scene,
    zoom: scene.zoom ?? 1,
    show_avatars: scene.show_avatars ?? true,
    background_media: scene.background_media ?? [],
    foreground_media: scene.foreground_media ?? [],
    start_events: (scene.start_events ?? []).map(normalizeEvent),
    end_events: (scene.end_events ?? []).map(normalizeEvent),
    indirect_events: (scene.indirect_events ?? []).map(normalizeEvent),
    hotspots: (scene.hotspots ?? []).map((h) => ({
      ...normalizeEvent(h),
      radius: h.radius ?? -1,
      activate_by_trigger: h.activate_by_trigger ?? false,
      labels: h.labels ?? [],
    })),
    spawn_points: scene.spawn_points ?? [],
    items: scene.items ?? [],
    characters: scene.characters ?? [],
  }));

  // Inline media objects on layers and labels are hoisted into assets.
  const assets = new Map<Id, Media>();
  for (const m of input.assets ?? []) assets.set(m.id, m);
  const hoist = (m: unknown) => {
    if (m && typeof m === 'object' && 'id' in m && 'type' in m) {
      const media = m as Media;
      if (!assets.has(media.id)) assets.set(media.id, media);
    }
  };
  for (const scene of scenes) {
    for (const l of [...scene.background_media!, ...scene.foreground_media!]) if (!('media_id' in l)) hoist(l);
    for (const h of scene.hotspots!) for (const label of h.labels!) hoist(label.media);
  }

  const out: Scenario = {
    ...input,
    enable_save_session: input.enable_save_session ?? true,
    require_login: input.require_login ?? true,
    allow_groups: input.allow_groups ?? false,
    default_language: input.default_language ?? 'en-us',
    chat_mode: input.chat_mode ?? 'emotes',
    move_speed: input.move_speed ?? 420,
    global_variables: input.global_variables ?? [],
    // A vehicle is one object in the world: it goes where it is driven, stays where it is left, and
    // whoever finds it there can use it. That is what `unique` means, so every vehicle is unique.
    items: (input.items ?? []).map((item) => (item.vehicle && !item.unique ? { ...item, unique: true } : item)),
    // Characters written before they had animations get them from their picture and close-up.
    // A character with a routine roams: the routine walks it around the world.
    characters: (input.characters ?? []).map((c) => {
      const npc = normalizeNpc(c, (id) => assets.get(id));
      const routine = normalizeRoutine(npc.routine);
      return { ...npc, routine, roams: characterRoams({ roams: npc.roams, routine }) };
    }),
    avatars: scenarioAvatars(input, (id) => assets.get(id)),
    assets: [...assets.values()].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100)),
    scenes,
  };
  out.jump_targets = computeJumpTargets(out);
  return out;
}

/**
 * Whether a scene shows a player only their own team: what the scene says, or else its group,
 * or else no (everyone playing is shown).
 */
export function sceneTeamOnly(scenario: Pick<Scenario, 'scene_groups'>, scene: Pick<Scene, 'team_only' | 'group_id'>): boolean {
  if (scene.team_only != null) return scene.team_only === true;
  const group = scene.group_id != null ? (scenario.scene_groups ?? []).find((g) => g.id === scene.group_id) : undefined;
  return group?.team_only === true;
}

/**
 * Where a hotspot label stands relative to the players. Unless it says otherwise a label is part
 * of the background: players are always drawn in front of it, wherever they walk.
 */
export function labelPlacement(label: Pick<Label, 'placement'>): Placement {
  if (label.placement === 'object' || label.placement === 'front') return label.placement;
  return 'background';
}

/** The glossary entries a player has: those there from the start and those their flags record. */
export function glossaryOf(scenario: Pick<Scenario, 'glossary'>, flags: Iterable<string>): GlossaryEntry[] {
  const have = new Set(flags);
  return (scenario.glossary ?? [])
    .filter((e) => e.initial === true || have.has(glossaryFlag(e.id)))
    .sort((a, b) => a.term.localeCompare(b.term));
}

export function glossaryFlag(entryId: Id | string): string {
  return `glossary:${String(entryId).slice(0, 48)}`;
}

export function labelMediaId(label: Label): Id | null {
  if (label.media == null) return null;
  return typeof label.media === 'number' ? label.media : label.media.id;
}

function eventsOf(scene: Scene): GameEvent[] {
  return [
    ...(scene.start_events ?? []),
    ...(scene.end_events ?? []),
    ...(scene.hotspots ?? []),
    ...(scene.indirect_events ?? []),
  ];
}

function walkActions(scene: Scene, visit: (a: Action) => void): void {
  const walk = (a: Action) => {
    visit(a);
    if (a.type === 'infobox') {
      for (const cta of a.call_to_actions ?? []) if (cta.action) walk(cta.action as Action);
    }
    if (a.type === 'conversation') {
      for (const line of a.lines ?? []) for (const c of line.choices ?? []) for (const inner of c.actions ?? []) walk(inner as Action);
    }
  };
  for (const e of eventsOf(scene)) for (const a of e.actions) walk(a);
}

/** Visit every action of a scene's events, including those on infobox buttons and conversation choices. */
export function forEachAction(scene: Scene, visit: (a: Action) => void): void {
  walkActions(scene, visit);
}

/** Scene ids reachable from each scene through jump actions (including those on infobox buttons and conversation choices). */
export function computeJumpTargets(scenario: Scenario): Record<string, Id[]> {
  const out: Record<string, Id[]> = {};
  for (const scene of scenario.scenes) {
    const targets = new Set<Id>();
    walkActions(scene, (a) => {
      if (a.type === 'jump') targets.add(a.scene_id);
    });
    targets.delete(scene.id);
    out[String(scene.id)] = [...targets];
  }
  return out;
}

/** Every media id a scene needs before it can be shown. */
export function collectSceneMediaIds(scenario: Scenario, scene: Scene): Id[] {
  const ids = new Set<Id>();
  const add = (id: Id | null | undefined) => {
    if (id != null) ids.add(id);
  };
  for (const l of [...(scene.background_media ?? []), ...(scene.foreground_media ?? [])]) add(layerMediaId(l));
  add(scene.music_media_id);
  for (const h of scene.hotspots ?? []) for (const label of h.labels ?? []) add(labelMediaId(label));
  walkActions(scene, (a) => {
    add(a.media_id);
    if ('narration_media_id' in a) add(a.narration_media_id);
    if (a.type === 'award') add(a.badge_media_id);
    if (a.type === 'conversation') for (const line of a.lines ?? []) add(line.narration_media_id);
  });
  const items = new Map((scenario.items ?? []).map((i) => [i.id, i]));
  for (const p of scene.items ?? []) add(items.get(p.item_id)?.media_id);
  const chars = new Map((scenario.characters ?? []).map((c) => [c.id, c]));
  for (const p of scene.characters ?? []) {
    const c = chars.get(p.character_id);
    for (const id of characterMediaIds(c)) add(id);
    // Not normalized yet: the older picture fields.
    if (!c?.animations) {
      add(c?.media_id);
      add(c?.portrait_media_id);
    }
  }
  return [...ids];
}

/** Media needed everywhere: avatars, attachable items (they travel with players) and splash screens. */
export function collectGlobalMediaIds(scenario: Scenario): Id[] {
  // Every avatar's pictures: players bring theirs into every scene.
  const ids = new Set<Id>(scenario.avatars ? scenario.avatars.flatMap((a) => characterMediaIds(a)) : scenario.avatar_media_ids ?? []);
  if (!scenario.avatars) for (const id of Object.values(scenario.avatar_portraits ?? {})) ids.add(id);
  if (scenario.music_media_id != null) ids.add(scenario.music_media_id);
  // What players wear travels with them, so a scenario's shop pictures are needed everywhere.
  for (const item of scenario.shop_items ?? []) if (item.media_id != null) ids.add(item.media_id);
  for (const entry of scenario.glossary ?? []) if (entry.media_id != null) ids.add(entry.media_id);
  for (const item of scenario.items ?? []) {
    if ((item.vehicle || item.wearable) && item.media_id != null) ids.add(item.media_id);
  }
  // A character that roams can walk into any scene.
  for (const c of scenario.characters ?? []) if (characterRoams(c)) for (const id of characterMediaIds(c)) ids.add(id);
  return [...ids];
}

export function resolveMediaUrl(scenario: Pick<Scenario, 'asset_base_url'>, media: Media): string | null {
  const raw = media.url ?? (media.filepath && media.filename ? joinPath(media.filepath, media.filename) : null);
  if (!raw) return null;
  // Absolute URLs and site-root paths (uploaded media lives under /media) are used as they are.
  if (/^(https?:)?\/\//.test(raw) || raw.startsWith('data:') || raw.startsWith('/')) return raw;
  const base = scenario.asset_base_url ?? '';
  return joinPath(base, raw);
}

function joinPath(a: string, b: string): string {
  if (!a) return b;
  return `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`;
}

/** Fast lookups over a normalized scenario. */
export class ScenarioIndex {
  readonly scenes = new Map<Id, Scene>();
  readonly media = new Map<Id, Media>();
  readonly items = new Map<Id, Item>();
  readonly events = new Map<Id, { event: GameEvent; scene: Scene }>();
  readonly hotspots = new Map<Id, { hotspot: Hotspot; scene: Scene }>();
  /** The scenario's characters (NPCs) and the avatars players choose from, by id. */
  readonly characters = new Map<Id, Npc>();
  readonly avatars = new Map<Id, AvatarCharacter>();

  constructor(readonly scenario: Scenario) {
    for (const m of scenario.assets ?? []) this.media.set(m.id, m);
    for (const i of scenario.items ?? []) this.items.set(i.id, i);
    for (const c of scenario.characters ?? []) this.characters.set(c.id, c);
    for (const a of scenario.avatars ?? []) this.avatars.set(a.id, a);
    for (const scene of scenario.scenes) {
      this.scenes.set(scene.id, scene);
      for (const e of eventsOf(scene)) this.events.set(e.id, { event: e, scene });
      for (const h of scene.hotspots ?? []) this.hotspots.set(h.id, { hotspot: h, scene });
    }
  }

  scene(id: Id): Scene | undefined {
    return this.scenes.get(id);
  }

  startScene(): Scene {
    const s = this.scenes.get(this.scenario.start_scene_id) ?? this.scenario.scenes[0];
    if (!s) throw new Error('Scenario has no scenes');
    return s;
  }

  jumpTargets(sceneId: Id): Id[] {
    const jt = this.scenario.jump_targets;
    if (!jt) return [];
    if (Array.isArray(jt)) return jt.find((x) => x.scene_id === sceneId)?.targets ?? [];
    return jt[String(sceneId)] ?? [];
  }

  spawn(scene: Scene, name?: string | null): SpawnPoint | null {
    const points = scene.spawn_points ?? [];
    return (
      points.find((p) => p.name === name) ??
      points.find((p) => p.name === 'default') ??
      points[0] ??
      null
    );
  }
}

/**
 * World size of a scene from the document alone: explicit width/height,
 * else the first background layer's display size or media dimensions.
 * Returns null when the document does not say (the client can still fall
 * back to the loaded image, but the server cannot).
 */
export function sceneSize(scenario: Scenario, scene: Scene): { width: number; height: number } | null {
  if (scene.width && scene.height) return { width: scene.width, height: scene.height };
  const layer = scene.background_media?.[0];
  if (!layer) return null;
  if ('media_id' in layer && layer.display_width && layer.display_height) {
    return { width: layer.display_width, height: layer.display_height };
  }
  const id = layerMediaId(layer);
  const media = (scenario.assets ?? []).find((m) => m.id === id) ?? ('media_id' in layer ? undefined : layer);
  if (media?.width && media?.height) {
    return { width: media.width * (media.scale_x ?? 1), height: media.height * (media.scale_y ?? 1) };
  }
  return null;
}

/**
 * The background music a scene starts with: its own, or else the scenario's. Events can change
 * the music afterwards with a persistent audio action; the next scene starts with its own again.
 */
export function sceneMusic(
  scenario: Pick<Scenario, 'music_media_id' | 'music_volume'>,
  scene: Pick<Scene, 'music_media_id' | 'music_volume' | 'start_events'>,
): { media_id: Id; volume: number } | null {
  if (scene.music_media_id != null) return { media_id: scene.music_media_id, volume: scene.music_volume ?? scenario.music_volume ?? 0.5 };
  // A scene whose start events start background music is choosing its own that way. Starting the
  // scenario's first would cut off and restart the track every time the scene is entered.
  const startsItsOwn = (scene.start_events ?? []).some((e) => e.actions.some((a) => a.type === 'audio' && a.persist));
  if (startsItsOwn) return null;
  if (scenario.music_media_id != null) return { media_id: scenario.music_media_id, volume: scenario.music_volume ?? 0.5 };
  return null;
}

/** How long a line of dialogue stays up when its action gives no duration: time to read it. */
export function dialogueDuration(text: string): number {
  return Math.min(12_000, 1800 + text.length * 55);
}
