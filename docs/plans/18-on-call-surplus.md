# ADR 018: Lend surplus on-call members to local missions

- Status: Accepted (implementation open)
- Date: 2026-09-17

## Context

An on-call rotation often has more people assigned than must remain immediately
ready. If four people must remain ready and five are in the rotation, one of the
five can stand a nearby post such as ש״ג. The person on the post is still a
member of the rotation, but does not count among its four ready people until the
post ends. Rotating that one released place among all five members can cover five
successive night shifts without weakening the required on-call strength.

The current model cannot express this. ADR 007's `onCall` flag says only that a
mission can be slept through. Its assignments still occupy a person exactly like
every other mission: overlapping pins are rejected, `isFree` treats the member
as busy, the schedule invariant reports any second row as `DOUBLE_BOOKED`, and
workload accounting sums both rows. Relaxing those checks would create an
unexplained double booking, double-charge hours, and let the scheduler lend the
only driver merely because the total headcount still looked sufficient.

ADR 017 deliberately makes one active mission per employee and segment
unrepresentable. This decision extends that representation with a distinct
on-call membership dimension. It does not reverse ADR 017: the person still has
at most one active duty. On-call membership is a concurrent readiness
commitment, not a second active duty.

## Decision

### Required strength and roster target are separate

For an on-call mission, the existing `count` remains the minimum number of
people who must be ready. `nightCount` keeps the same meaning where the mission
type supports it. A new non-negative `extraMembers` value, defaulting to zero,
sets the desired reinforcement above that minimum:

```text
required ready = countAt(on-call mission, instant)
roster target  = required ready + extraMembers
```

Thus four required plus one extra means a target roster of five and at most one
simultaneous release. `extraMembers` is a target, not required staffing. Failing
to fill it must not create an understaffed finding or take somebody away from a
required mission. It is optimized only after required headcount, qualification
coverage, and configured minimum rest have been protected, and before ordinary
fairness tie-breaks.

Actual membership, rather than the configured target, creates capacity. A
four-person roster with a target of five has no spare member and may lend nobody.

All members of the roster are interchangeable candidates for release. There is
no permanently designated "extra person." In the five/four example, any one
member may stand the next eligible local shift, allowing active duty to rotate
fairly across all five.

`extraMembers` is ignored unless `onCall` is true. Turning `onCall` off leaves a
normal mission whose required headcount is still `count`; the dormant extra
value has no scheduling effect. It is an integer, and the resulting roster
target must remain within the existing headcount limit.

### Local missions opt in explicitly

A new `usesOnCallSurplus` boolean on local missions, defaulting to false, says
that a nearby on-call member may cover that mission. A name such as ש״ג and
the existing `local` type do not imply permission: `local` currently describes
rotation and slot behavior, not recall distance or operational policy.

The first version permits on-call relief only for a non-on-call local mission.
It does not lend members to remote or daily missions, between on-call rotations,
or through chains of borrowed people. An employee may have at most one on-call
membership at an instant and at most one active duty. These limits keep the
capacity source unique and the readiness explanation auditable.

### Membership and active duty are different schedule facts

ADR 017's authoritative active-assignment matrix remains:

```text
activeAssignment[employee, segment] = 0 | missionIndex
```

The strict problem and the MiniZinc constraint core add a second bounded value:

```text
onCallMembership[employee, segment] = 0 | onCallMissionIndex
```

A person with only membership is ready. A member whose active assignment is an
eligible local mission is released and is not ready for that segment. A local
assignment derived from on-call capacity carries its source on-call mission in
the result so the UI, exports, and checker never have to guess why the overlap
is legal.

Membership follows the on-call mission's existing slots or indivisible hold.
Starting or ending a local duty does not create an on-call handover or fragment
the rotation. All calculations occur on the prepared global segment grid, so an
off-grid availability, mission, pin, night, or local-duty edge divides capacity
only for its actual interval.

