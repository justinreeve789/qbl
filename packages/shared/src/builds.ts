import type { MediaSpeech } from './speech.js';
import type { Id, Scene } from './types.js';

/**
 * Student building: a scene whose author allows it lets players add things of their own on top of
 * it (stickers, labels, their own pictures, and hotspots that open words or a picture, or have the
 * narrator say something in the story box, when clicked),
 * from a Build button in the game. Their teacher can change any of their builds, in the game.
 *
 * What a student builds is an extra layer, never part of the scene: the scenario's tables and its
 * compiled document are not changed. Each student has one build per scene in each instance (the
 * public game, an assignment's, a team's), kept by the API (App\Qbl\Builds) beside their save and
 * deleted with it when their teacher starts their game again.
 *
 * The rules here are checked in the game before saving and again by the server, which has its own
 * copy in App\Qbl\Builds\BuildRules: the two must agree.
 */

/** What a scene's author can let students use. */
export type BuildTool = 'place' | 'label' | 'picture' | 'hotspot';
export const BUILD_TOOLS: readonly BuildTool[] = ['place', 'label', 'picture', 'hotspot'];

/** `scene.building`: the author's settings, kept in the scene's params. */
export interface SceneBuilding {
  enabled?: boolean;
  /**
   * Default: place and label. `picture`: students may hang pictures they upload. `hotspot`: students
   * may add spots that open words, a picture or both when clicked (and upload pictures for them).
   */
  tools?: BuildTool[] | null;
  /** The scenario's pictures that Place offers (the author chooses them). */
  pieces?: Array<{ media_id: Id }> | null;
  /** The most things one student may add here. Default 12, at most 50. */
  max_pieces?: number | null;
  /** Default true: the teacher approves a build before anyone else sees it. */
  approve?: boolean | null;
  /** `instance` (default): approved builds are seen by everyone in the same game. `own`: only by the student and their teacher. */
  share?: 'instance' | 'own' | null;
  /** What the author asks students to make, shown when Build opens. */
  prompt?: string | null;
}

/** A building's settings with every default filled in. */
export interface BuildingRules {
  tools: BuildTool[];
  pieces: Id[];
  maxPieces: number;
  approve: boolean;
  share: 'instance' | 'own';
  prompt: string;
}

/**
 * What a hotspot looks like: one of the building's pieces (`media_id`), one of the student's
 * pictures (`upload_id`), words (`text`, `color`), or nothing: an invisible square people find by
 * pointing at it (HOTSPOT_LOOK.box pixels times `scale`).
 */
export type HotspotLook = 'sticker' | 'picture' | 'label' | 'none';
export const HOTSPOT_LOOKS: readonly HotspotLook[] = ['sticker', 'picture', 'label', 'none'];

/**
 * What a hotspot opens when clicked: words, a picture (a piece or one of the student's), or both, in
 * a box; and/or `say`, words the narrator says in the story box (as a `narration` action does)
 * first. The server records `say` in the scenario's narrator's voice when the build is kept
 * (SceneBuild.voices); until then, or with no narrator, the browser's voice reads it.
 */
export interface HotspotOpens {
  text?: string;
  media_id?: Id;
  upload_id?: number;
  say?: string;
}

/** One thing a student added. Positions are in scene pixels; `x, y` is the thing's centre. */
export interface BuildPiece {
  id: string;
  kind: 'sticker' | 'label' | 'picture' | 'hotspot';
  x: number;
  y: number;
  /** 1: the picture's own size (a label: its normal size). */
  scale?: number;
  /** Degrees, clockwise. */
  angle?: number;
  /** hotspot: what is drawn (default `none`), with the fields of that kind below. */
  look?: HotspotLook;
  /** sticker (and a hotspot that looks like one): one of the building's pieces. */
  media_id?: Id;
  /** picture (and a hotspot that looks like one): one of the student's own uploads. */
  upload_id?: number;
  /** label (and a hotspot that looks like one): its words. */
  text?: string;
  /** label (and a hotspot that looks like one): one of LABEL_COLORS. */
  color?: string;
  /** hotspot: what clicking it opens. */
  opens?: HotspotOpens;
}

export type BuildStatus = 'pending' | 'approved' | 'hidden';

