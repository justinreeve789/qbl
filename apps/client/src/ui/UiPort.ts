import type { BubbleAnchor } from './bubble';
import type { ActionHandle, Alignment, Badge, BuildPiece, BuildStatus, BuildTool, BuildUpload, Id, ButtonMark, CharacterPicture, ChatMode, InfoboxSize, ObjectiveStatus, OverlayMotion, SiteLink } from '@qbl/shared';
import type { SpeakOptions } from './Narrator';

export type { SpeakOptions };

export interface OverlayHandle extends ActionHandle {
  /** Animate the overlay (used by translate actions). */
  transition(to: { alpha?: number; scaleX?: number; scaleY?: number }, durationMs: number): void;
}

/** One thing in the player's bag, as shown. */
export interface BagSlot {
  id: number;
  name: string;
  /** Its picture, or null to show its name. */
  image: string | null;
  description?: string;
}

/** An infobox's button, as shown. */
export interface InfoboxButton {
  label: string;
  mark?: ButtonMark;
}

/** What a glossary word in an infobox says when it is tapped. */
export interface InfoboxWord {
  term: string;
  definition: string;
  image?: string | null;
}

export interface InfoboxOptions {
  dismissible: boolean;
  speak?: SpeakOptions;
  /** A picture or a video across the top. */
  hero?: { url: string; type: 'image' | 'video' } | null;
  size?: InfoboxSize | null;
  accent?: string | null;
  /** A glossary word's entry, by its id; null when there is none. */
  word?: (id: string) => InfoboxWord | null;
  /** The player looked a word up. True when it is new to their glossary. */
  learn?: (id: string) => boolean;
  /** A variable's value: what the box's live values, meters and `when` blocks show of the game. */
  vars?: (name: string) => unknown;
  /**
   * A button was chosen, with what was typed in the answer boxes (by variable name), before the
   * box closes. For a `try_again` button the box stays open until this settles.
   */
  chosen?: (index: number, answers: Record<string, string>) => void | Promise<void>;
}

export interface InfoboxHandle {
  /** Resolves with the index of the button chosen, or null if the box was dismissed or closed. */
  choice: Promise<number | null>;
  close(): void;
}

/**
 * Everything the game asks of the on-screen UI. The real implementation
 * (Ui) draws HTML over the canvas; tests supply a headless one. Game code
 * depends on this interface only, never on the DOM.
 */
export interface UiPort {
  /** True while something modal is open or a text field has focus; the game ignores movement input meanwhile. */
  readonly capturesInput: boolean;
  readonly videoPlaying: boolean;
  readonly videoTime: number;

  /** `speak`, here and on the other text below: read it aloud, highlighting each word as it is spoken. */
  textOverlay(text: string, o: { alignment?: Alignment; size?: number; color?: string; style?: string; duration?: number; speak?: SpeakOptions }): OverlayHandle;
  imageOverlay(url: string, o: { alignment?: Alignment; scaleX?: number; scaleY?: number; duration?: number; panel?: boolean; motion?: OverlayMotion; tone?: 'memory' | 'dream' }): OverlayHandle;
  videoOverlay(url: string, o: { alignment?: Alignment; volume?: number }): OverlayHandle;
  /**
   * `html` is trusted only as far as the sanitiser allows. `choice` settles with the button that
   * closed the box (never a `try_again` one), or null.
   */
  infobox(html: string, buttons: InfoboxButton[], o: InfoboxOptions): InfoboxHandle;
  /**
   * A speech bubble that follows a speaker. `anchor` is asked every frame where the speaker is on
   * the page (null while they are off screen); the bubble places itself so it stays in view.
   */
  dialogue(text: string, o: { name?: string; duration: number; anchor: () => BubbleAnchor | null; speak?: SpeakOptions }): ActionHandle;
  /**
   * A dialogue box across the bottom of the screen with the speaker's close-up portrait and name.
   * With `duration` 0 it stays until the player clicks or presses Enter or Space to continue.
   * `watching`: it comes from another player's event, so it never takes this player's input.
   * `narrator`: the narrator speaks (a narration action): the same box, with no close-up and no name.
   */
  portraitDialogue(text: string, o: { name?: string; portrait?: CharacterPicture; duration: number; watching?: boolean; narrator?: boolean; speak?: SpeakOptions }): ActionHandle;
  /**
   * The player's answers to a line of a conversation, for a dialogue tree, shown once the line has
   * been said (in its own story box or bubble, which has closed by then). `portrait`: a box of the
   * player's own, with their close-up and name, listing the answers. `bubble`: the answers in a
   * plain box across the bottom of the screen. It cannot be closed without answering; `choice`
   * settles with the index of the answer picked, or null when the game closes it.
   */
  choose(answers: string[], o: { style: 'portrait' | 'bubble'; name?: string; portrait?: CharacterPicture }): InfoboxHandle;
  /**
   * Stars, XP and rank, shown in the account menu (and the stars on its button), and the way into
   * the marketplace. Null: the player has none (guests).
   */
  rewards(state: { stars: number; xp: number; rank: string; next_rank_xp: number | null } | null, onOpen: () => void): void;
  /** What the player can do from their screen: one button per move. An empty list hides the row. */
  moves(list: Array<{ animation: string; label: string; icon: string }>, onDo: (animation: string) => void): void;
  /**
   * The player's own button, top right: their face, opening a menu with their profile, the
   * wardrobe, the site's places and signing out (for a guest, signing in). Null removes it.
   */
  account(who: AccountView | null, on: AccountActions): void;
  /**
   * The marketplace and wardrobe. `view` is asked again after every purchase or change, so the
   * window always shows the current stars and what is owned and worn.
   */
  shop(view: () => ShopView, on: { buy(id: number): Promise<void>; equip(id: number, on: boolean): Promise<void> }): ActionHandle;
  clearOverlays(): void;