For every segment and on-call mission:

```text
members = employees whose membership names this on-call mission
released = members whose active assignment is an eligible local mission
ready = members - released

size(ready) >= required ready, except for an explicit reported shortfall
ready satisfies the on-call mission's qualification requirements
```

The residual ready crew is checked for both headcount and qualifications. Five
members needing four cannot lend their only driver if a driver must remain
ready. One remaining member may satisfy multiple qualification roles, matching
the existing qualification policy. The borrowed member must independently meet
the target local mission's requirements and exclusions.

### Optimization is joint, not a greedy exception

The solver chooses required staffing, optional membership, and active local
duty together. It must not first lock a five-person roster and discover later
that the fifth person was essential elsewhere. The objective ordering is:

1. preserve manual assignments and established history as fixed facts;
2. minimize required staffing and qualification deficits, including on-call
   ready strength and residual ready qualifications;
3. protect each configured total-rest minimum;
4. fill optional on-call reinforcement targets where doing so harms none of the
   tiers above;
5. preserve the existing total-rest and continuous-rest preferences; and
6. apply active-duty distribution and ordinary fairness.

Coverage gained by lending a member is ordinary required local coverage, so it
participates in tier 2. The optional fifth membership itself participates in
tier 4. This lets an extra membership exist when useful without manufacturing a
shortage elsewhere merely to hit the roster target.

Optimize and fixed-candidate check modes use the same named constraints, as
required by ADR 017. This feature is not added as a special `isFree` bypass in
the legacy greedy scheduler; that would create a second legality definition.

### Rest and fairness account for overlap once

On-call membership remains sleep-compatible under ADR 007. An overlapping
ordinary local duty is awake duty and interrupts both total and continuous rest
for exactly its interval. The rest calculation continues to union awake
intervals, ignoring membership but not the active local row.

Elapsed clock time is charged once for overall workload and carried duty:

```text
committed time = union(on-call membership, active duty)
```

The schedule also reports active-duty minutes separately. Active-duty minutes
and local turns are the fairness tie-break within an on-call roster; otherwise
all five members accrue the same membership time and the same person can be
chosen for every guard shift without receiving additional burden credit.

Readable statistics expose at least committed time, on-call membership time,
and active-duty time. Aggregates and carried history must never obtain fourteen
hours by summing an eight-hour membership with six overlapping guard hours.

### Manual decisions and history remain facts

A manual local assignment may coexist with the person's on-call membership.
Manual assignments are never deleted to restore readiness. If the combination
leaves too few ready or removes a required qualification, both facts remain and
the engine reports the precise on-call shortfall and blocker.

The same is true of elapsed history. Freezing, exporting, and importing retain
both membership and actual local duty, their relationship, and whether the
membership was sleep-compatible at the time. Later edits to `count`,
`extraMembers`, `usesOnCallSurplus`, qualifications, or mission type do not
rewrite recorded duty.

A future manual overlap on a local mission that has not opted in still wins as
a manual fact, but is reported as unauthorized relief and reduces the ready
crew normally. Automatic scheduling never creates that state.

### Findings and presentation explain the capacity

The mission and schedule views distinguish roster size from ready strength. A
typical status reads:

```text
5 in rotation · 4 ready · 1 at ש״ג
```

The borrowed person appears in the on-call roster and on the active local post,
with the source relationship shown rather than a generic conflict indicator.
Their agenda presents the local duty as active and the on-call membership as a
concurrent background commitment. Existing manual-lock and preserved-history
icons retain their meanings on both facts.

Findings distinguish:

- required on-call headcount shortfall;
- residual on-call qualification shortfall;
- an automatic relief attempt rejected because it would violate either one;
- an unauthorized manual relief overlap; and
- an optional roster target that was not filled, shown as status rather than an
  understaffing error.

