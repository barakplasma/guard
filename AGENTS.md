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
- Continue scheduling work on the branch used by PR #28.

- Prioritize current Android Chrome on Pixel 10 for input UX. Native number spinners and desktop viewport screenshots do not prove usable phone controls; use explicit touch buttons and verify taps.

- Prefer the Material UI components already installed (`@mui/material` and `@mui/icons-material`) whenever practical. For numeric inputs, use the shared MUI Number Spinner composition backed by Base UI rather than custom controls or native spinner styling.
