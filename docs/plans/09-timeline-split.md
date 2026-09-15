# ADR 009: Split the timeline - log the past, schedule only the future

- Status: Proposed. Fixes ADR 008's defects 1 and 2 structurally.
  Adds no dependency. Independent of ADRs 010 and 011.
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
