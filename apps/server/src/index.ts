import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineRoom, defineServer } from 'colyseus';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { cleanNotebook, normalizeScenario, ROOM_NAME, validateScenario } from '@qbl/shared';
import { ApiBackend } from './backend/ApiBackend.js';
import { withScenarioCache } from './backend/Backend.js';
import { FileBackend } from './backend/FileBackend.js';
import { config } from './config.js';
import { ChatFilter } from './rooms/chat.js';
import { ScenarioRoom, services } from './rooms/ScenarioRoom.js';

const backend =
  config.backend === 'api'
    ? new ApiBackend(config.apiUrl, config.serviceKey)
    : new FileBackend(config.scenarioDir, config.saveDir);

services.backend = withScenarioCache(backend, config.scenarioCacheSeconds);
services.chat = new ChatFilter(config.blocklistFile || undefined);

function cors(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

/**
 * With the file backend this server stands in for the parts of the QBL API
 * the client calls, so the game runs with no other service. The routes and
 * payloads match docs/src/content/docs/developers/api.md.
 */
function mountFileApi(app: Express) {
  const bearer = (req: Request) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || null;

  app.post('/api/auth/guest', express.json(), async (req, res) => {
    const token = FileBackend.issueGuestToken(String(req.body?.name ?? 'Guest'));
    res.json({ token, user: await services.backend.verifyToken(token) });
  });

  app.get('/api/me', async (req, res) => {
    const token = bearer(req);
    const user = token ? await services.backend.verifyToken(token) : null;
    if (!user) {
      res.status(401).json({ message: 'Unauthenticated.' });
      return;
    }
    res.json({ user });
  });

  app.get('/api/scenarios/:key/play', async (req, res) => {
    try {
      const raw = await services.backend.getScenario(String(req.params.key));
      const check = validateScenario(raw);
      if (!check.ok) {
        res.status(422).json({ message: 'Scenario failed validation.', errors: check.errors });
        return;
      }
      const scenario = normalizeScenario(raw);
      const token = bearer(req);
      const user = token ? await services.backend.verifyToken(token) : null;
      if (scenario.require_login && !user) {
        res.status(401).json({ message: 'Unauthenticated.' });
        return;
      }
      const session = user && scenario.enable_save_session
        ? await services.backend.loadSession(scenario.id, user.id, String(req.query.group ?? 'public').slice(0, 64) || 'public')
        : null;
      const group = String(req.query.group ?? 'public').slice(0, 64) || 'public';
      const instance = { group, party: String(req.query.party ?? group).slice(0, 64) || group };
      res.json({ scenario: { ...scenario, session, instance } });
    } catch {
      res.status(404).json({ message: 'Scenario not found.' });
    }
  });

  // Players' notebooks (App\Qbl\Notebooks in the API), one JSON file each beside the saves.
  const notebookFile = async (req: Request, res: Response): Promise<string | null> => {
    const token = bearer(req);
    const user = token ? await services.backend.verifyToken(token) : null;
    if (!user) {
      res.status(401).json({ message: 'Unauthenticated.' });
      return null;
    }
    const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
    const group = String(req.query.group ?? 'public').slice(0, 64) || 'public';
    return path.join(config.saveDir, 'notebooks', `${safe(String(req.params.key))}.${safe(group)}.${safe(String(user.id))}.json`);
  };
  app.get('/api/notebooks/:key', async (req, res) => {
    const file = await notebookFile(req, res);
    if (!file) return;
    const raw = await readFile(file, 'utf8').then((t) => JSON.parse(t) as unknown, () => null);
    res.json({ notebook: cleanNotebook(raw), updated_at: null });
  });
  app.put('/api/notebooks/:key', express.json({ limit: '2mb' }), async (req, res) => {
    const file = await notebookFile(req, res);
    if (!file) return;
    const notebook = cleanNotebook(req.body?.notebook);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(notebook));
    res.json({ notebook, updated_at: new Date().toISOString() });
  });
}

const server = defineServer({
  rooms: {
    // Players are matched into the same room when scenario and party agree; a room holds one or more teams.
    [ROOM_NAME]: defineRoom(ScenarioRoom).filterBy(['scenario', 'party']),
  },
  express: (app) => {
    app.use(cors);
    app.get('/healthz', (_req, res) => {
      res.json({ ok: true, backend: config.backend });
    });
    if (config.backend === 'file') mountFileApi(app as unknown as Express);
    // Scenario media stored next to the scenario files. Served in both modes until the API has media storage.
    app.use('/scenario-assets', express.static(path.join(config.scenarioDir, 'assets'), { maxAge: '1h' }));
  },
  devMode: false,
});

server.listen(config.port);
console.log(`QBL game server listening on :${config.port} (${config.backend} backend)`);
