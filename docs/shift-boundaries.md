# Catching unexpected short shifts

## Contract

A local duty rotates on its configured day/night grid. Rest preferences may
change the selected crew, but must never insert a changeover. A night boundary
only cuts a slot if the mission's staffing requirement changes there (different
shift lengths already have their own grid).

Partial shifts remain valid at plan/mission edges, availability changes, daily
duty boundaries, and accepted manual or preserved assignments. These are real
constraints, so a blanket “every shift must be 60 minutes” check would be wrong.

## Three independent checks

1. **Regression:** `tests/planner.fragmentation.test.js` decodes the reported
   September 15 link and expects 21 contiguous hourly shifts. It also generates
   rest requirements from 1–480 minutes, off-grid nights, both strategies and
   several shift lengths. The broader randomized invariant suite includes rest
   requirements alongside pins, qualifications and availability constraints.
2. **Runtime:** `checkSchedule` derives allowed boundaries from input constraints,
   independently of the scheduler. `UNEXPECTED_SHIFT_BOUNDARY` rejects an
   unexplained partial row even if its slot stamp and timeline agree. Strict
   callers throw; the app's report mode displays an engine finding and retains
   the shared input for diagnosis. Mutation tests deliberately insert a six-minute
   changeover to prove the checker detects it.
3. **Browser:** `tests/short-shifts.e2e.mjs` opens the actual shared fixture in a
   fresh Jerusalem-timezone phone context, checks every rendered duration, taps
   explicit minute-to-hour corrections, reloads the link, and checks again.
   Run it in both PR CI and the release gate.

## Units and compatibility

Shared documents continue storing rest in minutes. Small values are valid and
must not silently become hours. Display examples and offer an explicit correction
button for values that plausibly represent hours. Rest findings report total
minutes and the longest uninterrupted block separately.

## When this check fails

Keep the failing shared input or randomized seed. Identify the source of every
extra boundary before editing the scheduler. Add a failing regression, fix the
source, then run `npm test`, lint, build and the browser suites. Never suppress
the invariant or regenerate all golden schedules to get a green run. The mixed
90-minute golden was intentionally updated for the unchanged-night-headcount
fix; the other three legacy schedules stay unchanged.
