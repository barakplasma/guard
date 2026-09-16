# ADR 008: Three defects to fix regardless of any refactor

- Status: Defect 1 **fixed** (ADR 009's core rule). Defect 2's data loss
  **fixed**, visibility half **fixed**. Defect 3 partly fixed on `main` by
  #40 and re-rated by ADR 013.
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

```text
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

**Fixed** by ADR 009's core rule. An elapsed segment that already carries a
record defers to it: no demand is raised for it, and the headcount cap does not
apply to a claim inside it. Both columns now read zero, and
`historyDriftCheck.mjs` is the regression fixture; `tests/planner.history.test.js`
pins both halves plus the two cases that must keep working - the future still
following a new headcount, and an unrecorded elapsed segment still being planned
so history stays visible.

## Defect 2: history outside the period becomes unreachable

Moving the plan's start forward by a day strands 96 assignments. They are still
in the document, but outside the period, so the engine ignores them. They are
counted once as `PIN_OUT_OF_PERIOD` rather than shown.

That aggregation is deliberate and correct - a wall of identical alerts reads as
a malfunction - but the consequence is that a person cannot see or correct
history that has rolled out of the window, and `clearStalePins` offers only to
delete it.

**ADR 012 re-rates this twice over.** With a 72-hour horizon, rolling the window
forward is how the app is normally used, so this fires on the main path. And
once a rolled-past window is meant to be *exported*, the same pins stop being
residue and become the only durable record - which turns the existing cleanup
into deletion of the thing that is supposed to survive.

`node scripts/rollForwardLoss.mjs` shows it:

```text
  step                                          logged
  after the freeze records elapsed shifts       288
  after rolling the window forward              288
    ...of which now outside the period          288
  after one unrelated edit (adding a person)      0
```

**288 logged assignments deleted by an edit that had nothing to do with them**,
and nothing exported them first. The two-step shape is why it is easy to miss:
`pruneStalePins` is deliberately timid and declines to act on the edit that
*moves* the period, because the date fields emit an edit on every intermediate
value that parses. So rolling the window looks safe. The deletion lands on the
next edit, when the window is standing still and the pins are already outside
it. `clearStalePins` - the button offered beside the `PIN_OUT_OF_PERIOD`
warning - has the same problem explicitly.

Nothing here is newly broken. This is the behaviour CLAUDE.md describes and
defends, and it was right while out-of-period pins were residue. ADR 012's
decision is what inverts it.

**The data loss is fixed.** `pruneStalePins` is gone rather than narrowed:
every pin it could take had already elapsed, so there was no safer version of
it left. Nothing removes recorded duty automatically now, and the last row of
`rollForwardLoss.mjs` matches the one above it.

Removal is explicit and goes through the export first. `src/lib/logExport.js`
builds the out-of-period assignments into rows the existing CSV export renders
unchanged, using the same `isOutOfPeriod` predicate the cleanup removes on and
`plan()` counts for `PIN_OUT_OF_PERIOD` - so what the warning reports, what the
export carries and what the button removes are one set, asserted in
`tests/logExport.test.js`. The button beside that warning now reads
"ייצא ונקה שיבוצים ישנים" and clears nothing if the download could not be
produced.

**Now closed.** Assignments the period has rolled past are shown, read-only,
in the findings section - beside the alert that counts them and the button that
exports and removes them. That placement is the point rather than a convenience:
pressing that button used to be an act of faith, since it said how many
assignments it was about to carry away and nothing about whose they were.

Read-only by construction, not by discipline. These hours are outside the
period, the engine ignores them, and there is nothing an edit there could mean;
what it renders is text, so there is no control to disable. It goes through the
same formatter as the shareable message, so it reads the way the rota reads and
carries the date - which is the part that matters for a shift the window has
moved past.

A `pre` rather than a table, deliberately. An unbounded number of past shifts in
a four-column table is the phone overflow this codebase keeps rediscovering.
`tests/carried-duty.e2e.mjs` asserts it at 360px, including that nothing inside
it is editable.

## Defect 3: the staffing pass is incomplete

`node scripts/completenessSearch.mjs` searches for rosters that can be staffed
in full but which the engine reports short. It finds them:

```text
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

```text
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

A real callout never starts neatly on the hour, so in practice this fired
almost every time.

### Partly fixed on main by #40

PR #40 added `offGridPriority`, which lifts a constrained demand ahead of an
earlier, less-constrained one it overlaps. **Every offset in the table above now
passes**, and `midScheduleCallout.mjs` is kept as the regression fixture for
that rather than as a live defect.

It closed the shape, not the class. `node scripts/offGridFuzz.mjs` runs random
off-grid instances against the current engine and brute-forces each reported
shortage:

```text
shortage instants checked : 19806
provably false shortages  : 560  (2.8%)
```

### What that 2.8% does and does not mean

**Corrected 2026-09-16, by the whole-horizon measurement the prototype made
possible.** Both `offGridFuzz.mjs` and the model's `vsEngine.mjs` ask a
**per-instant** question: at the moment the engine reports a shortage, can the
people free right then cover every seat? Two independent searches agree the
answer is yes 2.8% of the time.

That question is weaker than the one the engine has to answer, and reading the
number as "2.8% defects" overstates it. A local mission is held in whole grid
slots. When an off-grid mission claims two commanders at +30 minutes, the people
who could have covered an hourly post from :00 are not free for the whole hour,
so the engine leaves it empty - and an instant-wise oracle, which never commits
anyone past the instant it is looking at, calls that a false shortage. It is not
a false shortage; it is the slot discipline, which ADR 002 chose on purpose.

`node prototype/minizinc/vsPlan.mjs 250` asks the same generator over the whole
12-hour horizon, through the real adapter, and solves each instance twice - once
where crew may change hands inside a slot, and once with churn pinned to zero so
a slot is indivisible exactly as it is for the engine:

```text
plans compared over 12h                       : 250
seats the engine left empty                   : 844
...that a slot-disciplined optimum also leaves: 744   (88%)
greedy loss - the real defect                 : 100   (12%), on 29 of 250 plans
further seats a relaxed slot rule would save  :  39
```

So **88% of what the engine reports short is genuinely short**, and about
**12% is the greedy walk losing to an optimal assignment** - on roughly one plan
in nine. That is a smaller claim than the earlier framing and a better one: it
is measured on the question the engine is actually answering, in seats rather
than instants, and it says what a solver would buy.

Some survivors involve no off-grid mission at all, so this is not a residue of
the off-grid case specifically.

**Fix:** ADR 011. Assigning globally closes the class; another ordering key
closes whichever instance is in front of it, which is what happened in ADR 005
and again in #40. A hand-written per-segment matcher would not have fixed the
reported callout either, since the trade crosses missions *and* segment
boundaries.

## Consequences

Defects 1 and 2 are the ones that hurt: they corrupt or hide a record of who
actually stood post, and under ADR 012's 72-hour rolling horizon both fire on
the normal path. **Defect 1 is fixed**; defect 2 waits on the log and the export
in ADRs 009 and 012.

Defect 3 was initially rated as rare, which was wrong, and #40 has since fixed
the reported shape. The class remains open - see the correction below for what
its size actually is - at 2.8% of shortage instants on
random off-grid instances, so the argument for ADR 011 stands - but the acute
version of the bug is no longer in production.

## Evidence

`scripts/historyDriftCheck.mjs` (defects 1 and 2),
`scripts/completenessSearch.mjs` (defect 3, measured rate),
`scripts/rollForwardLoss.mjs` (defect 2 under ADR 012),
`scripts/midScheduleCallout.mjs` (defect 3, the reported case, now a #40
regression fixture) and `scripts/offGridFuzz.mjs` (what #40 left open).
