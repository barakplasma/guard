import test from 'node:test';
import assert from 'node:assert/strict';
import { runLadder } from '../src/solver/ladder.ts';
import { RecordedRunner } from '../src/solver/runner.ts';
import { LEVEL_COUNT, OBJECTIVE_ORDER } from '../src/solver/types.ts';
import { finishedRun as finished, solverSolution as solution } from './solverOutputFixture.js';
import { compiled, docOf, people } from './solverHelpers.js';

/**
 * The ladder, against a scripted runner.
 *
 * UNKNOWN, ERROR, malformed output and a cancelled run are exactly the paths a
 * real solver will not reproduce on demand, and they are the ones where a
 * mistake produces a schedule nobody proved. `RecordedRunner` is why they can
 * be asserted at all.
 */

const fixture = () => compiled(docOf({
  start: new Date(2026, 0, 5, 12, 0, 0, 0).getTime(),
  end: new Date(2026, 0, 5, 15, 0, 0, 0).getTime(),
  employees: people(2),
  missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
}));

const run = (script, options = {}) => {
  const { problem, instance, index } = fixture();
  const runner = new RecordedRunner(script);
  return runLadder(instance, index, runner, problem.revision, {
    timeLimitMsPerLevel: 1000, signal: new AbortController().signal, ...options,
  }).then((outcome) => ({ outcome, runner, index, instance }));
};

test('every level proved gives a candidate claiming all of them', async () => {
  const { index, instance } = fixture();
  const script = Array.from({ length: LEVEL_COUNT }, () => finished('OPTIMAL_SOLUTION', solution(index, instance)));
  const { outcome, runner } = await run(script);
  assert.equal(outcome.kind, 'candidate');
  assert.equal(outcome.candidate.provenLevels, LEVEL_COUNT);
  assert.equal(runner.requests.length, LEVEL_COUNT);
});

test('each proved optimum becomes the next level\'s cap', async () => {
  const { index, instance } = fixture();
  const script = Array.from({ length: LEVEL_COUNT }, (_, level) => finished(
    'OPTIMAL_SOLUTION',
    solution(index, instance, { [OBJECTIVE_ORDER[level]]: level + 1 }),
  ));
  const { runner } = await run(script);
  // The third request carries the optima proved at levels 1 and 2, and nothing
  // below them: an unproved value passed down as a cap could make every level
  // under it infeasible for no real reason.
  const third = runner.requests[2].data.objectiveCap;
  assert.equal(third[0], 1);
  assert.equal(third[1], 2);
  assert.equal(third[2], -1);
  assert.equal(runner.requests[0].data.objectiveLevel, 1);
  assert.equal(runner.requests[2].data.objectiveLevel, 3);
});

test('SATISFIED stops the ladder with provenLevels one below that level', async () => {
  const { index, instance } = fixture();
  const script = [
    finished('OPTIMAL_SOLUTION', solution(index, instance)),
    finished('OPTIMAL_SOLUTION', solution(index, instance)),
    finished('SATISFIED', solution(index, instance)),
  ];
  const { outcome, runner } = await run(script);
  assert.equal(outcome.kind, 'candidate');
  assert.equal(outcome.candidate.provenLevels, 2);
  assert.equal(runner.requests.length, 3, 'nothing below an unproved level is entered');
});

test('UNKNOWN with no solution at level 1 yields no candidate at all', async () => {
  const { outcome } = await run([finished('UNKNOWN', null)]);
  assert.equal(outcome.kind, 'unknown');
  assert.equal(outcome.level, 1);
});

test('UNKNOWN after a proved level keeps what was proved and claims nothing more', async () => {
  const { index, instance } = fixture();
  const { outcome } = await run([
    finished('OPTIMAL_SOLUTION', solution(index, instance)),
    finished('UNKNOWN', null),
  ]);
  assert.equal(outcome.kind, 'candidate');
  assert.equal(outcome.candidate.provenLevels, 1);
});

test('UNSATISFIABLE at level 1 is a staffing shortage', async () => {
  const { outcome } = await run([finished('UNSATISFIABLE', null)]);
  assert.equal(outcome.kind, 'infeasible');
});

test('UNSATISFIABLE under proved caps is a model defect, not a shortage', async () => {
  const { index, instance } = fixture();
  const { outcome } = await run([
    finished('OPTIMAL_SOLUTION', solution(index, instance)),
    finished('UNSATISFIABLE', null),
  ]);
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.reason, 'cap-infeasible');
});

test('ERROR never yields a candidate', async () => {
  const { outcome } = await run([finished('ERROR', null)]);
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.reason, 'model-error');
});

test('malformed output never yields a candidate', async () => {
  const { outcome } = await run([finished('OPTIMAL_SOLUTION', { nonsense: true })]);
  assert.equal(outcome.kind, 'failed');
  assert.ok(['malformed-output', 'dimension-mismatch'].includes(outcome.reason));
});

test('a solver failure is reported with its own reason', async () => {
  const { outcome } = await run([{ kind: 'failed', reason: 'worker', detail: 'worker died' }]);
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.reason, 'worker');
});

test('a cancelled run never yields a candidate', async () => {
  const { outcome } = await run([{ kind: 'cancelled' }]);
  assert.equal(outcome.kind, 'cancelled');
});

test('an already-aborted signal does not run the solver at all', async () => {
  const { problem, instance, index } = fixture();
  const runner = new RecordedRunner([]);
  const controller = new AbortController();
  controller.abort();
  const outcome = await runLadder(instance, index, runner, problem.revision, {
    timeLimitMsPerLevel: 1000, signal: controller.signal,
  });
  assert.equal(outcome.kind, 'cancelled');
  assert.equal(runner.requests.length, 0);
});

test('`levels` bounds how far the ladder walks, for the tests that need it', async () => {
  const { index, instance } = fixture();
  const script = Array.from({ length: 3 }, () => finished('OPTIMAL_SOLUTION', solution(index, instance)));
  const { outcome, runner } = await run(script, { levels: 3 });
  assert.equal(runner.requests.length, 3);
  assert.equal(outcome.candidate.provenLevels, 3);
});
