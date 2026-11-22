import katex from 'katex';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';

/**
 * Typeset TeX into an element with KaTeX: maths (`\frac{m}{V}`) and, with `\ce{…}`, chemistry
 * (`\ce{2H2 + O2 -> 2H2O}`). What cannot be read is shown as it was written, in red, rather than
 * breaking the page; nothing in it can run script or load anything (`trust` is off).
 */
export function typeset(node: HTMLElement, tex: string, display: boolean): void {
  try {
    katex.render(tex, node, { displayMode: display, throwOnError: false, errorColor: '#c0392b', strict: 'ignore', trust: false, maxExpand: 500, maxSize: 20, output: 'htmlAndMathml' });
    node.classList.add('qbl-math-set');
  } catch {
    node.textContent = tex;
  }
}

/** What is wrong with some TeX, or null when KaTeX can set it. For the editor, as the author types. */
export function texProblem(tex: string): string | null {
  try {
    katex.renderToString(tex, { throwOnError: true, strict: 'ignore', trust: false, maxExpand: 500 });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.replace(/^KaTeX parse error:\s*/, '') : 'This cannot be read';
  }
}
