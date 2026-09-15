# ADR 013: The operating model is continuous re-planning, not planning

- Status: Proposed. Re-rates ADR 008's defect 3 and makes ADR 011 urgent.
- Date: 2026-09-15

## Context

Every record so far has treated a rota as something written once and then
edited occasionally. That is wrong, and it is the most important thing that had
not been stated.

The actual operating model, in the user's words: *the only consistent thing is
change*. Missions appear at short notice. People leave without warning. A
mission that needed two people suddenly needs four. The question the app has to
answer is not "what is a good rota for the next three days" but **"given what
everyone has already worked, and what is true now, who stands where in the next
twenty or thirty minutes"**.

So the plan is re-solved constantly, against a moving present, with accumulated
duty as the fairness input.

## Consequences

### ADR 008's defect 3 is not rare; it is the main path

An earlier revision of ADR 008 rated the staffing pass's incompleteness as real
but not urgent, because it never fired on realistic rota shapes. That
measurement was taken on **static** rotas, planned once and left alone. It does
not survive contact with this operating model.

`scripts/midScheduleCallout.mjs` reproduces the reported failure: a mission
inserted into a running schedule, starting in twenty minutes, needing two
drivers. The engine staffs one and reports it cannot find the second, while the
second driver stands an unconstrained post. It works when the mission starts on
the hour and fails at twenty, thirty, forty-five and ninety minutes past - and a
real callout never starts neatly on the hour.

The cause is that phase 3 orders demands chronologically and uses scarcity only
as a tiebreak within the same instant. Anything inserted off the grid is
considered *after* the ordinary posts covering that time have already taken the
scarce people, and nothing ever reconsiders a placement.

**This makes ADR 011 urgent rather than optional.** It is also beyond what the
per-segment matcher rejected in ADR 011 could fix: the trade needed crosses both
missions and segment boundaries, because the driver has to come off a post whose
hour began before the callout existed.

### Re-planning must be free to move generated assignments

If a re-plan cannot move somebody who is already on an unconstrained post, it
cannot absorb change. Two things must therefore stay true and are worth writing
down because they pull against each other:

- **Manual pins are followed exactly.** Unchanged, and never moved by a re-plan.
- **Generated assignments are not commitments.** A re-plan may move anyone whose
  current assignment the engine chose itself, in the part of the timeline that
  has not happened yet.

ADR 009's timeline split is what makes the second safe: once elapsed time is a
log rather than engine output, a re-plan that reshuffles freely cannot touch
history. **The two are a pair** - free re-planning is only acceptable because
the past is out of reach, and the past is only safe because nothing recomputes
it.

### Fairness is measured against the log

"Rebalance based on how much people have already guarded" means accumulated duty
is an input on every solve, not a property of one planning run. ADR 009 already
requires the log to feed the engine read-only; this is the reason it matters
operationally rather than only for correctness.

### Speed is a requirement, and is already met

A decision needed in twenty minutes has to be computed in seconds. The current
engine takes 47 ms on a four-day, seventeen-guard rota, and ADR 012's 72-hour
horizon is 648 assignments. Neither the present engine nor a solver at that size
is anywhere near a problem. Speed is recorded here as satisfied so that nobody
optimises for it at the expense of the correctness that is actually missing.

## Decision

Treat continuous re-planning as the primary use case. Concretely:

1. **ADR 011 moves from "worth considering" to "the fix for a bug that fires
   daily."** It is still last in sequence, because ADR 009 must come first, but
   it is no longer optional.
2. **Re-planning may move any generated assignment in the future**, and must be
   able to, or it cannot absorb the change it exists to absorb.
3. **A shortage report must be trustworthy.** Today `חסרים אנשים` fires when the
   engine merely failed to rearrange, which trains a person to ignore it - the
   worst possible outcome for a warning that is sometimes real.

## Alternatives rejected

- **Ordering demands by scarcity before chronology.** Would fix the reported
  case and break others: a genuinely constrained early mission would then lose
  to a later one, and the engine still could not trade across a boundary it has
  already passed. Reordering a greedy walk moves the failure rather than
  removing it.
- **Re-planning from scratch on every change with no memory.** This is already
  what happens, and is not the problem. The problem is that one pass is greedy.
- **Asking the user to add the mission on an hour boundary.** A workaround for a
  bug, on the path where somebody is under time pressure.

## Evidence

`scripts/midScheduleCallout.mjs`. The demand ordering is in `planner.js`
phase 3; timings from a seventeen-guard, three-post, four-day rota.
