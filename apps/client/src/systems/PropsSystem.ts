import * as Phaser from 'phaser';
import {
  blockingRadius, characterRoams, doorPoint, doorsOf, nearestWalkable, parseIds, Pathfinder, scaleAt, shadeAt, shadeTint, speedFactorAt,
  stepToward, takesItems, testConditions, walkSignature, walkSpeed,
  type ActionHandle, type Circle, type DialogueAction, type Door, type Id, type Item, type Npc, type NpcRec, type Point, type WalkAction,
} from '@qbl/shared';
import { deferred } from '../actions/Presenter';
import { mediaKey } from '../core/assets';
import { Depth } from '../core/depth';
import { Figure } from '../entities/Figure';
import { NpcFigure } from '../entities/NpcFigure';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { LocalPlayerSystem } from './LocalPlayerSystem';

/** How long a character takes to fade out through a door, or in on arriving. */
const DOOR_FADE_MS = 300;
/** How long to wait for the game server to take up a walk before giving up on it. */
const WALK_ANSWER_MS = 3000;

/** A character in this scene. */
interface PlacedCharacter {
  figure: NpcFigure;
  /** It walks around on its own: the room says where it is. */
  roams: boolean;
  /** The event clicking it runs here, if any. */
  eventId?: Id;
  /** A walk on this screen (a character that does not roam). */
  walk: LocalWalk | null;
  /** The room's animation and routine-line tokens last acted on. */
  anim: string;
  line: string;
  lineHandle: ActionHandle | null;
  /** Fading out: it went through a door, or left the scene. */
  leaving: boolean;
}

interface LocalWalk {
  path: Point[];
  speed: number;
  facing?: 'left' | 'right';
  /** Walking out through this door. */
  door: Door | null;
  finish(): void;
}

interface PlacedItem {
  item: Item;
  figure: Figure;
  image: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
  /** The size it is drawn at where it lies, and the y of its feet, before a move bends or lifts it. */
  size: number;
  feet: number;
  /** Where the scenario placed it. Unique items move; see update(). */
  home: { x: number; y: number };
  exists: boolean;
}

/**
 * Items and characters (NPCs) placed in the scene.
 *
 * Non-unique items are per-player: you see your own copy, and it disappears
 * from the floor while you are using it. Unique items exist once per room;
 * their position and holder come from the synchronized state.
 */
export class PropsSystem implements SceneSystem {
  private items = new Map<Id, PlacedItem>();
  private objects: Phaser.GameObjects.GameObject[] = [];
  private pointerOver = 0;

  private characters = new Map<Id, PlacedCharacter>();
  private finder: { signature: string; pathfinder: Pathfinder } | null = null;
  /** The first frame has been drawn: characters arriving after it fade in. */
  private drawn = false;
  /** Characters placed here (not roaming) that are away while their conditions fail: they come back when they hold. */
  private away = new Set<Id>();

  constructor(private rt: SceneRuntime) {}

  /**
   * Characters on the stage now: in this scene and not off it beyond an edge (waiting to come on, or
   * gone), for a view that follows whoever is acting.
   */
  onStage(): Array<{ id: Id; x: number; y: number; height: number }> {
    const out: Array<{ id: Id; x: number; y: number; height: number }> = [];
    const w = this.rt.size.width;
    for (const [id, c] of this.characters) {
      if (c.leaving) continue;
      const f = c.figure.feet;
      if (f.x >= 0 && f.x <= w) out.push({ id, x: f.x, y: f.y, height: c.figure.sprite.displayHeight });
    }
    return out;
  }

  /** Where a character in this scene stands (feet) and how tall it is drawn, for speech bubbles. */
  characterAt(characterId: Id): { x: number; y: number; height: number; name: string } | null {
    const c = this.characters.get(characterId);
    if (!c || c.leaving) return null;
    const f = c.figure;
    return { x: f.feet.x, y: f.feet.y, height: f.sprite.displayHeight, name: f.name };
  }

