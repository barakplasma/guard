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
scheduler/scheduler.js      # pure ES module: generateShifts()/computeStats(), no deps, shared by
                             # frontend, tests/scheduler.test.js (node:test), and frontend/tests.html
tests/scheduler.test.js      # `node --test` (or `node --test tests/scheduler.test.js`)
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

**Verifying**: `node --test` runs the scheduler suite (dependency-free, no PocketBase needed). Migrations
and hooks are written against the documented PocketBase JS/JSVM API but have only been syntax-checked
(`node --check`) in this environment — the sandboxed session couldn't download a PocketBase binary to
run them end-to-end (no network access to GitHub releases), so run `./pocketbase migrate up` and exercise
the app for real before trusting the rules/hooks in production.
