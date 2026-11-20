import { readFileSync } from 'node:fs';
import { normalizeScenario, type CharacterPicture, type ObjectiveStatus, type Scenario, type User } from '@qbl/shared';
import { queueScene } from '../src/core/assets';
import { GameContext } from '../src/core/GameContext';
import { ObjectivesFeature } from '../src/features/ObjectivesFeature';
import { OfflineConnection } from '../src/net/Connection';
import { PlayScene } from '../src/scenes/PlayScene';
import { LocalPlayerSystem } from '../src/systems/LocalPlayerSystem';
import { MovesFeature } from '../src/features/MovesFeature';
import { RewardsFeature } from '../src/features/RewardsFeature';
import type { ChatLine, GlossaryRow, InfoboxHandle, OverlayHandle, PlayerRow, TeamRow, ProfileView, ShopView, SpeakOptions, UiPort } from '../src/ui/UiPort';
import { FakeWorld, settle } from './fakePhaser';

export interface OpenInfobox {
  html: string;
  buttons: string[];
  dismissible: boolean;
  choose(index: number): void;
  dismiss(): void;
}

/** A UI with no DOM: it records what the game asked for and lets a test answer infoboxes. */
export class HeadlessUi implements UiPort {
  texts: string[] = [];
  images: string[] = [];
  toasts: string[] = [];
  boxes: OpenInfobox[] = [];
  checklist: ObjectiveStatus[] = [];
  statusText: string | null = null;
  videoPlaying = false;
  videoTime = 0;

  constructor(private world: FakeWorld) {}

  get capturesInput() {
    return this.boxes.length > 0 || this.asks.length > 0;
  }

  private overlay(list: string[], value: string, duration?: number): OverlayHandle {
    list.push(value);
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    const end = () => {
      const i = list.indexOf(value);
      if (i >= 0) list.splice(i, 1);
      finish();
    };
    if (duration && duration > 0) this.world.schedule(duration, end);
    return { done, cancel: end, transition() {} };
  }
  /** The stars display, as last drawn. */
  hud: { stars: number; xp: number; rank: string } | null = null;
  rewards(state: { stars: number; xp: number; rank: string } | null) { this.hud = state; }
  account() {}
  /** The move buttons showing now, and a way to press one. */
  moveButtons: Array<{ animation: string; label: string; icon: string }> = [];
  pressMove: (animation: string) => void = () => {};
  moves(list: Array<{ animation: string; label: string; icon: string }>, onDo: (animation: string) => void) {
    this.moveButtons = list;
    this.pressMove = onDo;
  }
  /** The marketplace, when open: what it shows and the buttons it offers. */
  shopOpen: { view: () => ShopView; on: { buy(id: number): Promise<void>; equip(id: number, on: boolean): Promise<void> }; close(): void } | null = null;
  shop(view: () => ShopView, on: { buy(id: number): Promise<void>; equip(id: number, on: boolean): Promise<void> }) {
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    const close = () => { this.shopOpen = null; finish(); };
    this.shopOpen = { view, on, close };
    return { done, cancel: close };
  }
  /** Lines of dialogue showing now, as "speaker: text". */
  dialogues: string[] = [];
  /** Everything that was read aloud, in order: the text and how it was to sound. */
  spoken: Array<{ text: string; speak: SpeakOptions }> = [];
  private say(text: string, speak?: SpeakOptions) {
    if (speak) this.spoken.push({ text, speak });
  }
  dialogue(text: string, o: { name?: string; duration: number; speak?: SpeakOptions }) {
    this.say(text, o.speak);
    return this.overlay(this.dialogues, `${o.name ?? 'player'}: ${text}`, o.duration);
  }
  /** Portrait boxes showing now. `next()` is the player clicking to continue. */
  stories: Array<{ name?: string; text: string; portrait?: string; watching: boolean; next(): void }> = [];
  portraitDialogue(text: string, o: { name?: string; portrait?: CharacterPicture; duration: number; watching?: boolean; speak?: SpeakOptions }) {
    this.say(text, o.speak);
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    const entry = { name: o.name, text, portrait: o.portrait?.url ?? undefined, watching: !!o.watching, next: () => end() };
    const end = () => {
      const i = this.stories.indexOf(entry);
      if (i >= 0) this.stories.splice(i, 1);
      finish();
    };
    this.stories.push(entry);
    if (o.duration > 0) this.world.schedule(o.duration, end);
    return { done, cancel: end };
  }
  /** Conversation lines waiting for an answer: what is said, by whom, the answers, and picking one. */
  asks: Array<{ text: string; name?: string; style: string; answers: string[]; pick(i: number): void }> = [];
  choose(text: string, answers: string[], o: { style: 'portrait' | 'bubble'; name?: string; speak?: SpeakOptions }): InfoboxHandle {
    this.say(text, o.speak);
    let resolve!: (i: number | null) => void;
    const choice = new Promise<number | null>((r) => (resolve = r));
    const entry = { text, name: o.name, style: o.style, answers, pick: (i: number | null) => close(i) };
    const close = (i: number | null) => {
      const at = this.asks.indexOf(entry);
      if (at < 0) return;
      this.asks.splice(at, 1);
      resolve(i);
    };
    this.asks.push(entry);
    return { choice, close: () => close(null) };
  }
  textOverlay(text: string, o: { duration?: number; speak?: SpeakOptions }) {
    this.say(text, o.speak);
    return this.overlay(this.texts, text, o.duration);
  }
  imageOverlay(url: string, o: { duration?: number }) { return this.overlay(this.images, url, o.duration); }
  videoOverlay(url: string) { return this.overlay(this.images, url, 1); }

