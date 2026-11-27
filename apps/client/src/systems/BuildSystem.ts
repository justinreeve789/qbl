import type * as Phaser from 'phaser';
import {
  BUILD_LIMITS, BUILD_LOOK, LABEL_COLORS, buildingRules, buildProblems, cleanLabel, newPieceId, resolveMediaUrl, tidyPiece,
  type BuildingRules, type BuildPiece, type SceneBuild,
} from '@qbl/shared';
import { mediaKey } from '../core/assets';
import { Depth } from '../core/depth';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import type { BuildPanelHandle } from '../ui/UiPort';

/** Texture key of a picture a student uploaded. */
export const uploadKey = (id: number) => `build-upload-${id}`;

/** Phaser.Input.Events.POINTER_DOWN (this file imports Phaser's types only). */
const POINTER_DOWN = 'pointerdown';

interface Editing {
  pieces: BuildPiece[];
  /** Earlier lists of pieces, for undo, and undone ones, for redo. */
  past: BuildPiece[][];
  future: BuildPiece[][];
  selected: string | null;
  panel: BuildPanelHandle;
  saving: boolean;
  /** How many pieces have been added this time: each new one lands a little apart from the last. */
  added: number;
}

/**
 * What students built in this scene, drawn over it as a layer of its own (see core/Builds.ts),
 * and the Build button and build mode for a scene whose author lets students build.
 *
 * The layer is an extra: nothing in it is part of the scene, nothing in the scene's events can
 * see it, and it never blocks walking. In build mode the player's own pieces can be picked,
 * dragged, resized and turned; walking and hotspots wait until the palette closes.
 */
export class BuildSystem implements SceneSystem {
  private rules: BuildingRules | null = null;
  private drawn: Array<Phaser.GameObjects.Image | Phaser.GameObjects.Text> = [];
  /** The player's own pieces while they build, by piece id. */
  private editable = new Map<string, Phaser.GameObjects.Image | Phaser.GameObjects.Text>();
  private outline: Phaser.GameObjects.Graphics | null = null;
  private editing: Editing | null = null;
  private unlisten: (() => void) | null = null;
  private loading = new Set<number>();

  constructor(private rt: SceneRuntime) {}

  create() {
    const builds = this.rt.ctx.builds;
    if (!builds) return;
    this.rules = buildingRules(this.rt.def);
    this.unlisten = builds.onChange(() => this.redraw());
    // Clicking where there is nothing of the player's lets go of what is picked.
    this.rt.scene.input.on(POINTER_DOWN, this.onPointerDown, this);
    this.redraw();
    // Entering a scene asks again, so approvals that came in meanwhile show.
    builds.refresh().catch(() => undefined);
  }

  /** True while the player builds: the palette is open. */
  get active(): boolean {
    return !!this.editing;
  }

  /** The pieces being edited (build mode), or null. */
  get pieces(): readonly BuildPiece[] | null {
    return this.editing?.pieces ?? null;
  }

  get selected(): string | null {
    return this.editing?.selected ?? null;
  }

  // --------------------------------------------------------------- drawing

  private redraw() {
    for (const o of this.drawn) o.destroy();
    this.drawn = [];
    this.editable.clear();
    const builds = this.rt.ctx.builds;
    if (!builds) return;
    for (const build of builds.shown(this.rt.def.id)) {
      if (build.mine && this.editing) continue;
      for (const piece of build.pieces) this.draw(piece, build, false);
    }
    if (this.editing) for (const piece of this.editing.pieces) this.draw(piece, null, true);
    this.drawOutline();
    this.showButton();
  }

