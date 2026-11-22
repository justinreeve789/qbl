import { inHotspot, isWalkable, walkContext } from './geometry.js';
import { labelMediaId, layerMediaId, normalizeActionType, sceneSize } from './scenario.js';
import { ANIMATION_NAME, BUILT_IN_MOVES, findAnimation, frameCount } from './types.js';
import { ROUTINE_STEP_TYPES } from './types.js';
import type { Action, Character, Condition, ConversationAction, GameEvent, Id, Media, Npc, RoutineStep, Scenario, Scene, WalkAction } from './types.js';
import { CHARACTER_POSES, isPose, normalizeNpc } from './characters.js';
import { characterRoams, doorsOf, normalizeRoutine, routeBetween, startPlacement } from './walking.js';
import { ScenarioIndex } from './scenario.js';
import { placeholderVariables } from './text.js';
import { BUTTON_MARKS, INFOBOX_SIZES, infoboxRefs } from './infobox.js';
import { SKY_TIMES } from './sky.js';
import { LINE_ID, reachableLines } from './conversation.js';
import { isBuiltInSound } from './sounds.js';
import { FLOW_KINDS, WEATHER_KINDS } from './weather.js';
import { ABILITY_PREFIX, isReserved, RESERVED_VARIABLES } from './variables.js';

export interface Issue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
}

const CONDITION_OPS = ['=', '!=', '>', '<', '>=', '<='];
const VARIABLE_OPS = ['set', '+', '-', '*', '/', '%', 'random'];
const MEDIA_FOR_ACTION: Record<string, Media['type'] | undefined> = {
  audio: 'audio',
  image_fixed: 'image',
  image_overlay: 'image',
  spritemap: 'image',
  video: 'video',
};

/**
 * Check a scenario document for structural problems before it is played or
 * published. Errors mean the runtime cannot be trusted to play it; warnings
 * are things an author probably did not intend.
 */
