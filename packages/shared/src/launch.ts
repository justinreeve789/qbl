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

/** Whether a scene has a travel action in any of its events: it can be a launch's departure scene. */
export function isDepartureScene(scene: Scene): boolean {
  let found = false;
  forEachAction(scene, (a) => {
    if (a.type === 'travel') found = true;
  });
  return found;
}

/** The scenes a teacher can send their class through on the way to a launched mission. */
export function departureScenes(scenario: Scenario): Scene[] {
  return scenario.scenes.filter(isDepartureScene);
}
