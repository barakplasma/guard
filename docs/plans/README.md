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
| [008](08-minizinc-js-evaluation.md) | Split the timeline: log the past, solve the future. *(Proposed)* |

Each record states the context, decision, consequences, rejected alternatives,
and implementation or test evidence. Acceptance dates record this design, not a
claim about deployment. Superseding decisions should identify the affected ADR.
ADR 008 is proposed rather than implemented. It names two open defects - an
edit to a mission's headcount rewrites history, and the staffing pass is not
complete - and recommends splitting the timeline so the past is never
recomputed.

## Verification

Run `npm run lint`, `npm test`, and `npm run build`. ADR 008's measurements are
reproduced with `node scripts/historyDriftCheck.mjs` and
`node scripts/completenessSearch.mjs`; both are measurements rather than tests
and are deliberately outside `npm test`. Browser acceptance uses
`tests/e2e.mjs`, `tests/mobile-viewports.mjs`, and `tests/features.e2e.mjs`
against a local built preview. Set `CHROME` to a headless Chromium binary and
`SHOT_DIR` outside the repository.
