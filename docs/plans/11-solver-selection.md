# ADR 011: MiniZinc as the one production scheduling engine

- Status: **Accepted, provisionally** - the owner's words were "go with MiniZinc
  for now", so this is a working choice rather than a closed one. Depends on
  ADR 009. Addresses ADR 008's defect 3. Sized by ADR 012, re-rated by ADR 013.
- Date: 2026-09-15, backend amended 2026-09-16

## Amendment: the backend is HiGHS, not Chuffed

This record originally said "MiniZinc **with Chuffed**, selected explicitly".
The prototype measured that and it is wrong. Chuffed proves this model's optimum
up to roughly a four-hour horizon and then stops proving anything at all, while
HiGHS - **in the same WebAssembly bundle** - proves a fully covered, churn-free,
perfectly balanced 72-hour schedule in under eight seconds. The measurement is
below under "How far the model goes".

Nothing else in the decision moves. MiniZinc is still the choice, for the
ownership reasons set out below; what changed is which backend inside it gets
selected, and the argument for selecting one *explicitly* rather than taking a
default is unaffected and now better evidenced.

The original text is left in place rather than rewritten, because the reasoning
that picked Chuffed is worth reading next to the measurement that overturned it.
It picked a technology - lazy clause generation - on a comparison with Pumpkin,
and never asked which backend suited *this* model. That question could only be
answered by writing the model.

## Provenance

The argument below came from an **automated review on PR #39** (Codex), not from
the project owner. Its factual corrections were independently verified against
primary sources before being applied - the npm registry, `src/lib/invariants.js`
read directly, and the fixtures re-run against current `main`.

The owner has since accepted it, **"for now"**. That qualifier is kept in the
status rather than tidied away: the tension below is real, and this is the
choice that lets work start, not a proof that the other is wrong.

An earlier revision of this record recommended Pumpkin. Both are set out below
so the trade can be judged rather than inherited.

## Decision

**MiniZinc's JavaScript API, with one backend selected explicitly, as the single
production scheduling engine.** Not Pumpkin, and not a production solver plus a
separate oracle or fallback.

*(The backend named here was Chuffed. It is HiGHS - see the amendment above.)*

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

### The tension this resolves, and what would reopen it

Two stated preferences pull against each other here, and this decision resolves
one at the other's expense.

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
phone under time pressure.

Given "for now", the things that would justify revisiting are worth naming so
the decision can be reviewed on evidence rather than on fatigue: MiniZinc
failing the Pixel-class acceptance criteria below, particularly first load and
peak memory with one worker; the wasm assets proving awkward to cache in the
service worker; or Pumpkin publishing an upstream browser package, which removes
the entire ownership argument at a stroke. The model is the expensive artifact
either way, and a lexicographic model of this problem is portable in substance
even where it is not portable in syntax.

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
returning something invalid would be caught. At the time it checked
well-formedness only - `DOUBLE_BOOKED`, `OVERSTAFFED`, `OUTSIDE_MISSION_WINDOW`,
`OUTSIDE_AVAILABILITY`, `FALSE_QUALIFICATION`, `EXCLUDED_QUALIFICATION`,
`REMOTE_NOT_WHOLE`, `DAILY_NOT_WHOLE`, `ROW_EXCEEDS_SLOT`, `TIMELINE_GAP`,
`TIMELINE_MISMATCH` - so it verified no required-tag fulfilment, no warning
accuracy, no pin retention and no false UNSAT, and **an empty schedule passed
much of it**.

**Two of those are now closed**, and they are the two that matter most against a
solver:

- `UNREPORTED_SHORTFALL` - a mission under its headcount at any instant, in time
  not yet elapsed, must be named by an `understaffed` warning covering that
  stretch. Short is legal; silent is not. This is the check an empty schedule
  cannot pass, and it is what would catch a model that returns fewer
  assignments than it claims.
- `PIN_DROPPED` - every pin the engine *accepted* must appear in the output.
  Anything `normalizePins` rejected is already gone with a warning naming it, so
  whatever survives into the input is an assignment a person made and the
  schedule promised to keep. Dropping one silently is the worst failure this
  module can catch, because the URL still shows the assignment and the agenda
  does not.

Both check coverage by **union** rather than containment, since the engine
reports shortages per grid segment and emits a local pin as one row per segment.
Getting that wrong was the first two attempts.

**Still open:** rest-score correctness, fairness optimality, and false UNSAT.
None of those is an invariant - each needs an oracle to compare against, which
is the brute-force work in `scripts/completenessSearch.mjs` rather than
something `checkSchedule` can decide from one result.

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

The prototype implements 1, 2 and 5, plus the crew-churn term this list did not
have (see below). Levels 3, 4, 6 and 7 are unwritten.

**Avoid a single weighted sum.** A weighted objective can silently trade
correctness for fairness, which inverts the priority order above.

## The prototype, and what it has actually shown

