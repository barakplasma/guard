# Approved continuation: Plans 3–5

Approved by the user on 2026-09-10. This document supersedes conflicting decisions
in Plans 03–05. Implementation has not started.

## Branch and delivery

Use PR #28's existing branch, `claude/tornot-scheduling-plan-vcn99j`.
The planning review inspected revision `1b446df`; Plans 1–2 are implemented,
while 3–5 remain planned. Fetch all remotes and verify the latest PR head before
continuing. Preserve unrelated local work.

Update the existing planning documents, then implement **3 → 4 → 5**. Split each
feature into tasks touching at most three files. Start bug corrections with failing
regression tests. Commit and push continuation work to the same branch; do not
merge or deploy.

## Correct the plans first

- Replace stale implementation order and status claims with verified branch state.
- Resolve the URL collision: daily times occupy mission positions 9–10;
  qualification requirements/exclusions occupy 11–12. Remove Plan 3's proposed
  weekday-mask reservation at 11.
- Equal daily times mean a full calendar day: **08:00–08:00 ends the next morning**.
- Qualify fairness promises: availability, pins, and competing duties can force
  repeats. Use occurrence counts first in both daily strategies so clipped
  occurrences do not distort rotation.
- Daily pin coverage, swaps, clearing, deduplication, and freezing must understand
  expanded occurrences rather than only literal written ranges.
- Replace Plan 5's separate-seat requirement and hard rest reservations with the
  qualification coverage and staffing-first rules below.
- Remove the claim that two drivers taking six hours of rest each can cover an
  eight-hour night: together they provide only four working hours.
- Scheduling shortages describe the scheduling attempt, not proof that no
  solution exists.
- Correct Plan 4's conflicting report-mode/freezing instructions and update the
  engine import rules if a pure checker module is introduced.
- Document viewer-timezone behavior explicitly. Old builds interpreting daily
  missions as continuous local duty is a compatibility limitation, not safe
  degradation.

## Plan 3: daily missions

- Add `daily`, nullable `dayStart`/`dayEnd`, and adapter-resolved absolute
  occurrences. Missing bounds produce no occurrences and a visible hint.
- Use 24-hour inputs and labels showing “next day” for overnight/full-day duty.
  Preserve calendar-local times through DST and clamp occurrences to mission and
  plan bounds. Continue using the viewer's timezone, matching night windows.
- Schedule each occurrence as one uninterrupted hold before automatic local
  shifts. Use occurrence-specific identity for capacity, pin counting, row merging,
  and turn accounting.
- Daily rotation prioritizes completed occurrences on that mission, then
  strategy-specific tie-breakers. Future pins must not count as past turns.
- Whole-mission pins cover every occurrence; ranged pins cover each positively
  overlapping occurrence in full. Swapping or clearing one occurrence preserves
  other days and other people.
- Daily duty blocks other assignments only during its actual hours. There is no
  additional nighttime exemption. A full-day kitchen assignment blocks guard duty
  throughout that day and night; an 08:00–14:00 assignment does not block the night.
- Update agenda, statistics, text, CSV, calendar exports, and sharing to preserve
  daily identity and occurrence boundaries.

## Plan 4: output checks

- Check double-booking, capacity, mission/availability bounds, local slot
  containment, whole remote/daily holds, and timeline coverage.
- Retain documented pin availability overrides. Missing staff and violated rest
  targets are input/quality findings, not engine bugs.
- Add strict checking by default and explicit report mode for the schedule
  screen. Keep copying the source plan available on errors; generated exports
  require an available result.
- Do not freeze invariant-invalid output into historical pins; preserve the
  existing fallback when validation fails.
- Aggregate quality warnings. Count distinct slots/occurrences rather than
  fragmented rows; apply the existing pinned-row exemption to ordinary adjacency
  warnings.

## Plan 5: qualifications and rest

- Add plan-level qualification records, employee tags, mission requirement counts,
  and excluded tags; serialize and prune references consistently.
- Requirements mean qualified-person coverage within existing headcount. One
  person can satisfy different qualifications, but counts for any individual
  qualification require distinct people.
- Prefer separate people for required roles when feasible. Fall back to combined
  roles, including driver/commander; do not add forbidden-pair configuration.
- Select crews using deterministic coverage feasibility checks, respecting pins
  and exclusions before strategy tie-breakers. Include already-pinned crew in
  coverage calculations.
- If complete coverage is impossible, maximize fulfilled requirements, fill
  remaining eligible capacity, and report unmet qualifications without inventing
  credentials or extra seats.
- Treat nightly rest as a preferred continuous off-duty target. Attempt
  rest-preserving staffing first; allow automatic rest violations when needed to
  staff duties and report actual shortfalls prominently.
- Keep rest separate from work accounting. For multiple rest-bearing tags, use
  the largest target. Partial nights receive an explicit incomplete-assessment
  finding rather than a false guarantee.
- Show qualification coverage per shift and aggregate shortages/rest violations
  without an alert wall. Manual exclusion overrides remain visible.

## Validation

- Cover full-day, overnight, DST, and clipped occurrences; repeated daily pins;
  partial-pin swaps; stale cleanup; mixed grids; and daily fairness under both
  strategies.
- Cover combined qualifications, distinct-person counts, scarce candidates,
  pinned coverage, exclusions, insufficient qualifications, and staffing despite
  rest shortfalls.
- Test each invariant using deliberately malformed output; verify error display,
  sharing, and freeze behavior.
- Preserve existing golden fixtures without regeneration. Extend property tests
  with daily missions, contested pins, and qualifications.
- Run `npm run lint`, `npm test`, `npm run build`, and existing browser/mobile
  checks headlessly, including 360px portrait and 24-hour time display.
- Update existing plan statuses and PR #28's description to match delivered
  behavior. Record the clarified daily-time, combined-role, and rest-fallback
  rules in `AGENTS.md` during implementation.

## Small-task execution order

Each task must touch at most three files; subdivide before editing if needed.
Keep feature-specific tests with the subsystem they exercise.

1. Save this approved plan, then reconcile the existing planning documents in
   batches of at most three documents.
2. Daily schema and occurrence adapter with tests; daily URL encoding with tests.
3. Daily hold placement with tests; daily strategy ordering with tests.
4. Daily pin normalization with tests; pin editing and freezing with tests.
5. Daily mission controls and localized copy; agenda and export integration in
   separate batches; browser/property coverage.
6. Pure output checker with malformed-output tests; engine integration; schedule
   error handling and freezing integration; generated invariant coverage.
7. Qualification schema and reference editing with tests; URL encoding with tests.
8. Qualification crew selection with tests; rest preference and assessment with
   tests; engine integration in separate batches.
9. Qualification management UI; employee/mission controls; agenda and export
   integration in separate batches; browser/property coverage.
10. Run final validation, review risks and regressions, update status documents,
    commit and push to PR #28, and update its description.
