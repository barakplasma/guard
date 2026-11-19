import { planSchema } from '../src/lib/planSchema.js';
import { prepareProblem } from '../src/solver/prepare.ts';
import { compileInstance } from '../src/solver/compile.ts';
import { runLadder } from '../src/solver/ladder.ts';
import { checkCandidate } from '../src/solver/check.ts';
import { minizincAvailable, NativeRunner } from '../src/solver/nativeRunner.ts';

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/**
 * Whether the tests that need a real solver can run.
 *
 * They report *skipped* when it is absent rather than quietly passing: a green
 * run that proved nothing is worse than a red one, and CI installs the binary
 * precisely so these do not skip there.
 */
export const hasSolver = minizincAvailable();
export const skipWithoutSolver = { skip: hasSolver ? false : 'minizinc is not on PATH' };

export function docOf(overrides) {
  const start = overrides.start ?? new Date(2026, 0, 5, 12, 0, 0, 0).getTime();
  return planSchema.parse({
    version: 1,
    start,
    end: start + DAY,
    shiftMinutes: 60,
    employees: [],
    missions: [],
    pins: [],
    ...overrides,
  });
}

export function people(count, extra = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `e${index + 1}`, name: `Emp${index + 1}`, ...extra,
  }));
}

export function prepared(doc, now = doc.start) {
  return prepareProblem(doc, { now });
}

export function compiled(doc, now = doc.start) {
  const problem = prepared(doc, now);
  return { problem, ...compileInstance(problem) };
}

/**
 * Solve a document all the way through the ladder and check mode, the way the
 * session does. Returns the accepted schedule plus the pieces the assertions
 * need to read it.
 */
export async function solve(doc, { now = doc.start, levels, timeLimitMs = 20_000 } = {}) {
  const { problem, instance, index } = compiled(doc, now);
  const runner = new NativeRunner();
  const controller = new AbortController();
  const ladder = await runLadder(instance, index, runner, problem.revision, {
    timeLimitMsPerLevel: timeLimitMs, signal: controller.signal, levels,
  });
  if (ladder.kind !== 'candidate') return { problem, instance, index, ladder, accepted: null };
  const checked = await checkCandidate(
    instance, index, ladder.candidate, runner, controller.signal, timeLimitMs,
  );
  return {
    problem,
    instance,
    index,
    ladder,
    checked,
    accepted: checked.kind === 'accepted' ? checked.accepted : null,
  };
}

/** The mission id assigned to `employeeId` in `segmentIndex`, or null. */
export function assignedAt(accepted, index, employeeId, segmentIndex) {
  const employee = index.employeeIds.indexOf(employeeId);
  const code = accepted.assignment[employee * index.segments.length + segmentIndex];
  return code === 0 ? null : index.missionIds[code - 1];
}

/** Every (employeeId, missionId) the accepted matrix holds, per segment. */
export function assignmentBySegment(accepted, index) {
  return index.segments.map((_, segmentIndex) => index.employeeIds
    .map((employeeId) => ({ employeeId, missionId: assignedAt(accepted, index, employeeId, segmentIndex) }))
    .filter((cell) => cell.missionId != null));
}

/** A logged (frozen, stamped) pin, the shape `freezePastShifts` writes. */
export function loggedPin({ missionId, employeeId, start, end, missionName = 'Duty', missionType = 'local', tags = [] }) {
  return {
    missionId,
    employeeId,
    start,
    end,
    frozen: true,
    record: { employeeName: employeeId, missionName, missionType, tags },
  };
}
