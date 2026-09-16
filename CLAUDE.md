# Repository notes

A static, backend-free shift planner. See `README.md` for what it does and how to run it.

## Ground rules

- **No backend, ever.** No server calls, no database, no auth. If a feature seems to need one, it
  belongs in the URL or it does not belong here.
- **No network at runtime.** No webfonts, no CDNs, no analytics. The app must work offline after
  first load; anything fetched at runtime breaks that.
- **The engine stays pure.** `src/lib/planner.js`, strategies, and the pure crew/rest/invariant helpers import no UI, network, or clock dependencies, touch no DOM, and call neither `Date.now()` nor `Math.random()`. Every sort
  ends in a stable id tiebreak. Identical absolute engine inputs must produce identical results. The adapter
  resolves daily and night windows in the viewer's timezone (ADR 003).

## Working on the scheduler

The schedule is a pure function of the absolute input resolved from the plan document. Never store generated shifts — recompute
them. Manual assignments are recorded as **pins** in the document and fed back in as engine input,
which is why a hand-edit survives sharing and why swapping one person frees the other to be
rescheduled fairly.

Infeasible input (not enough people) returns `warnings` plus a partial plan. Structurally invalid input and output invariant violations throw in strict mode — someone mid-edit needs to see what is short, not a stack trace.

`mergeRows` rejoins rows **only within one shift slot**, never across a shift boundary. Repairing a
segment that an unrelated availability edge tore in half is what merging is for; welding
consecutive shifts together is not, and used to be the same operation — a guard held over eleven
slots surfaced as one 88-hour row, which read as a single monstrous shift and gave the agenda a
second slot that also began at 22:00 but ended four days later. Bounded to one slot, `stints`
counts shifts worked, which is the number that means something under `rotation`.

**There is no single global step to do arithmetic on.** Shift length is a property of the mission:
`shiftMinutes` and `nightShiftMinutes` on a local mission override the plan's default and its own
day length respectively, `null` meaning "inherit" — so חמ"ל can run two-hour shifts by day and
one-hour shifts at night while the gate beside it stays hourly. `gridFor`/`slotBoundsFor` in
`planner.js` builds one grid per mission, and a mission that overrides neither is handed *the same
set built by the same loop* that always built it, which is the only reason a link already shared
still renders the schedule it rendered. `tests/planner.golden.test.js` is the standing proof of
that and must never be regenerated to make a change pass — `scripts/writeGoldens.mjs` exists for
intentional assignment changes. Correctness fixes may change previously invalid output;
new quality findings are asserted separately from the unchanged fixtures.

Equal day and night lengths anchor once, at the plan's start. Different ones anchor **each stretch
at its own beginning** — night restarts an hourly grid at 22:00 rather than inheriting the phase
the two-hour grid happened to be in — and a stretch that is not a whole number of slots leaves one
partial slot at its end, exactly as the plan's own end always has. Remote and daily missions ignore both
fields, like `nightCount`. The night length is deliberately **not** capped at the night's own
duration: a ten-hour night slot inside an eight-hour night is one slot ending at daybreak, which is
harmless, and a validation error there would fire while someone was still typing the number.

Every row therefore carries `slotStart`/`slotEnd` — the grid slot it belongs to, the mission's own
window for a remote hold. That stamp, not modulo arithmetic, is what `mergeRows` keys on and what
`ringKeys` counts. It is the *grid's* slot, not the row's own extent: an availability edge tearing
a slot in two leaves both halves naming the one slot they are inside. It is also **not clamped to
the mission's window**, so two missions cutting the same slot at different points still name the
same slot — which is what keeps half a slot on one mission and half on another a single turn.

A local mission can be staffed differently at night: `count` is the daytime headcount and
`nightCount` replaces it inside the plan's night stretches (`null` means "same", which is what
every link written before the field existed means). Remote missions ignore it — one set of people
holds them end to end. Night edges join the segment grid so no segment can straddle the boundary
and have to pick a side. The **windows reach the engine as absolute instants**, resolved by
`nightWindows` in `planSchema.js`: "22:00" is not a moment until a timezone says so, and reading
one inside `planner.js` would break the rule above. That leaves one trade, and it is the only
place in the document that behaves this way — the boundary is read in the *viewer's* timezone, so
a plan opened several timezones away splits its nights by the reader's clock. For a Hebrew,
Israel-only rota that is the reading people want.

