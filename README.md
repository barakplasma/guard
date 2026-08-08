# מתכנן משמרות — Shift schedule planner

A **fully static** shift planner. No backend, no database, no accounts. You enter the people and
the missions, press **תכנן**, and get a calendar agenda showing every shift, who is on duty, and
who is free at any moment. The whole plan lives in the URL, so sharing it is copying a link — and
once the page has loaded, it keeps working with no network at all.

## What it does

- **Employees** — add names (one at a time or paste a list). Everyone is available for the whole
  period by default; narrow it per person when you need to.
- **Missions** — each has a name, a time window, how many people it needs, and a type:
  - **מרוחקת / remote** — the *same* people staff it end to end. They are locked out of everything
    else while it runs.
  - **מקומית / local** — people rotate every shift length, balancing total hours and pushing each
    person's turns as far apart as possible.
- **Manual control** — assign specific people to a mission from the Missions page, or swap anyone
  in any generated shift with one dropdown on the schedule. Manual choices are remembered and
  travel with the shared link.
- **Export** — download a CSV (Excel-safe Hebrew), or copy a message formatted for WhatsApp. A
  separate calendar section downloads an iCal file, for the whole team or for one person.
- **Offline** — a service worker precaches the app; all scheduling runs in the browser.

### Example

Ten employees, a remote mission needing four, and a local mission needing two: the four are locked
to the remote mission for its whole duration, and the remaining six rotate through the local one,
each working the same total time with the longest possible gap between turns.

## Self-hosting

Three options, all built automatically by CI on every push to `main`:

### 1. GitHub Pages

Live at **https://barakplasma.github.io/guard/** — nothing to do, it's already deployed.

### 2. Download and serve (no container runtime)

Grab `guard-static.zip` from the [latest release](../../releases/latest), unzip,
and serve the folder with any static file server:

```bash
unzip guard-static.zip -d guard && cd guard
python3 -m http.server 8080
# or: npx serve , or: caddy file-server --listen :8080
```

### 3. OCI image (Caddy, automatic HTTPS)

```bash
# HTTP only (behind a reverse proxy, or local testing):
docker run -p 80:80 ghcr.io/barakplasma/guard:latest

# Automatic HTTPS with your domain:
docker run -e DOMAIN=guard.example.com -p 80:80 -p 443:443 ghcr.io/barakplasma/guard:latest
```

Caddy provisions and renews Let's Encrypt certificates on its own.

## Running it

```bash
npm install
npm run dev        # development server
npm run build      # static site into dist/
npm run preview    # serve the built site
npm test           # scheduler unit tests + property-based invariants
npm run lint
```

`dist/` is plain static files — host it anywhere, or open `dist/index.html` from disk.

### CI/CD

Every push to `main` runs `.github/workflows/release.yml`, which:
1. Builds and runs unit tests.
2. Runs browser e2e tests against the built app (Playwright).
3. Publishes to three channels in parallel: GitHub Pages, a rolling Release zip, and
   the Caddy OCI image on GHCR.
4. Verifies each channel after it ships (HTTP smoke tests against the container and
   the Pages URL).

PR validation (lint + tests + build) runs in `ci.yml`.

### Browser end-to-end check

`tests/e2e.mjs` drives the built app in a real browser — planning, hand-assignment, swapping, both
exports, opening a shared link in a clean profile, and reloading with the network switched off. It
is not part of `npm test` because it needs a browser and a running server:

```bash
npm run build
npx vite preview --port 4173 --strictPort &
npm i --no-save playwright && npx playwright install chromium
node tests/e2e.mjs
```

## How it works

| Path | Purpose |
| --- | --- |
| `src/lib/planner.js` | The scheduling engine. Pure, dependency-free, deterministic. |
| `src/lib/planSchema.js` | The plan document: zod schema, defaults, normalization. |
| `src/lib/urlState.js` | Compresses the document into the URL hash and back. |
| `src/lib/pins.js` | Manual-assignment edits: swapping, clearing, mission rosters. |
| `src/lib/agenda.js` | Groups shifts into the day → slot → mission tree the UI and exports share. |
| `src/lib/exportCsv.js`, `exportText.js` | CSV and WhatsApp output. |
| `src/pages/`, `src/components/` | The Hebrew RTL interface. |

### State lives in the URL

The document is squeezed into positional tuples, LZ-compressed, and written to the hash's query
string (`#/schedule?p=…`) — typically a few hundred characters. There is no server and no
localStorage: the link *is* the save file. A corrupt or truncated link opens an empty plan with a
notice rather than failing.

Times are stored as absolute instants and rendered in each viewer's own timezone.

### Manual assignments are inputs, not edits

A hand-made assignment ("pin") is stored in the plan document and fed back into the engine, rather
than patching the generated output. That is what makes the schedule a pure function of the
document: re-planning, reloading, and sharing all reproduce exactly the same result, and swapping
one person automatically frees the other to be rescheduled fairly elsewhere.

A pin's `start`/`end` may be null, meaning "inherit the mission's window" — so the same stretch of
time can be described two ways, and any edit keyed on the literal range will miss one of them. That
is why `src/lib/pins.js` matches by *coverage*, and it is kept pure so the rule is directly
testable.

### Scheduling order

1. Pins are placed first — they are immovable.
2. Remote missions claim their people next, scarcest mission first.
3. Local missions fill the remaining time on a segment grid built from the shift length plus every
   mission and availability edge, so a mission starting mid-slot is clamped rather than rounded.
4. For each segment the candidate with the fewest minutes so far wins; ties break toward whoever
   has been off duty longest, then round-robin.

Not having enough people is reported as a warning alongside a partial schedule — it is a normal
state while editing, not an error.

## History

This repository previously held "Guard v3", a PocketBase-backed roster app that required a running
server. That is preserved in git history on `main`; this app replaces it with something that needs
no backend at all.
