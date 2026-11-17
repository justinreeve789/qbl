# Classes, missions and teams

A **mission** is a published scenario. Players find their missions on the page they land on after signing in (the site's front page, `/`): a grid with one card per mission.

Kind | Who sees it | Set by
---- | ----------- | ------
Public | Everyone, at any time | The scenario's setting **Who can play it** is "Everyone" (the default)
Assigned | The students a teacher gave it to | A teacher, on the editor's **Classes** page

A scenario set to "Only students it is assigned to" is **private**: it is on nobody's page until its owner assigns it, and nobody else can open its address. A public scenario can be assigned too, for instance to give it a due date or to play it in teams. The setting applies as soon as it is changed; it does not wait for the scenario to be published again.

## For teachers: the Classes page

The editor has two areas, in the bar at the top: **Scenarios** and **Classes**.

1. **Add your students** by the email address they sign in with. A student has to have signed in once before they can be added. A student can be in several teachers' lists.
2. **Assign a mission**: choose a published scenario, the students it is for, and optionally a due date and a short note. Both are shown on the student's mission card; a due date that has passed is marked.
3. **Teams** (optional): add teams and put students into them, or use "Share students out evenly". Each team plays in **its own copy of the world**: the team walks around together, shares what is shared (a boulder one of them knocked down stays down for the whole team, and only for that team), and other teams never appear in it. Without teams, everyone the mission was assigned to shares one copy. Students left in no team share the assignment's own copy.
4. **Look in** opens a team's copy of the mission as yourself.

An assignment can be changed at any time. Teams keep their copy of the world, and their progress, when they are renamed or when students move between them; a student who moves starts in the new team's world with a fresh save there.

## Instances and save data

Every copy of a scenario's world is an **instance**, named by a group key. The address a player opens carries it: `/{code}?group=t7`.

Group key | Instance
--------- | --------
`public` (or none) | The one open to everyone
`a{assignment id}` | An assignment without teams, or its students who are in no team
`t{team id}` | One team

Save data belongs to the instance, not to the scenario:

- What is **shared** (variables with scope `room`, where unique items were left) is kept once per instance, in `scenario_instances`.
- What is **the player's own** (their variables, inventory, position, objectives) is kept once per player *per instance*, in `scenario_sessions`. A student's team game and the same student's casual game in the public instance are two saves.
- Stars, XP, rank, the avatar and what was bought in the marketplace belong to the **account** and are the same everywhere.

The game server refuses a player who asks for an instance they do not belong to. A teacher may join any instance of their own assignments, and an admin any instance.

## Avatars

Avatars belong to the platform, not to a scenario: there is one set, and a player keeps the character they chose in every mission. The choice is stored on the account (`users.avatar_media_id`); guests keep theirs in the browser. A player changes character from the missions page, by clicking their character's picture.

The set is the `avatars` table (name, picture, close-up portrait, size, and for a sprite sheet its frames and animations), filled by `php artisan qbl:seed` from `database/seeders/data/avatars.php`. There is no screen for editing it yet. When a scenario is served, the set is added to the document as ordinary image media, with ids from 900000 (portraits from 950000), and `avatar_media_ids` / `avatar_portraits` are set to match; the editor therefore no longer offers "players can choose this as their avatar". With an empty `avatars` table a scenario's own `avatar_media_ids` are used, which is what the standalone file backend does.

## Tables

Table | Holds
----- | -----
`teacher_student` | Which students a teacher teaches (many to many)
`assignments` | A scenario given by a teacher, with `due_at` and `note`
`teams` | The teams of an assignment
`assignment_student` | The students of an assignment and the team each is in, if any
`avatars` | The platform's avatars
`scenario_sessions.group_key` | Which instance a save belongs to (`public` for saves made before instances had their own)
