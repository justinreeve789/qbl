import type { GameContext } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';

/** The thread for what is said out loud in the scene. Private threads are named by the other player's session id. */
export const SCENE_THREAD = 'scene';

/**
 * Emotes, chat and private messages, according to the scenario's settings. What is said in a
 * scene shows as a speech bubble (SpeechSystem) and is listed in the messages panel; a private
 * message goes to one player, wherever in the scenario they are, and only the two of them see
 * it. The game server filters every message and keeps it for auditing.
 */
export class ChatFeature implements GameFeature {
  start(ctx: GameContext): () => void {
    const { ui, connection } = ctx;
    const mode = connection.welcome.chat_mode;
    const whispers = connection.welcome.private_messages === true;
    ui.chat(mode, {
      text: (t) => connection.chat(t),
      emote: (e) => connection.emote(e),
    });
    ui.messaging(mode === 'free' || whispers
      ? {
          scene: mode === 'free',
          private: whispers,
          send: (thread, text) => (thread === SCENE_THREAD ? connection.chat(text) : connection.whisper(thread, text)),
        }
      : null);

    const stops = [
      connection.on('chat', (m) => {
        const from = connection.state.players.get(m.session_id);
        const mine = m.session_id === connection.sessionId;
        // Not from a team a teacher has switched off.
        if (!mine && from && !ctx.sees(from)) return;
        ui.message({ thread: SCENE_THREAD, threadName: 'Everyone here', from: from?.name ?? 'Someone', mine, text: m.text, at: Date.now() });
      }),
      connection.on('whisper', (m) => {
        const mine = m.from === connection.sessionId;
        const other = mine ? m.to : m.from;
        const otherName = mine ? m.to_name : m.from_name;
        ui.message({ thread: other, threadName: otherName, from: m.from_name, mine, text: m.text, at: m.at });
        if (!mine) ui.toast(`${m.from_name} sent you a message`, 3500);
      }),
    ];
    return () => {
      for (const stop of stops) stop();
      ui.chat('off', { text() {}, emote() {} });
      ui.messaging(null);
    };
  }
}
