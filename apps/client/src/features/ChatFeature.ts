import type { GameContext } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';

/** Emote and chat controls, according to the scenario's chat mode. Speech bubbles are drawn by SpeechSystem. */
export class ChatFeature implements GameFeature {
  start(ctx: GameContext): () => void {
    ctx.ui.chat(ctx.connection.welcome.chat_mode, {
      text: (t) => ctx.connection.chat(t),
      emote: (e) => ctx.connection.emote(e),
    });
    return () => ctx.ui.chat('off', { text() {}, emote() {} });
  }
}
