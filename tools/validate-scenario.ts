/**
 * Validate scenario JSON files against the QBL spec.
 *   npm run validate -- scenarios/starship.json [more.json ...]
 * Exits non-zero if any file has errors.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeScenario, resolveMediaUrl, validateScenario, type Scenario } from '../packages/shared/src/index.js';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: validate-scenario <file.json> [...]');
  process.exit(2);
}

let failed = false;
for (const file of files) {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Scenario;
  const result = validateScenario(raw);
  const scenario = normalizeScenario(raw);

  // When assets are served from the folder next to the scenario, check the files are really there.
  const missing: string[] = [];
  const base = scenario.asset_base_url ?? '';
  if (base.startsWith('/scenario-assets/')) {
    for (const media of scenario.assets ?? []) {
      const url = resolveMediaUrl(scenario, media);
      if (!url || !url.startsWith('/scenario-assets/')) continue;
      const local = path.join(path.dirname(file), 'assets', url.slice('/scenario-assets/'.length));
      if (!existsSync(local)) missing.push(`media ${media.id}: ${local}`);
    }
  }

  const actions = scenario.scenes.reduce(
    (n, s) => n + [...(s.start_events ?? []), ...(s.end_events ?? []), ...(s.hotspots ?? []), ...(s.indirect_events ?? [])].reduce((m, e) => m + e.actions.length, 0),
    0,
  );
  console.log(`${file}: ${scenario.scenes.length} scenes, ${(scenario.assets ?? []).length} assets, ${actions} actions`);
  for (const w of result.warnings) console.log(`  warning  ${w.path}: ${w.message}`);
  for (const e of result.errors) console.log(`  ERROR    ${e.path}: ${e.message}`);
  for (const m of missing) console.log(`  ERROR    missing file for ${m}`);
  if (!result.ok || missing.length) failed = true;
  else console.log('  ok');
}
process.exit(failed ? 1 : 0);
