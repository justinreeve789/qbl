import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Id, Scenario, Session } from '@qbl/shared';
import type { Backend, InstanceData, User } from './Backend.js';

const SAFE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/**
 * Development backend: scenarios are `<scenarioDir>/<shortname>.json`, saves
 * are JSON files under saveDir, and "logging in" is picking a name.
 *
 * Guest tokens look like `guest.<base64url name>.<random>`. They carry no
 * secret and prove nothing; do not expose this backend to the internet.
 */
export class FileBackend implements Backend {
  constructor(private scenarioDir: string, private saveDir: string) {}

  static issueGuestToken(name: string): string {
    const clean = name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 24) || 'Guest';
    return `guest.${Buffer.from(clean).toString('base64url')}.${randomBytes(6).toString('hex')}`;
  }

  /** Find a scenario by its 16-letter code or by its file name (the shortname). */
  async getScenario(key: string): Promise<Scenario> {
    if (!SAFE.test(key)) throw new Error(`Bad scenario key "${key}"`);
    try {
      return JSON.parse(await readFile(path.join(this.scenarioDir, `${key}.json`), 'utf8')) as Scenario;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    for (const name of await readdir(this.scenarioDir)) {
      if (!name.endsWith('.json')) continue;
      const scenario = JSON.parse(await readFile(path.join(this.scenarioDir, name), 'utf8')) as Scenario;
      if (scenario.code === key.toLowerCase()) return scenario;
    }
    throw new Error(`Scenario "${key}" not found`);
  }

  async verifyToken(token: string): Promise<User | null> {
    const [kind, encoded, nonce] = token.split('.');
    if (kind !== 'guest' || !encoded || !nonce) return null;
    const name = Buffer.from(encoded, 'base64url').toString('utf8');
    // Same name + nonce = same saves, so a browser keeps its progress across reloads.
    const id = createHash('sha1').update(`${name}:${nonce}`).digest('hex').slice(0, 16);
    return { id: `guest-${id}`, name, role: 'guest' };
  }

  /** There are no classes or teams without the API: any group is an open one. */
  async mayJoin(): Promise<boolean> {
    return true;
  }

  // The public instance keeps the file name saves had before instances had saves of their own.
  loadSession(scenarioId: Id, userId: string, group: string): Promise<Session | null> {
    return this.read<Session>(`session-${scenarioId}-${userId}${group === 'public' ? '' : `-${slug(group)}`}`);
  }
  saveSession(scenarioId: Id, userId: string, group: string, session: Session): Promise<void> {
    return this.write(`session-${scenarioId}-${userId}${group === 'public' ? '' : `-${slug(group)}`}`, session);
  }
  loadInstance(scenarioId: Id, group: string): Promise<InstanceData | null> {
    return this.read<InstanceData>(`instance-${scenarioId}-${slug(group)}`);
  }
  saveInstance(scenarioId: Id, group: string, data: InstanceData): Promise<void> {
    return this.write(`instance-${scenarioId}-${slug(group)}`, data);
  }

  /**
   * Stars, XP and the marketplace need accounts, and this backend only has guests
   * (name-only sign-in for development). Awards are therefore never granted here; run the
   * Laravel API to work on them.
   */
  async award(): Promise<null> {
    return null;
  }

  async look(): Promise<string> {
    return '';
  }

  private async read<T>(name: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path.join(this.saveDir, `${name}.json`), 'utf8')) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  private async write(name: string, data: unknown): Promise<void> {
    await mkdir(this.saveDir, { recursive: true });
    const file = path.join(this.saveDir, `${name}.json`);
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, file);
  }
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9_-]/gi, '_').slice(0, 64) || 'public';
}
