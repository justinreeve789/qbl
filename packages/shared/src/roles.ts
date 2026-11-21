/**
 * Who may do what, by role (the API's App\Qbl\Roles says the same).
 *
 *   student         plays
 *   teacher         plays, builds their own scenarios, runs classes
 *   content_admin   a teacher who also edits every scenario and manages the asset library
 *   admin           everything (billing, districts, accounts too)
 *   guest           plays, for a while, without an account
 */
export type Role = 'student' | 'teacher' | 'content_admin' | 'admin' | 'guest';

/** Teachers, content admins and admins: they use the editor and the classes. A teacher follows one team at a time in a game, and can switch to another. */
export function isStaff(role: string | undefined): boolean {
  return role === 'teacher' || role === 'content_admin' || role === 'admin';
}

/** May open and change every scenario, curricular ones included. */
export function editsAllScenarios(role: string | undefined): boolean {
  return role === 'content_admin' || role === 'admin';
}

/** May add, change and remove assets of the library. */
export function managesLibrary(role: string | undefined): boolean {
  return role === 'content_admin' || role === 'admin';
}

/** As people read it. */
export function roleLabel(role: string | undefined): string {
  return role === 'admin' ? 'Administrator' : role === 'content_admin' ? 'Content admin' : role === 'teacher' ? 'Teacher' : role === 'guest' ? 'Guest' : 'Student';
}
