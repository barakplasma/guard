import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCandidate } from '../src/solver/check.ts';
import { RecordedRunner } from '../src/solver/runner.ts';
import { SolveSession } from '../src/solver/session.ts';
import { LEVEL_COUNT } from '../src/solver/types.ts';
import {
  finishedRun as finished, quantitiesOf, solverSolutionFor as solution,
} from './solverOutputFixture.js';
import { compiled, docOf, people } from './solverHelpers.js';

/**
 * Check mode is the only constructor of an accepted schedule, so what it
 * refuses is the whole of what history can never be built from. The objective
 * comparison is the defect `prototype/minizinc/check.mjs` was built to catch:
 * a model can compute something other than it claims, and comparing totals
 * alone would never notice.
 */

const fixture = () => compiled(docOf({
  start: new Date(2026, 0, 5, 12, 0, 0, 0).getTime(),
  end: new Date(2026, 0, 5, 14, 0, 0, 0).getTime(),
  employees: people(2),
  missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
}));

function candidateOf(index, instance, claimed = {}) {
  const assignment = new Uint8Array(index.employeeIds.length * index.segments.length);
  assignment[0] = 1;
  return {
    revision: 'r1',
    assignment,
    claimed: solution(index, instance, assignment).unfilledSeatMinutes === 0
      ? { ...quantitiesOf(solution(index, instance, assignment)), ...claimed }
      : {},
    provenLevels: LEVEL_COUNT,
  };
}

test('a check run that agrees is accepted, carrying the check run\'s numbers', async () => {
  const { index, instance } = fixture();
  const candidate = candidateOf(index, instance);
  const runner = new RecordedRunner([
    finished('SATISFIED', solution(index, instance, candidate.assignment, { dutyMinutes: [60, 0] })),
  ]);
  const outcome = await checkCandidate(
    instance, index, candidate, runner, new AbortController().signal, 1000,
  );
  assert.equal(outcome.kind, 'accepted');
  assert.deepEqual(outcome.accepted.diagnostics.dutyMinutes, [60, 0]);
  assert.equal(outcome.accepted.proof, 'optimal');
});

test('an objective the two runs disagree about is rejected', async () => {
  const { index, instance } = fixture();
  const candidate = candidateOf(index, instance, { turnSpread: 3 });
  const runner = new RecordedRunner([
    finished('SATISFIED', solution(index, instance, candidate.assignment, { turnSpread: 0 })),
  ]);
  const outcome = await checkCandidate(
    instance, index, candidate, runner, new AbortController().signal, 1000,
  );
  assert.equal(outcome.kind, 'rejected');
  assert.equal(outcome.reason, 'objective-mismatch');
  assert.match(outcome.detail, /turnSpread/);
});

test('only the levels the ladder proved are compared', async () => {
  const { index, instance } = fixture();
  // The candidate claims two levels. A disagreement at level 10 is below
  // anything it claimed, so it is not a mismatch.
  const candidate = { ...candidateOf(index, instance, { turnSpread: 3 }), provenLevels: 2 };
  const runner = new RecordedRunner([
    finished('SATISFIED', solution(index, instance, candidate.assignment, { turnSpread: 0 })),
  ]);
  const outcome = await checkCandidate(
    instance, index, candidate, runner, new AbortController().signal, 1000,
  );
  assert.equal(outcome.kind, 'accepted');
  assert.equal(outcome.accepted.proof, 'feasible');
});

test('a candidate the model refuses is rejected as unsatisfiable', async () => {
  const { index, instance } = fixture();
  const runner = new RecordedRunner([finished('UNSATISFIABLE', null)]);
  const outcome = await checkCandidate(
    instance, index, candidateOf(index, instance), runner, new AbortController().signal, 1000,
  );
  assert.equal(outcome.kind, 'rejected');
  assert.equal(outcome.reason, 'unsatisfiable');
});

test('check mode returning a different matrix is a dimension mismatch, not an answer', async () => {
  const { index, instance } = fixture();
  const candidate = candidateOf(index, instance);
  const other = new Uint8Array(candidate.assignment);
  other[0] = 0;
  const runner = new RecordedRunner([
    finished('SATISFIED', solution(index, instance, other)),
  ]);
  const outcome = await checkCandidate(
    instance, index, candidate, runner, new AbortController().signal, 1000,
  );
  assert.equal(outcome.kind, 'rejected');
  assert.equal(outcome.reason, 'dimension-mismatch');
});

test('an UNKNOWN check run is refused rather than read as agreement', async () => {
  const { index, instance } = fixture();
  const runner = new RecordedRunner([finished('UNKNOWN', null)]);
  const outcome = await checkCandidate(
    instance, index, candidateOf(index, instance), runner, new AbortController().signal, 1000,
  );
  assert.equal(outcome.kind, 'rejected');
});

test('check mode passes every cap as -1 and the level as 1, so it changes no question', async () => {
  const { index, instance } = fixture();
  const candidate = candidateOf(index, instance);
  const runner = new RecordedRunner([
    finished('SATISFIED', solution(index, instance, candidate.assignment)),
  ]);
  await checkCandidate(instance, index, candidate, runner, new AbortController().signal, 1000);
  const request = runner.requests[0];
  assert.equal(request.entry, 'rota-check.mzn');
  assert.equal(request.data.objectiveLevel, 1);
  assert.ok(request.data.objectiveCap.every((cap) => cap === -1));
  assert.equal(request.data.candidateAssignment.length, index.employeeIds.length);
});

test('a stale revision is discarded by the session, never emitted', async () => {
  const first = compiled(docOf({
    start: new Date(2026, 0, 5, 12, 0, 0, 0).getTime(),
    end: new Date(2026, 0, 5, 14, 0, 0, 0).getTime(),
    employees: people(2),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
  }));
  const second = compiled(docOf({
    start: new Date(2026, 0, 5, 12, 0, 0, 0).getTime(),
    end: new Date(2026, 0, 5, 14, 0, 0, 0).getTime(),
    employees: people(3),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
  }));
  assert.notEqual(first.problem.revision, second.problem.revision);

  const pending = [];
  const outcomes = [];
  const session = new SolveSession({
    // Never reached: both requests are still debounced when the second
    // supersedes the first, which is the cheapest of the three places a stale
    // completion is discarded.
    runner: new RecordedRunner([]),
    timeLimitMsPerLevel: 1000,
    checkTimeLimitMs: 1000,
    debounceMs: 0,
    onOutcome: (outcome) => outcomes.push(outcome),
    schedule: (fn) => { pending.push(fn); return pending.length; },
    cancelScheduled: (handle) => { pending[handle - 1] = null; },
  });

  session.request(first.problem);
  session.request(second.problem);
  assert.equal(pending.filter(Boolean).length, 1, 'the superseded run never starts');

  assert.equal(session.acceptedFor(first.problem.revision), null);
  assert.equal(session.acceptedFor(second.problem.revision), null);
  session.dispose();
  assert.deepEqual(outcomes, []);
});

test('requesting the same revision twice is a no-op', () => {
  const { problem } = fixture();
  const pending = [];
  const session = new SolveSession({
    runner: new RecordedRunner([]),
    timeLimitMsPerLevel: 1000,
    checkTimeLimitMs: 1000,
    debounceMs: 0,
    onOutcome: () => {},
    schedule: (fn) => { pending.push(fn); return pending.length; },
    cancelScheduled: () => {},
  });
  session.request(problem);
  session.request(problem);
  assert.equal(pending.length, 1);
  session.dispose();
});
