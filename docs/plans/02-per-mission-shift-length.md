# ADR 002: Give each local mission an explicit rotation grid

- Status: Accepted (implemented)
- Date: 2026-09-10

## Context

Missions may need different daytime and nighttime shift lengths. A single plan
step cannot describe a two-hour daytime duty alongside hourly guard shifts, and
reconstructing slot identity from elapsed time miscounts fragmented assignments.

## Decision

Local missions have nullable `shiftMinutes` and `nightShiftMinutes`. The daytime
length inherits the plan default; the nighttime length inherits the mission's
daytime length. Document values are integer minutes from 5 through 1440. Remote
and daily holds ignore these fields.

When both effective lengths equal the plan default, reuse the house grid. Equal
custom day/night lengths form a grid anchored at plan start. Different lengths
restart at each day/night stretch boundary, clipped to the plan period. A final
partial slot is allowed.

Split slots into schedulable segments at relevant availability, night, mission,
daily-occurrence, preferred-rest, and accepted mission-pin boundaries. Rows retain
`slotStart` and `slotEnd` from the original grid; segmentation does not create new
rotation slots. Merge matching contiguous rows only inside the same slot.

Rotation counts distinct local slot starts in prior duty, plus one turn per whole
hold. Two fragments sharing a slot start count once, even across different local
missions. Daily ranking additionally counts completed turns for that mission
([ADR 003](03-daily-missions-and-per-job-rotation.md)).

Store mission overrides at tuple positions 7 and 8, with zero meaning unset.
Compatibility rules are in [ADR 006](06-approved-continuation.md).

## Consequences

Missions can rotate at different rates while agenda and engine consumers share
explicit slot identity. A night boundary starts the requested night cadence.
Turn-based fairness measures slots, not equivalent hours; balanced scheduling is
the separate hours-based strategy.

## Alternatives rejected

- A single plan-wide grid: cannot express independent mission cadences.
- Inferring turns from duration divided by the default step: miscounts custom
  lengths, fragmented slots, and whole holds.
- Counting each segment as a turn: lets unrelated boundaries change rotation.

## Evidence

Implementation: `src/lib/planner.js`, `src/lib/strategies.js`,
`src/lib/planSchema.js`, and `src/lib/urlState.js`.
Tests: `tests/planner.shiftlength.test.js`, `tests/planner.rotation.test.js`,
`tests/planner.golden.test.js`, and `tests/invariants.test.js`.
