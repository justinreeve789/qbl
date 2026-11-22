import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Window } from 'happy-dom';

/**
 * The science parts of an infobox, as the page has them: values worked out with math.js as
 * sliders move, answers checked with their units, graph points and what the sanitiser keeps.
 * (Typesetting and the drawn graph are checked in a real browser, by the editor's suites.)
 */

const GLOBALS = ['window', 'document', 'DOMParser', 'Node', 'HTMLElement', 'HTMLInputElement', 'HTMLHRElement', 'HTMLTextAreaElement', 'Event', 'KeyboardEvent'];
const saved: Record<string, unknown> = {};
let win: Window;
let buildContent: typeof import('../src/ui/infobox/content').buildContent;
let infoboxView: typeof import('../src/ui/infobox/view').infoboxView;
let sanitizeHtml: typeof import('../src/ui/sanitize').sanitizeHtml;

before(async () => {
  for (const k of GLOBALS) saved[k] = (globalThis as Record<string, unknown>)[k];
  win = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, Object.fromEntries(GLOBALS.map((k) => [k, k === 'window' ? win : (win as unknown as Record<string, unknown>)[k]])));
  ({ buildContent } = await import('../src/ui/infobox/content'));
  ({ infoboxView } = await import('../src/ui/infobox/view'));
  ({ sanitizeHtml } = await import('../src/ui/sanitize'));
});

after(async () => {
  await win.happyDOM.close();
  for (const k of GLOBALS) (globalThis as Record<string, unknown>)[k] = saved[k];
});

const env = (vars: Record<string, unknown> = {}) => ({ layer: document.createElement('div'), motion: false, vars: (n: string) => vars[n] });
const slide = (input: HTMLInputElement, value: number) => {
  input.value = String(value);
  input.dispatchEvent(new Event('input'));
};

test('a worked-out value follows the sliders, and is saved with them', async () => {
  const content = buildContent(
    `<div data-qbl="panel"><input data-qbl="slider" data-var="mass" data-min="0" data-max="100" data-value="30" data-label="Mass">
<input data-qbl="slider" data-var="volume" data-min="1" data-max="50" data-value="10" data-label="Volume"></div>
<p>Density: <span data-qbl="calc" data-formula="mass / volume * scale" data-digits="1" data-unit="g/mL" data-var="density"></span></p>
<p><span data-qbl="calc" data-formula="mass / nothing"></span></p>
<div data-qbl="when" data-when="density > 5">Heavier than iron!</div>`,
    env({ scale: 2 }),
  );
  await content.ready;
  const page = content.pages[0]!;
  const [shown, broken] = [...page.querySelectorAll('span[data-qbl="calc"]')];
  assert.equal(shown!.textContent, '6 g/mL');
  assert.equal(broken!.textContent, '–', 'a name nobody has');
  assert.equal(content.controls.values().density, '6');
  assert.equal((page.querySelector('[data-qbl="when"]') as HTMLElement).hidden, false, 'what is worked out can be tested like a control');
  const [mass, volume] = [...page.querySelectorAll<HTMLInputElement>('input[data-qbl="slider"]')];
  slide(mass!, 45);
  slide(volume!, 40);
  assert.equal(shown!.textContent, '2.3 g/mL');
  assert.equal(content.controls.values().density, '2.25');
  assert.equal((page.querySelector('[data-qbl="when"]') as HTMLElement).hidden, true);
  content.destroy();
});

test('a checked answer says whether it was right, units and all, when a button is chosen', async () => {
  const chosen: Array<Record<string, string>> = [];
  const box = infoboxView(
    `<p>How fast does it fall?</p><input data-qbl="answer" data-var="guess" data-accept="g m/s^2" data-tolerance="2%" data-check="guess_ok">
<input data-qbl="answer" data-var="gas" data-accept="carbon dioxide | CO2" data-check="gas_ok">`,
    [{ label: 'Check', mark: 'try_again' }, { label: 'Give up' }],
    { ...env({ g: 9.8 }), dismissible: false, chosen: (_i, answers) => void chosen.push(answers) },
  );
  document.body.append(box.node);
  box.start();
  const [guess, gas] = [...box.node.querySelectorAll<HTMLInputElement>('input[data-qbl="answer"]')];
  // A wrong try shows for a moment (MARK_MS) before the buttons take presses again.
  const press = async (label: string) => {
    [...box.node.querySelectorAll<HTMLButtonElement>('button.qbl-choice')].find((b) => b.textContent === label)!.click();
    await new Promise((r) => setTimeout(r, 800));
  };
  guess!.value = '970 cm/s^2';
  gas!.value = 'Oxygen';
  await press('Check');
  assert.deepEqual(chosen.at(-1), { guess: '970 cm/s^2', gas: 'Oxygen', guess_ok: '1', gas_ok: '0' });
  guess!.value = '9.8';
  gas!.value = ' co2';
  await press('Give up');
  assert.deepEqual(chosen.at(-1), { guess: '9.8', gas: ' co2', guess_ok: '0', gas_ok: '1' });
  assert.equal(await box.result, 1);
});

test('a graph keeps its points for the box to save, where they were left', async () => {
  const content = buildContent(
    '<div data-qbl="graph" data-fn="m*x + c" data-points="ax,ay=1,2; bx,by=4,5" data-join="line" data-series="log" data-xlabel="x"></div>',
    env({ bx: 3, by: '-1.5', log: '0,0;1,2' }),
  );
  assert.deepEqual(content.controls.values(), { ax: '1', ay: '2', bx: '3', by: '-1.5' });
  assert.ok(content.pages[0]!.querySelector('.qbl-graph'));
  content.destroy();
});

test('the sanitiser keeps the science blocks and nothing that is not theirs', () => {
  const holder = document.createElement('div');
  holder.append(sanitizeHtml(
    `<span data-qbl="math" data-tex="x^2" onclick="x()">x^2</span><div data-qbl="math" data-tex="\\ce{H2O}"></div>
<span data-qbl="calc" data-formula="a+b" data-digits="1" data-unit="cm" data-var="sum"></span><span data-formula="a+b" data-tex="x">plain</span>
<input data-qbl="answer" data-var="a" data-accept="5 m" data-tolerance="1%" data-check="a_ok"><input data-qbl="answer" data-var="b" data-check="not a name">
<input data-qbl="slider" data-var="s" data-accept="5">
<div data-qbl="graph" data-fn="sin(x)" data-x="0,6" data-points="px,py=1,1" data-series="log" data-join="line" data-snap="1" data-xlabel="t" style="x"></div>
<div data-fn="sin(x)" data-series="log">not a graph</div>`,
  ));
  const html = holder.innerHTML;
  assert.match(html, /<span data-qbl="math" data-tex="x\^2">x\^2<\/span>/);
  assert.match(html, /<div data-qbl="math" data-tex="\\ce\{H2O\}"><\/div>/);
  assert.match(html, /<span data-qbl="calc" data-var="sum" data-formula="a\+b" data-digits="1" data-unit="cm"><\/span><span>plain<\/span>/);
  assert.match(html, /data-accept="5 m" data-tolerance="1%" data-check="a_ok"/);
  assert.doesNotMatch(html, /not a name|onclick|style/);
  assert.doesNotMatch(holder.querySelector('input[data-qbl="slider"]')!.outerHTML, /data-accept/);
  assert.match(html, /<div data-qbl="graph" data-fn="sin\(x\)" data-x="0,6" data-points="px,py=1,1" data-join="line" data-series="log" data-snap="1" data-xlabel="t"><\/div>/);
  assert.match(html, /<div>not a graph<\/div>/);
});