export function validateScenario(doc: unknown): ValidationResult {
  const issues: Issue[] = [];
  const err = (path: string, message: string) => issues.push({ level: 'error', path, message });
  const warn = (path: string, message: string) => issues.push({ level: 'warning', path, message });
  const done = (): ValidationResult => {
    const errors = issues.filter((i) => i.level === 'error');
    return { ok: errors.length === 0, errors, warnings: issues.filter((i) => i.level === 'warning') };
  };

  if (!doc || typeof doc !== 'object') {
    err('', 'Scenario must be an object');
    return done();
  }
  const s = doc as Scenario;
  if (typeof s.id !== 'number') err('id', 'id must be a number');
  if (!s.shortname || typeof s.shortname !== 'string') err('shortname', 'shortname is required');
  if (!s.title) warn('title', 'title is empty');
  if (!Array.isArray(s.scenes) || s.scenes.length === 0) {
    err('scenes', 'A scenario needs at least one scene');
    return done();
  }

  const unique = (ids: Array<[Id, string]>, what: string) => {
    const seen = new Map<Id, string>();
    for (const [id, path] of ids) {
      if (typeof id !== 'number') err(path, `${what} id must be a number`);
      else if (seen.has(id)) err(path, `Duplicate ${what} id ${id} (also at ${seen.get(id)})`);
      else seen.set(id, path);
    }
    return seen;
  };

  const media = new Map<Id, Media>();
  (s.assets ?? []).forEach((m, i) => {
    const path = `assets[${i}]`;
    if (media.has(m.id)) err(path, `Duplicate media id ${m.id}`);
    media.set(m.id, m);
    if (!['audio', 'image', 'video'].includes(m.type)) err(`${path}.type`, `Unknown media type "${m.type}"`);
    if (!m.url && !m.filename) err(path, 'Media needs a url or a filename');
  });
  const inlineMedia = (m: unknown) => {
    if (m && typeof m === 'object' && 'id' in m) media.set((m as Media).id, m as Media);
  };
  for (const scene of s.scenes) {
    for (const l of [...(scene.background_media ?? []), ...(scene.foreground_media ?? [])]) {
      if (!('media_id' in l)) inlineMedia(l);
    }
    for (const h of scene.hotspots ?? []) for (const label of h.labels ?? []) inlineMedia(label.media);
  }

  const variables = new Set<string>();
  (s.global_variables ?? []).forEach((v, i) => {
    const path = `global_variables[${i}]`;
    if (!v.variable_name) err(path, 'variable_name is required');
    else if (isReserved(v.variable_name)) err(path, `"${v.variable_name}" uses the reserved QBL prefix`);
    else if (variables.has(v.variable_name)) err(path, `Duplicate variable "${v.variable_name}"`);
    variables.add(v.variable_name);
    if (v.scope && !['player', 'room'].includes(v.scope)) err(`${path}.scope`, 'scope must be "player" or "room"');
  });

  const items = unique((s.items ?? []).map((it, i) => [it.id, `items[${i}]`]), 'item');
  const characters = unique((s.characters ?? []).map((c, i) => [c.id, `characters[${i}]`]), 'character');
  const scenes = unique(s.scenes.map((sc, i) => [sc.id, `scenes[${i}]`]), 'scene');

  const needMedia = (id: Id | null | undefined, path: string, type?: Media['type']) => {
    if (id == null) return;
    const m = media.get(id);
    if (!m) err(path, `Media ${id} is not in the scenario's media (it may have been deleted)`);
    else if (type && m.type !== type) err(path, `Media ${id} is ${m.type}, expected ${type}`);
  };

  (s.items ?? []).forEach((it, i) => needMedia(it.media_id, `items[${i}].media_id`, 'image'));
  // A character's animations: each names a picture, and frames the picture has.
  const checkAnimations = (c: Pick<Character, 'animations'>, path: string) => {
    if (c.animations == null) return;
    if (typeof c.animations !== 'object' || Array.isArray(c.animations)) return err(`${path}.animations`, 'animations is an object of animations by name');
    for (const [name, a] of Object.entries(c.animations)) {
      const ap = `${path}.animations.${name}`;
      if (!ANIMATION_NAME.test(name)) err(ap, 'An animation name is lowercase letters, digits and underscores, starting with a letter');
      if (!a || typeof a !== 'object' || a.media_id == null) {
        err(`${ap}.media_id`, 'An animation needs a picture');
        continue;
      }
      needMedia(a.media_id, `${ap}.media_id`, 'image');
      const picture = media.get(a.media_id);
      if (a.frames != null) {
        const count = frameCount(picture);
        if (!Array.isArray(a.frames)) err(`${ap}.frames`, 'frames is a list of frame numbers');
        else if (picture && !picture.sheet && !picture.apng && a.frames.length) warn(`${ap}.frames`, 'The picture is not a sprite sheet or an animated PNG, so it has no frames to choose from');
        else if (picture && a.frames.some((f) => !Number.isInteger(f) || f < 0 || f >= count)) err(`${ap}.frames`, `Frames are numbered 0 to ${count - 1}`);
      }
      if (a.duration != null && !(typeof a.duration === 'number' && a.duration > 0)) err(`${ap}.duration`, 'duration is a number of milliseconds');
    }
    if (!CHARACTER_POSES.some((pose) => pose !== 'portrait' && c.animations![pose])) warn(`${path}.animations`, 'No standing or walking picture: the character cannot be seen in a scene');
  };
  (s.characters ?? []).forEach((c, i) => {
    needMedia(c.media_id, `characters[${i}].media_id`, 'image');
    needMedia(c.portrait_media_id, `characters[${i}].portrait_media_id`, 'image');
    checkAnimations(c, `characters[${i}]`);
    if (c.walk_speed != null && !(typeof c.walk_speed === 'number' && c.walk_speed > 0)) err(`characters[${i}].walk_speed`, 'walk_speed is a number of pixels per second greater than 0');
  });
  (s.avatar_media_ids ?? []).forEach((id, i) => needMedia(id, `avatar_media_ids[${i}]`, 'image'));
  if (s.avatars != null) {
    if (!Array.isArray(s.avatars)) err('avatars', 'avatars is a list');
    else {
      const avatarIds = new Set<Id>();
      s.avatars.forEach((a, i) => {
        if (typeof a.id !== 'number' || avatarIds.has(a.id)) err(`avatars[${i}].id`, 'An avatar needs an id of its own');
        avatarIds.add(a.id);
        if (typeof a.name !== 'string' || a.name.trim() === '') warn(`avatars[${i}].name`, 'An avatar should have a name');
        checkAnimations(a, `avatars[${i}]`);
      });
    }
  }
  // Sprite sheets and the animations defined on them.
  (s.assets ?? []).forEach((m, i) => {
    const p = `assets[${i}]`;
    if (m.animations?.length && !m.sheet) err(`${p}.animations`, 'Animations need a sprite sheet: say how many frames across and down');
    if (!m.sheet) return;
    if (m.type !== 'image') err(`${p}.sheet`, 'Only an image can be a sprite sheet');
    const { columns, rows } = m.sheet;
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) return err(`${p}.sheet`, 'A sprite sheet has at least one frame across and one down');
    const count = m.sheet.count ?? columns * rows;
    if (count < 1 || count > columns * rows) err(`${p}.sheet.count`, `count is from 1 to ${columns * rows}`);
    const names = new Set<string>();
    (m.animations ?? []).forEach((a, ai) => {
      const ap = `${p}.animations[${ai}]`;
      if (!ANIMATION_NAME.test(String(a.name))) err(`${ap}.name`, 'An animation name is lowercase letters, digits and underscores, starting with a letter');
      else if (names.has(a.name)) err(`${ap}.name`, `Duplicate animation "${a.name}"`);
      names.add(a.name);
      if (!Array.isArray(a.frames) || a.frames.length === 0) err(`${ap}.frames`, 'An animation needs at least one frame');
      else if (a.frames.some((f) => !Number.isInteger(f) || f < 0 || f >= count)) err(`${ap}.frames`, `Frames are numbered 0 to ${count - 1}`);
    });
  });
  const glossaryIds = new Set<string>();
  (s.glossary ?? []).forEach((e, i) => {
    const p = `glossary[${i}]`;
    if (e.id == null || String(e.id) === '') err(`${p}.id`, 'A glossary entry needs an id');
    else if (glossaryIds.has(String(e.id))) err(`${p}.id`, `Duplicate glossary entry "${String(e.id)}"`);
    glossaryIds.add(String(e.id));
    if (typeof e.term !== 'string' || e.term.trim() === '') err(`${p}.term`, 'term is required');
    if (typeof e.definition !== 'string' || e.definition.trim() === '') err(`${p}.definition`, 'definition is required');
    if (e.media_id != null) needMedia(e.media_id, `${p}.media_id`, 'image');
  });
  const groupIds = new Set<Id>();
  (s.scene_groups ?? []).forEach((g, i) => {
    if (typeof g.id !== 'number' || groupIds.has(g.id)) err(`scene_groups[${i}].id`, 'A scene group needs an id of its own');
    groupIds.add(g.id);
    if (typeof g.name !== 'string' || g.name.trim() === '') err(`scene_groups[${i}].name`, 'name is required');
  });
  if (s.narration != null && s.narration !== 'off' && s.narration !== 'on') err('narration', 'narration is "off" or "on"');
  (s.moves ?? []).forEach((m, i) => {
    if (!ANIMATION_NAME.test(String(m.animation))) err(`moves[${i}].animation`, 'A move names an animation: lowercase letters, digits and underscores');
  });
  for (const [avatar, portrait] of Object.entries(s.avatar_portraits ?? {})) needMedia(portrait, `avatar_portraits.${avatar}`, 'image');

  if (s.start_scene_id == null) err('start_scene_id', 'No start scene is chosen');
  else if (!scenes.has(s.start_scene_id)) err('start_scene_id', `The start scene (${s.start_scene_id}) does not exist`);

  const abilities = new Set((s.shop_items ?? []).map((i) => i.ability).filter(Boolean) as string[]);
  const checkConditions = (conds: Condition[] | undefined, path: string) => {
    (conds ?? []).forEach((c, i) => {
      const p = `${path}.conditions[${i}]`;
      if (c.type && c.type !== 'variable') err(p, `Unsupported condition type "${c.type}"`);
      if (!CONDITION_OPS.includes(c.operator)) err(p, `Unknown operator "${c.operator}"`);
      if (!c.variable) err(p, 'variable is required');
      else if (isReserved(c.variable)) {
        // QBLAbility_<key> is 1 while the player has a marketplace ability with that key equipped.
        if (c.variable.startsWith(ABILITY_PREFIX)) {
          if (!abilities.has(c.variable.slice(ABILITY_PREFIX.length))) warn(p, `No item in this scenario's shop gives the ability "${c.variable.slice(ABILITY_PREFIX.length)}"; it must come from the platform's catalogue`);
        } else if (!(RESERVED_VARIABLES as readonly string[]).includes(c.variable)) warn(p, `Unknown reserved variable "${c.variable}"`);
      } else if (!variables.has(c.variable)) err(p, `Variable "${c.variable}" is not declared in global_variables`);
    });
  };

  const checkText = (text: string | undefined, path: string) => {
    for (const name of placeholderVariables(text ?? '')) {
      if (!variables.has(name) && !(RESERVED_VARIABLES as readonly string[]).includes(name)) {
        warn(path, `Placeholder {{${name}}} does not match a declared variable`);
      }
    }
  };

  (s.moves ?? []).forEach((m, i) => checkConditions(m.conditions, `moves[${i}]`));
  (s.objectives ?? []).forEach((o, i) => {
    const path = `objectives[${i}]`;
    if (!o.text) err(`${path}.text`, 'text is required');
    checkText(o.text, `${path}.text`);
    if (!Array.isArray(o.complete_when) || o.complete_when.length === 0) err(`${path}.complete_when`, 'An objective needs at least one condition that completes it');
    checkConditions(o.complete_when, `${path}(complete_when)`);
    checkConditions(o.show_when, `${path}(show_when)`);
  });

  // Ids must be unique across the scenario so cancel, translate and run_event are unambiguous.
  const eventIds: Array<[Id, string]> = [];
  const actionIds: Array<[Id, string]> = [];
  const eventScene = new Map<Id, Id>();
  const actionScene = new Map<Id, Id>();
  const eachEvent = (scene: Scene, si: number, fn: (e: GameEvent, path: string) => void) => {
    for (const key of ['start_events', 'end_events', 'hotspots', 'indirect_events'] as const) {
      (scene[key] ?? []).forEach((e, ei) => fn(e, `scenes[${si}].${key}[${ei}]`));
    }
  };
  s.scenes.forEach((scene, si) =>
    eachEvent(scene, si, (e, path) => {
      eventIds.push([e.id, path]);
      eventScene.set(e.id, scene.id);
      if (e.audience != null && e.audience !== 'player' && e.audience !== 'scene') err(`${path}.audience`, 'audience is "player" or "scene"');
      (e.actions ?? []).forEach((a, ai) => {
        actionIds.push([a.id, `${path}.actions[${ai}]`]);
        actionScene.set(a.id, scene.id);
      });
    }),
  );
  unique(eventIds, 'event');
  unique(actionIds, 'action');

  // Characters that roam can be in any scene; the others only where they are placed.
  const npcs = new Map<Id, Npc>((s.characters ?? []).map((c) => [c.id, c]));
  const canBeHere = (id: Id | undefined, scene: Scene) =>
    id != null && (characterRoams(npcs.get(id)) || (scene.characters ?? []).some((c) => c.character_id === id));
  let index: ScenarioIndex | null = null;
  const scenarioIndex = () => (index ??= new ScenarioIndex(s));

  /**
   * Where a walk goes. `from` is the scene the walker is in, when that is known (a roaming
   * character may be anywhere); `oneDoor` when it can only go through a door of that scene.
   */
  const checkWalk = (a: Pick<WalkAction, 'to' | 'position_x' | 'position_y' | 'spawn_point' | 'scene_id' | 'speed' | 'facing'>, path: string, from: Scene | null, oneDoor: boolean) => {
    const to = a.to ?? 'point';
    if (a.speed != null && !(typeof a.speed === 'number' && a.speed > 0)) err(`${path}.speed`, 'speed is a number of pixels per second greater than 0');
    if (a.facing != null && a.facing !== 'left' && a.facing !== 'right') err(`${path}.facing`, 'facing is "left" or "right"');
    if (to === 'point') {
      if (typeof a.position_x !== 'number' || typeof a.position_y !== 'number') err(path, 'position_x and position_y are required');
      // Beyond the left or right edge is off stage: a character walks off out of sight.
      else if (from?.width && from.height && a.position_x >= 0 && a.position_x <= from.width && !isWalkable(walkContext(from, { width: from.width, height: from.height }), a.position_x, a.position_y)) {
        warn(path, 'That spot is outside the walkable area: the walker stops at the nearest spot it can reach');
      }
    } else if (to === 'spawn') {
      if (!a.spawn_point) err(`${path}.spawn_point`, 'spawn_point is required');
      else if (from && !(from.spawn_points ?? []).some((p) => p.name === a.spawn_point)) err(`${path}.spawn_point`, `This scene has no spawn point "${a.spawn_point}"`);
    } else if (to === 'scene') {
      const target = s.scenes.find((x) => x.id === a.scene_id);
      if (!target) {
        err(`${path}.scene_id`, `Scene ${String(a.scene_id)} does not exist`);
        return;
      }
      if (a.spawn_point && !(target.spawn_points ?? []).some((p) => p.name === a.spawn_point)) err(`${path}.spawn_point`, `Scene ${target.id} has no spawn point "${a.spawn_point}"`);
      if (from && from.id !== target.id) {
        if (oneDoor) {
          if (!doorsOf(from).some((d) => d.to === target.id)) warn(`${path}.scene_id`, 'No hotspot in this scene jumps to that scene, so there is no door to walk through');
        } else if (!routeBetween(scenarioIndex(), from.id, target.id)) {
          warn(`${path}.scene_id`, 'No hotspots lead from this scene to that one, so there is no way to walk there');
        }
      }
    } else {
      err(`${path}.to`, 'to is "point", "spawn" or "scene"');
    }
  };

  /** A line recorded in a character's voice and changed since: the recording says the old words. */
  const checkRecording = (mediaId: Id | undefined, text: unknown, path: string) => {
    const said = mediaId != null ? media.get(mediaId)?.speech : undefined;
    if (said?.engine && said.line != null && typeof text === 'string' && said.line !== text) {
      warn(path, 'The line was changed after it was recorded, so the recording says something else. Record the voices again (Characters, “Record voices”)');
    }
  };
  /** `inCta`: the action is on an infobox button (`true`) or a conversation's choice (`'choice'`), not in an event. */
  /** A conversation: its lines, who says them, where its choices lead, and what they do. */
  const checkConversation = (a: ConversationAction, path: string, scene: Scene) => {
    if (a.style != null && a.style !== 'bubble' && a.style !== 'portrait') err(`${path}.style`, 'style is "bubble" or "portrait"');
    if (!Array.isArray(a.lines) || a.lines.length === 0) {
      err(`${path}.lines`, 'A conversation needs at least one line');
      return;
    }
    const ids = new Set<string>();
    a.lines.forEach((line, li) => {
      const lp = `${path}.lines[${li}]`;
      if (typeof line?.id !== 'string' || !LINE_ID.test(line.id)) err(`${lp}.id`, 'A line id is 1 to 32 letters, digits, - or _');
      else if (ids.has(line.id)) err(`${lp}.id`, `Two lines are called "${line.id}"`);
      else ids.add(line.id);
    });
    if (a.start != null && a.start !== '' && !ids.has(a.start)) err(`${path}.start`, `There is no line "${a.start}" to start with`);
    const lead = (to: string | null | undefined, at: string) => {
      if (to != null && to !== '' && !ids.has(to)) err(at, `There is no line "${to}" to go on to (it may have been deleted)`);
    };
    a.lines.forEach((line, li) => {
      const lp = `${path}.lines[${li}]`;
      if (typeof line.text !== 'string' || line.text.trim() === '') err(`${lp}.text`, 'What is said is required');
      else checkText(line.text, `${lp}.text`);
      if (line.speaker != null && line.speaker !== 'player' && line.speaker !== 'character') err(`${lp}.speaker`, 'speaker is "player" or "character"');
      if (line.speaker === 'character') {
        // A bubble needs someone to hang over; a story box can carry a voice from anywhere.
        if ((a.style ?? 'portrait') === 'portrait') {
          if (!characters.has(line.character_id as Id)) err(`${lp}.character_id`, 'The speaking character does not exist');
        } else if (!canBeHere(line.character_id, scene)) {
          err(`${lp}.character_id`, 'The speaking character is not placed in this scene');
        }
      }
      if (line.narration_media_id != null) needMedia(line.narration_media_id, `${lp}.narration_media_id`, 'audio');
      checkRecording(line.narration_media_id, line.text, `${lp}.narration_media_id`);
      checkConditions(line.conditions, lp);
      lead(line.next, `${lp}.next`);
      (line.choices ?? []).forEach((c, ci) => {
        const cp = `${lp}.choices[${ci}]`;
        if (typeof c?.text !== 'string' || c.text.trim() === '') err(`${cp}.text`, 'A choice needs something to say');
        else checkText(c.text, `${cp}.text`);
        checkConditions(c.conditions, cp);
        lead(c.next, `${cp}.next`);
        (c.actions ?? []).forEach((inner, ai) => checkAction(inner as Action, `${cp}.actions[${ai}]`, scene, 'choice'));
      });
      if ((line.choices ?? []).length && line.next) warn(`${lp}.next`, 'A line with choices goes where the chosen one leads; its “then” is only used when none of them is offered');
    });
    const reached = reachableLines(a);
    a.lines.forEach((line, li) => {
      if (typeof line.id === 'string' && ids.has(line.id) && !reached.has(line.id)) warn(`${path}.lines[${li}]`, `Line "${line.id}" is never said: no choice or line leads to it`);
    });
  };

  /** The settings weather (a scene's or a weather action's) shares. */
  const checkWeather = (w: { intensity?: number; wind?: number; lightning?: boolean }, path: string) => {
    if (w.intensity != null && !(typeof w.intensity === 'number' && w.intensity >= 0 && w.intensity <= 1)) err(`${path}.intensity`, 'intensity is from 0 to 1');
    if (w.wind != null && !(typeof w.wind === 'number' && w.wind >= -1 && w.wind <= 1)) err(`${path}.wind`, 'wind is from -1 (to the left) to 1 (to the right)');
    if (w.lightning != null && typeof w.lightning !== 'boolean') err(`${path}.lightning`, 'lightning is true or false');
  };

  const checkAction = (raw: Action, path: string, scene: Scene, inCta: boolean | 'choice' = false) => {
    const type = normalizeActionType(raw.type);
    if (!type) {
      err(`${path}.type`, `Unknown action type "${String(raw.type)}"`);
      return;
    }
    const a = { ...raw, type } as Action;
    checkConditions(a.conditions, path);
    const wanted = MEDIA_FOR_ACTION[type];
    // A sound the game makes itself needs no recording.
    const builtIn = type === 'audio' && (raw as { sound?: unknown }).sound != null;
    if (builtIn) {
      if (!isBuiltInSound((raw as { sound?: unknown }).sound)) err(`${path}.sound`, `"${String((raw as { sound?: unknown }).sound)}" is not one of the game's own sounds`);
      if (a.media_id != null) warn(`${path}.media_id`, 'The action plays the game\'s own sound, so its media is not played');
    } else if (wanted) {
      if (a.media_id == null) err(`${path}.media_id`, `${type} actions need a media_id`);
      else needMedia(a.media_id, `${path}.media_id`, wanted);
    }
    switch (a.type) {
      case 'jump':
        if (a.scene_id == null) err(`${path}.scene_id`, 'No scene is chosen to go to');
        else if (!scenes.has(a.scene_id)) err(`${path}.scene_id`, `Scene ${a.scene_id} does not exist (it may have been deleted)`);
        else if (a.spawn_point) {
          const target = s.scenes.find((x) => x.id === a.scene_id);
          if (!target?.spawn_points?.some((p) => p.name === a.spawn_point)) {
            err(`${path}.spawn_point`, `Scene ${a.scene_id} has no spawn point "${a.spawn_point}"`);
          }
        }
        break;
      case 'run_event': {
        const target = a.target_event_id ?? (inCta ? a.event_id : a.event_id);
        if (target == null) err(`${path}.target_event_id`, 'No event is chosen to run');
        else if (!eventScene.has(target)) err(`${path}.target_event_id`, `Event ${target} does not exist (it may have been deleted)`);
        else if (eventScene.get(target) !== scene.id) err(`${path}.target_event_id`, `Event ${target} belongs to another scene`);
        break;
      }
      case 'cancel':
        if (a.action_id == null) err(`${path}.action_id`, 'No action is chosen to stop');
        else if (!actionScene.has(a.action_id)) err(`${path}.action_id`, `Action ${a.action_id} does not exist (it may have been deleted)`);
        else if (actionScene.get(a.action_id) !== scene.id) warn(`${path}.action_id`, `Action ${a.action_id} is in another scene; only persistent audio can be cancelled across scenes`);
        break;
      case 'translate':
        if (a.target_id == null) err(`${path}.target_id`, 'No action is chosen to move, resize or fade');
        else if (!actionScene.has(a.target_id)) err(`${path}.target_id`, `Action ${a.target_id} does not exist (it may have been deleted)`);
        break;
      case 'variable':
        if (!VARIABLE_OPS.includes(a.operator)) err(`${path}.operator`, `Unknown operator "${a.operator}"`);
        if (isReserved(a.name ?? '')) warn(`${path}.name`, 'Reserved variables are maintained by the runtime; this action will be ignored');
        else if (!variables.has(a.name)) err(`${path}.name`, `Variable "${a.name}" is not declared in global_variables`);
        if (a.operator !== 'random' && a.operand === undefined) err(`${path}.operand`, 'operand is required');
        break;
      case 'award':
        if (typeof a.stars !== 'number' && typeof a.xp !== 'number') err(path, 'An award needs stars, XP or both');
        // Awards are checked by the backend against the events' actions, which a button's action is not part of.
        if (inCta === 'choice') warn(path, 'An award in a conversation choice is not given. Put it in an event and have the choice run that event');
        else if (inCta) warn(path, 'An award on a button is not given. Put it in an event and have the button run that event');
        if (a.badge != null && (typeof a.badge !== 'string' || a.badge.trim() === '')) err(`${path}.badge`, 'A badge needs a name');
        if (a.badge_media_id != null) needMedia(a.badge_media_id, `${path}.badge_media_id`, 'image');
        break;
      case 'glossary':
        if (a.entry_id == null || a.entry_id === '') err(`${path}.entry_id`, 'No glossary word is chosen');
        else if (!(s.glossary ?? []).some((e) => String(e.id) === String(a.entry_id))) err(`${path}.entry_id`, `The glossary has no entry "${String(a.entry_id)}"`);
        break;
      case 'dialogue':
        if (typeof a.text !== 'string' || a.text === '') err(`${path}.text`, 'text is required');
        else checkText(a.text, `${path}.text`);
        if (a.style != null && a.style !== 'bubble' && a.style !== 'portrait') err(`${path}.style`, 'style is "bubble" or "portrait"');
        checkRecording(a.narration_media_id, a.text, `${path}.narration_media_id`);
        // A bubble needs someone to hang over; a portrait box can carry a voice from anywhere (a call from the ship).
        if (a.speaker === 'character' && a.style === 'portrait') {
          if (!characters.has(a.character_id as Id)) err(`${path}.character_id`, 'The speaking character does not exist');
        } else if (a.speaker === 'character' && !canBeHere(a.character_id, scene)) {
          err(`${path}.character_id`, 'The speaking character is not placed in this scene');
        }
        break;
      case 'conversation':
        checkConversation(a, path, scene);
        break;
      case 'freeze':
        if (typeof a.frozen !== 'boolean') err(`${path}.frozen`, 'frozen must be true or false');
        break;
      case 'avatar':
        if (typeof a.visible !== 'boolean') err(`${path}.visible`, 'visible must be true or false');
        break;
      case 'animate': {
        if (typeof a.animation !== 'string' || (a.animation !== '' && !ANIMATION_NAME.test(a.animation))) {
          err(`${path}.animation`, 'animation is a name in lowercase letters, digits and underscores, or empty to stop');
          break;
        }
        const target = a.target ?? 'player';
        // What is being animated, so its sheet can be checked for the name.
        let picture: Media | undefined;
        if (target === 'item') {
          const item = (s.items ?? []).find((i) => i.id === a.item_id);
          if (!item) err(`${path}.item_id`, 'The item to animate does not exist');
          picture = item?.media_id != null ? media.get(item.media_id) : undefined;
        } else if (target === 'character') {
          if (!canBeHere(a.character_id, scene)) err(`${path}.character_id`, 'The character to animate is not placed in this scene');
          const found = (s.characters ?? []).find((c) => c.id === a.character_id);
          const character = found && normalizeNpc(found, (id) => media.get(id));
          // A character's own animations, besides the poses, are what it can be asked to play.
          if (a.animation !== '' && character && !BUILT_IN_MOVES[a.animation] && (isPose(a.animation) || !character.animations?.[a.animation])) {
            warn(`${path}.animation`, isPose(a.animation) ? `"${a.animation}" is a pose the character takes by itself, not one to play` : `The character has no animation called "${a.animation}", and that is not a built-in move`);
          }
        } else if (target === 'action') {
          if (a.target_id == null || actionScene.get(a.target_id) !== scene.id) err(`${path}.target_id`, 'The action to animate is not in this scene');
        } else if (target !== 'player') {
          err(`${path}.target`, 'target is "player", "item", "character" or "action"');
        }
        // Avatars differ from player to player, and an action's picture is its own business; those are not checked.
        if (target === 'item' && a.animation !== '' && !findAnimation(picture, a.animation) && !BUILT_IN_MOVES[a.animation]) {
          warn(`${path}.animation`, `Its picture has no animation called "${a.animation}", and that is not a built-in move`);
        }
        break;
      }
      case 'wait':
        if (typeof a.duration !== 'number') err(`${path}.duration`, 'duration is required');
        break;
      case 'walk': {
        const target = a.target ?? 'character';
        if (target !== 'character' && target !== 'player') {
          err(`${path}.target`, 'target is "character" or "player"');
          break;
        }
        const npc = target === 'character' ? npcs.get(a.character_id as Id) : undefined;
        if (target === 'character') {
          if (!npc) {
            err(`${path}.character_id`, 'The character to walk does not exist');
            break;
          }
          if (!canBeHere(npc.id, scene)) err(`${path}.character_id`, 'The character to walk is not placed in this scene. A character that walks between scenes must be set to walk around on its own');
        }
        // A roaming character may be anywhere when this runs, and can cross several rooms. Anyone
        // else walks in this scene, and can only go out through one of its doors.
        const roams = target === 'character' && characterRoams(npc);
        checkWalk(a, path, roams ? null : scene, !roams);
        break;
      }
      case 'text_overlay':
        if (typeof a.text !== 'string') err(`${path}.text`, 'text is required');
        else if (a.text.length > 256) warn(`${path}.text`, 'text is longer than 256 characters');
        checkText(a.text, `${path}.text`);
        break;
      case 'infobox': {
        if (typeof a.content !== 'string') err(`${path}.content`, 'content is required');
        checkText(a.content, `${path}.content`);
        const refs = infoboxRefs(a.content);
        for (const id of refs.media) if (!media.has(id)) warn(`${path}.content`, `The content shows media ${id}, which is not in the scenario's media (it may have been deleted)`);
        for (const name of refs.answers) {
          if (!variables.has(name)) err(`${path}.content`, `An answer box saves to the variable "${name}", which is not defined`);
        }
        for (const word of refs.words) {
          if (!glossaryIds.has(word)) warn(`${path}.content`, `The content has a glossary word (${word}) that is not in the glossary`);
        }
        for (const name of refs.controls) {
          if (!variables.has(name)) err(`${path}.content`, `A control (slider, switch or wheel) saves to the variable "${name}", which is not defined`);
        }
        for (const name of refs.reads) {
          if (!variables.has(name) && !refs.controls.includes(name) && !refs.answers.includes(name) && !isReserved(name)) warn(`${path}.content`, `The content shows or tests "${name}", which is neither a control in this box nor a variable`);
        }
        if (a.media_id != null) {
          needMedia(a.media_id, `${path}.media_id`);
          const top = media.get(a.media_id);
          if (top && top.type !== 'image' && top.type !== 'video') err(`${path}.media_id`, `The picture at the top is ${top.type}; it must be an image or a video`);
        }
        if (a.size != null && !(INFOBOX_SIZES as readonly string[]).includes(a.size)) warn(`${path}.size`, 'size is small, medium or large');
        if (a.dismissible === false && (a.call_to_actions ?? []).filter((c) => !c.conditions?.length && c.mark !== 'try_again').length === 0) {
          err(path, 'An infobox that cannot be dismissed needs at least one button that is always offered and is not "Try again"');
        }
        (a.call_to_actions ?? []).forEach((cta, ci) => {
          if (!cta.text) err(`${path}.call_to_actions[${ci}].text`, 'Button text is required');
          if (cta.mark != null && !(BUTTON_MARKS as readonly string[]).includes(cta.mark)) err(`${path}.call_to_actions[${ci}].mark`, 'mark is right, wrong or try_again');
          checkConditions(cta.conditions, `${path}.call_to_actions[${ci}]`);
          if (cta.action) checkAction(cta.action as Action, `${path}.call_to_actions[${ci}].action`, scene, true);
        });
        break;
      }
      case 'image_fixed':
        if (typeof a.position_x !== 'number' || typeof a.position_y !== 'number') err(path, 'position_x and position_y are required');
        break;
      case 'weather':
        if (a.kind !== 'clear' && !(WEATHER_KINDS as string[]).includes(a.kind)) err(`${path}.kind`, `kind is clear or one of ${WEATHER_KINDS.join(', ')}`);
        checkWeather(a, path);
        if (a.duration != null && !(typeof a.duration === 'number' && a.duration >= 0)) err(`${path}.duration`, 'duration is a number of milliseconds');
        break;
      case 'camera': {
        const target = a.target ?? (a.character_id != null ? 'character' : a.position_x != null ? 'point' : 'player');
        if (!['player', 'character', 'point', 'auto'].includes(target)) err(`${path}.target`, 'target is "player", "character", "point" or "auto"');
        if (target === 'character' && !canBeHere(a.character_id, scene)) err(`${path}.character_id`, 'The character to follow is not placed in this scene');
        if (target === 'point' && (typeof a.position_x !== 'number' || typeof a.position_y !== 'number')) err(path, 'position_x and position_y are required');
        if (target === 'auto' && !scene.story) warn(`${path}.target`, 'Following whoever is acting is for story scenes; elsewhere the view follows the player');
        if (a.duration != null && !(typeof a.duration === 'number' && a.duration >= 0)) err(`${path}.duration`, 'duration is a number of milliseconds');
        break;
      }
      case 'spritemap':
        if (!a.spritemap_tiles_horizontal || !a.spritemap_tiles_vertical) err(path, 'spritemap_tiles_horizontal and spritemap_tiles_vertical are required');
        break;
      default:
    }
  };

  s.scenes.forEach((scene, si) => {
    const sp = `scenes[${si}]`;
    for (const key of ['background_media', 'foreground_media'] as const) {
      (scene[key] ?? []).forEach((l, li) => needMedia(layerMediaId(l), `${sp}.${key}[${li}]`, 'image'));
    }
    if ((scene.background_media ?? []).length === 0 && !(scene.width && scene.height)) {
      err(sp, 'A scene needs a background image or an explicit width and height');
    }
    else if (!sceneSize(s, scene)) {
      warn(sp, 'Scene size is unknown: set width and height so the game server can check player movement');
    }
    for (const key of ['walkable_areas', 'blocked_areas'] as const) {
      (scene[key] ?? []).forEach((poly, pi) => {
        if (!Array.isArray(poly) || poly.length < 3) err(`${sp}.${key}[${pi}]`, 'A polygon needs at least three points');
      });
    }
    const names = new Set<string>();
    (scene.scale_areas ?? []).forEach((a, ai) => {
      const p = `${sp}.scale_areas[${ai}]`;
      if (!(a.width > 0) || !(a.height > 0)) err(p, 'A scale area needs a width and a height');
      for (const key of ['scale_top', 'scale_bottom'] as const) {
        if (typeof a[key] !== 'number' || a[key] <= 0) err(`${p}.${key}`, `${key} is a percentage greater than 0`);
        else if (a[key] > 400) warn(`${p}.${key}`, `${key} is ${a[key]}%, which is very large`);
      }
      if (a.speed_effect != null && (a.speed_effect < 0 || a.speed_effect > 100)) err(`${p}.speed_effect`, 'speed_effect is a percentage from 0 to 100');
    });
    (scene.shadow_spots ?? []).forEach((spot, i) => {
      const p = `${sp}.shadow_spots[${i}]`;
      if (typeof spot.x !== 'number' || typeof spot.y !== 'number') err(p, 'A shadow spot needs x and y');
      if (!(spot.radius > 0)) err(`${p}.radius`, 'radius is a number of pixels greater than 0');
      if (spot.radius_y != null && !(spot.radius_y > 0)) err(`${p}.radius_y`, 'radius_y is a number of pixels greater than 0');
      if (spot.strength != null && (spot.strength < 0 || spot.strength > 100)) err(`${p}.strength`, 'strength is a percentage from 0 to 100');
    });
    if (scene.sky) {
      const p = `${sp}.sky`;
      if (!SKY_TIMES.includes(scene.sky.time)) err(`${p}.time`, `time is one of ${SKY_TIMES.join(', ')}`);
      if (scene.sky.until != null && !SKY_TIMES.includes(scene.sky.until)) err(`${p}.until`, `until is one of ${SKY_TIMES.join(', ')}`);
      if (scene.sky.minutes != null && !(scene.sky.minutes > 0)) err(`${p}.minutes`, 'minutes is a number greater than 0');
      for (const key of ['horizon', 'sun_x'] as const) {
        const v = scene.sky[key];
        if (v != null && (typeof v !== 'number' || v < 0 || v > 1)) err(`${p}.${key}`, `${key} is a share from 0 to 1`);
      }
      if (scene.sky.shade != null && (scene.sky.shade < 0 || scene.sky.shade > 100)) err(`${p}.shade`, 'shade is a percentage from 0 to 100');
    }
    const COLOR = /^#[0-9a-fA-F]{6}$/;
    (scene.lights ?? []).forEach((light, i) => {
      const p = `${sp}.lights[${i}]`;
      if (typeof light.x !== 'number' || typeof light.y !== 'number') err(p, 'A light needs x and y');
      if (light.radius != null && !(light.radius > 0)) err(`${p}.radius`, 'radius is a number of pixels greater than 0');
      if (light.color != null && !COLOR.test(light.color)) err(`${p}.color`, 'color is #rrggbb');
      if (light.kind != null && !['flicker', 'fire', 'glow', 'blink', 'twinkle'].includes(light.kind)) err(`${p}.kind`, 'kind is flicker, fire, glow, blink or twinkle');
      if (light.strength != null && (light.strength < 0 || light.strength > 100)) err(`${p}.strength`, 'strength is a percentage from 0 to 100');
      if (light.period != null && !(light.period > 0)) err(`${p}.period`, 'period is a number of seconds greater than 0');
    });
    (scene.atmosphere ?? []).forEach((a, i) => {
      const p = `${sp}.atmosphere[${i}]`;
      if (!['fireflies', 'leaves', 'snow', 'rain', 'dust', 'bubbles'].includes(a.kind)) err(`${p}.kind`, 'kind is fireflies, leaves, snow, rain, dust or bubbles');
      if (a.amount != null && !['few', 'some', 'many'].includes(a.amount)) err(`${p}.amount`, 'amount is few, some or many');
      if (a.color != null && !COLOR.test(a.color)) err(`${p}.color`, 'color is #rrggbb');
    });
    if (scene.weather) {
      const p = `${sp}.weather`;
      if (!(WEATHER_KINDS as string[]).includes(scene.weather.kind)) err(`${p}.kind`, `kind is one of ${WEATHER_KINDS.join(', ')}`);
      checkWeather(scene.weather, p);
      if (scene.weather.darken != null && !(scene.weather.darken >= 0 && scene.weather.darken <= 100)) err(`${p}.darken`, 'darken is a percentage from 0 to 100');
    }
    (scene.flows ?? []).forEach((f, i) => {
      const p = `${sp}.flows[${i}]`;
      if (typeof f.x !== 'number' || typeof f.y !== 'number' || !(f.width > 0) || !(f.height > 0)) err(p, 'Flowing water needs x, y, a width and a height');
      if (f.kind != null && !(FLOW_KINDS as readonly string[]).includes(f.kind)) err(`${p}.kind`, `kind is one of ${FLOW_KINDS.join(', ')}`);
      if (f.direction != null && !['left', 'right', 'down', 'up'].includes(f.direction)) err(`${p}.direction`, 'direction is left, right, down or up');
      if (f.speed != null && !(typeof f.speed === 'number' && f.speed >= 0)) err(`${p}.speed`, 'speed is a number of pixels per second');
      if (f.color != null && !COLOR.test(f.color)) err(`${p}.color`, 'color is #rrggbb');
      if (f.layer != null && f.layer !== 'behind' && f.layer !== 'over') err(`${p}.layer`, 'layer is "behind" or "over"');
      if ((f.layer ?? 'behind') === 'behind' && (scene.background_media ?? []).length === 0) warn(p, 'The water is drawn behind the scene\'s picture, but the scene has none');
    });
    if (scene.story) {
      if (!(scene.start_events ?? []).some((e) => (e.actions ?? []).length > 0)) warn(sp, 'A story scene plays its start events, and this one has none: nothing will happen');
      if ((scene.hotspots ?? []).some((h) => !h.activate_by_trigger && h.position_x != null)) warn(`${sp}.hotspots`, 'In a story scene the player does not walk, so a hotspot that is walked into never fires');
    }
    if (scene.group_id != null && s.scene_groups && !s.scene_groups.some((g) => g.id === scene.group_id)) {
      warn(`${sp}.group_id`, `Scene group ${scene.group_id} does not exist`);
    }
    (scene.hotspots ?? []).forEach((h, hi) => {
      (h.labels ?? []).forEach((label, li) => {
        const lp = `${sp}.hotspots[${hi}].labels[${li}]`;
        if (label.placement != null && !['background', 'object', 'front'].includes(label.placement)) err(`${lp}.placement`, 'placement is "background", "object" or "front"');
        if (label.solid && label.type === 'text') warn(`${lp}.solid`, 'Only picture labels can be solid');
      });
    });
    (scene.hotspots ?? []).forEach((h, hi) => {
      if (h.reveal_radius == null) return;
      const p = `${sp}.hotspots[${hi}]`;
      if (h.position_x == null && h.position_y == null) warn(p, 'reveal_radius has no effect on a hotspot without a position');
      if (h.reveal_full_radius != null && h.reveal_full_radius > h.reveal_radius) warn(`${p}.reveal_full_radius`, 'reveal_full_radius is larger than reveal_radius');
    });
    (scene.spawn_points ?? []).forEach((p, pi) => {
      if (names.has(p.name)) err(`${sp}.spawn_points[${pi}]`, `Duplicate spawn point "${p.name}"`);
      names.add(p.name);
      if (scene.width && scene.height) {
        const ctx = walkContext(scene, { width: scene.width, height: scene.height });
        if (!isWalkable(ctx, p.position_x, p.position_y)) warn(`${sp}.spawn_points[${pi}]`, `Spawn point "${p.name}" is outside the walkable area`);
      }
    });
    // A walk-in hotspot that jumps (a scene edge) must not cover a spawn point, or arriving players leave again at once.
    for (const h of scene.hotspots ?? []) {
      if (h.activate_by_trigger || !(h.actions ?? []).some((a) => normalizeActionType(a.type) === 'jump')) continue;
      for (const p of scene.spawn_points ?? []) {
        if (inHotspot(h, p.position_x, p.position_y)) {
          err(`${sp}.spawn_points[${(scene.spawn_points ?? []).indexOf(p)}]`, `Spawn point "${p.name}" is inside walk-in hotspot ${h.id}, which jumps to another scene`);
        }
      }
    }
    if ((scene.spawn_points ?? []).length === 0) warn(sp, 'No spawn points; players will appear at the centre of the scene');
    (scene.items ?? []).forEach((p, pi) => {
      if (p.item_id == null) err(`${sp}.items[${pi}].item_id`, 'No item is chosen');
      else if (!items.has(p.item_id)) err(`${sp}.items[${pi}].item_id`, `Item ${p.item_id} does not exist (it may have been deleted)`);
    });
    (scene.characters ?? []).forEach((p, pi) => {
      if (p.character_id == null) err(`${sp}.characters[${pi}].character_id`, 'No character is chosen');
      else if (!characters.has(p.character_id)) err(`${sp}.characters[${pi}].character_id`, `Character ${p.character_id} does not exist (it may have been deleted)`);
      if (p.event_id != null && eventScene.get(p.event_id) !== scene.id) err(`${sp}.characters[${pi}].event_id`, `Event ${p.event_id} is not in this scene`);
    });
    (scene.hotspots ?? []).forEach((h, hi) => {
      (h.labels ?? []).forEach((label, li) => {
        const p = `${sp}.hotspots[${hi}].labels[${li}]`;
        if (!['text', 'image', 'spritemap'].includes(label.type)) err(`${p}.type`, `Unknown label type "${label.type}"`);
        if (label.type === 'text' && !label.text) err(p, 'Text labels need text');
        if (label.type !== 'text') {
          const id = labelMediaId(label);
          if (id == null) err(p, `${label.type} labels need media`);
          else needMedia(id, `${p}.media`, 'image');
        }
      });
    });
    eachEvent(scene, si, (e, path) => {
      checkConditions(e.conditions, path);
      if (!Array.isArray(e.actions)) {
        err(`${path}.actions`, 'actions must be an array');
        return;
      }
      e.actions.forEach((a, ai) => checkAction(a, `${path}.actions[${ai}]`, scene));
    });
  });

  // The bag: things players carry, and what two of them make together.
  (s.items ?? []).forEach((it, i) => {
    if (it.carried_when != null) {
      if (!Array.isArray(it.carried_when)) err(`items[${i}].carried_when`, 'carried_when is a list of conditions');
      else checkConditions(it.carried_when, `items[${i}](carried_when)`);
    }
  });
  const carried = new Set((s.items ?? []).filter((it) => Array.isArray(it.carried_when) && it.carried_when.length > 0).map((it) => it.id));
  /** What can be done anywhere, in whatever scene the player puts two things together. */
  const ANYWHERE = ['variable', 'text_overlay', 'audio', 'glossary', 'infobox', 'wait', 'dialogue'];
  (s.combinations ?? []).forEach((c, i) => {
    const path = `combinations[${i}]`;
    if (!Array.isArray(c.items) || c.items.length !== 2) return err(`${path}.items`, 'A combination puts two items together');
    c.items.forEach((id, k) => {
      if (!items.has(id)) err(`${path}.items[${k}]`, `Item ${id} does not exist (it may have been deleted)`);
      else if (!carried.has(id)) warn(`${path}.items[${k}]`, `Item ${id} is never carried (it has no carried_when), so it can never be put with anything`);
    });
    if (String(c.items[0]) === String(c.items[1])) err(`${path}.items`, 'A combination puts two different items together');
    checkConditions(c.conditions, path);
    if (!Array.isArray(c.actions) || c.actions.length === 0) return err(`${path}.actions`, 'A combination needs actions: what putting the two together does');
    c.actions.forEach((a, ai) => {
      const ap = `${path}.actions[${ai}]`;
      const type = normalizeActionType(a.type);
      if (!type || !ANYWHERE.includes(type)) return err(`${ap}.type`, `A combination can do what works in any scene: ${ANYWHERE.join(', ')}`);
      checkConditions(a.conditions, ap);
      if (type === 'variable') {
        const v = a as { name?: string; operator?: string };
        if (!v.name || !variables.has(v.name)) err(`${ap}.name`, `Variable "${v.name ?? ''}" is not declared in global_variables`);
        if (!VARIABLE_OPS.includes(v.operator as never)) err(`${ap}.operator`, `Unknown operator "${v.operator ?? ''}"`);
      } else if (type === 'dialogue' && (a as { speaker?: string }).speaker === 'character') {
        err(`${ap}.speaker`, 'Only the player speaks in a combination: no character is sure to be there');
      }
      if (type === 'text_overlay' || type === 'dialogue') checkText((a as { text?: string }).text, `${ap}.text`);
    });
  });

  // Routines: what roaming characters do on their own, run by the game server for everyone.
  const roomVariables = new Set((s.global_variables ?? []).filter((v) => v.scope === 'room').map((v) => v.variable_name));
  const sharedOnly = (conds: Condition[] | undefined, path: string) => {
    checkConditions(conds, path);
    (conds ?? []).forEach((c, ci) => {
      if (c.variable && variables.has(c.variable) && !roomVariables.has(c.variable)) {
        warn(`${path}.conditions[${ci}]`, `"${c.variable}" is each player's own; a character walking for everyone only follows shared (room) variables, so this condition is left out`);
      }
    });
  };
  (s.characters ?? []).forEach((c, i) => {
    const path = `characters[${i}]`;
    if (c.routine != null) {
      const steps = (c.routine as { steps?: unknown }).steps;
      if (typeof c.routine !== 'object' || !Array.isArray(steps)) return err(`${path}.routine`, 'A routine has a list of steps');
      sharedOnly(c.routine.conditions, `${path}.routine`);
      (steps as RoutineStep[]).forEach((step, si) => {
        const sp = `${path}.routine.steps[${si}]`;
        if (!step || !(ROUTINE_STEP_TYPES as string[]).includes(step.type)) return err(`${sp}.type`, `A routine step is one of: ${ROUTINE_STEP_TYPES.join(', ')}`);
        sharedOnly(step.conditions, sp);
        switch (step.type) {
          case 'walk':
            checkWalk(step, sp, null, false);
            break;
          case 'wait':
            if (!(typeof step.duration === 'number' && step.duration >= 0)) err(`${sp}.duration`, 'duration is a number of milliseconds');
            break;
          case 'dialogue':
            if (typeof step.text !== 'string' || step.text === '') err(`${sp}.text`, 'text is required');
            else checkText(step.text, `${sp}.text`);
            break;
          case 'animate':
            if (typeof step.animation !== 'string' || (step.animation !== '' && !ANIMATION_NAME.test(step.animation))) err(`${sp}.animation`, 'animation is a name in lowercase letters, digits and underscores, or empty to stop');
            break;
          case 'variable':
            if (!VARIABLE_OPS.includes(step.operator)) err(`${sp}.operator`, `Unknown operator "${step.operator}"`);
            if (!variables.has(step.name)) err(`${sp}.name`, `Variable "${step.name}" is not declared in global_variables`);
            else if (!roomVariables.has(step.name)) err(`${sp}.name`, `"${step.name}" is each player's own: a routine can only change shared (room) variables`);
            break;
          default:
        }
      });
    }
    if (characterRoams({ roams: c.roams, routine: normalizeRoutine(c.routine) }) && !startPlacement(s, c.id)) {
      warn(path, 'The character walks around on its own but is not placed in any scene, so it has nowhere to start');
    }
  });

  return done();
}
