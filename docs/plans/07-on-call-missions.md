# ADR 007: On-call missions count toward night rest

- Status: Accepted (implemented)
- Date: 2026-09-10

## Context

Some duties can be slept through: the assigned person is present and callable,
but sleeps unless summoned. Night-rest accounting (ADR 005) treats every
assigned shift as wake duty, so staffing someone on such a duty breaks their
continuous rest and reports a shortfall although they slept through it.

## Decision

Missions carry an `onCall` boolean, default false. Time on an on-call mission
is sleep-compatible duty, expressed in three places:

1. `assessRest` excludes on-call shifts from the continuous-gap calculation,
   so the night rest a report certifies runs through such duty.
2. `choose` skips rest-based ordering and filtering for on-call missions - a
   preferred rest block overlapping the duty neither deprioritizes nor
   excludes a candidate.
3. Pins on on-call missions are dropped from the `preferredRest` input, so a
   sleep block may sit inside the pinned duty instead of being pushed out of
   the night.

Ordinary missions keep the exact ADR 005 behaviour; the flag changes nothing
where it is unset.

Wire: mission tuple position 13 carries `1` when on-call and is trimmed when
false, under the append-only reservations of ADR 006 - plans that never heard
of the flag encode to the bytes they always did. The mission card gains a
"כוננות" switch, and the readable plan dump marks on-call missions.

## Consequences

A lone crew member can hold an on-call night and still be certified as
rested, which is the point; it also means rest findings stop describing
whether someone on an on-call duty actually slept. The flag is a planner
instruction, not a measured fact - a summons that keeps someone awake all
night is invisible to the schedule. On-call hours still count as work in
stats and hour balancing; only rest accounting treats them as sleep.

## Alternatives rejected

- A separate "sleep shift" mission type: duplicates the mission model when a
  flag on the existing one says everything.
- A hard rest veto around on-call duty: contradicts the staffing policy of
  ADR 005, which staffs duties anyway and reports shortfalls.
- Excluding on-call hours from stats as well: conflates two questions - who
  is resting, and who is carrying hours - and only the first was asked.

## Evidence

Implementation: `src/lib/rest.js`, `src/lib/planner.js`,
`src/lib/planSchema.js`, `src/lib/urlState.js`, and
`src/pages/MissionsPage.jsx`. Tests: `tests/planner.rest.test.js` and
`tests/urlState.test.js`.
