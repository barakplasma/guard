# ADR 011 prototype: the rota as a constraint model

Nothing here is shipped or imported by `src/`. It exists so ADR 011's
acceptance criteria can be *measured* rather than argued about, and so the cost
of the model is visible before anything replaces the hand-written engine.

| file | what it is |
| --- | --- |
| `rota.mzn` | the model: one segment grid, hard rules, four named objectives |
| `solve.mjs` | the lexicographic driver - four solves of one model, each capped by the last |
| `fromPlan.mjs` | plan input -> instance, and an answer back to shift rows |
| `oracle.mjs` | brute force over every feasible assignment, plus the random instances |
| `check.mjs` | model vs. oracle on small random instances |
| `vsEngine.mjs` | model vs. the engine, at the instants it calls short — a *weaker* question |
| `vsPlan.mjs` | model vs. the engine over a whole horizon — the honest comparison |
| `scaling.mjs` | how far it goes, and on which backend |
| `browser.mjs` + `browser/` | the real WebAssembly path, served without COOP/COEP |

## Running it

A `minizinc` binary has to be on `PATH`; it is deliberately **not** vendored
into this repo. The [bundled release](https://github.com/MiniZinc/MiniZincIDE/releases)
carries every backend named below. Measured with 2.9.3.

```bash
node prototype/minizinc/check.mjs 400 21      # agree with the oracle
node prototype/minizinc/vsEngine.mjs 400      # the per-instant question
node prototype/minizinc/vsPlan.mjs 250       # the whole-horizon one
node prototype/minizinc/scaling.mjs highs     # how far it goes
node prototype/minizinc/scaling.mjs chuffed 24
```

The browser measurement needs two packages that are deliberately not saved, the
same convention `tests/e2e.mjs` uses:

```bash
npm i --no-save minizinc playwright
CHROME=/path/to/chromium node prototype/minizinc/browser.mjs 72 highs
OFFLINE=1  CHROME=... node prototype/minizinc/browser.mjs 24 highs   # cache, cut the network, reload
NO_SOLVE=1 CHROME=... node prototype/minizinc/browser.mjs 24 highs   # memory baseline
```

## The headline: not Chuffed

ADR 011 selected **Chuffed, explicitly**. On measurement that is the wrong
backend for this model, and the record has been corrected. The same fixture at
each horizon, `proved` being one character per lexicographic level:

```text
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
separates them. Chuffed proves the optimum up to about a four-hour horizon and
then stops proving anything at all - and an unproven level is not a result,
because the ladder passes each optimum down as a cap.

**CBC and CP-SAT behave like HiGHS** (72h in 6.5s and 7.8s, both proved, both
imbalance 0). This is not a HiGHS trick; it is that the fairness level is a
bound on a sum over every assignment, which a linear relaxation gives away for
free and lazy clause generation has to search for.

It costs nothing to act on. The `minizinc` npm package's own build script
fetches `gecode cbc chuffed highs` for `wasm32-emscripten`, so HiGHS is already
in the browser bundle ADR 011 committed to. CP-SAT is not, and is not needed.

## What else has been measured

**Against the oracle.** 420 random instances (seeds 1-420), every one agreeing
with an exhaustive search on all four objectives, on the assignment being
feasible, and - separately - on the model's *reported* objectives matching what
its own assignment scores. That last check is the one worth having: a model can
compute something other than what it claims, and comparing totals alone would
never notice. Checked on HiGHS and on Chuffed, which agree.

Each round is additionally required to have **proved** optimality rather than
merely reported a bound.

**Against the engine, per instant.** Over 400 generated plans from
`scripts/offGridFuzz.mjs`'s generator, seed included:

```text
shortage instants solved  : 1292
model found a full crew   : 36  (2.8%)
model agreed it was short : 1256
```

Same figure that script reports from a bespoke recursive search. Two independent
searches agreeing is worth having - but both answer a **weaker question than the
engine does**, and taking 2.8% as a defect rate was wrong.

**Against the engine, over a whole horizon.** The per-instant oracles never
commit anyone past the instant they are looking at. The engine holds a local
mission in whole grid slots, so when an off-grid mission claims two commanders
at +30 minutes, the people who could have covered an hourly post from :00 are
not free for the whole hour and it leaves the post empty. An instant-wise oracle
calls that a false shortage. It is not one; it is ADR 002's slot discipline,
chosen on purpose.

`vsPlan.mjs` runs the same generator over the full 12 hours through the adapter,
solving each instance twice - once where crew may change hands inside a slot,
once with churn pinned to zero so a slot is indivisible exactly as it is for the
engine:

```text
plans compared over 12h                       : 250
seats the engine left empty                   : 844
...that a slot-disciplined optimum also leaves: 744   (88%)
greedy loss - the real defect                 :  100  (12%), on 29 of 250 plans
further seats a relaxed slot rule would save  :   39
```

**88% of what the engine reports short is genuinely short.** About **12% is the
greedy walk losing**, on roughly one plan in nine. Smaller than the earlier
framing and measured on the right question - in seats rather than instants, over
the horizon the engine actually plans.

It cuts against the case for replacing the engine, which is why it is here.

## The objectives

Minimised in order, each level capped by the last level's proven optimum:

1. **unmet qualifications** - a required tag short at a running segment;
2. **unfilled seats**;
3. **slot churn** - crew changing hands between two segments of the *same* grid
   slot. Soft rather than hard, because a pin covering half a slot must be able
   to hand over at its own edge; the engine splits segments on accepted pin
   bounds precisely so it can, and a hard equality would either make such a pin
   infeasible or silently swallow the rest of the slot. Without this term at all
   the solver rotates people through the halves of a torn hour to shave the
   imbalance, which is not a schedule anybody wants to stand;
4. **imbalance** - the gap between the busiest and the idlest.

## Three things that were not obvious

Each of these cost real time, and none is visible from reading the model.

**Name the floor of every objective.** `unfilledSeats` is a sum of
`want - sum(x)` terms, each non-negative only because of the headcount
constraint - which MiniZinc does not fold into the expression's inferred bounds.
Left as `var int` the solver found the optimum in milliseconds and then spent
*minutes* failing to prove nothing beat it, because as far as its bounds were
concerned a negative total was still on the table. Declaring
`var 0..totalSeats` turns that proof into propagation.

**Break the symmetry between identical guards.** Six interchangeable guards are
720 identical schedules, all of which a solver will walk to prove nothing better
exists. `solve.mjs` derives the interchangeability classes from the instance -
same availability, same exclusions, same qualifications, and neither pinned
anywhere, since a pin names a person - and the model orders each class
lexicographically. It is derived rather than asked of the caller precisely
because a caller that got it wrong would prune real solutions.

**Hand the search over (`-f`).** On the callout fixture Chuffed's default fixed
search order returned `UNKNOWN` - no solution at all - in thirty seconds on the
churn level, where free search proved the optimum in under one.

## Scope, so nobody reads more into this than is here

`rota.mzn` models **who stands where on a given segment grid**: pins,
availability, exclusions, headcount, indivisible holds, qualification coverage
and fairness. It does **not** model night rest, `rotation`-strategy turn
counting, or the ADR 009 history rule that elapsed time is a log rather than a
schedule. The per-mission grids arrive already computed by `segmentGrid`,
because building them is domain work the engine does well and a solver has no
opinion on.

`fromPlan.mjs` deliberately imports `segmentGrid`, `acceptedPins` and `countAt`
from `planner.js` rather than re-deriving any of them. A second implementation
of where a shift begins would be wrong eventually, in a way neither side reveals
on its own reading.

`vsEngine.mjs` solves one instant at a time, which is exact only because that
fuzz has no rest rules and no availability windows. It is not a statement about
a 72-hour horizon; `scaling.mjs` is.

Time is a **segment index**, never an epoch millisecond. The horizon is 72 hours
(ADR 012), so a caller maps absolute instants onto `1..nS` before the model sees
them and back again afterwards.

## The browser path

Everything above spawns a native binary, which says nothing about what the app
would pay. `browser.mjs` serves the model to a real Chromium over plain HTTP
with **no COOP/COEP headers**, because that is the GitHub Pages condition and a
measurement taken under headers Pages cannot set would answer a question nobody
asked.

```text
crossOriginIsolated: false
solvers in the wasm: org.minizinc.chuffed, org.minizinc.mip.coin-bc,
                     org.minizinc.gecode_presolver, org.minizinc.mip.highs
init (fetch+compile): 245ms

24h horizon (26 segments)              72h horizon (74 segments)
  level 1:  1174ms OPTIMAL               level 1:  3179ms OPTIMAL
  level 2:  1653ms OPTIMAL               level 2:  4296ms OPTIMAL
  level 3:  1481ms OPTIMAL               level 3:  3597ms OPTIMAL
  level 4:   913ms OPTIMAL               level 4:  2299ms OPTIMAL
  wall     6405ms                        wall    13720ms
```

Both end at `unmet=0 unfilled=0 churn=0 imbalance=0` - the same answers the
native run gives, at roughly twice the time.

Three things this settles:

- **No `crossOriginIsolated`, so no COOP/COEP.** GitHub Pages, which
  `release.yml` publishes to, can host this. That was the single hosting risk
  ADR 011 flagged and it is closed.
- **HiGHS really is in the WebAssembly build**, not only in the build script.
  The amended backend is shippable as-is.
- **The solve never touches the main thread.** Throttling the main thread to a
  fifth of its speed (6057 -> 1041 spins/ms, measured in the page) left the
  solve times unchanged. A fifteen-second solve does not freeze the UI.

Assets: 19MB raw, **5.2MB gzipped** (4.9MB `.wasm`, 0.3MB `.data`). That is the
number the service worker has to precache and a phone has to fetch once.

### Offline

`OFFLINE=1` loads the page once behind a crude precaching service worker, then
**cuts the network at the browser and stops the server**, reloads, and runs the
whole ladder again. Both, because a cache miss served by a socket that happened
to still be open would look exactly like success.

```text
warm pass    : 7 assets cached by the service worker
offline pass : network cut, server stopped, reloaded
  level 1-4: all OPTIMAL, 5.4s wall, imbalance 0
```

It works. The app's no-network rule survives the solver.

### Peak memory, which is the real risk

The JS heap the page reports is 2MB and means nothing here: WebAssembly memory
is not in it, and that is where all of this lives. Resident memory over the
whole browser process tree, sampled every 200ms:

```text
horizon   idle     peak    delta
    6h   830MB   1114MB   +284MB
   24h   831MB   1085MB   +254MB
   72h   833MB   1177MB   +344MB
   72h   831MB   1236MB   +405MB   (second run)
baseline  821MB    821MB     +0MB   (page loaded, MiniZinc never initialised)
```

Two things follow, and the second is the one to worry about.

**It does not grow with the horizon.** 6 hours and 72 hours cost the same within
run-to-run noise, so this is the price of having MiniZinc *loaded*, not of the
plan being long. A rolling 72-hour horizon does not make it worse.

**It is 250-400MB, and the baseline row says essentially all of it is MiniZinc.**
A page that loads and initialises nothing costs nothing measurable. On a phone
that is a real risk: a background tab holding a third of a gigabyte is a tab
Android may reclaim, and this measurement was taken on a machine with room to
spare. ADR 011's "configure one worker initially" now has a number behind it.

### What the browser measurement still does not say

**A phone figure.** The main-thread finding above cuts both ways: CDP CPU
throttling reaches the main thread and not the worker, so this machine's
desktop-class core did all the solving at every throttle setting. Fourteen
seconds here is not fourteen seconds on a Pixel, and nothing here says what it
is. Given the memory number, that measurement should happen on real hardware
before anything ships.
