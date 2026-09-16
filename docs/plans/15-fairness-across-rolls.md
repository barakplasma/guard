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

**Duty already stood is an input to fairness, from two sources, summed,
normalized against the least-worked person and clamped.** The last two words
are not housekeeping - they are the whole safety of this record, and the first
implementation had neither. See "What this cost to get right" below.

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

## What this cost to get right

The first implementation folded the whole debt into the fairness key. It worked:
the 36-hour gap closed in four rolls and stayed closed. It was also dangerous,
in two ways that only measurement found.

**A newcomer was handed every hour there is.** Someone joining a roster where
everybody else has stood five hundred hours is five hundred hours behind,
`balanced` picks the fewest minutes for every slot, and so the newcomer stood
**72 of a 72-hour window, unbroken**, while the rest did 18 each. Fixed by
measuring debts against the least-worked person rather than in absolute hours: a
roster where everyone has stood five hundred hours is a roster in balance.

**Repaying a debt buys an unbroken run as long as the debt.** The returning
guard was handed **72 unbroken hours** to settle a 36-hour gap - the same
eighty-eight-hour failure `rotation` was fixed for (ADR 002), arriving through
the fairness key instead. `node scripts/unbrokenRuns.mjs` measures it.

The second is not a bug in the seeding. It is **inherent to a greedy
minutes-first rule**: whoever is behind is the cheapest candidate for the next
slot, and the one after that, until they are level. Repayment rate and run
length are the same quantity seen twice, and the measurement says so plainly -
same fixture, same 36-hour debt, only the clamp changed:

| debt cap | longest unbroken run | debt left after 8 rolls |
|---|---|---|
| 1 slot  | 2h  | 36h — repays nothing |
| **2 slots** | **5h** | **30h — about an hour a roll** |
| 4 slots | 11h | 10h — about 3.5h a roll |

**Two slots is what ships**, and the cap is one line in `carriedDebts`. It is
chosen against the engine's own quality bar rather than picked by feel:
`invariants.js` calls three consecutive slots a `long-unbroken-run`, so a debt
may never buy more than two. The cost is stated rather than hidden - a large
debt settles as the period rolls forward instead of in one go.

## Consequences

The gap now closes slowly instead of never:

```
  roll   window spread   cumulative spread   busiest   idlest
     2           2.0h               36.0h       36h       0h
     4           2.0h               34.0h       66h      32h
     6           2.0h               32.0h       96h      64h
     8           2.0h               30.0h      126h      96h
```

About an hour a roll against the un-clamped four rolls flat. Slow, converging,
and it cannot put anybody on post for a day and a half to get there. Compare the
before table, where the same fixture sat at 36h from roll 2 to roll 8 and would
have sat there forever.

**This is the sharpest argument in the repo for ADR 011.** What is wanted here
is "even out total duty *subject to* nobody standing an unbroken run" - two
objectives that have to trade against each other. A greedy walk has one ordering
and no way to trade, so the two collapse into a single knob where every hour of
repayment costs an hour of unbroken duty. A solver states them as separate
levels and trades them properly. The table above is what the absence of that
costs, in hours.

**`scripts/unbrokenRuns.mjs` also records something already true on `main`.**
The same fixture hands the returning guard a **forty-hour** unbroken run at the
roll whose window still contains their absence - no carried duty involved.
`balanced` evens out the window it is given, and that is what evening out looks
like when one person is far behind inside it. Recorded rather than fixed:
changing what `balanced` optimises is the owner's call, not a tidy-up, and it
would change the schedule every already-shared link renders.

Worth knowing while reading those numbers: the app used to show only the window
figure, so during repayment it displayed a spread that looks like a fault and is
a fix. **The summary now prints both** - "פער בחלון" beside "פער כולל תקופות
קודמות" - and a guard who carries anything gets a second line under their name
saying how much. Neither appears at all when nobody carries anything, which is
the ordinary rota.

That last part is not cosmetic. `buildStats` returns the object it always
returned for a plan with no carried duty, fields and all, so every golden
fixture passes untouched and every link already shared renders exactly as it
did. The first attempt added the fields unconditionally and broke four goldens
for a feature those plans do not use - the right fix was the wire format's own
discipline (write it only when it carries a value), not a looser test.

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
- **Absolute totals rather than a gap from the least-worked person.** What the
  first implementation did, and it hands a newcomer every hour in the window.
- **An unclamped debt.** Also what the first implementation did. Repays fully
  and buys 72 unbroken hours doing it.
- **Carried duty as a tiebreak below the minutes key.** Provably cannot build a
  run, and measured to do nothing at all: where demand divides evenly there is
  no marginal slot to award, so the 36-hour gap stayed at 36 hours. Safe and
  pointless is not better than slow.
- **Make `clearStalePins` improve fairness by being pressed.** What the first
  implementation of this accidentally did, caught by the existing test. Pressing
  a cleanup button must not change the schedule, and a fairness rule that only
  works after somebody tidies up is not a fairness rule.

## Evidence

`scripts/fairnessAcrossRolls.mjs` for the fairness tables and
`scripts/unbrokenRuns.mjs` for the run lengths. Implementation in `carriedDebts`
and `makeState`, and the stale-pin walk in `planOnce` (`src/lib/planner.js`),
`ringKeys` (`src/lib/strategies.js`), `carryForward` (`src/lib/pins.js`),
`employeeSchema` and `toPlannerInput` (`src/lib/planSchema.js`), and positions
5-6 in `src/lib/urlState.js`. `buildStats` and `SummaryTable` for the display
half. Tests in `tests/planner.carriedDuty.test.js` and
`tests/carried-duty.e2e.mjs`.
