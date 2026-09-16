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
| `vsEngine.mjs` | model vs. the shipped engine, at the instants the engine calls short |
| `scaling.mjs` | how far it goes, and on which backend |

## Running it

A `minizinc` binary has to be on `PATH`; it is deliberately **not** vendored
into this repo. The [bundled release](https://github.com/MiniZinc/MiniZincIDE/releases)
carries every backend named below. Measured with 2.9.3.

```bash
node prototype/minizinc/check.mjs 400 21      # agree with the oracle
node prototype/minizinc/vsEngine.mjs 400      # find what the engine misses
node prototype/minizinc/scaling.mjs highs     # how far it goes
node prototype/minizinc/scaling.mjs chuffed 24
```

## The headline: not Chuffed

ADR 011 selected **Chuffed, explicitly**. On measurement that is the wrong
backend for this model, and the record has been corrected. The same fixture at
each horizon, `proved` being one character per lexicographic level:

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

**Against the engine.** Over 400 generated plans from `scripts/offGridFuzz.mjs`'s
generator, seed included, so both scripts look at the same instances:

```
shortage instants solved  : 1292
model found a full crew   : 36  (2.8%)
model agreed it was short : 1256
plans with a shortage     : 305
...of which falsely short : 36  (11.8%)
```

The 2.8% is the same number `offGridFuzz.mjs` reports from a bespoke recursive
search, which is the point: the model finds a full crew on exactly the class
that script proved the greedy walk misses, and agrees with it on the other 97%.
Two independent searches landing on the same figure is worth more than either
alone.

The second denominator is the one a person feels. 11.8% of the plans that said
"not enough people" had enough people.

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

## What is still unmeasured

The browser path. `scaling.mjs` spawns a native binary four times per plan;
shipping means a WebAssembly worker, `.wasm` and `.data` assets served and
cached by the service worker, and a Pixel-class phone rather than this machine.
Nothing here says what that costs.
