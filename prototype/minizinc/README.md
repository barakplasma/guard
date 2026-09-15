# ADR 011 prototype: the rota as a constraint model

Nothing here is shipped or imported by `src/`. It exists so ADR 011's
acceptance criteria can be *measured* rather than argued about, and so the cost
of the model is visible before anything replaces the hand-written engine.

| file | what it is |
| --- | --- |
| `rota.mzn` | the model: one segment grid, hard rules, three named objectives |
| `solve.mjs` | the lexicographic driver - three solves of one model, each capped by the last |
| `oracle.mjs` | brute force over every feasible assignment, plus the random instances |
| `check.mjs` | model vs. oracle on small random instances |
| `vsEngine.mjs` | model vs. the shipped engine, at the instants the engine calls short |

## Running it

A `minizinc` binary has to be on `PATH`; it is deliberately **not** vendored
into this repo, which ships no runtime dependencies it does not need (the app's
own no-network rule is about the browser, and this is a build-time measurement).
The [bundled release](https://github.com/MiniZinc/MiniZincIDE/releases) carries
Chuffed with it. Measured with 2.9.3 and Chuffed 0.13.2.

```bash
node prototype/minizinc/check.mjs 400 21     # agree with the oracle
node prototype/minizinc/vsEngine.mjs 400     # find what the engine misses
```

## What has been measured

**Against the oracle.** 420 random instances (seeds 1-420), every one agreeing
with an exhaustive search on all three objectives, on the assignment being
feasible, and on the model's reported objectives matching what its own
assignment scores. Each level is additionally required to have *proved*
optimality rather than merely reported a bound - a capped round that stopped
early would look like an optimum and poison every level below it.

**Against the engine.** Over 400 generated plans from `scripts/offGridFuzz.mjs`'s
generator, seed included, so both scripts look at the same instances:

```
shortage instants solved  : 1292
model found a full crew   : 36  (2.8%)
model agreed it was short : 1256
plans with a shortage     : 305
...of which falsely short : 36  (11.8%)
elapsed                   : 298.8s  (231ms per instant, three solves each)
```

The 2.8% is the same number `offGridFuzz.mjs` reports from a bespoke recursive
search, which is the point: the model finds a full crew on exactly the class
that script proved the greedy walk misses, and agrees with it on the other 97%.
Two independent searches landing on the same figure is worth more than either
alone.

The second denominator is the one a person feels. 11.8% of the plans that said
"not enough people" had enough people.

## Scope, so nobody reads more into this than is here

`rota.mzn` models **who stands where on a given segment grid**. It does not
model night rest, daily occurrences as distinct holds, remote wholeness, or the
per-mission grids themselves - the grid arrives already computed, because
building it is domain work the engine does well and a solver has no opinion on.
`vsEngine.mjs` correspondingly solves one instant at a time, which is exact only
because that fuzz has no rest rules and no availability windows.

Time is a **segment index**, never an epoch millisecond. The horizon is 72 hours
(ADR 012), so a caller maps absolute instants onto `1..nS` before the model sees
them and back again afterwards.

## What the timings say

231ms per instant is three solver processes, and process startup dominates at
this size - the search itself is not the cost. A real 72-hour horizon is one
instance, not 1292, so this figure is a *per-measurement* cost and not an
estimate of what the app would pay. Getting that estimate needs the adapter this
prototype does not have, and it is the next thing ADR 011 needs before the
decision it records can be called settled.
