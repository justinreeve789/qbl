import path from 'node:path';

const env = process.env;
const bool = (v: string | undefined, fallback: boolean) => (v === undefined ? fallback : ['1', 'true', 'yes'].includes(v.toLowerCase()));

export const config = {
  port: Number(env.PORT ?? 2567),
  /**
   * file: scenarios and saves are JSON files on disk, and this server also
   *       answers the small part of the HTTP API the client needs. For local
   *       development and content previews.
   * api:  scenarios, logins and saves come from the QBL (Laravel) API.
   */
  backend: (env.QBL_BACKEND ?? 'file') as 'file' | 'api',
  scenarioDir: path.resolve(env.QBL_SCENARIO_DIR ?? '../../scenarios'),
  saveDir: path.resolve(env.QBL_SAVE_DIR ?? '../../.data/saves'),
  apiUrl: (env.QBL_API_URL ?? 'http://api:8000').replace(/\/+$/, ''),
  serviceKey: env.QBL_SERVICE_KEY ?? '',
  corsOrigin: env.QBL_CORS_ORIGIN ?? '*',
  /** Seconds a dropped connection keeps its place in the room. */
  reconnectSeconds: Number(env.QBL_RECONNECT_SECONDS ?? 30),
  /** Seconds between periodic saves of everyone in a room. */
  saveIntervalSeconds: Number(env.QBL_SAVE_INTERVAL_SECONDS ?? 30),
  /** Seconds a scenario document is cached before it is fetched again. */
  scenarioCacheSeconds: Number(env.QBL_SCENARIO_CACHE_SECONDS ?? 30),
  /** Newline-separated words that may not appear in free chat. */
  blocklistFile: env.QBL_CHAT_BLOCKLIST ?? '',
  devMode: bool(env.QBL_DEV_MODE, env.NODE_ENV !== 'production'),
};

if (config.backend === 'api' && !config.serviceKey) {
  throw new Error('QBL_SERVICE_KEY is required when QBL_BACKEND=api');
}
