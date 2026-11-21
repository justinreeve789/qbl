import { Api, ApiError, type Bundle, type LibraryAdded, type Row, type Table } from './api';
import { toast } from './dom';

/**
 * The scenario being edited, held in memory.
 *
 * A change is applied here at once, so the screen and any change made right after it see it, and
 * is then sent to the API. Changes are sent one at a time, in the order they were made. If the API
 * refuses one, the scenario is loaded again so the screen goes back to what the database holds.
 */
export class Store {
  bundle!: Bundle;
  private listeners = new Set<(structural: boolean) => void>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly api: Api, readonly scenarioId: number) {}

  /** True when the scenario has changes that players do not have yet. */
  unpublished = true;

  async load() {
    this.bundle = await this.api.bundle(this.scenarioId);
    const { published_at: published, updated_at: updated } = this.bundle.scenario as { published_at?: string | null; updated_at?: string | null };
    this.unpublished = !published || (updated != null && updated > published);
    this.emit();
  }

  get scenario(): Row {
    return this.bundle.scenario;
  }

  /** The scenario's settings column (chat mode, objectives, avatars...). */
  get settings(): Record<string, unknown> {
    return (this.scenario.settings as Record<string, unknown> | null) ?? {};
  }

  rows(table: Table): Row[] {
    return this.bundle[table];
  }

  byId(table: Table, id: number | null | undefined): Row | undefined {
    return id == null ? undefined : this.bundle[table].find((r) => r.id === id);
  }

  where(table: Table, column: string, value: unknown): Row[] {
    return this.bundle[table].filter((r) => r[column] === value);
  }

  /**
   * The last change queued, while it is still waiting to be sent, if it is a patch. A patch of the
   * same row made right after it is folded into it rather than queued, so dragging a slider sends
   * one request at a time with the latest value, not one per step.
   */
  private waiting: { key: string; attrs: Record<string, unknown>; result: Promise<Row | undefined> } | null = null;
  /** When each row's last patch was sent, and the least time between two patches of one row (ms). */
  private sentAt = new Map<string, number>();
  private static readonly PATCH_GAP = 150;
  /** True while `live()` runs. */
  private dragging = false;

  /**
   * Make changes in passing, as a slider is dragged: the screen gets each at once, but patches
   * made in `change` wait a moment after the row's last one, so the steps of a drag are sent
   * together. Other changes are sent without waiting.
   */
  live<T>(change: () => T): T {
    this.dragging = true;
    try {
      return change();
    } finally {
      this.dragging = false;
    }
  }

  /** Send one change after the ones before it. A failure is shown to the user and returned as undefined. */
  private send<T>(change: () => Promise<T>): Promise<T | undefined> {
    this.unpublished = true;
    // Anything queued after a waiting patch keeps later patches from being folded into it.
    this.waiting = null;
    const result = this.queue.then(change).catch((err: unknown) => {
      toast(err instanceof ApiError ? err.message : 'Could not save. Check your connection.', 'error');
      return undefined;
    });
    this.queue = result;
    return result;
  }

  /** Resolves when every change made so far has been sent. */
  settled(): Promise<unknown> {
    return this.queue;
  }

  async add(table: Table, attrs: object): Promise<Row | undefined> {
    const row = await this.send(() => this.api.createRow(this.scenarioId, table, attrs));
    if (row) {
      this.bundle[table].push(row);
      this.emit();
    }
    return row;
  }

  /**
   * Add an asset of the library to the scenario: the server copies its pictures into the media (once)
   * and makes its character or item; both are taken in here.
   */
  async addFromLibrary(asset: number | string, name?: string): Promise<LibraryAdded | undefined> {
    const added = await this.send(() => this.api.addLibraryAsset(asset, this.scenarioId, name));
    if (added) {
      for (const media of added.media) if (!this.byId('media', media.id)) this.bundle.media.push(media);
      if (added.created) this.bundle[added.created.table].push(added.created.row);
      this.emit(true);
    }
    return added;
  }

  /**
   * Change columns of a row. By default this is a "values" change: lists and the canvas redraw, but
   * forms are left alone so the field being typed in keeps its focus. Pass `structural` when the
   * change alters which fields exist (an action's type, a hotspot's kind).
   */
  async patch(table: Table, id: number, attrs: object, structural = false): Promise<Row | undefined> {
    const local = this.byId(table, id);
    if (local) Object.assign(local, attrs);
    this.emit(structural);
    const row = await this.coalesced(`${table}:${id}`, attrs, (merged) => this.api.updateRow(this.scenarioId, table, id, merged));
    if (!row) await this.load();
    return row;
  }

  /** Queue a patch, or fold it into the same row's patch if that is the last one queued and has not been sent yet. */
  private coalesced(key: string, attrs: object, change: (attrs: object) => Promise<Row>): Promise<Row | undefined> {
    if (this.waiting?.key === key) {
      Object.assign(this.waiting.attrs, attrs);
      return this.waiting.result;
    }
    const entry = { key, attrs: { ...attrs } as Record<string, unknown>, result: undefined as unknown as Promise<Row | undefined> };
    const gentle = this.dragging;
    entry.result = this.send(async () => {
      // A step of a drag soon after the row's last patch: wait a moment, so the next steps are
      // folded into this request rather than each sent on its own.
      const since = Date.now() - (this.sentAt.get(key) ?? 0);
      if (gentle && since < Store.PATCH_GAP) await this.api.pause(Store.PATCH_GAP - since);
      // Once it is on its way, nothing more can be added to it.
      if (this.waiting === entry) this.waiting = null;
      this.sentAt.set(key, Date.now());
      return change(entry.attrs);
    });
    this.waiting = entry;
    return entry.result;
  }

  /** Delete a row. The API also removes what depended on it, so everything is loaded again afterwards. */
  async remove(table: Table, id: number): Promise<boolean> {
    const ok = await this.send(async () => {
      await this.api.deleteRow(this.scenarioId, table, id);
      return true;
    });
    await this.load();
    return ok === true;
  }

  async patchScenario(attrs: object, structural = false): Promise<void> {
    Object.assign(this.bundle.scenario, attrs);
    this.emit(structural);
    const row = await this.coalesced('scenario', attrs, (merged) => this.api.patchScenario(this.scenarioId, merged));
    if (!row) await this.load();
  }

  /**
   * Give the scenario a new player code. It applies to players at once, published or not, so it
   * is not an unpublished change. Returns null on success, or the reason it was refused, for the
   * form to show (no toast).
   */
  async changeCode(code: string): Promise<string | null> {
    await this.settled();
    try {
      const row = await this.api.changeCode(this.scenarioId, code);
      // Only the code (and a shortname that followed it): the rest of the row is as it was.
      Object.assign(this.bundle.scenario, { code: row.code, shortname: row.shortname });
      this.emit();
      return null;
    } catch (err) {
      return err instanceof ApiError ? err.message : 'Could not save. Check your connection.';
    }
  }

  /** Publish the scenario as it is now: this is what players get at /{code}. */
  async publish(): Promise<boolean> {
    const row = await this.send(() => this.api.publish(this.scenarioId));
    if (row) {
      this.bundle.scenario = row;
      this.unpublished = false;
      this.emit();
    }
    return row !== undefined;
  }

  patchSettings(attrs: object, structural = false): Promise<void> {
    return this.patchScenario({ settings: { ...this.settings, ...attrs } }, structural);
  }

  /**
   * Listen for changes. `structural` is true when rows were added or removed or everything was
   * reloaded, and false when only values changed.
   */
  onChange(listener: (structural: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(structural = true) {
    for (const l of [...this.listeners]) l(structural);
  }
}
