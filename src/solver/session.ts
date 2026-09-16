/**
 * One solve at a time, keyed on the question it answers.
 *
 * Everything asynchronous about the solver path is contained here. A document
 * edit produces a new `PreparedProblem` with a new revision; the session
 * debounces, aborts whatever is in flight, and runs the ladder and then the
 * check. Completion is discarded at three points rather than one - after the
 * ladder, after the check, and inside `onOutcome`'s consumer - because a run
 * that finishes against a document nobody is looking at any more must never
 * become the answer.
 *
 * `acceptedFor(revision)` is the narrow door the freeze uses: it hands back an
 * accepted schedule if and only if it answers *that* revision, so an edit made
 * while a solve is in flight records nothing about elapsed time rather than
 * recording a past nobody was shown.
 */

import { compileInstance, instanceToJsonData } from './compile.ts'
import { checkCandidate } from './check.ts'
import { runLadder } from './ladder.ts'
import { digestOf } from './revision.ts'
import { LEVEL_COUNT, MODEL_VERSION } from './types.ts'
import type {
  AcceptedSchedule, InstanceIndex, PreparedProblem, ProblemRevision, SolveOutcome, SolverInstance
} from './types.ts'
import type { MiniZincRunner } from './runner.ts'

/**
 * The revision of the *instance*, which is what the solver actually sees.
 *
 * `prepareProblem` already stamps an equivalent token on the problem; this is
 * the same question asked one layer down, and the tests use it to assert that
 * two documents which compile to the same instance also share a revision. The
 * ladder parameters are zeroed so a level's cap cannot change a document's
 * identity, and the timezone joins the digest because the nights were resolved
 * in it.
 */
export function revisionOf (problem: PreparedProblem, timeZone: string): ProblemRevision {
  const { instance } = compileInstance(problem)
  const data = instanceToJsonData(instance, {
    objectiveLevel: 0,
    objectiveCap: Array.from({ length: LEVEL_COUNT }, () => 0)
  })
  return digestOf({
    data, model: MODEL_VERSION, timeZone, loggedBefore: problem.loggedBefore
  }) as ProblemRevision
}

export interface SessionOptions {
  readonly runner: MiniZincRunner
  readonly timeLimitMsPerLevel: number
  readonly checkTimeLimitMs: number
  readonly debounceMs: number
  onOutcome: (outcome: SolveOutcome) => void
  /** Injected by the tests so a debounce does not mean a real wait. */
  readonly schedule?: (fn: () => void, ms: number) => unknown
  readonly cancelScheduled?: (handle: unknown) => void
}

export const DEFAULT_LEVEL_TIME_LIMIT_MS = 20_000
export const DEFAULT_CHECK_TIME_LIMIT_MS = 5_000
export const DEFAULT_DEBOUNCE_MS = 400

export class SolveSession {
  #options: SessionOptions

  #latest: ProblemRevision | null = null

  #inFlight: AbortController | null = null

  #pending: unknown = null

  #accepted: AcceptedSchedule | null = null

  #disposed = false

  constructor (options: SessionOptions) {
    this.#options = options
  }

  /**
   * Ask for `problem` to be solved. Returns its revision so the caller can
   * hold on to the identity rather than the object.
   *
   * A request for the revision already in flight, or already accepted, is a
   * no-op: re-solving an answered question is how a schedule flickers.
   */
  request (problem: PreparedProblem): ProblemRevision {
    const revision = problem.revision
    if (this.#disposed) return revision
    if (this.#latest === revision) return revision

    this.#latest = revision
    this.#inFlight?.abort()
    this.#inFlight = null
    if (this.#pending != null) {
      (this.#options.cancelScheduled ?? clearTimeout)(this.#pending as never)
      this.#pending = null
    }
    const start = () => {
      this.#pending = null
      if (this.#disposed || this.#latest !== revision) return
      const controller = new AbortController()
      this.#inFlight = controller
      void this.#solve(problem, controller.signal)
    }
    this.#pending = (this.#options.schedule ?? setTimeout)(start, this.#options.debounceMs)
    return revision
  }

  /** The last accepted schedule, if and only if it answers `revision`. */
  acceptedFor (revision: ProblemRevision | null | undefined): AcceptedSchedule | null {
    if ((revision == null) || (this.#accepted == null)) return null
    return this.#accepted.revision === revision ? this.#accepted : null
  }

  /** The last accepted schedule whatever it answers - the stale banner's input. */
  lastAccepted (): AcceptedSchedule | null {
    return this.#accepted
  }

  dispose (): void {
    this.#disposed = true
    this.#inFlight?.abort()
    this.#inFlight = null
    if (this.#pending != null) {
      (this.#options.cancelScheduled ?? clearTimeout)(this.#pending as never)
      this.#pending = null
    }
    void this.#options.runner.dispose()
  }

  #emit (revision: ProblemRevision, outcome: SolveOutcome): void {
    if (this.#disposed || this.#latest !== revision) return
    this.#options.onOutcome(outcome)
  }

  async #solve (problem: PreparedProblem, signal: AbortSignal): Promise<void> {
    const revision = problem.revision
    let instance: SolverInstance
    let index: InstanceIndex
    try {
      ({ instance, index } = compileInstance(problem))
    } catch (error) {
      this.#emit(revision, { kind: 'failed', revision, reason: 'model-error', detail: String(error) })
      return
    }

    const ladder = await runLadder(instance, index, this.#options.runner, revision, {
      timeLimitMsPerLevel: this.#options.timeLimitMsPerLevel,
      signal
    })
    if (this.#latest !== revision || signal.aborted) return

    if (ladder.kind === 'cancelled') { this.#emit(revision, { kind: 'cancelled', revision }); return }
    if (ladder.kind === 'infeasible') { this.#emit(revision, { kind: 'infeasible', revision, level: 1 }); return }
    if (ladder.kind === 'unknown') { this.#emit(revision, { kind: 'unknown', revision, level: ladder.level }); return }
    if (ladder.kind === 'failed') {
      this.#emit(revision, { kind: 'failed', revision, reason: ladder.reason, detail: ladder.detail })
      return
    }

    const checked = await checkCandidate(
      instance, index, ladder.candidate, this.#options.runner, signal, this.#options.checkTimeLimitMs
    )
    if (this.#latest !== revision || signal.aborted) return

    if (checked.kind === 'cancelled') { this.#emit(revision, { kind: 'cancelled', revision }); return }
    if (checked.kind === 'rejected') {
      const reason = checked.reason === 'unsatisfiable' ? 'objective-mismatch' : checked.reason
      this.#emit(revision, { kind: 'failed', revision, reason, detail: checked.detail })
      return
    }

    this.#accepted = checked.accepted
    this.#emit(revision, checked.accepted.proof === 'optimal'
      ? { kind: 'optimal', accepted: checked.accepted }
      : { kind: 'feasible', accepted: checked.accepted })
  }
}
