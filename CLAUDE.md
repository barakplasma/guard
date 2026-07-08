# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small personal utility for generating guard/watch duty shift rosters — assigns a rotating set of people to
timed shifts (e.g. overnight guard duty), trying to balance total hours per person. There is no application
framework, package structure, or test suite; it's a handful of standalone Python scripts.

## Scripts

- **`gs2.py`** — the current/active implementation. Pydantic-based `Shift` model, CLI via `argparse`,
  persists the roster to `schedule.csv` (read on start, appended to and rewritten on save), and picks the
  next-available guard(s) for each shift using a `heapq` keyed on when each guard is next free. This is the
  file to edit for new scheduling logic.
- **`guard.py`** — an earlier, dataclass-based implementation (`Guard`, `Calendar`, `CItem`, `Roster` classes)
  using a `PriorityQueue` ordered by `Guard.__gt__` (last shift time, then total guarded time). Imported by
  `guard-pickle.py`; not used by `gs2.py`.
- **`guard-pickle.py`** — interactive CLI wrapper around `guard.py`. Prompts on stdin (`make new? Y/n`, guard
  names, `save? Y/n`) and persists the `Roster` via `pickle` to `roster.pickle` / `guards.pickle`. Has a
  Termux/Nix shebang (`#!/data/data/com.termux.nix/files/home/.nix-profile/bin/python`), i.e. it's meant to
  also be runnable directly on Android under Termux+Nix. **Currently broken** on Python ≥3.10 — see gotchas.
- **`chedule.csv`** — sample/legacy shift data (note the filename typo — it does *not* match the
  `schedule.csv` path `gs2.py` reads/writes). Treat it as example data, not a live schedule file.

Guard names throughout (`michael`, `eli`, `agmon`, `daniel`, etc.) are hardcoded example rosters from real
usage — don't treat them as required defaults when adding features, just as illustrative sample data.

## Running

No dependency manifest (no `requirements.txt`/`pyproject.toml`) and no virtualenv is set up. `gs2.py` needs
`pydantic` installed (`pip install pydantic`); `guard.py`/`guard-pickle.py` only use the stdlib.

```bash
# gs2.py: run with explicit args (positional: start end length_minutes positions guards...)
# writes/updates ./schedule.csv (reads it first if present, appends new shifts, rewrites the whole file)
python3 gs2.py 2024-01-26T02:00:00 2024-01-27T02:00:00 90 2 Aviv Eli Yoad

# --dry_run: prints the schedule instead of writing schedule.csv
python3 gs2.py 2024-01-26T02:00:00 2024-01-27T02:00:00 90 2 Aviv Eli Yoad --dry_run

# or use the built-in demo mode (3 guards, 1-hour shifts, 24h, dry run, no CLI args needed)
python3 gs2.py --demo

# guard-pickle.py: interactive, prompts for guard list and whether to save — currently crashes on
# `import guard` before it can prompt (see gotchas), do not rely on it working as-is
python3 guard-pickle.py
```

Verified by actually running both entry points (Python 3.11.15, `pip install pydantic` → 2.13.4):

- `python3 gs2.py --demo` runs to completion and prints a 24-shift schedule, but first prints a
  `PydanticDeprecatedSince20` warning (see gotchas) and a **doctest failure** (see below) to stderr before
  the demo output — this is expected on a clean install, not a sign something is misconfigured.
- `python3 gs2.py <start> <end> <length> <positions> <guards...>` (no `--dry_run`) does write a
  `schedule.csv` in the current directory, formatted as
  `start,end,guards` with ISO 8601 timestamps and a quoted comma-joined guard list, e.g.
  `2024-01-26T02:00:00,2024-01-26T03:30:00,"Aviv,Eli"`. Re-running in the same directory reads that file
  back in and appends further shifts to it.
- `python3 guard-pickle.py` does **not** work currently — it fails immediately on `from guard import ...`
  (see gotchas), before any of its interactive prompts run.

`gs2.py` also runs its module doctests every time it's executed (see `if __name__ == '__main__'` at the
bottom); they can be run standalone with `python3 -m doctest gs2.py -v`. There is no lint command
configured, and no test files beyond those doctests.

## Conventions / gotchas

- `gs2.py` is the one actively evolving (see git log: "o1-preview refactor", "add validation via o1") — it
  supersedes `guard.py`/`guard-pickle.py` in scheduling behavior. Prefer extending `gs2.py` unless a change
  is specifically about the pickle-based interactive flow.
- Persistence format differs per script: `gs2.py` uses a flat CSV (`schedule.csv`, `guards` column is
  comma-joined names); `guard-pickle.py` uses Python `pickle` files (`roster.pickle`, `guards.pickle`) —
  these are not interchangeable.