`prototype/minizinc/` holds the model, a lexicographic driver, a brute-force
oracle and two comparison scripts. It is not imported by `src/` and nothing in
the app calls it; it exists so the criteria below can be measured rather than
argued about. Its own README carries the how-to-run detail.

**The model agrees with an exhaustive search.** 420 random instances (seeds
1-420), every one matching the oracle on all four objectives, on the assignment
being feasible, and - separately - on the model's *reported* objectives matching
what its own assignment scores. That last check is the one worth having: a model
can compute something other than what it claims, and a comparison of totals
alone would never notice.

Each round is also required to have **proved** optimality rather than merely
reported a bound. The ladder passes each level's optimum down as a cap, so a
round that stopped early would be read as an optimum and quietly poison every
level below it.

**The model finds what the engine misses.** Run over `scripts/offGridFuzz.mjs`'s
own generator and seed, so both are looking at the same instances:

```
shortage instants solved  : 1292
model found a full crew   : 36  (2.8%)
model agreed it was short : 1256
plans with a shortage     : 305
...of which falsely short : 36  (11.8%)
```

2.8% is the same figure `offGridFuzz.mjs` reports from a bespoke recursive
search written for the purpose. Two independent searches landing on the same
number is worth considerably more than either alone: the model closes exactly
the class #40 left open, and agrees with the engine on the other 97%.

The second denominator is the one a person feels. Counted per plan rather than
per warning, **11.8% of the plans that said "not enough people" had enough
people**.

### One objective the written order did not have

The list above goes coverage, history, rest, imbalance, rotation. Building it
surfaced a term missing from it: **crew changing hands inside one grid slot**.

A segment is not a slot. An availability edge, a night edge or a pin bound tears
a slot in two, and both halves still name the one slot they are inside - that
stamp is what `mergeRows` rejoins on and what `ringKeys` counts a turn by. Left
unsaid, the model swaps people between the halves of a single hour to shave the
imbalance, and is right to: nothing told it that an hour is the unit somebody
actually stands.

It is **soft, not hard**, and that is the interesting part. A pin covering half
a slot has to be able to hand over at its own edge - the engine splits segments
on accepted pin bounds precisely so it can. A hard equality would make such a
pin infeasible, or quietly extend it over the rest of the slot. So it sits at
level 3, above imbalance and below coverage.

This is the kind of thing writing the model is for. The objective was implicit
in the engine's control flow - a local segment is filled once and not
revisited - and only became a thing that had to be *stated* when the control
flow went away.

### What the prototype does not model

Scoped deliberately to ADR 008's defect 3 - who stands where on a given segment
grid, with pins, availability, exclusions and headcount as hard rules. Night
rest, daily occurrences as distinct holds, remote wholeness, and the per-mission
grids themselves are all absent. The grid arrives already computed, because
building it is domain work the engine does well and a solver has no opinion on;
that split is expected to survive into anything shipped.

`vsEngine.mjs` correspondingly solves one instant at a time, which is exact only
because that fuzz has no rest rules and no availability windows. It is not a
statement about a 72-hour horizon.

### How far the model goes, and on which backend

The fixture is `scripts/midScheduleCallout.mjs`'s roster - eight guards of whom
two drive, a gate wanting three, a patrol wanting two, and a callout needing
both drivers inserted twenty minutes past the hour - stretched to each horizon.
`proved` is one character per lexicographic level, and an unproven level is not
a result: the ladder passes each optimum down as a cap, so an unproven one
poisons every level below it.

```
solver: highs                                  solver: chuffed
horizon segments elapsed proved imbalance      horizon segments elapsed proved imbalance
     2h        3   712ms   yyyy         2           2h        3   356ms   yyyy         2
     4h        6  2040ms   yyyy         1           4h        6  7213ms   yyyy         1
     6h        8  1491ms   yyyy         1           6h        8 20550ms   yyyn         1
    12h       14  2518ms   yyyy         1          12h       14 22241ms   yyyn         2
    24h       26  2923ms   yyyy         0          24h       26 35867ms   yyyn         7
    48h       50  3825ms   yyyy         0
    72h       74  7819ms   yyyy         0
```

Every row is `unmet=0 unfilled=0 churn=0`; imbalance is the column that
separates them, and with eight guards against five seats a 0 or 1 is reachable
at every length.

**CBC and CP-SAT behave like HiGHS** - 72 hours in 6.5s and 7.8s, both proved,
both imbalance 0. So this is not a HiGHS trick, and not a tuning problem either.
The fairness level is a bound on a sum over every assignment, which a linear
relaxation hands over for free and lazy clause generation has to search for.

It costs nothing to act on. The `minizinc` package's own build script fetches
`gecode cbc chuffed highs` for `wasm32-emscripten`, read from the published
tarball, so HiGHS is already inside the browser bundle this record committed to.
CP-SAT is not, and is not needed.

### Three things the model needed that no amount of reading would have found

Worth recording because each cost real time and none is visible in the finished
model:

