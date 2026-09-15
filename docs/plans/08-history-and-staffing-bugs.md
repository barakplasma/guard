# ADR 008: Three defects to fix regardless of any refactor

- Status: Proposed. Independent of ADRs 009-011.
- Date: 2026-09-15

## Context

These were found while evaluating whether to adopt a constraint solver
(ADR 011). None of them is a solver question. They are bugs in the engine and
the document as they stand today, they are reproducible, and each is worth
fixing whether or not the refactors in ADRs 009-011 ever happen.

Two measurement scripts reproduce them. Both are measurements rather than
tests, and both sit outside `npm test` on purpose.

## Defect 1: a headcount change rewrites history

`node scripts/historyDriftCheck.mjs` applies each kind of edit through the real
`setDoc` path, three days into a seven-day rota, then re-reads the past:

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

`freezeElapsedBeforeEdit` works for the case it was built for: **no edit ever
swaps one guard for another in the past.** What it cannot cover is headcount.

A mission carries one `count` for all time. The freeze records *who* held an
elapsed slot; it has nowhere to record *how many seats existed then*. So raising
`count` today re-staffs every elapsed slot to the new number and writes in
people who were never on duty, and lowering it deletes people who genuinely
stood post.

This is the reported defect, in the user's words: the algorithm changing
history for a more optimal schedule breaks business logic about reality.

**Minimal fix, independent of ADR 009:** elapsed demand must be capped by the
record rather than recomputed from today's `count`. Generated staffing in
already-elapsed time should not exceed what the freeze recorded for that slot,
and should not fall below it either. ADR 009 fixes this structurally by never
scheduling elapsed time at all; this narrower change closes the hole without
waiting for that.

## Defect 2: history outside the period becomes unreachable

Moving the plan's start forward by a day strands 96 assignments. They are still
in the document, but outside the period, so the engine ignores them. They are
counted once as `PIN_OUT_OF_PERIOD` rather than shown.

That aggregation is deliberate and correct - a wall of identical alerts reads as
a malfunction - but the consequence is that a person cannot see or correct
history that has rolled out of the window, and `clearStalePins` offers only to
delete it.

**ADR 012 re-rates this.** With a 72-hour horizon, rolling the window forward is
how the app is normally used, not an occasional action - so this fires on the
main path and is co-equal with defect 1 rather than below it.

**Minimal fix:** the agenda should be able to display elapsed assignments
outside the current period read-only, so rolling the window forward stops
looking like data loss. ADR 009 makes this natural by separating the log from
the plan period. What should happen to a window that has rolled past - kept,
dropped, or exported - is the open question ADR 012 records.

## Defect 3: the staffing pass is incomplete

`node scripts/completenessSearch.mjs` searches for rosters that can be staffed
in full but which the engine reports short. It finds them:

```
employees: e1[medic] e2[commander] e3[driver,commander] e4[driver,commander,medic]
missions : m1 count=1 requires=commanderx1
         | m2 count=2 requires=driverx1+commanderx1
         | m3 count=1 requires=driverx1
engine   : missing-required-tag
```

Every mission is staffable: `m3` takes `e3`, `m2` takes `e4` and `e1`, `m1`
takes `e2`. The engine reports a missing qualification because it fills
`(mission, segment)` demands one at a time, in `missionById` order, and never
reconsiders. Inside one segment that is a bipartite assignment problem walked
greedily.

This is the failure ADR 005's planning notes predicted - *"filling the commander
seat by preference strands the driver seat and reports a shortage that does not
exist"* - and answered with scarcity ordering. Scarcity ordering closed most of
it, not all.

**How much it matters depends sharply on the roster.** The false-shortage rate
peaks at 0.94% on five-person rosters with exclusions and falls toward zero as
the roster grows. On the rota shape this app is actually used for - patrol
requiring a driver, a gate, a kitchen refusing commanders, four days, hourly -
it does not fire at all, at any headcount from critically tight to comfortable,
with a one-hour spread across four days.

So this is real but not urgent. The user-visible harm is that `חסרים אנשים`
is sometimes false, and a commander acting on it goes looking for a guard they
already have.

**Fix:** ADR 011. A solver closes this class by construction. The alternative -
hand-writing a per-segment matcher - is rejected there for reasons that have
nothing to do with diff size.

## Consequences

Defects 1 and 2 are the ones that hurt: they corrupt or hide a record of who
actually stood post. They should be fixed first and do not need any dependency,
any storage change, or any solver. Under ADR 012's 72-hour rolling horizon both
fire on the normal path.

Defect 3 is a correctness gap that realistic rotas do not currently hit. It is
recorded so that it is not rediscovered, and so that the claim "the engine said
we were short" is known to be fallible.

## Evidence

`scripts/historyDriftCheck.mjs` and `scripts/completenessSearch.mjs`.
