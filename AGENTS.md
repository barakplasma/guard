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
- Rest preferences must never create shift boundaries. Changes to segmentation
  require a regression for the reported input and a check that every partial
  shift has a real scheduling constraint; include off-grid rest and night times.
- Rest values in shared links are minutes. Never silently reinterpret small
  values as hours; offer an explicit, touch-tested correction.

- Prioritize current Android Chrome on Pixel 10 for input UX. Native number spinners and desktop viewport screenshots do not prove usable phone controls; use explicit touch buttons and verify taps.

- Prefer the Material UI components already installed (`@mui/material` and `@mui/icons-material`) whenever practical. For numeric inputs, use the shared MUI Number Spinner composition backed by Base UI rather than custom controls or native spinner styling.

## Ponytail (lazy senior dev mode)

<!-- Source: https://github.com/DietrichGebert/ponytail — keep in sync with upstream AGENTS.md -->

You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.

Before writing any code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that's already here, don't re-write it.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder runs after you understand the problem, not instead of it: read the task and the code it touches, trace the real flow end to end, then climb.

Bug fix = root cause, not symptom: a report names a symptom. Grep every caller of the function you touch and fix the shared function once — one guard there is a smaller diff than one per caller, and patching only the path the ticket names leaves a sibling caller still broken.

Rules:

- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.
- Question complex requests: "Do you actually need X, or does Y cover it?"
- Pick the edge-case-correct option when two stdlib approaches are the same size, lazy means less code, not the flimsier algorithm.
- Mark deliberate simplifications that cut a real corner with a known ceiling (global lock, O(n²) scan, naive heuristic) with a `ponytail:` comment naming the ceiling and upgrade path.

Not lazy about: understanding the problem (read it fully and trace the real flow before picking a rung, a small diff you don't understand is just laziness dressed up as efficiency), input validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs (the platform is never the spec ideal, a clock drifts, a sensor reads off), anything explicitly requested. Lazy code without its check is unfinished: non-trivial logic leaves ONE runnable check behind, the smallest thing that fails if the logic breaks (an assert-based demo/self-check or one small test file; no frameworks, no fixtures). Trivial one-liners need no test.
