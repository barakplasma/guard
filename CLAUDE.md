# Repository notes

A static, backend-free shift planner. See `README.md` for what it does and how to run it.

## Ground rules

- **No backend, ever.** No server calls, no database, no auth. If a feature seems to need one, it
  belongs in the URL or it does not belong here.
- **No network at runtime.** No webfonts, no CDNs, no analytics. The app must work offline after
  first load; anything fetched at runtime breaks that.
- **The engine stays pure.** `src/lib/planner.js` and `src/lib/strategies.js` import nothing
  outside each other, touch no DOM, and call neither `Date.now()` nor `Math.random()`. Every sort
  ends in a stable id tiebreak. A shared link must render identically for everyone who opens it,
  forever.

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

A shift whose window has already closed must never change hands because of an unrelated later
edit — the engine has no notion of "past" (see the `Date.now()` rule above), so nothing stops a
new employee or a widened availability window from silently reshuffling history unless something
locks it in. `PlanContext`'s `setDoc` does that by running `freezeElapsedBeforeEdit`
(`src/lib/pins.js`) on every mutation, before the edit is applied: whatever the engine had already
decided for an already-elapsed, auto-assigned shift becomes a real pin, indistinguishable from one
a person swapped by hand. This has to sit in `setDoc`, not a `SchedulePage` render effect — every
mutator (`addEmployee`, `updateMission`, a swap, …) funnels through it, so an edit made from the
Employees or Missions page freezes history exactly like one made from the schedule screen. The
freeze snapshot is taken from the *previous* document, not the one the edit produces: a shift
already pinned in the previous document is left alone, which is what lets clearing a frozen pin
actually stick instead of being immediately re-pinned by the same edit. That is deliberate — a
frozen shift stays swappable and clearable like any other pin, because the point is to let someone
correct the record to match reality, not to make the past read-only.

Freezing means the document only grows, and rolling the period forward strands that history
outside the window. Those pins are *residue*, not errors: the engine ignores them, so they are
counted once as `PIN_OUT_OF_PERIOD` rather than reported one per pin — a rota carried across a
few days accumulates dozens, and a wall of "cannot be honoured" alerts reads as a scheduler
malfunction. `isOutOfPeriod` (`planner.js`) is the shared predicate, and it answers **no** for a
remote mission whatever the range says: a pin there means the whole mission, so its written
range is not honoured and cannot strand it — reading it literally would let the cleanup delete a
pin that is actively staffing something.

Cleanup comes in two halves, and the asymmetry is deliberate. `clearStalePins` is the button:
explicit, and it takes both sides of the window. `pruneStalePins` runs inside `setDoc` and is
much more timid — it declines entirely when the edit moves `start`/`end`, because the date
fields emit an edit on every intermediate value that parses and a half-typed year would take
real history with it, unrecoverably (`setDoc` navigates with `replace`; there is no way back).
It also only ever drops pins that finished *before* the period starts: a pin past the end is
one the user is probably about to extend to cover.

### Strategies

*Who* gets a given slot is the one decision the engine delegates. `planner.js` works out who is
eligible — availability, existing bookings, mission windows, pins — and hands the candidates to a
strategy from `src/lib/strategies.js` to rank. Everything else is policy-free and must stay that
way: a new strategy should never need a change in `planner.js`.

`balanced` (the default, and what every link written before the setting existed means) evens out
total time on duty. `rotation` is a fixed circular list: guards take turns round it in document
order, and hours are never consulted, so a twelve-hour remote mission and a one-hour slot each
cost exactly one turn. Under `rotation` a large `spreadMinutes` is the expected outcome, not a
bug — `stints` is the column that means something there.

Rotation ranks on **rest time first**, turn count second. That order is load bearing, not a
preference: a stint spanning several slots is one unbroken run, so its turn count does not rise
while it is in progress, and ranking on turns first lets whoever starts a block hold the post
indefinitely. Both keys are also measured *as of the slot being filled* rather than from a running
counter — the engine places pins first, then remote missions, then local slots chronologically, so
a counter would let a pin for a late-evening shift push its holder to the back of the ring before
the morning slots were even assigned.

`tests/planner.invariants.test.js` is the real safety net: it asserts across ~1600 generated plans
that nobody is ever double-booked, no mission is overstaffed, availability is respected, and the
same input always gives the same output. Do not weaken it to make a change pass.

## Changing the plan document

`src/lib/planSchema.js` and `src/lib/urlState.js` move together. The encoded form is positional
tuples, so **field order is part of the wire format** — appending is safe, reordering or inserting
is not. Bump `SCHEMA_VERSION` when the shape changes; `decodePlan` rejects unknown versions rather
than misreading them.

A *new plan-level field* does not need a version bump and should not get one: add a new short key
to the compact object and give the schema field a `.default(...)`, so links written before it
existed still parse and keep their old meaning (`strategy` is the worked example). Bumping the
version invalidates every link already shared, and there is no migration path. Whatever you add,
pass it through `toPlannerInput` too — that adapter is the only route into the engine, and a field
missed there is silently inert.

Fields may be blank while someone is typing. The schema must tolerate a half-filled row: a
validation error there takes down the whole document, which is the user's only copy.

## UI notes

- Hebrew only, RTL. All copy goes in `src/strings.js` — no inline literals.
- MUI v9: use `slotProps={{ htmlInput: … }}`. The old `inputProps` is silently ignored, which
  quietly drops `data-testid` attributes and breaks `tests/e2e.mjs`.
- The icon is `DeleteOutlined`, not `DeleteOutline` — v9 renamed several.
- Navigation must carry `location.search` along; dropping it discards the user's entire plan.
- MUI `Stack` component only gives special responsive handling to `direction` and `spacing` props.
  Style props like `alignItems`, `flexWrap`, `justifyContent` MUST go in `sx`, not as bare props.
  Bare props are spread as invalid DOM attributes and silently dropped by the browser.
- A wrapping row must space itself with `gap` (`useFlexGap` on a `Stack`, or a plain flex `Box`).
  `Stack`'s default margin-based `spacing` offsets whatever falls to the second line, so wrapped
  chips and buttons land on top of the row below.
- The agenda is a table from `sm` up and, below it, a time gutter with the missions beside it
  (`AgendaDay.jsx`, switched with `useMediaQuery`). Only one of the two is mounted, which is what
  keeps the `data-testid`s unique — do not render both and hide one with CSS. Both failure modes
  are real: four table columns on a 360px phone truncated the mission name to a single letter and
  spilled the times over it, while a card per slot cost a screenful per hour. Portrait density is
  the constraint to design against — a day is 24 of these rows.
- `sx` maps palette tokens for `borderColor` only. `borderInlineStartColor: 'primary.main'` is
  emitted as an invalid colour and dropped — resolve it via a callback (`(theme) => …`).

## Before delivering

```bash
npm run lint && npm test && npm run build
```

For anything touching the UI, exports, sharing, or offline behaviour, also run the browser check
(`tests/e2e.mjs`, instructions in `README.md`) — several bugs found during development were
invisible to the unit tests: MUI dropping test ids, a zod schema rejecting a freshly added mission,
and a 24-hour remote mission rendering as `22:00–22:00`.

For layout changes run `tests/mobile-viewports.mjs` too (same server, three phone/tablet
viewports). It fails on horizontal overflow and on any table cell whose content is wider than its
column — the shape of every mobile layout bug reported so far.

`lz-string` is CommonJS: import it as a default and destructure, or the Node test run breaks while
the Vite build keeps working.
