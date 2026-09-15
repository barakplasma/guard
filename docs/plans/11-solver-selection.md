# ADR 011: MiniZinc with Chuffed, as the one production scheduling engine

- Status: **Proposed.** Awaiting a decision from the project owner. Depends on
  ADR 009. Addresses ADR 008's defect 3. Sized by ADR 012, re-rated by ADR 013.
- Date: 2026-09-15

## Provenance

The recommendation below came from an **automated review on PR #39** (Codex),
not from the project owner. It is recorded because its argument is good and its
factual corrections were independently verified against primary sources - the
npm registry, `src/lib/invariants.js`, and running the fixtures against current
`main`. It is **not** an accepted decision, and this record should not be read
as one until the owner says so.

An earlier revision of this record recommended Pumpkin. That recommendation is
superseded *as a recommendation*; both are set out below so the trade can be
judged rather than inherited.

## Recommendation

**MiniZinc's JavaScript API with Chuffed, selected explicitly, as the single
production scheduling engine.** Not Pumpkin, and not a production solver plus a
separate oracle or fallback.

### Priority order

Everything here is subordinate to this ordering:

1. **Correctness.** Pins, availability, headcount, qualifications and history
   are inviolable.
2. **Reliability.** A maintained browser integration, cancellation, offline
   behaviour, and a model that can be audited against the requirements.
3. **Fairness.** Rest and workload optimisation, *after* feasibility is proven.

Payload size does not appear on that list, and neither does reproducing a
schedule byte for byte.

### Why MiniZinc rather than Pumpkin

The deciding question is **ownership and failure surface**, not the solving
technology - both are lazy clause generation and either would solve these
instances.

With MiniZinc, Guard owns the scheduling model and its domain validation, while
an upstream-maintained package owns model compilation, worker lifecycle and
solver integration. With Pumpkin, Guard would own the Rust model, the
`wasm-bindgen` bridge, JavaScript packaging, worker lifecycle, *and*
compatibility across several pre-1.0 component crates.

The evidence gathered for Pumpkin is real but narrower than it was made to
sound: its component crates compile to `wasm32-unknown-unknown` and solve a
sample model. Its browser support is deliberate, and upstream tests
`pumpkin-core` with `wasm-pack`. What it does not have is an upstream
JS/browser package comparable to MiniZinc's, so the integration would be ours.

A declarative `.mzn` model is also easier to review against the requirements
than model-construction code in Rust, which matters directly under priority 1.

### The tension this leaves unresolved

Two stated preferences pull against each other here, and the recommendation
resolves one at the other's expense. That resolution is the owner's to confirm.

- *"I prefer libraries I can trust... strong libraries with many maintainers."*
  Points at MiniZinc: an official browser adapter, seven years of releases, and
  an integration surface that is upstream's rather than ours.
- *"I only want one solver, don't need more."* Points at Pumpkin. MiniZinc's
  WebAssembly build is a model compiler plus gecode, cbc, chuffed and highs.
  Selecting Chuffed explicitly and treating the bundle as one engine is a fair
  reading of the intent, but it is not literally one solver.

On the evidence the ownership argument is the stronger of the two: an
integration Guard does not maintain is worth more than three solvers it does not
invoke, and a defect in the `wasm-bindgen` bridge would be ours to diagnose on a
phone under time pressure. But the preference was stated plainly enough that the
call should be explicit rather than inferred.

## Corrections to earlier claims in this branch

These were wrong or overstated and are fixed here so they are not carried
forward.

**The release count.** An earlier table read "409 releases since 2019". The npm
registry has 409 *versions*, of which **27 are stable** `x.y.z` releases and 382
are edge or prerelease builds. The seven-year history is real; the number was
not what it implied.

**"648 assignments is small, so no limits are needed."** Not established. The
assignment count is not the model size: variables, domain sizes, reified
constraints and the fairness objectives all drive it, and none of that exists
until the model is written. **Time and memory limits must be measured, not
assumed away**, and cancellation has to work.

**`invariants.js` as a safety net.** It was used to argue that a solver
returning something invalid would be caught. It checks well-formedness only -
`DOUBLE_BOOKED`, `OVERSTAFFED`, `OUTSIDE_MISSION_WINDOW`, `OUTSIDE_AVAILABILITY`,
`FALSE_QUALIFICATION`, `EXCLUDED_QUALIFICATION`, `REMOTE_NOT_WHOLE`,
`DAILY_NOT_WHOLE`, `ROW_EXCEEDS_SLOT`, `TIMELINE_GAP`, `TIMELINE_MISMATCH`. It
does **not** verify required-tag fulfilment, warning accuracy, complete pin
retention, rest-score correctness, fairness optimality, or a false UNSAT, and
**an empty schedule passes much of it**. It is a useful upper-bound check and
not an independent correctness proof. Closing that gap is part of this work.