  create() {
    const { ctx, def } = this.rt;
    for (const placement of def.items ?? []) {
      const item = ctx.index.items.get(placement.item_id);
      if (item) this.place(item, placement.position_x, placement.position_y, true);
    }
    // Unique items that were left in this scene but are placed in another one.
    ctx.connection.state.items.forEach((rec) => {
      const item = ctx.index.items.get(rec.item_id);
      if (item) this.place(item, rec.x, rec.y, false);
    });
    // Characters that roam are drawn where the room says they are (see syncRoaming).
    for (const placement of def.characters ?? []) {
      const npc = ctx.index.characters.get(placement.character_id);
      if (npc && !characterRoams(npc) && !this.characters.has(npc.id)) {
        if (!testConditions(npc.conditions, ctx.vars.get)) this.away.add(npc.id);
        this.character(npc, { x: placement.position_x, y: placement.position_y, facing: placement.facing }, placement.event_id, false);
      }
    }
    this.variablesChanged();
    this.update();
  }

  private place(item: Item, x: number, y: number, visible: boolean) {
    const { scene, zoom, def } = this.rt;
    if (this.items.has(item.id) || item.media_id == null || !scene.textures.exists(mediaKey(item.media_id))) return;
    // A Figure, so that a sheet's idle plays where the item lies and an animate action can reach it.
    const figure = new Figure(scene, this.rt.ctx.index.media.get(item.media_id), mediaKey(item.media_id), x, y);
    const size = (item.scale ?? 1) * zoom * scaleAt(def, x, y);
    const image = figure.object.setOrigin(0.5, 1).setScale(size).setDepth(this.depthOf(item, y)).setVisible(visible);
    image.setTint(shadeTint(shadeAt(def, x, y)));
    image.setFlipX(figure.auto(false, item.art_faces ?? 'right', item.art_faces ?? 'right'));
    if (item.vehicle || item.wearable) {
      this.interactive(image, () => this.rt.system(LocalPlayerSystem).useItem(item, { x: image.x, y: image.y }));
    }
    this.items.set(item.id, { item, figure, image, size, feet: y, home: { x, y }, exists: true });
  }

  /** An item lying on the floor as part of the background is under everyone's feet; otherwise it stands among the players. */
  private depthOf(item: Item, y: number): number {
    return item.placement === 'background' ? Depth.floor + 30 : y;
  }

  /** True while the pointer is over something clickable; a click is then left to that object. */
  get hovering(): boolean {
    return this.pointerOver > 0;
  }

