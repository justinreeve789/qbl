import { withoutUpload, type BuildPiece, type BuildUpload, type Id, type SceneBuild } from '@qbl/shared';

/** Where builds are kept: the API (App\Qbl\Builds), or in memory for a preview or offline play. */
export interface BuildBackend {
  load(): Promise<{ may_build: boolean; builds: SceneBuild[]; uploads: BuildUpload[]; pictures: Record<string, Omit<BuildUpload, 'id'>> }>;
  save(sceneId: Id, pieces: BuildPiece[]): Promise<SceneBuild | null>;
  upload(file: File): Promise<BuildUpload>;
  removeUpload(id: number): Promise<void>;
  /** A teacher changes a student's build (absent: no one here can). */
  saveOther?(buildId: number, pieces: BuildPiece[]): Promise<SceneBuild | null>;
}

/** How long what was fetched is trusted before entering a scene asks again (approvals come in meanwhile). */
const FRESH_MS = 15_000;

/**
 * What students have built in this game, as this player may see it: their own builds, whatever
 * their state, and others' approved ones; and the pictures this player uploaded for building.
 * Session-long, on GameContext as `builds`; BuildSystem draws it in each scene and edits the player's own.
 */
export class Builds {
  mayBuild = false;
  /** For a teacher: a student's build to open for changing once its scene is entered (then cleared). */
  openOnArrival: number | null = null;
  private list: SceneBuild[] = [];
  private own: BuildUpload[] = [];
  private shownPictures = new Map<number, Omit<BuildUpload, 'id'>>();
  private fetchedAt = 0;
  private fetching: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  constructor(private backend: BuildBackend) {}

  /** Ask again for what is built, unless it was fetched a moment ago. */
  refresh(force = false): Promise<void> {
    if (this.fetching) return this.fetching;
    if (!force && this.fetchedAt && performance.now() - this.fetchedAt < FRESH_MS) return Promise.resolve();
    this.fetching = this.backend.load().then(
      (data) => {
        this.mayBuild = data.may_build;
        this.list = data.builds;
        this.own = data.uploads;
        this.shownPictures = new Map(Object.entries(data.pictures ?? {}).map(([id, p]) => [Number(id), p]));
        this.fetchedAt = performance.now();
        this.fetching = null;
        this.changed();
      },
      (e) => {
        this.fetching = null;
        throw e;
      },
    );
    return this.fetching;
  }

  /** The builds shown in a scene, oldest first. */
  shown(sceneId: Id): SceneBuild[] {
    return this.list.filter((b) => String(b.scene_id) === String(sceneId));
  }

  mine(sceneId: Id): SceneBuild | undefined {
    return this.list.find((b) => b.mine && String(b.scene_id) === String(sceneId));
  }

  /** Others' builds in a scene that this player may change: they are their makers' teacher. */
  others(sceneId: Id): SceneBuild[] {
    return this.shown(sceneId).filter((b) => !b.mine && b.editable);
  }

  byId(id: number): SceneBuild | undefined {
    return this.list.find((b) => b.id === id);
  }

  get uploads(): readonly BuildUpload[] {
    return this.own;
  }

  /** An uploaded picture by id: one of this player's, or one an approved build shows. */
  picture(id: number): Omit<BuildUpload, 'id'> | undefined {
    return this.own.find((u) => u.id === id) ?? this.shownPictures.get(id) ?? this.list.flatMap((b) => b.uploads ?? []).find((u) => u.id === id);
  }

  /** A teacher keeps their change to a student's build. */
  async saveOther(build: SceneBuild, pieces: BuildPiece[]): Promise<SceneBuild | null> {
    if (!this.backend.saveOther) throw new Error('Builds cannot be changed here.');
    const saved = await this.backend.saveOther(build.id, pieces);
    this.list = this.list.flatMap((b) => (b.id !== build.id ? [b] : saved ? [{ ...b, ...saved, mine: false, editable: true, uploads: b.uploads }] : []));
    this.changed();
    return saved;
  }

  async save(sceneId: Id, pieces: BuildPiece[]): Promise<SceneBuild | null> {
    const saved = await this.backend.save(sceneId, pieces);
    this.list = this.list.filter((b) => !(b.mine && String(b.scene_id) === String(sceneId)));
    if (saved) this.list.push(saved);
    this.changed();
    return saved;
  }

  async upload(file: File): Promise<BuildUpload> {
    const up = await this.backend.upload(file);
    this.own = [...this.own, up];
    this.changed();
    return up;
  }

  async removeUpload(id: number): Promise<void> {
    await this.backend.removeUpload(id);
    this.own = this.own.filter((u) => u.id !== id);
    // The server takes the picture out of this player's builds; do the same here.
    this.list = this.list.flatMap((b) => {
      if (!b.mine) return [b];
      const pieces = withoutUpload(b.pieces, id);
      return pieces.length ? [{ ...b, pieces }] : [];
    });
    this.changed();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of [...this.listeners]) fn();
  }
}

/**
 * Builds kept in memory: a preview of a draft, or offline play. Nothing is saved, nothing waits for
 * a teacher, and uploaded pictures stay in the browser.
 */
export function pretendBuilds(author: string): BuildBackend {
  const builds = new Map<string, SceneBuild>();
  const uploads: BuildUpload[] = [];
  let next = 1;
  return {
    load: async () => ({ may_build: true, builds: [...builds.values()], uploads: [...uploads], pictures: {} }),
    save: async (sceneId, pieces) => {
      if (!pieces.length) {
        builds.delete(String(sceneId));
        return null;
      }
      const build: SceneBuild = { id: next++, scene_id: sceneId, mine: true, author, status: 'approved', pieces };
      builds.set(String(sceneId), build);
      return build;
    },
    upload: async (file) => {
      const url = URL.createObjectURL(file);
      const size = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 1, height: 1 });
        img.src = url;
      });
      const up = { id: next++, url, ...size };
      uploads.push(up);
      return up;
    },
    removeUpload: async (id) => {
      const i = uploads.findIndex((u) => u.id === id);
      if (i >= 0) uploads.splice(i, 1);
    },
  };
}
