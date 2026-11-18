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
3. **Teams** (optional): add teams and put students into them, or use "Share students out evenly". Each team plays in **its own copy of the world**: the team walks around together and shares what is shared (a boulder one of them knocked down stays down for the whole team, and only for that team). Other teams appear only in the scenes the scenario opens to everyone, such as a meeting room; everywhere else a team is on its own (see [Teams in a scene](extensions.md#teams-in-a-scene)). Without teams, everyone the mission was assigned to shares one copy. Students left in no team share the assignment's own copy.
4. **Look in** opens a team's copy of the mission as yourself.
5. **Report** shows how the students are doing; see [Reports](#reports).

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

All the instances of one assignment, its teams' and its own, are in one **room** on the game server (named by the assignment, `a12`), which is what lets teams meet in scenes that are open to everyone. Each instance still has its own World, shared variables, items and saves; nothing of one team's state reaches another. The public instance and any other open group are rooms of their own.

## Reports

**Report**, on an assignment's card, shows how its students are doing. It is read from two places: the save data (time spent, variables, objectives), and the **activity log**, which the game server writes as students play.

For the assignment: how many have started and finished, the average time spent and objectives done, the share of questions answered in one try, and how many completed each objective. For each student:

Column | What it is
------ | ----------
Progress | Not started, in progress, or finished (every objective that is not a bonus is complete)
Time | Time in the mission, across visits
Objectives | Done, of those required. A team's shared progress counts for each of its members
One try | Questions where the first answer let the student go on, of the questions they answered
Words | Glossary words collected
Explored | Hotspots used
Stars | Stars earned in this mission
Messages | Messages sent

Clicking a name opens the detail: each objective; each question with the **first answer** (what the student thought before any feedback) and the number of tries; evidence of the mission's learning objectives, where it has them (missions made by the [generator](generation.md) record first answers and tries in variables, listed in `curriculum.evidence`); where the student went; and, on request, what they did step by step. **Download as CSV** gives the table for a gradebook.

What is logged, one line each: joining and leaving, entering a scene, using a hotspot, choosing an answer in an infobox, completing an objective, getting a glossary word, and earning an award. Lines carry the student, their instance, the scene and the time. Movement and chat text are not in the activity log.

To measure **improvement**, the first answer per question is the most useful single number: compare it between an early mission and a later one on the same standard, or put the same question at the start and the end of one mission (two infoboxes) and compare the two. Reports say what students did in the game; they are evidence to weigh, not grades (events run in the browser: see the trust model on the [protocol](protocol.md) page).

The **Messages** tab of a report is the audit log: every message sent in the assignment's instances, in a scene or privately, with sender, recipient and time.

## Profiles

Players can look at each other. Clicking another player's avatar, or their name in the Players panel, opens their profile: their avatar as it is dressed, their rank, stars, XP and the badges they have earned (see [Award](extensions.md#award)). A profile shows nothing else: no email address, no class, no activity. Guests have no account and so no profile beyond their name and avatar.

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
`activity_log` | What players did, one line at a time, for reports
`chat_messages` | Every message sent, in a scene or privately, for auditing
`user_badges` | Badges players earned
