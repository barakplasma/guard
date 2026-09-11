# Repository agent guidance

- Changes may span as many files as the task's clean design requires; do not impose an arbitrary three-file limit.

## Scheduling decisions confirmed by the user

- Daily mission time pickers use the device locale; stored times use minutes past midnight. Equal times, such as 08:00–08:00,
  mean duty until the next day, not an empty interval.
- Daily assignments block other duties only during their actual hours; do not
  infer an additional night exemption for short kitchen assignments.
- Prefer different people for required qualifications, but allow one person to
  cover multiple roles when needed, including driver and commander.
- Night rest is preferred, not a staffing veto: fill duties when rest cannot be
  preserved and clearly report actual rest shortfalls.
- Resolve daily wall-clock times in the viewer's timezone, matching night windows.
- Schedule work continues on `main`; the old PR #28 branch is gone.
- Manual assignments must always win over automatic scheduling; show them with a lock icon. Automatically preserved elapsed assignments must use a distinct history icon and require an explicit correction before replacement.
- Night rest is measured two ways inside the configured night hours: **total**
  rest (the configured per-qualification minimum is enforced and reported
  against the total - split sleep, such as 3+3 hours, satisfies it) and
  **longest uninterrupted** rest (reported as a metric, never as the enforced
  minimum). On-call duties the person can sleep through keep counting as rest.
- Staffing priority ladder: staffing and qualification coverage first, then the
  configured total-rest minimum (6 hours for drivers by default), then the 8
  total hours / 6 continuous hours preferences, then ordinary fairness. A
  non-driver taking the post so the driver keeps their minimum beats fairness;
  unavoidable shortfalls are reported with actual numbers.
- When a required qualification goes unmet, generated assignments are repaired
  automatically (the repair must leave the whole schedule strictly better);
  preserved history changes only through an accepted proposal that names the
  driver, the affected assignments, and the rest impact. A manual assignment is
  never replaced - the engine explains the blocker instead.

- Prioritize current Android Chrome on Pixel 10 for input UX. Native number spinners and desktop viewport screenshots do not prove usable phone controls; use explicit touch buttons and verify taps.

- Prefer the Material UI components already installed (`@mui/material` and `@mui/icons-material`) whenever practical. For numeric inputs, use the shared MUI Number Spinner composition backed by Base UI rather than custom controls or native spinner styling.