/** A student's build in one scene, as the API hands it to the game. */
export interface SceneBuild {
  id: number;
  scene_id: Id;
  /** The player's own. */
  mine: boolean;
  /** Who made it, as other players know them. */
  author: string;
  status: BuildStatus;
  pieces: BuildPiece[];
  updated_at?: string | null;
  /**
   * Someone else's build that this player may change: they are its maker's teacher. Their teacher
   * sees it whatever its state.
   */
  editable?: boolean;
  /** With `editable`: the maker's pictures, which their build may show. */
  uploads?: BuildUpload[];
  /**
   * The narrator's recordings of what its hotspots say (`opens.say`), by piece id. A hotspot with
   * none here (not recorded yet, the voice service is off, or the scenario has no narrator) is read
   * by the browser's voice.
   */
  voices?: Record<string, BuildVoice>;
}

/** A recording of what a student's hotspot has the narrator say. */
export interface BuildVoice {
  url: string;
  /** What it says and when each word is said; `line` is the hotspot's `say` it was recorded from. */
  speech: MediaSpeech;
}

/** A picture a student uploaded for their builds in one instance. */
export interface BuildUpload {
  id: number;
  url: string;
  width: number;
  height: number;
}

export const BUILD_LIMITS = {
  defaultPieces: 12,
  maxPieces: 50,
  labelLength: 60,
  minScale: 0.2,
  maxScale: 4,
  /** Uploads per student per instance. */
  uploads: 20,
  /** Bytes, before the server re-encodes it. */
  uploadBytes: 8 * 1024 * 1024,
  promptLength: 300,
  /** The words a hotspot opens. */
  noteLength: 500,
  /** The words a hotspot has the narrator say. */
  sayLength: 300,
} as const;

/**
 * How big things are drawn, the same in the game and in the teacher's preview: a sticker at its
 * picture's own size times `scale` (and the scene's zoom), an uploaded picture fitted into a square
 * of `pictureBox` pixels times `scale`, and a label's letters `labelSize` pixels high times `scale`.
 */
export const BUILD_LOOK = { pictureBox: 360, labelSize: 30, hotspotBox: 120 } as const;

/** The colours a label can be written in. */
export const LABEL_COLORS: readonly string[] = ['#ffffff', '#1f2937', '#fde047', '#fb923c', '#f87171', '#60a5fa', '#4ade80', '#c084fc'];

/** The scene's building rules, or null when students cannot build there. */
export function buildingRules(scene: Pick<Scene, 'building' | 'story'> | null | undefined): BuildingRules | null {
  const b = scene?.building;
  if (!b || b.enabled !== true || scene?.story) return null;
  const tools = (b.tools ?? ['place', 'label']).filter((t, i, all) => BUILD_TOOLS.includes(t) && all.indexOf(t) === i);
  const pieces = (b.pieces ?? []).map((p) => p?.media_id).filter((id): id is Id => id != null);
  // Place needs something to place.
  const usable = tools.filter((t) => t !== 'place' || pieces.length > 0);
  if (!usable.length) return null;
  const max = Math.round(Number(b.max_pieces ?? BUILD_LIMITS.defaultPieces));
  return {
    tools: usable,
    pieces,
    maxPieces: Number.isFinite(max) ? Math.min(BUILD_LIMITS.maxPieces, Math.max(1, max)) : BUILD_LIMITS.defaultPieces,
    approve: b.approve !== false,
    share: b.share === 'own' ? 'own' : 'instance',
    prompt: String(b.prompt ?? '').trim().slice(0, BUILD_LIMITS.promptLength),
  };
}

/** A label's words as they are kept: one line, no markup characters, at most labelLength. */
export function cleanLabel(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, BUILD_LIMITS.labelLength);
}

/**
 * The words a hotspot opens as they are kept: lines kept (at most two blank in a row), no other
 * control or markup characters, at most noteLength.
 */
export function cleanNote(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, BUILD_LIMITS.noteLength)
    .trim();
}

/**
 * The words a hotspot has the narrator say, as they are kept: one line, no control or markup
 * characters and no { } (they are never filled in), at most sayLength.
 */
export function cleanSay(text: string): string {
  // Only plain spaces are trimmed, as PHP's trim does (String.trim would take no-break spaces too).
  const ends = (t: string) => t.replace(/^ +| +$/g, '');
  return ends(ends(text.replace(/[\u0000-\u001f\u007f<>{}]/g, ' ').replace(/ +/g, ' ')).slice(0, BUILD_LIMITS.sayLength));
}

