# ADR 011: If a solver, then Pumpkin

- Status: Proposed. Depends on ADR 009. Closes ADR 008's defect 3.
  Independent of ADR 010. Sized by ADR 012.
  **Made urgent by ADR 013**: the defect it fixes fires on nearly every
  mid-schedule insertion, which is the normal operation.
- Date: 2026-09-15

## Context

The original question was whether [MiniZinc's JavaScript
API](https://docs.minizinc.dev/en/stable/javascript.html) would improve the
hand-written engine. Two early objections are recorded here only so they are not
re-derived, because both were measured correctly and both were beside the point:

- **A solver cannot reproduce a schedule byte for byte.** True, and it does not
  matter. One person edits this rota on one device; nobody opens the link and
  diffs two renders. ADR 009 is what protects the past, not determinism.
- **The WebAssembly payload is large.** Also true, also irrelevant. Download
  size is not a constraint on this project.

What *is* a constraint: prefer maintained libraries over hand-written
algorithms, and ship one solver rather than a toolchain of them.

## How big the problem is

ADR 012 fixes the horizon at 72 hours, which is 648 assignments for the current
roster shape. That is a small constraint problem. No time limit, no
decomposition and no incremental solving are needed, on a phone or anywhere
else, which removes the last practical objection to running a solver in the
browser.

## What a solver would buy

ADR 008's defect 3: the staffing pass is incomplete, reporting shortages on
rosters that can be staffed in full. A solver closes that class by construction
rather than by another ordering heuristic.

This is no longer a theoretical gap. The reported case (ADR 013,
`scripts/midScheduleCallout.mjs`) is a mission added mid-schedule needing two
drivers, where the engine staffs one and reports a shortage while the second
driver stands an unconstrained post. It works on the hour and fails off it, and
real callouts do not start on the hour.

Note that the per-segment matcher rejected below would **not** fix the reported
case either. The trade needed crosses both missions and segment boundaries: the
driver must come off a post whose hour started before the callout existed. Only
assigning globally handles that.

The tempting alternative is to lift `choose` from per-mission to per-segment,
hand-writing a bipartite matcher, with no new dependency. **That is the wrong
direction**, and not because of diff size. Bespoke optimisation code is where
this engine's defects came from: the ring that counted merged runs and stranded
three guards on post for 88 hours (ADR 002's history), and the scarcity ordering
written specifically to close this gap that did not close it (ADR 005). The
matching libraries that might have substituted are dead - `munkres-js` last
published 2017, `logic-solver` 2016, `kiwi.js` 2021.

So the solver is the option that **removes** custom algorithm code instead of
adding more.

## The candidates

### Rejected: `or-tools-wasm`

| package | maintainers | releases | first | latest |
|---|---|---|---|---|
| `minizinc` | 3 | 409 | 2019-06-04 | 2026-09-14 |
| `or-tools-wasm` | 1 | 6 | 2026-05-13 | 2026-06-08 |

CP-SAT is an excellent solver for this problem shape, but the binding is the
dependency, not the algorithm. `or-tools-wasm` is one person's port at 0.9.1,
four months old, with nothing shipped in three.

### Rejected: building an OR-Tools WebAssembly port ourselves

Two ports already exist: [`Axelwickm/or-tools-wasm`](https://github.com/Axelwickm/or-tools-wasm)
and [`kjartanm/wasm-or-tools`](https://github.com/kjartanm/wasm-or-tools) (9
stars, no visible recent activity). Neither has a team.

Upstream does not support this. From the OR-Tools maintainers on
or-tools-discuss, 5 May 2025: *"emscripten is currently a low priority with zero
human ressource allocated to it"*, *"currently disabling most third party
solvers so only cp-sat and glop are available"*, and *"Had to disable all tests
since EXPECT_DEATH is not available"*.

A port we build has **zero** maintainers, which is strictly worse than the one
we were already treating as a risk, and it must be redone on every upstream
release.

There is also a deployment problem: `or-tools-wasm` needs
`Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` for WebAssembly
threads. The Caddy channel can send those; GitHub Pages cannot set response
headers at all, and `release.yml` publishes there.

### MiniZinc

A modelling language with a FlatZinc interface, so the model stays portable
across solvers - including to OR-Tools CP-SAT (`com.google.ortools.sat`) if a
trustworthy build ever appears. Published from the project's own GitHub
organisation with seven years of continuous releases. MPL-2.0, which is
file-level copyleft: fine to ship, worth knowing.

Its WebAssembly build is a **toolchain**, though: a model compiler plus gecode,
cbc, chuffed and highs. Only one of those is wanted, and stripping the rest
means building MiniZinc ourselves, which is the zero-maintainer trap again.

**Chuffed**, the one that matters here, is a *lazy clause generation* solver:
finite-domain propagation and a SAT engine run together, each propagator
explains its inferences as clauses, and the SAT side learns nogoods from those
explanations to prune the search. Written by Geoffrey Chu, Peter Stuckey,
Andreas Schutt and others at Data61 (CSIRO) and the University of Melbourne.
MIT licensed.

### Pumpkin

[Pumpkin](https://github.com/consol-lab/pumpkin) is the same technology rebuilt
in Rust by ConSol Lab at TU Delft. Lazy clause generation, with cumulative,
disjunctive, element, all-different, table, linear and boolean constraints, plus
optimisation. Apache-2.0 or MIT.

**It compiles to WebAssembly cleanly.** Checked rather than assumed:

| | |
|---|---|
| target | `wasm32-unknown-unknown`, stable rustc 1.98.1 |
| toolchain | plain `cargo build` - no Emscripten, no C toolchain, no patches |
| build time | 25 seconds from a cold registry |
| output | **768 KB wasm, 236 KB gzipped** |

The top-level `pumpkin-solver` crate does *not* build for wasm: it pulls in
`signal-hook`, `clap` and a `cc` build step. Those are the command-line
wrapper's concerns. Depending on `pumpkin-core`, `pumpkin-constraints`,
`pumpkin-propagators` and `pumpkin-conflict-resolvers` avoids all of them, and
`pumpkin-core` already carries `web-time` and a `wasm-bindgen-test`
dev-dependency, so the authors target browsers deliberately.

Modelled directly against it, Pumpkin returns a correct full staffing for the
instance in ADR 008 defect 3, which the current engine reports short:

```
  m1: e2            (commander covered)
  m2: e1, e3        (e3 covers driver and commander)
  m3: e4            (driver covered)
```

Size, reported only because "one solver" was the actual ask:

| | uncompressed | gzipped |
|---|---|---|
| MiniZinc (compiler + 4 solvers) | 19.1 MB | ~5.4 MB |
| Pumpkin (one solver, no compiler) | 768 KB | 236 KB |
| the app itself today | 875 KiB | 274 KB |

## Decision

**Pumpkin**, if a solver is adopted at all.

It is what was actually asked for: one solver, Rust, standard toolchain, and a
wasm build that was verified rather than hoped for.

The cost is real. It is version 0.5.0, its authors call it *"a research vehicle
for the lab"* with no API stability guarantee, the team is about three people,
and the project started in October 2024. The model would be written in Rust
against its API rather than in a modelling language, and the wasm bindings would
be ours to maintain.

That risk is smaller than it looks here, for three specific reasons:

1. Solver API churn fails at **compile time**, which is loud and safe, not
   silently wrong.
2. The version is pinned.
3. `src/lib/invariants.js` already validates every schedule independently, so a
   solver returning something invalid is caught before it reaches an agenda.

Note that there is **no browser solver with a large maintainer base**. That
option does not exist. The choice is between small teams, and MiniZinc's three
against Pumpkin's three is closer than the release histories suggest.

**Take MiniZinc instead** if owning the wasm bindings and a Rust model crate is
more ownership than the problem is worth. That is a defensible reading, and the
model-portability argument is genuinely good.

ADR 014's second half - preferring to keep scarce qualifications uncommitted -
is an objective term in whichever model is written, and is a further reason the
policy belongs in a solver rather than in another ranking comparator.

## Consequences

| module | lines | fate |
|---|---|---|
| `crew.js` | 78 | replaced - `selectCrew` and `separateRoles` are a matching problem stated in the model |
| `strategies.js` | 204 | replaced - ranking comparators become an objective function |
| `corrections.js` | 219 | mostly replaced - a solver re-solves instead of proposing local repairs |
| `rest.js` | 140 | split - the ranking ladder becomes constraints, the measurement stays |
| `planner.js` | 1148 | split - staffing phases go, normalization and the segment grid stay |
| `invariants.js` | 141 | **stays, and matters more** |

`invariants.js` is the piece to keep deliberately. A model with a subtly wrong
constraint fails silently and confidently, which is exactly when independent
validation earns its keep.

What no library can take is the domain: missions, pins, night windows, the
inheritance chain, the Hebrew RTL interface. That is the app, and it is where
the custom code should go.

This is the **last** step of the three. ADR 008's defects 1 and 2 and ADR 009
are worth doing on their own; a solver without ADR 009 fixes nothing that was
reported and gives the past more reasons to move.

## Evidence

npm registry for `minizinc`, `or-tools-wasm`, `munkres-js`, `logic-solver` and
`kiwi.js`; crates.io for `pumpkin-solver` and its component crates; all read
2026-09-15. Upstream's Emscripten position from or-tools-discuss, 5 May 2025.
MiniZinc's OR-Tools backend per the MiniZinc handbook's solver-backends chapter.
The Pumpkin WebAssembly build and the solved counterexample were produced
locally against `wasm32-unknown-unknown` with stable rustc 1.98.1, reproducible
from a four-dependency `Cargo.toml`.
