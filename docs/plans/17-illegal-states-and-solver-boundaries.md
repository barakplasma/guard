# ADR 017: Typed boundaries, with MiniZinc as the schedule authority

- Status: **Accepted, not implemented. Explicitly supersedes ADR 004, which
  failed in practice.** ADR 004's checker remains temporarily as migration
  instrumentation, not as the target architecture or an independent authority.
- Date: 2026-09-16
- Extends: ADR 009 (accepted history), ADR 011 (MiniZinc), ADR 012 (rolling
  horizon), and ADR 015 (carried duty).
- Implementation design, to the class and function level:
  [`docs/minizinc-implementation-design.md`](../minizinc-implementation-design.md).

## Context

The application currently has three representations that are too similar for
the different guarantees they carry:

1. the URL document, which deliberately allows half-entered rows;
2. the normalized input consumed by the hand-written planner; and
3. generated rows, which look usable before their invariants have been checked.

Zod validates the URL document's field shapes, but `planSchema` also accepts
combinations that only make sense while editing: a daily mission without both
clock values, rotation settings on a remote mission, duplicate ids, dangling
live references, or a pin whose lifecycle is ambiguous. The scheduler then
normalizes these cases while it is also constructing a schedule. Callers must
know which normalization has happened and which warnings remain relevant.

ADR 004 attempted to make generated schedules safe with an independent custom
JavaScript checker. It failed as an architecture in practice:

- every new scheduler rule required a matching second implementation;
- the checker covered row geometry but not qualification fulfilment, rest-score
  correctness, fairness optimality or false infeasibility;
- invalid results could still inhabit the normal result branch as
  `engine-bug` warnings, so callers such as history freezing had to know that
  warning convention; and
- its arbitrary interval-row representation still made double booking and
  other illegal values representable, then tried to detect them afterward.

That checker found real bugs and remains useful evidence, but continuing to
grow it would create two scheduling engines whose disagreements need a third
decision. ADR 017 explicitly supersedes ADR 004 rather than extending it.

The MiniZinc prototype adds another boundary. Its Boolean assignment cube
`x[employee, mission, segment]` can represent one employee on two missions at
once, then prohibits that state with a constraint. Its text parser can turn a
missing or malformed cell into `false`, and the lexicographic driver currently
advances after an objective that was not proven optimal. MiniZinc can solve the
model correctly while glue code misstates either the question or the answer.

