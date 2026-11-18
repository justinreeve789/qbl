import { dialogueDuration, isNarrated, resolveMediaUrl, type Id, type Narrated } from '@qbl/shared';
import type { SpeakOptions } from '../../ui/UiPort';
import type { BubbleAnchor } from '../../ui/bubble';
import type { Presenter, PresenterContext } from '../Presenter';

/** Who is speaking: their name, and the close-up used in a portrait box. */
function speakerOf(pc: PresenterContext, characterId: Id | undefined, actor: string | undefined): { name?: string; portrait?: string } {
  const { scenario, index, connection } = pc.ctx;
  const url = (mediaId: Id | null | undefined) => {
    const media = mediaId != null ? index.media.get(mediaId) : undefined;
    return (media && resolveMediaUrl(scenario, media)) || undefined;
  };
  if (characterId != null) {
    const c = (scenario.characters ?? []).find((x) => x.id === characterId);
    // A character without a close-up is shown by its ordinary picture.
    return { name: c?.name, portrait: url(c?.portrait_media_id ?? c?.media_id) };
  }
  const player = connection.state.players.get(actor ?? connection.sessionId);
  const avatar = player?.avatar;
  return { name: player?.name, portrait: url(scenario.avatar_portraits?.[String(avatar)] ?? avatar) };
}

/**
 * How a narrated action is read: with a recording when it has one, and otherwise by the
 * browser's voice in the scenario's language, in the character's voice when one is speaking.
 */
export function speech(pc: PresenterContext, action: Narrated, characterId?: Id): SpeakOptions {
  const { scenario } = pc.ctx;
  const character = characterId != null ? (scenario.characters ?? []).find((c) => c.id === characterId) : undefined;
  return {
    lang: scenario.default_language,
    pitch: character?.voice_pitch,
    rate: character?.voice_rate,
    voice: character?.voice_name,
    audioUrl: (action.narration_media_id != null && pc.ctx.mediaUrl(action.narration_media_id)) || undefined,
  };
}

/**
 * A line of dialogue. As a bubble it hangs over the player or a character: the bubble is HTML,
 * so the text is sharp and it can keep itself on screen, and this presenter tells it, every
 * frame, where the speaker is on the page. As a portrait box it is a panel across the screen
 * with the speaker's close-up, for the characters that carry the story.
 */
export const dialogue: Presenter<'dialogue'> = (action, pc, actor) => {
  const byCharacter = action.speaker === 'character';
  const text = pc.ctx.text(action.text);
  const speak = isNarrated(pc.ctx.scenario, action) ? speech(pc, action, byCharacter ? action.character_id : undefined) : undefined;

  if (action.style === 'portrait') {
    const who = speakerOf(pc, byCharacter ? action.character_id : undefined, actor);
    return pc.ctx.ui.portraitDialogue(text, {
      name: who.name,
      portrait: who.portrait,
      // The player who set it off reads at their own pace. Others only look on, so theirs closes by itself.
      duration: action.duration && action.duration > 0 ? action.duration : actor ? dialogueDuration(action.text) : 0,
      watching: !!actor,
      speak,
    });
  }

  const who = byCharacter ? { character_id: action.character_id } : { actor };
  const speaker = pc.locate(who);
  if (byCharacter && !speaker) pc.warn(`dialogue ${action.id}: character ${action.character_id} is not in this scene`);

  const anchor = (): BubbleAnchor | null => {
    const at = pc.locate(who);
    if (!at) return null;
    const cam = pc.scene.cameras.main;
    const canvas = pc.scene.game.canvas.getBoundingClientRect();
    // Scene pixels to page pixels: the camera's scroll and zoom, then the canvas's size on the page.
    const sx = (canvas.width / pc.scene.scale.width) * cam.zoom;
    const sy = (canvas.height / pc.scene.scale.height) * cam.zoom;
    const x = canvas.left + (at.x - cam.worldView.x) * sx;
    const bottom = canvas.top + (at.y - cam.worldView.y) * sy;
    return { x, bottom, top: bottom - at.height * sy, width: at.height * sx * 0.5 };
  };

  return pc.ctx.ui.dialogue(text, {
    name: byCharacter ? speaker?.name : actor ? speakerOf(pc, undefined, actor).name : undefined,
    duration: action.duration && action.duration > 0 ? action.duration : dialogueDuration(action.text),
    anchor,
    speak,
  });
};