/** The words a hotspot has the narrator say, or '' when it has them say nothing. */
export function hotspotSay(p: BuildPiece): string {
  return p.kind === 'hotspot' && typeof p.opens?.say === 'string' ? p.opens.say : '';
}

/** The uploads a piece shows: its own picture, and a hotspot's opened one. */
export function piecePictures(p: BuildPiece): number[] {
  const out: number[] = [];
  if ((p.kind === 'picture' || (p.kind === 'hotspot' && p.look === 'picture')) && p.upload_id != null) out.push(p.upload_id);
  if (p.kind === 'hotspot' && p.opens?.upload_id != null) out.push(p.opens.upload_id);
  return out;
}

/** The building's pieces a piece shows: a sticker's, and a hotspot's look and opened picture. */
export function pieceMedia(p: BuildPiece): Id[] {
  const out: Id[] = [];
  if ((p.kind === 'sticker' || (p.kind === 'hotspot' && p.look === 'sticker')) && p.media_id != null) out.push(p.media_id);
  if (p.kind === 'hotspot' && p.opens?.media_id != null) out.push(p.opens.media_id);
  return out;
}

/**
 * A build's pieces once one of the student's pictures is removed: a picture that showed it goes;
 * a hotspot that looked like it, too; a hotspot that opened it opens only its words, or goes when
 * it had none.
 */
export function withoutUpload(pieces: BuildPiece[], uploadId: number): BuildPiece[] {
  return pieces.flatMap((p) => {
    if (p.kind === 'picture' && p.upload_id === uploadId) return [];
    if (p.kind !== 'hotspot') return [p];
    if (p.look === 'picture' && p.upload_id === uploadId) return [];
    if (p.opens?.upload_id !== uploadId) return [p];
    const { upload_id: _gone, ...opens } = p.opens;
    return opens.text || opens.say ? [{ ...p, opens }] : [];
  });
}

/** A new piece id: 8 lowercase letters and digits. */
export function newPieceId(): string {
  let id = '';
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

/**
 * What is wrong with a build, as sentences for the student; none when it may be saved.
 * `uploads`: the ids of the student's own uploads in this instance.
 */
export function buildProblems(rules: BuildingRules, size: { width: number; height: number }, pieces: BuildPiece[], uploads: Iterable<number>): string[] {
  const problems: string[] = [];
  const own = new Set(uploads);
  if (pieces.length > rules.maxPieces) problems.push(`You can add up to ${rules.maxPieces} things here.`);
  const ids = new Set<string>();
  pieces.forEach((p, i) => {
    const which = `Thing ${i + 1}`;
    if (typeof p.id !== 'string' || !/^[a-z0-9]{1,16}$/.test(p.id) || ids.has(p.id)) problems.push(`${which} has a bad id.`);
    ids.add(p.id);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > size.width || p.y > size.height) problems.push(`${which} is outside the scene.`);
    const scale = p.scale ?? 1;
    if (!Number.isFinite(scale) || scale < BUILD_LIMITS.minScale || scale > BUILD_LIMITS.maxScale) problems.push(`${which} is too big or too small.`);
    const angle = p.angle ?? 0;
    if (!Number.isFinite(angle) || angle < -180 || angle > 180) problems.push(`${which} is turned too far.`);
    if (p.kind === 'sticker') {
      if (!rules.tools.includes('place')) problems.push('Placing pieces is not allowed here.');
      else if (p.media_id == null || !rules.pieces.some((id) => String(id) === String(p.media_id))) problems.push(`${which} is not one of this scene's pieces.`);
    } else if (p.kind === 'label') {
      if (!rules.tools.includes('label')) problems.push('Labels are not allowed here.');
      else if (typeof p.text !== 'string' || !cleanLabel(p.text) || cleanLabel(p.text) !== p.text) problems.push(`${which} needs words (up to ${BUILD_LIMITS.labelLength} letters).`);
      if (p.color != null && !LABEL_COLORS.includes(p.color)) problems.push(`${which} has a colour that is not offered.`);
    } else if (p.kind === 'picture') {
      if (!rules.tools.includes('picture')) problems.push('Pictures are not allowed here.');
      else if (p.upload_id == null || !own.has(p.upload_id)) problems.push(`${which} is not one of your pictures.`);
    } else if (p.kind === 'hotspot') {
      if (!rules.tools.includes('hotspot')) problems.push('Hotspots are not allowed here.');
      else problems.push(...hotspotProblems(rules, p, own, which));
    } else {
      problems.push(`${which} is not something you can add.`);
    }
  });
  return [...new Set(problems)];
}

