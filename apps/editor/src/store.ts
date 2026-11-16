import { Api, ApiError, type Bundle, type Row, type Table } from './api';
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

  /** Send one change after the ones before it. A failure is shown to the user and returned as undefined. */
  private send<T>(change: () => Promise<T>): Promise<T | undefined> {
    this.unpublished = true;
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
   * Change columns of a row. By default this is a "values" change: lists and the canvas redraw, but
   * forms are left alone so the field being typed in keeps its focus. Pass `structural` when the
   * change alters which fields exist (an action's type, a hotspot's kind).
   */
  async patch(table: Table, id: number, attrs: object, structural = false): Promise<Row | undefined> {
    const local = this.byId(table, id);
    if (local) Object.assign(local, attrs);
    this.emit(structural);
    const row = await this.send(() => this.api.updateRow(this.scenarioId, table, id, attrs));
    if (!row) await this.load();
    return row;
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
    const row = await this.send(() => this.api.patchScenario(this.scenarioId, attrs));
    if (!row) await this.load();
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