A pin with a null `start`/`end` inherits the mission's window, which inherits the plan's. So a
whole-mission assignment and a per-shift one can describe the same time while looking nothing
alike: **match pins by coverage, never by literal range**. Both bugs found in review came from
that. Pin edits live in `src/lib/pins.js`, deliberately pure and outside the React context so the
rule stays testable. On a remote mission a pin always means the whole mission — a partial range can
survive a local→remote toggle, and honouring it literally leaves the rest of the window short.

A pin on a **local** mission is emitted as one pinned row per segment of that mission's grid, not
one row over the pin's whole coverage — which is why `segmentsOf` is built before phase 1 rather
than inside phase 3, so the pinned rows and the demand walk can never disagree about where a
segment starts. The engine's *decision* was never wrong here; the shape was. A whole-mission pin
resolves to the mission's entire window, and one row that long is the 88-hour-row symptom above
arriving through a different door: the agenda keys slots on `(start, end)`, so it became a slot of
its own and left every hourly slot of that mission reading one person short. Accepted pin bounds join their own mission's segment edges, while preserving the original
slot stamp. Otherwise an off-grid pin could overlap an automatic whole-segment row.
Remote pins stay whole, one set of people end to end.

Because that person now has the swap dropdown and the clear button on every hour they hold,
`applySwap` and `applyClearPin` **cut** the matched pin around that hour (`cutPin`) instead of
removing it: clearing Tuesday 14:00 must not silently unassign the week. The bound that was not cut
is kept *as written*, so a `null` still follows the mission's window if that later moves, and
`frozen` rides along onto both remainders. `applyClearPinsForMission` stays whole-pin — it is only
ever offered for a pin the engine already reported as unusable. The Missions picker lists anyone
holding *any* pin on the mission, marking a trimmed one `assignedPartially`; unticking a name
releases every pin they hold there, and ticking one who has none writes them a whole-mission pin,
so the two are exact inverses over that list.

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
malfunction. `isOutOfPeriod` (`planner.js`) is the shared predicate. It resolves the pin's window through the
whole chain — pin → mission → plan — via `resolvePinWindow`, which `pinRange` in `pins.js` also
delegates to; resolving a missing bound straight to the plan period instead of the mission's
answers "not stale" for every pin on a mission that has itself dropped out of the period, and
that history then rides along uncollectable forever. On a **remote** mission the pin's written
range is ignored and the mission's own window decides, because a pin there means the whole
mission however it was written — a remote pin whose range reads as long past is still staffing
the mission right now.

The count reported as `PIN_OUT_OF_PERIOD` is computed in `plan()` from the **raw** missions, not
inside `normalizePins`. A mission that fell out of the period is already gone from
`missionById`, so its pins vanish before anything in there can count them — and since the button
that clears residue only exists alongside this warning, a count taken in there would strand that
history with no way to reach it. Sharing one predicate with `clearStalePins` is what keeps the
number honest: what the warning reports as *clearable* is exactly what the button removes, and
`tests/pins.test.js` asserts that.

