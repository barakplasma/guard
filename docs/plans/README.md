# Architecture decision records

These ADRs describe the implemented scheduling design, plus the alternatives
considered and turned down. The historical `docs/plans` directory and filenames
remain stable for existing references; these documents are decision records, not
pending implementation plans.

| ADR | Decision |
|-----|----------|
| [001](01-whole-mission-pin-on-local-mission.md) | Represent local pins within rotation slots. |
| [002](02-per-mission-shift-length.md) | Give each local mission an explicit rotation grid. |
| [003](03-daily-missions-and-per-job-rotation.md) | Hold daily missions by calendar occurrence. |
| [004](04-schedule-constraints.md) | Independently validate generated schedules. |
| [005](05-qualifications-and-tags.md) | Select qualified crews with preferred night rest. |
| [006](06-approved-continuation.md) | Extend shared plan URLs without reordering existing fields. |
| [007](07-on-call-missions.md) | Count on-call missions toward night rest. |
| [008](08-history-and-staffing-bugs.md) | Three defects to fix regardless of any refactor. *(Proposed)* |
| [009](09-timeline-split.md) | Log the past, schedule only the future. *(Proposed)* |
| [010](10-plan-storage.md) | Keep the plan in the URL, in the fragment. *(Proposed)* |
| [011](11-solver-selection.md) | If a solver, then Pumpkin. *(Proposed)* |
| [012](12-planning-horizon.md) | Plan 72 hours at a time, rolled forward. *(Proposed)* |
| [013](13-replanning-under-churn.md) | Continuous re-planning is the operating model. *(Proposed)* |
| [014](14-exclusions-and-flexibility.md) | Exclude individuals; keep scarce people free. *(Proposed)* |

Each record states the context, decision, consequences, rejected alternatives,
and implementation or test evidence. Acceptance dates record this design, not a
claim about deployment. Superseding decisions should identify the affected ADR.
ADRs 001-007 are implemented. **008-011 are proposed**, and are split so each
can be taken or left on its own:

- **008** is the bug list, and stands alone. A headcount edit rewrites history,
  history outside the period becomes unreachable, and the staffing pass reports
  shortages that are not real. Worth fixing whether or not 009-011 happen.
- **009** fixes the first two structurally by never scheduling elapsed time.
  No dependency, no storage change, no solver. **This is the one to do first.**
- **010** is where the growing log is kept. It concludes the plan should stay in
  the URL, moved from the query string to the fragment, with local-first held in
  reserve.
- **011** is the solver question that started all of this. It closes 008's third
  defect and depends on 009.
- **012** records the 72-hour horizon and what it does to the others: it settles
  010 (the fragment is enough, local-first is not needed), sizes 011 at 648
  assignments, and raises 008's second defect to the main path because rolling
  the window forward is the normal operation. It leaves one question open -
  whether history is retained across rolls - **which should be answered before
  009 is implemented.**
- **013** records that the rota is re-solved continuously against a moving
  present, not planned once. That re-rates 008's third defect from rare to
  daily and makes **011 urgent rather than optional**.
- **014** adds per-person exclusions, which the document cannot express at all
  today, and the softer rule that scarce qualifications should be kept
  uncommitted so they can answer a callout. The first half needs no solver; the
  second is an objective term and waits for 011.

Suggested order: **009** first (fixes the history corruption, no dependencies),
then **010** and the first half of **014** (both small and independent), then
**011**, which closes the shortage bug that fires daily.

## Verification

Run `npm run lint`, `npm test`, and `npm run build`. ADR 008's defects are
reproduced with `node scripts/historyDriftCheck.mjs` (defects 1 and 2) and
`node scripts/completenessSearch.mjs` (defect 3); both are measurements rather
than tests and are deliberately outside `npm test`. Browser acceptance uses
`tests/e2e.mjs`, `tests/mobile-viewports.mjs`, and `tests/features.e2e.mjs`
against a local built preview. Set `CHROME` to a headless Chromium binary and
`SHOT_DIR` outside the repository.
