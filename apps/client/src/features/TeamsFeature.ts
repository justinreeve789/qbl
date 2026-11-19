import type { Id } from '@qbl/shared';
import type { GameContext, TeamChoice } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';
import type { TeamRow } from '../ui/UiPort';

/** How often the tab's counts are brought up to date. */
const REFRESH_MS = 1000;

/** How many of a team's players are in the game now, and the scene where most of them are (its id and name). */
function teamWhere(ctx: GameContext, group: string): { online: number; sceneId?: Id; where?: string } {
  const { connection } = ctx;
  const count = new Map<number, number>();
  let online = 0;
  connection.state.players.forEach((p, id) => {
    if (id === connection.sessionId || (p.team ?? '') !== group || !p.connected) return;
    online++;
    count.set(p.scene_id, (count.get(p.scene_id) ?? 0) + 1);
  });
  let sceneId: number | undefined;
  for (const [id, n] of count) if (sceneId === undefined || n > count.get(sceneId)!) sceneId = id;
  const scene = sceneId != null ? ctx.index.scene(sceneId) : undefined;
  const name = scene ? (scene.subtitle || scene.shortname || '').replace(/[-_]+/g, ' ') : '';
  return { online, sceneId, where: name || undefined };
}

/**
 * The teams a teacher can follow, as the tab lists them. Null where there is nothing to choose:
 * a student, or a game that is not one of the teacher's assignments with teams.
 */
export function teamRows(ctx: GameContext, choices: TeamChoice[]): TeamRow[] | null {
  const me = ctx.connection.me;
  if (!me || !ctx.staff || !choices.length) return null;
  const mine = me.team ?? '';
  return choices.map((c) => {
    const { online, where } = teamWhere(ctx, c.group);
    return { group: c.group, name: c.name, current: c.group === mine, online, where };
  });
}

/**
 * For teachers (and admins). A teacher plays an assignment as a member of one team's game at a
 * time: they see what that team sees (each team's world can differ: items, hotspots, events) and
 * the team sees them. Where the assignment has teams, a "Team you are following" tab lists them;
 * choosing another team leaves this game and joins that team's, in the scene where most of it is.
 */
export class TeamsFeature implements GameFeature {
  /** Bring the tab up to date now. It also does so by itself, once a second. */
  refresh: () => void = () => {};

  start(ctx: GameContext): () => void {
    const { ui } = ctx;
    if (!ctx.staff || !ctx.fetchTeams) {
      ui.teams(null, () => {});
      return () => {};
    }
    let choices: TeamChoice[] = [];
    let shown = '';
    const follow = (group: string) => {
      if (group === (ctx.connection.me?.team ?? '')) return;
      ctx.followTeam?.(group, teamWhere(ctx, group).sceneId);
    };
    const draw = () => {
      const rows = teamRows(ctx, choices);
      const key = JSON.stringify(rows);
      if (key === shown) return;
      shown = key;
      ui.teams(rows, follow);
    };
    let stopped = false;
    void ctx.fetchTeams().then((list) => {
      if (stopped) return;
      choices = list;
      draw();
    });
    this.refresh = draw;
    const timer = setInterval(draw, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      ui.teams(null, () => {});
    };
  }
}
