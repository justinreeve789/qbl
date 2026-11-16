import { readFileSync } from 'node:fs';
import { CHAT_MAX_LENGTH, EMOTES } from '@qbl/shared';

/**
 * Free-text chat is off unless a scenario opts in with chat_mode "free".
 * This filter is a baseline only: it strips markup and control characters,
 * masks blocklisted words and limits length. Schools that enable free chat
 * should supply their own blocklist and consider moderation tooling.
 */
export class ChatFilter {
  private blocked: RegExp | null = null;

  constructor(blocklistFile?: string) {
    if (!blocklistFile) return;
    const words = readFileSync(blocklistFile, 'utf8')
      .split('\n')
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w && !w.startsWith('#'))
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (words.length) this.blocked = new RegExp(`\\b(${words.join('|')})\\b`, 'giu');
  }

  /** Returns cleaned text, or null if nothing sendable is left. */
  clean(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    let text = raw
      .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, CHAT_MAX_LENGTH);
    if (this.blocked) text = text.replace(this.blocked, (w) => '*'.repeat(w.length));
    return text || null;
  }

  isEmote(raw: unknown): raw is string {
    return typeof raw === 'string' && EMOTES.includes(raw);
  }
}
