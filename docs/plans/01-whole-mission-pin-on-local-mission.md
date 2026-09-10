# ADR 001: Represent local pins within rotation slots

- Status: Accepted (implemented)
- Date: 2026-09-10

## Context

A whole-mission assignment on a rotating local mission previously appeared as one
multi-day row. Although it consumed capacity, it appeared separately from the
hourly crew in the agenda and exports. Off-grid pin ranges could also cause the
automatic scheduler to overfill part of a segment.

## Decision

Normalize and resolve pin claims before automatic assignments. Emit accepted
local pins as intersections with the same mission segments used for automatic
demand. Include accepted pin boundaries in that mission's segment edges, retaining
the original rotation slot identity. Check pin capacity at claim and day/night
boundaries, preserving the existing explicit-pin precedence.

Keep remote pins as whole mission holds and daily pins as whole overlapping
occurrences, as specified in [ADR 003](03-daily-missions-and-per-job-rotation.md).
Pins may override availability and qualification exclusions with findings, but
cannot override capacity or double-book a person.

Swapping or clearing a displayed range cuts the affected coverage from a pin,
preserving unaffected ranges, other people, and frozen flags. Merge contiguous
rows only within the same slot and with matching assignment identity and flags.

## Consequences

Pinned people appear beside their rotating coworkers in each slot. Local rows
cannot accidentally span multiple rotation slots, and partial pin edits preserve
neighboring duties. Pins remain input constraints rather than output patches.

A pin boundary can split automatic demand. This is necessary for correct capacity
and supersedes the earlier proposal to exclude pin boundaries from segmentation.
Historical invalid overstaffing is not a compatibility requirement.

## Alternatives rejected

- One row for an entire local pin: misrepresents the slot and agenda structure.
- Splitting only in the UI: leaves exports and engine consumers with invalid rows.
- Deleting an entire ranged pin on a one-slot edit: loses unrelated coverage.

## Evidence

Implementation: `src/lib/planner.js`, `src/lib/pins.js`.
Tests: `tests/planner.pins.test.js`, `tests/pins.test.js`,
`tests/planner.extended.test.js`, and `tests/daily.pins.test.js`.
