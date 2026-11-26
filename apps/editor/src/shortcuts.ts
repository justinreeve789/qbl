/**
 * Delete, Ctrl+C, Ctrl+X and Ctrl+V (Cmd on a Mac) for what is selected in the editor: in the scene
 * editor, a hotspot, an area, a spawn point, a layer or actions of an event; on the Scenes page's
 * map, a scene.
 *
 * A view that has things to select registers itself with its element; the keys go to the last one
 * registered that is still on the page. They are left alone while text is typed or chosen (a field,
 * a drop-down, a dialog, words selected to copy), so they keep their usual meaning there.
 */
export interface ShortcutTarget {
  /** Copy what is selected (cut: and delete it). False when nothing is selected that can be. */
  copy(cut: boolean): boolean | Promise<boolean>;
  paste(): boolean | Promise<boolean>;
  /** Delete what is selected. */
  remove(): boolean | Promise<boolean>;
}

const targets: Array<{ element: HTMLElement; target: ShortcutTarget }> = [];

/** Send the keys to `target` while `element` is on the page. Returns a function that stops it. */
export function useShortcuts(element: HTMLElement, target: ShortcutTarget): () => void {
  const entry = { element, target };
  // Views drawn again replace their old element: those no longer on the page are dropped.
  for (let i = targets.length - 1; i >= 0; i--) if (!targets[i]!.element.isConnected) targets.splice(i, 1);
  targets.push(entry);
  return () => {
    const i = targets.indexOf(entry);
    if (i >= 0) targets.splice(i, 1);
  };
}

function current(): ShortcutTarget | null {
  for (let i = targets.length - 1; i >= 0; i--) if (targets[i]!.element.isConnected) return targets[i]!.target;
  return null;
}

export type Shortcut = 'copy' | 'cut' | 'paste' | 'delete';

/** Which of the keys this is, if any. */
export function shortcutKey(e: KeyboardEvent): Shortcut | null {
  if (e.altKey) return null;
  if (e.key === 'Delete' && !e.ctrlKey && !e.metaKey && !e.shiftKey) return 'delete';
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return null;
  return ({ c: 'copy', x: 'cut', v: 'paste' } as Record<string, Shortcut>)[e.key.toLowerCase()] ?? null;
}

/** True where the keys are the page's own: typing, choosing from a list, a dialog, or text selected to copy. */
export function keysBelongElsewhere(e: KeyboardEvent, which: Shortcut): boolean {
  const node = (e.target instanceof Element ? e.target : document.activeElement) as Element | null;
  if (node && (node.closest('input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select, [contenteditable=""], [contenteditable="true"], dialog') || (node as HTMLElement).isContentEditable)) return true;
  if (document.querySelector('dialog[open]')) return true;
  if (which === 'copy' || which === 'cut') {
    const chosen = window.getSelection();
    if (chosen && !chosen.isCollapsed && chosen.toString().trim()) return true;
  }
  return false;
}

/** Handle a key press (main.ts calls this for the scenario's pages). Answers whether it was one of these keys and was used. */
export function handleShortcut(e: KeyboardEvent): boolean {
  const which = shortcutKey(e);
  if (!which || keysBelongElsewhere(e, which)) return false;
  const target = current();
  if (!target) return false;
  e.preventDefault();
  if (which === 'paste') void target.paste();
  else if (which === 'delete') void target.remove();
  else void target.copy(which === 'cut');
  return true;
}
