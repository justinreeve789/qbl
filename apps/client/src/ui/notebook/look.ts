/**
 * How the notebook's writing looks, which each player chooses for themselves (on this device):
 * the handwriting, and how big it is. Neat writing is the default: a handwriting made to be easy
 * to read for children learning to read (Playpen Sans), with a looser one and plain book letters
 * to choose instead. The fonts are fetched the first time the notebook opens, not with the game.
 */

export type NotebookFont = 'neat' | 'loose' | 'print';
export type NotebookSize = 'big' | 'bigger';

export const NOTEBOOK_FONTS: Array<{ key: NotebookFont; label: string; family: string; load: () => Promise<unknown> }> = [
  {
    key: 'neat', label: 'Neat writing', family: "'Playpen Sans', 'Comic Sans MS', 'Chalkboard SE', cursive",
    load: () => Promise.all([import('@fontsource/playpen-sans/400.css'), import('@fontsource/playpen-sans/600.css')]),
  },
  {
    key: 'loose', label: 'Quick writing', family: "'Patrick Hand', 'Comic Sans MS', 'Chalkboard SE', cursive",
    load: () => import('@fontsource/patrick-hand/400.css'),
  },
  {
    key: 'print', label: 'Book letters', family: "Andika, 'Atkinson Hyperlegible', Verdana, sans-serif",
    load: () => Promise.all([import('@fontsource/andika/400.css'), import('@fontsource/andika/700.css')]),
  },
];

export const NOTEBOOK_SIZES: Array<{ key: NotebookSize; label: string }> = [
  { key: 'big', label: 'Big' },
  { key: 'bigger', label: 'Bigger' },
];

export interface NotebookLook { font: NotebookFont; size: NotebookSize }

const STORE = 'qbl.notebook.look';

export function readLook(): NotebookLook {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<NotebookLook>;
    return {
      font: NOTEBOOK_FONTS.some((f) => f.key === saved.font) ? saved.font! : 'neat',
      size: NOTEBOOK_SIZES.some((s) => s.key === saved.size) ? saved.size! : 'big',
    };
  } catch {
    return { font: 'neat', size: 'big' };
  }
}

export function keepLook(look: NotebookLook): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(look));
  } catch {
    /* storage can be unavailable in private modes */
  }
}

const loaded = new Map<NotebookFont, Promise<unknown>>();

/** Fetch a handwriting, once. Whatever happens, the notebook shows (in a fallback font if need be). */
export function loadFont(font: NotebookFont): Promise<unknown> {
  let p = loaded.get(font);
  if (!p) {
    p = NOTEBOOK_FONTS.find((f) => f.key === font)!.load().catch(() => undefined);
    loaded.set(font, p);
  }
  return p;
}
