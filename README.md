# מתכנן משמרות — Shift schedule planner

A static, Hebrew RTL shift planner. No backend, database, or accounts. The plan
lives in the URL: copy the link to save or share it. Scheduling runs in the browser
and the app works offline after its assets have loaded and been cached.

## Features

- **Employees:** add individual names or paste a roster, detect duplicate names,
  set availability, and assign qualifications such as driver or commander.
- **Local missions:** rotate crews using the plan's default shift length or a
  mission's own daytime and nighttime lengths and headcounts.
- **Remote missions:** keep the same crew for the entire mission window.
- **Daily missions:** keep one crew for each daily occurrence. MUI time pickers
  use the device locale; 08:00–08:00 means through the following morning. Short duties block
  only their actual hours. Completed duties rotate per mission.
- **Required qualifications:** require a number of qualified people within the
  existing headcount. Prefer separate people for different roles, while allowing
  one person to cover multiple qualifications. Two required drivers still need
  two distinct people.
- **Exclusions:** exclude tagged people from automatic assignment to a mission,
  such as commanders from kitchen duty. Explicit pins override exclusions visibly.
- **Night rest:** configure preferred continuous rest per qualification. Staffing
  continues if rest cannot be preserved, with measured shortfalls shown.
- **On-call missions:** sleep-compatible duty preserves night rest while still
  counting toward workload and blocking overlapping assignments.
- **Numeric inputs:** MUI Number Spinners provide explicit touch buttons, numeric
  keyboard entry, and validated bounds on Android Chrome.
- **Manual assignments:** assign a mission roster, swap or clear individual
  assignments, and preserve unaffected pin ranges. Edits freeze elapsed automatic
  assignments as editable pins.
- **Findings and exports:** inspect shortages and schedule-quality findings;
  share the source link, export CSV or calendars, and copy WhatsApp-formatted text.

### Example

Create driver and commander qualifications and assign them to employees. Require
one of each on a two-person patrol. Exclude commanders from the daily kitchen
mission. Set drivers' preferred night rest to 360 minutes. The planner attempts
coverage and rest, and shows unmet requirements rather than claiming success.

### Limits

Scheduling is deterministic for the same absolute engine inputs, but heuristic:
it does not guarantee equal workloads, no repeated duties, or global optimality.
A full headcount can still lack a required qualification. Missing people,
qualifications, and rest appear alongside the partial schedule.

Daily clock times and night windows resolve in the viewer's timezone, including
calendar-day length changes at daylight-saving transitions. Opening the same link
in another timezone can therefore change these intervals. Current builds read old
links; older builds may not understand new mission types or qualifications.

## Development

```sh
npm ci
npm run dev
```

```sh
npm run lint
npm test
npm run build
npm run preview
```

The production output is `dist/`. Serve it over HTTP(S) using a static file server;
opening `index.html` directly from disk is not the supported workflow.

### Headless browser checks

Browser suites run separately from `npm test`. Playwright is locked with the
development dependencies; install a headless Chromium binary if needed:

```sh
npm ci
npx playwright install chromium
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

With that preview running, use another terminal:

```sh
BASE=http://127.0.0.1:4173 SHOT_DIR=/tmp/guard-e2e node tests/e2e.mjs
BASE=http://127.0.0.1:4173 SHOT_DIR=/tmp/guard-mobile node tests/mobile-viewports.mjs
BASE=http://127.0.0.1:4173 SHOT_DIR=/tmp/guard-features node tests/features.e2e.mjs
BASE=http://127.0.0.1:4173 node tests/number-inputs.e2e.mjs
BASE=http://127.0.0.1:4173 node tests/mui-controls.e2e.mjs
BASE=http://127.0.0.1:4173 node tests/mui-pickers.e2e.mjs
BASE=http://127.0.0.1:4173 node tests/short-shifts.e2e.mjs
BASE=http://127.0.0.1:4173 node tests/assignment-badges.e2e.mjs
```

Set `CHROME=/usr/bin/chromium` to use an installed browser instead. The suites
cover sharing, offline reload, manual assignments, mobile overflow, daily duties,
qualification editing, rest findings, unexpected short shifts, unit corrections,
and computation-error sharing. See [shift boundary checks](docs/shift-boundaries.md)
for the regression and runtime validation design.

## Hosting and CI

The app needs only static hosting. The release workflow in
[`.github/workflows/release.yml`](.github/workflows/release.yml) builds and checks
pushes to `main`, then publishes GitHub Pages, a `guard-static.zip` release asset,
and a Caddy OCI image at `ghcr.io/barakplasma/guard`. Publication success is recorded
in the workflow run; a PR branch does not itself update the production site.

- Pages address: [barakplasma.github.io/guard](https://barakplasma.github.io/guard/).
- Static archive: download from the [releases page](../../releases) and serve with
  any static HTTP server.
- OCI image: run using Kubernetes or another compatible runtime. On this project's
  cluster, expose services through STRRL's `cloudflare-tunnel` Ingress class and
  configure the required Cloudflare Access policy before exposure.

[PR CI](.github/workflows/ci.yml) runs lint, unit/property tests, and the build.
Browser commands above can also be run locally on a headless host.

## Architecture

| Path | Purpose |
|------|---------|
| `src/lib/planner.js` | Pure scheduling orchestration over absolute intervals. |
| `src/lib/strategies.js` | Balanced and rotation candidate ranking. |
| `src/lib/crew.js`, `rest.js` | Qualification selection and preferred-rest assessment. |
| `src/lib/invariants.js` | Independent assignment and timeline validation. |
| `src/lib/planSchema.js` | Document validation, defaults, and calendar adapters. |
| `src/lib/urlState.js` | Positional tuple encoding and compressed URL decoding. |
| `src/lib/pins.js` | Manual assignment edits and elapsed-history freezing. |
| `src/lib/agenda.js` | Day/slot/mission grouping for display and exports. |
| `src/lib/exportCsv.js`, `exportText.js`, `exportIcal.js` | CSV, WhatsApp, and calendar output. |
| `src/state/PlanContext.jsx` | URL-backed document edits. |
| `src/pages/`, `src/components/` | Hebrew RTL interface. |

The URL hash contains the input document, including pins, rather than generated
shifts. There is no backend document store or localStorage save. Corrupt links
open an empty plan with a notice. The source link remains available when schedule
computation fails; exports requiring a result are disabled when none exists.

Scheduling resolves pins first, then remote/daily holds, then chronological local
demands. Scarcity ordering, qualification coverage, rest preferences, and the
selected strategy guide automatic assignments. Independent checks reject engine
invariant violations by default; the schedule screen reports them for diagnosis.
Invalid output cannot become frozen history.

See the [architecture decision records](docs/plans/README.md) for context,
tradeoffs, wire-format reservations, and test evidence. [Contributor guidance](CLAUDE.md)
records implementation guardrails. [UX follow-ups](docs/ux-overhaul-followups.md)
separates completed coverage from remaining review work.

## History

The previous PocketBase-backed Guard v3 is preserved in git history. This app
replaces it with a static, URL-backed planner.