  infobox(html: string, buttons: string[], o: { dismissible: boolean; speak?: SpeakOptions }): InfoboxHandle {
    this.say(html, o.speak);
    let resolve!: (i: number | null) => void;
    const choice = new Promise<number | null>((r) => (resolve = r));
    const box: OpenInfobox = {
      html, buttons, dismissible: o.dismissible,
      choose: (i) => close(i),
      dismiss: () => {
        if (!o.dismissible) throw new Error('This infobox cannot be dismissed');
        close(null);
      },
    };
    const close = (i: number | null) => {
      const at = this.boxes.indexOf(box);
      if (at < 0) return;
      this.boxes.splice(at, 1);
      resolve(i);
    };
    this.boxes.push(box);
    return { choice, close: () => close(null) };
  }
  clearOverlays() { this.texts = []; this.images = []; }
  chat() {}
  /** The players list as last drawn, and what clicking a name or its message button does. */
  playerList: PlayerRow[] = [];
  onPlayer: { profile(id: string): void; message?(id: string): void } = { profile() {} };
  players(list: PlayerRow[], on: { profile(id: string): void; message?(id: string): void }) {
    this.playerList = list;
    this.onPlayer = on;
  }
  /** The teams tab as last drawn (null: not offered), and what choosing a team does. */
  teamList: TeamRow[] | null = null;
  onFollow: (group: string) => void = () => {};
  teams(list: TeamRow[] | null, onFollow: (group: string) => void) {
    this.teamList = list;
    this.onFollow = onFollow;
  }
  /** The messages panel: how it is set up, every line shown, and which conversation was opened. */
  messagingSetup: { scene: boolean; private: boolean; send(thread: string, text: string): void } | null = null;
  lines: ChatLine[] = [];
  openedThread: { thread: string; name: string } | null = null;
  messaging(o: { scene: boolean; private: boolean; send(thread: string, text: string): void } | null) { this.messagingSetup = o; }
  message(line: ChatLine) { this.lines.push(line); }
  openMessages(thread: string, name: string) { this.openedThread = { thread, name }; }
  /** The glossary as last drawn, and the word that was marked new. */
  words: GlossaryRow[] = [];
  freshWord: string | undefined;
  glossary(list: GlossaryRow[], fresh?: string) {
    this.words = list;
    this.freshWord = fresh;
  }
  /** The profile card showing, if one is open. */
  profileCard: { view: ProfileView; on: { message?(): void } } | null = null;
  profile(view: ProfileView, on: { message?(): void } = {}) {
    const card = (this.profileCard = { view, on });
    return { update: (v: ProfileView) => void (card.view = v), close: () => void (this.profileCard = null) };
  }
  narrationOffered = false;
  narration(available: boolean) { this.narrationOffered = available; }
  attachments() {}
  objectives(list: ObjectiveStatus[]) { this.checklist = list; }
  toast(message: string) { this.toasts.push(message); }
  status(message: string | null) { this.statusText = message; }
}

export function loadScenario(name = 'starship'): Scenario {
  const file = new URL(`../../../scenarios/${name}.json`, import.meta.url);
  return normalizeScenario(JSON.parse(readFileSync(file, 'utf8')) as Scenario);
}

