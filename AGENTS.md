# Repository agent guidance

- Changes may span as many files as the task's clean design requires; do not impose an arbitrary three-file limit.

## Scheduling decisions confirmed by the user

- Daily mission times use 24-hour notation. Equal times, such as 08:00–08:00,
  mean duty until the next day, not an empty interval.
- Daily assignments block other duties only during their actual hours; do not
  infer an additional night exemption for short kitchen assignments.
- Prefer different people for required qualifications, but allow one person to
  cover multiple roles when needed, including driver and commander.
- Night rest is preferred, not a staffing veto: fill duties when rest cannot be
  preserved and clearly report actual rest shortfalls.
- Resolve daily wall-clock times in the viewer's timezone, matching night windows.
- Continue scheduling work on the branch used by PR #28.
