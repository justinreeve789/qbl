import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { alignWordTimes, type Scenario } from '@qbl/shared';
import { startSite, type TestSite } from './servers';

/**
 * Characters' recorded voices: a voice is picked for a character, heard, and its lines recorded by
 * the text-to-speech service (a stand-in for Kokoro here), so the published scenario plays each
 * line with the time of every word.
 */
let tts: Server;
const asked: Array<{ input: string; voice: string; speed?: number }> = [];
let site: TestSite;
let browser: Browser;
let page: Page;
let id = 0;
const errors: string[] = [];

/** A few frames of MP3 that file type detection accepts. */
const mp3 = Buffer.concat([Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00', 'latin1'), ...Array.from({ length: 6 }, () => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(413)]))]);

async function rest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(res.ok, `${method} ${path}: ${res.status} ${await res.clone().text()}`);
  return (await res.json()) as T;
}
const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
const card = () => page.locator('dialog[data-panel=character]');

before(async () => {
  // Kokoro-FastAPI's captioned speech, as it answers: base64 audio and each word's start and end in seconds.
  tts = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url !== '/dev/captioned_speech') return void res.writeHead(404).end();
      const q = JSON.parse(body) as { input: string; voice: string; speed?: number };
      asked.push(q);
      const timestamps = q.input.split(/\s+/).flatMap((w, i) => [
        { word: w.replace(/[,.!?]$/, ''), start_time: i * 0.4, end_time: i * 0.4 + 0.3 },
        ...(/[,.!?]$/.test(w) ? [{ word: w.slice(-1), start_time: i * 0.4 + 0.3, end_time: i * 0.4 + 0.35 }] : []),
      ]);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ audio: mp3.toString('base64'), audio_format: 'mp3', timestamps }));
    });
  });
  await new Promise<void>((resolve) => tts.listen(0, '127.0.0.1', resolve));
  site = await startSite({ QBL_TTS_URL: `http://127.0.0.1:${(tts.address() as AddressInfo).port}` });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Voices');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);

  // Robo, who says two lines: one with the player's name, one with a score only known in play.
  const bundle = await rest<{ scenes: Array<{ id: number }> }>('GET', '');
  const robo = (await rest<{ row: { id: number } }>('POST', '/rows/characters', { name: 'Robo' })).row.id;
  const event = (await rest<{ row: { id: number } }>('POST', '/rows/events', { scene_id: bundle.scenes[0]!.id, kind: 'hotspot', shortname: 'talk', position_x: 300, position_y: 300, radius: 60 })).row.id;
  for (const text of ['Hello, {{QBLPlayerName}}! The reactor needs you.', 'You have {{score}} stars.']) {
    await rest('POST', '/rows/actions', { event_id: event, type: 'dialogue', params: { style: 'portrait', speaker: 'character', character_id: robo, text } });
  }
  await page.reload();
  await page.waitForSelector('.tabs');
});

after(async () => {
  await browser?.close();
  await site?.close();
  await new Promise((resolve) => tts?.close(resolve));
});

test('a character is given a voice from the list, and it can be heard', async () => {
  await page.click('.tabs >> text=Characters');
  await page.locator('.character-card', { has: page.locator('.card-title', { hasText: 'Robo' }) }).locator('[data-open=character]').click();
  const select = card().locator('[data-field=tts_voice] select');
  await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>('dialog[data-panel=character] [data-field=tts_voice] select')?.disabled);
  const groups = await select.locator('optgroup').evaluateAll((g) => g.map((x) => (x as HTMLOptGroupElement).label));
  assert.deepEqual(groups, ['Larger than life', 'Women', 'Men', 'Children', 'Robots and creatures']);
  assert.ok((await select.locator('optgroup[label="Larger than life"] option').count()) >= 20, 'with the theatrical voices (giants, pixies, villains) in a group of their own');
  assert.ok((await select.locator('option').count()) > 30, 'a good many voices to choose from');
  assert.match(await card().locator('.voice-note').innerText(), /0 of its 2 lines play a recording/);
  await select.selectOption('robot');
  await saved();
  assert.match(await card().locator('.voice-about').innerText(), /robot/i);
  const sample = page.waitForResponse((r) => r.url().endsWith('/voices/robot/sample'));
  await card().locator('button:has-text("Listen")').click();
  const heard = await sample;
  assert.equal(heard.headers()['content-type'], 'audio/mpeg');
  assert.equal(asked.at(-1)?.voice, 'af_alloy(0.5)+am_echo(0.5)', 'the sample is said in the voice, as the catalog makes it on Kokoro (a blend, its weights adding up to 1)');
  const draft = (await rest<{ scenario: Scenario }>('GET', '/preview')).scenario;
  assert.equal(draft.characters![0]!.tts_voice, 'robot');
});

test('recording its lines: the one that can be recorded plays a recording with every word timed', async () => {
  await card().locator('button:has-text("Record its lines")').click();
  await page.waitForSelector('.toast:has-text("Recorded 1 line")');
  assert.match(await page.locator('.toast').last().innerText(), /1 left to the browser’s voice/);
  assert.equal(asked.at(-1)?.input, 'Hello, explorer! The reactor needs you.', 'the player’s name is said as “explorer”');
  await page.waitForFunction(() => /1 of its 2 lines play a recording/.test(document.querySelector('dialog[data-panel=character] .voice-note')?.textContent ?? ''));

  await rest('POST', '/publish');
  const doc = (await rest<{ scenario: Scenario }>('GET', '/preview')).scenario;
  const lines = doc.scenes.flatMap((s) => s.hotspots.flatMap((h) => h.actions)).filter((a) => a.type === 'dialogue') as Array<{ text: string; narrate?: boolean; narration_media_id?: number }>;
  const voiced = lines.find((a) => a.text.startsWith('Hello'))!;
  assert.equal(voiced.narrate, true);
  const recording = doc.assets.find((m) => m.id === voiced.narration_media_id)!;
  assert.equal(recording.type, 'audio');
  assert.deepEqual(recording.speech!.words.map((w) => w.w), ['Hello', 'explorer', 'The', 'reactor', 'needs', 'you']);
  // In play the player's name is shown, and lights while "explorer" is said.
  const times = alignWordTimes('Hello, Sam! The reactor needs you.', recording.speech)!;
  assert.deepEqual(times, [0, 400, 800, 1200, 1600, 2000]);
  assert.equal(lines.find((a) => a.text.startsWith('You have'))!.narration_media_id, undefined, 'the line with a score is left to the browser');
  const audio = await fetch(`${site.url}${recording.url}`);
  assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
});

test('the Characters page records every line, and says when all are done', async () => {
  await page.keyboard.press('Escape');
  await page.waitForSelector('.voice-tools .chip:has-text("All 1 lines recorded")');
  const before = asked.length;
  await page.click('.voice-tools button:has-text("Record voices")');
  await page.waitForSelector('.toast:has-text("Every line was already recorded")');
  assert.equal(asked.length, before, 'nothing up to date is recorded again');
});

test('nothing went wrong in the browser along the way', () => {
  assert.deepEqual(errors, []);
});
