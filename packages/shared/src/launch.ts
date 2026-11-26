/**
 * Launching a scenario: a teacher, in a game, sends **every one of their students** into another
 * scenario (one of the teacher's assignments), wherever those students are playing: in this room,
 * in another instance of this scenario, or in another scenario altogether. Being in the assignment
 * is not what decides it: the teacher's students are (the API's roster, ClassStore::launch). If a
 * student may not play the scenario, the page they are sent to says so; that is for the teacher or
 * an administrator to put right, and the launch does not hold anyone back for it.
 *
 * The API says where each student goes; these rules decide who in a room is sent, how, where the
 * teacher goes, and what the teacher is told. They are the game server's, kept here (like World's)
 * so they are tested without Colyseus.
 */
import { isStaff } from './roles.js';
import { forEachAction } from './scenario.js';
import type { LaunchBroadcast } from './protocol.js';
import type { Id, Scenario, Scene } from './types.js';

/** What the API answers when an assignment is launched (ClassStore::launch). */
export interface LaunchPlan {
  assignment_id: number;
  scenario_id: Id;
  /** The scenario's code: players open it at /{code}. */
  code: string;
  title: string;
  /** The room its instances share. */
  party: string;
  /**
   * Every student of the teacher, and the instance of the launched scenario they play in: their
   * team's or the assignment's for those in it, the assignment's for everyone else.
   */
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
  /** How many students here go (the teacher is not counted). */
  sent: number;
  /** How many students here stay: someone else's students. */
  left: number;
  /** What the teacher is told about this room alone (launchReport adds the other rooms). */
  report: string;
}

/**
 * Who a launch sends where, in the teacher's own room. The teacher's students here go into their
 * own instance of it; anyone else here stays. The teacher (unless `stay`) goes into the instance
 * most of those students went into, so they arrive with the biggest group (they can follow another
 * team from there), or with nobody here going, the first student's.
 */
export function planLaunch(plan: LaunchPlan, seats: LaunchSeat[], teacher: string, stay = false): LaunchOutcome {
  const groupOf = new Map(plan.students.map((s) => [String(s.id), s.group]));
  const go: LaunchOutcome['go'] = [];
  const count = new Map<string, number>();
  let left = 0;
  for (const seat of seats) {
    if (seat.sessionId === teacher) continue;
    const group = groupOf.get(seat.userId);
    if (!group || isStaff(seat.role)) {
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
  return { go, sent, left, report: launchReport(plan.title, sent, 0, left) };
}

/**
 * What the teacher is told once a launch has gone out: how many of their students it sent, here
 * and in other games, and how many students here stay because they are someone else's.
 */
export function launchReport(title: string, here: number, elsewhere: number, left: number): string {
  const who = (n: number) => (n === 1 ? '1 student' : `${n} students`);
  const stays = left ? ` ${who(left)} here ${left === 1 ? 'is' : 'are'} not yours and stay${left === 1 ? 's' : ''}.` : '';
  const total = here + elsewhere;
  if (!total) return `🚀 ${title} is launched. None of your students are playing right now; it is on their missions page.${stays}`;
  const where = here && elsewhere ? ` (${here} here, ${elsewhere} in other games)` : elsewhere ? ' from other games' : ' here';
  return `🚀 ${title} is launched: ${who(total)}${where} ${total === 1 ? 'is' : 'are'} on the way.${stays}`;
}

// ------------------------------------------------------------- other rooms

/**
 * A launch, passed by the teacher's room to every other room on the game server (through
 * Colyseus presence), so that the teacher's students playing anywhere else go too.
 */
export interface LaunchRelay {
  /** This launch, for the rooms' answers (how many each sent). */
  id: string;
  /** The teacher's room, which has already dealt with its own players. */
  origin: string;
  /** The teacher's name. */
  by: string;
  plan: LaunchPlan;
  /** The teacher's game: the launcher scene, if any, is one of its scenes. */
  from: { scenario_id: Id; code: string; group: string };
  /** The launcher scene the teacher chose, if any. */
  via?: Id;
}

/** Someone in another room: which instance of which scenario they are playing now. */
export interface RelaySeat extends LaunchSeat {
  group: string;
}

/**
 * How a relayed launch reaches one student:
 * - `scene`: they are in the teacher's scenario (another instance of it), so the server puts them
 *   in the launcher scene there, as in the teacher's own room;
 * - `detour`: they are in another scenario, so their page goes to the teacher's scenario first,
 *   straight into the launcher scene (see detourPath);
 * - `straight`: there is no launcher scene; their page goes to the launched scenario.
 */
export interface RelayStep {
  sessionId: string;
  /** Their instance of the launched scenario. */
  group: string;
  how: 'scene' | 'detour' | 'straight';
}

/**
 * Who in this room a relayed launch sends, and how. Every student of the teacher here goes, except
 * one already playing their own instance of the launched scenario.
 */
export function planRelay(relay: LaunchRelay, scenarioId: Id, seats: RelaySeat[]): RelayStep[] {
  const groupOf = new Map(relay.plan.students.map((s) => [String(s.id), s.group]));
  const launchedHere = Number(scenarioId) === Number(relay.plan.scenario_id);
  const teachersHere = Number(scenarioId) === Number(relay.from.scenario_id);
  const out: RelayStep[] = [];
  for (const seat of seats) {
    const group = groupOf.get(seat.userId);
    if (!group || isStaff(seat.role)) continue;
    if (launchedHere && seat.group === group) continue;
    const how = relay.via == null ? 'straight' : teachersHere ? 'scene' : 'detour';
    out.push({ sessionId: seat.sessionId, group, how });
  }
  return out;
}

/** The presence topic launches are relayed on, and the one a launch's answers come back on. */
export const LAUNCH_TOPIC = 'qbl:launch';
export const launchAnswerTopic = (id: string) => `${LAUNCH_TOPIC}:${id}`;
/** The presence key that lets a detoured student into the launcher scene when they arrive. */
export const detourKey = (userId: string) => `${LAUNCH_TOPIC}:detour:${userId}`;
/** How long a detour waits for its student to arrive, in seconds. */
export const DETOUR_SECONDS = 120;

/** What the detour key holds: the teacher's scenario and the launcher scene to arrive in. */
export interface Detour {
  scenario_id: Id;
  scene_id: Id;
}

/**
 * The page a detoured student opens: the teacher's scenario, in the teacher's instance, with the
 * launch they are on carried along (`launch=`), so QL_SCENARIO_LAUNCH_URL is theirs on arrival.
 */
export function detourPath(from: LaunchRelay['from'], onward: LaunchBroadcast): string {
  return `/${encodeURIComponent(from.code)}?group=${encodeURIComponent(from.group)}&launch=${encodeURIComponent(JSON.stringify(onward))}`;
}

/** The launch a detoured page was opened with (`launch=`), or null if there is none or it is not one. */
export function parseLaunchParam(raw: string | null | undefined): LaunchBroadcast | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Partial<LaunchBroadcast>;
    if (typeof m?.code !== 'string' || !m.code || typeof m.group !== 'string' || !m.group) return null;
    const out: LaunchBroadcast = { code: m.code, group: m.group, title: String(m.title ?? m.code), by: String(m.by ?? '') };
    // Only an address on this site: a launch never sends anyone off it.
    out.url = typeof m.url === 'string' && m.url.startsWith('/') && !m.url.startsWith('//') ? m.url : launchPath(m.code, m.group);
    return out;
  } catch {
    return null;
  }
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

