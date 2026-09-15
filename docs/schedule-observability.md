# Runtime diagnostics and next steps

## What the app checks

- Hard errors: invalid or overlapping assignments, overstaffing, slot overrun,
  false qualifications, availability violations, and unexplained shift boundaries.
- Staffing and rest problems: understaffing, missing qualifications, and actual
  total rest below the configured minimum.
- Duration review: every local assignment shorter or longer than its configured
  day/night duration. A clipped period, availability edge, or accepted pin can
  legitimately produce a short shift. Remote and daily holds use their whole
  mission windows, so the local rotation duration does not apply to them.
- Workload review: existing consecutive-duty warnings, people with no shifts,
  and people with at least three distinct assignments and more than twice the
  roster's average count. Fragmented pieces of one mission/slot count once.
  Manual assignments count too. This is an advisory threshold: qualifications,
  unequal availability, or manual choices can explain the difference.

The Schedule checks panel shows a count even while collapsed. Serious findings
open it initially; filters select errors, duration, workload, or unused people.
The report button copies the exact plan, generated assignments, findings, app
version, and viewer timezone. Nothing is sent to an external service.

## Crowded pages

The phone screenshot shows sharing/export controls occupying about half the
initial schedule viewport. My recommendation is to keep the existing three main
tabs and add schedule-level views for **Rota**, **Checks**, and **Summary**, with
sharing behind one action. A visible issue badge should remain on Rota even
when the checks view is closed. The current counted, collapsible checks panel
provides that visibility without changing every navigation flow at once.

## Bugsink and session replay

Start with the reproducible report and runtime checks. A valid-looking but wrong
schedule often causes no JavaScript exception, so crash reporting alone would
have missed the short-shift bug.

Bugsink is a reasonable next addition for uncaught exceptions and deliberately
reported invariant failures: use release/rule identifiers, source maps, and
deduplication. It supports Sentry SDKs but explicitly does **not** support session
replay, tracing, or performance monitoring. [Bugsink comparison](https://www.bugsink.com/sentry-vs-bugsink/)

Consider replay only if reports leave UI failures unreproducible. Mask names and
inputs and remove the URL fragment from automatic telemetry—the fragment holds
the entire roster and schedule. Keep full-plan export an explicit user action.
Sentry provides replay; browser replay reconstructs DOM interactions rather than
capturing a pixel-perfect video. [Sentry replay documentation](https://www.sentry.help/en/articles/13964404-session-replay-faq-web)

## Would MiniZinc be better?

**Promising for the scheduling engine; benchmark it before replacing the current
engine.** Qualification coverage, availability, immutable assignments, rest, and
fairness fit a constraint model well. Model fixed shift slots first, then assign
people; keep hard constraints separate from priorities so impossible rest never
silently prevents staffing. Preserve the independent validator.

The JavaScript interface supports browser WebAssembly and native MiniZinc through
Node. Browser hosting requires worker, WASM, and data assets; the API supports
time limits, solution events, and solver statistics. [MiniZinc JavaScript guide](https://js.minizinc.dev/docs/stable/index.html)

Use the current fixtures as the benchmark: compare coverage, total and continuous
rest, workload, solve time, peak memory, and mobile download cost. Begin with
MiniZinc as a test oracle for small schedules, then an optional solver. Benchmark
the 21-shift case and multi-day plans on the Pixel before adopting browser WASM.

One product constraint needs special attention: the same shared plan currently
recomputes its assignments. A time-limited solver can return different best-so-far
answers on different devices. Stable tie-breaking and versioned solver settings,
or persisting the chosen assignments, are needed before promising identical shared
results. MiniZinc can improve optimization, but a mistaken time model can still
produce short shifts; the regression corpus and runtime checks remain necessary.
