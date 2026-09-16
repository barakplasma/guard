# ADR 016: `balanced` will work somebody for three days straight to even out hours

- Status: **Implemented.** Found while measuring ADR 015 and independent of it.
  Six hours, chosen because at six every golden fixture is unchanged and every
  test passes. It also removes ADR 015's reason for clamping repayment, so the
  two records land together.
- Date: 2026-09-16

## Context

Found while measuring ADR 015, and independent of it.

`balanced` evens out total time on duty (ADR 002). Evening out is *exactly* what
produces an unbroken run: whoever is behind has the fewest minutes, so they are
the cheapest candidate for the next slot, and the one after that, until they are
level. Nothing in the key it ranks on says a person has to sleep.

`node scripts/unbrokenRunSurvey.mjs` - random rosters, **nobody carrying
anything**, so ADR 015 plays no part. Plans where the seats outnumber the people
are skipped, since there the strategy has no choice to make:

```text
  everyone present from the start (1059 plans)
    longest run <3h    :   705  66.6%
    longest run 3-6h   :   265  25.0%
    longest run 6-12h  :    61   5.8%
    longest run 12-24h :    28   2.6%
    longest run >=24h  :     0   0.0%

  somebody joins part-way in (736 plans)
    longest run <3h    :   192  26.1%
    longest run 3-6h   :    87  11.8%
    longest run 6-12h  :    41   5.6%
    longest run 12-24h :    59   8.0%
    longest run >=24h  :   357  48.5%

  worst seen: 72h - the entire three-day window, one person, no break
```

The split is the finding. **With everyone present the engine is fine**: two
thirds of plans keep every stretch under three hours and none reaches a day.
The trigger is somebody whose availability starts after the plan does - leave, a
course, a new arrival, all ordinary - and then **half of those plans put a guard
on post for twenty-four hours or more without a break.**

`invariants.js` already calls three consecutive slots a `long-unbroken-run`, so
the engine knows this is bad. It reports it and schedules it anyway.

This is not a quality nit. A rota that asks one person to stand seventy-two
hours is not a rota anybody executes; it is a schedule that has to be corrected
by hand before it can be used, which is the thing this app exists to avoid.

## Decision

A tier above everything else in `balanced.compare`: **a candidate already six
unbroken hours into a stretch sorts last, and is still taken if nobody else is
free.** The same shape as `rotation`'s rest-first rule, which exists for exactly
this failure (ADR 002: "assuming it was cost three guards eighty-eight unbroken
hours"). `occupy` tracks the stretch, so a person mid-run is mid-run however they
got there, pins included.

**Six hours, and the number is measured rather than felt.** A plan whose longest
run is already under the threshold is untouched, so the threshold decides how
much existing behaviour moves:

| threshold | goldens that change | tests that fail |
|---|---|---|
| 3 hours  | 1 | 2 |
| **6 hours**  | **0** | **0** |
| 12 hours | 0 | 0 |

Six is the smallest value that costs nothing in the fixtures, and smaller is
better here: it is the bound on how long anybody stands. Twelve buys nothing
extra and permits half a day.

### What it fixes, and what it provably cannot

The worked case in `scripts/unbrokenRuns.mjs` goes from **24h, 47h, then 5h** to
**6h at every roll**. Across the survey, `>=24h` among late-joiner plans falls
from **48.5% to 27.4%**.

It does not reach zero, and that is not a shortfall in the rule. Of the plans
that still hand somebody twenty-four hours or more, **100% have nobody spare at
all** while the joiner is away - every person present is on post every slot, and
there is nobody to hand over to. Those runs are forced by the roster, not chosen
by the comparator, and `long-unbroken-run` is the right answer to them: the rota
needs another person, and no scheduler can invent one.

So the split is clean. Every avoidable long run is gone; every remaining one is
a staffing shortage wearing a different hat.

## Consequences

**ADR 015's clamp stops being what keeps anyone off post for three days**, and
that changes what it is for. With runs capped directly, a carried debt can be
repaid much faster without buying a stretch:

| debt cap | longest run | 36h debt after 8 rolls |
|---|---|---|
| 2 hours | 5h | 30h |
| **6 hours** | **6h** | **0h — fully settled** |
| unclamped | 6h | 0h |

So ADR 015's cap moves from two shift slots to six hours, and its fairness
measurement goes from "about an hour a roll" to **settled in eight rolls with no
stretch over six hours**. The cap is now the same quantity as this record's, in
code rather than by coincidence: repaying a debt is *what* builds a run, so a
window may not owe anyone more continuous duty than it is willing to hand them.

It still has a job. Unclamped, a newcomer against a roster five hundred hours
ahead takes **62 of a 72-hour window** while everyone else takes 20 - in
six-hour stretches, but still the whole window tilted onto one person. At six
hours they take 33 against 27, which is the feature working.

**No golden fixture changes and no test fails**, which is the evidence that
rotas that were fine stay exactly as they were. `tests/planner.invariants.test.js`
passes untouched - nothing here affects double-booking, overstaffing,
availability or determinism.

`spreadMinutes` gets slightly worse in the plans this touches, and that is the
trade: a schedule a little less even that can actually be stood. Same tension
ADR 002 records for `rotation`, where the number that looks bad is not the
number being optimised.

## Alternatives rejected

- **Leave it and rely on the warning.** What happens today. The warning fires on
  a run of three and says nothing louder for a run of seventy-two, and somebody
  reading a rota on a phone at 3am is not auditing findings.
- **Cap the run inside the segment walk rather than in the strategy.** Puts
  policy in `planner.js`, which ADR 002 keeps policy-free on purpose: *a new
  strategy should never need a change in `planner.js`*.
- **Fix it by reaching for the solver (ADR 011).** It would fix it, as a
  constraint rather than a tier - and it is months away and costs 250-400MB in
  the browser, against a tier in a comparator.
- **A plan-level threshold rather than a constant**, appended under ADR 006.
  Costs a wire position and a control, and buys the ability to disagree with
  this record per rota. Worth doing if anybody ever wants to.
- **Twelve hours instead of six.** Costs the same in fixtures and permits half a
  day on post. Nothing recommends it over six except a reluctance to move.

## Evidence

`tests/planner.unbrokenRuns.test.js` pins the four cases that matter: the
reported shape, a saturated roster staying fully staffed, an ordinary rota
untouched, and a pinned stretch counting towards the run.
`scripts/unbrokenRunSurvey.mjs` for the survey, `scripts/unbrokenRuns.mjs` for
the worked case that found it, `scripts/fairnessAcrossRolls.mjs` for what it
does to ADR 015. Implementation: `MAX_UNBROKEN_MINUTES` and the `midRun` tier in
`src/lib/strategies.js`, the stretch tracked in `occupy` and `carriedDebts` in
`src/lib/planner.js`. `long-unbroken-run` in `src/lib/invariants.js` is the
finding that flagged it all along.
