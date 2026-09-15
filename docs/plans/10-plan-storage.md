# ADR 010: Move the plan to the URL fragment; keep local-first in reserve

- Status: Proposed. Depends on ADR 009 only in that the log is what grows.
  Independent of ADR 011 - the solver does not change any of this.
- Date: 2026-09-15

## Context

ADR 009 makes the past a log, and a log only grows. So the question is where it
is kept, and whether "the plan lives in the URL" survives.

An earlier draft of this evaluation said it does not, and recommended moving
the store local-first to IndexedDB. Asked whether that was really necessary, the
measurement says **no**, and the earlier draft had missed a much cheaper fix.

### The plan is in the query string, not the fragment

`PlanContext` reads `new URLSearchParams(location.search).get(PARAM)` and writes
with `params.set(PARAM, encoded)`. The compressed document is therefore a
**query parameter**, which means it travels to the server in the HTTP request
line on every single page load.

That is where the practical ceiling comes from. Servers cap the request line and
headers - around 8 KB is typical, and both deploy channels are affected.

A **fragment** (`#p=...`) is never sent to a server at all. The limit becomes
the browser's own, which is far more generous.

### Measured

Seventeen guards, ten seats, hourly, whole period elapsed and logged:

| days | log entries | URL chars | as query (8k) | as fragment (64k) |
|---|---|---|---|---|
| 1 | 240 | 2,745 | ok | ok |
| 3 | 720 | 7,064 | ok | ok |
| 7 | 1,680 | 15,605 | **breaks** | ok |
| 14 | 3,360 | 30,462 | **breaks** | ok |
| 30 | 7,200 | 65,481 | **breaks** | Chrome only |
| 60 | 14,400 | 132,012 | **breaks** | Chrome only |
| 90 | 21,600 | 197,854 | **breaks** | Chrome only |

As a query string, a week of fully-logged hourly history does not fit. As a
fragment, a month does.

## Decision

**Move the plan from the query string to the URL fragment.**

It is a small change - `location.search` to `location.hash` in `PlanContext`,
and wherever the share bar and exports build a link - and it buys roughly four
times the usable history while keeping the property that makes this app what it
is: **a link is the document.**

Two things fall out for free:

- **Guard names stop appearing in server access logs.** Today the compressed
  document, names included, is in the request line of every page load, so it is
  logged by Caddy and by GitHub Pages. A fragment never leaves the browser. For
  a Hebrew rota naming real people this is a small but genuine improvement.
- Long links stop being a server-side failure mode. The existing WhatsApp and
  iCal exports already share a 24-hour window rather than the whole rota
  (`src/lib/shareWindow.js`), so the very long link is a personal bookmark, not
  something anybody pastes into a chat.

### Local-first stays in reserve

IndexedDB via `dexie` remains the answer if and when the fragment ceiling is
actually reached. `dexie` is the right library for it: 189 releases since 2014,
two maintainers, shipping this month, about 8.3 million downloads a month. The
alternative `idb` is thinner and single-maintainer, and schema migration is the
part worth not writing.

The trigger to revisit is concrete rather than aesthetic: history beyond about a
month at hourly granularity, or wanting history to outlive a link that gets lost.
Until one of those bites, local-first is a large change - a link stops being the
document - bought for headroom that is not needed.

`@automerge/automerge` was surveyed and is the only library here with a real
team (six maintainers, Ink & Switch), and an append-only change history is close
to what ADR 009 describes. It is not recommended, because it is built for
multi-device merge and this is one editor on one device.

## Consequences

The elegant property survives, which is the point. The fragment change is
reversible and small enough to do alongside ADR 009.

The ceiling is moved rather than removed, and the table above says exactly where
it now sits. Anybody who runs an hourly rota for more than a month will hit it,
and ADR 010's reserve plan is what they should reach for.

Shorter shifts make history bigger, linearly: a two-hour grid halves the log.
That is a genuine lever if the ceiling ever gets close.

## Alternatives rejected

- **Local-first now.** Over-engineered for the need. It costs "a link is the
  document" to buy headroom beyond a month that nobody has asked for.
- **Staying in the query string.** Breaks at seven days of logged history, which
  ADR 009 makes the normal case rather than the exceptional one.
- **A compact custom encoding for the log** (run-length or delta encoding the
  contiguous hourly runs). Would likely shrink it a lot, but it is bespoke
  format code on the one path where a bug loses the user's only copy of their
  data, and the fragment gets the needed headroom without it.
- **A backend.** Not needed. Local persistence is offline persistence, and a
  backend would only buy cross-device sync, which is not wanted.

## Evidence

Measurements from `encodePlan` over a seventeen-guard, ten-seat, seven-day rota
at increasing elapsed durations. Query-parameter usage in
`src/state/PlanContext.jsx`; the codec in `src/lib/urlState.js`; the existing
window-scoped sharing in `src/lib/shareWindow.js`. Library facts from the npm
registry, read 2026-09-15.