  private interactive(object: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite, onClick: () => void) {
    object.setInteractive({ useHandCursor: true });
    object.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.pointerOver++);
    object.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => (this.pointerOver = Math.max(0, this.pointerOver - 1)));
    object.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onClick);
  }

  private character(npc: Npc, at: { x: number; y: number; facing?: string }, eventId: Id | undefined, roams: boolean): PlacedCharacter | null {
    const { ctx, scene, zoom, engine, def } = this.rt;
    // A character with no picture loaded is not drawn: there is nothing to see or click.
    if (!Object.values(npc.animations ?? {}).some((a) => scene.textures.exists(mediaKey(a.media_id)))) return null;
    if (!testConditions(npc.conditions, ctx.vars.get)) return null;
    // Its size and shade where it stands, as a player's would be there.
    const figure = new NpcFigure(scene, (id) => ctx.index.media.get(id), npc, at, {
      size: (x, y) => (npc.scale ?? 1) * zoom * scaleAt(def, x, y),
      shade: (x, y) => shadeAt(def, x, y),
    });
    const placed: PlacedCharacter = { figure, roams, eventId, walk: null, anim: '', line: '', lineHandle: null, leaving: false };
    this.characters.set(npc.id, placed);
    if (eventId != null) {
      this.interactive(figure.sprite, () => {
        if (ctx.ui.capturesInput || this.rt.leaving || placed.leaving) return;
        // With a thing picked in the bag: given to the character, if their event takes things.
        if (ctx.bag.selected != null) {
          const event = ctx.index.events.get(eventId)?.event;
          if (!event || !takesItems(event, (id) => ctx.index.events.get(id)?.event)) {
            ctx.bag.refuse(`${npc.name} does not need that.`);
            return;
          }
          ctx.bag.spend(engine.triggerById(eventId));
          return;
        }
        void engine.triggerById(eventId);
      });
    }
    return placed;
  }

  // ------------------------------------------------------------- walking

  /**
   * A walk action for a character. One that roams is walked by the game server, for everyone:
   * the handle finishes when it gets there. Any other walks here, on this player's screen.
   * `actor`: the walk is another player's, shown here because their event is for the whole scene.
   */
  walkCharacter(action: WalkAction, actor?: string): ActionHandle | null {
    const { ctx } = this.rt;
    const npc = action.character_id != null ? ctx.index.characters.get(action.character_id) : undefined;
    if (!npc) return null;
    if (characterRoams(npc)) return actor && actor !== ctx.connection.sessionId ? null : this.sendWalking(npc, action);
    const c = this.characters.get(npc.id);
    if (!c || c.leaving) return null;
    const from = { ...c.figure.feet };
    const walk = this.rt.walk();
    let goal: Point | null = null;
    let door: Door | null = null;
    let facing = action.facing;
    const to = action.to ?? 'point';
    // Beyond the left or right edge is off stage: a walk there goes to the edge and on out of sight,
    // and one from there comes in from the edge.
    const width = this.rt.size.width;
    const off = (p: Point) => p.x < 0 || p.x > width;
    const edge = (p: Point) => nearestWalkable(walk, { x: Math.max(2, Math.min(width - 2, p.x)), y: p.y }, 300, 10);
    let beyond: Point | null = null;
    if (to === 'point' && action.position_x != null && action.position_y != null) {
      const spot = { x: action.position_x, y: action.position_y };
      if (off(spot)) {
        beyond = spot;
        goal = edge(spot);
      } else {
        goal = nearestWalkable(walk, spot, 300, 10);
      }
    } else if (to === 'spawn') {
      const spawn = (this.rt.def.spawn_points ?? []).find((p) => p.name === action.spawn_point);
      if (spawn) goal = nearestWalkable(walk, { x: spawn.position_x, y: spawn.position_y }, 300, 10);
      facing ??= spawn?.facing;
    } else if (to === 'scene') {
      // It can only leave through a door of this scene, and is gone from it once through.
      door = doorsOf(this.rt.def).find((d) => d.to === action.scene_id && testConditions(d.conditions, ctx.vars.get)) ?? null;
      if (door) goal = doorPoint(walk, door.hotspot, from);
    }
    if (!goal) {
      console.warn(`[qbl] walk ${action.id}: nowhere to walk to`);
      return null;
    }
    c.walk?.finish();
    const d = deferred();
    // Coming on from off stage: straight in to the edge first.
    const entry = off(from) ? edge(from) : null;
    const start = entry ?? from;
    const path = [...(entry ? [{ x: entry.x, y: from.y }, entry] : []), ...(this.pathfinder(walk).find(start, goal) ?? [goal])];
    if (beyond) path.push({ x: beyond.x, y: path[path.length - 1]?.y ?? beyond.y });
    const local: LocalWalk = {
      path, speed: walkSpeed(ctx.scenario, npc, action), facing, door,
      finish: () => {
        if (c.walk === local) c.walk = null;
        c.figure.setMoving(false);
        d.resolve();
      },
    };
    c.walk = local;
    return { done: d.done, cancel: local.finish };
  }

  /** Ask the game server to walk a roaming character, and wait until it says the character is there. */
  private sendWalking(npc: Npc, action: WalkAction): ActionHandle {
    const { ctx, scene } = this.rt;
    const ticket = Math.random().toString(36).slice(2, 12);
    ctx.connection.walk({
      ticket, character_id: npc.id, to: action.to, position_x: action.position_x, position_y: action.position_y,
      spawn_point: action.spawn_point, scene_id: action.scene_id, speed: action.speed, facing: action.facing,
    });
    const d = deferred();
    const POLL = 100;
    let waited = 0;
    let taken = false;
    const timer = scene.time.addEvent({
      delay: POLL, loop: true,
      callback: () => {
        waited += POLL;
        const trip = ctx.connection.npc(npc.id)?.trip;
        if (trip === ticket) taken = true;
        // Done when the server has finished with it, or never took it up (no way there, or another walk came first).
        else if (taken || waited > WALK_ANSWER_MS) finish();
      },
    });
    const finish = () => {
      timer.remove();
      d.resolve();
    };
    return { done: d.done, cancel: finish };
  }

  private pathfinder(walk = this.rt.walk()): Pathfinder {
    const signature = walkSignature(walk);
    if (this.finder?.signature !== signature) this.finder = { signature, pathfinder: new Pathfinder(walk) };
    return this.finder.pathfinder;
  }

  /** Walk a character that does not roam along its local walk. */
  private stepLocal(c: PlacedCharacter, delta: number) {
    const w = c.walk;
    if (!w) return;
    const f = c.figure;
    const corner = w.path[0];
    if (!corner) {
      if (w.facing) f.setFacing(w.facing);
      if (w.door) this.leave(c);
      w.finish();
      return;
    }
    const step = (w.speed * speedFactorAt(this.rt.def, f.feet.x, f.feet.y) * Math.min(delta, 100)) / 1000;
    const next = stepToward(f.feet, corner, step);
    f.setFeet(next.x, next.y);
    f.setMoving(true);
    if (next.x === corner.x && next.y === corner.y) w.path.shift();
  }

  /** Fade a character out and remove it: it walked out of the scene. */
  private leave(c: PlacedCharacter) {
    if (c.leaving) return;
    c.leaving = true;
    c.lineHandle?.cancel();
    if (c.figure.sprite.input) c.figure.sprite.input.enabled = false;
    this.pointerOver = 0;
    c.figure.fadeTo(0, DOOR_FADE_MS, () => {
      if (this.characters.get(c.figure.npc.id) === c) this.characters.delete(c.figure.npc.id);
      c.figure.destroy();
    });
  }

  /**
   * Characters that roam: drawn where the room says they are, for as long as they are in this
   * scene. They fade in on arriving and out on leaving, walk as the room moves them, and play the
   * animations and say the lines of their routine.
   */
  private syncRoaming(delta: number) {
    const { ctx, def } = this.rt;
    const seen = new Set<Id>();
    ctx.connection.state.npcs?.forEach((rec: NpcRec) => {
      if (rec.scene_id !== def.id) return;
      const npc = ctx.index.characters.get(rec.character_id);
      if (!npc || !characterRoams(npc) || !testConditions(npc.conditions, ctx.vars.get)) return;
      seen.add(npc.id);
      let c = this.characters.get(npc.id);
      if (c?.leaving) {
        // Back before it had faded away.
        this.characters.delete(npc.id);
        c.figure.destroy();
        c = undefined;
      }
      if (!c) {
        const placement = (def.characters ?? []).find((p) => p.character_id === npc.id);
        c = this.character(npc, { x: rec.x, y: rec.y, facing: rec.facing }, placement?.event_id, true) ?? undefined;
        if (!c) return;
        if (this.drawn) {
          c.figure.sprite.setAlpha(0);
          c.figure.label.setAlpha(0);
          c.figure.fadeTo(1, DOOR_FADE_MS);
        }
        // A move that loops carries on; one that was over before we came is not replayed. Likewise a line.
        c.anim = rec.anim;
        const going = rec.anim.split(':')[0] ?? '';
        if (going && c.figure.play(going) > 0) c.figure.play('');
        c.line = rec.line;
      }
      const f = c.figure;
      f.approach(rec.x, rec.y, delta);
      f.setFacing(rec.facing === 'left' ? 'left' : 'right');
      f.setMoving(rec.moving);
      if (rec.anim !== c.anim) {
        c.anim = rec.anim;
        f.play(rec.anim.split(':')[0] ?? '');
      }
      if (rec.line !== c.line) {
        c.line = rec.line;
        c.lineHandle?.cancel();
        c.lineHandle = rec.line ? this.say(npc, rec.line) : null;
      }
    });
    for (const [id, c] of this.characters) if (c.roams && !seen.has(id)) this.leave(c);
  }

  /** A line of a character's routine: shown as the dialogue action it is written as, over the character. */
  private say(npc: Npc, token: string): ActionHandle | null {
    const index = Number(token.split(':')[1]);
    const step = npc.routine?.steps[index];
    if (!step || step.type !== 'dialogue') return null;
    const action: DialogueAction = {
      id: -100_000 - npc.id * 100 - index, type: 'dialogue', text: step.text, speaker: 'character', character_id: npc.id,
      duration: step.duration, narrate: step.narrate, narration_media_id: step.narration_media_id, media_id: step.media_id,
    };
    return this.rt.engine.host.present(action, this.rt.engine);
  }

  /**
   * Re-check each item's "exists" conditions, and each character's: one whose conditions stop holding
   * (it left for good in a cutscene) fades away.
   */
  variablesChanged() {
    const get = this.rt.ctx.vars.get;
    for (const p of this.items.values()) p.exists = testConditions(p.item.conditions, get);
    for (const c of this.characters.values()) {
      if (!c.leaving && !testConditions(c.figure.npc.conditions, get)) {
        if (!c.roams) this.away.add(c.figure.npc.id);
        this.leave(c);
      }
    }
    // Back once their conditions hold again (rescued), fading in where they are placed.
    for (const id of [...this.away]) {
      const npc = this.rt.ctx.index.characters.get(id);
      const placement = (this.rt.def.characters ?? []).find((p) => p.character_id === id);
      if (!npc || !placement || !testConditions(npc.conditions, get)) continue;
      const gone = this.characters.get(id);
      if (gone?.leaving) {
        this.characters.delete(id);
        gone.figure.destroy();
      } else if (gone) continue;
      this.away.delete(id);
      const c = this.character(npc, { x: placement.position_x, y: placement.position_y, facing: placement.facing }, placement.event_id, false);
      if (c && this.drawn) {
        c.figure.sprite.setAlpha(0);
        c.figure.label.setAlpha(0);
        c.figure.fadeTo(1, DOOR_FADE_MS);
      }
    }
  }

  /**
   * Play an animation on a placed item or character. Returns how long it lasts (0: it loops, or
   * the name means nothing to it), or null when there is no such thing on the floor here.
   */
  animate(what: 'item' | 'character', id: Id, name: string): number | null {
    if (what === 'character') {
      const c = this.characters.get(id);
      return c && !c.leaving && c.figure.sprite.visible ? c.figure.play(name) : null;
    }
    const target = this.items.get(id);
    if (!target || !target.image.visible) return null;
    return target.figure.play(name);
  }

  /** Bring item sprites in line with the room state. `delta` advances their animations. */
  update(_time = 0, delta = 0) {
    for (const p of this.items.values()) this.pose(p.figure, p.image, p.size, p.feet, delta);
    this.syncRoaming(delta);
    for (const c of [...this.characters.values()]) {
      this.stepLocal(c, delta);
      c.figure.update(delta);
    }
    this.drawn = true;
    const { state, me } = this.rt.ctx.connection;
    const mine = parseIds(me?.attachments ?? '');
    for (const p of this.items.values()) {
      let visible = p.exists;
      if (p.item.unique) {
        const rec = state.items.get(String(p.item.id));
        visible &&= !!rec && rec.holder === '' && rec.scene_id === this.rt.def.id;
        // A unique item lies where it was last put down, at the size that place gives it.
        if (rec && visible) {
          p.size = (p.item.scale ?? 1) * this.rt.zoom * scaleAt(this.rt.def, rec.x, rec.y);
          p.feet = rec.y;
          if (!p.figure.acting) p.image.setPosition(rec.x, rec.y).setDepth(this.depthOf(p.item, rec.y)).setScale(p.size).setTint(shadeTint(shadeAt(this.rt.def, rec.x, rec.y)));
        }
      } else {
        visible &&= !mine.includes(p.item.id);
      }
      if (p.image.visible !== visible) {
        p.image.setVisible(visible);
        if (p.image.input) p.image.input.enabled = visible;
        if (!visible) this.pointerOver = 0;
      }
    }
  }

  /** Advance a figure's animation and bend it as a built-in move asks. `feet` is where it stands. */
  private pose(figure: Figure, image: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite, size: number, feet: number, delta: number) {
    const was = figure.acting;
    figure.tick(delta);
    if (!was && !figure.acting) return;
    const bend = figure.pose();
    image.setScale(size * bend.scaleX, size * bend.scaleY).setRotation(bend.lean);
    image.y = feet - bend.lift * (image.displayHeight || 0);
    // Back to its idle once a move has ended. Which way it faces does not change.
    if (!figure.acting) figure.auto(false, 'right');
  }

  /** Round obstacles for items that block movement. */
  obstacles(): Circle[] {
    const out: Circle[] = [];
    for (const p of this.items.values()) {
      if (!p.item.blocking || !p.exists) continue;
      // A unique item only blocks while it is on the floor here; a per-player item always blocks at its placement.
      if (p.item.unique && !p.image.visible) continue;
      const at = p.item.unique ? p.image : p.home;
      out.push({ x: at.x, y: at.y, radius: blockingRadius(p.item) });
    }
    return out;
  }

  destroy() {
    for (const p of this.items.values()) p.image.destroy();
    for (const o of this.objects) o.destroy();
    for (const c of this.characters.values()) {
      c.walk?.finish();
      c.lineHandle?.cancel();
      c.figure.destroy();
    }
    this.characters.clear();
    this.items.clear();
    this.objects = [];
  }
}
