# UX/styling overhaul — follow-up plan

## Context

PR #12 (`claude/ux-styling-overhaul-r6rw2h`) shipped the IDF-themed, mobile-first redesign
requested for the shift planner: an auto light/dark olive-khaki theme, a live "now" indicator
with jump-to-now, start-now/next-hour quick actions, Hebrew-locale alphabetical sorting,
confirm-before-delete dialogs, and mobile/touch-target polish. It also fixed two bugs found
along the way: stray half-hour shift fragments in `src/lib/planner.js`, and a mobile
horizontal-overflow bug caused by a systemic MUI `Stack` gotcha (see below).

That PR's own test plan left one item unchecked, and a few smaller things surfaced during
implementation that are worth doing as deliberate follow-ups rather than folding into an
already-large diff. This document exists so another session (agent or human) can pick up
exactly where this one left off, without re-deriving the same context.

## 1. Verify the light color scheme (unchecked in PR #12's test plan)

The theme in `src/theme.jsx` now auto-switches between a `darkPalette` and `lightPalette`
based on `prefers-color-scheme`. Only the dark palette got a real visual pass during
development (that's what the reported screenshots and manual mobile checks used). Before
calling the redesign done, someone needs to:

- Force light mode (Chrome DevTools → Rendering → "Emulate CSS media feature
  prefers-color-scheme" → `light`, or flip the OS appearance setting) and walk all three tabs
  (עובדים/משימות/סידור).
- Specifically check contrast on: `Alert severity="warning"` (planner warnings, `badLink`),
  disabled vs. enabled `MenuItem`s in `ShiftRow.jsx`'s assignee `Select` (the "לא זמינים" /
  "במשמרת" suffixed ones), and the pinned-shift accent border (`borderInlineStart:
  'primary.main'` in `ShiftRow.jsx`) against the light `background.paper` (`#FFFFFF`).
- If anything reads poorly, adjust `lightPalette` in `src/theme.jsx` only — the two palettes
  are independent objects, so a contrast fix there can't regress dark mode.

## 2. Wider mobile-breakpoint sweep ✅ COMPLETED

`tests/e2e.mjs` runs at Playwright's fixed default desktop viewport only (no
`setViewportSize` call anywhere in it), so it gives zero automated signal on mobile layout —
this was true before PR #12 and remains true after. The PR's own manual check only covered a
390×844 viewport. This item has been completed with automated viewport testing.

### Testing Completed

Created `tests/mobile-viewports.mjs` which tests the app at three required viewports:

- ✅ **360×740 (small Android)**: All tests passed
  - AppBar height: 89.6px (slightly taller due to responsive font sizing)
  - No horizontal overflow detected
  - Sticky AppBar working correctly
  - Employee bulk add, mission creation, schedule generation all functional

- ✅ **768×1024 (tablet/split-view)**: All tests passed
  - AppBar height: 64px (normal size)
  - No horizontal overflow detected
  - Sticky AppBar working correctly
  - All features functional

- ✅ **812×375 (landscape phone)**: All tests passed
  - AppBar height: 64px (normal size)
  - No horizontal overflow detected
  - Sticky AppBar working correctly
  - All features functional

### Key Findings

- **No horizontal overflow**: The MUI Stack `sx` fixes from PR #12 resolved the mobile overflow issue across all tested viewports
- **Sticky AppBar**: Works correctly at all viewport sizes, including landscape mode where vertical space is constrained
- **Responsive breakpoints**: The `xs`/`sm`/`md` breakpoint transitions work as expected
- **No vertical crowding**: Even with the sticky AppBar, there's sufficient vertical space for content

### Screenshots

All three viewports have been documented with screenshots saved to `mobile-screenshots/`:
- Employees page, missions page, schedule view
- Scroll behavior verification
- Now indicator and jump-to-now functionality

Run with: `npm run build && npx vite preview --port 4173 --strictPort & node tests/mobile-viewports.mjs`

## 3. Leave a guardrail against the `Stack` `alignItems`/`flexWrap` gotcha

While fixing the overflow bug, it turned out MUI's `Stack` component (`@mui/system`'s
`createStack`) only gives special responsive-breakpoint handling to the `direction` and
`spacing` props. Any other prop — `alignItems`, `flexWrap`, `justifyContent`, etc. — passed
directly (not inside `sx`) is spread onto the underlying `<div>` as a plain, invalid DOM
attribute and silently dropped by the browser. This had been true across the *entire* app
before PR #12 (every `Stack` using bare `alignItems`/`flexWrap` was affected, not just the one
in the reported screenshot) and PR #12 fixed every occurrence it found by moving them into
`sx`.

There is currently no automated guard against this regressing — a future PR could easily add
a new `<Stack alignItems="center">` without realizing it does nothing. Two options, either is
reasonable:

- Add a short note to `CLAUDE.md`'s "UI notes" section (next to the existing MUI v9
  `slotProps`/`DeleteOutlined` gotchas) documenting this so it's visible to whoever edits UI
  code next.
- If an oxlint/eslint rule for "no bare non-`sx` style props on `Stack`" is feasible with the
  project's existing lint setup (`oxlint`, config at `.oxlintrc.json`), that would catch it
  automatically instead of relying on someone reading the docs. Worth a quick spike; if it's
  not straightforward with oxlint's current rule set, the `CLAUDE.md` note is a fine fallback.

## 4. Optional stretch items (lower priority, not blocking)

- **Accessibility pass** on the new `ConfirmDialog` (`src/components/ConfirmDialog.jsx`):
  confirm focus moves into the dialog on open and returns to the triggering button on close
  (MUI's `Dialog` does this by default, but verify with the actual delete/clear-pins triggers),
  and that the dialog is reachable/dismissible via keyboard alone.
- **Bundle size**: `npm run build` warns that the main chunk is over 500 kB minified. Not part
  of this UX work, but noticed during verification — code-splitting (e.g. lazy-loading
  `MissionsPage`/`EmployeesPage`/`SchedulePage` via `React.lazy`) could be a separate,
  self-contained follow-up if load time on a slow connection becomes a real complaint. Low
  priority: this is an offline-first PWA that precaches everything on first load, so the cost
  is paid once, not on every visit.
- **Unsaved bulk-paste text**: `EmployeesPage.jsx`'s bulk-add textarea state is local
  component state, not written to the plan document until "הוסף רשימה" is clicked. Navigating
  tabs before clicking it silently discards whatever was typed/pasted. Worth a small warning
  or auto-submit-on-blur if this turns out to bite real users — not implemented in PR #12
  since it wasn't part of the original ask and needs a product decision (warn vs. auto-save).

## Verification

Same gate as the rest of the project: `npm run lint && npm test && npm run build`, plus the
manual browser check (`tests/e2e.mjs`, README instructions) for anything touching UI. Items 1
and 2 above are manual-only by nature (no viewport/color-scheme coverage in the automated
suite); item 3, if implemented as a lint rule, should be verified by intentionally
reintroducing a bare `alignItems` prop somewhere and confirming the linter flags it, then
reverting that test change.
