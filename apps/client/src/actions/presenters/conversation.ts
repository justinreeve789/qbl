import { conversationRef, dialogueDuration, isNarrated, type ChoiceHandle, type ConversationAction, type ConversationChoice, type ConversationLine } from '@qbl/shared';
import type { PresenterContext } from '../Presenter';
import { bubbleAnchor, speakerOf, speech } from './dialogue';

/**
 * One line of a conversation (a dialogue tree), for the engine, which walks the tree. A line with
 * nothing to choose is shown as a dialogue action would show it: a story box the player clicks on
 * from, or a bubble that stays long enough to read. A line with choices waits for an answer, and
 * the answer goes in the activity log so the teacher's report can show what the student said.
 */
export function conversationLine(action: ConversationAction, line: ConversationLine, choices: ConversationChoice[], pc: PresenterContext): ChoiceHandle {
  const { ctx } = pc;
  const style = action.style === 'bubble' ? 'bubble' : 'portrait';
  const byCharacter = line.speaker === 'character';
  const characterId = byCharacter ? line.character_id : undefined;
  const text = ctx.text(line.text);
  const speak = isNarrated(ctx.scenario, action) ? speech(pc, { narration_media_id: line.narration_media_id }, characterId) : undefined;
  const who = style === 'portrait' ? speakerOf(pc, characterId, undefined) : undefined;
  const anchor = style === 'bubble' ? bubbleAnchor(pc, byCharacter ? { character_id: characterId } : {}) : undefined;
  if (style === 'bubble' && byCharacter && !pc.locate({ character_id: characterId })) {
    pc.warn(`conversation ${action.id}: character ${String(characterId)} is not in this scene`);
  }
  const name = who?.name ?? (byCharacter ? pc.locate({ character_id: characterId })?.name : undefined);

  if (!choices.length) {
    const shown = style === 'portrait'
      ? ctx.ui.portraitDialogue(text, { name, portrait: who?.portrait, duration: 0, speak })
      : ctx.ui.dialogue(text, { name, duration: dialogueDuration(line.text), anchor: anchor!, speak });
    return { choice: shown.done.then(() => null), cancel: shown.cancel };
  }

  const answers = choices.map((c) => ctx.text(c.text));
  const box = ctx.ui.choose(text, answers, { style, name, portrait: who?.portrait, anchor, speak });
  const choice = box.choice.then((index) => {
    if (index != null) ctx.track({ type: 'choice', ref: conversationRef(action.id, line.id), label: answers[index] ?? '', value: index });
    return index;
  });
  return { choice, cancel: box.close };
}
