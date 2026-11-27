import type { Id, Scene } from './types.js';

/**
 * Student building: a scene whose author allows it lets players add things of their own on top of
 * it (stickers, labels, their own pictures), from a Build button in the game.
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
export type BuildTool = 'place' | 'label' | 'picture';
export const BUILD_TOOLS: readonly BuildTool[] = ['place', 'label', 'picture'];

/** `scene.building`: the author's settings, kept in the scene's params. */
export interface SceneBuilding {
  enabled?: boolean;
  /** Default: place and label. `picture`: students may hang pictures they upload. */
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

/** One thing a student added. Positions are in scene pixels; `x, y` is the thing's centre. */
export interface BuildPiece {
  id: string;
  kind: 'sticker' | 'label' | 'picture';
  x: number;
  y: number;
  /** 1: the picture's own size (a label: its normal size). */
  scale?: number;
  /** Degrees, clockwise. */
  angle?: number;
  /** sticker: one of the building's pieces. */
  media_id?: Id;
  /** picture: one of the student's own uploads. */
  upload_id?: number;
  /** label: its words. */
  text?: string;
  /** label: one of LABEL_COLORS. */
  color?: string;
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
} as const;

/**
 * How big things are drawn, the same in the game and in the teacher's preview: a sticker at its
 * picture's own size times `scale` (and the scene's zoom), an uploaded picture fitted into a square
 * of `pictureBox` pixels times `scale`, and a label's letters `labelSize` pixels high times `scale`.
 */
export const BUILD_LOOK = { pictureBox: 360, labelSize: 30 } as const;

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
    } else {
      problems.push(`${which} is not something you can add.`);
    }
  });
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
  return out;
}