**Only the past is history, and the predicate says which.** `isOutOfPeriod` is true on *both*
sides of the window, which is right for the engine — it schedules neither — and wrong for anything
that then calls a pin a record of duty that happened. Keyed on it, the export wrote next week's
assignment into the history CSV as completed duty and the button beside the warning deleted it:
somebody's plan, consumed by narrowing the period. So `isElapsedBeforePeriod` governs everything
that calls a pin history — the CSV, `countStalePins`, `clearStalePins` — while the warning still
counts both sides, because an assignment the engine is ignoring is worth knowing about whichever
way it fell. That is why the warning carries two numbers, `count` and `elapsed`, and why the button
only renders when there is history to export (ADR 012's correction).

There is no automatic cleanup, and that is deliberate. `pruneStalePins` used to run inside `setDoc`
and was right while out-of-period pins were residue; ADR 012 inverts that by making them the only
durable record, so it is gone and `src/lib/pins.js` keeps the reasoning where it used to live.
Nothing removes recorded duty without an export any more.

### Duty does not stop counting when the window rolls past it

The rota is planned 72 hours at a time and rolled forward, and `balanced` evens
out the window it is *given* — so without help, an hour stops counting the moment
it falls behind the window. A guard away for two days came back permanently 36
hours behind, and the summary reported a spread of **0.0h** at every roll while
it happened. A number that is silent about a problem is a gap; a number that says
there is no problem is a wrong answer.

So duty already stood is an input to fairness, from **two sources, summed**: pins
that now lie outside the period, and `carriedMinutes`/`carriedStints` on the
employee. The first is read from the *raw* missions, exactly like the
`PIN_OUT_OF_PERIOD` count and for the same reason — a mission that has itself
dropped out of the period is already gone from `missionById`, and the hours its
pins record are no less real.

Reading both is what keeps `clearStalePins` a change of **representation**, not of
schedule: it converts the first into the second and the total does not move, so no
shift moves. `tests/pins.test.js` asserted that before the field existed and still
does. A fairness rule that only works after somebody presses a cleanup button is
not a fairness rule, and the first attempt at this had exactly that shape.

The two strategies read different units on purpose. `balanced` evens out hours, so
it reads `carriedMinutes`; `rotation` counts shifts and never consults hours, so it
reads `carriedStints` — carrying minutes would say nothing there. `carriedStints`
is an approximation and says so: an out-of-period pin has no grid left to name a
slot on, so a turn is one plan shift length, at least one.

`st.minutes` is in **minutes** despite everything around it being epoch
milliseconds — `occupy` divides by `MINUTE` on the way in. Seeding it cost an
hour to a factor of 60,000.

The debt is **normalized against the least-worked person and clamped to
`MAX_UNBROKEN_MINUTES`** (`carriedDebts`), and both halves are load-bearing
rather than tidy. In absolute hours, a newcomer joining a roster where everyone
else has stood five hundred hours stood **72 of a 72-hour window without a
break**; normalizing fixes that, because a roster where everybody has stood five
hundred hours is a roster in balance. Unclamped — even with runs capped — that
newcomer still takes 62 of a 72-hour window against everyone else's 20, so the
clamp bounds how far one window may be tilted by a debt too old to settle here.

The clamp is the *same quantity* as ADR 016's run cap, in code rather than by
coincidence: repaying a debt is what builds a run, so a window may not owe
anyone more continuous duty than it is willing to hand them.

### Nobody stands more than six hours if anyone else is free

`balanced`'s first tier is `midRun` (ADR 016), above the minutes key, and it
exists because evening out hours is *exactly* what builds an unbroken run —
whoever is behind is the cheapest candidate for the next slot and the one after
it. Before it, where somebody joined a period part-way through, **half of those
plans put a guard on post for 24 hours or more**, up to a full 72
(`scripts/unbrokenRunSurvey.mjs`).

Six hours is measured, not felt: at six no golden fixture changes and no test
fails; at three, one golden moves. `occupy` tracks the stretch, so a person
mid-run is mid-run however they got there, pins included.

It does not reach zero and cannot. Of the plans that still hand somebody 24h+,
**100% have nobody spare at all** — everyone present is on post every slot and
there is no one to hand over to. Those are staffing shortages, and
`long-unbroken-run` is the right answer to them.

This also removed what looked like a hard limit. Before it, repayment rate and
run length were one quantity and the honest reading was that a greedy
minutes-first walk could not have both — which was the sharpest argument this
repo had for ADR 011, and was wrong. The second objective just needed a tier of
its own rather than a setting of the first.

While a debt is repaid the window spread is deliberately wide. That is the trade
working, not failing, and the summary prints both figures so it does not read as a
fault. Neither the caption nor the split figure appears when nobody carries
anything: `buildStats` returns the object it always returned, which is what keeps
every golden fixture and every shared link unchanged. Adding the fields
unconditionally broke four goldens for a feature those plans do not use — the fix
was the wire format's own discipline, write it only when it carries a value, not a
looser test.

### Asking the engine structural questions

`segmentGrid`, `acceptedPins` and `countAt` are exported so nothing outside
`planner.js` has to rebuild where a shift begins, which pins survived, or how many
people a mission wants at 03:00. A second implementation of any of those is wrong
eventually, in a way neither side reveals on its own reading — the same argument
that makes one shared `segmentsOf` non-negotiable *inside* the engine, carried past
the module boundary.

`segmentGrid` is **type-agnostic**, and that is a trap worth knowing before using
it. It cuts a remote mission on the house grid like any other, because it reads
shift lengths and never looks at `type`; the engine gets away with that by never
asking — phase 2 claims remote and daily missions whole. A caller that read those
segments as shifts would hand a remote mission a different crew every hour.
`tests/planner.segmentGrid.test.js` pins it.

### Strategies

*Who* gets a given slot is the one decision the engine delegates. `planner.js` works out who is
eligible — availability, existing bookings, mission windows, pins — and hands the candidates to a
strategy from `src/lib/strategies.js` to rank. Everything else is policy-free and must stay that
way: a new strategy should never need a change in `planner.js`.

`balanced` (the default, and what every link written before the setting existed means) evens out
total time on duty. `rotation` is a fixed circular list: guards take turns round it in document
order, and hours are never consulted, so a twelve-hour remote mission, a two-hour חמ"ל slot and a
one-hour slot each cost exactly one turn. Under `rotation` a large `spreadMinutes` is the expected
outcome, not a bug — `stints` is the column that means something there.

Rotation ranks on **rest time first**, turn count second. That order is load bearing, not a
preference: ranked on turns first, whoever starts a block keeps winning the slot after it. Both
keys are also measured *as of the slot being filled* rather than from a running counter — the
engine places pins first, then remote/daily holds, then local slots chronologically, so a counter
would let a pin for a late-evening shift push its holder to the back of the ring before the
morning slots were even assigned.

Rest-first is not on its own enough, and assuming it was cost three guards eighty-eight unbroken
hours. Whenever a slot has more seats than there are rested people, somebody *must* work the slot
they just finished, and every candidate's last turn ended on the same grid boundary — so the rest
key ties and the turn count decides. **A turn is one shift slot, not one unbroken run**: counting a
multi-slot block as a single turn makes the guard who never got a break the cheapest candidate, so
they win the tie, stay on post, and stay cheap, with `ringIndex` pinning it to the same
lowest-numbered guards forever. `ringKeys` counts **distinct `slotStart` values** among the
intervals that ended before the slot being filled, plus one per remote hold — a remote mission is
one claim taken once, however long it runs, so it never folds into the local slot that starts the
moment it ends. The key is the **bare slot start, never `(mission, slotStart)`**: half a slot on one
mission and half on another is one shift's worth of duty, and charging it as two would send that
guard round the ring a lap early. `tests/planner.rotation.test.js` pins all of this.

`tests/planner.invariants.test.js` is the real safety net: it asserts across ~1900 generated plans
— with mission grids drawn from `{null, 60, 120, 180}` by day and by night, so mixed grids sit
beside each other — that nobody is ever double-booked, no mission is overstaffed, availability is
respected, every row lies inside the slot it names, and the same input always gives the same
output. Do not weaken it to make a change pass.

## The employee list

Two names are the same person when `nameKey` (`src/lib/employees.js`) says so — trimmed,
internal whitespace collapsed, case-folded, NFC. Both adders in `PlanContext` go through
`addUniqueEmployees`, so a duplicate is refused whichever box it was typed into, and a repeat
inside a single paste is caught too. It returns what it `skipped` rather than swallowing it: a
paste that silently lands two names short is worse than the duplicate it avoided, and the page
says which names it dropped. An add that turns out to be all duplicates leaves the document
untouched, so no identical plan is re-encoded into the URL.

Renaming an existing row is a different matter and must never be blocked: a rename passes
through every prefix of itself, so "דנ" on the way to "דנה" would collide with a real "דנה".
`duplicateEmployeeIds` flags both sides instead. Blank names are never a key anywhere here —
rows exist half-typed, and two empty rows are not duplicates of each other.

None of this reaches the engine, which keys on ids: to `planner.js` two identically-named rows
are simply two guards.

## Changing the plan document

`src/lib/planSchema.js` and `src/lib/urlState.js` move together. The encoded form is positional
tuples, so **field order is part of the wire format** — appending is safe, reordering or inserting
is not. Bump `SCHEMA_VERSION` when the shape changes; `decodePlan` rejects unknown versions rather
than misreading them. Positions past the ones in use are reserved in
[ADR 006](docs/plans/06-approved-continuation.md) so two features built in either order cannot claim
the same one; take the next free position from that table rather than the next free index. An
appended position is written only when it carries a value — `trimTail` drops the unset tail, never
shortening a tuple below the length the last shipped build wrote — so a document using none of the
new fields encodes to exactly the bytes it always did, and every link already shared keeps its
string. `tests/urlState.test.js` pins one such blob literally.

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
- A shift's assignee is **text plus an edit button** (`ShiftRow`), never an inline dropdown, and
  the roster lives in a dialog (`AssignDialog`). An input is only as wide as its column, so a
  Hebrew name of any length arrived on a phone as `ש...` and the agenda stopped saying who was on
  duty; text wraps, an input does not. The dialog's search box is deliberately not auto-focused —
  on a phone that raises the keyboard over the list the reader came to read.
- Dates and times are **native inputs** in a MUI `TextField`, never a MUI picker. A native field
  opens the platform's own picker on a phone, needs no date library, and its value is always
  24-hour `HH:mm`. The picker followed the *device's* clock format, and in a 12-hour field the hour
  section counts inside its own half of the day: stepping a plan's start back over noon threw it
  nine hours forward instead, so the history-freezing browser test failed every afternoon and
  passed every morning. `src/lib/localInput.js` owns both conversions and is where the arithmetic
  is tested. What the field *displays* is still the device's business — that is the accepted cost.
- Sharing carries a **window**, not the whole rota: the WhatsApp message and the iCal files cover
  24 hours from a chosen start, three whole hours back by default (`src/lib/shareWindow.js`), and
  the default is clamped into the plan so a rota written for next week does not copy an empty
  message. The copied **link and the CSV are deliberately exempt** — a link *is* the document, and
  narrowing its period would make the recipient's engine recompute a different schedule from the
  one you were looking at.
- The schedule's per-person filter is **view state, never document state**. It is the same
  `EmployeeSelect` the iCal row uses, and the summary table stays whole underneath it: the question
  it answers is "why is this person on so much more than the others", which needs the others. A
  filter in the URL would travel with every shared link.
- Duplicating a mission (`duplicateMission`) copies every setting and **no pins**. A pin names a
  person holding that mission over a range; copied onto a mission covering the same hours it would
  double-book its holder the moment the copy existed, and the engine would drop it with a conflict
  warning nobody asked for. The copy's name gets a `(עותק)` suffix — two identical names make the
  agenda unreadable.
- `sx` maps palette tokens for `borderColor` only. `borderInlineStartColor: 'primary.main'` is
  emitted as an invalid colour and dropped — resolve it via a callback (`(theme) => …`).

## Before delivering

```bash
npm run lint && npm test && npm run build
```

For anything touching the UI, exports, sharing, or offline behaviour, also run the browser check
(`tests/e2e.mjs`, instructions in `README.md`; the other `*.e2e.mjs` files are focused scenarios
run the same way) — several bugs found during development were
invisible to the unit tests: MUI dropping test ids, a zod schema rejecting a freshly added mission,
and a 24-hour remote mission rendering as `22:00–22:00`.

For layout changes run `tests/mobile-viewports.mjs` too (same server, three phone/tablet
viewports). It fails on horizontal overflow and on any table cell whose content is wider than its
column — the shape of every mobile layout bug reported so far.

CI also runs **MegaLinter's JavaScript flavor** on every pull request (`ci.yml`, configured in
`.mega-linter.yml`). It is **advisory, never blocking** — the job sets `DISABLE_ERRORS`, so every
finding lands in the job summary and the step still exits 0. What gates a pull request is the
`check` job: `oxlint`, the scheduler tests, the build. MegaLinter earns its place on what oxlint
does not cover — workflows, YAML, shell, the Dockerfile, Markdown, secrets and dependency
scanning — and not by holding a merge over a style opinion.

