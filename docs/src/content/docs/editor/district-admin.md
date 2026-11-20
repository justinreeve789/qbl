---
title: "The district admin panel"
---

The **district admin panel** is for the technical staff who run a school's or district's QuestLab account. It is in the editor under **District** (`/editor/#/district`), for the organization's admins and for QBL administrators.

QBL makes the organization and names its first admin. Admins can add other admins by the email address of their account.

## What it does

- **People**: how many schools, teachers and students the organization has, and how many are deactivated.
- **Privacy**: QuestLab keeps no names, email addresses or birth dates of the people your systems send. Each person has **your id for them** (`external_id`) and a pseudonym to play under. You can have activity and chat deleted after a number of days.
- **Integrations** (see below), **API clients**, **roster files**, and the **sync history**.

## Integrations are turned on per organization

Single sign-on, roster syncing, roster files and API clients are an **advanced feature**. They are off until QBL turns them on for an organization that asks. Until then the panel says so. (QBL administrators: the "For QBL administrators" card, or `php artisan qbl:org enable "<organization>"`.)

## SAML single sign-on

For Microsoft Entra ID (Azure AD), ADFS, Okta, ClassLink, Google as a SAML IdP, and others.

1. In your identity provider, add QuestLab as an application with the **Entity ID**, **ACS (reply) URL** and **metadata URL** the panel shows under "What to give your system".
2. In the panel, paste your identity provider's **metadata XML**, or fill in its entity ID, sign-in URL and signing certificate.
3. Optional: an **attribute with your id for each person** (such as `employeeNumber`), so that people match the accounts you upload with the API or a roster file. Without it, the NameID is used, and QuestLab keeps only a one-way hash of it.
4. Optional: an **attribute that says who is staff** (such as `eduPersonAffiliation`) and the values that mean a teacher.
5. Turn it on, and give people the **sign-in link** (for your portal). Sign-ins started from your portal (IdP-initiated) work too, unless you turn that off.

Accounts are made the first time someone signs in, unless you turn that off (then only people you have uploaded can sign in). Answers must be signed with your identity provider's certificate; each is accepted once.

## Clever

1. In your Clever dashboard, add QuestLab's application.
2. In the panel, enter your **Clever district ID** and turn Clever on.
3. **Sync now** brings your schools, teachers, students and sections in from Clever: a section's teachers teach its students. People no longer in Clever are **deactivated** (signed out, unable to sign in, their work kept), unless you turn that off.
4. People sign in from the Clever portal (Instant Login), or with the sign-in link the panel shows.

## Google

1. Enter your **Google Workspace domains**. Anyone signing in with Google from them gets your district's account.
2. For **Google Classroom** rosters: make a service account in Google Cloud, give it **domain-wide delegation** for the two read-only Classroom scopes the panel shows (Admin console → Security → API controls), paste its **JSON key**, and give the address of a Workspace administrator for it to act as.
3. **Sync now** brings in active courses' teachers and students; a course's teachers teach its students.

## Custom uploads

- **Roster file**: a CSV with the columns `role, external_id, school_id, school_name, grade_level, teacher_ids, status`. Only `role` and `external_id` are needed; `teacher_ids` lists a student's teachers separated by `;`. A file with columns such as names or emails is refused before anything is read. The panel has an example file.
- **API clients**: for your SIS, LMS or data warehouse to use the [public API](/docs/api-v1/). Choose what each may do (its scopes); the secret is shown once. Make a new secret, or revoke a client, at any time.

**Check the connection** tests an integration's settings, and the **sync history** lists every sync and upload with what changed and any problems.
