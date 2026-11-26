/**
 * The browser's autoplay rule: a page may not make a sound until the player has clicked, tapped or
 * pressed a key on it. Usually they have by the time a scene plays one. A teacher's launch is the
 * exception: it moves students to a launcher scene (or to another page) without them touching
 * anything, so its cutscene can be the first sound of the page, and the browser keeps it silent.
 *
 * Here a sound that cannot be heard yet says so once ("click anywhere"), and the first click,
 * tap or key anywhere on the page turns the sound on. A WebAudio sound started while the sound
 * was off plays from then, so the cutscene's audio is heard, late, rather than lost.
 */

type SoundManagerLike = { locked?: boolean; context?: AudioContext } | null | undefined;

const PROMPT_MS = 8000;
const GESTURES = ['pointerdown', 'touchend', 'keydown'] as const;

let prompt: (() => void) | null = null;
let asked = false;
let context: AudioContext | null = null;

/** How the game tells the player to click for sound (main.ts sets it, with a toast). */
export function setSoundPrompt(show: ((ms: number) => void) | null): void {
  prompt = show ? () => show(PROMPT_MS) : null;
}

/** True when the browser is not letting this page make sounds yet. */
export function soundBlocked(manager: SoundManagerLike): boolean {
  if (!manager) return false;
  if (manager.locked) return true;
  const state = manager.context?.state as string | undefined;
  return state === 'suspended' || state === 'interrupted';
}

function onGesture() {
  for (const g of GESTURES) document.removeEventListener(g, onGesture, true);
  // Phaser resumes a context that was locked from the start; one suspended later is resumed here.
  void context?.resume().catch(() => undefined);
  asked = false;
}

/**
 * A sound is about to play (or was refused). If the page cannot make sounds yet, ask the player
 * once to click, and turn the sound on at their first click, tap or key.
 */
export function askForSound(manager?: SoundManagerLike, refused = false): void {
  if (!refused && !soundBlocked(manager)) return;
  if (manager?.context) context = manager.context;
  if (asked) return;
  asked = true;
  prompt?.();
  if (typeof document !== 'undefined') for (const g of GESTURES) document.addEventListener(g, onGesture, true);
}

/** For tests. */
export function resetSoundLock(): void {
  if (typeof document !== 'undefined') for (const g of GESTURES) document.removeEventListener(g, onGesture, true);
  asked = false;
  context = null;
  prompt = null;
}
