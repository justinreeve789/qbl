/**
 * Maths and science libraries are large, and most scenes need none of them. Each is loaded the
 * first time something asks for it: math.js for formulas, KaTeX to typeset maths and chemistry,
 * JSXGraph to draw graphs. What has been loaded stays.
 */
export type Formulas = typeof import('@qbl/shared/formula');

let formulas: Promise<Formulas> | null = null;
let ready: Formulas | null = null;

/** math.js, by way of the shared formula code. */
export function loadFormulas(): Promise<Formulas> {
  return (formulas ??= import('@qbl/shared/formula').then((m) => (ready = m)));
}

/** The formula code if it has been loaded already, for what cannot wait. */
export const formulasNow = (): Formulas | null => ready;

let typesetter: Promise<typeof import('./math')> | null = null;

/** KaTeX, with its chemistry (`\ce{…}`). */
export function loadMath(): Promise<typeof import('./math')> {
  return (typesetter ??= import('./math'));
}

let grapher: Promise<typeof import('./graph')> | null = null;

/** JSXGraph. */
export function loadGraphs(): Promise<typeof import('./graph')> {
  return (grapher ??= import('./graph'));
}