**Node tests would prove the browser path.** They would not. The `minizinc`
package's Node entry point spawns a native MiniZinc binary; the browser path is
a different artifact - a WebAssembly worker plus `.wasm` and `.data` assets that
have to be served and cached by the service worker. Only a real browser bundle
test exercises it.

## The model

**Bounded relative time units inside the 72-hour horizon**, not epoch
milliseconds. Epoch values blow up variable domains for no benefit when the
window is bounded (ADR 012).

**Optimise lexicographically in the same solver**, in this order:

1. satisfy pins and hard availability and exclusion rules;
2. fill all seats and required qualifications;
3. preserve committed history;
4. minimise configured rest shortfalls;
5. minimise workload imbalance;
6. improve uninterrupted rest and mission rotation;
7. prefer distinct people for qualifications where feasible.

**Avoid a single weighted sum.** A weighted objective can silently trade
correctness for fairness, which inverts the priority order above.

## Acceptance criteria

The MiniZinc prototype must pass, before it replaces anything:

- the existing golden fixtures;
- the original short-shift link;
- the off-grid callout fixture (`scripts/midScheduleCallout.mjs`);
- manual-assignment and history cases end to end, through `setDoc`;
- exhaustive checks against a brute-force oracle on small random instances;
- the **real production browser bundle, offline**.

Plus representative Pixel-class measurements for first load, repeated solve
time, cancellation, peak memory and worker cleanup. **Configure one worker
initially**; the default worker-pool behaviour needs explicit memory testing
before it is trusted on a phone.

## What the engine still gets wrong today

ADR 008's defect 3 is **partly fixed on main**. PR #40 added `offGridPriority`,
which lifts a constrained demand ahead of an earlier, less-constrained one it
overlaps, and that fixes **every offset** in `scripts/midScheduleCallout.mjs` -
the reported callout now works at 20, 30, 45 and 90 minutes past the hour.

It fixed the shape, not the class. `node scripts/offGridFuzz.mjs` runs random
off-grid instances against the current engine and brute-forces each reported
shortage:

```
shortage instants checked : 19806
provably false shortages  : 560  (2.8%)
```

One surviving example needs no off-grid mission at all:

```
  employees: e1[driver] e2[commander] e3[driver,medic] e4[commander]
             e5[commander,medic] e6[commander]
  m1: count=1 requires=driverx1        whole plan
  m2: count=2 requires=driverx1+medicx1  +325min for 1h
  m3: count=3 requires=driverx1+medicx1  whole plan
  engine: missing-required-tag
```

This is the pattern ADR 005 and now #40 have both hit: another ordering key
closes the instance in front of it and leaves the class open. That is the
argument for assigning globally rather than for a third heuristic.

## Consequences

Guard owns the model and its domain validation. Upstream owns compilation,
workers and the solver. The model is reviewable as a declarative artifact, which
serves priority 1 directly.

MiniZinc is MPL-2.0, file-level copyleft - fine to ship, worth knowing. Its
WebAssembly build carries a compiler plus gecode, cbc, chuffed and highs;
**Chuffed is selected explicitly** rather than left to a default, and the other
backends riding along is accepted cost, not a reason to build a custom
distribution.

`invariants.js` has to grow the checks it currently lacks, and that work is now
load-bearing rather than optional: a model with a subtly wrong constraint fails
silently and confidently.

## Alternatives rejected

- **Pumpkin.** Promising, and not established as the safer application
  dependency. Guard would own the model *and* most of the browser integration,
  across several pre-1.0 crates.
- **`or-tools-wasm`.** One maintainer, six releases, nothing shipped in three
  months. It also needs COOP/COEP headers for threads, which GitHub Pages cannot
  set and `release.yml` publishes there.
- **Compiling OR-Tools to WebAssembly ourselves.** Upstream, 5 May 2025:
  *"emscripten is currently a low priority with zero human ressource allocated
  to it"* and *"Had to disable all tests since EXPECT_DEATH is not available"*.
  A port we build has zero maintainers.
- **A production solver plus a separate oracle or fallback.** Two engines is two
  sets of behaviour to keep agreeing. One engine, with the brute-force oracle
  confined to tests on small instances.
- **A hand-written per-segment matcher.** Would not fix the reported callout
  anyway: the trade crosses missions *and* segment boundaries.

## Evidence

`scripts/midScheduleCallout.mjs` (the reported case, now a regression fixture),
`scripts/offGridFuzz.mjs` (2.8% of shortage instants still provably false on
main), `scripts/completenessSearch.mjs`. Release counts from the npm registry,
read 2026-09-15: `minizinc` 409 versions, 27 stable. Invariant rules read from
`src/lib/invariants.js`. #40's ordering change in `planner.js` phase 3.