The mission editor labels the values directly: "Required ready," "Extra in
rotation," and the derived "Roster target." The extra-member input uses the
existing shared MUI number-spinner composition and must be touch-tested on
current Android Chrome.

### URL compatibility is append-only

Under ADR 006, `extraMembers` and `usesOnCallSurplus` take new mission tuple
positions 15 and 16 respectively. False or zero trailing values are trimmed, so
an old plan with neither setting retains its old encoding and behavior. ADR 006's
reservation table is updated when the fields are implemented; no existing
position may be reused.

The nested history record reserves position 4 for the on-call-membership flag
and position 5 for the relief source's mission id and stamped name. New builds
read absent values as ordinary active duty with no relief relationship.

This is backward reading, not bidirectional compatibility. An older build
cannot enforce readiness capacity or represent legal membership-plus-duty
overlap, and therefore cannot safely interpret a link using this feature. The
UI must not claim otherwise.

## Consequences

The common five-for-four rotation can cover one nearby post continuously while
preserving four ready people, and can distribute successive shifts across all
five. Two actual extras can cover two simultaneous eligible posts only when the
remaining crew still satisfies all on-call qualifications.

The schedule model becomes slightly larger but more honest: membership and
active work were already different operational facts. Keeping them separate
preserves ADR 017's single-active-duty guarantee and makes the readiness proof,
rest accounting, history, and UI explanations derive from the same values.

The feature depends on ADR 017's strict problem and shared MiniZinc constraint
core. Implementing it first as a collection of exceptions in the existing
planner would create precisely the competing legality authorities ADR 017
rejects.

## Alternatives rejected

- **Permit any overlap with an on-call row.** This loses the source capacity,
  allows two active jobs, double-counts hours, and cannot protect residual
  qualifications.
- **Treat `count` as roster size and add `minimumReady`.** This changes the
  meaning of every existing on-call link. Keeping `count` as required strength
  makes the new capability additive and matches "need four, add one extra."
- **Infer eligible relief from every local mission.** `local` is a scheduling
  shape, not proof that the person remains close enough or may leave the
  rotation. Explicit opt-in defaults safely.
- **Designate the extra person as the only borrower.** Operationally any member
  may take the post while the others remain ready; fixing one borrower defeats
  the fairness benefit.
- **Fill the extra roster before other missions.** An optional reinforcement
  must not consume the only person who can satisfy required work elsewhere.
- **Count on-call and local rows independently.** Concurrent commitments are
  real, but two rows do not create two hours in one hour of wall-clock time.

## Acceptance evidence required

Implementation is not complete until automated checks cover:

1. Five members, four required: five successive eligible local turns can rotate
   across the roster, with no more than one simultaneous release.
2. A target of five with only four actual members creates no lending capacity.
3. Two actual extras permit two simultaneous releases only when residual
   headcount and qualifications survive.
4. The sole required driver cannot leave; a remaining dual-qualified member may
   satisfy multiple on-call requirements.
5. Two eligible local missions competing for one release produce one covered
   seat and one explicit shortage, according to the established priority
   ladder.
6. Availability, mission, membership, night, pin, and demand boundaries may be
   off-grid; no partial interval receives whole-slot capacity.
7. The borrowed guard's local interval breaks rest, while sleep-compatible
   membership outside it and the other members' membership continue to count as
   rest.
8. Manual and preserved-history overlaps survive replanning, edits, sharing,
   export, and import; invalid combinations remain visible with findings.
9. Committed minutes use interval union, active-duty burden rotates fairly, and
   neither current nor carried totals double-count overlap.
10. Documents without the new fields retain their encoding and assignments;
    new fields round-trip, and unsupported older clients are not presented as
    safe viewers.
11. Candidate checking rejects two active duties, two concurrent on-call
    memberships, unapproved automatic relief, and relief that violates residual
    readiness.
12. The phone UI exposes explicit touch controls and visibly explains roster,
    ready, and released counts in a fresh Pixel-class browser session.
