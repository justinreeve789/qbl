const env = import.meta.env;
const params = new URLSearchParams(window.location.search);

/** Players open /{code}: the scenario's unique 16-letter code. */
const codeInPath = /^\/([A-Za-z]{16})\/?$/.exec(window.location.pathname)?.[1]?.toLowerCase() ?? null;
const number = (value: string | null) => (value && /^\d+$/.test(value) ? Number(value) : null);

/** Same-origin paths by default: Apache (or the Vite dev proxy) routes /api and the game socket. */
export const config = {
  apiUrl: (env.VITE_API_URL ?? '').replace(/\/+$/, ''),
  /** Colyseus endpoint. Empty means "this host, under /game". */
  serverUrl: env.VITE_SERVER_URL ?? `${window.location.origin}/game`,
  /** guest: pick a name (file backend). login: email and password (Laravel API). */
  authMode: (env.VITE_AUTH_MODE ?? 'guest') as 'guest' | 'login',
  /**
   * No scenario was asked for (/missions, or /play with no parameters): show the missions page
   * (public missions and those a teacher assigned). Where the backend has no missions to list,
   * the default scenario is played. "/" itself is the marketing page, not the game.
   */
  home: codeInPath == null && !params.has('scenario') && !params.has('preview') && !params.has('offline'),
  /** Which scenario to play: the code in the path, else ?scenario=, else the demo. */
  scenario: codeInPath ?? params.get('scenario') ?? env.VITE_DEFAULT_SCENARIO ?? 'starshipexplorer',
  /**
   * Editor preview: play the unpublished draft of this scenario id, alone, with nothing saved.
   * Opened by the editor's "Test this scene" button; needs the editor's sign-in.
   */
  preview: number(params.get('preview')),
  /** Start in this scene instead of the start scene or the saved one. */
  startScene: number(params.get('scene')),
  /** Which instance of the scenario to join: the public one, an assignment's ("a12") or a team's ("t7"). */
  group: params.get('group') || 'public',
  /**
   * The room to share with other teams. The API says which room a team belongs to (its
   * assignment's); this is for trying teams out with the file backend: `?group=red&party=class`.
   */
  party: params.get('party'),
  /** Play alone without the game server. Used for content previews. */
  offline: params.has('offline') || params.has('preview'),
  debug: params.has('debug'),
};
