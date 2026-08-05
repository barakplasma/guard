# Repository notes

A static, backend-free shift planner. See `README.md` for what it does and how to run it.

## Ground rules

- **No backend, ever.** No server calls, no database, no auth. If a feature seems to need one, it
  belongs in the URL or it does not belong here.
- **No network at runtime.** No webfonts, no CDNs, no analytics. The app must work offline after
  first load; anything fetched at runtime breaks that.
- **The engine stays pure.** `src/lib/planner.js` imports nothing, touches no DOM, and calls
  neither `Date.now()` nor `Math.random()`. Every sort ends in a stable id tiebreak. A shared link
  must render identically for everyone who opens it, forever.

## Working on the scheduler

The schedule is a pure function of the plan document. Never store generated shifts — recompute
them. Manual assignments are recorded as **pins** in the document and fed back in as engine input,
which is why a hand-edit survives sharing and why swapping one person frees the other to be
rescheduled fairly.

Infeasible input (not enough people) returns `warnings` plus a partial plan. Only structurally
invalid input throws — someone mid-edit needs to see what is short, not a stack trace.

A pin with a null `start`/`end` inherits the mission's window, which inherits the plan's. So a
whole-mission assignment and a per-shift one can describe the same time while looking nothing
alike: **match pins by coverage, never by literal range**. Both bugs found in review came from
that. Pin edits live in `src/lib/pins.js`, deliberately pure and outside the React context so the
rule stays testable. On a remote mission a pin always means the whole mission — a partial range can
survive a local→remote toggle, and honouring it literally leaves the rest of the window short.

`tests/planner.invariants.test.js` is the real safety net: it asserts across ~1600 generated plans
that nobody is ever double-booked, no mission is overstaffed, availability is respected, and the
same input always gives the same output. Do not weaken it to make a change pass.

## Changing the plan document

`src/lib/planSchema.js` and `src/lib/urlState.js` move together. The encoded form is positional
tuples, so **field order is part of the wire format** — appending is safe, reordering or inserting
is not. Bump `SCHEMA_VERSION` when the shape changes; `decodePlan` rejects unknown versions rather
than misreading them.

Fields may be blank while someone is typing. The schema must tolerate a half-filled row: a
validation error there takes down the whole document, which is the user's only copy.

## UI notes

- Hebrew only, RTL. All copy goes in `src/strings.js` — no inline literals.
- MUI v9: use `slotProps={{ htmlInput: … }}`. The old `inputProps` is silently ignored, which
  quietly drops `data-testid` attributes and breaks `tests/e2e.mjs`.
- The icon is `DeleteOutlined`, not `DeleteOutline` — v9 renamed several.
- Navigation must carry `location.search` along; dropping it discards the user's entire plan.

## Before delivering

```bash
npm run lint && npm test && npm run build
```

For anything touching the UI, exports, sharing, or offline behaviour, also run the browser check
(`tests/e2e.mjs`, instructions in `README.md`) — several bugs found during development were
invisible to the unit tests: MUI dropping test ids, a zod schema rejecting a freshly added mission,
and a 24-hour remote mission rendering as `22:00–22:00`.

`lz-string` is CommonJS: import it as a default and destructure, or the Node test run breaks while
the Vite build keeps working.
