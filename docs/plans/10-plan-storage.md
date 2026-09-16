# ADR 010: The plan stays in the URL, where it already is

- Status: **Accepted (no change required).** An earlier revision of this record
  recommended moving the plan from the query string to the URL fragment. That
  recommendation was wrong: the app uses `HashRouter`, so the plan has been in
  the fragment since it was written. Constrained by ADR 012.
- Date: 2026-09-15

## The correction

An earlier revision of this record said:

> `PlanContext` reads `new URLSearchParams(location.search).get(PARAM)` [...] The
> compressed document is therefore a **query parameter**, which means it travels
> to the server in the HTTP request line on every single page load.

**That is false.** `src/App.jsx` wraps the app in `HashRouter`, and says so:

```js
// HashRouter keeps everything - route and plan blob - after the "#", so the
// app needs no server rewrite rules and works from a file:// path too.
```

So a real URL is `https://host/guard/#/schedule?p=<blob>`. The `?p=` sits
*inside* the fragment. `location.search` under `HashRouter` is the search
portion of the hash, not of the document URL, and `tests/e2e.mjs` navigates to
exactly that shape. **A fragment is never sent to a server**, so:

- The ~8 KB request-line ceiling **never applied**. Neither GitHub Pages nor
  Caddy has ever seen the plan.
- Guard names have **never** appeared in server access logs. The privacy
  improvement an earlier revision claimed was already true, and was not a
  benefit of any change.
- The "current shape sits at about 84% of the query-string budget" framing was
  measuring against a limit that does not apply to this app.

The mistake was reading `location.search` as a document-level query string
without checking which router was mounted. The numbers below are unchanged and
were measured correctly; only the ceiling they were compared against was wrong.

## Decision

**Keep the plan in the URL. Nothing to move.**

The conclusion an earlier revision reached - that local-first storage is not
needed - survives, and is now better supported than the argument made for it.

## What the real ceiling is

Not the request line, but the browser's own URL handling, which is far more
generous and varies: Chrome accepts roughly 2 MB, Firefox and Safari become
unreliable somewhere in the tens of thousands of characters. Below those, the
practical limit is whatever a person pastes the link into - messaging apps
handle a few thousand characters comfortably and degrade past that.

Measured, seventeen guards, ten seats, hourly, whole period elapsed and logged:

| days | log entries | URL chars |
|------|-------------|-----------|
| 1    | 240         | 2,745     |
| 3    | 720         | 7,064     |
| 7    | 1,680       | 15,605    |
| 14   | 3,360       | 30,462    |
| 30   | 7,200       | 65,481    |

ADR 012 bounds this. The horizon is 72 hours and a rolled-past window is
exported rather than retained, so the live document never exceeds one window -
6,744 characters for the current roster shape, and 15,429 for the largest
plausible one. Nothing here approaches a browser limit.

Shift length is the strongest lever if it ever gets close: a two-hour grid
roughly halves the log.

## Local-first stays in reserve, and is now genuinely dormant

IndexedDB via `dexie` remains the answer if the URL is ever outgrown. It is the
right library for it: 189 releases since 2014, two maintainers, shipping this
month, about 8.3 million downloads a month. `idb` is thinner and more widely
installed but is a single-maintainer wrapper, and schema migration is the part
worth not writing.

The trigger to revisit is concrete: abandoning ADR 012's export decision in
favour of retaining history in the live document, or wanting history to outlive
a link that gets lost. Neither applies, so this is a large change - a link stops
being the document - bought for headroom nobody needs.

`@automerge/automerge` was surveyed and is the only library here with a real
team (six maintainers, Ink & Switch), and an append-only change history is close
to what ADR 009 describes. Not recommended: it is built for multi-device merge,
and this is one editor on one device.

## Consequences

The property that makes this app what it is - **a link is the document** -
survives untouched, and needed no defending.

`HashRouter` is load-bearing for more than routing. Switching to `BrowserRouter`
would move the plan into the real query string and make every claim in the
earlier revision of this record true at once: a server-side length ceiling, and
every guard's name in the access log of whatever serves the site. It is worth a
note in `App.jsx` beyond the rewrite-rules reason already there.

## Alternatives rejected

- **Moving the plan to the fragment.** Already there.
- **Local-first now.** Over-engineered. Costs "a link is the document" to buy
  headroom that ADR 012's bounded horizon means nobody needs.
- **A compact custom encoding for the log.** Bespoke format code on the one path
  where a bug loses the user's only copy of their data, for headroom that is not
  needed.
- **A backend.** Local persistence is offline persistence, and a backend would
  only buy cross-device sync, which is not wanted.

## Evidence

`HashRouter` in `src/App.jsx`; the URL shape in `tests/e2e.mjs`, which navigates
to `${BASE}/#/schedule?p=...`. Length measurements from `encodePlan` over a
seventeen-guard, ten-seat rota at increasing elapsed durations. Library facts
from the npm registry, read 2026-09-15.
