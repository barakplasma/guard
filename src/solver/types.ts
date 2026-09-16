/**
 * The typed boundary ADR 017 asks for.
 *
 * Every value here is `readonly`, and the three schedule values are
 * deliberately *not* interchangeable: a `CandidateSchedule` is what optimize
 * mode claimed, an `AcceptedSchedule` is what check mode recomputed, and only
 * the second one may ever reach history. `checkCandidate` (check.ts) is the
 * one function that constructs an `AcceptedSchedule`, and the type has no
 * other constructor, so "history was appended from what was accepted" is a
 * thing the compiler enforces rather than a convention.
 *
 * Brands are erasable intersections, not classes: this file is stripped by
 * Node and by Vite alike, so nothing here may emit code (see tsconfig's
 * `erasableSyntaxOnly`).
 */

declare const brand: unique symbol
type Brand<T, B extends string> = T & { readonly [brand]: B }

export type EmployeeId = Brand<string, 'EmployeeId'>
export type MissionId = Brand<string, 'MissionId'>
export type QualificationId = Brand<string, 'QualificationId'>
/** An absolute ms epoch. The solver never sees one - see `compile.ts`. */
export type InstantMs = Brand<number, 'InstantMs'>
export type DurationMinutes = Brand<number, 'DurationMinutes'>
/** 1-based, matching the model's `Segments` index set. */
export type SegmentIndex = Brand<number, 'SegmentIndex'>
export type ProblemRevision = Brand<string, 'ProblemRevision'>

export interface Interval {
  readonly start: InstantMs
  readonly end: InstantMs
}

/** Must equal `MODEL_VERSION` in `model/rota-core.mzn`; asserted by tests/solver.model.test.js. */
export const MODEL_VERSION = 1

/** Must equal `LEVEL_COUNT` in `model/rota-core.mzn`. */
export const LEVEL_COUNT = 14

/**
 * Eight hours off: the rest target the owner optimises for, and the cap on how
 * far back the round-robin queue remembers. Six hours is deliberately *not* a
 * constant - it is the configured per-qualification minimum on a tag.
 */
export const TARGET_REST_MINUTES = 480

/** One byte per cell, so 255 is the largest mission index the matrix can hold. */
export const MAX_MISSIONS = 255

/* ------------------------------------------------------------------ */
/* Prepared problem                                                    */
/* ------------------------------------------------------------------ */

/** What the log says about one person over the memory horizon. */
export interface DutyMemory {
  /** Since their last logged duty, capped at `TARGET_REST_MINUTES`. */
  readonly idleMinutesAtHorizonStart: DurationMinutes
  readonly turns: number
  readonly nightMinutes: DurationMinutes
  readonly turnsOnMission: ReadonlyMap<MissionId, number>
  readonly heldWithinCooldown: ReadonlySet<MissionId>
  /** 24 counts: turns begun in each hour of the day, on the viewer's clock. */
  readonly hourHolds: readonly number[]
}

export interface PreparedEmployee {
  readonly id: EmployeeId
  /** Clamped to the horizon. */
  readonly available: Interval
  readonly qualifications: ReadonlySet<QualificationId>
  /** 0 when no tag the person holds asks for one. */
  readonly requiredNightRestMinutes: DurationMinutes
  readonly memory: DutyMemory
}

export interface Requirement {
  readonly tag: QualificationId
  readonly seats: number
}

export interface Exclusions {
  readonly tags: ReadonlySet<QualificationId>
  readonly employees: ReadonlySet<EmployeeId>
}

interface MissionCommon {
  readonly id: MissionId
  readonly requires: readonly Requirement[]
  readonly exclusions: Exclusions
  readonly onCall: boolean
  /** The once-per-rotation rule: 7, 14 or 21 for the kitchen. `null` = no rule. */
  readonly repeatAfterDays: number | null
}

export type PreparedMission =
  | (MissionCommon & {
    readonly kind: 'local'
    readonly window: Interval
    readonly daySeats: number
    readonly nightSeats: number
    /** Ascending slot bounds from the engine's own grid, never recomputed. */
    readonly slotBounds: readonly InstantMs[]
    /** The mission's own segments, as `segmentGrid` cut them. */
    readonly segments: readonly Interval[]
  })
  | (MissionCommon & {
    readonly kind: 'remote'
    readonly window: Interval
    readonly seats: number
  })
  | (MissionCommon & {
    readonly kind: 'daily'
    readonly window: Interval
    readonly occurrences: readonly Interval[]
    readonly seats: number
  })