**Which linters run is configured in `.mega-linter.yml` and nowhere else.** A MegaLinter env
variable on the workflow step *replaces* the file's value rather than adding to it, so a
`DISABLE_LINTERS: ACTION_ZIZMOR` on the step silently discarded every entry in the file — which is
how `standard` kept running, and rewriting, after being disabled there.

The job runs with `APPLY_FIXES: all` and commits what a linter rewrites, **on purpose**: a
formatting fix that a bot can make is not worth a human's or an agent's attention. That is what
makes the exclusions below matter, though — a linter this repo does not agree with does not just
report its opinion, it lands it. Three of them are load-bearing and will look arbitrary to anyone
tidying up:

- **`JAVASCRIPT_STANDARD` is off.** It enforces a no-semicolon style this repo does not use, and
  under `APPLY_FIXES` it does not report the difference, it *rewrites* and commits — one run
  reformatted 20 source files that way. Its single actual error was `self` and `caches` being
  undefined in a service worker, which is what a service worker is. JavaScript here is `oxlint`'s
  job, which carries three documented rule exceptions in `.oxlintrc.json`.
- **`SPELL_CSPELL` is off permanently.** All 140 of its findings were Hebrew product words,
  iCalendar keywords, British spellings or deliberate identifiers like `emps` and `sleepable` —
  not one was a typo.
