# DESIGN.md — Guard v3: self-hosted, offline, PocketBase-backed shift roster

Design spec for the next version of this project: a self-hosted web app that generates and serves
guard/watch duty rosters from a phone, with no external internet. This document is the implementation
contract — the actual code will be written in a later session against this spec.

## 1. Overview

**What it is.** A web replacement for `gs2.py`: guards get accounts, a commander generates
hour-balanced shift schedules, everyone views the roster live from their own phone.

**How it runs.** One Android phone hosts everything:

```
┌─ Android 16 phone ──────────────────────────────────┐
│  ┌─ Linux Terminal (Debian aarch64 VM) ──────────┐  │        wifi hotspot
│  │  pocketbase serve --http=0.0.0.0:8090         │  │  ←──  guard phones hit
│  │  ├── SQLite (pb_data/)                        │  │       http://<hotspot-ip>:8090
│  │  └── static frontend (pb_public/)             │  │
│  └───────────────────────────────────────────────┘  │
│  Terminal app port forwarding: VM :8090 → host      │
└──────────────────────────────────────────────────────┘
```

Guards connect to the phone's wifi hotspot and open the app in their browser. Nothing leaves the
hotspot; the app makes zero requests to the internet.

**Goals**

- Self-hosted on the Android 16 Linux Terminal (Debian VM), single PocketBase binary, SQLite storage.
- Fully offline: no CDNs, no webfonts, no analytics, no remote APIs — every asset vendored.
- Bilingual UI: Hebrew (RTL) and English (LTR), switchable at runtime.
- Per-user accounts: guards see "my shifts", commanders generate schedules, shift swaps supported.
- Preserves `gs2.py`'s scheduling behavior (heap-based hour balancing) while fixing its known
  alphabetical tie-break unfairness (see CLAUDE.md gotchas).

**Non-goals**

- Cloud sync, public internet exposure, HTTPS/TLS, native mobile apps, push notifications,
  multi-tenant use. One roster, one hotspot, one superuser.

## 2. Deployment architecture

### 2.1 PocketBase in the Debian VM (primary path)

- Binary: PocketBase **linux_arm64** release zip (pin a version in `scripts/setup.sh`, e.g. the
  latest 0.3x at implementation time; PocketBase ≥ 0.23 required — the spec uses its "superuser"
  terminology and current migration API).
- Run: `./pocketbase serve --http=0.0.0.0:8090` from a directory containing `pb_data/`,
  `pb_public/`, `pb_migrations/`. Binding `0.0.0.0` (not `127.0.0.1`) is required so the VM's NIC —
  and therefore the Terminal app's port forwarding — can reach it.
- Admin UI at `http://localhost:8090/_/` from within the phone for superuser tasks.

