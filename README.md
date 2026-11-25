# Quest Lab

A multiplayer, educational virtual world platform in the spirit of Animal Jam and Club Penguin. Students are space explorers aboard an intergalactic starship, which serves as a hub from which new scenarios (missions) are launched, under a teacher's facilitation. A robust scenario editor allows content creators to create new missions, which reward students with stars, experience points, and badges. Stars can be used to purchase gear, pets, clothing, vehicles, and more. Players advance in rank aboard the starship as they earn experience points. Badges are displayed in students' profiles for bragging rights.

```
packages/shared   scenario types, validator, event engine, world rules, protocol (TypeScript, unit-tested)
apps/server       Colyseus 0.18 game server
apps/client       Phaser 4 client (Vite): systems, action presenters and features; see apps/client/README.md
apps/editor       the scenario editor (TypeScript, no framework); see apps/editor/README.md
apps/api          the Laravel application: QBL tables, seed data, JSON generation, editor API, logins, saves
docker            Dockerfiles and config for the app, colyseus, editor, docs, apache and edge containers
scenarios         scenario JSON + media for local play; starship.json is generated from the shipped demo ZIP
docs              the QBL JSON docs plus pages for everything added
tools             scenario validator CLI
```

## Run it

Requires Node 22+.

```sh
npm install
npm run dev          # game server on :2567, client on http://localhost:5173 (no Laravel or database needed)
```

http://localhost:5173 is the marketing page; the game is at http://localhost:5173/missions (or `/play`, `/{code}`).

Open the client in two browser windows to see multiplayer. To work on the editor without Docker (needs PHP 8.2+ with SQLite as well):

```sh
npm run dev:editor   # dev API on :8000, editor and game together at http://localhost:5173/editor/
```

The site's addresses:

| Address | What it is |
| ------- | ---------- |
| `/` | The marketing page (`apps/client/index.html`, Tailwind compiled at build time). Its "Log in" button goes to `/missions` |
| `/missions` | The game: the sign-in screen if needed, then the missions page. Everyone who signs in lands here, **teachers and admins too**; the Editor and Classes are in the page's menu (the marketing page's button, for someone already signed in, still goes to a teacher's editor). Students see their missions; teachers and admins see their teaching page (shortcuts into the editor, their assignments with "Look in" per team, their scenarios), then missions to try |
| `/{code}` | One scenario, by its code (16 random letters, or one chosen on the Publish page) |
| `/play?…` | The game with the parameters below (editor previews use `/play?preview=…`) |
| `/editor/`, `/docs/` | The editor and the documentation |

Every path that is not `/` or a file loads the game (`apps/client/play.html`). Old links that put these parameters on `/` (`/?preview=…`, `/?scenario=…`) are forwarded to `/play`.

Players open a scenario at `/{code}`. Other URL parameters:

| Parameter | Effect |
| --------- | ------ |
| `?scenario=starshipexplorer` | Which scenario to play, by code or shortname, when the path has no code |
| `?preview=12&scene=40` | Play the unpublished draft of scenario 12, starting in scene 40. This is what the editor's "Test this scene" opens; it needs the editor's sign-in |
| `?group=red-team` | The instance to play in: players with the same group share its variables, items and saves |
| `?party=class-5b` | With the file backend, to try teams out: groups with the same party are in one room and meet in scenes that are not limited to teams (`?group=red&party=5b`, `?group=blue&party=5b`). With the API, the room comes from the assignment |
| `?offline` | Single-player, no game server needed (for previews) |
| `?debug` | Draw walkable areas, spawn points and hotspot areas (including scene edges) |

## SSL
To set up an SSL cert, use certbot. Its standalone mode needs port 80, which the `edge` container holds, so stop that first:

```sh
docker compose stop edge
sudo certbot certonly --standalone -d dev.questlab.cc -m admin@questlab.cc --agree-tos
```

Then name the certificate in `.env` and start `edge` again (`docker compose up -d edge`):

```sh
COMPOSE_PROFILES=https
QBL_PUBLIC_URL=https://dev.questlab.cc
QBL_CERTS_DIR=/etc/letsencrypt
QBL_TLS_CERT=/etc/letsencrypt/live/dev.questlab.cc/fullchain.pem
QBL_TLS_KEY=/etc/letsencrypt/live/dev.questlab.cc/privkey.pem
```

