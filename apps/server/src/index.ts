import path from 'node:path';
import { defineRoom, defineServer } from 'colyseus';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { normalizeScenario, ROOM_NAME, validateScenario } from '@qbl/shared';
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

/**
 * With the file backend this server stands in for the parts of the QBL API
 * the client calls, so the game runs with no other service. The routes and
 * payloads match docs/docs/api.md.
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
        ? await services.backend.loadSession(scenario.id, user.id)
        : null;
      res.json({ scenario: { ...scenario, session } });
    } catch {
      res.status(404).json({ message: 'Scenario not found.' });
    }
  });
}

const server = defineServer({
  rooms: {
    // Players are matched into the same room when scenario and group agree.
    [ROOM_NAME]: defineRoom(ScenarioRoom).filterBy(['scenario', 'group']),
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