  private draw(piece: BuildPiece, build: SceneBuild | null, editable: boolean) {
    const { scene } = this.rt;
    let object: Phaser.GameObjects.Image | Phaser.GameObjects.Text | null = null;
    const scale = piece.scale ?? 1;
    if (piece.kind === 'sticker' && piece.media_id != null) {
      const key = mediaKey(piece.media_id);
      if (!scene.textures.exists(key)) return;
      object = scene.add.image(piece.x, piece.y, key).setOrigin(0.5, 0.5).setScale(scale * this.rt.zoom).setDepth(piece.y);
    } else if (piece.kind === 'picture' && piece.upload_id != null) {
      const picture = this.rt.ctx.builds?.picture(piece.upload_id);
      if (!picture) return;
      const key = uploadKey(piece.upload_id);
      if (!scene.textures.exists(key)) {
        this.load(piece.upload_id, picture.url);
        return;
      }
      const fit = (BUILD_LOOK.pictureBox * scale) / Math.max(1, picture.width, picture.height);
      object = scene.add.image(piece.x, piece.y, key).setOrigin(0.5, 0.5).setScale(fit).setDepth(piece.y);
    } else if (piece.kind === 'label' && piece.text) {
      const color = piece.color ?? LABEL_COLORS[0]!;
      object = scene.add.text(piece.x, piece.y, piece.text, {
        fontFamily: 'Fredoka, system-ui, sans-serif',
        fontSize: `${Math.round(BUILD_LOOK.labelSize * scale)}px`,
        fontStyle: '600',
        color,
        stroke: dark(color) ? '#ffffff' : '#1f2937',
        strokeThickness: Math.max(3, Math.round(5 * scale)),
        align: 'center',
      }).setOrigin(0.5, 0.5).setDepth(Depth.label);
    }
    if (!object) return;
    object.setAngle(piece.angle ?? 0);
    // A build the teacher took down is shown faintly to its maker, so they know.
    if (build?.mine && build.status === 'hidden') object.setAlpha(0.45);
    if (editable) {
      this.editable.set(piece.id, object);
      object.setInteractive({ draggable: true, useHandCursor: true });
      object.on(POINTER_DOWN, () => this.select(piece.id));
      object.on('drag', (_p: unknown, x: number, y: number) => this.move(piece.id, x, y, false));
      object.on('dragend', () => this.move(piece.id, object!.x, object!.y, true));
    }
    this.drawn.push(object);
  }

  /** A box around what is picked. */
  private drawOutline() {
    this.outline?.destroy();
    this.outline = null;
    const id = this.editing?.selected;
    const object = id ? this.editable.get(id) : undefined;
    if (!object || typeof (object as { getBounds?: unknown }).getBounds !== 'function') return;
    const b = object.getBounds() as Phaser.Geom.Rectangle;
    if (b.width == null) return;
    this.outline = this.rt.scene.add.graphics().setDepth(Depth.debug - 1);
    this.outline.lineStyle(3, 0xfde047, 1).strokeRoundedRect(b.x - 6, b.y - 6, b.width + 12, b.height + 12, 8);
  }

  private load(uploadId: number, url: string) {
    if (this.loading.has(uploadId)) return;
    this.loading.add(uploadId);
    const { scene } = this.rt;
    const key = uploadKey(uploadId);
    scene.load.once(`filecomplete-image-${key}`, () => {
      this.loading.delete(uploadId);
      this.redraw();
    });
    scene.load.image(key, url);
    if (!scene.load.isLoading()) scene.load.start();
  }

  // --------------------------------------------------------------- the button

  private showButton() {
    const { ctx } = this.rt;
    if (!this.rules || !ctx.builds?.mayBuild || this.editing) {
      ctx.ui.buildButton(null, () => undefined);
      return;
    }
    ctx.ui.buildButton(ctx.builds.mine(this.rt.def.id) ? 'Change what you built' : 'Build here', () => this.open());
  }

  // --------------------------------------------------------------- build mode