function hotspotProblems(rules: BuildingRules, p: BuildPiece, own: Set<number>, which: string): string[] {
  const problems: string[] = [];
  const piece = (id: unknown) => id != null && rules.pieces.some((m) => String(m) === String(id));
  const look = p.look ?? 'none';
  if (look === 'sticker') {
    if (!piece(p.media_id)) problems.push(`${which} does not look like one of this scene's pieces.`);
  } else if (look === 'picture') {
    if (p.upload_id == null || !own.has(p.upload_id)) problems.push(`${which} does not look like one of your pictures.`);
  } else if (look === 'label') {
    if (typeof p.text !== 'string' || !cleanLabel(p.text) || cleanLabel(p.text) !== p.text) problems.push(`${which} needs words (up to ${BUILD_LIMITS.labelLength} letters).`);
    if (p.color != null && !LABEL_COLORS.includes(p.color)) problems.push(`${which} has a colour that is not offered.`);
  } else if (look !== 'none') {
    problems.push(`${which} has a look that is not offered.`);
  }
  const o = p.opens;
  const nothing = `${which} needs words or a picture to open, or something for the narrator to say.`;
  if (!o || typeof o !== 'object') return [...problems, nothing];
  const text = o.text;
  if (text != null && (typeof text !== 'string' || cleanNote(text) !== text)) problems.push(`${which} opens words that are too long (up to ${BUILD_LIMITS.noteLength} letters) or have < or > in them.`);
  if (o.media_id != null && o.upload_id != null) problems.push(`${which} can open one picture.`);
  else if (o.media_id != null && !piece(o.media_id)) problems.push(`${which} opens a picture that is not one of this scene's pieces.`);
  else if (o.upload_id != null && !own.has(o.upload_id)) problems.push(`${which} opens a picture that is not one of yours.`);
  const say = o.say;
  if (say != null && (typeof say !== 'string' || cleanSay(say) !== say)) problems.push(`${which} has the narrator say words that are too long (up to ${BUILD_LIMITS.sayLength} letters) or have < > { or } in them.`);
  if (!text && !say && o.media_id == null && o.upload_id == null) problems.push(nothing);
  return problems;
}

/** Only the fields a piece of its kind keeps, rounded: what is saved. */
export function tidyPiece(p: BuildPiece): BuildPiece {
  const out: BuildPiece = { id: p.id, kind: p.kind, x: Math.round(p.x), y: Math.round(p.y) };
  const scale = Math.round((p.scale ?? 1) * 100) / 100;
  if (scale !== 1) out.scale = scale;
  const angle = Math.round(p.angle ?? 0);
  if (angle !== 0) out.angle = angle;
  if (p.kind === 'sticker') out.media_id = p.media_id;
  if (p.kind === 'picture') out.upload_id = p.upload_id;
  if (p.kind === 'label') {
    out.text = cleanLabel(p.text ?? '');
    if (p.color && p.color !== LABEL_COLORS[0]) out.color = p.color;
  }
  if (p.kind === 'hotspot') {
    const look = p.look ?? 'none';
    if (look !== 'none') out.look = look;
    if (look === 'sticker') out.media_id = p.media_id;
    if (look === 'picture') out.upload_id = p.upload_id;
    if (look === 'label') {
      out.text = cleanLabel(p.text ?? '');
      if (p.color && p.color !== LABEL_COLORS[0]) out.color = p.color;
    }
    const opens: HotspotOpens = {};
    const text = cleanNote(p.opens?.text ?? '');
    if (text) opens.text = text;
    if (p.opens?.media_id != null) opens.media_id = p.opens.media_id;
    else if (p.opens?.upload_id != null) opens.upload_id = p.opens.upload_id;
    const say = cleanSay(p.opens?.say ?? '');
    if (say) opens.say = say;
    out.opens = opens;
  }
  return out;
}
