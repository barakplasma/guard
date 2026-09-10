# 04 · Validate scheduler output

**Status:** implemented and verified on PR #28’s branch.
**Approved decisions:** [continuation](06-approved-continuation.md).

## Hard invariants

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

## Quality findings

Aggregate no-rest transitions, same-mission adjacency, and runs of at least three
distinct slots/occurrences per employee. Fragmented rows within one slot do not
count as extra turns. Deliberate pins break the automatic-duty run and are excluded
from these ordinary quality findings. Rest requirements in Plan 05 are assessed
separately and do include pinned duty.

Diagnostics are intentionally additive. Golden tests keep assignments, timeline,
statistics, and legacy warnings unchanged while testing new quality findings
separately; no golden fixture was regenerated.

## Bugs exposed by the expanded tests

Off-grid pins previously allowed automatic assignments to overlap them. Accepted
pin edges now split their own mission's segments, retaining original slot identity.
The previous instruction to never add pin boundaries was unsafe and is superseded.

Pin capacity previously used the largest day/night count and counted pins that
overlapped different portions as if simultaneous. It now checks every capacity and
claim boundary. The existing latest-explicit-pin precedence remains in force.

## Verification

Malformed-output tests cover duplicate seats, geometry, availability exemptions,
incomplete holds, timeline gaps/omissions, false qualifications, and strict/report
behavior. Generated tests include daily missions, off-grid, contested, frozen pins,
and required tags; every result must pass strict checks and remain deterministic.
The browser suite verifies source sharing on computation errors. Quality tests
cover aggregation, fragmentation, and the pinned exemption.
