import { carriedItems, combinationFor, type Action, type Id, type Item, type Scenario, type VarValue } from '@qbl/shared';

type Get = (name: string) => VarValue | undefined;

/**
 * The player's bag, as in a point-and-click adventure: what they carry, and the thing they have
 * picked to use. Picking a thing and then clicking something in the scene uses it there (a hotspot
 * or a character's event that tests `QL_Holding` takes it); picking a second thing puts the two
 * together (`Scenario.combinations`). It outlives scenes, like the player's variables.
 *
 * `QL_Holding` is the picked thing's id, and stays so while whatever the click started is still
 * running, so the event's own conditions can keep reading it; the bag on screen lets go at once.
 */
export class Bag {
  /** The thing picked in the bag, waiting to be used. */
  private picked: Id | null = null;
  /** The thing being used: what a click started is still running. */
  private using: Id | null = null;
  private listeners = new Set<() => void>();

  /** The scene being played: does what putting two things together does. Set by each scene as it starts. */
  run: ((actions: Array<Omit<Action, 'id'> & { id?: Id }>) => Promise<void>) | null = null;

  /** Tell the player something short. Set by the game. */
  say: (text: string) => void = () => {};

  constructor(private scenario: Scenario, private get: Get) {}

  /** What `QL_Holding` reads: the thing picked or in use, else 0. */
  get holding(): Id | 0 {
    return this.picked ?? this.using ?? 0;
  }

  /** The thing picked on screen, if any. */
  get selected(): Id | null {
    return this.picked;
  }

  /** The order things came into the bag: the newest last. */
  private order: Id[] = [];

  /** What the player carries now, in the order it came into the bag. */
  items(): Item[] {
    const now = carriedItems(this.scenario, this.get);
    const ids = new Set(now.map((i) => i.id));
    this.order = this.order.filter((id) => ids.has(id));
    for (const i of now) if (!this.order.includes(i.id)) this.order.push(i.id);
    return this.order.map((id) => now.find((i) => i.id === id)!);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    for (const l of [...this.listeners]) l();
  }

  /**
   * The player picked a thing in their bag. Nothing picked: it is picked. The same again: put back.
   * Another one: the two are put together.
   */
  pick(id: Id): void {
    if (this.picked == null) {
      if (!this.items().some((i) => i.id === id)) return;
      this.picked = id;
      this.changed();
      return;
    }
    const first = this.picked;
    this.picked = null;
    if (String(first) !== String(id)) this.combine(first, id);
    this.changed();
  }

  /** Put the picked thing back without using it. */
  drop(): void {
    if (this.picked == null) return;
    this.picked = null;
    this.changed();
  }

  /**
   * Use the picked thing on what a click started: `QL_Holding` keeps its id until `running`
   * settles, while the bag on screen lets go at once.
   */
  spend(running: Promise<void>): void {
    const id = this.picked;
    if (id == null) return;
    this.picked = null;
    this.using = id;
    this.changed();
    void running.finally(() => {
      if (this.using === id) this.using = null;
    });
  }

  /** The thing was clicked on something that does not take it. */
  refuse(text = 'That does not work there.'): void {
    this.say(text);
    this.drop();
  }

  private combine(a: Id, b: Id): void {
    const combination = combinationFor(this.scenario, a, b, this.get);
    if (!combination || !this.run) {
      const names = [a, b].map((id) => this.items().find((i) => i.id === id)?.name ?? 'that');
      this.say(`The ${names[0]} and the ${names[1]} do not go together.`);
      return;
    }
    // Picked again during its actions, a thing reads as used.
    this.using = a;
    void this.run(combination.actions).finally(() => {
      if (this.using === a) this.using = null;
      this.changed();
    });
  }
}
