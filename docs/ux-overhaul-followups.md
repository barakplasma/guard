# UX verification and remaining follow-ups

This document records verification coverage and unresolved review items. Accepted
scheduling design decisions live in the [ADR index](plans/README.md).

## Implemented guardrails

- `tests/mobile-viewports.mjs` checks 360×740, 768×1024, and 812×375 viewports,
  including overflow and basic employee/mission/schedule flows.
- `tests/features.e2e.mjs` covers the daily and qualification controls at 360px
  and desktop widths, sharing, findings, and corrupt-link edit isolation.
- `CLAUDE.md` documents MUI Stack styling through `sx`, wrapping layouts, and
  `slotProps` integration. No dedicated lint rule for those layout conventions
  is claimed.

Run the headless checks using the [README instructions](../README.md). Screenshots
are runtime artifacts in the chosen `SHOT_DIR`, not a committed screenshot archive.

## Remaining review items

- **Light-theme contrast:** the earlier redesign left a focused light-palette
  review unverified. Emulate `colorScheme: 'light'` in headless Playwright and
  inspect warnings, disabled options, and pinned accents on all tabs. Passing
  layout tests does not establish contrast compliance.
- **Keyboard and focus:** verify delete/clear confirmation dialogs receive focus,
  dismiss by keyboard, and return focus to their trigger. Include qualification
  deletion and multi-select controls.
- **Bundle size:** the production build reports a main chunk above 500 kB.
  Evaluate initial-load impact before deciding whether route splitting is useful;
  offline caching does not remove the first-download cost.
- **Unsubmitted roster text:** bulk-entry drafts are component state until the
  user adds the list. A policy for retaining drafts across navigation remains
  a separate product decision.

These are review items, not claims of newly reproduced defects or instructions
to change working behavior without first establishing the problem.