/** A whole game running headlessly in offline mode: real scenario, real engine, real systems, fake Phaser. */
export class Game {
  readonly world = new FakeWorld();
  readonly ui = new HeadlessUi(this.world);
  readonly ctx: GameContext;
  readonly scene = new PlayScene();
  private objectives = new ObjectivesFeature();

  constructor(readonly scenario: Scenario = loadScenario(), user: User = { id: 'u1', name: 'Tester', role: 'student' }) {
    const connection = new OfflineConnection(scenario, user, scenario.avatars?.[0]?.id, () => this.world.now);
    this.ctx = new GameContext(scenario, user, connection, this.ui);
    // Like a preview: an account to try awards and the marketplace with, kept only in memory.
    this.ctx.rewards.pretend();
    new RewardsFeature().start(this.ctx);
    new MovesFeature().start(this.ctx);
    this.world.registry.set('ctx', this.ctx);
    this.world.mount(this.scene as never);
    this.ctx.vars.onChange(() => this.objectives.refresh(this.ctx));
    this.objectives.refresh(this.ctx);
    // What BootScene does: load the first scene's media, then start playing.
    const first = this.ctx.index.scene(connection.me!.scene_id)!;
    queueScene(this.scene, this.ctx, first);
    (this.scene as any).load.start();
    this.scene.init();
    this.scene.create({ sceneId: first.id });
  }

  get sceneName(): string {
    return this.scene.def.shortname ?? String(this.scene.def.id);
  }
  get position() {
    return this.scene.system(LocalPlayerSystem).position;
  }
  get box(): OpenInfobox | undefined {
    return this.ui.boxes.at(-1);
  }
  var(name: string) {
    return this.ctx.vars.get(name);
  }
  /** Checklist lines as "[x] text" / "[ ] text". */
  get checklist(): string[] {
    return this.ui.checklist.map((o) => `[${o.complete ? 'x' : ' '}] ${o.text}`);
  }

  async wait(ms: number) {
    await this.world.advance(this.scene as never, ms);
  }

  /** Hold movement keys until `until` is true. Fails if it takes longer than `limitMs` of game time. */
  async hold(keys: string[], until: () => boolean, limitMs = 20_000) {
    for (const k of keys) (this.world.keys[k] ??= { isDown: false }).isDown = true;
    const deadline = this.world.now + limitMs;
    while (!until() && this.world.now < deadline) await this.wait(16);
    for (const k of keys) this.world.keys[k]!.isDown = false;
    if (!until()) throw new Error(`Still at ${JSON.stringify(this.position)} in ${this.sceneName} after ${limitMs} ms`);
    await this.wait(16);
  }

  /** Walk off an edge and wait until the named scene is playing. */
  async walkOff(key: 'left' | 'right' | 'up' | 'down', toScene: string) {
    await this.hold([key], () => this.sceneName === toScene);
    await this.wait(100);
  }

  /** Click or tap a point in the scene. */
  async click(x: number, y: number) {
    (this.scene as any).input.emit('pointerdown', { x, y });
    await settle();
    await this.wait(32);
  }

  /** Click, then keep walking toward the point until the avatar arrives. */
  async walkTo(x: number, y: number) {
    this.scene.system(LocalPlayerSystem).walkTo({ x, y });
    let last = { x: NaN, y: NaN };
    for (let i = 0; i < 2000; i++) {
      await this.wait(16);
      const p = this.position;
      if (p.x === last.x && p.y === last.y) return;
      last = p;
    }
    throw new Error('Never arrived');
  }

  /** Choose a button on the open infobox by its label (or the start of it). */
  async choose(label: string) {
    const box = this.box;
    if (!box) throw new Error(`No infobox is open (wanted "${label}")`);
    const i = box.buttons.findIndex((b) => b.startsWith(label));
    if (i < 0) throw new Error(`No button "${label}" among ${JSON.stringify(box.buttons)}`);
    box.choose(i);
    await settle();
    await this.wait(48);
  }

  /** Answer the conversation line waiting for one, by the answer's text (or the start of it). */
  async answer(label: string) {
    const ask = this.ui.asks.at(-1);
    if (!ask) throw new Error(`No conversation is waiting for an answer (wanted "${label}")`);
    const i = ask.answers.findIndex((a) => a.startsWith(label));
    if (i < 0) throw new Error(`No answer "${label}" among ${JSON.stringify(ask.answers)}`);
    ask.pick(i);
    await settle();
    await this.wait(48);
  }

  async dismiss() {
    const box = this.box;
    if (!box) throw new Error('No infobox is open');
    box.dismiss();
    await settle();
    await this.wait(48);
  }
}
