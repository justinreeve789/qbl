import type * as Phaser from 'phaser';
import {
  BUILD_LIMITS, BUILD_LOOK, LABEL_COLORS, buildingRules, buildProblems, cleanLabel, cleanNote, cleanSay, hotspotSay, newPieceId, resolveMediaUrl,
  tidyPiece, withoutUpload, type BuildingRules, type BuildPiece, type SceneBuild,
} from '@qbl/shared';
import { mediaKey } from '../core/assets';
import { Depth } from '../core/depth';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import type { BuildPanelHandle, HotspotFields, SpeakOptions } from '../ui/UiPort';

type Drawn = Phaser.GameObjects.Image | Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle;

/** Texture key of a picture a student uploaded. */
export const uploadKey = (id: number) => `build-upload-${id}`;

/** Phaser.Input.Events.POINTER_DOWN (this file imports Phaser's types only). */
const POINTER_DOWN = 'pointerdown';

interface Editing {
  /** A teacher changes a student's build (null: the player's own). */
  target: SceneBuild | null;
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
 *
 * A hotspot a student added opens its words and picture when anyone clicks it (outside build
 * mode), after the narrator says what it has them say, in the story box (in the narrator's
 * recorded voice once the server has recorded it); a click on one is not a click to walk. A teacher sees all their students' builds and can
 * change any of them from the same palette (`whose`).
 */
export class BuildSystem implements SceneSystem {
  /** A failure to load builds has been shown on screen in this game already. */
  private static told = false;
  private rules: BuildingRules | null = null;
  private drawn: Drawn[] = [];
  /** The pieces being edited while the palette is open, by piece id. */
  private editable = new Map<string, Drawn>();
  /** How many hotspots the pointer is over: a click there opens one instead of walking. */
  private pointerOver = 0;
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
    // Entering a scene asks again, so approvals that came in meanwhile show. Where the scene lets
    // the player build, a failure is said once, rather than the Build button silently not coming.
    builds.refresh().then(() => this.arrive(), (err) => {
      console.warn('[qbl] could not load what students built here:', err);
      if (this.rules && !BuildSystem.told) {
        BuildSystem.told = true;
        this.rt.ctx.ui.toast(`Building is not available right now${err instanceof Error && err.message ? `: ${err.message}` : '.'}`, 5000);
      }
    });
  }

  /** A teacher came to change a student's build here (?edit_build=): open it. */
  private arrive() {
    const builds = this.rt.ctx.builds;
    const id = builds?.openOnArrival;
    if (!builds || id == null) return;
    const build = builds.byId(id);
    if (!build || String(build.scene_id) !== String(this.rt.def.id)) return;
    builds.openOnArrival = null;
    if (!build.editable) {
      this.rt.ctx.ui.toast('You cannot change that build here.', 4000);
      return;
    }
    this.open(build.id);
  }

  /** True while the pointer is over a hotspot someone built; a click is then left to it. */
  get hovering(): boolean {
    return this.pointerOver > 0 && !this.editing;
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
    this.pointerOver = 0;
    const builds = this.rt.ctx.builds;
    if (!builds) return;
    const e = this.editing;
    for (const build of builds.shown(this.rt.def.id)) {
      // The build being changed is drawn from the palette's pieces instead.
      if (e && (e.target ? build.id === e.target.id : build.mine)) continue;
      for (const piece of build.pieces) this.draw(piece, build, false);
    }
    if (this.editing) for (const piece of this.editing.pieces) this.draw(piece, null, true);
    this.drawOutline();
    this.showButton();
  }

