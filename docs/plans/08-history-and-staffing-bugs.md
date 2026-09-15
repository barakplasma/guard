# ADR 008: Three defects to fix regardless of any refactor

- Status: Proposed. Independent of ADRs 009-011. Defect 3's severity is
  re-rated by ADR 013.
- Date: 2026-09-15

## Context

These were found while evaluating whether to adopt a constraint solver
(ADR 011). None of them is a solver question. They are bugs in the engine and
the document as they stand today, they are reproducible, and each is worth
fixing whether or not the refactors in ADRs 009-011 ever happen.

Three measurement scripts reproduce them. All are measurements rather than
tests, and all sit outside `npm test` on purpose.

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

### It fires on the main path, and an earlier draft of this record was wrong

An earlier revision said this defect "does not fire at all" on realistic rota
shapes. That was measured on **static** rotas, planned once and left alone, and
it is wrong for how the app is actually used (ADR 013).

The reported case: a mission added into a running schedule, starting in twenty
minutes, requiring two drivers. The app staffed one and reported it could not
find the second - while the second driver was standing the gate, an
unconstrained post any of the other guards could have held.

`node scripts/midScheduleCallout.mjs` reproduces it. Eight guards, two of them
drivers, gate needs three and patrol needs two:

```
  callout starts   crew it gets                 result
  +  0 minutes    שומר 1 (driver), שומר 2 (driver) ok
  + 20 minutes    שומר 1 (driver), שומר 7     SHORT A DRIVER
  + 30 minutes    שומר 1 (driver), שומר 7     SHORT A DRIVER
  + 45 minutes    שומר 1 (driver), שומר 7     SHORT A DRIVER
  + 60 minutes    שומר 1 (driver), שומר 2 (driver) ok
  + 90 minutes    שומר 1 (driver), שומר 4     SHORT A DRIVER
  +120 minutes    שומר 1 (driver), שומר 2 (driver) ok
```

Seven seats are needed at that moment and there are eight guards, so a full
staffing plainly exists - both drivers on the callout, six others across the
other posts, one spare.

**On the hour it works; off the hour it does not.** That is the mechanism
exactly. Phase 3 orders demands `a.start - b.start || a.pool - b.pool`, so
scarcity only breaks ties *within the same instant*. A mission inserted off the
grid starts later than the hourly segment already covering that time, so the
unconstrained post is filled first, takes a scarce driver, and the constrained
mission twenty minutes later cannot get them back. The engine never reconsiders
a placement.

A real callout never starts neatly on the hour, so in practice this fires
almost every time.

**Fix:** ADR 011. A solver closes this class by construction, because it assigns
globally rather than committing one demand at a time. The alternative -
hand-writing a per-segment matcher - is rejected there, and would in any case
not be enough here: the trade needed crosses missions *and* segment boundaries,
since the driver has to be moved off a post whose hour started earlier.

## Consequences

Defects 1 and 2 are the ones that hurt: they corrupt or hide a record of who
actually stood post. They should be fixed first and do not need any dependency,
any storage change, or any solver. Under ADR 012's 72-hour rolling horizon both
fire on the normal path.

Defect 3 was initially rated as rare. It is not: under ADR 013's churn workflow
it fires on nearly every mid-schedule insertion, which is the normal operation.
It is the strongest argument for ADR 011 and it should be read as urgent.

## Evidence

`scripts/historyDriftCheck.mjs` (defects 1 and 2),
`scripts/completenessSearch.mjs` (defect 3, measured rate) and
`scripts/midScheduleCallout.mjs` (defect 3, the reported case).
