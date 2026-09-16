# ADR 004: Independently validate generated schedules

- Status: **Superseded by ADR 017. Failed in practice.** The implementation
  remains temporarily as migration instrumentation while the hand-written
  scheduler is still live; it is not the target architecture.
- Date: 2026-09-10

## Supersession

The independent JavaScript checker found real defects, but the decision to
maintain it as a second schedule-legality authority failed in practice. It
covered assignment geometry while qualification fulfilment, rest-score
correctness, fairness optimality and false infeasibility remained outside it.
New scheduler rules required matching checker logic, invalid results still
travelled through the normal result branch as warning conventions, and illegal
interval-row states remained representable until after generation.

ADR 017 replaces this with one MiniZinc constraint core used for both
optimization and fixed-candidate validation, plus an assignment representation
that cannot express double booking. This record remains useful historical
evidence, not an architecture to extend.

## Context

Pin and row-merging bugs produced assignments that violated the intended slot
structure. A plausible-looking timeline alone is insufficient evidence that the
underlying assignment rows are valid. Diagnostics must also preserve access to
the source plan when computation fails.

## Decision

### Hard invariants

The pure checker independently sweeps actual assignment rows and compares them
with the timeline. It does not trust the timeline as its only evidence. Checks:

- Valid positive row bounds and known employee/mission identities.
- No simultaneous assignments for one person, including duplicate seats on one mission.
- Capacity at each day/night and assignment boundary.
- Rows inside mission and plan bounds; unpinned rows inside availability.
- Local rows inside their stamped slot, with a legitimate maximum slot duration.
- Remote rows equal their clamped mission; daily rows equal one resolved occurrence.
- Timeline tiles the plan exactly and its on-duty list agrees with assignments.
- Reported qualifications belong to the employee; automatic assignments honor exclusions.

Manual pins override availability and qualification exclusions visibly, but cannot
justify impossible geometry or double-booking. Missing qualification coverage and
rest shortfalls are not engine bugs.

`validateSchedule` defaults to throwing a descriptive error containing the rule,
ids, and times. `plan({onInvariantViolation: 'report'})` returns the evidence plus
`engine-bug` findings. The schedule screen uses report mode and shows an error.
Copy-link remains available even for a computation error; generated exports are
disabled when no result exists. History freezing uses strict mode and never freezes
invariant-invalid output; its existing catch preserves the proposed edit.

The checker uses a sorted event sweep, with cost proportional to events and active
assignment entries (plus sorting), rather than claiming all checks are free or O(n).
Engine modules may import other pure scheduler modules; they remain independent
of UI, clocks, randomness, and external services.

### Quality findings

Aggregate no-rest transitions, same-mission adjacency, and runs of at least three
distinct slots/occurrences per employee. Fragmented rows within one slot do not
count as extra turns. Deliberate pins break the automatic-duty run and are excluded
from these ordinary quality findings. Rest requirements in ADR 005 are assessed
separately and do include pinned duty.

Diagnostics are intentionally additive. Golden tests keep assignments, timeline,
statistics, and legacy warnings unchanged while testing new quality findings
separately; no golden fixture was regenerated.

### Bugs exposed by the expanded tests

Off-grid pins previously allowed automatic assignments to overlap them. Accepted
pin edges now split their own mission's segments, retaining original slot identity.
The previous instruction to never add pin boundaries was unsafe and is superseded.

Pin capacity previously used the largest day/night count and counted pins that
overlapped different portions as if simultaneous. It now checks every capacity and
claim boundary. The existing latest-explicit-pin precedence remains in force.

## Evidence

Malformed-output tests cover duplicate seats, geometry, availability exemptions,
incomplete holds, timeline gaps/omissions, false qualifications, and strict/report
behavior. Generated tests include daily missions, off-grid, contested, frozen pins,
and required tags; every result must pass strict checks and remain deterministic.
The browser suite verifies source sharing on computation errors. Quality tests
cover aggregation, fragmentation, and the pinned exemption.

## Consequences

Engine defects are separated from unmet staffing preferences. Strict callers
fail on impossible output, while the schedule screen can retain diagnostic
evidence. Validation adds runtime work; its cost depends on event counts and
active assignments. New quality findings intentionally extend existing output.

## Alternatives rejected

- UI-only checks: miss engine consumers and history freezing.
- Trusting only the generated timeline: can hide omitted or malformed rows.
- Treating every shortage as an engine exception: prevents useful partial results.
