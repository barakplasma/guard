# Scheduling plans

PR #28 uses `claude/tornot-scheduling-plan-vcn99j`. Plans 01–02 were already
implemented when this continuation began. Plans 03–05 are implemented and verified. The [approved continuation](06-approved-continuation.md)
records the user's decisions; individual documents now describe actual behavior.

| Plan | Behavior |
|------|----------|
| [01](01-whole-mission-pin-on-local-mission.md) | Local whole-mission pins appear per slot; swaps and clears preserve the remaining coverage. |
| [02](02-per-mission-shift-length.md) | Per-mission day/night shift lengths and explicit slot identity. |
| [03](03-daily-missions-and-per-job-rotation.md) | Whole daily duties, including full-day 08:00–08:00 kitchen duty, and per-job rotation. |
| [04](04-schedule-constraints.md) | Strict engine checks, report mode on screen, and aggregated quality findings. |
| [05](05-qualifications-and-tags.md) | Qualification coverage, combined-role fallback, exemptions, and preferred nighttime rest. |

## Sequence and compatibility

The original proposed order was 01 → 04 → 02 → 03 → 05. Actual work landed 01 and
02 first; this continuation implements 03 → 04 → 05 on the same PR branch.
Qualification exclusions work for all mission types; daily kitchen duty is one
use case, not a structural dependency of tag filtering.

The motivating rota had 16 people, a whole-mission pin, hourly local missions, and
kitchen incorrectly modeled as continuous hourly rotation. Daily duties now express
the intended window. No fixed workload or no-repeat guarantee can be inferred
without the chosen kitchen hours, qualifications, availability, and manual pins.

Old documents keep their prior URL encoding and golden assignments. Quality
warnings are intentionally additive. Off-grid pins and varying-capacity pin bugs
now produce valid output instead of preserving their previous overstaffing.
Viewer-local daily/night boundaries can differ abroad; the engine is deterministic
for the absolute intervals supplied by the adapter, not across timezones.

## Wire reservations

| Tuple | Position | Meaning | Unset |
|-------|----------|---------|-------|
| mission | 0–6 | id, name, type, start, end, count, nightCount | existing |
| mission | 7–8 | day/night shift minutes | 0 |
| mission | 9–10 | daily start/end minutes | null; zero is midnight |
| mission | 11 | flat qualification requirement pairs | [] |
| mission | 12 | excluded tag ids | [] |
| employee | 4 | qualification ids | [] |
| plan | key `tg` | qualification definitions | omitted |

Mission type `2` is daily. New fields default safely when absent, and trailing
unset positions are trimmed. Future fields must be appended after reserved fields.
No schema version bump is needed for reading old documents in the current build;
old builds do not reliably understand new daily or qualification semantics.

## Verification

Run `npm run lint`, `npm test`, and `npm run build`. Browser acceptance uses the
existing `tests/e2e.mjs`, `tests/mobile-viewports.mjs`, and new
`tests/features.e2e.mjs` against a local built preview. Set `CHROME` to the headless
Chromium binary and `SHOT_DIR` outside the repository. No backend or deployment
changes are part of this work.
