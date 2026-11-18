import type { GameContext } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';
import type { TeamRow } from '../ui/UiPort';

/** How often the teams box is brought up to date. */
const REFRESH_MS = 500;

/** What a team is called in the box: its name, or what its instance is. */
function teamName(key: string, name: string | undefined): string {
  if (name) return name;
  if (key === 'public') return 'Public game';
  return 'No team';
}

/**
 * The teams a teacher (or admin) can show or hide, in the scene they are in. Null where there is
 * nothing to choose: a student, or a scene every team shares (there everyone sees everyone).
 * One row per team with players in the game, besides the teacher, sorted by name.
 */
export function teamRows(ctx: GameContext): TeamRow[] | null {
  const { connection } = ctx;
  const me = connection.me;
  if (!me || !ctx.staff || !ctx.teamOnlyHere) return null;
  const rows = new Map<string, TeamRow>();
  connection.state.players.forEach((p, id) => {
    if (id === connection.sessionId) return;
    const key = p.team ?? '';
    let row = rows.get(key);
    if (!row) {
      row = { key, name: teamName(key, p.team_name), here: 0, total: 0, shown: !ctx.hiddenTeams.has(key) };
      rows.set(key, row);
    }
    row.total++;
    if (p.scene_id === me.scene_id) row.here++;
  });
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.key.localeCompare(b.key));
}

/**
 * For teachers looking in on a game played in teams. In a scene limited to teams, students see
 * only their own team; a teacher sees every team. A "Teams in this scene" tab then appears on
 * the side, with a box per team: untick one and its players are hidden, with what they say,
 * their emotes, moves and the events they show the scene. Every team is shown to begin with.
 */
export class TeamsFeature implements GameFeature {
  /** Bring the box up to date now. It also does so by itself, twice a second. */
  refresh: () => void = () => {};

  start(ctx: GameContext): () => void {
    const { ui } = ctx;
    let shown = '';
    const draw = () => {
      const rows = teamRows(ctx);
      const key = JSON.stringify(rows);
      if (key === shown) return;
      shown = key;
      ui.teams(rows, toggle);
    };
    const toggle = (key: string, on: boolean) => {
      if (on) ctx.hiddenTeams.delete(key);
      else ctx.hiddenTeams.add(key);
      draw();
    };
    draw();
    this.refresh = draw;
    const timer = setInterval(draw, REFRESH_MS);
    return () => {
      clearInterval(timer);
      ui.teams(null, () => {});
    };
  }
}