**Android 16 networking caveat (verify on-device, first thing).** The Terminal app forwards VM ports
to the Android host (Terminal settings → Port forwarding → enable 8090). What is *documented* is
host-`localhost` access; whether the forwarded port is also reachable from **other devices on the
hotspot** (i.e. bound on all host interfaces, `http://192.168.x.1:8090` from a guard's phone) must be
tested on the actual device before building anything else. This is the riskiest assumption in the
design, so it is verification step #1 in §9.

### 2.2 Fallback: Termux

If hotspot clients cannot reach the forwarded port, run the **same** arm64 binary directly on Android
under Termux (`pkg install` not needed — PocketBase is a static binary; just `chmod +x` and run).
Termux processes bind on the device's real interfaces, so the hotspot IP works natively. Everything
in this spec (`pb_data/`, `pb_public/`, `pb_migrations/`, setup script) is path-relative and works
identically in both environments. Keep the Debian VM as primary (systemd, nicer tooling), Termux as
the documented plan B.

### 2.3 Autostart

- Debian VM: a systemd **user** unit, `scripts/guard.service`:

  ```ini
  [Unit]
  Description=Guard roster (PocketBase)
  After=network.target

  [Service]
  WorkingDirectory=%h/guard
  ExecStart=%h/guard/pocketbase serve --http=0.0.0.0:8090
  Restart=on-failure

  [Install]
  WantedBy=default.target
  ```

  Installed with `systemctl --user enable --now guard` (+ `loginctl enable-linger $USER` so it
  survives logout).
- Termux fallback: a one-line `~/.termux/boot/` script or just a foreground run with a wake lock
  (`termux-wake-lock`); document both in the README section of the setup script.

### 2.4 Install (`scripts/setup.sh`)

Internet is needed **once**, at install time, to download the PocketBase release. After that the
system is fully offline. The script:

1. Downloads the pinned `pocketbase_<ver>_linux_arm64.zip` (checksum-verified), unzips next to the
   repo's `pb_public/` and `pb_migrations/`.
2. Runs `./pocketbase migrate up` (applies the checked-in JS migrations; `serve` also auto-applies
   them, but running explicitly surfaces errors early).
3. Creates the superuser non-interactively:
   `./pocketbase superuser upsert "$EMAIL" "$PASSWORD"`.
4. Prints the URLs to test: `http://localhost:8090` (in-VM), the host-forwarded URL, and the hotspot
   URL pattern.

### 2.5 Offline reality check: no service worker

Guard phones reach the app over plain HTTP on a private IP — an **insecure origin**. Browsers only
allow service workers / full PWA install on secure contexts (`https:` or `localhost`), so:

- **No service worker.** "Offline" in this design means *the server is on the LAN and all assets are
  self-contained* — the app works with zero internet because nothing references the internet. If the
  hotspot is up, the app is up.
- Ship `manifest.json` + icons anyway: Android Chrome still offers a plain "Add to Home Screen"
  shortcut (no offline caching, but a full-screen icon-launched experience).
- Self-signed certificates / local CA to unlock real PWA install are **explicitly out of scope**
  (per-device cert install is more friction than value here).
- Set far-future `Cache-Control` is unnecessary — PocketBase serves `pb_public/` fine with defaults;
  do not add cache-busting build machinery (there is no build).

## 3. Data model

All collections are defined by **checked-in JS migration files in `pb_migrations/`** — the schema's
source of truth, applied automatically on first `serve`. Never configure collections only via the
admin UI; every schema change is a migration file so a fresh install reproduces the whole backend.

### 3.1 `users` (auth collection — extend the built-in one)

| field    | type                              | notes                                            |
|----------|-----------------------------------|--------------------------------------------------|
| `name`   | text, required                    | display name shown on the roster                 |
| `role`   | select: `commander` \| `guard`    | default `guard`                                  |
| `active` | bool, default `true`              | on the duty roster (selectable when generating)  |

- **Signup**: open (create rule allows anyone) since only hotspot clients can reach the server. New
  accounts always get `role = guard` — the create rule must forbid setting `role`
  (`@request.body.role = ""` style guard, or set via an `onRecordCreate` hook); only the superuser
  promotes commanders via the admin UI.
- Identity: username or email + password. Email doesn't have to be real (no SMTP, no verification —
  disable `onlyVerified` requirements).

### 3.2 `schedules` — one generation batch

| field           | type                       | notes                                  |
|-----------------|----------------------------|----------------------------------------|
| `start`         | date, required             | batch window start (UTC)               |
| `end`           | date, required             | batch window end (UTC)                 |
| `shift_minutes` | number, required, > 0      | length of each shift                   |
| `positions`     | number, required, ≥ 1      | guards per shift                       |
| `created_by`    | relation → users, required | the commander who generated it         |

