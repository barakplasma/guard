# ADR 012: The planning horizon is 72 hours, rolled forward

- Status: Proposed, except for the retention question below, which the owner has
  **decided: export**. Constrains ADRs 008-011; settles ADR 010's conclusion and
  raises the priority of ADR 008's second defect.
- Date: 2026-09-15

## Context

ADRs 008-011 were written without a stated planning horizon, so they reasoned
about seven-day, thirty-day and ninety-day rotas to find where each design
breaks. The horizon is actually **72 hours at a time**, rolled forward as time
passes.

That is a much smaller problem than any of those records assumed, and it changes
one conclusion outright.

## Decision

Treat 72 hours as the working window: what a plan covers, what a link carries,
and what the scheduler is asked to solve. Rolling the window forward is the
**normal** operation, not an occasional one.

## Consequences

### The URL holds it comfortably - and is closer to its limit than it looks

72 hours, whole window elapsed and logged:

| shape | log entries | URL chars | as query (8k) | as fragment |
|---|---|---|---|---|
| 8 guards, 4 seats, 2 posts, hourly | 288 | 3,287 | ok | ok |
| **17 guards, 10 seats, 3 posts, hourly** | **648** | **6,744** | **ok** | ok |
| 30 guards, 16 seats, 4 posts, hourly | 1,152 | 10,987 | breaks | ok |
| 50 guards, 24 seats, 4 posts, hourly | 1,728 | 15,429 | breaks | ok |
| 17 guards, 10 seats, 3 posts, 2-hour | 324 | 3,778 | ok | ok |
| 30 guards, 16 seats, 4 posts, 2-hour | 576 | 6,148 | ok | ok |

**The current shape sits at about 84% of the query-string budget.** It works
today, which is why no wall has been hit, but a fourth post or a larger roster
crosses 8,000 characters and sharing starts failing with no warning beforehand.

Every shape here fits in a fragment with room to spare. So ADR 010's
recommendation stands and gets simpler: **move the plan from the query string to
the fragment, and local-first is not needed at all** - not merely deferred. A
72-hour window at hourly granularity cannot reach the fragment ceiling for any
plausible roster.

Shift length is the strongest lever if it ever gets close: a two-hour grid
roughly halves the log.

### Rolling forward is routine, so ADR 008's second defect is worse than rated

ADR 008 rates the "history outside the period becomes unreachable" defect as
secondary: moving the plan's start forward by a day strands 96 assignments,
counted once as `PIN_OUT_OF_PERIOD` and no longer displayable.

With a 72-hour horizon that is not an edge case. **Rolling the window forward is
how the app is used**, so every roll strands the window that just ended. The
defect fires on the main path, and should be treated as co-equal with the
headcount defect rather than below it.

ADR 009 handles it correctly either way, by putting the log outside the plan
period. This record only re-rates its urgency.

### The scheduling problem is small

648 assignments over 72 hours is a small *assignment* count, and the present
engine handles it in 47 ms.

It does **not** follow that a solver needs no time or memory limits. The
assignment count is not the model size: variables, domain sizes, reified
constraints and the fairness objectives drive that, and none of it exists until
the model is written. ADR 011 requires those limits to be measured on real
hardware rather than assumed away, and requires cancellation to work.

## Retention across rolls: export

**Decided by the project owner: the rolled-past window is exported, not kept in
the live document and not silently dropped.**

Rolling the horizon forward carries the window that just ended out of the plan
and into an export, so the live document stays bounded at one 72-hour window
while the record of who actually stood post survives outside it. A rota that
remembers nothing cannot answer "who was on the gate last Tuesday"; a rota that
remembers everything grows without limit. Exporting is the answer to both.

Three consequences follow, and they simplify the other records rather than
complicating them:

- **The log is bounded.** It never exceeds one window, so the URL never exceeds
  the sizes in the table above. ADR 010's local-first reserve is not merely
  deferred - under this decision nothing can reach the fragment ceiling.
- **The export is now load-bearing.** It stops being a convenience and becomes
  the only durable record. That raises the bar on it: the format has to carry
  everything a person would need to answer a question months later - who, which
  mission, which window, and whether the assignment was manual, corrected
  history, or generated - and the roll must not complete until the export has
  actually been produced. Losing a window to a failed export is data loss.
- **Correcting the record applies inside the current window.** Once a window has
  rolled and been exported, correcting it means correcting the export, not the
  plan. That is a deliberate boundary and should be visible in the interface.

The CSV export already exists and is already exempt from window-scoped sharing,
so it is the natural carrier; whether it needs extra columns is an implementation
question for ADR 009.

## Evidence

Measurements from `encodePlan` over a 72-hour window at six roster shapes, whole
window elapsed and logged. Query-parameter usage in `src/state/PlanContext.jsx`.