The design goal is [make illegal states
unrepresentable](https://functional-architecture.org/make_illegal_states_unrepresentable/):
parse ambiguous data once, then expose only representations that express the
domain state actually reached. This does not mean treating a real staffing
shortage as malformed data. A shortage is a valid, explainable result; a silent
shortage, a double booking, or history created from an unchecked result is not.

The owner trusts MiniZinc more than a second scheduling implementation in
TypeScript and does not want a custom checker engine. That determines where
schedule legality lives.

## Decision

### One flow, with explicit states

```text
URL / controls
      |
      v
  DraftPlan -- prepare with Zod --> PreparedProblem
                                       |
                                       v
                            MiniZinc constraint core
                              /                 \
                    optimize assignment    check assignment
                              \                 /
                               v               v
                                AcceptedSchedule
                                  /           \
                                 v             v
                           UI / exports    LoggedDuty
```

These are separate types, not one large object with optional fields:

- **`DraftPlan`** is editable and wire-compatible. Blank names and incomplete
  controls remain representable so typing never destroys the document.
- **`PreparedProblem`** is solver-ready. References resolve, intervals are
  explicit, units are distinct, and mission variants contain only relevant
  fields. Preparation returns structured issues instead of silently inventing
  missing meaning.
- **`CandidateSchedule`** is structured MiniZinc output tied to the exact
  problem revision that produced it. It is not safe for history or export.
- **`AcceptedSchedule`** is a candidate whose parsed assignment was fixed as
  input to MiniZinc's check mode and produced a solution without an
  unsatisfiable, unknown or error outcome.
- **`LoggedDuty`** is an immutable fact copied from an accepted schedule or an
  explicit correction. It contains resolved bounds and historical snapshots,
  not live references that can change meaning later.

APIs accept the narrowest state they need. In particular, history functions
accept `AcceptedSchedule`, never a draft, arbitrary rows, or an unchecked
candidate.

### TypeScript and Zod own the data boundaries

A small strict TypeScript domain core will be introduced around the existing
JavaScript/React application. React migration is incremental; a wholesale UI
rewrite is not part of this decision.

Zod parses every untrusted boundary:

- decoded current and legacy URLs into `DraftPlan`;
- prepared data before it is compiled into MiniZinc indexes;
- MiniZinc's machine-readable output and termination status; and
- persisted or cached values if storage is added later.

Zod checks structure, bounds, dimensions, discriminators and required fields.
It does not use `superRefine` to reproduce scheduling rules. Hiding a custom
schedule checker inside a Zod refinement would still be a custom checker.

The strict core uses branded TypeScript values such as `EmployeeId`,
`MissionId`, `QualificationId`, `InstantMs`, `MinuteOfDay` and
`DurationMinutes`. Brands prevent accidental substitution during development;
Zod supplies their runtime constructors. Membership is still established by
preparation, because a correctly shaped `EmployeeId` does not prove that the
employee exists in this plan.

Prepared missions are a discriminated union:

- `LocalMission` owns day/night headcount and rotation-slot policy;
- `RemoteMission` owns one indivisible interval and crew; and
- `DailyMission` owns a required clock pair and resolved, non-overlapping
  occurrences.

Fields irrelevant to a variant do not exist. The adapter preserves the two
confirmed equal-time meanings: equal daily bounds mean duty until the next day;
equal plan night bounds mean that the night window is disabled.

Preparation also establishes unique ids, resolved live references, positive
half-open intervals, the viewer-timezone night windows, accepted manual
commitments, immutable history inputs and every legal scheduling boundary. It
must reuse the existing calendar and grid rules rather than create a second
implementation of them.

### The assignment shape makes double booking unrepresentable

The authoritative schedule is not an arbitrary list of interval rows. It is a
matrix over the prepared global segment grid:

```text
assignment[employee, segment] = 0 | missionIndex
```

`0` means off duty. A cell can contain only one mission, so an employee cannot
be assigned to two missions in the same segment. Double booking is absent from
the value space instead of being a Boolean-cube state that a later check must
reject.

The MiniZinc decision variable uses the same representation. The current
`array[employee, mission, segment] of var bool` prototype will be replaced by
`array[employee, segment] of var 0..missionCount`.

The grid's segments are disjoint, ordered and exhaustive over the planning
horizon. Computational subdivision does not create a legal handover: each cell
also maps back to its mission slot or indivisible hold. Display rows,
timelines, CSV and iCalendar records are derived views. They never become the
schedule authority.

### MiniZinc owns schedule legality once

One MiniZinc constraint core defines the scheduling rules. Two thin entry
points reuse it:

1. **Optimize mode** leaves the assignment matrix variable and applies the
   lexicographic objective ladder.
2. **Check mode** receives a parsed candidate, fixes the same assignment matrix
   to it, and runs `solve satisfy` against the same constraints.

This is not a second checker implementation. It is the same machine-checked
specification asked two questions: “find an assignment” and “does this exact
assignment satisfy the specification?” MiniZinc also supports solution
checkers and exposes checker messages in its JSON stream; the browser
integration may use that mechanism if it preserves the same shared constraint
source and explicit result states.

The constraint core owns:

- mission headcount and required qualification coverage;
- availability and per-tag/per-person exclusions;
- manual-assignment precedence;
- remote and daily crew continuity;
- legal slot handovers;
- total night rest, continuous-rest metrics and on-call sleepability;
- established history as fixed facts contributing to load and rest; and
- the confirmed objective priority ladder.

Rules are expressed once as named quantities. For example, driver coverage is
derived from the assignment matrix and employee qualifications for every
mission segment. Optimize mode constrains hard violations to zero and minimizes
permitted shortfalls; check mode recomputes the named quantities for the fixed
candidate. TypeScript does not recalculate them.

Insufficient staffing remains representable. Coverage and qualification
deficits are explicit non-negative slack values, minimized before rest and
fairness. An accepted schedule may therefore report a real shortfall, but it
cannot report that a requirement was met when the fixed assignment says it was
not. Manual assignments and recorded history remain hard facts; when they
conflict, MiniZinc returns an explicit infeasible outcome instead of silently
discarding either.

Time-based rules use segment durations, not segment counts. Turns use original
slot identities. Subdividing a segment at an off-grid edge must not change duty
minutes, shortages, rest, fairness or the set of legal handovers.

### Solver results are a discriminated union

MiniZinc output uses its JSON stream rather than regular expressions over item
output. The Zod schema requires exact matrix dimensions, integer cell domains,
named objective values, model version, request revision and a recognized final
status.

The runtime result is one of:

- `optimal`: legal and every completed objective level proved;
- `feasible`: legal but the current objective was not proved optimal;
- `infeasible`: the hard facts conflict;
- `unknown`: no conclusion before the limit;
- `cancelled`: superseded by a newer request; or
- `failed`: model, worker, transport or parsing failure.

The lexicographic ladder advances only after `OPTIMAL_SOLUTION` for the current
level. A feasible incumbent may be shown after check mode accepts it, but its
shortfall must not be described as unavoidable and lower-priority objective
levels must not be claimed. `UNKNOWN`, `ERROR`, malformed output and stale
revisions never produce `AcceptedSchedule`.

Every request revision covers the prepared input, resolved timezone, clock
boundary and model version. New edits cancel older work where possible and
always discard stale completion. While solving, the last accepted schedule may
remain visible as explicitly stale/pending; it cannot be mistaken for the new
document's answer.

### History is a different domain value

Future manual commitments and completed duty will no longer share a pin shape
distinguished by `frozen` and nullable `record` fields.

- A manual commitment references live prepared entities and an explicit scope.
- Logged duty owns absolute bounds, employee and mission snapshots,
  qualifications at the time, original slot identity, and provenance
  (`manual`, `generated`, or `corrected`).

History may intentionally outlive a deleted employee or mission. Current
headcount changes cannot make history invalid. Automatically generated elapsed
duty enters history only from the exact `AcceptedSchedule` the user was shown;
it is never reconstructed by solving again. Corrections remain explicit and
name every affected assignment and rest consequence.

### ADR 004 is superseded

ADR 004 is a failed architecture decision, not a second production authority.
Its implementation remains active only while the old scheduler is active and
then serves as differential migration instrumentation. It is not extended to
mirror new MiniZinc rules.

Once the production path uses the matrix representation, structured output and
MiniZinc check mode, the JavaScript hard-rule checker is removed. UI findings
may remain in TypeScript only when they summarize MiniZinc results or describe
presentation quality rather than independently decide schedule legality.

## Migration

1. Introduce strict TypeScript domain schemas and `DraftPlan ->
   PreparedProblem` while retaining the current URL format and planner.
2. Separate manual commitments, accepted schedules and logged duty. Migrate
   history before making solving asynchronous.
3. Replace the MiniZinc Boolean cube with the single-assignment matrix. Extract
   one shared constraint core, structured JSON output, optimize mode and fixed
   candidate check mode.
4. Add duration-based rest, shortage and workload quantities, plus the remaining
   objective levels from ADR 011. Stop the ladder at the first unproved level.
5. Run the current engine/checker and MiniZinc path differentially over fixtures,
   fuzz cases and tiny exhaustive instances.
6. Switch production to MiniZinc only after browser-worker, offline,
   cancellation, stale-result and Pixel-class resource criteria pass. Then
   remove the hand-written assignment engine and the failed ADR 004 checker.

Each migration step must leave one production authority. There is no period in
which a partially modelled MiniZinc result silently replaces the current
engine.

## Required verification

### Parsing and preparation

- Existing shared links round-trip unchanged, including explicit minute units.
- Malformed discriminators, duplicate ids and dangling live references produce
  structured preparation issues.
- Local, remote and daily variants cannot carry one another's fields after
  preparation.
- Equal daily bounds, disabled night, DST, viewer timezone and off-grid bounds
  retain their confirmed meanings.

### Representation and model

- Matrix schemas reject wrong dimensions and out-of-range mission indexes.
- Property tests establish that no decoded matrix can double-book an employee.
- Manual commitments always win; conflicting commitments are explicitly
  infeasible rather than dropped.
- Required qualification and total-rest diagnostics are recomputed by MiniZinc
  from the fixed candidate.
- A person may cover multiple qualification roles when needed; preferring
  distinct people remains lower priority.
- A metamorphic test subdivides computational segments without changing legal
  handovers and observes identical feasibility and duration-based scores.
- Tiny exhaustive instances compare MiniZinc objectives with the existing
  brute-force oracle.

### Lifecycle and history

- Malformed output, `UNKNOWN`, `ERROR`, unproved objectives and stale revisions
  cannot masquerade as optimal accepted schedules.
- A checked feasible incumbent is usable but never described as proven optimal.
- Cancellation cannot replace the last accepted schedule with a stale answer.
- History survives roster renames/deletions and headcount changes.
- Only named accepted corrections replace preserved history.
- A shift crossing “now” preserves its performed prefix and original slot
  identity.

### Browser delivery

- The shipped WebAssembly worker path, not the native Node binary, completes
  optimize and check modes.
- Offline reload includes every MiniZinc asset.
- Cancellation and repeated solves do not leak workers or unbounded memory.
- Current Android Chrome on Pixel 10 remains the acceptance target.

## Consequences

The application gets one declarative authority for relational scheduling rules
instead of a scheduler and checker that can drift. Zod and TypeScript still
protect the integration without pretending to solve the rota. The state names
make it impossible for history and exports to consume unchecked output through
their typed APIs.

The cost is an incremental TypeScript boundary, a second usually-cheap
satisfiability pass for candidate acceptance, and more deliberate solver status
handling. MiniZinc and its browser worker remain a substantial memory cost, as
ADR 011 records. A defect in the shared model can affect both optimize and check
modes, so small exhaustive oracles and metamorphic tests remain necessary even
though they are tests, not production checker engines.

## Alternatives rejected

- **Use Zod refinements as the schedule checker.** Aggregate coverage, overlap,
  rest and history rules would become a custom JavaScript checker hidden behind
  schema syntax.
- **Keep ADR 004's JavaScript checker.** It failed in practice because the
  second legality implementation remained incomplete and coupled callers to
  warning conventions while still representing illegal schedules.
- **Trust optimizer output without parsing and check mode.** This misses adapter
  bugs, malformed dimensions, stale responses and status mistakes.
- **Keep the Boolean assignment cube.** Double booking remains representable
  and must be prohibited after the fact.
- **Move URL, timezone and history semantics into MiniZinc.** These are domain
  preparation and lifecycle concerns, not finite assignment decisions.
- **Convert the entire React application to TypeScript first.** It delays the
  valuable boundary and combines unrelated migration risk with the solver
  change.

## Sources and evidence

- The representation principle: [Make Illegal States
  Unrepresentable](https://functional-architecture.org/make_illegal_states_unrepresentable/).
- MiniZinc's [machine-readable JSON stream and explicit status
  messages](https://docs.minizinc.dev/en/latest/json-stream.html).
- MiniZinc's [automatic solution-checking
  support](https://docs.minizinc.dev/en/stable/minizinc_ide.html#automatic-solution-checking).
- Zod's [discriminated unions](https://zod.dev/api?id=discriminated-unions) for
  draft/result lifecycle values.
- The current prototype and its measured limits are documented in ADR 011 and
  `prototype/minizinc/README.md`.
