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
| [009](09-timeline-split.md) | Log the past, schedule only the future. *(Partly implemented)* |
| [010](10-plan-storage.md) | The plan stays in the URL, where it already is. *(Accepted)* |
| [011](11-solver-selection.md) | MiniZinc as the one engine, on HiGHS. *(Accepted, provisionally)* |
| [012](12-planning-horizon.md) | Plan 72 hours at a time, rolled forward. *(Proposed)* |
| [013](13-replanning-under-churn.md) | Continuous re-planning is the operating model. *(Proposed)* |
| [014](14-exclusions-and-flexibility.md) | Exclude individuals; keep scarce people free. *(First half implemented)* |

Each record states the context, decision, consequences, rejected alternatives,
and implementation or test evidence. Acceptance dates record this design, not a
claim about deployment. Superseding decisions should identify the affected ADR.
ADRs 001-007 are implemented. **011 is accepted provisionally and 012's
retention question is decided; the rest are proposed**, and are split so each can
be taken or left on its own:

- **008** is the bug list, and stands alone. A headcount edit rewrote history
  (**fixed**), history outside the period was silently deleted (**fixed**) and
  is still not displayable (open), and the staffing pass reports shortages that
  are not real (partly fixed by #40).
- **009** fixes the first two by never re-deciding elapsed time. Its core rule
  is **implemented**: the clock enters at the adapter as an absolute instant,
  an elapsed segment carrying a record defers to it, and the headcount cap stops
  applying there. The log as its own structure, and 012's export, remain.
- **010** is where the growing log is kept. An earlier revision claimed the plan
  was a query parameter and had to move to the fragment; it was already there,
  because the app uses `HashRouter`. **Nothing to build.** The correction is in
  the record, along with what the real ceiling is and why local-first stays
  dormant.
- **011** is the solver question that started all of this. **MiniZinc**,
  accepted "for now", on ownership and failure surface rather than solving
  technology. The prototype now exists in `prototype/minizinc/` and has already
  corrected the record twice. It agrees with a brute-force oracle over 420
  random instances and finds a full crew on 2.8% of the instants the shipped
  engine calls short, independently reproducing `offGridFuzz.mjs`'s figure -
  and it showed that **Chuffed, which this ADR named explicitly, is the wrong
  backend**: it stops proving optimality past a four-hour horizon, where HiGHS
  in the same WebAssembly bundle proves a perfectly balanced 72-hour schedule in
  under eight seconds.
- **012** records the 72-hour horizon and what it does to the others: it settles
  010 (the fragment is enough, local-first is not needed), sizes 011 at 648
  assignments, and raises 008's second defect to the main path because rolling
  the window forward is the normal operation. Its retention question is
  **decided: a rolled-past window is exported**, which bounds the log to one
  window and makes the export the only durable record - raising the bar on it,
  since a roll that completes without a successful export is data loss.
- **013** records that the rota is re-solved continuously against a moving
  present, not planned once. That re-rated 008's third defect from rare to the
  main path, which #40 then addressed for the reported shape.
- **014** adds per-person exclusions - **implemented**, at wire position 14,
  with one shared `isExcluded` predicate replacing five copies of the tag check
  - and the softer rule that scarce qualifications should be kept uncommitted so
  they can answer a callout. That second half is an objective term and waits for
  011.

Suggested order, updated now that 009's core rule has landed:

1. ~~012's export plus 008's defect 2~~ - **the data loss is closed.** Nothing
   removes recorded duty automatically, and the out-of-period button exports
   before it clears. What remains is showing elapsed assignments outside the
   period read-only, which is no longer urgent.
2. ~~010's fragment move~~ (not needed - already in the fragment) and
   ~~014's first half~~ (**done** - per-person exclusions).
3. **011** - the MiniZinc model, which closes the shortage class #40 narrowed
   but did not eliminate. **The model itself is prototyped and measured**
   (`prototype/minizinc/`): oracle-checked, and it finds the crews the engine
   misses. Its `invariants.js` prerequisite is **partly done**:
   `UNREPORTED_SHORTFALL` and `PIN_DROPPED` now catch a schedule that is short
   without saying so, or that quietly loses an accepted pin. Rest-score
   correctness, fairness optimality and false UNSAT still need an oracle rather
   than an invariant.
4. ~~011's adapter~~ - **done** (`prototype/minizinc/fromPlan.mjs`), which is
   what made the horizon measurement possible. It imports `segmentGrid`,
   `acceptedPins` and `countAt` from the engine rather than re-deriving any of
   them.
5. **011's browser path** is what is now in front, and it is the last acceptance
   criterion nothing has touched. Everything measured so far spawns a native
   binary; shipping means a WebAssembly worker, assets the service worker has to
   cache, and a phone. The model's remaining levels - history, rest, rotation
   turn counting - are the other half, and are modelling work rather than
   measurement.

## Verification

Run `npm run lint`, `npm test`, and `npm run build`. ADR 008's defects are
reproduced with `node scripts/historyDriftCheck.mjs` (defects 1 and 2) and
`node scripts/rollForwardLoss.mjs` (defect 2 under ADR 012's export decision),
and `node scripts/completenessSearch.mjs` with `node scripts/offGridFuzz.mjs`
(defect 3, before and after #40); all are measurements rather than tests and are
deliberately outside `npm test`. ADR 011's model is measured by
`node prototype/minizinc/check.mjs` and `node prototype/minizinc/vsEngine.mjs`,
which need a `minizinc` binary on `PATH` and are outside `npm test` for that
reason. Browser acceptance uses
`tests/e2e.mjs`, `tests/mobile-viewports.mjs`, and `tests/features.e2e.mjs`
against a local built preview. Set `CHROME` to a headless Chromium binary and
`SHOT_DIR` outside the repository.
