# ADR 008: Split the timeline, then a solver becomes worth having

- Status: Proposed. Supersedes this document's own first draft, which weighed
  the wrong constraints.
- Date: 2026-09-15

## Context

The question asked was whether [MiniZinc's JavaScript
API](https://docs.minizinc.dev/en/stable/javascript.html), or
[`or-tools-wasm`](https://www.npmjs.com/package/or-tools-wasm), would improve
the hand-written engine in `src/lib/planner.js`.

The first draft of this record answered no, on two grounds: a solver cannot
reproduce a schedule byte for byte, and its WebAssembly payload is twenty-one
times the application. Both were measured correctly and both were beside the
point, because neither is a constraint this project actually has. Stated
plainly so the next reader does not repeat it: **download size does not matter
here, and neither does getting the same future schedule twice.** What matters
was named on being asked directly.

### The constraints that are real

1. **The past is a record of what happened, not a schedule.** Manual changes to
   reflect reality are wanted. The algorithm rewriting history to get a better
   schedule is the defect.
2. **Manual pins are followed exactly.** Unchanged.
3. **The future may vary between runs.** One person edits this, on one device;
   nobody else opens the link and compares.
4. **It must work offline.** This was being met by putting the whole document
   in the URL, which conflates two separate needs - see below.

## The actual defect

`scripts/historyDriftCheck.mjs` applies each kind of edit through the real
`setDoc` path, three days into a seven-day rota, and re-reads the past:

```
  edit                                erased   invented   unreachable
  add an employee                         0          0             0
  raise a mission headcount               0         72             0
  lower a mission headcount              72          0             0
  add a third mission                     0          0             0
  switch strategy to balanced             0          0             0
  change shift length to 2h               0          0             0
  extend the plan end by 2 days           0          0             0
  move the plan start forward 1d          0          0            96
  limit an employee availability          0          0             0
```

Freezing works for the case it was built for: no edit ever swaps one guard for
another in the past. What it cannot cover is **headcount, which has no history
of its own.** A mission carries one `count` for all time, so raising it today
re-staffs every elapsed slot to the new number and writes in people who were
never there; lowering it deletes people who genuinely stood post. The freeze
records *who* held a slot, never *how many seats existed then*.

Moving the plan's start forward is the third case. That history is still in the
document but outside the period, so the engine ignores it and it is counted
once as `PIN_OUT_OF_PERIOD` instead of being shown.

None of this is a search-quality problem. **No solver fixes it, and a solver
that re-derives the past makes it worse.** The defect is that already-elapsed
time is handed to the scheduler at all.

## Decision

### 1. Split the timeline at *now*

Everything before *now* is a log: recorded fact, append-only, edited only by a
person correcting the record. Everything after is computed. The engine's window
starts at *now*, so no scheduler - hand-written or solver, seeded or not - can
reach backwards.

History still has to feed *in*, because fairness, stints and night rest are
measured against what people have already worked. It enters as read-only input,
the way pins do today, and never leaves as output. That single direction is the
whole fix: the past cannot drift if nothing ever recomputes it.

A logged assignment carries its own seat count, which is what closes the
headcount case. It records that two people stood this slot, not that this
mission has two seats.

### 2. Move the store local-first

"Works offline" and "lives in the URL" are separate needs that had been welded
together. Offline needs local persistence, which IndexedDB provides with no
size ceiling, no network and no backend. Sharing needs a URL, and a shared link
does not need the whole history - the WhatsApp and iCal exports already carry a
24-hour window rather than the entire rota.

This matters because the URL is the binding constraint on everything else. A
seven-day rota for seventeen guards encodes to 336 characters empty; once
elapsed shifts freeze into pins it reaches 2,757 after one day, 9,228 after
four, at which point sharing breaks. That ceiling is why history cannot be
kept, and keeping history is the whole request.

The cost is real and should be stated: **a link stops being the document.**
Copy-link becomes "share a snapshot of this window" rather than "here is my
entire plan, recomputed on your machine."

Use `dexie` rather than raw IndexedDB or a hand-rolled wrapper: 189 releases
since 2014, two maintainers, last published five days before this record, and
about 8.3 million downloads a month. `idb` is thinner and more widely
installed, but it is a single-maintainer wrapper and the schema/migration
handling is the part worth not writing.

`@automerge/automerge` is the one library surveyed here with a real team - six
maintainers, Ink & Switch behind it - and its core competency is a document
with an append-only change history, which is close to what "the past is a log"
is asking for. It is not the recommendation, because it is built for
multi-device sync and merge, and the answer here is one editor on one device.
Worth revisiting only if that changes.

### 3. Only then, the solver

With the past out of reach and a single editor on a single device, the two
objections in this record's first draft evaporate. A varying future schedule
costs nothing when nobody is diffing two renders of the same link, and payload
size is not a constraint that was ever in play.

**Take MiniZinc, not `or-tools-wasm`.** An earlier revision of this record
recommended the opposite, on the strength of CP-SAT being the better-known
solver for this problem shape. The registry says the binding is the risk, not
the algorithm:

| package | maintainers | releases | first | latest |
|---|---|---|---|---|
| `minizinc` | 3 | 409 | 2019-06-04 | 2026-09-14 |
| `or-tools-wasm` | 1 | 6 | 2026-05-13 | 2026-06-08 |

`minizinc` is published from `github.com/MiniZinc/minizinc-js`, the project's
own organisation, and has shipped continuously for seven years. `or-tools-wasm`
is one person's WebAssembly port at version 0.9.1, four months old, with no
release in the last three. Google maintains OR-Tools; nobody with a team
maintains *that binding*, and the binding is what would be depended on.

MiniZinc's WebAssembly build carries gecode, cbc, chuffed and highs. Chuffed is
a lazy-clause-generation constraint solver and is strong on exactly this shape
of rostering, so little is given up on capability.

Two honest caveats. Three maintainers is not many, and there is **no browser
solver with a large maintainer base** - that option does not exist, so the
choice is between small teams. And MiniZinc is MPL-2.0, which is file-level
copyleft: fine for shipping in a bundle, worth knowing rather than discovering.

### What Chuffed is, and the one-solver objection

Chuffed is a **lazy clause generation** constraint solver: a hybrid that runs
finite-domain propagation and a SAT engine together, where each propagator
explains its inferences as clauses so the SAT side can learn nogoods from them
and prune the search. It was written by Geoffrey Chu, Peter Stuckey, Andreas
Schutt and others at Data61 (CSIRO) and the University of Melbourne, is MIT
licensed, and is the backend MiniZinc reaches for on scheduling problems.

The objection to MiniZinc is fair, though: its WebAssembly build is a
*toolchain*, a model compiler plus gecode, cbc, chuffed and highs. Only one of
those is wanted, and stripping the others means building MiniZinc ourselves,
which is the zero-maintainer trap again.

[Pumpkin](https://github.com/consol-lab/pumpkin) is the same technology, rebuilt
in Rust by ConSol Lab at TU Delft - lazy clause generation, cumulative,
disjunctive, element, all-different, table, linear and boolean constraints, with
optimisation. Apache-2.0 or MIT.

**It compiles to WebAssembly cleanly**, which was checked rather than assumed:

| | |
|---|---|
| target | `wasm32-unknown-unknown`, stable rustc 1.98.1 |
| toolchain | `cargo build`, no Emscripten, no C toolchain, no patches |
| build time | 25 seconds from a cold registry |
| output | **768 KB wasm, 236 KB gzipped** |

The top-level `pumpkin-solver` crate does *not* build for wasm: it pulls in
`signal-hook`, `clap` and a `cc` build step. Those are the command-line
wrapper's concerns. Depending on `pumpkin-core`, `pumpkin-constraints`,
`pumpkin-propagators` and `pumpkin-conflict-resolvers` instead avoids all of
them, and `pumpkin-core` already carries `web-time` and a `wasm-bindgen-test`
dev-dependency, so the authors clearly build for the browser deliberately.

Modelled directly against it, the solver returns a correct full staffing for
the instance `scripts/completenessSearch.mjs` finds the engine reporting short:

```
  m1: e2            (commander covered)
  m2: e1, e3        (e3 covers driver and commander)
  m3: e4            (driver covered)
```

So the size comparison, with the caveat that size was explicitly declared
irrelevant and is reported here only because "one solver" was the actual ask:

| | uncompressed | gzipped |
|---|---|---|
| MiniZinc (compiler + 4 solvers) | 19.1 MB | ~5.4 MB |
| Pumpkin (one solver, no compiler) | 768 KB | 236 KB |
| the app itself today | 875 KiB | 274 KB |

### Choosing between them

These two preferences genuinely conflict and the conflict should not be
papered over.

**MiniZinc is the conservative choice.** Seven years, 409 releases, the
project's own organisation, and the model is a declarative `.mzn` file that
stays portable across solvers - including to OR-Tools CP-SAT later.

**Pumpkin is the choice that matches what was asked for.** One solver, Rust,
768 KB, standard toolchain. The cost is that it is version 0.5.0 and its own
authors call it "a research vehicle for the lab" with no API stability
guarantee, the team is roughly three people, and the project started in October
2024. The model would be written in Rust against its API rather than in a
modelling language, and the wasm bindings would be ours to keep working.

On balance, **Pumpkin**, because the 0.x risk is smaller than it looks here.
Solver API churn fails at compile time, which is loud and safe, not silently
wrong. The version is pinned. And `invariants.js` already validates every
schedule the engine produces independently, so a solver that returns something
invalid is caught before it reaches anybody's agenda - which is precisely the
argument for keeping that module and why it matters more under a solver, not
less.

Take MiniZinc instead if the wasm bindings and a Rust model crate feel like
more ownership than the problem is worth. That is a defensible reading and the
same timeline split has to happen either way.

### Why not compile OR-Tools to WebAssembly ourselves

Asked directly, and worth recording because it looks like the obvious move.

**Two ports already exist.** [`Axelwickm/or-tools-wasm`](https://github.com/Axelwickm/or-tools-wasm)
vendors upstream, patches it and builds with Emscripten; it exposes CP-SAT,
routing, MPSolver, MathOpt, PDLP and network flow, and is the one published to
npm. [`kjartanm/wasm-or-tools`](https://github.com/kjartanm/wasm-or-tools) is a
direct fork of google/or-tools with 9 stars and no visible recent activity.
Neither has a team.

**Upstream does not support this.** From the OR-Tools maintainers on
or-tools-discuss, 5 May 2025: *"emscripten is currently a low priority with
zero human ressource allocated to it"*, *"currently disabling most third party
solvers so only cp-sat and glop are available"*, and *"Had to disable all tests
since EXPECT_DEATH is not available"*. There is an experimental workflow and
Docker config, but a build with its test suite switched off is not a foundation
for rostering real guard duty.

**A port we build has zero maintainers**, which is strictly worse than the one
maintainer we were already treating as a risk. It is the most extreme form of
the hand-written code this project is trying to move away from: an Emscripten
build of a C++ tree with Abseil, Protobuf, SCIP and CBC underneath it, redone
on every upstream release, owned by nobody.

**And this deployment cannot use the main benefit anyway.** `or-tools-wasm`
needs `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` for
WebAssembly threads. The self-hosted Caddy channel can send those; GitHub Pages
cannot set response headers at all, and `release.yml` publishes there. Whether
it degrades to single-threaded or fails outright on that channel is worth
testing before committing to it either way.

### The model is the investment, not the solver

This is what makes MiniZinc the low-regret choice rather than merely the
better-maintained one. MiniZinc is a modelling language with a FlatZinc
interface, and **OR-Tools CP-SAT is one of its supported backends**
(`com.google.ortools.sat`). So the rota model is written once and is not tied
to the solver underneath it: run Chuffed in the browser today, and if a
trustworthy OR-Tools WebAssembly build appears, point the same model at CP-SAT
without rewriting it.

Choosing `or-tools-wasm` now is choosing a solver. Choosing MiniZinc is
choosing a language that already speaks to that solver, among others. The
expensive, irreversible part of this work is expressing the rota - coverage,
exclusions, night rest, fairness - correctly. That part should not be spent on
a binding one person published four months ago.

Seed it and pin the version. Not for reproducibility's own sake, but because a
seeded solver keeps the option of storing only deviations rather than the whole
past: on a seven-day rota with three hand-edits that is 3 pins and 404
characters against 960 pins and 9,228. Local-first storage makes that a
convenience rather than a necessity, which is the right order - the seed should
be an optimisation, never the thing history depends on.

### What the libraries would actually replace

The point of this is to shrink hand-written algorithm code down to domain
modelling and glue. Roughly, by module:

| module | lines | fate |
|---|---|---|
| `crew.js` | 78 | **replaced** - `selectCrew` and `separateRoles` are a matching problem stated in the model |
| `strategies.js` | 204 | **replaced** - ranking comparators become an objective function |
| `corrections.js` | 219 | **mostly replaced** - a solver re-solves instead of proposing local repairs |
| `rest.js` | 140 | **split** - the ranking ladder becomes constraints; the measurement stays |
| `planner.js` | 1148 | **split** - the staffing phases go; normalization, the segment grid and pin semantics stay |
| `invariants.js` | 141 | **stays, and matters more** |

`invariants.js` is the piece to keep deliberately. Independent validation of a
schedule is *more* valuable against a solver than against a greedy walk,
because a model with a subtly wrong constraint fails silently and
confidently. It is the one place hand-written code earns its keep, and it is
already written.

What no library can take is the domain: missions, pins, night windows, the
inheritance chain, the Hebrew RTL interface. That is the app, and it should be
what the custom code is spent on.

### What stays true from the first draft

The engine is provably incomplete: it reports shortages on rosters that can be
staffed in full, at up to 0.94% of feasible small instances with exclusions,
though never on realistic rota shapes. `scripts/completenessSearch.mjs`
measures it. A solver closes that class by construction.

That earlier revision also offered the alternative of lifting `choose` from
per-mission to per-segment "with no new dependency", which means hand-writing a
bipartite matcher. That is the wrong trade here. Hand-rolled optimisation code
is precisely what has gone wrong in this engine before - the ring that counted
merged runs and stranded three guards for 88 hours, the scarcity ordering that
was meant to close this same gap and did not. The matching libraries that might
have stood in are dead: `munkres-js` last published in 2017, `logic-solver` in
2016, `kiwi.js` in 2021.

So the solver is not merely one way to close the gap; it is the way that
*removes* custom algorithm code rather than adding more. Stating the problem
declaratively and handing it to a maintained solver is the smaller long-term
surface, even though it is the larger dependency.

## Consequences

The past becomes durable and editable, which is what was asked for. The
document grows without bound, which local-first storage can absorb and the URL
never could. Sharing changes shape and the ADR 006 wire format stops being the
only persistence, so its append-only discipline now governs shared snapshots
rather than the user's only copy of their data.

Losing "the link is the document" loses a genuinely elegant property, and it is
the real price here. It buys a rota that remembers what actually happened.

## Alternatives rejected

- **A solver without the timeline split.** Fixes nothing that was asked for and
  makes the headcount defect worse by giving the past more reasons to move.
- **`or-tools-wasm`.** Better-known solver, unmaintainable binding: one person,
  six releases, nothing shipped in three months. See the table above.
- **Compiling OR-Tools to WebAssembly ourselves.** Zero maintainers, on top of
  an upstream Emscripten build whose own tests are disabled, redone every
  release. See the section above.
- **A hand-written per-segment matcher.** Smaller diff, wrong direction. It adds
  bespoke optimisation code to an engine whose bespoke optimisation code is
  where the defects came from.
- **Versioning `count` in the document.** Fixes one column of the drift table.
  Every other field that feeds a past slot would need the same treatment, one
  at a time, forever.
- **Making the past read-only.** Contradicts the request: correcting the record
  to match reality is the point.
- **A backend.** Not needed. Local persistence is offline persistence; a
  backend would only buy cross-device sync, which is not wanted.

## Evidence

`scripts/historyDriftCheck.mjs` for the drift table,
`scripts/completenessSearch.mjs` for the completeness measurements. URL lengths
from `encodePlan` over a seventeen-guard, ten-seat, seven-day rota. Package
facts, maintainer counts and release histories from the npm registry for
`minizinc`, `or-tools-wasm`, `dexie`, `@automerge/automerge`, `munkres-js`,
`logic-solver`, `kiwi.js`, and crates.io for `pumpkin-solver` and its component
crates, read on 2026-09-15. The Pumpkin WebAssembly build and the solved
counterexample were produced locally against `wasm32-unknown-unknown` with
stable rustc 1.98.1 and are reproducible from a four-dependency `Cargo.toml`. Upstream's Emscripten
position quoted from or-tools-discuss, 5 May 2025. MiniZinc's OR-Tools backend
per the MiniZinc handbook's solver-backends chapter.
