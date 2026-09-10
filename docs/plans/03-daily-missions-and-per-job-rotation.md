# 03 · Daily missions, held whole, rotated per job

**Status:** implemented and verified on PR #28’s branch.
**Approved decisions:** [continuation](06-approved-continuation.md).

## Behavior

A `daily` mission has `dayStart` and `dayEnd` in minutes past midnight and a
headcount per occurrence. Inputs use 24-hour notation. Equal times, such as
08:00–08:00, mean duty until the following morning. An earlier end crosses
midnight. Missing either bound yields no occurrence and a visible editing hint.

The adapter resolves calendar-local occurrences in the viewer's timezone, as
night windows already do. Date arithmetic preserves wall-clock time across DST;
a full calendar day may therefore last 23 or 25 hours. Occurrences are clamped to
both the mission and plan bounds. The preceding day contributes its overlapping
part. The engine receives only absolute, non-overlapping intervals.

Daily missions ignore night headcount and local shift-length settings. One crew
holds each occurrence uninterrupted. Its duty blocks other assignments only
inside those hours: a full-day kitchen assignment includes the night, while an
08:00–14:00 kitchen assignment does not create a separate nighttime exemption.

## Scheduling and pins

Remote holds and daily occurrences fill before automatic local segments, ordered
by start, candidate scarcity, duration, and stable identity. Pins precede both.
Daily edges split local segments so a kitchen boundary cannot strand a partially
available guard slot. Occurrences remain separate rows, turns, and calendar events
when the same person holds adjacent days.

Both daily strategies rank completed turns on the same mission first. Rotation
then uses the last completed mission turn, total turns, and ring order; balanced
uses past minutes, last duty end, and sequence. Future pins do not count as past
turns. A clipped occurrence is still one turn. No-repeat guarantees require equal
availability and no conflicting pins or duties; shortages can require repeats.

A whole-mission pin covers every occurrence. A ranged pin snaps to each occurrence
it positively overlaps. Claims deduplicate and consume seats per occurrence.
Pin editing uses effective occurrence coverage: clearing or swapping one day
preserves other days, other people, and frozen flags. Elapsed occurrences freeze
only once ended; out-of-period ranged history remains removable.

## Document and UI

Mission type code `2`; tuple positions `9` and `10` contain daily bounds. `null`
means unset, while zero is midnight and must survive trimming. Existing unused
fields keep their previous bytes. Old clients do not understand daily missions
and may interpret them as local: forward opening is not a safety guarantee.

The Missions page has a daily type toggle, time fields, next-day hint, and
headcount. Agenda, readable plan, CSV, WhatsApp, and calendar retain occurrence
boundaries. CSV includes an end-date column when any row crosses a date boundary.

## Verification

Document tests cover midnight, missing bounds, clipping, overnight periods, and
Israel DST. Engine tests cover both rotations, full holds, local conflicts,
future pins, and per-occurrence capacity. Pin tests cover partial ranges, clearing,
swapping, freezing, and cleanup. Export tests prevent consecutive daily holds from
being welded into one calendar event. `features.e2e.mjs` exercises real controls,
sharing, and phone layout. Existing golden assignment fixtures are unchanged.
