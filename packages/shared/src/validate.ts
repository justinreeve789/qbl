import { inHotspot, isWalkable, walkContext } from './geometry.js';
import { labelMediaId, layerMediaId, normalizeActionType, sceneSize } from './scenario.js';
import { ANIMATION_NAME, BUILT_IN_MOVES, findAnimation } from './types.js';
import type { Action, Condition, GameEvent, Id, Media, Scenario, Scene } from './types.js';
import { placeholderVariables } from './text.js';
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
    if (!m) err(path, `Media ${id} is not in assets`);
    else if (type && m.type !== type) err(path, `Media ${id} is ${m.type}, expected ${type}`);
  };

  (s.items ?? []).forEach((it, i) => needMedia(it.media_id, `items[${i}].media_id`, 'image'));
  (s.characters ?? []).forEach((c, i) => needMedia(c.media_id, `characters[${i}].media_id`, 'image'));
  (s.characters ?? []).forEach((c, i) => needMedia(c.portrait_media_id, `characters[${i}].portrait_media_id`, 'image'));
  (s.avatar_media_ids ?? []).forEach((id, i) => needMedia(id, `avatar_media_ids[${i}]`, 'image'));
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

  if (!scenes.has(s.start_scene_id)) err('start_scene_id', `Scene ${s.start_scene_id} does not exist`);

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

  const checkAction = (raw: Action, path: string, scene: Scene, inCta = false) => {
    const type = normalizeActionType(raw.type);
    if (!type) {
      err(`${path}.type`, `Unknown action type "${String(raw.type)}"`);
      return;
    }
    const a = { ...raw, type } as Action;
    checkConditions(a.conditions, path);
    const wanted = MEDIA_FOR_ACTION[type];
    if (wanted) {
      if (a.media_id == null) err(`${path}.media_id`, `${type} actions need a media_id`);
      else needMedia(a.media_id, `${path}.media_id`, wanted);
    }
    switch (a.type) {
      case 'jump':
        if (!scenes.has(a.scene_id)) err(`${path}.scene_id`, `Scene ${a.scene_id} does not exist`);
        else if (a.spawn_point) {
          const target = s.scenes.find((x) => x.id === a.scene_id);
          if (!target?.spawn_points?.some((p) => p.name === a.spawn_point)) {
            err(`${path}.spawn_point`, `Scene ${a.scene_id} has no spawn point "${a.spawn_point}"`);
          }
        }
        break;
      case 'run_event': {
        const target = a.target_event_id ?? (inCta ? a.event_id : a.event_id);
        if (target == null) err(path, 'run_event needs target_event_id (or event_id)');
        else if (!eventScene.has(target)) err(path, `Event ${target} does not exist`);
        else if (eventScene.get(target) !== scene.id) err(path, `Event ${target} belongs to another scene`);
        break;
      }
      case 'cancel':
        if (!actionScene.has(a.action_id)) err(`${path}.action_id`, `Action ${a.action_id} does not exist`);
        else if (actionScene.get(a.action_id) !== scene.id) warn(`${path}.action_id`, `Action ${a.action_id} is in another scene; only persistent audio can be cancelled across scenes`);
        break;
      case 'translate':
        if (!actionScene.has(a.target_id)) err(`${path}.target_id`, `Action ${a.target_id} does not exist`);
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
        if (inCta) warn(path, 'An award on a button is not given. Put it in an event and have the button run that event');
        if (a.badge != null && (typeof a.badge !== 'string' || a.badge.trim() === '')) err(`${path}.badge`, 'A badge needs a name');
        if (a.badge_media_id != null) needMedia(a.badge_media_id, `${path}.badge_media_id`, 'image');
        break;
      case 'glossary':
        if (!(s.glossary ?? []).some((e) => String(e.id) === String(a.entry_id))) err(`${path}.entry_id`, `The glossary has no entry "${String(a.entry_id)}"`);
        break;
      case 'dialogue':
        if (typeof a.text !== 'string' || a.text === '') err(`${path}.text`, 'text is required');
        else checkText(a.text, `${path}.text`);
        if (a.style != null && a.style !== 'bubble' && a.style !== 'portrait') err(`${path}.style`, 'style is "bubble" or "portrait"');
        // A bubble needs someone to hang over; a portrait box can carry a voice from anywhere (a call from the ship).
        if (a.speaker === 'character' && a.style === 'portrait') {
          if (!characters.has(a.character_id as Id)) err(`${path}.character_id`, 'The speaking character does not exist');
        } else if (a.speaker === 'character' && !(scene.characters ?? []).some((c) => c.character_id === a.character_id)) {
          err(`${path}.character_id`, 'The speaking character is not placed in this scene');
        }
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
          if (!(scene.characters ?? []).some((c) => c.character_id === a.character_id)) err(`${path}.character_id`, 'The character to animate is not placed in this scene');
          const character = (s.characters ?? []).find((c) => c.id === a.character_id);
          picture = character?.media_id != null ? media.get(character.media_id) : undefined;
        } else if (target === 'action') {
          if (a.target_id == null || actionScene.get(a.target_id) !== scene.id) err(`${path}.target_id`, 'The action to animate is not in this scene');
        } else if (target !== 'player') {
          err(`${path}.target`, 'target is "player", "item", "character" or "action"');
        }
        // Avatars differ from player to player, and an action's picture is its own business; those are not checked.
        if ((target === 'item' || target === 'character') && a.animation !== '' && !findAnimation(picture, a.animation) && !BUILT_IN_MOVES[a.animation]) {
          warn(`${path}.animation`, `Its picture has no animation called "${a.animation}", and that is not a built-in move`);
        }
        break;
      }
      case 'wait':
        if (typeof a.duration !== 'number') err(`${path}.duration`, 'duration is required');
        break;
      case 'text_overlay':
        if (typeof a.text !== 'string') err(`${path}.text`, 'text is required');
        else if (a.text.length > 256) warn(`${path}.text`, 'text is longer than 256 characters');
        checkText(a.text, `${path}.text`);
        break;
      case 'infobox':
        if (typeof a.content !== 'string') err(`${path}.content`, 'content is required');
        checkText(a.content, `${path}.content`);
        if (a.dismissible === false && (a.call_to_actions ?? []).filter((c) => !c.conditions?.length).length === 0) {
          err(path, 'An infobox that cannot be dismissed needs at least one button that is always offered');
        }
        (a.call_to_actions ?? []).forEach((cta, ci) => {
          if (!cta.text) err(`${path}.call_to_actions[${ci}].text`, 'Button text is required');
          checkConditions(cta.conditions, `${path}.call_to_actions[${ci}]`);
          if (cta.action) checkAction(cta.action as Action, `${path}.call_to_actions[${ci}].action`, scene, true);
        });
        break;
      case 'image_fixed':
        if (typeof a.position_x !== 'number' || typeof a.position_y !== 'number') err(path, 'position_x and position_y are required');
        break;
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
    if (scene.group_id != null && s.scene_groups && !s.scene_groups.some((g) => g.id === scene.group_id)) {
      warn(`${sp}.group_id`, `Scene group ${scene.group_id} does not exist`);
    }
    (scene.hotspots ?? []).forEach((h, hi) => {
      (h.labels ?? []).forEach((label, li) => {
        const lp = `${sp}.hotspots[${hi}].labels[${li}]`;
        if (label.placement != null && !['background', 'object', 'front'].includes(label.placement)) err(`${lp}.placement`, 'placement is "background", "object" or "front"');
        if (label.solid && label.type === 'text') warn(`${lp}.solid`, 'Only picture labels can be solid');
        if (label.solid && label.placement != null && label.placement !== 'object') warn(`${lp}.solid`, 'A solid label is an object: its placement is ignored');
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
          err(`${sp}.spawn_points`, `Spawn point "${p.name}" is inside walk-in hotspot ${h.id}, which jumps to another scene`);
        }
      }
    }
    if ((scene.spawn_points ?? []).length === 0) warn(sp, 'No spawn points; players will appear at the centre of the scene');
    (scene.items ?? []).forEach((p, pi) => {
      if (!items.has(p.item_id)) err(`${sp}.items[${pi}].item_id`, `Item ${p.item_id} does not exist`);
    });
    (scene.characters ?? []).forEach((p, pi) => {
      if (!characters.has(p.character_id)) err(`${sp}.characters[${pi}].character_id`, `Character ${p.character_id} does not exist`);
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

  return done();
}
