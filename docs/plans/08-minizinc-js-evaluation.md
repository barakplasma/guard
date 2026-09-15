# ADR 008: Split the timeline, then a solver becomes worth having

- Status: Proposed. Supersedes this document's own first draft, which weighed
  the wrong constraints.
- Date: 2026-09-15

## Context

The question asked was whether [MiniZinc's JavaScript
API](https://docs.minizinc.dev/en/stable/javascript.html), or
[`or-tools-wasm`](https://www.npmjs.com/package/or-tools-wasm), would improve
the hand-written engine in `src/lib/planner.js`.

The first draft of this record answered no, on two grounds: a solver cannot
reproduce a schedule byte for byte, and its WebAssembly payload is twenty-one
times the application. Both were measured correctly and both were beside the
point, because neither is a constraint this project actually has. Stated
plainly so the next reader does not repeat it: **download size does not matter
here, and neither does getting the same future schedule twice.** What matters
was named on being asked directly.

### The constraints that are real

1. **The past is a record of what happened, not a schedule.** Manual changes to
   reflect reality are wanted. The algorithm rewriting history to get a better
   schedule is the defect.
2. **Manual pins are followed exactly.** Unchanged.
3. **The future may vary between runs.** One person edits this, on one device;
   nobody else opens the link and compares.
4. **It must work offline.** This was being met by putting the whole document
   in the URL, which conflates two separate needs - see below.

## The actual defect

`scripts/historyDriftCheck.mjs` applies each kind of edit through the real
`setDoc` path, three days into a seven-day rota, and re-reads the past:

```
  edit                                erased   invented   unreachable
  add an employee                         0          0             0
  raise a mission headcount               0         72             0
  lower a mission headcount              72          0             0
  add a third mission                     0          0             0
  switch strategy to balanced             0          0             0
  change shift length to 2h               0          0             0
  extend the plan end by 2 days           0          0             0
  move the plan start forward 1d          0          0            96
  limit an employee availability          0          0             0
```

Freezing works for the case it was built for: no edit ever swaps one guard for
another in the past. What it cannot cover is **headcount, which has no history
of its own.** A mission carries one `count` for all time, so raising it today
re-staffs every elapsed slot to the new number and writes in people who were
never there; lowering it deletes people who genuinely stood post. The freeze
records *who* held a slot, never *how many seats existed then*.

Moving the plan's start forward is the third case. That history is still in the
document but outside the period, so the engine ignores it and it is counted
once as `PIN_OUT_OF_PERIOD` instead of being shown.

None of this is a search-quality problem. **No solver fixes it, and a solver
that re-derives the past makes it worse.** The defect is that already-elapsed
time is handed to the scheduler at all.

## Decision

### 1. Split the timeline at *now*

Everything before *now* is a log: recorded fact, append-only, edited only by a
person correcting the record. Everything after is computed. The engine's window
starts at *now*, so no scheduler - hand-written or solver, seeded or not - can
reach backwards.

History still has to feed *in*, because fairness, stints and night rest are
measured against what people have already worked. It enters as read-only input,
the way pins do today, and never leaves as output. That single direction is the
whole fix: the past cannot drift if nothing ever recomputes it.

A logged assignment carries its own seat count, which is what closes the
headcount case. It records that two people stood this slot, not that this
mission has two seats.

### 2. Move the store local-first

"Works offline" and "lives in the URL" are separate needs that had been welded
together. Offline needs local persistence, which IndexedDB provides with no
size ceiling, no network and no backend. Sharing needs a URL, and a shared link
does not need the whole history - the WhatsApp and iCal exports already carry a
24-hour window rather than the entire rota.

This matters because the URL is the binding constraint on everything else. A
seven-day rota for seventeen guards encodes to 336 characters empty; once
elapsed shifts freeze into pins it reaches 2,757 after one day, 9,228 after
four, at which point sharing breaks. That ceiling is why history cannot be
kept, and keeping history is the whole request.

The cost is real and should be stated: **a link stops being the document.**
Copy-link becomes "share a snapshot of this window" rather than "here is my
entire plan, recomputed on your machine."

### 3. Only then, the solver

With the past out of reach and a single editor on a single device, the two
objections in this record's first draft evaporate. A varying future schedule
costs nothing when nobody is diffing two renders of the same link, and payload
size is not a constraint that was ever in play.

`or-tools-wasm` exposes CP-SAT, which is the right solver class for this
problem - crew assignment with coverage, exclusions, rest windows and a
fairness objective is close to textbook CP-SAT. It is Apache-2.0. It is also a
community port at version 0.9.1 with a single maintainer, which is a
supply-chain fact worth weighing for something that rosters real guard duty,
not a reason on its own to refuse.

Seed it and pin the version. Not for reproducibility's own sake, but because a
seeded solver keeps the option of storing only deviations rather than the whole
past: on a seven-day rota with three hand-edits that is 3 pins and 404
characters against 960 pins and 9,228. Local-first storage makes that a
convenience rather than a necessity, which is the right order - the seed should
be an optimisation, never the thing history depends on.

### What stays true from the first draft

The engine is provably incomplete: it reports shortages on rosters that can be
staffed in full, at up to 0.94% of feasible small instances with exclusions,
though never on realistic rota shapes. `scripts/completenessSearch.mjs`
measures it. CP-SAT would close that class by construction; so would lifting
`choose` from per-mission to per-segment, which needs no dependency. Either is
defensible, and this is genuinely the part a solver is good at.

## Consequences

The past becomes durable and editable, which is what was asked for. The
document grows without bound, which local-first storage can absorb and the URL
never could. Sharing changes shape and the ADR 006 wire format stops being the
only persistence, so its append-only discipline now governs shared snapshots
rather than the user's only copy of their data.

Losing "the link is the document" loses a genuinely elegant property, and it is
the real price here. It buys a rota that remembers what actually happened.

## Alternatives rejected

- **A solver without the timeline split.** Fixes nothing that was asked for and
  makes the headcount defect worse by giving the past more reasons to move.
- **Versioning `count` in the document.** Fixes one column of the drift table.
  Every other field that feeds a past slot would need the same treatment, one
  at a time, forever.
- **Making the past read-only.** Contradicts the request: correcting the record
  to match reality is the point.
- **A backend.** Not needed. Local persistence is offline persistence; a
  backend would only buy cross-device sync, which is not wanted.

## Evidence

`scripts/historyDriftCheck.mjs` for the drift table,
`scripts/completenessSearch.mjs` for the completeness measurements. URL lengths
from `encodePlan` over a seventeen-guard, ten-seat, seven-day rota. Package
facts from the `minizinc@4.5.2` and `or-tools-wasm@0.9.1` registry entries.
