# ADR 014: Exclude individuals, not just qualifications - and keep scarce people free

- Status: Proposed. Depends on ADR 011 for the second half.
- Date: 2026-09-15

## Context

Two related requirements, one of which the document cannot express at all.

**Exclusion by person.** A mission's `excludes` is an array of *tag* ids
(`missionSchema` in `src/lib/planSchema.js`), and an employee carries `tags`. So
the model can say "no commander in the kitchen" but has no way to say "not this
particular person on this mission". The only way to express it today is to mint
a tag that exists solely to name one individual, which pollutes the
qualification list - the same list that drives required-coverage and night-rest
rules - with entries that are not qualifications.

**Keeping scarce people free.** Drivers should not end up on kitchen duty, and
the reason given is not competence: *kitchen duty takes all day and doesn't let
us be flexible*. A driver committed to a long inflexible duty cannot answer the
callout that ADR 013 says arrives without warning. The cost is not to the
kitchen shift; it is to every future decision.

That is a different kind of statement from an exclusion. An exclusion is a hard
"never". This is "avoid, because it spends optionality we will want later" - and
sometimes it should be overruled, when there is genuinely nobody else.

## Decision

### 1. Per-person exclusions

Add exclusions keyed by employee id alongside the existing tag-based ones. Both
are hard filters on automatic assignment, with the same semantics the tag
version already has: **a pin still overrides visibly**, because a manual
assignment is an input fact and not a suggestion (ADR 008, and the rule
established when manual assignments were made absolute).

This is a document change and therefore governed by ADR 006's append-only
discipline: a new position on the mission tuple, written only when non-empty, so
every link already shared encodes to the bytes it always did.

It needs no solver. It is a filter on the candidate list, which is exactly where
the existing tag exclusion already lives, and it can land independently of
everything else here.

### 2. Preferring to keep scarce qualifications uncommitted

This half should **not** be modelled as an exclusion, and should wait for
ADR 011.

As a hard rule it is wrong: if the only people available for the kitchen are
drivers, the kitchen still has to be staffed, and a hard exclusion would report
a shortage instead. As a soft preference it is natural to state and awkward to
bolt onto a greedy walk - it is a statement about the *cost of a whole
assignment*, not about one candidate's suitability for one seat.

A solver expresses it directly as an objective term: penalise assigning a person
holding a scarce qualification to a long or inflexible duty, weighted below hard
coverage and above ordinary fairness. It then trades correctly on its own -
taking a driver for the kitchen only when the alternative is leaving it short.

Two things the model should know, which the document does not record today:

- **Which qualifications are scarce.** Derivable rather than configured: count
  how many people hold each tag against how many seats require it.
- **Which missions are inflexible.** A long mission, or one whose crew cannot
  change mid-way (`remote` and `daily` already mean exactly this), costs more
  optionality than an hourly local slot.

Both are computable from what the document already carries, so this needs no
further wire format change beyond the first half.

## Consequences

Per-person exclusion makes the qualification list mean what it says again -
qualifications, not a place to smuggle individual preferences. Expect it to be
used for things tags currently fake.

The flexibility preference will sometimes produce a schedule that looks less
fair on paper: a driver kept off a long duty carries fewer hours than a
colleague who took it. That is the intended trade, and `spreadMinutes` will
report it as imbalance. It is the same accepted tension as the `rotation`
strategy's large spread (ADR 002) - the number that looks bad is not the number
being optimised.

Neither half changes the past, so both sit safely on top of ADR 009.

## Alternatives rejected

- **A per-person tag as the mechanism.** Works today and is what somebody will
  do in the meantime, but it conflates identity with qualification and silently
  widens whatever a rule keyed on tags means.
- **A hard "drivers never do kitchen" rule.** Reports a shortage on the night
  when only drivers are left, which is precisely when the rota must not refuse
  to produce an answer.
- **A per-mission priority number.** Tempting and too blunt: it says which
  mission wins without saying what is being conserved, and the thing being
  conserved is a person's remaining availability, not a mission's importance.

## Evidence

`missionSchema.excludes` and `employeeSchema.tags` in `src/lib/planSchema.js`;
the candidate filter in `planner.js` phases 2 and 3; ADR 006 for the wire
discipline; ADR 005 for the existing exclusion semantics and the pin override.
