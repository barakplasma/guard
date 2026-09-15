# ADR 009: Split the timeline - log the past, schedule only the future

- Status: **Partly implemented on this branch.** The core rule - elapsed time
  that carries a record is a record, not a slot to fill - closes ADR 008's
  defect 1. The log as a first-class structure, and the export ADR 012 decided
  on, are not built, so defect 2 is still open. Adds no dependency. Independent
  of ADRs 010 and 011.
- Date: 2026-09-15

## Context

The engine schedules the whole plan window, including time that has already
happened, and `freezeElapsedBeforeEdit` then retroactively nails down what it
produced. That ordering is backwards, and ADR 008 defect 1 is the leak it
causes: the freeze can record who stood a slot, but not the seat count that
applied, so changing `count` re-derives the past under today's rules.

Every field that feeds a past slot has the same shape of problem. Versioning
`count` in the document would close one column of that drift table and leave
the rest, one field at a time, forever.

The underlying mistake is that already-elapsed time is handed to a scheduler at
all. A rota that has happened is not a scheduling problem with a better answer
available; it is a record.

## Decision

**Split the timeline at *now*.**

Before *now* is a **log**: recorded fact, append-only, changed only by a person
correcting it to match what actually happened. After *now* is **computed**.

The engine's window starts at *now*. No scheduler - the current greedy walk, or
a solver later, seeded or not - can reach backwards, because elapsed time is
never in its input window.

**History still feeds in, read-only.** Fairness, stints and night rest are all
measured against what people have already worked, so the log is an input the
same way pins are today. The single rule is directional: history goes *in*, and
never comes back *out* as engine output. The past cannot drift if nothing
recomputes it.

**A logged assignment carries its own seat count.** It records that two people
stood this slot, not that this mission has two seats. That is what closes
defect 1 at the root rather than per field.

**The log is not bounded by the plan period.** Rolling the window forward stops
discarding history, which closes defect 2: elapsed assignments outside the
current period are still displayable, read-only, because they belong to the log
rather than to the plan.

## What is implemented

The clock enters at `toPlannerInput(doc, now)` and reaches the engine only as
`loggedBefore`, an absolute instant, so `planner.js` still owns no clock and
stays deterministic on absolute input.

Three rules follow from it:

1. **No demand is raised for an elapsed segment that already carries a record.**
   Raising a headcount cannot retroactively staff a finished shift.
2. **The headcount cap does not apply to a claim wholly in elapsed time.**
   Lowering a headcount cannot delete somebody who genuinely stood post, and a
   person correcting the record is not blocked by today's seat count.
3. **Qualification gaps in elapsed time are not reported.** The engine no longer
   staffs that time, so the warning would be an alert nobody can act on.

`OVERSTAFFED` is exempted in `invariants.js` for the same reason: capacity is a
rule about time still to be scheduled, not about what happened.

Two deliberate asymmetries are worth knowing, because both look like bugs:

- **The `covered > 0` gate.** An elapsed segment nobody is recorded on has no
  history to protect, so it is still planned. Without that gate, opening a plan
  whose first days had elapsed would show an empty past rather than the schedule
  it would have had.
- **`freezeElapsedBeforeEdit` calls the planner *without* `now`.** Its job is to
  capture what the engine had already decided for elapsed time, so it needs the
  unrestricted schedule. Passing `now` there would make the engine decline to
  plan the very hours the freeze is about to record, and history would be lost
  rather than preserved.

Omitting `now` means "nothing has elapsed", which is what every caller written
before this meant - so the golden fixtures, the export tests and the URL
round-trips keep their exact previous results.

## What is not implemented

The log is still expressed as pins rather than as a structure of its own, so a
logged assignment does not yet carry its own seat count - the `covered` gate
achieves the same outcome by a narrower route. History outside the plan period
is still invisible (ADR 008's defect 2), and ADR 012's export of a rolled-past
window does not exist. Those are the remainder of this record.

## Consequences

Correcting the record stays possible and becomes the *only* way the past
changes, which is what was asked for. `PIN_OUT_OF_PERIOD` loses most of its
purpose: history outside the period is no longer residue to be swept up, it is
just history.

The document grows monotonically, because the log only ever appends. Where that
growth is paid for is ADR 010's question, and the answer there does not change
this one.

The pin mechanism keeps its meaning for the future - a manual assignment for a
shift that has not happened yet is still an instruction to the scheduler, not a
record. Two concepts that are currently one (`frozen: true` versus a hand
pin) become genuinely separate, which is clearer than the current overload
where a frozen pin is "indistinguishable from one a person swapped by hand."

This is the step to do first. It fixes the reported bug, needs no library, no
storage change and no solver, and both of the other refactors assume it.

## Alternatives rejected

- **Versioning `count` in the document.** Closes one column of the drift table.
  Every other field that feeds a past slot needs the same treatment
  individually, and nothing prevents the next one being missed.
- **Making the past read-only.** Contradicts the request. Correcting the record
  to match reality is the point.
- **Freezing eagerly on a timer rather than on edit.** Still leaves the past as
  engine output, so it still drifts whenever a freeze has not caught up. It
  also needs a clock in a codebase whose engine deliberately has none.

## Evidence

`scripts/historyDriftCheck.mjs` for the drift this prevents. The current
mechanism is `freezeElapsedBeforeEdit` and `freezePastShifts` in
`src/lib/pins.js`, called from `PlanContext`'s `setDoc`.