For renewals (certbot's hooks to stop, restart and start `edge`) and the alternative of letting `edge` fetch a certificate itself, see [HTTPS](#https).

## Docker

```sh
docker compose up --build
```

That is development: plain HTTP on http://localhost:8080, no certificate, no `.env` needed. Staging and production add HTTPS with two lines in `.env` (see [HTTPS](#https)).

| Address | What it is |
| ------- | ---------- |
| http://localhost:8080 | The marketing page |
| http://localhost:8080/missions | The game: sign in, then the missions page (teachers and admins go on to the editor) |
| http://localhost:8080/starshipexplorer | The demo mission by its code. Every scenario is at `/{code}` |
| http://localhost:8080/editor | The editor |
| http://localhost:8080/docs | The documentation |

Eight containers:

| Container | What runs in it |
| --------- | --------------- |
| `edge` | Caddy, on staging and production only (`COMPOSE_PROFILES=https`): ports 80 and 443. Ends HTTPS (with a Let's Encrypt certificate it fetches and renews itself, or your own) and passes everything to `apache` as plain HTTP |
| `app` | The Laravel backend (PHP-FPM), running `apps/api` mounted from your checkout, and Vite building the frontend (the marketing page and the Phaser game) from `apps/client`, also mounted. The image holds only PHP, Composer and Node |
| `db` | MariaDB |
| `colyseus` | The multiplayer game server |
| `editor` | The scenario editor: a static web application served by its own small Apache. The image holds no code: `app` builds the editor from `apps/editor` (mounted) into a volume this container serves |
| `docs` | The documentation in `docs/`, built with Astro Starlight into a static site |
| `tts` | Text-to-speech: [Kokoro](https://github.com/remsky/Kokoro-FastAPI), an open-weight model on the server's own CPU (about 5 GB of image, 1 GB of memory). Records what characters say, with the time of every word, when asked by the editor, `qbl:voice` or the generator. Only reachable inside the Compose network |
| `chatterbox` | Only with `COMPOSE_PROFILES=chatterbox` and `QL_TTS_DRIVER=chatterbox`: text-to-speech with [Chatterbox](https://github.com/resemble-ai/chatterbox), livelier than Kokoro but much heavier (about 6 GB of memory; several times slower than real time on a CPU). Built from `docker/chatterbox`, with word timings added by alignment. Only reachable inside the Compose network |
| `apache` | Apache httpd: http://localhost:8080 in development; on a server, behind `edge` (its port stays on the server's loopback address). Serves the game's files, `scenarios/assets` (mounted, as `/scenario-assets`) and uploaded media, and passes `/api` to Laravel, `/game` (WebSocket) to Colyseus, `/editor` to the editor and `/docs` to the documentation |

Starting the containers migrates the database and nothing else. **Seeding is done by hand:**

```sh
docker compose exec app php artisan qbl:seed            # the marketplace catalogue, the Starship Explorer demo and the Science Lab
docker compose exec app php artisan qbl:seed --reset    # put the shipped demo back, replacing edits made to it
```

The **Science Lab** (`/sciencelab`) shows the science features: a lab book with typeset maths and chemistry (KaTeX), values worked out from sliders and answers checked with their units (math.js), graphs (JSXGraph), and four close-up benches to pour, mix, heat and measure at. It was made by `node tools/make-science-lab.mjs` (after `npm run build -w @qbl/shared`); change it in the editor like any other scenario. All three libraries are MIT or Apache-2.0 licensed and are loaded only by a scene or a box that uses them.

The first is safe to run again: a demo that is already there is left as it is, and so are prices changed in the catalogue. Until it has been run once there is no scenario to play. To play the demo, choose "Play as a guest instead" on the sign-in screen. Compose uses local-only default secrets; copy `.env.example` to `.env` and set real ones for anything shared.

**The database password.** `DB_PASSWORD` in `.env` can be set or changed at any time: the `db` container applies it to the `qbl` account each time it starts (`docker compose up -d` after changing it). The MariaDB image alone sets it only when the `db-data` volume is first created, which used to end in "Access denied for user 'qbl'" when `.env` changed afterwards. `DB_ROOT_PASSWORD` is still set only on creation.

**An account for the editor.** The editor needs a teacher or admin account. Either seed demo accounts (`php artisan qbl:seed --password=...` creates `teacher@qbl.test` and two students with that password), or create one at any time:

```sh
docker compose exec app php artisan qbl:user you@example.org "Your Name" --role=teacher
```

Who may use the editor, Classes and reports goes by the account's role alone: teachers and admins. Everyone who signs in with Google starts as a student. To make an existing account a teacher (or an admin, or a student again):

```sh
docker compose exec app php artisan qbl:update-role you@example.org --role=teacher
docker compose exec app php artisan qbl:update-role you@example.org   # shows the current role
```

It applies at once; reload any page that is open.

**Upgrading a database from an earlier build.** `docker compose up --build` is enough: migrations run on start and are written so that tables and columns that already exist are left alone. Changes to the demo occur only when you run `qbl:seed --reset`.

### Working on the API

`apps/api` is mounted into the `app` container (`./apps/api:/app`), not copied: an edit on either side is there on the other at once, with no rebuild. PHP files are picked up within about two seconds.

Its PHP dependencies are in `apps/api/vendor`, which is not committed. The `app` container runs `composer install` into it when it starts if it is missing, or older than `composer.lock`. Since both sides use the same folder, artisan and composer work on both:

```sh
docker compose exec app php artisan qbl:seed     # in the container
docker compose exec app composer require foo/bar

cd apps/api && php artisan test                  # on your machine (PHP 8.3 or later)
cd apps/api && composer install
```

In the container, `php` and `composer` run as the user that owns your `apps/api` folder, not as root, and PHP-FPM's `www-data` takes that user's id. So `vendor/`, `storage/` and anything else the container writes stays yours, and the host can keep changing it. (When the folder belongs to root, as on Docker Desktop for Windows, everything runs as before.) To run something as root anyway: `docker compose exec -e QBL_PHP_AS_ROOT=1 app php ...`.

Two things to know:

- A `.env` in `apps/api` (for running artisan on your machine) is seen by the container too. The settings in `docker-compose.yml` win wherever both set the same variable. To point artisan on your machine at the Docker database, use `DB_CONNECTION=mariadb`, `DB_HOST=127.0.0.1`, `DB_PORT=3307`, `DB_DATABASE=qbl`, `DB_USERNAME=qbl`, `DB_PASSWORD=qbl-local-only` (or your `DB_PASSWORD`).
- Static files in `apps/api/public` are copied to Apache when `app` starts, so changes there need `docker compose restart app`.

### Working on the client

The game and the marketing page are not copied into the image either. `app` mounts their source read-only (`apps/client`, `packages/shared`, `scenarios/assets`, the root `package.json` and `tsconfig.base.json`, all under `/repo`) and Vite builds it when the container starts, into the volume Apache serves. With `QBL_CLIENT_WATCH=true` (the default) Vite keeps watching and rebuilds within a few seconds of a save: reload the page. Its output is in the logs, labelled `client:`:

```sh
docker compose logs -f app
```

- The client's npm packages are installed in the `client-modules` volume on the first start, and again whenever one of those `package.json` files changes. A `node_modules` on your machine is not used, so it can be for another system.
- The build skips the type check, so a typing mistake cannot keep the site down; run `npm run typecheck` yourself. A build that fails outright is reported in the log and the API keeps running.
- On a server, `QBL_CLIENT_WATCH=false` in `.env` builds once per start and saves the memory the watcher uses. After `git pull`, `docker compose restart app` rebuilds.
- Scenario pictures and sounds in `scenarios/assets` are served by Apache straight from the checkout, as `/scenario-assets`.
- The editor is built the same way, from `apps/editor` (mounted read-only too), into the `editor-dist` volume the `editor` container serves; its lines in the log are labelled `editor:`. So `/editor` is never older than the checkout, and an edit to the editor shows after a reload.
- `docker compose up --build` is needed only when something in `docker/` changes, for these three (API, client, editor). The game server (`colyseus`) and the documentation (`docs`) are still copied into their images: after changing `apps/server`, `packages/shared` or `docs`, rebuild them with `docker compose up -d --build colyseus docs`.
- **If `/editor` will not let a teacher in**, the sign-in form there says which account the browser is signed in with and the role the server has for it (the game and the editor share one sign-in per browser, so a guest or student sign-in left from playing is the usual cause): sign in on that form with the teacher's account. To see the role in the database the site is really using: `docker compose exec app php artisan qbl:update-role <email>`.

### HTTPS

On a server (a VPS, say) the `edge` container ends HTTPS. It holds the certificate, redirects `http://` to `https://`, and passes every request to the other containers as plain HTTP: nothing behind it needs a certificate, and only `edge` is reachable from outside.

```
browser ──https──▶ edge :443 (certificate for dev.questlab.cc) ──http──▶ apache ──http──▶ app, colyseus, editor, docs
```

**1. DNS.** Point `dev.questlab.cc` (an A record, and AAAA if the server has IPv6) at the server's address.

**2. Ports.** Ports 80 and 443 must be open to the internet (TCP; also UDP 443 for HTTP/3) in the hosting provider's firewall or security group. Nothing else on the server may use them.

**3. `.env`** next to `docker-compose.yml`:

```sh
COMPOSE_PROFILES=https                   # starts the edge container (development leaves this out)
QBL_PUBLIC_URL=https://dev.questlab.cc   # the address people type; no path
QBL_ACME_EMAIL=you@questlab.cc           # optional: Let's Encrypt writes here about certificate problems
```

then `docker compose up -d --build`. `docker compose ps` should list `edge`, and `docker compose logs edge` says which certificate it is using. Without `COMPOSE_PROFILES=https` there is no `edge` and nothing answers on ports 80 and 443.

**4. The certificate.** Three ways:

- **Let's Encrypt (nothing to do).** With no certificate files, `edge` fetches a free certificate for `dev.questlab.cc` on its first start, which needs steps 1 and 2 in place, and renews it by itself. Certificates are kept in the `edge-data` volume: don't delete it (`docker compose down -v` would), because Let's Encrypt limits how often new ones may be issued.
- **Your own certificate, by path.** Name the files in `.env`. With certbot:

  ```sh
  QBL_CERTS_DIR=/etc/letsencrypt
  QBL_TLS_CERT=/etc/letsencrypt/live/dev.questlab.cc/fullchain.pem
  QBL_TLS_KEY=/etc/letsencrypt/live/dev.questlab.cc/privkey.pem
  ```

  `QBL_CERTS_DIR` is the folder mounted (read-only) into `edge`; the two files must be inside it, given as host paths like these or relative to it (`live/dev.questlab.cc/fullchain.pem`). Mount all of `/etc/letsencrypt`, not only `live/…`: the files in `live/` are links into `archive/`, which must be there too. Then `docker compose up -d edge`. A wrong path stops `edge` with a message saying which file it could not read.
- **Your own certificate, by copying.** Leave `QBL_TLS_CERT` and `QBL_TLS_KEY` empty and put `fullchain.pem` (the certificate followed by its intermediates) and `privkey.pem` in `certs/` next to `docker-compose.yml`, then `docker compose restart edge`. `certs/` is in `.gitignore` and `.dockerignore`, so the key never reaches git or an image.

With your own certificate, renewing is up to you, and `edge` reads the files only when it starts. For certbot, add a deploy hook that restarts it after each renewal, `/etc/letsencrypt/renewal-hooks/deploy/questlab.sh` (executable):

```sh
#!/bin/sh
docker compose -f /path/to/qbl/docker-compose.yml restart edge
```

If certbot was set up with `--standalone`, it also needs port 80 to renew, which `edge` holds: add `pre/` and `post/` hooks that `stop` and `start` edge, and check with `sudo certbot renew --dry-run`. Letting `edge` fetch the certificate itself (the first option) avoids all of this.

**5. Google sign-in**, if used: the authorised redirect URI is `https://dev.questlab.cc/api/auth/google/callback`.

**6. Check it.** Open http://dev.questlab.cc (it should move to https), then https://dev.questlab.cc/missions: sign in and start a mission, with a second browser in it too (that exercises `wss://`). https://dev.questlab.cc/editor (no slash) should land on `https://dev.questlab.cc/editor/`.

With an https `QBL_PUBLIC_URL`, that address is the site's own name everywhere: Apache writes every redirect with it (its own, and the editor's and docs' it passes on), Laravel builds every link with it (the Google sign-in's `redirect_uri` among them) and marks its cookies https-only, and the game opens its socket as `wss://` because the page is https. `edge` replaces any `X-Forwarded-*` headers a visitor sends with the real ones, so Laravel's logs and rate limits see true addresses. A wrongly written `QBL_PUBLIC_URL` stops `edge` and `apache` at start with a message saying so.

| Setting | Value |
| ------- | ----- |
| `COMPOSE_PROFILES` | `https` on staging and production: starts `edge`. Empty in development |
| `QBL_PUBLIC_URL` | The address people type, `https://dev.questlab.cc`. Turns on HTTPS in `edge`; Laravel's `APP_URL` and Apache's own name. Empty in development |
| `QBL_HTTP_PORT`, `QBL_HTTPS_PORT`, `QBL_HTTP_BIND` | The edge's public ports and address. Default 80, 443 and every address, which is what a server needs (Let's Encrypt needs 80 or 443) |
| `QBL_APACHE_PORT`, `QBL_APACHE_BIND` | Apache's own plain-HTTP port: the site in development. Default `127.0.0.1:8080`, so on a server it is not reachable from outside |
| `QBL_ACME_EMAIL` | Optional address for Let's Encrypt |
| `QBL_CERTS_DIR` | The folder with your own certificate, mounted into `edge`. Default `./certs` |
| `QBL_TLS_CERT`, `QBL_TLS_KEY` | Your certificate and key, inside `QBL_CERTS_DIR` (host paths or relative). Empty: `fullchain.pem` and `privkey.pem` from that folder if present, else Let's Encrypt |
| `QBL_TRUSTED_PROXIES` | Whose `X-Forwarded-*` headers Laravel believes. Laravel only ever hears from Apache, so it must include the Docker network; the default is every private range |

### Google sign-in

1. In the Google Cloud console create an OAuth client ID of type "Web application", with the authorised redirect URI `https://your-host/api/auth/google/callback` (for a local try-out, `http://localhost:8080/api/auth/google/callback`).
2. Put its id and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, set `QBL_PUBLIC_URL` to the same host, and restart `app`.

The game's and the editor's sign-in screens then show "Sign in with Google". Someone signing in for the first time gets an account straight away: a student, with stars and progress that are kept. Someone whose address matches an existing account is joined to it and keeps its role.

| Setting | Effect |
| ------- | ------ |
| `QBL_GOOGLE_DOMAINS` | Only addresses at these domains may sign in with Google (`school.org,students.school.org`). Empty: any Google account |

Without it anyone with a Google account can create an account. New accounts are students, unless the person chose **Teacher** on the sign-up form and `QBL_ALLOW_TEACHER_SIGNUP` is on (below); an account that already exists keeps its role. Teachers are also made with `qbl:user`, or from an existing account with `qbl:update-role <email> --role=teacher`. For a school, set `QBL_GOOGLE_DOMAINS` (and turn off creating accounts and choosing to be a teacher, below).

### Creating an account without Google

The game's sign-in screen (`/missions`) has "New here? Create an account": first **I'm a… Student / Teacher** (two cards; neither is chosen until the person picks one), then a name, an email address and a password (at least 8 characters, typed twice). The marketing page links to it (`/missions#create-account`), and so does the editor's sign-in screen. The account is signed in straight away and lands on the missions page, a teacher's showing their teaching page with the Editor and Classes in the menu. "Sign up with Google" on the same form uses the choice too, for a new Google account only.

| Setting | Effect |
| ------- | ------ |
| `QBL_ALLOW_REGISTRATION` | `true` (default): anyone may create an account. `false`: only Google, or accounts made with `qbl:user` |
| `QBL_ALLOW_TEACHER_SIGNUP` | `true` (default): someone creating an account (with a password or with Google) may choose to be a teacher. `false`: the form has no choice, every new account is a student's, and teachers are made with `qbl:update-role` |

A self-made teacher's account can add any student who has signed in, by their address, on the Classes page (when billing is on, only as many as their plan allows). A school or district that wants to choose its teachers itself sets `QBL_ALLOW_TEACHER_SIGNUP=false`.

Nobody checks that the address belongs to whoever typed it (there is no email sending yet), so:

- An address that already has an account is refused, and creating an account never joins one.
- `QBL_GOOGLE_DOMAINS` does not apply: a typed address proves nothing. A school that wants only its own Google accounts sets `QBL_ALLOW_REGISTRATION=false`.
- If the owner of the address later signs in with Google, Google has proved it is theirs: the account becomes theirs, and the password chosen when it was created, and every sign-in made with it, stop working. Accounts made by an administrator keep their password as before.
- `qbl:update-role` warns before making such an account a teacher or admin. (Choosing Teacher on the form does not: a typed address with a teacher's account is the same unchecked address.)
- Choosing a new password with an emailed link (below) proves the address too.

### Profile, passwords and email

Signed in, anyone but a guest opens their **profile** from the missions page (the menu under their face: "Profile: name and password") or from the editor (their name in the header). There they change the name over their character, and their password (given the current one; every other sign-in of the account then ends). A student whose account their school made through `/api/v1` keeps the pseudonym the school's system gave them. Accounts that sign in with Google have no password here.

**Forgot your password?** is on the game's sign-in screen (`/missions#forgot-password`; the editor's sign-in links to it) and in the profile. It emails a link to `/missions#reset-password=…`, which asks for a new password and signs in. Links work once, for 60 minutes. Only accounts with a password get one.

#### Email

The link is sent through Laravel's mailer, set in `.env`:

| Setting | Effect |
| ------- | ------ |
| `MAIL_MAILER` | `log` (default): nothing is sent; the message, with its link, is written to the app container's log (`docker compose logs app | grep -i reset`). `smtp`: send through the server below |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD` | Your provider's SMTP server (port 587 usually) |
| `MAIL_SCHEME` | Empty for port 587 (STARTTLS) or 25; `smtps` for port 465 |
| `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` | Who the email is from. Default: `no-reply@` the site's host name, and "QuestLab". Use an address your provider lets you send from |

After changing them, `docker compose up -d app`. When mail is not set up, or a student's email does not arrive, an administrator makes a link and passes it on (it lets whoever opens it set that account's password):

```sh
docker compose exec app php artisan qbl:reset-link student@school.org
```

How the pieces connect:

- Apache reads the frontend and the demo's media from a volume that `app` fills on each start, from Laravel's `public/` directory and the frontend built into its image.
- Files uploaded in the editor are written by `app` to a `media` volume, which Apache serves read-only as `/media`.
- The editor container holds no data. It is static files; everything it does goes through the Laravel API at `/api/editor`.
- Colyseus calls Laravel's `/api/internal` routes through a second Apache port (8081) that exists only on the Docker network. The public port answers 404 for `/api/internal`.

Other commands:

```sh
npm test                                   # shared unit tests + client tests that play the game headlessly
npm run test:api                           # seeding, JSON generation, codes, publishing, editor API (needs PHP with SQLite)
npm run test:api-v1                        # the public API for schools (/api/v1): roster, privacy, assignments, launch links, avatars, reports
npm run test:generation                    # the AI mission generator, with a stand-in model and placeholder pictures; then validates and plays the result
npm run test:laravel                       # the same API through real Laravel (needs `composer install` in apps/api)
npm run test:editor                        # the editor in a headless browser (needs PHP; once: npx playwright install chromium)
npm run validate -- scenarios/starship.json    # check a scenario document (scenarios/science-lab.json is the other one shipped)
npm run seed:export                        # regenerate scenarios/starship.json from the demo's ZIP (needs PHP with SQLite and zip)
npm run typecheck
npm run build
```

## The public API for schools and districts

Schools, districts and businesses connect their own systems (SIS, LMS, portal, data warehouse) through a versioned API under **`/api/v1`**: rostering teachers and students, enrollments, assignments and teams, importing their own avatars, one-time sign-in links, and reports on grades, engagement and learning, plus an activity feed and a per-student export and deletion. It takes no personally identifiable information: people are known by the organization's own opaque id and play under a pseudonym. Reference: [docs/src/content/docs/api-v1/](docs/src/content/docs/api-v1/index.mdx) (served at `/docs/api-v1/`); OpenAPI description at `/docs/api/v1/openapi.yaml`.

An administrator makes each organization's client:

```sh
docker compose exec app php artisan qbl:api-client create "Riverside School District" --kind=district --name="SIS sync" --scopes=roster:read,roster:write,reports:read
docker compose exec app php artisan qbl:api-client list        # also: rotate <client_id>, revoke <client_id>, scopes
```

and, so organizations' retention periods are honoured, runs `docker compose exec -T app php artisan qbl:privacy-purge` daily from the host's cron.

## Plans and billing

Off by default (`QBL_BILLING_ENABLED=false`: everyone may do everything). On, there are three plans, sold with Stripe, each paid one with a 7-day free trial and coupon codes:

- **Free**: the free missions.
- **Teacher**, $30 a month: every **curricular** mission (a scenario whose tier an administrator set to curricular, in Settings), to play and assign, for up to 40 students.
- **Teacher Plus**, $50 a month: also the **AI mission generator** in the editor (**Generate**), paid in **credits**: 100 a month, a mission costs 10, unused credits carry over up to 100.
- **Schools and districts**: a quote (the Plans page's form, emailed to `QBL_SALES_EMAIL`), then a **license** on the organization that covers its teachers.

People buy on **`/plans`**; teachers see their plan and credits in the editor (**Plan**). Every number is in `.env` (see `.env.example`).

```sh
# .env: STRIPE_SECRET=sk_…, then:
docker compose exec app php artisan qbl:billing setup          # makes the prices; prints STRIPE_PRICE_TEACHER / _PLUS for .env
# Stripe: a webhook to https://your-host/api/billing/webhook (events listed by setup) -> STRIPE_WEBHOOK_SECRET; the customer portal on
# .env: QBL_BILLING_ENABLED=true, then docker compose up -d
docker compose exec app php artisan qbl:billing coupon WELCOME20 --percent=20 --duration=repeating --months=3
docker compose exec app php artisan qbl:billing status teacher@school.org       # also: sync, credits --add=50
docker compose exec app php artisan qbl:org license "Riverside Unified" --generator --credits=100 --expires=2027-06-30
```

The generator from the editor and the district panel's roster syncs run on a **queue worker** inside the `app` container (`QBL_QUEUE_WORKER=true`; log lines `worker:`). While a mission is being made the editor shows its progress on the Generate page and in a ✨ chip at the top of every page, and the teacher can cancel it (credits back). After upgrading, run `php artisan migrate` (adds `scenario_generations.progress` and `cancelled_at`). See [docs/src/content/docs/developers/billing.md](docs/src/content/docs/developers/billing.md).

## The district admin panel

For a school's or district's technical staff, in the editor under **District**: the organization's people, admins and privacy settings, and (once QBL turns them on for that organization) its **integrations**: SAML single sign-on, Clever (Instant Login and roster sync), Google (Workspace sign-in for its domains and Google Classroom rosters), roster files, and API clients for `/api/v1`. Secrets are encrypted with the app key and never shown again.

```sh
docker compose exec app php artisan qbl:org create "Riverside Unified" --kind=district
docker compose exec app php artisan qbl:org enable "Riverside Unified"                 # only when the customer asks for it
docker compose exec app php artisan qbl:org admin "Riverside Unified" it-lead@riverside.org
```

Clever needs QBL's own Clever application: `CLEVER_CLIENT_ID` / `CLEVER_CLIENT_SECRET`, with the redirect URI `https://your-host/api/sso/clever/callback`. SAML and Google need nothing on the server: each district sets them up in its panel. Guide: [docs/src/content/docs/editor/district-admin.md](docs/src/content/docs/editor/district-admin.md).

## How a mission is put together

A **scenario** is a whole mission a group of students goes on together. It contains **scenes**. Each scene has a background, and **events** made of **actions** that run in order: start events when the scene loads, end events just before leaving, hotspots, and indirect events run by other actions. Each scenario is represented by a JSON file that loads when the player launches. See `docs/` for the documentation: the editor guide, and the complete specification under Developers (`docs/src/content/docs/developers`).

- **Moving between scenes** is a `jump` action. Scene edges are walk-in hotspots that span one axis (a null `position_x` or `position_y`) and jump when an avatar reaches them.
- **Background music** is an `audio` action with `repeat` and `persist` in a scene's start events. It carries on across scenes that use the same track and changes when a scene starts a different one.
- **Hotspots** fire on a click (`activate_by_trigger: true`) or when an avatar walks in (`false`), and can show labels.
- **Who sees an event** is its `audience`: only the player who sets it off (the default), or everyone in the scene, who then see and hear its pictures, text, sounds and dialogue as they happen. What an event does (variables, awards, jumps, infoboxes) is always the player's own.
- **Variables are a player's own or shared.** A player's own variable has a separate value for each player (how many animals this student has greeted). A shared one has a single value for everyone playing together, so one student changing it changes it for all (the boulders have fallen; the path is closed). The variable's `scope` decides, once, where it is defined.
- **Dialogue** is a speech bubble over the speaker, or a story box across the screen with the speaker's close-up portrait, for the characters that carry the story. Characters and avatars can each be given a portrait.

`docs/src/content/docs/developers/extensions/` lists the fields added for the walk-around runtime, and `docs/src/content/docs/developers/actions/` has a page for each action (walkable areas, spawn points, item and character placement, shared variables, chat mode).

## Generating missions with AI

`php artisan qbl:generate "..."` makes a whole mission from a prompt: it aligns it to imported curriculum standards, writes the story, scenes, characters, dialogue, questions and events, draws every picture in the house art style (Gemini, OpenAI or Scenario, with every picture checked against approved style anchors), packages it as an import ZIP, and imports it as a private draft for a teacher to review. Missions use doors, holes and ladders as well as scene edges, place things at their real size where they belong, give students crew roles with different jobs and a shared crew log, throw in a twist, and end with a debrief where the guide checks what students worked out.

```sh
docker compose exec app php artisan qbl:standards file standards.json --framework=NGSS     # once: standards to align to
docker compose exec app php artisan qbl:art-style qbl-adventure --bootstrap               # once: the style's anchor pictures
docker compose exec app php artisan qbl:generate "Why does the orchard have flowers but no fruit?" --grade=3 --framework=NGSS --owner=teacher@qbl.test
```

Set `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` (or `OPENAI_API_KEY`) in `.env`; every other setting (models, API addresses, art style, limits) is there too, listed in `.env.example`. `--images=placeholder` tries the whole pipeline with no image service. See `docs/src/content/docs/developers/generation.md`.

## Characters' voices

Characters can be given a voice of their own: their lines are recorded once by the `tts` container (Kokoro, free, no watermark) and played in the game with each word lit as it is spoken. Lines without a recording are read by the browser's voice, as before. In the editor, open a character, choose a voice under **🔊 Voice** and press **🎙️ Record its lines** (or **🎙️ Record voices** on the Characters page). From the command line:

```sh
docker compose exec app php artisan qbl:voice --list                 # about 90 voices, in 8 languages
docker compose exec app php artisan qbl:voice {code} --assign        # give each character a voice and record every line
docker compose exec app php artisan qbl:tts "Hello there!"           # say any text in a random theatrical voice, saved as tts-<voice>.mp3
```

Generated missions are voiced as they are made, and cast like a cartoon: besides everyday voices there are theatrical ones (a booming giant, a squeaky pixie, a jolly gnome, a pantomime villain, a zany inventor), which are chosen first (`QL_TTS_FLAIR`, 0 for everyday voices). The voices are in `apps/api/resources/speech/voices.json`; another text-to-speech service can be used by adding one class (`QL_TTS_DRIVER`; one for OpenAI-style services comes with it). For livelier, more expressive voices, `QL_TTS_DRIVER=chatterbox` with `COMPOSE_PROFILES=chatterbox` uses the `chatterbox` container instead (see "Or: Chatterbox" in the voices guide). `QL_TTS_DRIVER=elevenlabs` with `QL_TTS_ELEVENLABS_KEY` records with the paid ElevenLabs service instead (see "Or: ElevenLabs"); Kokoro stays the default. See `docs/src/content/docs/developers/voices.md`.

## The demo mission

**Starship Explorer** has thirteen scenes: five on the planet and eight aboard the ship. From the control room, the laboratory is east, the observation deck is up the ramp, and the main corridor to the south leads to the crew quarters, the hydroponics bay, the engine room and the marketplace. The corridor is drawn in perspective and uses a scale area, so avatars shrink as they walk away. On the rocket pad, the exoplanets marker only fades in as you walk under it, and boarding the rocket hides your avatar until you arrive.

It has one full quest, The Wilting Stream:

1. A console in the starship control room gives the mission: plants along a stream are dying.
2. West of the landing site, students walk the stream from the marsh (downstream) past an old lander to the spring meadow (upstream), observing and collecting a plant sample at each site.
3. In the ship's laboratory they test each sample's water with pH strips, look at the cells under a microscope, and keep the results in a notebook.
4. They report the source of the contamination, and can neutralise a beaker of the stream water by adding drops of base or acid.

Five questions are built into the play (why collect a healthy control, what a pH of 3 means, what "no microbes" implies, what cancels an acid, and the final conclusion). Each first answer is recorded in a variable and scored, and every answer gets an explanation. A checklist on screen tracks progress.

Players choose from the platform's cast (Asimov, Buck, Gil, Lucy, Mallory, Pinta, Riona, Sam and Val: single pictures with a close-up each, in `scenarios/assets/platform`), which make the built-in moves. Every player can jump and crouch from buttons on their screen; the crew's music player teaches the dance, and the button appears. With the file backend (no Laravel) the demo uses its own older list of avatars, among them Sprocket, a sprite sheet with a walk, an idle, a drawn jump and a drawn dance. Captain Vega waves when she greets you.

Three things in it show the storytelling tools. Captain Vega greets each player in a **story box** with her portrait, a conversation only that player sees. Above the spring meadow, any player can push loose boulders onto the cliff path: the **rockfall is shown to everyone in the meadow**, and a **shared variable** closes the shortcut for every player until someone sends the repair drone from the engine room. In the hydroponics bay the seed vault opens only for a player who has greeted all three critters, counted in **each player's own variable**.

Along the way the quest awards stars and XP (16 awards: 56 stars and up to 245 XP, enough for the second rank). The marketplace sells the platform's items and two that exist only on this mission: a patch to wear, and a survey map, an ability that makes a map table appear at the landing site for the players who own it.

All of this is data: scenes, hotspots, events, actions, variables and the checklist in the seed rows. The quest's artwork is placeholder art made by `tools/make-quest-art.py`.

## Animations

- **Characters, and the avatars players choose, are drawn from their animations**: `stand_right`, `stand_left`, `walk_right`, `walk_left` and `portrait` (the poses, shown by themselves; a missing one is another one mirrored, so one picture makes a character), and any others by name (`wave`, `dig`). Each is a picture (a still image, an animated PNG or a sprite sheet) and the frames of it to play, so one sheet can serve several characters. Avatars are the platform's, drawn from the platform's own pictures (`platform_media`). Edited on the Characters page; see "Characters" in `docs/.../developers/extensions/animations.md`.
- **Any image can be a sprite sheet**: say how many frames across and down on the Media page. Characters take frames from it; animations named on the sheet itself are for items, vehicles and pictures (`idle` and `walk` play by themselves). An **animated PNG** is kept as it is and the game cuts it into frames as it loads.
- **Anything else is played when asked**: by a "Play an animation" action aimed at the player, an item or vehicle, a character or a picture; or by the player, from a **move** button on their screen.
- **Moves** are listed on the editor's Moves page. A move with a condition appears when the condition holds, so an event teaches a move by setting one of the player's own variables. Moves bought in the marketplace belong to the account and work in every scenario.
- **Five built-in moves** (jump, spin, crouch, wave, dance) work on any picture, sheet or not, by moving the picture itself. Frames drawn under the same name are used instead.
- A player's animation goes through the game server, so everyone in the scene sees it.

See "Animations" in `docs/src/content/docs/developers/extensions/animations.md`.

## Stars, XP, ranks and the marketplace

- **Stars** are earned through `award` actions and spent in the marketplace. **XP** is earned the same way, is never spent, and adds up to a **rank** (Cadet, Explorer, Navigator, Specialist, Commander, Admiral; thresholds in `apps/api/config/qbl.php`).
- Both belong to the player's account and are the same in every scenario. **Guests have neither**: sign in to earn them.
- An award is given **once per student** unless the author marks it repeatable. An award can also take stars or XP away; totals stop at zero.
- The **marketplace** sells things to wear (head, body, back, hand), pets that follow the avatar, ways for the avatar to move, and abilities. Players open it from their stars in the top-left corner of the game, or through a `shop` action, and choose what to have on under "My things". Other players see what they wear.
- Every scenario sells the platform's catalogue (`apps/api/database/seeders/data/shop.php`; there is no screen for editing it yet). Authors add **mission-specific items** on the editor's Shop page.
- **Abilities** are flags: while a player has one equipped, the variable `QL_Ability_<key>` is 1, and a scenario decides what that unlocks. They do not change walking speed or reveal distances.
- The backend grants awards, checking each against the published scenario, and keeps a ledger of every change. See "Stars, XP and the marketplace" in `docs/src/content/docs/developers/extensions/rewards.md`.

## The editor

Open `/editor`, sign in, and create a scenario. It gets a code of 16 random letters (changeable on its Publish page) and a first scene.

- **Scenes** are drawn to scale with everything in them. Add background and foreground layers (stretched to the scene, or repeated with a drift and parallax), walkable and blocked areas, spawn points, items and characters, and drag any of them into place. A scene larger than the screen scrolls as players walk.
- **Depth and discovery**: scale areas draw avatars, vehicles and items smaller towards the back of a scene; a hotspot can be given a distance within which it fades into view.
- **Events**: start, end, hotspot and indirect events, each with conditions and an ordered list of actions. Every action type in the docs has a form, as do the added actions: `avatar` (hide or show the player), `freeze` (hold the player still), `dialogue` (a speech bubble or a story box with a portrait), `conversation` (a dialogue tree: the player picks what to say, edited as a map and in a pop-up panel), `award` (give or take stars and XP) and `shop` (open the marketplace). Each event says who sees it: the player who sets it off, or everyone in the scene. "Exit along the left edge" and its siblings create the walk-in hotspot and jump action that move players between scenes.
- **Library**: media (upload, or by address; filed under backgrounds, characters, avatars, items, vehicles, shop items, sounds, video), variables (each marked as a player's own or shared), items, characters with their portraits, and the objectives checklist.
- **Shop**: the items only this scenario sells, with their price, picture and what they do.
- **Test this scene** opens the game on the draft, in that scene, playing alone with nothing saved, so you can check that actions behave. Nothing has to be published first.
- **Sprite sheets**: on a media card, the sheet is shown with its grid; pick frames for each animation and watch the preview.
- **Portraits** are shown wherever they are chosen. Making a picture an avatar, or giving a character a picture, makes a close-up from the top third of it; choose another whenever you like.
- **Actions are reordered by dragging** the grip at the left of each one. The lists in the scene outline are in alphabetical order, and each list, and each part of the inspector, folds away.
- **Publish** is a button on every page of a scenario, the scene editor included. It checks the scenario with the validator the game uses, then generates the JSON players get at `/{code}`. Players keep the last published version until you publish again.

Everything can be edited and deleted, and every change is saved as it is made. See `apps/editor/README.md`.

## Where the JSON comes from

The database holds a scenario as rows: scenes, events, actions, conditions, labels, media, variables, items and characters, as in the docs. `ScenarioCompiler` generates the scenario JSON from those rows. Publishing stores the generated document; that is what players and the game server get.

The demo mission, **Starship Explorer**, is shipped as a scenario ZIP, the same file the editor's "Export as ZIP" makes: `apps/api/database/seeders/scenarios/starship-explorer.zip`. To change the demo, edit it in the editor, export it, and replace that file (then run `npm run seed:export`).

- With the Laravel API, `ShippedScenarioSeeder` imports every ZIP in that folder through `ScenarioArchive`, into the tables the editor writes to, keeping the code and ids it was exported with, then publishes. This happens when you run `php artisan qbl:seed`, never by itself. The scenario is seeded once; after that it can be edited like any other, and seeding again leaves it alone. `qbl:seed --reset` puts the shipped version back.
- Without Laravel, `npm run seed:export` does the same into an in-memory SQLite database and writes `scenarios/starship.json` for the game server's file backend. That backend has no `/media`, so the files uploaded for the demo are copied to `scenarios/assets/starship/uploads`, and the JSON points there.

Both paths play the same document. `npm run test:api` checks that JSON generated from the seeded database is the ZIP's `scenario.json`, that `scenarios/starship.json` and its uploads are current, that seeding again does not disturb an edited scenario, and that seeding refuses to overwrite rows belonging to another scenario.

The demo's music and rocket sound are synthesised by `tools/make-demo-audio.py`.

## The app: installing QuestLab on phones and computers

The site is a progressive web app (PWA). Its files are in `apps/client/public` and Vite copies them into the build:

- `manifest.webmanifest`: name, colours, icons; it opens at `/missions`.
- `sw.js`: a small service worker. It keeps Vite's hashed bundles in a cache, and with no connection shows `offline.html`, which retries by itself. It does not touch the API, the game socket, media, the editor or the docs, and it is not registered under `vite` (development). Raise `VERSION` in it when `offline.html` or the icons change.
- `icons/`: drawn by `node tools/make-app-icons.mjs` from the "QL" mark.
- `.well-known/assetlinks.json`: written by the Android build (below).

Chrome, Edge and Samsung Internet offer to install the site; the account menu then shows **Install the app** (`apps/client/src/pwa.ts`). On an iPhone or iPad: Share → Add to Home Screen.

### The Android app

`tools/android` builds an Android app (a Trusted Web Activity): a small shell that opens the live site full screen in the phone's Chrome. It shows whatever the server has, so deploying the site updates the app. Rebuild it only to change its name, icon, colours or address (`tools/android/app.json`; package `cc.questlab.app`, site `dev.questlab.cc`).

```sh
cd tools/android && npm install
ANDROID_HOME=~/android-sdk QBL_ANDROID_KEYSTORE=~/questlab.keystore QBL_ANDROID_KEYSTORE_PASSWORD=… npm run build
```

It needs Java 17+ and an Android SDK with `sdkmanager "platforms;android-36" "build-tools;35.0.0"`. Out come `dist/questlab-<version>.apk` (to install directly) and `.aab` (for the Play Store), and `apps/client/public/.well-known/assetlinks.json`.

- **The signing key** (`QBL_ANDROID_KEYSTORE`, made on the first build if missing) must be kept, with its password, outside the repository: every update of the app has to be signed with the same key. `*.keystore` is ignored by git.
- **The site must serve `/.well-known/assetlinks.json`**, with the key's fingerprint, before the app opens without an address bar. It is committed, so deploying the client is enough. A different key, or a different site (`QBL_ANDROID_HOST`), means building again and committing the new file.
- **Play Store**: Google re-signs uploaded apps with its own key. Add that key's SHA-256 (Play Console → Test and release → App integrity) to `extraFingerprints` in `app.json`, build, and deploy the new `assetlinks.json`. Raise `versionCode` for every upload.
- Phones need Android 7.0 or newer and Chrome (or another browser that supports Trusted Web Activities). Without one, the app opens the site in a browser tab.

## Roadmap

1. Editor: undo, copying events and scenes, drawing areas by clicking, a rich-text field for infobox content, sharing a scenario between authors.
2. Accounts: classes and groups, roles beyond a `role` column, a group-picking lobby.
3. From the JSON docs, still open: `physical` items, intro splash media, animated avatars.
