# ADR 015: Duty does not stop counting when the window rolls past it

- Status: **Implemented.** Extends ADR 002's `balanced` and `rotation`, required
  by ADR 012's rolling window and ADR 013's operating model. Depends on ADR 012's
  export decision for the half that bounds the document.
- Date: 2026-09-16

## Context

The owner's statement of what matters, in their own words:

> The only consistent thing is change ... **rebalancing based on how much
> previous people have already guarded**, mixed with what the actual new
> requirements are in 20 or 30 minutes is what's important.

ADR 002's `balanced` strategy evens out total time on duty. ADR 012 plans
72 hours at a time and rolls the window forward. Nothing connected the two, and
the connection is where the requirement above lives: the engine's sum runs over
*the window it is given*. An hour that has fallen out behind the window is not
in it.

For a rota where demand divides evenly and everybody is present, this never
shows: five seats over eight guards is fifteen hours each per day whatever the
engine does. It shows the moment somebody is away.

`node scripts/fairnessAcrossRolls.mjs` - eight guards, five seats, a 72-hour
window rolled forward a day at a time, with the eighth guard away for the first
two days and then back. Before this record:

```
  roll   window spread   cumulative spread   busiest   idlest
     1           0.0h               18.0h       18h       0h
     2           0.0h               36.0h       36h       0h
     4           0.0h               36.0h       66h      30h
     8           0.0h               36.0h      126h      90h
```

The gap opens while the guard is away, which is nobody's fault and unavoidable.
Then it **never closes**. By roll 2 the window no longer contains the absence,
so the engine balances it perfectly and has no reason to send anyone extra duty.

The left column is the part that makes this worse than a missing feature. The
app's own spread reads **0.0h** at every roll from the first: it reports perfect
fairness while one guard is permanently thirty-six hours behind. A number that
is silent about a problem is a gap; a number that actively says there is no
problem is a wrong answer.

## Decision

**Duty already stood is an input to fairness, from two sources, summed.**

1. **Pins outside the plan period.** The engine cannot schedule them - that is
   what out-of-period means - but the hours are real and they count towards how
   much that person has stood. Read from the *raw* missions, like the existing
   `PIN_OUT_OF_PERIOD` count and for the same reason: a mission that has itself
   dropped out of the period is gone from `missionById`, and the hours its pins
   record are no less real for that.
2. **`carriedMinutes` and `carriedStints` on the employee**, appended at wire
   positions 5 and 6 under ADR 006 and written only when non-zero, so a guard
   who has carried nothing encodes to the bytes they always did.

The second exists because of ADR 012. A rolled-past window is exported and then
cleared, which bounds the document - and takes the evidence with it. Carrying a
per-person total is what survives that: a few bytes each, instead of the shifts.

**`clearStalePins` converts source 1 into source 2, and nothing else.** Because
the engine counts both, the sum is identical before and after, so **no shift
moves** - the button stays a cleanup rather than becoming an edit, which was
always its safety argument. `tests/pins.test.js` asserted that before this
record and still does; what changed is that it now means something stronger.

The two strategies read different units, and that is not an oversight.
`balanced` evens out hours, so it reads `carriedMinutes`. `rotation` counts
shifts and never consults hours (ADR 002), so it reads `carriedStints` - and
carrying minutes would have said nothing there at all.

## Consequences

The gap closes completely, and then stays closed:

```
  roll   window spread   cumulative spread   busiest   idlest
     2          31.0h               35.0h       35h       0h
     3          24.0h               24.0h       48h      24h
     4          14.0h               14.0h       62h      48h
     5           4.0h                4.0h       76h      72h
     6           0.0h                0.0h       90h      90h
     8           0.0h                0.0h      120h     120h
```

Four rolls to repay two days of absence, and nothing left over. Compare the
before table, where the same fixture sat at 36h from roll 2 to roll 8 and would
have sat there forever.

**The window spread is larger while it repays, and that is the trade working
rather than failing.** A window deliberately unbalanced is how somebody who came
back from leave catches up; a perfectly even window at roll 3 would be one that
had given up. It returns to zero on its own once the debt is settled, so this
costs nothing in the steady state - which is the case that was already fine and
had to stay fine.

Worth knowing while reading those numbers: the app shows the window figure, so
during repayment it displays a spread that looks like a fault and is a fix. That
is a user interface problem this record does not solve.

**`carriedStints` is an approximation and says so.** An out-of-period pin has no
grid left to name a slot on, so a turn is counted as one plan shift length, at
least one. The right unit at the wrong precision beats the right precision on a
number nobody kept.

**It is not a ledger.** Nothing reconciles carried totals against the exported
CSV, and nothing stops a person editing them to zero. That is consistent with
the rest of the document, which the owner is trusted to hold, and it is worth
stating rather than discovering.

## Alternatives rejected

- **Keep every pin forever.** Fairness would be exact and the URL would grow
  without bound, which is the thing ADR 012 exists to prevent.
- **Count fairness only inside the window, and show the cumulative figure in the
  UI instead.** Honest, and it leaves the engine still making the wrong choice -
  it would tell somebody their rota is unfair without doing anything about it.
- **Decay old duty, so a heavy week matters less than a recent one.** Probably
  right eventually, and it needs a clock inside the fairness rule, which the
  engine must not have. `loggedBefore` could carry it; nobody has asked for it.
- **Make `clearStalePins` improve fairness by being pressed.** What the first
  implementation of this accidentally did, caught by the existing test. Pressing
  a cleanup button must not change the schedule, and a fairness rule that only
  works after somebody tidies up is not a fairness rule.

## Evidence

`scripts/fairnessAcrossRolls.mjs` for both tables. Implementation in
`makeState` and the stale-pin walk in `planOnce` (`src/lib/planner.js`),
`ringKeys` (`src/lib/strategies.js`), `carryForward` (`src/lib/pins.js`),
`employeeSchema` and `toPlannerInput` (`src/lib/planSchema.js`), and positions
5-6 in `src/lib/urlState.js`. Tests in `tests/planner.carriedDuty.test.js`.