- **Every objective needs its floor declared.** `unfilledSeats` is a sum of
  `want - sum(x)` terms, each non-negative only because of the headcount
  constraint - which MiniZinc does not fold into the expression's inferred
  bounds. Left as `var int`, the solver found the optimum in milliseconds and
  then spent minutes failing to prove nothing beat it, because as far as its
  bounds went a negative total was still on the table.
- **Identical guards need their symmetry broken.** Six interchangeable guards
  are 720 identical schedules, all of which get walked to prove nothing better
  exists. The driver derives the classes from the instance rather than asking
  the caller for them, since a caller that got it wrong would prune real
  solutions.
- **The search order has to be handed over (`-f`).** Chuffed's default fixed
  order returned `UNKNOWN` - no solution at all - in thirty seconds where free
  search proved the optimum in under one.

None of these is a MiniZinc complaint. They are the ordinary craft of the tool,
and they are the part that does not transfer to a hand-written alternative,
which is worth knowing before choosing one.

### The browser path

Served to a real Chromium over plain HTTP with **no COOP/COEP headers**, which
is the GitHub Pages condition.

```
crossOriginIsolated: false
solvers in the wasm: org.minizinc.chuffed, org.minizinc.mip.coin-bc,
                     org.minizinc.gecode_presolver, org.minizinc.mip.highs
init (fetch+compile): 245ms
24h: four levels, all OPTIMAL, 6.4s wall
72h: four levels, all OPTIMAL, 13.7s wall
```

Both land on `unmet=0 unfilled=0 churn=0 imbalance=0`, the same answers the
native run gives, at roughly twice the time.

- **No `crossOriginIsolated` needed.** This was the single hosting risk in this
  record - `release.yml` publishes to GitHub Pages, which cannot set COOP/COEP,
  and that is what ruled out `or-tools-wasm` below. It does not rule out
  MiniZinc. Closed.
- **HiGHS is genuinely in the WebAssembly build**, not only in its build script,
  so the amended backend ships as-is.
- **The solve never touches the main thread.** Throttling the main thread to a
  fifth of its speed - 6057 to 1041 spins per millisecond, measured inside the
  page - left solve times unchanged. Fifteen seconds of solving does not freeze
  the UI.

Assets are 19MB raw, **5.2MB gzipped**: what a service worker has to precache
and a phone fetches once.

**Offline works.** The page is loaded once behind a precaching service worker,
the network is cut at the browser *and* the server stopped - both, because a
cache miss served by a socket that happened to still be open would look exactly
like success - and the whole ladder runs again from cache in 5.4s, all levels
proved. The app's no-network rule survives the solver.

**Peak memory is the finding that should worry somebody.** The JS heap the page
reports is 2MB and means nothing: WebAssembly memory is not in it. Resident
memory over the browser process tree, sampled every 200ms:

```
horizon   idle     peak    delta
    6h   830MB   1114MB   +284MB
   24h   831MB   1085MB   +254MB
   72h   833MB   1177MB   +344MB
   72h   831MB   1236MB   +405MB   (second run)
baseline  821MB    821MB     +0MB   (page loaded, MiniZinc never initialised)
```

It does **not** grow with the horizon - 6 hours and 72 hours cost the same
within noise - so this is the price of having MiniZinc loaded, not of the plan
being long, and rolling the window forward does not make it worse. But it is
250-400MB, and the baseline row says essentially all of it is MiniZinc rather
than Chromium. A background tab holding a third of a gigabyte is a tab Android
may reclaim. This record's "configure one worker initially" now has a number
behind it, and that number is the strongest argument yet for keeping the
hand-written engine as the thing that renders a shared link.

**One criterion is still untouched: a Pixel-class figure.** The main-thread
finding above is why - CDP CPU throttling reaches the main thread and not the
worker, so a desktop core did all the solving at every throttle setting.
Fourteen seconds here is not fourteen seconds on a phone. Given the memory
number, that measurement should happen on real hardware before anything ships.

### What the timings do not say

231ms per instant, which is three solver *processes* with startup dominating at
this size. It is a per-measurement cost, not an estimate of what the app would
pay: a real horizon is one instance, not 1292, and the browser path is a
WebAssembly worker rather than a spawned binary. The number that matters is
still unmeasured, and getting it needs the adapter this prototype does not have.

## Acceptance criteria

The MiniZinc prototype must pass, before it replaces anything:

- the existing golden fixtures;
- the original short-shift link;
- the off-grid callout fixture (`scripts/midScheduleCallout.mjs`);
- manual-assignment and history cases end to end, through `setDoc`;
- exhaustive checks against a brute-force oracle on small random instances -
  **met by the prototype** (`prototype/minizinc/check.mjs`), for the scope the
  prototype models;
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
main), `scripts/completenessSearch.mjs`, and `prototype/minizinc/` for the model
and the two measurements above. MiniZinc 2.9.3 with Chuffed 0.13.2. Release counts from the npm registry,
read 2026-09-15: `minizinc` 409 versions, 27 stable. Invariant rules read from
`src/lib/invariants.js`. #40's ordering change in `planner.js` phase 3.
