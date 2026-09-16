/**
 * The lexicographic ladder: fourteen solves of one model, each capped by the
 * proven optimum of the one above it.
 *
 * The rule that makes the caps sound is that a level is only ever capped at a
 * value the solver **proved** optimal. A time-limited incumbent is not a
 * proof, so `SATISFIED` ends the ladder where it stands rather than passing a
 * guess down as a constraint - and the candidate then says how many levels are
 * actually claimed, so nothing below the unproved one can be asserted.
 */

import { instanceToJsonData } from './compile.ts'
import { decodeSolverOutput, SolverOutputError } from './schemas.ts'
import { LEVEL_COUNT, OBJECTIVE_ORDER } from './types.ts'
import type {
  CandidateSchedule, FailureReason, InstanceIndex, ProblemRevision, SolverInstance
} from './types.ts'
import type { MiniZincRunner } from './runner.ts'

export interface LadderOptions {
  readonly timeLimitMsPerLevel: number
  readonly signal: AbortSignal
  /** How many levels to walk. Defaults to all of them; the tests lower it. */
  readonly levels?: number
}

export type LadderOutcome =
  | { kind: 'candidate', candidate: CandidateSchedule }
  | { kind: 'infeasible' }
  | { kind: 'unknown', level: number }
  | { kind: 'cancelled' }
  | { kind: 'failed', reason: FailureReason, detail: string }

const UNCAPPED = -1

export async function runLadder (
  instance: SolverInstance,
  index: InstanceIndex,
  runner: MiniZincRunner,
  revision: ProblemRevision,
  options: LadderOptions
): Promise<LadderOutcome> {
  const levels = Math.min(options.levels ?? LEVEL_COUNT, LEVEL_COUNT)
  const caps: number[] = Array.from({ length: LEVEL_COUNT }, () => UNCAPPED)
  let candidate: CandidateSchedule | null = null

  for (let level = 1; level <= levels; level++) {
    if (options.signal.aborted) return { kind: 'cancelled' }

    const data = instanceToJsonData(instance, { objectiveLevel: level, objectiveCap: caps })
    const run = await runner.run(
      { entry: 'rota-optimize.mzn', data, timeLimitMs: options.timeLimitMsPerLevel },
      options.signal
    )

    if (run.kind === 'cancelled') return { kind: 'cancelled' }
    if (run.kind === 'failed') return { kind: 'failed', reason: run.reason, detail: run.detail }

    if (run.status === 'UNSATISFIABLE' || run.status === 'UNSAT_OR_UNBOUNDED') {
      // Only level 1 can honestly be short of people. Past it the caps came
      // from proven optima, so an unsatisfiable instance is a model defect and
      // says so rather than being reported as a staffing shortage.
      if (level === 1) return { kind: 'infeasible' }
      return {
        kind: 'failed',
        reason: 'cap-infeasible',
        detail: `level ${level} unsatisfiable under caps proved at levels 1..${level - 1}`
      }
    }
    if (run.status === 'ERROR') {
      return { kind: 'failed', reason: 'model-error', detail: 'solver reported ERROR' }
    }
    if (run.status === 'UNKNOWN' || run.lastSolution == null) {
      // No incumbent at all. Anything proved above still stands, but this
      // level and everything under it is unanswered.
      return (candidate != null) ? { kind: 'candidate', candidate } : { kind: 'unknown', level }
    }

    let decoded
    try {
      decoded = decodeSolverOutput(run.lastSolution, index, instance)
    } catch (error) {
      if (error instanceof SolverOutputError) {
        return { kind: 'failed', reason: error.reason, detail: error.message }
      }
      return { kind: 'failed', reason: 'malformed-output', detail: String(error) }
    }

    const proven = run.status === 'OPTIMAL_SOLUTION' || run.status === 'ALL_SOLUTIONS'
    candidate = {
      revision,
      assignment: decoded.assignment,
      claimed: decoded.quantities,
      provenLevels: proven ? level : level - 1
    }
    if (!proven) {
      // A time-limited incumbent. Stop here: passing an unproven value down as
      // a cap could make every level under it infeasible for no real reason.
      return { kind: 'candidate', candidate }
    }
    caps[level - 1] = decoded.quantities[OBJECTIVE_ORDER[level - 1]]
  }

  return (candidate != null) ? { kind: 'candidate', candidate } : { kind: 'unknown', level: 1 }
}
