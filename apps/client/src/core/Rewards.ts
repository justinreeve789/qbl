import { rankFor, type AwardAction, type Id, type Progress, type RewardMessage, type ShopItem } from '@qbl/shared';

/** The backend calls behind the marketplace. Absent for guests and in tests. */
export interface RewardsPort {
  shop(): Promise<{ items: ShopItem[]; progress: Progress | null }>;
  buy(itemId: Id): Promise<Progress>;
  equip(itemId: Id, on: boolean): Promise<Progress>;
}

const EMPTY: Progress = { stars: 0, xp: 0, rank: rankFor(0).rank, next_rank_xp: rankFor(0).next_rank_xp, owned: [], equipped: [] };

/**
 * The player's stars, XP, rank and belongings, and the marketplace's catalogue.
 *
 * The backend owns the numbers. This is the game's copy of them: it is filled when the game
 * starts, updated by the server's answer to each award, and by each purchase. In a preview
 * (and for guests) there is no account behind it: awards only show what they would give.
 */
export class Rewards {
  /** Null for guests: stars and XP need an account. */
  progress: Progress | null = null;
  /** Everything that can be worn, by id: the platform's items and this scenario's. */
  readonly items = new Map<Id, ShopItem>();
  private port: RewardsPort | null = null;
  private listeners = new Set<() => void>();
  /** Set by the rewards feature: opens the marketplace and resolves when it is closed. */
  openShop: () => { done: Promise<void>; cancel(): void } = () => ({ done: Promise.resolve(), cancel() {} });

  constructor(scenarioItems: ShopItem[] = []) {
    for (const item of scenarioItems) this.items.set(item.id, item);
  }

  /** Read the catalogue and the player's progress. Failing is not fatal: the game plays without a marketplace. */
  async connect(port: RewardsPort): Promise<void> {
    this.port = port;
    try {
      const { items, progress } = await port.shop();
      for (const item of items) this.items.set(item.id, item);
      this.progress = progress;
    } catch {
      this.port = null;
    }
    this.changed();
  }

  /** A preview has no account: give it an empty one so awards and the shop can be tried. */
  private simulated = new Set<Id>();

  pretend(stars = 0): void {
    this.simulated.clear();
    // Nothing done from here on reaches the backend: no real stars are spent while testing.
    this.port = null;
    this.progress = { ...EMPTY, stars };
    this.changed();
  }

  get available(): boolean {
    return this.progress !== null;
  }

  /** What is for sale, the scenario's own items first. */
  get catalogue(): ShopItem[] {
    return [...this.items.values()].sort((a, b) => Number(a.scenario_id == null) - Number(b.scenario_id == null) || a.id - b.id);
  }

  equipped(kind?: ShopItem['kind']): ShopItem[] {
    return (this.progress?.equipped ?? []).map((id) => this.items.get(id)).filter((i): i is ShopItem => !!i && (!kind || i.kind === kind));
  }

  /** The ids the player wears, as the room state carries them. */
  get look(): string {
    return (this.progress?.equipped ?? []).join(',');
  }

  hasAbility(key: string): boolean {
    return this.equipped('ability').some((i) => i.ability === key);
  }

  /** The server's answer to an award. */
  apply(reward: RewardMessage): void {
    const { delta_stars: _s, delta_xp: _x, note: _n, rank_up: _r, ...progress } = reward;
    // The marketplace may have changed what is owned since; the award only speaks for the totals.
    this.progress = { ...progress, owned: this.progress?.owned ?? progress.owned, equipped: this.progress?.equipped ?? progress.equipped };
    this.changed();
  }

  /** In a preview: what an award would give, applied to the pretend account. */
  simulate(action: AwardAction): RewardMessage | null {
    if (!this.progress) return null;
    // As on the backend: an award is given once unless it says it repeats.
    if (!action.repeatable && this.simulated.has(action.id)) return null;
    this.simulated.add(action.id);
    const stars = Math.max(0, this.progress.stars + Math.round(action.stars ?? 0));
    const xp = Math.max(0, this.progress.xp + Math.round(action.xp ?? 0));
    const before = this.progress;
    const reward: RewardMessage = {
      ...before, stars, xp, ...rankFor(xp), delta_stars: stars - before.stars, delta_xp: xp - before.xp, note: action.note,
      rank_up: rankFor(xp).rank !== before.rank && xp > before.xp,
    };
    this.apply(reward);
    return reward;
  }

  async buy(itemId: Id): Promise<void> {
    if (this.port) this.progress = await this.port.buy(itemId);
    else if (this.progress) {
      // Preview: spend pretend stars.
      const item = this.items.get(itemId);
      if (!item || this.progress.stars < item.price) throw new Error('You do not have enough stars for that.');
      this.progress = { ...this.progress, stars: this.progress.stars - item.price, owned: [...this.progress.owned, itemId] };
    }
    this.changed();
  }

  async equip(itemId: Id, on: boolean): Promise<void> {
    if (this.port) this.progress = await this.port.equip(itemId, on);
    else if (this.progress) {
      const item = this.items.get(itemId);
      // One wearable per slot, one pet, one animation; abilities add up.
      const clashes = (other: ShopItem | undefined) => !!item && !!other && item.kind !== 'ability' && other.kind === item.kind && (item.kind !== 'wearable' || other.slot === item.slot);
      const kept = this.progress.equipped.filter((id) => id !== itemId && !(on && clashes(this.items.get(id))));
      this.progress = { ...this.progress, equipped: on ? [...kept, itemId].sort((a, b) => a - b) : kept };
    }
    this.changed();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    for (const l of [...this.listeners]) l();
  }
}
