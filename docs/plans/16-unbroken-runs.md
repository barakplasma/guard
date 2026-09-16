# ADR 016: `balanced` will work somebody for three days straight to even out hours

- Status: **Proposed. Not fixed, and deliberately not fixed by me** - the fix is
  a change to what the default strategy optimises, and that changes the schedule
  every already-shared link renders. The measurement is here so the decision can
  be made on numbers.
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

```
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

## The decision to be made

The fix is a new tier in `balanced.compare`: **a candidate already mid-run past
some threshold sorts last, unless nobody else is free.** That is the same shape
as `rotation`'s rest-first rule, which exists for exactly this failure (ADR 002:
"assuming it was cost three guards eighty-eight unbroken hours").

What has to be chosen is the threshold, and the table above is the blast radius
of each choice, because **a plan whose longest run is already under the
threshold is untouched**:

| threshold | ordinary plans that change | late-joiner plans that change |
|---|---|---|
| 3 slots  | ~33% | ~74% |
| 6 slots  | ~8%  | ~62% |
| 12 slots | ~3%  | ~57% |
| 24 slots | 0%   | ~49% |

**Twelve slots is the recommendation**, on the reasoning that it leaves
ordinary rotas alone - three per cent of plans where everyone is present, all of
them currently producing stretches over twelve hours - while removing every
case that a person could not actually stand. Six is defensible if the intent is
that nobody works half a day straight. Three matches `invariants.js`'s own bar
and would rewrite a third of ordinary schedules to get there, which is a
different decision.

It could also be a plan-level field rather than a constant, appended under
ADR 006. That costs a wire position and a control, and buys the ability to
disagree with this record per rota.

## Why this is not mine to decide

Every choice above changes assignments for plans that are currently valid, so
**every link already shared renders a different schedule**. CLAUDE.md is
unambiguous that identical inputs must give identical results and that
`tests/planner.golden.test.js` is the standing proof of it. ADR 006 permits a
correctness fix to change previously invalid output - but the engine classifies
a long run as a *quality finding*, not a violation, so by its own rules this is
a policy change rather than a correction.

It is also a change somebody would want to see a rota rendered with before
accepting, which is not something to do while nobody is looking.

## Consequences if it is taken

The goldens have to be regenerated with `scripts/writeGoldens.mjs`, which exists
for intentional assignment changes and is the only sanctioned way to do it.
`tests/planner.invariants.test.js` should keep passing untouched - nothing here
affects double-booking, overstaffing, availability or determinism - and if it
does not, the change is wrong.

`spreadMinutes` will get slightly worse, and that is the trade: a schedule that
is a little less even but can actually be stood. It is the same tension ADR 002
already records for `rotation`, where the number that looks bad is not the
number being optimised.

ADR 015's clamp becomes unnecessary in its current form, since the run it exists
to prevent would be prevented directly. The clamp could then be relaxed and
carried debts repaid far faster than the present hour a roll.

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

## Evidence

`scripts/unbrokenRunSurvey.mjs` for the table, `scripts/unbrokenRuns.mjs` for
the worked case that found it. `balanced` in `src/lib/strategies.js`;
`long-unbroken-run` in `src/lib/invariants.js`.