  chat(mode: ChatMode, send: { text(t: string): void; emote(e: string): void }): void;
  attachments(items: Array<{ id: number; name: string }>, onRemove: (id: number) => void): void;
  /**
   * The bar of things the player carries, as in a point-and-click adventure: one button each, the
   * picked one (`selected`) marked, with a line saying what picking does. An empty list hides it.
   */
  bag(items: BagSlot[], selected: number | null, on: { pick(id: number): void; drop(): void }): void;
  /**
   * The bar beside a story scene, which plays by itself: skip ahead to the next scene, or watch this
   * one again. Either may be left out. Null takes it away.
   */
  storyBar(bar: { skip?: () => void; again?: () => void } | null): void;
  objectives(list: ObjectiveStatus[]): void;
  /**
   * Who else is playing: the people in the scenario, with where they are. `on.profile` opens a
   * player's profile; `on.message`, when private messages are allowed, starts writing to them.
   */
  players(list: PlayerRow[], on: { profile(id: string): void; message?(id: string): void }): void;
  /** For a teacher: the teams they can follow, to switch to another. Null: none to offer. */
  teams(list: TeamRow[] | null, onFollow: (group: string) => void): void;
  /**
   * For a teacher: launching one of their missions for the players here, and the scenes of this
   * mission they can go through on the way. Null: not offered. `launch` is called once the teacher
   * has confirmed.
   */
  launches(view: LaunchView | null, launch: (choice: LaunchChoice) => void): void;
  /**
   * The messages panel: whether what is said in the scene can be typed there, and whether
   * players can be written to privately. `send` gets the thread (`scene`, or a player's
   * session id) and the text. Null: there is no messages panel.
   */
  messaging(o: { scene: boolean; private: boolean; send(thread: string, text: string): void } | null): void;
  /** A message to show in its thread: something said in the scene, or a private message either way. */
  message(line: ChatLine): void;
  /** Open the conversation with one player, ready to type in. */
  openMessages(thread: string, name: string): void;
  /** The player's glossary. `fresh` is the id of a word just added, to be marked as new. */
  glossary(list: GlossaryRow[], fresh?: string): void;
  /**
   * A player's profile card: their avatar as it is dressed, rank, stars, XP and badges. It can
   * be opened with what is known at once and filled in when the rest arrives (`update`).
   */
  profile(view: ProfileView, on?: { message?(): void }): { update(view: ProfileView): void; close(): void };
  /** Offer the read-aloud switch: the scenario has text that is read aloud. */
  narration(available: boolean): void;
  toast(message: string, ms?: number): void;
  /**
   * A message with a link the player presses to open `href` in a new tab: for when the browser
   * would not open one by itself (a tab opened without a click is often blocked).
   */
  linkOffer(message: string, href: string, label: string): void;
  /** What stands beside a close-up bench: its readings, what is in the player's hand, its buttons and its graph. */
  benchPanel(spec: BenchPanelSpec, on: BenchPanelActions): BenchPanelHandle;
  /**
   * The Build button, for a scene where students may build: shown with a label, or hidden with null.
   * Pressing it calls `onOpen`.
   */
  buildButton(label: string | null, onOpen: () => void): void;
  /** The build palette: open while the player builds. The game ignores walking and hotspots meanwhile. */
  buildPanel(spec: BuildPanelSpec, on: BuildPanelActions): BuildPanelHandle;
  /** A persistent message such as "Reconnecting…". Pass null to clear it. */
  status(message: string | null): void;
}

/** Who is playing, for the account menu. */
export interface AccountView {
  name: string;
  guest: boolean;
  /** Under the name: "Teacher", "Playing as a guest". */
  subtitle?: string;
  avatar?: CharacterPicture | null;
  /** The site's places the menu links to (see `siteLinks`). */
  links: SiteLink[];
}

export interface AccountActions {
  /** Sign out, or for a guest sign in with an account. Absent: not offered (a preview). */
  signOut?: (() => void) | null;
  /** Leave the game for another page of the site (the game saves first). */
  leave?(href: string): void;
  /** Open the player's own profile card. */
  profile?(): void;
  /** For teachers and admins: start this mission again from the beginning (asks first). Absent: not offered. */
  restart?(): void;
}

