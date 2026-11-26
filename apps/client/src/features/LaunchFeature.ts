import { launcherScenes, type LaunchBroadcast, type Scene } from '@qbl/shared';
import type { GameContext, LaunchableAssignment } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';
import type { LaunchRow, LaunchView } from '../ui/UiPort';

/** How often the tab's counts of who is here are brought up to date. */
const REFRESH_MS = 1000;
/**
 * Sent straight to a mission, a player whose scene could not run the travel at once (they were
 * between scenes) goes anyway after this long.
 */
const STRAIGHT_THERE_MS = 4000;

const sceneName = (scene: Scene) => (scene.subtitle || scene.shortname || `Scene ${scene.id}`).replace(/[-_]+/g, ' ');

/**
 * The missions a teacher can launch from this game, as the tab lists them: their assignments of
 * other missions, those still waiting for them first, then soonest due. `here` counts the
 * assignment's students who are in this game now.
 */
export function launchRows(ctx: GameContext, assignments: LaunchableAssignment[]): LaunchRow[] {
  const present = new Set<string>();
  ctx.connection.state.players.forEach((p, id) => {
    if (id !== ctx.connection.sessionId && p.connected) present.add(String(p.user_id));
  });
  const here = Number(ctx.scenario.id);
  const due = (a: LaunchableAssignment) => (a.due_at ? Date.parse(`${a.due_at.replace(' ', 'T')}Z`) : Infinity);
  return assignments
    .filter((a) => a.scenario && Number(a.scenario.id) !== here)
    .sort((a, b) => Number(!!b.waiting) - Number(!!a.waiting) || due(a) - due(b) || b.id - a.id)
    .map((a) => ({
      assignmentId: a.id,
      title: a.scenario!.title,
      waiting: !!a.waiting,
      here: a.students.filter((s) => present.has(String(s.id))).length,
      students: a.students.length,
    }));
}

/** What the tab shows: the missions, and this mission's scenario launcher scenes (isLauncherScene). */
export function launchView(ctx: GameContext, assignments: LaunchableAssignment[]): LaunchView {
  return {
    missions: launchRows(ctx, assignments),
    departures: launcherScenes(ctx.scenario).map((s) => ({ sceneId: s.id, name: sceneName(s) })),
  };
}

/**
 * Launching missions. A teacher playing with their class launches one of their assignments from
 * the "Launch a mission" tab; the game server opens it to its students and sends those who are
 * here into it. For every player, this is where that arrives: they are told, QL_SCENARIO_LAUNCH_URL
 * and QL_NextMission are set (GameContext.launched), and they are either taken to the launcher
 * scene the teacher chose (whose events play the departure and end with an Open URL action to
 * `{{QL_SCENARIO_LAUNCH_URL}}`, or a travel action) or straight to the mission, by a travel action
 * run in the scene they are in, so that scene's end events run first, as they do for any way out.
 */
export class LaunchFeature implements GameFeature {
  /** Bring the teacher's tab up to date now (and read their assignments again). */
  refresh: () => void = () => {};

  start(ctx: GameContext): () => void {
    const { ui, connection } = ctx;
    const offs: Array<() => void> = [connection.on('launch', (m) => this.receive(ctx, m))];
    let stopped = false;

    if (ctx.staff && ctx.fetchLaunchable) {
      const fetch = ctx.fetchLaunchable;
      let assignments: LaunchableAssignment[] = [];
      let shown = '';
      const draw = () => {
        const view = launchView(ctx, assignments);
        const key = JSON.stringify(view);
        if (key === shown) return;
        shown = key;
        ui.launches(view, (choice) => {
          connection.launch({ assignment_id: choice.assignmentId, ...(choice.sceneId != null ? { scene_id: choice.sceneId } : {}), ...(choice.stay ? { stay: true } : {}) });
          // A mission that was waiting is not any more: read the list again once the launch has gone through.
          setTimeout(load, 1500);
        });
      };
      const load = () => {
        void fetch().then((list) => {
          if (stopped) return;
          assignments = list;
          draw();
        }, () => undefined);
      };
      ui.launches({ missions: [], departures: launchView(ctx, []).departures }, () => {});
      load();
      this.refresh = load;
      const tick = setInterval(draw, REFRESH_MS);
      offs.push(() => clearInterval(tick));
    } else {
      ui.launches(null, () => {});
    }

    return () => {
      stopped = true;
      clearTimeout(this.pending);
      for (const off of offs) off();
      ui.launches(null, () => {});
    };
  }

  private pending: ReturnType<typeof setTimeout> | undefined;

  /** A launch reached this player: where they are going, and how. */
  receive(ctx: GameContext, launch: LaunchBroadcast): void {
    ctx.launched = launch;
    ctx.ui.toast(`🚀 ${launch.by} launched ${launch.title}!`, 4000);
    if (launch.scene_id != null) {
      // The game server has already put them there; their game follows, through this scene's end events.
      void ctx.inScene?.([{ type: 'jump', scene_id: launch.scene_id }]);
      return;
    }
    void ctx.inScene?.([{ type: 'travel' }]);
    // Between two scenes there is no scene to run it in: go anyway.
    clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      if (ctx.launched === launch && !ctx.departed) ctx.leaveFor(launch);
    }, STRAIGHT_THERE_MS);
  }
}
