import { Api, ApiError, COPY_TABLES, type Bundle, type CopyRows, type CopyTable, type LibraryAdded, type RestoreStep, type Row, type Table } from './api';
import { toast } from './dom';
import { clone, diff, History, nextGesture, type Change } from './history';

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

  /** Undo and redo (Ctrl+Z, Ctrl+Y): see history.ts. */
  readonly history = new History();
  /**
   * The rows as they were last saved, copied: what a patch changes them from. Kept apart from the
   * bundle because the forms may change a row's lists and objects in place before patching it.
   */
  private saved = new Map<string, Record<string, unknown>>();
  /** Undoes and redoes, one after another. */
  private turning: Promise<unknown> = Promise.resolve();

  /** True when the scenario has changes that players do not have yet. */
  unpublished = true;

  async load() {
    this.hold(await this.api.bundle(this.scenarioId));
  }

  /** Hold a copy of the scenario as the API sent it. */
  private hold(bundle: Bundle) {
    this.bundle = bundle;
    this.saved = new Map([['scenario', clone(bundle.scenario)]]);
    for (const table of Object.keys(bundle) as Array<Table | 'scenario'>) {
      if (table !== 'scenario') for (const row of bundle[table]) this.saved.set(`${table}:${row.id}`, clone(row));
    }
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
    const step = this.history.take();
    const row = await this.send(async () => {
      const made = await this.api.createRow(this.scenarioId, table, attrs);
      this.history.record(step, { rows: [{ table, id: made.id, before: null, after: made }] });
      return made;
    });
    if (row) {
      this.saved.set(`${table}:${row.id}`, clone(row));
      this.bundle[table].push(row);
      this.emit();
    }
    return row;
  }

  /**
   * Take in what was added to the scenario elsewhere (a scene the AI generator made for it): load it
   * again, and keep what changed as one step of its own, so Ctrl+Z takes the whole scene away again.
   */
  async takeIn(): Promise<void> {
    await this.settled();
    // A step of its own, not part of whatever the author last did.
    nextGesture();
    const step = this.history.take();
    const before = clone(this.bundle);
    await this.load();
    const change = diff(before, this.bundle);
    if (change.rows.length || change.scenario) this.history.record(step, change);
  }

  /**
   * Add an asset of the library to the scenario: the server copies its pictures into the media (once)
   * and makes its character or item; both are taken in here.
   */
  async addFromLibrary(asset: number | string, name?: string): Promise<LibraryAdded | undefined> {
    const step = this.history.take();
    const added = await this.send(async () => {
      const made = await this.api.addLibraryAsset(asset, this.scenarioId, name);
      // Undone, the new rows go (the files stay on disk), so a redo can put them back.
      const fresh = made.media.filter((m) => !this.byId('media', m.id));
      const change: Change = { rows: fresh.map((m) => ({ table: 'media' as const, id: m.id, before: null, after: m })) };
      if (made.created) change.rows.push({ table: made.created.table, id: made.created.row.id, before: null, after: made.created.row });
      this.history.record(step, change);
      return made;
    });
    if (added) {
      for (const media of added.media) {
        if (this.byId('media', media.id)) continue;
        this.bundle.media.push(media);
        this.saved.set(`media:${media.id}`, clone(media));
      }
      if (added.created) {
        this.bundle[added.created.table].push(added.created.row);
        this.saved.set(`${added.created.table}:${added.created.row.id}`, clone(added.created.row));
      }
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
    const change = this.noted(`${table}:${id}`, local, attrs);
    if (local) Object.assign(local, attrs);
    this.emit(structural);
    const step = this.history.take(change.typing);
    const row = await this.coalesced(`${table}:${id}`, attrs, (merged) => this.api.updateRow(this.scenarioId, table, id, merged));
    if (!row) await this.load();
    else this.history.record(step, { rows: [{ table, id, before: change.before, after: change.after }] });
    return row;
  }

  /** What a patch changes, from the copy of the row as it was saved; the copy then takes the new values. */
  private noted(key: string, local: Record<string, unknown> | undefined, attrs: object) {
    const saved = this.saved.get(key) ?? clone(local ?? {});
    const after = clone(attrs) as Record<string, unknown>;
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(after)) before[k] = clone(saved[k] ?? null);
    Object.assign(saved, clone(after));
    this.saved.set(key, saved);
    return { before, after, typing: `${key}:${Object.keys(after).sort().join(',')}` };
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
    const step = this.history.take();
    let before: Bundle | null = null;
    const ok = await this.send(async () => {
      before = clone(this.bundle);
      await this.api.deleteRow(this.scenarioId, table, id);
      return true;
    });
    await this.load();
    // Deleting a file removes it from disk: that cannot be undone, and neither can what came before it.
    if (ok && table === 'media') this.history.clear();
    else if (ok && before) this.history.record(step, diff(before, this.bundle));
    return ok === true;
  }

  /**
   * Add copies of rows (copy and paste, Duplicate scene), as one step for Ctrl+Z. References among
   * the rows go to the copies; others stay as they were (ScenarioStore::copyRows). With `keepIds`
   * (pasting what was cut, so it is a move) the rows go back under their own ids, and everything
   * that named them still does; if one of those ids is taken by then, they are copied instead.
   * Answers with the id each copied row has now, or undefined if the API refused.
   */
  async paste(rows: CopyRows, keepIds = false): Promise<((table: CopyTable, id: number) => number | undefined) | undefined> {
    const step = this.history.take();
    let before: Bundle | null = null;
    const kept = keepIds && COPY_TABLES.every((t) => (rows[t] ?? []).every((r) => !this.byId(t, r.id)));
    const made = await this.send(async () => {
      before = clone(this.bundle);
      if (kept) {
        const steps: RestoreStep[] = COPY_TABLES.flatMap((table) => (rows[table] ?? []).map((row) => ({ op: 'insert' as const, table, row })));
        try {
          return { bundle: await this.api.restore(this.scenarioId, steps), map: null };
        } catch (err) {
          if (!(err instanceof ApiError) || err.status !== 409) throw err;
        }
      }
      return this.api.copy(this.scenarioId, rows);
    });
    if (!made) {
      await this.load().catch(() => undefined);
      return undefined;
    }
    this.hold(made.bundle);
    this.unpublished = true;
    if (before) this.history.record(step, diff(before, this.bundle));
    const { map } = made;
    return (table, id) => (map ? map[table]?.[String(id)] : id);
  }

  /**
   * Undo the last step (or redo the last one undone). Waits for the changes before it to be saved;
   * answers whether there was anything to do.
   */
  undo(): Promise<boolean> {
    return this.turn('undo');
  }

  redo(): Promise<boolean> {
    return this.turn('redo');
  }

  private turn(which: 'undo' | 'redo'): Promise<boolean> {
    const result = this.turning.then(async () => {
      await this.settled();
      const pending = which === 'undo' ? this.history.undo() : this.history.redo();
      if (!pending) return false;
      const bundle = await this.send(() => this.api.restore(this.scenarioId, pending.steps));
      if (bundle) {
        pending.done();
        this.hold(bundle);
        this.unpublished = true;
      } else {
        // Refused (something it needs is gone): that step is dropped, and the screen shows what is saved.
        await this.load().catch(() => undefined);
      }
      this.emit(true);
      return bundle !== undefined;
    });
    this.turning = result.catch(() => undefined);
    return result;
  }

  async patchScenario(attrs: object, structural = false): Promise<void> {
    const change = this.noted('scenario', this.bundle.scenario, attrs);
    Object.assign(this.bundle.scenario, attrs);
    this.emit(structural);
    const step = this.history.take(change.typing);
    const row = await this.coalesced('scenario', attrs, (merged) => this.api.patchScenario(this.scenarioId, merged));
    if (!row) await this.load();
    else this.history.record(step, { rows: [], scenario: { before: change.before, after: change.after } });
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