Grouping shifts into a batch makes preview → save atomic-ish and lets a commander delete a whole
batch (cascade-delete its shifts via the relation's `cascadeDelete` flag on `shifts.schedule`).

### 3.3 `shifts`

| field      | type                                    | notes                          |
|------------|-----------------------------------------|--------------------------------|
| `schedule` | relation → schedules, cascadeDelete     | batch this shift belongs to    |
| `start`    | date, required                          | UTC                            |
| `end`      | date, required                          | UTC, must be > start           |
| `guards`   | relation → users, multiple, min 1       | assigned guards                |

### 3.4 `swap_requests`

| field       | type                                                        | notes                                 |
|-------------|-------------------------------------------------------------|---------------------------------------|
| `shift`     | relation → shifts, required                                 |                                        |
| `from_user` | relation → users, required                                  | must be assigned to `shift`           |
| `to_user`   | relation → users, required                                  | must NOT be assigned to `shift`       |
| `status`    | select: `pending` \| `accepted` \| `declined` \| `cancelled`| default `pending`                     |

**Swap flow** (all client-side, two writes): guard A creates a request targeting guard B; B sees it
(realtime subscription) and accepts/declines. On accept, the client updates `status` **and** rewrites
`shifts.guards` replacing A with B. The `shifts` update rule must therefore also allow a user who is
the `to_user` of an accepted pending request for that shift (see rules below) — or, simpler and
recommended: allow any **authenticated** user to update *only* the `guards` field of a shift they are
gaining/losing via an accepted swap is hard to express in rules, so instead route the accept through a
small **`pb_hooks/swaps.pb.js`** hook: `onRecordUpdate` on `swap_requests` that, when `status`
transitions to `accepted` (and the updater is `to_user`), performs the guard replacement server-side
with elevated privileges and validates A∈guards, B∉guards. This is the *only* pb_hooks usage in the
app; everything else stays client-side.

### 3.5 API rules (PocketBase rule syntax)

| collection      | list/view                     | create                                          | update                                            | delete                          |
|-----------------|-------------------------------|-------------------------------------------------|---------------------------------------------------|---------------------------------|
| `users`         | `@request.auth.id != ""`      | open (`""`… empty rule), role forced to `guard` | `id = @request.auth.id` (own profile only)        | superuser only (`null`)         |
| `schedules`     | `@request.auth.id != ""`      | `@request.auth.role = "commander"`              | `@request.auth.role = "commander"`                | `@request.auth.role = "commander"` |
| `shifts`        | `@request.auth.id != ""`      | `@request.auth.role = "commander"`              | `@request.auth.role = "commander"` (swaps go via hook) | `@request.auth.role = "commander"` |
| `swap_requests` | `@request.auth.id != ""`      | `@request.auth.id = @request.body.from_user`    | `@request.auth.id = from_user \|\| @request.auth.id = to_user` | `@request.auth.id = from_user` |

(Exact rule strings to be finalized against the pinned PocketBase version's syntax during
implementation; the table states intent.)

### 3.6 Time handling

PocketBase stores dates as UTC strings. The app treats **device-local time** (Asia/Jerusalem in
practice) as the human interface: all inputs are interpreted local and converted to UTC on write; all
displays convert UTC → local via `Intl.DateTimeFormat`. No timezone setting in the app.

## 4. Scheduling algorithm — `pb_public/scheduler.js`

A dependency-free **pure ES module**; PocketBase is not imported here. This is the port of
`gs2.py:main`'s scheduling loop plus `compute_stats`, with one deliberate behavior change.

```js
// All times are ms epoch numbers inside the module; callers convert Date ⇄ number.
export function generateShifts({ start, end, shiftMinutes, positions, guards, existingShifts })
  // -> [{ start, end, guards: [name, ...] }, ...]   (only the NEW shifts)

export function computeStats(shifts)
  // -> { hoursPerGuard: Map<name, hours>, variance: number|null }  (mirrors gs2.py compute_stats)
```

**Algorithm (identical to `gs2.py`)**

1. Validate: `end > start`, `shiftMinutes > 0`, `positions ≥ 1`, guards non-empty & unique,
   `guards.length ≥ positions`.
2. Seed each guard's `nextAvailable` from `existingShifts` (max `end` of any shift they're on; epoch 0
   otherwise).
3. Min-heap of guards keyed as below; for each slot `[t, t + shiftMinutes)` pop `positions` guards,
   assert each popped guard's `nextAvailable ≤ t` (throw "not enough guards" / "guard not available"
   like the Python asserts), assign, set their `nextAvailable = t + shiftMinutes`, push back.

**The deliberate change — fair tie-breaking.** `gs2.py`'s heap key is
`(nextAvailable, name)`, so ties resolve alphabetically and (per CLAUDE.md, confirmed by running
`--demo`) Alice works 24/24 demo shifts while Bob and Carol work 12. New key:

```
(nextAvailable, totalAssignedHours, insertionCounter)
```

- `totalAssignedHours` — hours accumulated *within this generation run plus existing shifts*, so the
  guard with fewer total hours wins ties (this is the actual fairness goal).
- `insertionCounter` — a monotonically increasing sequence number assigned on every push, making the
  heap stable/deterministic without comparing names (FIFO among full ties → rotation).

The demo case (3 guards, 2 positions, 24 × 1h) must come out 16/16/16 ±1 instead of 24/12/12.

**Testing.** `scheduler.js` must run under both browsers and Node:

- `tests/scheduler.test.js` using `node:test` + `node:assert` (dev-machine only; Node is never
  required on the phone). Cases: demo-fairness (16/16/16), parity with `gs2.py` on a
  no-ties input (positions=1, staggered availability — outputs must match exactly), validation
  errors, seeding from existing shifts, stats variance (`[4h, 8h] → 4.0`, the *correct* value — note
  the `gs2.py` doctest itself is wrong here per CLAUDE.md).
- `pb_public/tests.html` — a plain page that imports the same test cases and renders pass/fail, so
  the suite can be run on the phone with zero tooling.

## 5. Frontend — `pb_public/`

Vanilla HTML/CSS/JS, **no build step, no npm on the phone**. All assets local:

```
pb_public/
  index.html          # single page, hash-based routing
  app.js              # views, routing, PocketBase wiring (ES module)
  scheduler.js        # §4
  i18n.js             # §6
  pocketbase.umd.js   # vendored PocketBase JS SDK (checked into the repo)
  styles.css          # single stylesheet, logical properties, system font stack
  manifest.json       # name/icons/theme for Add-to-Home-Screen
  icons/              # 192px + 512px PNG
  tests.html          # in-browser scheduler test runner
```

**SPA structure.** Hash router (`#/roster`, `#/generate`, `#/me`, `#/stats`, `#/login`) — no History
API (avoids server-side rewrite config). One `PocketBase` client instance; auth persisted by the
SDK's default localStorage auth store, so guards stay logged in across visits.

**Views**

- **Login / Signup** — username/email + password; signup collects display name. No email
  verification.
- **Roster** (default, `#/roster`) — chronological shift list grouped by day. Each row: time range,
  guard names. Highlights: shifts containing the logged-in user; a "now" marker on the current
  shift (client clock). Filter dropdown by guard. Past batches collapsible.
- **Generate** (`#/generate`, commander-only; hidden + rule-enforced otherwise) — form: start, end
  (datetime-local inputs), shift length (minutes), positions, guard checklist (active users,
  pre-checked). **Preview step**: runs `generateShifts` locally against existing future shifts,
  renders the would-be roster + `computeStats` output (hours per guard, variance) — the `--dry_run`
  equivalent. **Save**: creates the `schedules` record then batch-creates `shifts` records (use the
  SDK's batch API if available in the pinned version; otherwise sequential creates with a progress
  indicator and delete-batch-on-partial-failure cleanup).
- **My shifts** (`#/me`) — the user's upcoming shifts; per shift a "request swap" action (pick a
  target guard) and a list of incoming/outgoing swap requests with accept/decline/cancel.
- **Stats** (`#/stats`) — hours per guard (all time and per batch), population variance; a simple
  horizontal bar per guard (plain CSS divs, no chart library).

**Realtime.** Subscribe (SSE) to `shifts` and `swap_requests`; on any event re-fetch the affected
list. Keeps every phone's roster live while connected to the hotspot. Handle `EventSource` drops
with the SDK's built-in reconnect; the UI must also work with realtime unavailable (manual refresh).

**CSV import** (nice-to-have, last phase) — commander-only textarea/upload accepting the legacy
`schedule.csv` format (`start,end,"comma,joined,names"`, ISO 8601). Rows become shifts in a new
"imported" batch; guard names are matched to users by `name` (unmatched names block the import with
a clear message). Gives a migration path off `gs2.py` without scripting.