- **`guard.py` currently fails to import** on Python 3.11+ (and any Python where `dataclasses` rejects
  unhashable mutable defaults, i.e. ≥3.10ish): `Roster.cal: Calendar = Calendar([])` is a mutable default
  passed directly instead of via `field(default_factory=...)`, and `dataclasses` raises
  `ValueError: mutable default <class 'guard.Calendar'> for field cal is not allowed: use default_factory`
  at class-definition time. This means `guard-pickle.py` (which imports `guard`) is unrunnable until that
  field is fixed — it's not just a "shared state" risk, it's a hard crash.
- **The doctest in `compute_stats` (`gs2.py`) currently fails**: it expects
  `Population variance for guard shifts: 8.0` for hours `[4.0, 8.0]`, but `statistics.pvariance([4.0, 8.0])`
  is actually `4.0` (mean 6, squared deviations 4 and 4, average 4). The docstring's expected output is
  wrong, not the implementation — fix the doctest's expected value (or the guards' worked example) rather
  than "fixing" `compute_stats` itself.
- **`gs2.py`'s guard-selection heap breaks ties alphabetically by name**, since the heap holds
  `(next_available_time, guard_name)` tuples and equal availability times fall back to comparing names.
  In practice this means whichever guard sorts first alphabetically gets picked in every tied shift: e.g.
  `--demo`'s `['Alice', 'Bob', 'Carol']` over 24 one-hour/2-position shifts yields Alice on all 24 shifts but
  Bob and Carol on only 12 each (confirmed by running it) — the "balance total hours" goal is not actually
  met when guard availability ties, which it does by construction every time positions > 1.
- `gs2.py` (`pydantic>=2`, currently installed as 2.13.4) still uses the Pydantic **v1** `@validator`
  decorator, which works but prints a `PydanticDeprecatedSince20` warning on every run; there's no pinned
  `pydantic` version anywhere, so a fresh `pip install pydantic` will always hit this until it's migrated to
  `@field_validator`.
- `gs2.py`'s scheduler assumes `len(guards) >= positions` for every shift or raises; it does not currently
  prevent back-to-back shifts across the position count (same gap noted as a `#TODO` in `guard.py`).

## v3 — Guard Roster web app (PocketBase + React/MUI)

Implements `DESIGN.md`'s self-hosted, offline roster web app, with two deliberate deviations from that
spec (per explicit follow-up instructions): the frontend uses a Vite build step (not vanilla no-build JS)
so it can pull in real npm libraries, it's built with **React + Material UI** instead of hand-rolled
HTML/CSS/JS, and there is no PWA/`manifest.json`/Add-to-Home-Screen support at all. Everything else in
DESIGN.md (data model, API rules, scheduler algorithm, i18n/RTL, swap flow, deployment topology) applies
as written.

**Layout**

```
package.json                # root-level, {"type":"module"} only - needed so `node --test` works
                             # regardless of a given Node build's ESM-auto-detection behavior
                             # (confirmed to matter: Node 22 didn't need this, Node 24 did)
scheduler/scheduler.js      # pure ES module: generateShifts()/computeStats(), no deps, shared by
                             # frontend, tests/scheduler.test.js (node:test), and frontend/tests.html
tests/
  scheduler.test.js          # unit tests, no PocketBase needed
  pb-integration.test.js      # spins up an ISOLATED pocketbase (tmp --dir, port 8099) against the
                             # real pb_migrations/pb_hooks, exercises auth rules + swap flow + multi-
                             # position roster generation, tears itself down. Skipped (not failed) if
                             # ./pocketbase isn't present. Never touches the real pb_data/.
pb_migrations/*.js           # schema source of truth - extends "users", creates schedules/shifts/swap_requests
pb_hooks/
  users.pb.js                # forces role="guard" + active=true on public signup
  swaps.pb.js                # onRecordUpdateRequest: applies an accepted swap's guard replacement
frontend/                    # Vite + React + MUI source (see below)
scripts/
  setup.sh                   # downloads pocketbase, builds the frontend, migrates, creates superuser
  guard.service               # systemd --user unit (Debian VM path)
pb_public/                   # GITIGNORED - `frontend`'s build output, served by PocketBase. Rebuilt by
                             # scripts/setup.sh; there is nothing here until you build.
pb_data/                     # GITIGNORED - PocketBase's SQLite data dir
pocketbase                   # GITIGNORED - the downloaded binary
```

