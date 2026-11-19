/**
 * The second run, and the only constructor of an `AcceptedSchedule`.
 *
 * Optimize mode reported a set of numbers beside a matrix. Check mode takes
 * the matrix, fixes it, and recomputes every one of those numbers through the
 * same core - so "the model computed something other than it claimed" stops
 * being an article of faith and becomes a comparison. It is the defect
 * `prototype/minizinc/check.mjs` was built to catch, and two modes over one
 * core can still exhibit it through the driver: a mis-shaped instance, a cap
 * written to the wrong level, an output decoded against the wrong index.
 *
 * Everything downstream of here - the schedule screen, the exports, and above
 * all the history freeze - takes an `AcceptedSchedule` and nothing wider.
 */

import { assignmentToMatrix, instanceToJsonData } from './compile.ts';
import { decodeSolverOutput, SolverOutputError } from './schemas.ts';
import { LEVEL_COUNT, OBJECTIVE_ORDER } from './types.ts';
import type {
  AcceptedSchedule, CandidateSchedule, FailureReason, InstanceIndex, NamedQuantities,
  SolverInstance,
} from './types.ts';
import type { MiniZincRunner } from './runner.ts';

/** A fixed instance either satisfies the model or it does not. */
const ACCEPTABLE = new Set(['SATISFIED', 'ALL_SOLUTIONS', 'OPTIMAL_SOLUTION']);

export type CheckOutcome =
  | { kind: 'accepted'; accepted: AcceptedSchedule }
  | { kind: 'rejected'; reason: 'unsatisfiable' | 'objective-mismatch' | FailureReason; detail: string }
  | { kind: 'cancelled' };

/**
 * Which claimed quantities the candidate is actually answerable for.
 *
 * Only the levels the ladder *proved* are compared. Below an unproved level
 * the optimize run reported an incumbent's numbers, which the check run is
 * free to disagree with in the sense that nothing claimed them - comparing
 * there would reject perfectly good feasible answers.
 */
function mismatchedQuantities(
  claimed: NamedQuantities,
  recomputed: NamedQuantities,
  provenLevels: number,
): string[] {
  const out: string[] = [];
  for (let level = 1; level <= Math.min(provenLevels, LEVEL_COUNT); level++) {
    const key = OBJECTIVE_ORDER[level - 1];
    if (claimed[key] !== recomputed[key]) {
      out.push(`${key}: optimize said ${claimed[key]}, check says ${recomputed[key]}`);
    }
  }
  return out;
}

export async function checkCandidate(
  instance: SolverInstance,
  index: InstanceIndex,
  candidate: CandidateSchedule,
  runner: MiniZincRunner,
  signal: AbortSignal,
  timeLimitMs: number,
): Promise<CheckOutcome> {
  if (signal.aborted) return { kind: 'cancelled' };

  const data = instanceToJsonData(instance, {
    // Check mode reads neither, but the core declares both, so they are passed
    // at values that cannot affect the question.
    objectiveLevel: 1,
    objectiveCap: Array.from({ length: LEVEL_COUNT }, () => -1),
    candidateAssignment: assignmentToMatrix(
      candidate.assignment,
      instance.employeeCount,
      instance.segmentCount,
    ),
  });

  const run = await runner.run({ entry: 'rota-check.mzn', data, timeLimitMs }, signal);
  if (run.kind === 'cancelled') return { kind: 'cancelled' };
  if (run.kind === 'failed') return { kind: 'rejected', reason: run.reason, detail: run.detail };

  if (run.status === 'UNSATISFIABLE' || run.status === 'UNSAT_OR_UNBOUNDED') {
    return {
      kind: 'rejected',
      reason: 'unsatisfiable',
      detail: 'the candidate assignment does not satisfy the model it came from',
    };
  }
  if (run.status === 'ERROR') return { kind: 'rejected', reason: 'model-error', detail: 'solver reported ERROR' };
  // A fixed instance has one answer and propagates to it, so anything other
  // than "satisfied, here it is" means the run did not answer the question.
  if (!ACCEPTABLE.has(run.status) || run.solutionCount < 1 || run.lastSolution == null) {
    return { kind: 'rejected', reason: 'malformed-output', detail: `check run ended ${run.status} with ${run.solutionCount} solutions` };
  }

  let decoded;
  try {
    decoded = decodeSolverOutput(run.lastSolution, index, instance);
  } catch (error) {
    if (error instanceof SolverOutputError) return { kind: 'rejected', reason: error.reason, detail: error.message };
    return { kind: 'rejected', reason: 'malformed-output', detail: String(error) };
  }

  // The fixing constraint makes this a tautology when everything is right,
  // which is exactly why it is worth asserting: it is not one when the driver
  // has handed the two runs different instances.
  if (decoded.assignment.length !== candidate.assignment.length
    || decoded.assignment.some((value, i) => value !== candidate.assignment[i])) {
    return {
      kind: 'rejected',
      reason: 'dimension-mismatch',
      detail: 'check mode returned a different assignment from the one it was given',
    };
  }

  const mismatches = mismatchedQuantities(candidate.claimed, decoded.quantities, candidate.provenLevels);
  if (mismatches.length > 0) {
    return { kind: 'rejected', reason: 'objective-mismatch', detail: mismatches.join('; ') };
  }

  return {
    kind: 'accepted',
    accepted: {
      revision: candidate.revision,
      assignment: decoded.assignment,
      // The check run's numbers, not the optimize run's: this is the one that
      // recomputed them from the matrix the app is about to show.
      quantities: decoded.quantities,
      diagnostics: decoded.diagnostics,
      proof: candidate.provenLevels >= LEVEL_COUNT ? 'optimal' : 'feasible',
      provenLevels: candidate.provenLevels,
    },
  };
}