- **`tests/fixtures/` is excluded from `JSON_PRETTIER`.** The goldens are written as one minified
  line each by `scripts/writeGoldens.mjs`; prettier wants each of them exploded to ~180 lines.
  Neither format is wrong, but two generators that disagree means every intentional golden
  regeneration is followed by a bot commit re-flowing it, and the next `writeGoldens` run undoes
  that again. The exclusion picks one owner. Every other JSON file here is already prettier-clean,
  so nothing else needed excluding.

`ACTION_ZIZMOR` is off here for a reason with an end date rather than a permanent one: it reports
48 findings against the workflows as they stand, and the branch that reworks the workflow
permissions fixes them and adds a `.github/zizmor.yml` requiring actions to be pinned to a ref
rather than a hash (which rejects `@main` while keeping the rolling major tags the workflows
deliberately track). Re-enable it by deleting one line once that lands.

Note that **actionlint only lints the shell inside `run:` blocks when `shellcheck` is on `PATH`**:
running it locally without shellcheck installed reports clean and CI does not.

`lz-string` is CommonJS: import it as a default and destructure, or the Node test run breaks while
the Vite build keeps working.

## Daily missions, qualifications, and output checks

See [the ADR index](docs/plans/README.md) for accepted scheduling decisions.
ADRs 003–005 describe daily duties, validation, and qualifications; ADR 006
records URL compatibility. The historical plan filenames remain stable.
Daily equal times mean a full calendar day. Time inputs are native
`datetime-local`/`time` fields (`DateTimeField`, `DailyClockField`), so their
**value** is always 24-hour `HH:mm` while their rendering follows the device.
The adapter resolves viewer-local calendar occurrences, and the engine holds each
whole before local duties. Occurrence-aware pin edits preserve neighboring days.

Qualification requirements are coverage within headcount. Prefer separate people,
but allow combined qualifications. Exclusions filter automatic candidates; pins
remain visible overrides. Rest is preferred: staff duties when necessary and
report actual shortfalls. Never count rest as work or claim a greedy shortage is
proof of infeasibility.

Output invariant violations throw by default. The schedule uses report mode to
show evidence, and copy-link remains available even on a computation error.
History freezing stays strict and does not freeze invalid output. Quality warnings
are additive; golden assignment fixtures must not be regenerated to hide changes.
The committed UTC URL/digest fixtures use UTC input dates regardless of host zone.