## 6. i18n & RTL

- `i18n.js` exports `t(key, params?)` and holds **inline** dictionaries `he` and `en` (no fetches, no
  JSON files — keeps it one static asset). Every user-visible string goes through `t()`; keys are
  English-ish slugs (`roster.title`, `swap.accept`, …).
- Default language: `navigator.language.startsWith('he') ? 'he' : 'en'`; header toggle (עב / EN)
  persisted to `localStorage`, applied without reload.
- Switching sets `document.documentElement.lang` and `dir` (`rtl` for Hebrew). All CSS uses
  **logical properties** (`margin-inline-start`, `padding-inline`, `text-align: start`, flexbox) so
  a single stylesheet serves both directions — no `[dir=rtl]` overrides except genuinely directional
  icons.
- Dates/times/numbers formatted with `Intl.DateTimeFormat`/`Intl.NumberFormat` using the active
  locale (`he-IL` / `en-IL`); `gs2.py`'s `%d/%m %H:%M` style is the model for roster rows.
- Fonts: system stack only (`system-ui, "Segoe UI", Roboto, "Noto Sans Hebrew", sans-serif`) —
  Android ships Hebrew glyphs; nothing to download.

## 7. Repo layout

```
DESIGN.md                # this file
pb_migrations/           # JS migrations — schema source of truth (§3)
pb_hooks/
  swaps.pb.js            # the single server hook: apply accepted swaps (§3.4)
pb_public/               # frontend (§5)
scripts/
  setup.sh               # §2.4
  guard.service          # §2.3
tests/
  scheduler.test.js      # node:test suite (§4)
# legacy, untouched:
gs2.py  guard.py  guard-pickle.py  chedule.csv  CLAUDE.md
```

- `pb_data/` and the `pocketbase` binary are **gitignored** (add entries).
- The Python scripts remain as reference; `gs2.py` is the behavioral oracle for scheduler parity
  tests. CLAUDE.md gets a new section describing v3 once implemented.

## 8. Implementation phases (for the follow-up session)

1. **Backend skeleton** — migrations for the four collections + rules, `setup.sh`, `guard.service`,
   gitignore updates. *Verify*: fresh `./pocketbase serve` on a clean dir creates the schema;
   CRUD via `curl` respects the rules (guard can't create shifts, commander can).
2. **Scheduler** — `scheduler.js` + `tests/scheduler.test.js` + `tests.html`. *Verify*: `node --test`
   green; parity case matches `python3 gs2.py` output on the same no-ties input; demo case is
   16/16/16.
3. **Core UI** — login/signup, roster view, generate flow with preview/save, realtime. *Verify*:
   two browsers side by side, generate in one, roster updates in the other.
4. **i18n/RTL** — wrap all strings, toggle, logical-properties audit. *Verify*: visual pass in
   Hebrew — layout mirrored, dates localized, no stray LTR strings.
5. **Swaps + stats + CSV import + polish** — `swaps.pb.js` hook, `#/me`, `#/stats`, import.
   *Verify*: full swap round-trip between two accounts; imported legacy `chedule.csv` rows render.
6. **On-device deployment** — run `setup.sh` in the Android 16 Terminal VM, enable port forwarding,
   systemd unit. *Verify*: §9 end-to-end.

## 9. End-to-end verification (on the actual phone)

1. **Reachability first** (de-risks §2.1 before any app work — can be done with a bare
   `pocketbase serve` and its default page): VM `localhost:8090` ✓ → Android host browser ✓ →
   second device on the hotspot ✓. If step 3 fails, switch to the Termux fallback (§2.2) and re-test.
2. Enable hotspot, put the **client** device in airplane mode + wifi-only to prove no internet
   dependency; load the app, watch devtools/network for any non-`<hotspot-ip>` request (must be none).
3. Full flow from the client device, in Hebrew: signup → commander (promoted via admin UI) generates
   a 24h/2-position/3-guard schedule → preview shows balanced hours → save → roster appears on a
   third device in realtime → swap request round-trip → stats match `computeStats`.
4. Reboot the phone; confirm the systemd unit brings PocketBase back without manual steps.
