import type { BubbleAnchor } from './bubble';
import type { ActionHandle, Alignment, Badge, CharacterPicture, ChatMode, ObjectiveStatus, SiteLink } from '@qbl/shared';
import type { SpeakOptions } from './Narrator';

export type { SpeakOptions };

export interface OverlayHandle extends ActionHandle {
  /** Animate the overlay (used by translate actions). */
  transition(to: { alpha?: number; scaleX?: number; scaleY?: number }, durationMs: number): void;
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
  imageOverlay(url: string, o: { alignment?: Alignment; scaleX?: number; scaleY?: number; duration?: number }): OverlayHandle;
  videoOverlay(url: string, o: { alignment?: Alignment; volume?: number }): OverlayHandle;
  /** `html` is trusted only as far as the sanitiser allows. */
  infobox(html: string, buttons: string[], o: { dismissible: boolean; speak?: SpeakOptions }): InfoboxHandle;
  /**
   * A speech bubble that follows a speaker. `anchor` is asked every frame where the speaker is on
   * the page (null while they are off screen); the bubble places itself so it stays in view.
   */
  dialogue(text: string, o: { name?: string; duration: number; anchor: () => BubbleAnchor | null; speak?: SpeakOptions }): ActionHandle;
  /**
   * A dialogue box across the bottom of the screen with the speaker's close-up portrait and name.
   * With `duration` 0 it stays until the player clicks or presses Enter or Space to continue.
   * `watching`: it comes from another player's event, so it never takes this player's input.
   */
  portraitDialogue(text: string, o: { name?: string; portrait?: CharacterPicture; duration: number; watching?: boolean; speak?: SpeakOptions }): ActionHandle;
  /**
   * One line of a conversation and the answers the player can give, for a dialogue tree. `portrait`:
   * a story box with the speaker's close-up and the answers listed under the line. `bubble`: the
   * line in a bubble over the speaker (`anchor`, as for dialogue) and the answers in a box across
   * the bottom of the screen. It cannot be closed without answering; `choice` settles with the
   * index of the answer picked, or null when the game closes it.
   */
  choose(text: string, answers: string[], o: { style: 'portrait' | 'bubble'; name?: string; portrait?: CharacterPicture; anchor?: () => BubbleAnchor | null; speak?: SpeakOptions }): InfoboxHandle;
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
  objectives(list: ObjectiveStatus[]): void;
  /**
   * Who else is playing: the people in the scenario, with where they are. `on.profile` opens a
   * player's profile; `on.message`, when private messages are allowed, starts writing to them.
   */
  players(list: PlayerRow[], on: { profile(id: string): void; message?(id: string): void }): void;
  /** For a teacher: the teams they can follow, to switch to another. Null: none to offer. */
  teams(list: TeamRow[] | null, onFollow: (group: string) => void): void;
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