  /** Open the palette, starting from what the player built here before. */
  open() {
    const { ctx } = this.rt;
    const rules = this.rules;
    if (!rules || !ctx.builds?.mayBuild || this.editing || this.rt.leaving) return;
    const saved = ctx.builds.mine(this.rt.def.id);
    const pieces = (saved?.pieces ?? []).map((p) => ({ ...p }));
    const panel = ctx.ui.buildPanel({
      prompt: rules.prompt,
      tools: rules.tools,
      pieces: rules.pieces.flatMap((id) => {
        const media = ctx.index.media.get(id);
        const url = media ? resolveMediaUrl(ctx.scenario, media) : null;
        return url ? [{ mediaId: id, url, name: media?.filename ?? `Piece ${id}` }] : [];
      }),
      colors: LABEL_COLORS,
      maxPieces: rules.maxPieces,
      approve: rules.approve,
      shared: rules.share === 'instance',
    }, {
      addSticker: (mediaId) => this.add({ kind: 'sticker', media_id: mediaId }),
      addLabel: (text, color) => {
        const words = cleanLabel(text);
        if (words) this.add({ kind: 'label', text: words, ...(color !== LABEL_COLORS[0] ? { color } : {}) });
      },
      addPicture: (uploadId) => this.add({ kind: 'picture', upload_id: uploadId }),
      upload: async (file) => {
        if (file.size > BUILD_LIMITS.uploadBytes) throw new Error(`That picture is too big. Pictures can be up to ${BUILD_LIMITS.uploadBytes >> 20} MB.`);
        const up = await ctx.builds!.upload(file);
        this.add({ kind: 'picture', upload_id: up.id });
      },
      removePicture: async (uploadId) => {
        await ctx.builds!.removeUpload(uploadId);
        if (this.editing) this.editing.pieces = this.editing.pieces.filter((p) => p.upload_id !== uploadId);
        this.refresh();
      },
      resize: (factor) => this.change((p) => ({ ...p, scale: clamp((p.scale ?? 1) * factor, BUILD_LIMITS.minScale, BUILD_LIMITS.maxScale) })),
      turn: (degrees) => this.change((p) => ({ ...p, angle: wrapAngle((p.angle ?? 0) + degrees) })),
      relabel: (text, color) => {
        const words = cleanLabel(text);
        if (words) this.change((p) => (p.kind === 'label' ? { ...p, text: words, color } : p));
      },
      remove: () => {
        const id = this.editing?.selected;
        if (id) this.commit(this.editing!.pieces.filter((p) => p.id !== id), null);
      },
      undo: () => this.history(-1),
      redo: () => this.history(1),
      clear: () => this.commit([], null),
      done: () => void this.done(),
      cancel: () => this.close(),
    });
    this.editing = { pieces, past: [], future: [], selected: null, panel, saving: false, added: 0 };
    this.redraw();
    this.refresh();
  }

  /** Put a new piece where the player is looking, a little apart from the last one added. */
  private add(fields: Omit<BuildPiece, 'id' | 'x' | 'y'>) {
    const e = this.editing;
    if (!e) return;
    if (e.pieces.length >= (this.rules?.maxPieces ?? 0)) {
      this.rt.ctx.ui.toast(`You can add up to ${this.rules?.maxPieces} things here.`);
      return;
    }
    const view = this.rt.scene.cameras.main.worldView;
    const { width, height } = this.rt.size;
    const cx = view.x + view.width / 2;
    const cy = view.y + view.height / 2;
    const step = (e.added++ % 6) * 28;
    const x = clamp((Number.isFinite(cx) ? cx : width / 2) - 84 + step, 0, width);
    const y = clamp((Number.isFinite(cy) ? cy : height / 2) - 84 + step, 0, height);
    const piece: BuildPiece = { id: newPieceId(), x, y, ...fields };
    this.commit([...e.pieces, piece], piece.id);
  }

  /** Change the picked piece. */
  private change(fn: (p: BuildPiece) => BuildPiece) {
    const e = this.editing;
    if (!e?.selected) return;
    this.commit(e.pieces.map((p) => (p.id === e.selected ? fn(p) : p)), e.selected);
  }