/** A manual pin or a logged record, resolved to literal instants. */
export interface Commitment {
  readonly employeeId: EmployeeId
  readonly missionId: MissionId
  readonly coverage: Interval
  readonly provenance: 'manual' | 'logged'
}

/**
 * Findings raised while reading the document, keyed on `code` so
 * `findings.js` renders them exactly as it renders the engine's warnings
 * today. Every code below either already exists in `planner.js`'s `WARN` or is
 * new and informational.
 */
export type PreparationIssue =
  | { readonly code: 'mission-outside-window', readonly missionId: MissionId, readonly start?: InstantMs, readonly end?: InstantMs }
  | { readonly code: 'employee-window-outside-plan', readonly employeeId: EmployeeId }
  | { readonly code: 'daily-missing-clock', readonly missionId: MissionId }
  | { readonly code: 'tag-required-and-excluded', readonly missionId: MissionId, readonly tag: QualificationId }
  | { readonly code: 'pin-conflict', readonly missionId: MissionId, readonly employeeId: EmployeeId }
  | { readonly code: 'pin-overflow', readonly missionId: MissionId, readonly employeeId: EmployeeId }
  | { readonly code: 'pin-unavailable', readonly missionId: MissionId, readonly employeeId: EmployeeId }
  | { readonly code: 'pin-availability-overridden', readonly missionId: MissionId, readonly employeeId: EmployeeId, readonly start: InstantMs, readonly end: InstantMs }
  | { readonly code: 'pin-out-of-period', readonly count: number, readonly elapsed: number }
  | { readonly code: 'cooldown-beyond-memory', readonly missionId: MissionId, readonly repeatAfterDays: number, readonly memoryDays: number }
  | { readonly code: 'too-many-missions', readonly count: number, readonly limit: number }

export interface PreparedProblem {
  readonly horizon: Interval
  readonly loggedBefore: InstantMs
  /** Viewer-timezone, already resolved by `nightWindows` in planSchema.js. */
  readonly nights: readonly Interval[]
  readonly employees: readonly PreparedEmployee[]
  readonly missions: readonly PreparedMission[]
  readonly commitments: readonly Commitment[]
  /** How far back the log is read. Default 21. */
  readonly memoryDays: number
  readonly issues: readonly PreparationIssue[]
  readonly revision: ProblemRevision
}

/* ------------------------------------------------------------------ */
/* Solver-side values                                                  */
/* ------------------------------------------------------------------ */

/**
 * The parameter list of `rota-core.mzn`, name for name, so a reader can hold
 * the two side by side. Only the ladder parameters are added per run.
 */
export interface SolverInstance {
  readonly employeeCount: number
  readonly missionCount: number
  readonly segmentCount: number
  readonly nightCount: number
  readonly pinCount: number
  readonly requirementCount: number
  readonly longRunWindowCount: number
  readonly sleepWindowCount: number

  readonly segmentMinutes: readonly number[]
  readonly nightOfSegment: readonly number[]
  readonly seatsWanted: ReadonlyArray<readonly number[]>
  readonly slotOfSegment: ReadonlyArray<readonly number[]>
  readonly holdOfSegment: ReadonlyArray<readonly number[]>

  readonly isAvailable: ReadonlyArray<readonly boolean[]>
  readonly isAllowed: ReadonlyArray<readonly boolean[]>

  readonly idleMinutesAtHorizonStart: readonly number[]
  readonly recentTurns: readonly number[]
  readonly recentNightMinutes: readonly number[]
  readonly recentTurnsOnMission: ReadonlyArray<readonly number[]>
  readonly heldWithinCooldown: ReadonlyArray<readonly boolean[]>
  readonly recentHourHolds: ReadonlyArray<readonly number[]>
  readonly hourOfSegment: readonly number[]
  readonly repeatAfterDays: readonly number[]
  readonly requiredNightRestMinutes: readonly number[]
  readonly symmetryClass: readonly number[]

  readonly isSleepable: readonly boolean[]

  readonly pinEmployee: readonly number[]
  readonly pinMission: readonly number[]
  readonly pinSegment: readonly number[]

  readonly requirementMission: readonly number[]
  readonly requirementSeats: readonly number[]
  readonly holdsRequirement: ReadonlyArray<readonly boolean[]>

  readonly longRunFirstSegment: readonly number[]
  readonly longRunLastSegment: readonly number[]

  readonly sleepWindowFirstSegment: readonly number[]
  readonly sleepWindowLastSegment: readonly number[]
  readonly sleepWindowNight: readonly number[]
}