/** One line of the players list. `id` is the player's session id. */
export interface PlayerRow {
  id: string;
  name: string;
  me: boolean;
  /** In this player's team (always true when there are no teams). */
  teammate: boolean;
  /** The team's name, where teams have names. */
  team?: string;
  /** In the same scene, and shown there. */
  here: boolean;
  /** Otherwise, where they are: the scene's name. */
  where?: string;
  connected: boolean;
}

/** A team a teacher can follow, as the teams tab lists it. */
export interface TeamRow {
  /** The team's instance key (`t7`; `a12` for students in no team). */
  group: string;
  name: string;
  /** The team the teacher is following now. */
  current: boolean;
  /** How many of its players are in the game right now, and where most of them are. */
  online: number;
  where?: string;
}

/** What the teacher's launch tab offers. */
export interface LaunchView {
  /** Their assignments of other missions, soonest due first. */
  missions: LaunchRow[];
  /** This mission's scenario launcher scenes: where players can be sent first, before the launched scenario opens. */
  departures: Array<{ sceneId: number; name: string }>;
}

/** One mission the teacher can launch. */
export interface LaunchRow {
  assignmentId: number;
  title: string;
  /** It waits for the teacher: its students do not see it until it is launched. */
  waiting: boolean;
  /** How many of its students are in this game now, of how many. */
  here: number;
  students: number;
}

/** What the teacher chose: the mission, the launcher scene to go to first (none: straight there), and whether they stay behind. */
export interface LaunchChoice {
  assignmentId: number;
  sceneId?: number;
  stay: boolean;
}

export interface ChatLine {
  /** `scene` for what was said out loud, or the session id of the other player in a private conversation. */
  thread: string;
  threadName: string;
  /** Who wrote it, by name. */
  from: string;
  mine: boolean;
  text: string;
  at: number;
}

export interface GlossaryRow { id: string; term: string; definition: string; image?: string | null }

export interface ProfileView {
  name: string;
  /** Still fetching the rest. */
  loading?: boolean;
  /** A guest has no account: no rank, stars or badges to show. */
  guest?: boolean;
  team?: string;
  rank?: string;
  stars?: number;
  xp?: number;
  nextRankXp?: number | null;
  badges?: Badge[];
  /** The avatar standing: a picture, or one frame of a sprite sheet. */
  avatar: CharacterPicture;
  /** What the avatar has on: wearables by slot, and a pet. */
  worn: Array<{ name: string; url: string; kind: string; slot?: string }>;
}

export interface ShopView {
  stars: number;
  items: Array<{ id: number; name: string; description?: string; kind: string; slot?: string; price: number; image: string | null; mission: boolean; owned: boolean; equipped: boolean }>;
}

// ------------------------------------------------------------------ close-up bench

/** What the bench panel offers, fixed for the scene. */
export interface BenchPanelSpec {
  readouts: Array<{ id: string; label: string }>;
  reset: boolean;
  /** A graph of one reading against another, as the player records it. */
  graph: { title: string; xLabel: string; yLabel: string; button: boolean } | null;
}

/** How the bench stands, redrawn as it changes. */
export interface BenchPanelView {
  /** By readout id, as shown ("12.5 mL"). */
  readings: Record<string, string>;
  /** What is in the player's hand and what to do with it, or null. */
  holding: string | null;
  /** The points recorded for the graph so far. */
  points: Array<[number, number]>;
}

export interface BenchPanelActions {
  reset(): void;
  putDown(): void;
  record(): void;
  clearGraph(): void;
}

export interface BenchPanelHandle {
  update(view: BenchPanelView): void;
  close(): void;
}

// ------------------------------------------------------------------ student building

/** What the build palette offers, fixed while it is open. */
export interface BuildPanelSpec {
  /** What the scene's author asks students to make. */
  prompt: string;
  tools: BuildTool[];
  /** What Place offers: the scene's pieces, with their pictures. */
  pieces: Array<{ mediaId: Id; url: string; name: string }>;
  colors: readonly string[];
  maxPieces: number;
  /** The teacher looks before others see it. */
  approve: boolean;
  /** Others in the game see approved builds here (`own`: only the player and their teacher). */
  shared: boolean;
}

/** How the player's build stands, redrawn as it changes. */
export interface BuildPanelView {
  count: number;
  /** What is picked, or null. */
  selected: { kind: BuildPiece['kind']; text?: string; color?: string } | null;
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  /** The state of what was saved before: shown so the player knows whether others see it. */
  status: BuildStatus | null;
  /** The player's own pictures, for the picture chooser. */
  pictures: readonly BuildUpload[];
}

export interface BuildPanelActions {
  addSticker(mediaId: Id): void;
  addLabel(text: string, color: string): void;
  addPicture(uploadId: number): void;
  upload(file: File): Promise<void>;
  removePicture(uploadId: number): Promise<void>;
  /** Change the picked thing: grow or shrink by a factor, turn by degrees, re-word or re-colour a label. */
  resize(factor: number): void;
  turn(degrees: number): void;
  relabel(text: string, color: string): void;
  remove(): void;
  undo(): void;
  redo(): void;
  clear(): void;
  /** Keep what was built. */
  done(): void;
  /** Put things back as they were and close. */
  cancel(): void;
}

export interface BuildPanelHandle {
  update(view: BuildPanelView): void;
  close(): void;
}