  /** Move a piece. While dragging only the drawing follows; letting go keeps the move (one step to undo). */
  move(id: string, x: number, y: number, settle: boolean) {
    const e = this.editing;
    if (!e) return;
    const nx = clamp(x, 0, this.rt.size.width);
    const ny = clamp(y, 0, this.rt.size.height);
    if (!settle) {
      const object = this.editable.get(id);
      object?.setPosition(nx, ny);
      if (object && e.pieces.find((p) => p.id === id)?.kind !== 'label') object.setDepth(ny);
      this.outline?.destroy();
      this.outline = null;
      return;
    }
    const before = e.pieces.find((p) => p.id === id);
    if (!before || (Math.round(before.x) === Math.round(nx) && Math.round(before.y) === Math.round(ny))) {
      this.redraw();
      return;
    }
    this.commit(e.pieces.map((p) => (p.id === id ? { ...p, x: nx, y: ny } : p)), id);
  }

  select(id: string | null) {
    if (!this.editing) return;
    this.editing.selected = id;
    this.drawOutline();
    this.refresh();
  }

  private onPointerDown(_pointer: unknown, over: unknown[]) {
    if (this.editing && (!Array.isArray(over) || over.length === 0)) this.select(null);
  }

  private commit(next: BuildPiece[], selected: string | null) {
    const e = this.editing;
    if (!e) return;
    e.past.push(e.pieces);
    if (e.past.length > 100) e.past.shift();
    e.future = [];
    e.pieces = next;
    e.selected = selected;
    this.redraw();
    this.refresh();
  }

  private history(direction: -1 | 1) {
    const e = this.editing;
    if (!e) return;
    const from = direction < 0 ? e.past : e.future;
    const to = direction < 0 ? e.future : e.past;
    const pieces = from.pop();
    if (!pieces) return;
    to.push(e.pieces);
    e.pieces = pieces;
    if (e.selected && !pieces.some((p) => p.id === e.selected)) e.selected = null;
    this.redraw();
    this.refresh();
  }

  /** Tell the palette how things stand. */
  private refresh() {
    const e = this.editing;
    if (!e) return;
    const picked = e.pieces.find((p) => p.id === e.selected);
    e.panel.update({
      count: e.pieces.length,
      selected: picked ? { kind: picked.kind, text: picked.text, color: picked.color } : null,
      canUndo: e.past.length > 0,
      canRedo: e.future.length > 0,
      saving: e.saving,
      status: this.rt.ctx.builds?.mine(this.rt.def.id)?.status ?? null,
      pictures: this.rt.ctx.builds?.uploads ?? [],
    });
  }

  /** Keep what was built, if it keeps to the scene's rules, and close the palette. */
  async done(): Promise<void> {
    const e = this.editing;
    const builds = this.rt.ctx.builds;
    const rules = this.rules;
    if (!e || !builds || !rules || e.saving) return;
    const pieces = e.pieces.map(tidyPiece);
    const problems = buildProblems(rules, this.rt.size, pieces, builds.uploads.map((u) => u.id));
    if (problems.length) {
      this.rt.ctx.ui.toast(problems[0]!, 4000);
      return;
    }
    e.saving = true;
    this.refresh();
    try {
      const saved = await builds.save(this.rt.def.id, pieces);
      this.close();
      this.rt.ctx.ui.toast(
        !saved ? 'You cleared what you built here.'
          : saved.status === 'pending' ? 'Saved! Your teacher will look at it before others see it.'
          : rules.share === 'instance' ? 'Saved! Everyone here can see it now.'
          : 'Saved! You and your teacher can see it.',
        4000,
      );
    } catch (err) {
      if (this.editing) {
        this.editing.saving = false;
        this.refresh();
      }
      this.rt.ctx.ui.toast(err instanceof Error ? err.message : 'Could not save what you built.', 4000);
    }
  }

  /** Close the palette without saving: what was saved before shows again. */
  close() {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    e.panel.close();
    this.redraw();
  }

  destroy() {
    this.close();
    this.unlisten?.();
    this.unlisten = null;
    for (const o of this.drawn) o.destroy();
    this.drawn = [];
    this.editable.clear();
    this.outline?.destroy();
    this.outline = null;
    this.rt.ctx.ui.buildButton(null, () => undefined);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function wrapAngle(a: number): number {
  const w = ((((a + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

/** A dark colour needs a light outline to be read. */
function dark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
}