/** How to read the answer back. */
export interface InstanceIndex {
  /** The global grid. Model-side indices are these plus one. */
  readonly segments: readonly Interval[]
  readonly employeeIds: readonly EmployeeId[]
  readonly missionIds: readonly MissionId[]
  /** `[missionIndex][segmentIndex]`, 0-based on this side. */
  readonly slotOfSegment: ReadonlyArray<readonly number[]>
  readonly holdOfSegment: ReadonlyArray<readonly number[]>
  /** The absolute bounds of every slot id, so a row can be stamped without re-deriving one. */
  readonly slotBoundsById: ReadonlyMap<number, Interval>
  readonly nights: readonly Interval[]
  readonly requirementCount: number
}

/** One field per objective, plus the wait the round robin is scored on. */
export interface NamedQuantities {
  readonly unmetQualificationMinutes: number
  readonly unfilledSeatMinutes: number
  readonly slotHandoverCount: number
  readonly restShortfallMinutes: number
  readonly targetRestShortfallMinutes: number
  readonly nightsWithoutTargetSleep: number
  readonly longRunCount: number
  readonly cooldownBreachCount: number
  readonly waitDeficitMinutes: number
  readonly turnSpread: number
  readonly sharedRoleCount: number
  readonly nightDutySpreadMinutes: number
  readonly missionRepeatCost: number
  readonly nightHourRepeatCost: number
  readonly shortestWaitMinutes: number
}

/** The per-cell outputs of check mode, dimension-checked by `schemas.ts`. */
export interface SegmentDiagnostics {
  readonly seatsFilled: ReadonlyArray<readonly number[]>
  readonly qualifiedSeatsFilled: ReadonlyArray<readonly number[]>
  readonly nightRestMinutes: ReadonlyArray<readonly number[]>
  readonly sleepsTarget: ReadonlyArray<readonly boolean[]>
  readonly longRunsByEmployee: readonly number[]
  readonly dutyMinutes: readonly number[]
  readonly turnsTaken: readonly number[]
  readonly turnsOnMission: ReadonlyArray<readonly number[]>
  readonly nightMinutesInWindow: readonly number[]
}

/**
 * What optimize mode claimed. Has no method that yields rows: nothing outside
 * `check.ts` may read an assignment off one.
 */
export interface CandidateSchedule {
  readonly revision: ProblemRevision
  /** `employee * segmentCount + segment`, 0-based, 0 = off duty. */
  readonly assignment: Uint8Array
  readonly claimed: NamedQuantities
  readonly provenLevels: number
}

/** What check mode recomputed, and the only thing history may be built from. */
export interface AcceptedSchedule {
  readonly revision: ProblemRevision
  readonly assignment: Uint8Array
  readonly quantities: NamedQuantities
  readonly diagnostics: SegmentDiagnostics
  readonly proof: 'optimal' | 'feasible'
  readonly provenLevels: number
}

export type FailureReason =
  | 'model-error' | 'worker' | 'malformed-output' | 'dimension-mismatch'
  | 'objective-mismatch' | 'cap-infeasible' | 'stale-revision'

export type SolveOutcome =
  | { readonly kind: 'optimal', readonly accepted: AcceptedSchedule }
  | { readonly kind: 'feasible', readonly accepted: AcceptedSchedule }
  | { readonly kind: 'infeasible', readonly revision: ProblemRevision, readonly level: 1 }
  | { readonly kind: 'unknown', readonly revision: ProblemRevision, readonly level: number }
  | { readonly kind: 'cancelled', readonly revision: ProblemRevision }
  | { readonly kind: 'failed', readonly revision: ProblemRevision, readonly reason: FailureReason, readonly detail: string }

/**
 * The objectives in ladder order. One list, read by `ladder.ts` to cap the
 * level it has just proved and by `check.ts` to compare the two runs, so the
 * order can never drift from `rota-core.mzn`'s `objectives` array without
 * `tests/solver.check.test.js` noticing.
 */
export const OBJECTIVE_ORDER = [
  'unmetQualificationMinutes',
  'unfilledSeatMinutes',
  'slotHandoverCount',
  'restShortfallMinutes',
  'targetRestShortfallMinutes',
  'nightsWithoutTargetSleep',
  'longRunCount',
  'cooldownBreachCount',
  'waitDeficitMinutes',
  'turnSpread',
  'sharedRoleCount',
  'nightDutySpreadMinutes',
  'missionRepeatCost',
  'nightHourRepeatCost'
] as const satisfies ReadonlyArray<keyof NamedQuantities>
