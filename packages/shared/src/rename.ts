/**
 * Renaming a variable: everything in a scenario that names it follows the new name.
 *
 * A variable is named in:
 * - a condition's `variable` (and the `variable` a bench readout, watch or graph keeps its value in);
 * - a Variable action's `name` (an action row of the editor keeps it in `params.name`);
 * - `{{name}}` in any text;
 * - an infobox's rich blocks: `data-var`, `data-check` and `data-series` name it, and the formulas
 *   and conditions of `data-formula`, `data-accept`, `data-fn`, `data-points` and `data-when`
 *   may read it;
 * - a scenario document's own `global_variables[].variable_name`.
 *
 * What does not change is given back as the same object, so a caller can tell what did.
 */

const PLACEHOLDER = /\{\{(\s*)([A-Za-z_]\w*)((?::[\w-]+)?\s*)\}\}/g;
/** An opening tag, running to the first ">" outside quotes (a `when` block's conditions may hold one). */
const TAG = /<[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const ATTR = /(\s)(data-[a-z]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
/** Attributes whose whole value is a variable's name. */
const NAMES = new Set(['data-var', 'data-check', 'data-series']);
/** Attributes holding formulas or lists of names, where the name is a word among others. */
const FORMULAS = new Set(['data-formula', 'data-accept', 'data-fn', 'data-points']);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace `from` where it stands as a word of a formula (not part of a longer name or a number like 1e5). */
function inFormula(source: string, from: string, to: string): string {
  return source.replace(new RegExp(`(?<![\\w.])${escapeRegex(from)}(?![\\w])`, 'g'), to);
}

/** A `when` block's conditions: `v >= 4; battery = 1`. Only the names on the left are variables. */
function inWhen(spec: string, from: string, to: string): string {
  return spec.replace(new RegExp(`(^|[;,])(\\s*)${escapeRegex(from)}(?=\\s*(?:!=|<=|>=|=|<|>))`, 'g'), `$1$2${to}`);
}

function inAttribute(name: string, value: string, from: string, to: string): string {
  if (NAMES.has(name)) return value.trim() === from ? value.replace(from, to) : value;
  if (name === 'data-when') return inWhen(value, from, to);
  // In a curve, x is the axis, not a variable.
  if (name === 'data-fn' && from === 'x') return value;
  if (FORMULAS.has(name)) return inFormula(value, from, to);
  return value;
}

/** A text with `from` renamed in its `{{…}}` placeholders and its rich blocks. */
export function renameVariableInText(text: string, from: string, to: string): string {
  let out = text;
  if (out.includes('{{')) {
    out = out.replace(PLACEHOLDER, (whole, before: string, name: string, after: string) =>
      name === from && !after.trim().startsWith(':') ? `{{${before}${to}${after}}}` : whole);
  }
  if (/data-qbl/i.test(out)) {
    out = out.replace(TAG, (tag) => {
      if (!/\sdata-qbl\s*=/i.test(tag)) return tag;
      return tag.replace(ATTR, (whole, space: string, name: string, eq: string, dq?: string, sq?: string, bare?: string) => {
        const value = dq ?? sq ?? bare ?? '';
        const now = inAttribute(name.toLowerCase(), value, from, to);
        if (now === value) return whole;
        const quote = dq != null ? '"' : sq != null ? "'" : '';
        return `${space}${name}${eq}${quote}${now}${quote}`;
      });
    });
  }
  return out;
}

/**
 * `value` with the variable `from` called `to` everywhere it is named. Unchanged parts (and an
 * unchanged whole) are the same objects as before.
 */
export function renameVariable<T>(value: T, from: string, to: string): T {
  if (!from || from === to) return value;
  const walk = (v: unknown, depth: number): unknown => {
    if (v == null || depth > 40) return v;
    if (typeof v === 'string') return renameVariableInText(v, from, to);
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => {
        const y = walk(x, depth + 1);
        if (y !== x) changed = true;
        return y;
      });
      return changed ? out : v;
    }
    if (typeof v !== 'object') return v;
    const record = v as Record<string, unknown>;
    const variableAction = record.type === 'variable';
    let out: Record<string, unknown> | null = null;
    for (const [key, x] of Object.entries(record)) {
      let y: unknown;
      if ((key === 'variable' || key === 'variable_name') && x === from) y = to;
      else if (key === 'name' && variableAction && x === from) y = to;
      else if (key === 'params' && variableAction && x && typeof x === 'object' && (x as Record<string, unknown>).name === from) {
        y = walk({ ...(x as Record<string, unknown>), name: to }, depth + 1);
      } else y = walk(x, depth + 1);
      if (y !== x) (out ??= { ...record })[key] = y;
    }
    return out ?? v;
  };
  return walk(value, 0) as T;
}
