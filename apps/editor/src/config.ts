/**
 * Where the game is served. In production the game and the editor share an origin ("/{code}",
 * "/play" and "/editor/"; "/" itself is the marketing page). In development they are two Vite
 * servers, so the game's address is configured.
 */
const env = import.meta.env ?? {};

export const config = {
  gameUrl: ((env.VITE_GAME_URL as string | undefined) ?? '/').replace(/\/?$/, '/'),
};

/** Address that plays a draft scenario in the game, starting in the given scene. */
export function previewUrl(scenarioId: number, sceneId?: number, debug = false): string {
  const params = new URLSearchParams({ preview: String(scenarioId) });
  if (sceneId != null) params.set('scene', String(sceneId));
  if (debug) params.set('debug', '1');
  return `${config.gameUrl}play?${params}`;
}

/** Address players use for a published scenario. */
export function playUrl(code: string): string {
  return new URL(`${config.gameUrl}${code}`, window.location.href).href;
}
