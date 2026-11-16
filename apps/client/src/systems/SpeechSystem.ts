import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { LocalPlayerSystem } from './LocalPlayerSystem';
import { RemotePlayersSystem } from './RemotePlayersSystem';

/** Shows chat messages and emotes as speech bubbles over whoever sent them. */
export class SpeechSystem implements SceneSystem {
  private off: Array<() => void> = [];

  constructor(private rt: SceneRuntime) {}

  create() {
    const { connection } = this.rt.ctx;
    const say = (sessionId: string, text: string) => {
      const avatar =
        sessionId === connection.sessionId
          ? this.rt.system(LocalPlayerSystem).avatar
          : this.rt.system(RemotePlayersSystem).get(sessionId);
      avatar?.say(text);
    };
    this.off.push(
      connection.on('chat', (m) => say(m.session_id, m.text)),
      connection.on('emote', (m) => say(m.session_id, m.emoji)),
    );
  }

  destroy() {
    for (const off of this.off) off();
    this.off = [];
  }
}
