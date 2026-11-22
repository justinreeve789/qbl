import type {
  AvatarCharacter, Npc, Action, ActionType, GameEvent, GlossaryEntry, Hotspot, Id, Item, Label, Media, Placement, Scenario, Scene, SceneLayer, SpawnPoint,
} from './types.js';
import { characterMediaIds, normalizeNpc, scenarioAvatars } from './characters.js';
import { allEvents, characterRoams, characterScenes, eachActionIn, firstPlacement } from './walking.js';

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

/**
 * A character's walk names the scene it goes to. One written before that (to a spot or a spawn
 * point of "this scene") goes to the scene of its event; one to a scene's spawn point is a walk
 * to that spawn point of that scene.
 */
function normalizeWalk(a: Action, scene: Scene | null): Action {
  if (a.type !== 'walk' || (a.target ?? 'character') !== 'character') return a;
  const to = a.to ?? 'point';
  if (to === 'scene' && a.spawn_point) return { ...a, to: 'spawn' };
  if ((to === 'point' || to === 'spawn') && a.scene_id == null && scene) return { ...a, scene_id: scene.id };
  return a;
}

function normalizeActions(list: Action[], scene: Scene | null): Action[] {
  const one = (raw: Action): Action => {
    const type = normalizeActionType(raw.type) ?? raw.type;
    let a = normalizeWalk({ ...raw, type, blocking: raw.blocking ?? true } as Action, scene);
    // Walks on buttons and in conversation choices are walks of the same event.
    if (a.type === 'infobox' && a.call_to_actions?.length) {
      a = { ...a, call_to_actions: a.call_to_actions.map((cta) => (cta.action ? { ...cta, action: normalizeWalk(cta.action as Action, scene) } : cta)) } as Action;
    }
    if (a.type === 'conversation' && a.lines?.length) {
      a = { ...a, lines: a.lines.map((line) => (line.choices?.length ? { ...line, choices: line.choices.map((c) => (c.actions?.length ? { ...c, actions: c.actions.map((inner) => normalizeWalk(inner as Action, scene)) } : c)) } : line)) } as Action;
    }
    return a;
  };
  return bySequence(list).map(one);
}

function normalizeEvent<T extends GameEvent>(event: T, scene: Scene | null = null): T {
  const actions = normalizeActions(event.actions ?? [], scene);
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
    start_events: (scene.start_events ?? []).map((e) => normalizeEvent(e, scene)),
    end_events: (scene.end_events ?? []).map((e) => normalizeEvent(e, scene)),
    indirect_events: (scene.indirect_events ?? []).map((e) => normalizeEvent(e, scene)),
    hotspots: (scene.hotspots ?? []).map((h) => ({
      ...normalizeEvent(h, scene),
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
    characters: (input.characters ?? []).map((c) => normalizeCharacter(normalizeNpc(c, (id) => assets.get(id)), scenes)),
    avatars: scenarioAvatars(input, (id) => assets.get(id)),
    assets: [...assets.values()].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100)),
    scenes,
  };
  out.jump_targets = computeJumpTargets(out);
  return out;
}

/**
 * A character as it is now. Written before they had animations: they get them from their picture
 * and close-up (normalizeNpc). Before they lived in the world: their first placement in the
 * scenes is where they start, and its event is what clicking them runs. Before routines went: a
 * character with a routine walked around on its own, and still does.
 */
function normalizeCharacter(npc: Npc, scenes: Scene[]): Npc {
  const out: Npc & { routine?: unknown } = { ...npc };
  if (out.scene_id == null) {
    const placed = firstPlacement({ scenes }, npc.id);
    if (placed) {
      out.scene_id = placed.scene.id;
      out.position_x = placed.placement.position_x;
      out.position_y = placed.placement.position_y;
      if (placed.placement.facing) out.facing = placed.placement.facing;
      if (out.event_id == null && placed.placement.event_id != null) out.event_id = placed.placement.event_id;
    }
  }
  const routine = out.routine as { steps?: unknown[] } | null | undefined;
  if (routine && Array.isArray(routine.steps) && routine.steps.length) out.roams = true;
  delete out.routine;
  out.roams = characterRoams(out);
  out.events = (npc.events ?? []).map((e) => ({ ...normalizeEvent(e), character_id: npc.id }));
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
  for (const e of eventsOf(scene)) eachActionIn(e.actions, visit);
}

/** Visit every action of a scene's events, including those on infobox buttons and conversation choices. */
export function forEachAction(scene: Scene, visit: (a: Action) => void): void {
  walkActions(scene, visit);
}

/**
 * Scene ids reachable from each scene through jump actions (including those on infobox buttons and
 * conversation choices). A character's own events run in whatever scene the player is in, so
 * their jumps lead from every scene.
 */
export function computeJumpTargets(scenario: Scenario): Record<string, Id[]> {
  const out: Record<string, Id[]> = {};
  const anywhere = new Set<Id>();
  for (const c of scenario.characters ?? []) for (const e of c.events ?? []) eachActionIn(e.actions, (a) => a.type === 'jump' && anywhere.add(a.scene_id));
  for (const scene of scenario.scenes) {
    const targets = new Set<Id>(anywhere);
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
  // The characters that can be here: those that start here or are walked here. (Those that walk
  // around on their own can be anywhere, so their pictures are loaded for every scene.)
  for (const c of scenario.characters ?? []) {
    if (!characterScenes(scenario, c)?.has(scene.id)) continue;
    for (const id of characterMediaIds(c)) add(id);
    // Not normalized yet: the older picture fields.
    if (!c.animations) {
      add(c.media_id);
      add(c.portrait_media_id);
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
  // A character that walks around on its own can walk into any scene.
  for (const c of scenario.characters ?? []) if (characterRoams(c)) for (const id of characterMediaIds(c)) ids.add(id);
  // A character's own events run in whatever scene the player is in.
  for (const c of scenario.characters ?? []) {
    for (const e of c.events ?? []) {
      eachActionIn(e.actions, (a) => {
        for (const id of [a.media_id, 'narration_media_id' in a ? a.narration_media_id : null, a.type === 'award' ? a.badge_media_id : null]) if (id != null) ids.add(id);
        if (a.type === 'conversation') for (const line of a.lines ?? []) if (line.narration_media_id != null) ids.add(line.narration_media_id);
      });
    }
  }
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
  /** Every event by id: a scene's (with its scene), or a character's own (with its character, and no scene). */
  readonly events = new Map<Id, { event: GameEvent; scene: Scene | null; character: Npc | null }>();
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
      for (const h of scene.hotspots ?? []) this.hotspots.set(h.id, { hotspot: h, scene });
    }
    for (const found of allEvents(scenario)) this.events.set(found.event.id, found);
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
