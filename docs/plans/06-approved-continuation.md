# ADR 006: Extend shared plan URLs without reordering existing fields

- Status: Accepted (implemented)
- Date: 2026-09-10

## Context

The plan document lives in a compressed URL, with positional tuples used to keep
links compact. Existing shared links must remain readable as mission types,
shift lengths, and qualifications are added. Reusing tuple positions would
silently change the meaning of stored plans.

## Decision

Append fields at reserved positions and provide defaults for absent values.
Retain the existing schema version for backward reading in the current build.
Trim trailing unset extension fields and omit unused tag definitions so documents
without the extensions retain their previous encoding.

| Tuple | Position | Meaning | Unset |
|-------|----------|---------|-------|
| mission | 0–6 | id, name, type, start, end, count, nightCount | existing conventions |
| mission | 7–8 | day/night shift minutes | 0 |
| mission | 9–10 | daily start/end minutes | null; zero is midnight |
| mission | 11 | flat qualification requirement pairs | [] |
| mission | 12 | excluded tag ids | [] |
| mission | 13 | on-call flag | absent; `1` when on-call |
| mission | 14 | excluded employee ids | [] |
| employee | 4 | qualification ids | [] |
| plan | key `tg` | qualification definitions | omitted |

Mission types encode as local `0`, remote `1`, and daily `2`. Future extension
fields must follow these reservations. Decode through the document schema;
corrupt or unsupported links fall back to an empty document with a notice.
The edit cache follows that fallback so a later edit cannot restore stale data.

Preserve existing valid golden assignments and legacy diagnostics. Test additive
quality findings separately. Correctness fixes are allowed to change previously
invalid results, such as off-grid pin overstaffing; old defects are not promises.

## Consequences

The current build reads old links without migration, and unused extensions do
not enlarge their encoded documents. This is backward compatibility only: old
builds do not reliably understand new daily or qualification semantics.

Viewer-local calendar resolution remains outside the wire format. Equal absolute
planner inputs produce deterministic output, but links opened in different
timezones may resolve daily and nighttime windows differently.

## Alternatives rejected

- Reordering or reusing tuple fields: silently corrupts existing meanings.
- Serializing only full property names: increases URL size.
- Claiming bidirectional compatibility without a version change: older clients
  cannot enforce semantics they do not implement.

## Evidence

Implementation: `src/lib/urlState.js`, `src/lib/planSchema.js`, and
`src/state/PlanContext.jsx`.
Tests: `tests/urlState.test.js`, `tests/daily.document.test.js`,
`tests/tags.url.test.js`, `tests/planner.golden.test.js`, and
`tests/features.e2e.mjs`.

This ADR replaces the completed continuation checklist. Its historical filename
is retained to preserve existing references; accepted domain decisions are
recorded in ADRs 001–005.
