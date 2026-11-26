/**
 * Launching a mission: a teacher, playing with their class, sends the students there into another
 * mission (one of the teacher's assignments). The API says where each student goes; these rules
 * decide who in the room is sent, where the teacher goes, and what the teacher is told. They are
 * the game server's, kept here (like World's) so they are tested without Colyseus.
 */
import { isStaff } from './roles.js';
import { forEachAction } from './scenario.js';
import type { Id, Scenario, Scene } from './types.js';

/** What the API answers when an assignment is launched (ClassStore::launch). */
export interface LaunchPlan {
  assignment_id: number;
  scenario_id: Id;
  /** The mission's code: players open it at /{code}. */
  code: string;
  title: string;
  /** The room its instances share. */
  party: string;
  /** Every student of the assignment, and the instance they play in (their team's, or the assignment's). */
  students: Array<{ id: number | string; group: string }>;
}

/** Someone in the room, as far as a launch is concerned. */
export interface LaunchSeat {
  sessionId: string;
  userId: string;
  role: string;
}

export interface LaunchOutcome {
  /** Who goes, and into which instance. The teacher is last, unless they stay. */
  go: Array<{ sessionId: string; group: string }>;
  /** What the teacher is told: how many went, and how many students here are not in that mission. */
  report: string;
}

/**
 * Who a launch sends where. The students of the assignment who are in the room go into their own
 * instance of it; anyone else here stays. The teacher (unless `stay`) goes into the instance most
 * of those students went into, so they arrive with the biggest group (they can follow another team
 * from there), or with nobody here going, the first team's.
 */
export function planLaunch(plan: LaunchPlan, seats: LaunchSeat[], teacher: string, stay = false): LaunchOutcome {
  const groupOf = new Map(plan.students.map((s) => [String(s.id), s.group]));
  const go: LaunchOutcome['go'] = [];
  const count = new Map<string, number>();
  let left = 0;
  for (const seat of seats) {
    if (seat.sessionId === teacher) continue;
    const group = groupOf.get(seat.userId);
    if (!group) {
      if (!isStaff(seat.role)) left++;
      continue;
    }
    go.push({ sessionId: seat.sessionId, group });
    count.set(group, (count.get(group) ?? 0) + 1);
  }
  const sent = go.length;
  if (!stay) {
    let mine = plan.students[0]?.group ?? plan.party;
    for (const [group, n] of count) if (n > (count.get(mine) ?? 0)) mine = group;
    go.push({ sessionId: teacher, group: mine });
  }
  const who = (n: number) => (n === 1 ? '1 student' : `${n} students`);
  const report = sent
    ? `🚀 ${plan.title} is launched: ${who(sent)} here ${sent === 1 ? 'is' : 'are'} on the way.${left ? ` ${who(left)} here ${left === 1 ? 'is' : 'are'} not in it and stay${left === 1 ? 's' : ''}.` : ''}`
    : `🚀 ${plan.title} is launched: it is on its students’ missions page now. Nobody here is in it${left ? `; the ${who(left)} here stay` : ''}.`;
  return { go, report };
}

/** Whether a scene has an action that leaves for the launched scenario: a travel action, or an Open URL to it. */
export function leavesForLaunch(scene: Scene): boolean {
  let found = false;
  forEachAction(scene, (a) => {
    if (a.type === 'travel') found = true;
    if (a.type === 'open_url' && LAUNCH_URL_PLACEHOLDER.test(String(a.url ?? ''))) found = true;
  });
  return found;
}

/** `{{QL_SCENARIO_LAUNCH_URL}}` in an address, however it is spaced. */
export const LAUNCH_URL_PLACEHOLDER = /\{\{\s*QL_SCENARIO_LAUNCH_URL\s*\}\}/;

/**
 * Whether an Open URL's address is the launched scenario and nothing else. It always opens in the
 * same tab: a new tab would leave the student in this scenario's room as well, and a browser
 * may block a tab opened at the end of a cutscene. The editor unticks "Open in new tab" and
 * won't let it be ticked until the address is something else.
 */
export function isLaunchUrlOnly(url: unknown): boolean {
  return /^\s*\{\{\s*QL_SCENARIO_LAUNCH_URL\s*\}\}\s*$/.test(String(url ?? ''));
}

/**
 * Whether a scene is a scenario launcher scene: one a teacher can send their class to before the
 * scenario they launch opens. Its own setting says so ("Use as a scenario launcher scene"); a scene
 * without the setting is one when it has a travel action, as departure scenes were before it.
 */
export function isLauncherScene(scene: Scene): boolean {
  if (scene.launcher != null) return scene.launcher === true;
  let travel = false;
  forEachAction(scene, (a) => {
    if (a.type === 'travel') travel = true;
  });
  return travel;
}

/** The scenes a teacher can send their class to on the way to a launched scenario. */
export function launcherScenes(scenario: Scenario): Scene[] {
  return scenario.scenes.filter(isLauncherScene);
}

/** @deprecated The old names: a departure scene is now a launcher scene. */
export const isDepartureScene = isLauncherScene;
/** @deprecated See launcherScenes. */
export const departureScenes = launcherScenes;

/** Where a launched scenario is played on this site, in the student's instance of it. */
export function launchPath(code: string, group: string): string {
  return `/${encodeURIComponent(code)}?group=${encodeURIComponent(group)}`;
}

