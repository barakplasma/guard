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
  also be runnable directly on Android under Termux+Nix.
- **`chedule.csv`** — sample/legacy shift data (note the filename typo — it does *not* match the
  `schedule.csv` path `gs2.py` reads/writes). Treat it as example data, not a live schedule file.

Guard names throughout (`michael`, `eli`, `agmon`, `daniel`, etc.) are hardcoded example rosters from real
usage — don't treat them as required defaults when adding features, just as illustrative sample data.

## Running

No dependency manifest (no `requirements.txt`/`pyproject.toml`) and no virtualenv is set up. `gs2.py` needs
`pydantic` installed (`pip install pydantic`); `guard.py`/`guard-pickle.py` only use the stdlib.

```bash
# gs2.py: run with explicit args (positional: start end length positions guards...)
python3 gs2.py 2024-01-26T02:00:00 2024-01-27T02:00:00 90 2 Aviv Eli Yoad --dry_run

# or use the built-in demo mode (3 guards, 1-hour shifts, 24h, dry run)
python3 gs2.py --demo

# gs2.py also runs its module doctests every time it's executed (see `if __name__ == '__main__'` at the
# bottom), and they can be run standalone:
python3 -m doctest gs2.py -v

# guard-pickle.py: interactive, prompts for guard list and whether to save
python3 guard-pickle.py
```

There is no lint or test command configured — there are no test files, only doctests embedded in
`gs2.py`'s `compute_stats` and `validate_guard_list` docstrings.

## Conventions / gotchas

- `gs2.py` is the one actively evolving (see git log: "o1-preview refactor", "add validation via o1") — it
  supersedes `guard.py`/`guard-pickle.py` in scheduling behavior. Prefer extending `gs2.py` unless a change
  is specifically about the pickle-based interactive flow.
- Persistence format differs per script: `gs2.py` uses a flat CSV (`schedule.csv`, `guards` column is
  comma-joined names); `guard-pickle.py` uses Python `pickle` files (`roster.pickle`, `guards.pickle`) —
  these are not interchangeable.
- `gs2.py`'s scheduler assumes `len(guards) >= positions` for every shift or raises; it does not currently
  prevent back-to-back shifts across the position count (same gap noted as a `#TODO` in `guard.py`).
- `guard.py`'s `Roster.cal` field default (`Calendar([])`) is a mutable default via `@dataclass()` without
  `field(default_factory=...)` — be careful if adding more `Roster` instances in the same process, as they
  may share the underlying list.