**Frontend build step.** `cd frontend && npm install` then either `npm run dev` (Vite dev server; point
`frontend/.env.development`'s `VITE_PB_URL` at a separately-running `pocketbase serve`) or `npm run build`
(outputs straight into `../pb_public`, the directory PocketBase serves as static files — see
`frontend/vite.config.js`). This means, unlike DESIGN.md's original "no build step, no npm on the phone"
plan, **Node/npm now has to be present on-device** (Debian VM or Termux) to run `npm run build` once
during `scripts/setup.sh` — after that build, the app is exactly as offline as the original design: the
built bundle is static files, nothing fetches the internet, no service worker, no install-to-home-screen.

**Tech**: React Router (`HashRouter`, matching DESIGN.md's no-History-API constraint), MUI
`ThemeProvider`/`CssBaseline` with a system-font-only theme (no webfonts, still fully offline), an
`@emotion/cache` + `stylis-plugin-rtl` swap for Hebrew RTL, the official `pocketbase` npm package (not a
vendored UMD build) for the SDK, and `scheduler/scheduler.js` imported directly by both the app and its
own test suite so there's exactly one implementation of the scheduling algorithm.

**Verifying**: `node --test` (needs the root `package.json` above) runs both suites. `pb-integration.test.js`
has been run for real against the actual PocketBase binary on the deployed host. It found and fixed two real
bugs along the way that pure syntax-checking couldn't have caught:
- `collection.fields.add()` on an *existing* collection needs actual `core.Field` instances
  (`new SelectField(...)`/`new BoolField(...)`), unlike `new Collection({ fields: [...] })`'s constructor,
  which accepts plain object literals - `pb_migrations/1700000000_users.js` was fixed to match.
- `scripts/setup.sh` wasn't catching `pocketbase migrate up` printing "Error: ..." while still exiting 0;
  it now greps command output explicitly instead of trusting the exit code alone, and checks
  `SUPERUSER_PASSWORD` length upfront.

### Named, time-restricted positions

Positions are named entities a commander manages (e.g. "דרומי", "ש''ג"), not a plain per-shift
headcount, and can be time-restricted (e.g. "פטרול" only staffed 22:00-06:00) - added per follow-up
request, on top of the v3 implementation above.

- **`positions` collection** (`pb_migrations/1700000004_positions.js`): `name`, `time_restricted` (bool),
  `window_start`/`window_end` (text, "HH:MM" 24h, only meaningful when `time_restricted`), `active` (bool).
  Commander-only create/update/delete; any authenticated user can list/view (needed for the roster).
- **`schedules.positions`**: was a plain `number` headcount, now a required multi-relation to `positions` -
  the set of named posts a generation batch covers (`1700000005_schedules_named_positions.js`).
- **`shifts`**: was a single `guards` multi-relation (one row per time-slot, N guards), now a required
  single `position` relation + single `guard` relation (one row per guard-filling-one-position-for-one-
  slot) - `1700000006_shifts_named_positions.js`. `pb_hooks/swaps.pb.js` simplified to match: accepting a
  swap now just overwrites `guard` directly instead of relation +/- syntax on an array.
- **`scheduler/scheduler.js`**: `generateShifts()`'s `positions` param changed from a count to an array of
  `{id, name, timeRestricted, windowStart, windowEnd}`. Per slot, a time-restricted position only counts as
  "active" if the slot's LOCAL hour/minute falls in its window (handles overnight wraps like 22:00-06:00);
  all positions still share one fairness pool (a guard's total hours across every position they fill is
  what gets balanced, not per-position). Output rows are `{start, end, position, guard}` (singular `guard`,
  matching the new `shifts` shape) instead of `{start, end, guards: [...]}`.
- These migrations were written as NEW files rather than edits to the already-applied
  `1700000001_schedules.js`/`1700000002_shifts.js`, so `./pocketbase migrate up` on an already-provisioned
  instance (or the running `guard.service`, which auto-applied them live without a restart) picks up the
  schema change correctly instead of silently diverging from a would-be-edited historical migration.
- Frontend: new commander-only `Positions` page/tab (CRUD for named positions, time-window inputs).
  `Generate` swapped its positions-count field for a position checklist; its preview groups rows by
  time-slot so a slot reads like "18:00 - 19:00: דרומי - Alice, ש''ג - Bob". `Roster` groups
  concurrent same-slot rows the same way. `MyShifts`/`Stats` updated for the singular `guard` field.
- `tests/scheduler.test.js` and `tests/pb-integration.test.js` (9 cases, including a live time-window
  round-trip through the real positions/schedules/shifts collections) were rewritten for the new shapes and
  pass; `frontend/src/browserTests.js` was updated to mirror `scheduler.test.js` but **not** re-run in an
  actual browser this session (no headless-browser tooling on this host) - build + lint are clean and the
  identical logic is covered by the Node suite, but visually exercise `pb_public/tests.html` before fully
  trusting it.
