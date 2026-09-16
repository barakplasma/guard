# ADR 013: The operating model is continuous re-planning, not planning

- Status: Proposed. Re-rates ADR 008's defect 3. #40 has since fixed the acute
  form of that defect; the class it belongs to is still ADR 011's to close.
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

### ADR 008's defect 3 was mis-rated as rare

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

**#40 has since fixed the reported shape**, adding `offGridPriority` so every
offset in that script now passes. `scripts/offGridFuzz.mjs` shows it closed the
shape rather than the class: 2.8% of shortage instants over random off-grid
instances are coverable by the people free at that instant, some with no
off-grid mission involved. Measured over a whole horizon instead, where a slot
has to be held whole, the engine's real loss to greedy ordering is about 12% of
the seats it reports short - see ADR 008's correction.

So ADR 011 is still the fix, for the class rather than for a live outage. It is
also beyond what the per-segment matcher rejected there could do: the trade
crosses both missions and segment boundaries, because the driver has to come off
a post whose hour began before the callout existed.

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

### Speed is a requirement, and is met by the engine as it stands

A decision needed in twenty minutes has to be computed in seconds. The current
engine takes 47 ms on a four-day, seventeen-guard rota, so speed is satisfied
*for the present engine* - recorded so that nobody optimises for it at the
expense of the correctness that is actually missing.

This says nothing about a solver's timings. Those depend on the model rather
than on the assignment count, and ADR 011 requires them measured on real
hardware.

## Decision

Treat continuous re-planning as the primary use case. Concretely:

1. **ADR 011 is the fix for the class, not a nice-to-have.** #40 removed the
   acute symptom, so it is not an outage; about 12% of the seats the engine
   reports short are reachable by an optimal slot-disciplined assignment, and
   each ordering key so far has closed the instance in front
   of it. It stays last in sequence, because ADR 009 must come first.
2. **Re-planning may move any generated assignment in the future**, and must be
   able to, or it cannot absorb the change it exists to absorb.
3. **A shortage report must be trustworthy.** `חסרים אנשים` can still fire when
   the engine merely failed to rearrange - less often since #40, but measurably
   - which trains a person to ignore it, the worst possible outcome for a
   warning that is sometimes real.

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

`scripts/midScheduleCallout.mjs` (the reported case, now a #40 regression
fixture) and `scripts/offGridFuzz.mjs` (what #40 left open). The demand ordering
is in `planner.js` phase 3; timings from a seventeen-guard, three-post, four-day
rota.
