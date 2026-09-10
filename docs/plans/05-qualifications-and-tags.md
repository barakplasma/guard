# 05 · Qualifications and preferred nightly rest

**Status:** implemented and verified on PR #28’s branch.
**Approved decisions:** [continuation](06-approved-continuation.md).

## Document and editing

Plan tags are `{id, name, minNightRestMinutes}`. Employees reference tag ids in
`tags`; missions carry `requires: [{tag, count}]` and `excludes: string[]`.
Empty lists preserve old behavior. Rest is optional, in positive minutes.
Deleting a tag confirms reference counts and removes its employee and mission
references in one update. Renaming keeps stable ids.

Wire reservations: employee position 4 is tags; mission positions 11 and 12 are
requirements and exclusions; plan key `tg` holds qualification definitions. Daily
bounds keep positions 9–10. Empty new fields are omitted without changing old URL
bytes. Unknown new features are not guaranteed to work correctly in old clients.

## Crew selection

Requirements describe coverage within the existing headcount, not extra seats.
One person can cover different qualifications; a count of two drivers still needs
two distinct people. Prefer different people for roles when possible, but combined
roles are allowed, including driver and commander. No forbidden-pair editor.

Selection searches qualification groups exactly within the current candidate pool:
maximize fulfilled requirements, then the number of roles assigned to distinct
people, then strategy preference. Members with identical qualifications retain
strategy order. Pins already occupying the window count toward coverage. Duplicate
requirements for one tag describe the greatest minimum rather than adding seats.

Automatic candidates with excluded tags are filtered out for every mission type.
An explicit excluded pin stands and gets an informational finding. A tag required
and excluded on the same mission yields a configuration warning; the UI disables
adding contradictory choices while retaining removable imported selections.

Unfulfilled qualifications are errors, aggregated by mission/tag with affected
ranges and shown on existing agenda slots. An unqualified pinned crew may fill
headcount yet still fail coverage. Remaining useful duties continue to be staffed.
This is a partial schedule, not an exception or proof of global infeasibility.

## Nightly rest

Rest is a preferred continuous off-duty interval, **not a staffing veto**. Before
filling automatic duties, choose deterministic preferred blocks around pins and
spread them where possible. Pin boundaries and half-hour candidates guide the
block search. Their boundaries split the segment grid; they never count as work.

Try rest-preserving crews first when they can provide the same headcount and
qualification coverage. Combined roles that preserve rest beat unnecessary role
separation that breaks it. Otherwise fill duties anyway and report actual rest
shortfalls. The largest applicable tag target wins for a person.

Measure the longest continuous off-duty interval in the final schedule, including
pinned duties. Partial nights/availability receive incomplete-assessment warnings,
not false certification. Preferred blocks are heuristic: diagnostics describe this
schedule and never claim that another globally feasible schedule cannot exist.
Two drivers sleeping six hours each cannot cover an eight-hour night by themselves.

## UI, exports, and verification

The Employees page manages tags and rest targets and assigns tags to people.
Missions specify requirements/counts and exemptions. Agenda shows qualifications,
coverage errors, and aggregated rest findings. Readable plan and CSV include named
qualifications and requirements. Raw internal ids are not the main user labels.

Tests cover combined roles, distinct-person counts, pins, exclusions, scarcity,
partial coverage, rest preservation/fallback, multiple rest tags, partial nights,
URL round trips, deletion, and exports. Headless browser tests exercise creation,
selection, sharing, deletion, shortage display, and portrait/desktop layouts.
General weekly caps, tag inheritance, and globally optimal scheduling are out of scope.