  private draw(piece: BuildPiece, build: SceneBuild | null, editable: boolean) {
    const { scene } = this.rt;
    let object: Drawn | null = null;
    const scale = piece.scale ?? 1;
    if (piece.kind === 'hotspot') {
      object = this.drawHotspot(piece, editable);
    } else if (piece.kind === 'sticker' && piece.media_id != null) {
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
    // A build the teacher took down is shown faintly to its maker (and the teacher), so they know.
    if ((build?.mine || build?.editable) && build.status === 'hidden') object.setAlpha(0.45);
    if (editable) {
      this.editable.set(piece.id, object);
      object.setInteractive({ draggable: true, useHandCursor: true });
      object.on(POINTER_DOWN, () => this.select(piece.id));
      object.on('drag', (_p: unknown, x: number, y: number) => this.move(piece.id, x, y, false));
      object.on('dragend', () => this.move(piece.id, object!.x, object!.y, true));
    } else if (piece.kind === 'hotspot') {
      object.setInteractive({ useHandCursor: true });
      object.on('pointerover', () => this.pointerOver++);
      object.on('pointerout', () => (this.pointerOver = Math.max(0, this.pointerOver - 1)));
      object.on(POINTER_DOWN, () => this.openHotspot(piece, build));
    }
    this.drawn.push(object);
  }

  /**
   * A hotspot as it looks: a piece, a picture or words like the other kinds, or for one that looks
   * like nothing, an invisible square (in build mode a dashed one, so it can be found and dragged).
   */
  private drawHotspot(piece: BuildPiece, editable: boolean): Drawn | null {
    const { scene } = this.rt;
    const look = piece.look ?? 'none';
    if (look !== 'none') {
      const kind = look === 'sticker' ? 'sticker' : look === 'picture' ? 'picture' : 'label';
      // Drawn as its look, by the same code; the object comes back as the last one drawn.
      const before = this.drawn.length;
      this.draw({ ...piece, kind, look: undefined, opens: undefined }, null, false);
      const object = this.drawn.length > before ? this.drawn.pop()! : null;
      // A look that cannot be drawn (a picture still loading) leaves an invisible hotspot meanwhile.
      if (object) return object;
    }
    const side = BUILD_LOOK.hotspotBox * (piece.scale ?? 1);
    const box = scene.add.rectangle(piece.x, piece.y, side, side).setOrigin(0.5, 0.5).setDepth(Depth.label - 1);
    if (editable) {
      box.setFillStyle(0xfde047, 0.18);
      box.setStrokeStyle(3, 0xfde047, 0.9);
    }
    return box;
  }

  /** Open what a hotspot shows: what the narrator says, in the story box, then its words and picture, in a box. */
  openHotspot(piece: BuildPiece, build: SceneBuild | null = null) {
    const { ctx } = this.rt;
    if (this.editing || ctx.ui.capturesInput || this.rt.leaving || this.showing) return;
    void this.show(piece, build);
  }

  /** A hotspot's narration and box are on screen (or on their way). */
  private showing = false;

  private async show(piece: BuildPiece, build: SceneBuild | null) {
    const { ctx } = this.rt;
    const url = this.openedPicture(piece);
    const text = piece.opens?.text ?? '';
    const say = hotspotSay(piece);
    if (!text && !url && !say) return;
    this.showing = true;
    try {
      if (say) await ctx.ui.portraitDialogue(say, { narrator: true, duration: 0, speak: this.narratorSpeech(piece, build) }).done;
      if ((text || url) && !this.rt.leaving) {
        await ctx.ui.infobox(noteHtml(text), [], { dismissible: true, hero: url ? { url, type: 'image' } : null, size: text ? null : 'large' }).choice;
      }
    } finally {
      this.showing = false;
    }
  }

  /**
   * How the narrator reads a hotspot's words: the server's recording of them when it has one of
   * these very words (a hotspot changed since it was kept has none yet), else the browser's voice.
   */
  private narratorSpeech(piece: BuildPiece, build: SceneBuild | null): SpeakOptions {
    const { scenario } = this.rt.ctx;
    const voice = build?.voices?.[piece.id];
    const current = voice && voice.speech.line === hotspotSay(piece);
    return { lang: scenario.default_language, ...(current ? { audioUrl: voice.url, timings: voice.speech } : {}) };
  }

  private openedPicture(piece: BuildPiece): string | null {
    const { ctx } = this.rt;
    const o = piece.opens;
    if (o?.media_id != null) {
      const media = ctx.index.media.get(o.media_id);
      return media ? resolveMediaUrl(ctx.scenario, media) : null;
    }
    if (o?.upload_id != null) return ctx.builds?.picture(o.upload_id)?.url ?? null;
    return null;
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
    const label = ctx.builds.others(this.rt.def.id).length ? 'Builds here'
      : ctx.builds.mine(this.rt.def.id) ? 'Change what you built' : 'Build here';
    ctx.ui.buildButton(label, () => this.open());
  }

  // --------------------------------------------------------------- build mode

  /**
   * Open the palette, starting from what the player built here before; for a teacher, `buildId`
   * opens one of their students' builds instead.
   */
  open(buildId: number | null = null) {
    const { ctx } = this.rt;
    const rules = this.rules;
    if (!rules || !ctx.builds?.mayBuild || this.editing || this.rt.leaving) return;
    const others = ctx.builds.others(this.rt.def.id);
    const target = buildId != null ? others.find((b) => b.id === buildId) ?? null : null;
    const saved = target ?? ctx.builds.mine(this.rt.def.id);
    const pieces = (saved?.pieces ?? []).map((p) => ({ ...p }));
    const mine = ctx.builds.mine(this.rt.def.id);
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
      ...(others.length ? {
        whose: [
          { id: null, name: 'Yours', status: mine?.status ?? null },
          ...others.map((b) => ({ id: b.id, name: b.author, status: b.status })),
        ],
      } : {}),
    }, {
      addSticker: (mediaId) => this.add({ kind: 'sticker', media_id: mediaId }),
      addLabel: (text, color) => {
        const words = cleanLabel(text);
        if (words) this.add({ kind: 'label', text: words, ...(color !== LABEL_COLORS[0] ? { color } : {}) });
      },
      addPicture: (uploadId) => this.add({ kind: 'picture', upload_id: uploadId }),
      addHotspot: (fields) => this.add({ kind: 'hotspot', ...hotspotFields(fields) }),
      upload: async (file) => {
        if (this.editing?.target) throw new Error('Only the student can upload pictures for their build.');
        if (file.size > BUILD_LIMITS.uploadBytes) throw new Error(`That picture is too big. Pictures can be up to ${BUILD_LIMITS.uploadBytes >> 20} MB.`);
        const up = await ctx.builds!.upload(file);
        this.refresh();
        return up;
      },
      removePicture: async (uploadId) => {
        if (this.editing?.target) throw new Error('Only the student can remove their pictures.');
        await ctx.builds!.removeUpload(uploadId);
        if (this.editing) this.editing.pieces = withoutUpload(this.editing.pieces, uploadId);
        this.redraw();
        this.refresh();
      },
      resize: (factor) => this.change((p) => ({ ...p, scale: clamp((p.scale ?? 1) * factor, BUILD_LIMITS.minScale, BUILD_LIMITS.maxScale) })),
      turn: (degrees) => this.change((p) => ({ ...p, angle: wrapAngle((p.angle ?? 0) + degrees) })),
      relabel: (text, color) => {
        const words = cleanLabel(text);
        if (words) this.change((p) => (p.kind === 'label' ? { ...p, text: words, color } : p));
      },
      rehotspot: (fields) => this.change((p) => (p.kind === 'hotspot' ? { id: p.id, kind: p.kind, x: p.x, y: p.y, scale: p.scale, angle: p.angle, ...hotspotFields(fields) } : p)),
      tryHotspot: () => {
        const e = this.editing;
        const picked = e?.pieces.find((p) => p.id === e.selected);
        if (!picked || picked.kind !== 'hotspot') return;
        // The palette is modal, so this opens over it rather than through openHotspot. The build
        // as it was kept may have the narrator's recording of these words already.
        if (this.showing) return;
        const saved = e!.target ?? ctx.builds?.mine(this.rt.def.id) ?? null;
        void this.show(picked, saved);
      },
      switchTo: (id) => this.switchTo(id),
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
    this.editing = { target, pieces, past: [], future: [], selected: null, panel, saving: false, added: 0 };
    this.redraw();
    this.refresh();
  }

  /** For a teacher: change another build here (null: their own), once what was changed is kept or undone. */
  switchTo(buildId: number | null) {
    const e = this.editing;
    const builds = this.rt.ctx.builds;
    if (!e || !builds || e.saving) return;
    if ((e.target?.id ?? null) === buildId) return;
    if (e.past.length) {
      this.rt.ctx.ui.toast('Press Done to keep your changes, or Undo them, before you change another build.', 4000);
      this.refresh();
      return;
    }
    const target = buildId != null ? builds.others(this.rt.def.id).find((b) => b.id === buildId) ?? null : null;
    if (buildId != null && !target) return;
    const saved = target ?? builds.mine(this.rt.def.id);
    Object.assign(e, { target, pieces: (saved?.pieces ?? []).map((p) => ({ ...p })), past: [], future: [], selected: null, added: 0 });
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
    if (fields.kind === 'hotspot' && !fields.opens?.text && !fields.opens?.say && fields.opens?.media_id == null && fields.opens?.upload_id == null) {
      this.rt.ctx.ui.toast('Give the hotspot words or a picture to show, or something for the narrator to say.');
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
      const piece = e.pieces.find((p) => p.id === id);
      if (object && piece && piece.kind !== 'label' && !(piece.kind === 'hotspot' && (piece.look ?? 'none') !== 'sticker' && piece.look !== 'picture')) object.setDepth(ny);
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
    const builds = this.rt.ctx.builds;
    e.panel.update({
      count: e.pieces.length,
      selected: picked ? { ...picked } : null,
      canUndo: e.past.length > 0,
      canRedo: e.future.length > 0,
      saving: e.saving,
      status: e.target ? (builds?.byId(e.target.id)?.status ?? e.target.status) : (builds?.mine(this.rt.def.id)?.status ?? null),
      pictures: this.pictures(),
      canUpload: !e.target,
      editingFor: e.target ? { id: e.target.id, name: e.target.author } : null,
    });
  }

  /** The pictures the build being changed may show: the player's own, or its student's. */
  private pictures() {
    const e = this.editing;
    return (e?.target ? e.target.uploads : this.rt.ctx.builds?.uploads) ?? [];
  }

  /** Keep what was built, if it keeps to the scene's rules, and close the palette. */
  async done(): Promise<void> {
    const e = this.editing;
    const builds = this.rt.ctx.builds;
    const rules = this.rules;
    if (!e || !builds || !rules || e.saving) return;
    const pieces = e.pieces.map(tidyPiece);
    const problems = buildProblems(rules, this.rt.size, pieces, this.pictures().map((u) => u.id));
    if (problems.length) {
      this.rt.ctx.ui.toast(problems[0]!, 4000);
      return;
    }
    e.saving = true;
    this.refresh();
    try {
      if (e.target) {
        const saved = await builds.saveOther(e.target, pieces);
        this.close();
        this.rt.ctx.ui.toast(saved ? `Saved your changes to ${e.target.author}’s build.` : `${e.target.author}’s build is deleted.`, 4000);
        return;
      }
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
    this.pointerOver = 0;
    this.rt.ctx.ui.buildButton(null, () => undefined);
  }
}

/** A hotspot's look and what it opens, with only the fields its look keeps. */
function hotspotFields(f: HotspotFields): Omit<BuildPiece, 'id' | 'x' | 'y' | 'kind'> {
  const out: Omit<BuildPiece, 'id' | 'x' | 'y' | 'kind'> = { look: f.look, opens: {} };
  if (f.look === 'sticker') out.media_id = f.media_id;
  if (f.look === 'picture') out.upload_id = f.upload_id;
  if (f.look === 'label') {
    out.text = cleanLabel(f.text ?? '');
    if (f.color && f.color !== LABEL_COLORS[0]) out.color = f.color;
  }
  const text = cleanNote(f.opens.text ?? '');
  if (text) out.opens!.text = text;
  if (f.opens.media_id != null) out.opens!.media_id = f.opens.media_id;
  else if (f.opens.upload_id != null) out.opens!.upload_id = f.opens.upload_id;
  const say = cleanSay(f.opens.say ?? '');
  if (say) out.opens!.say = say;
  return out;
}

/** A hotspot's words as the box shows them: paragraphs at blank lines, line breaks kept, nothing else. */
export function noteHtml(text: string): string {
  const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return text.split(/\n{2,}/).filter((p) => p.trim()).map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('');
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

