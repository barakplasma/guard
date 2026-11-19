import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { decodeSolverOutput, solverOutputSchemaFor, SolverOutputError } from '../src/solver/schemas.ts';
import { MODEL_VERSION } from '../src/solver/types.ts';
import { solverSolution } from './solverOutputFixture.js';
import { compiled, docOf, people } from './solverHelpers.js';

/**
 * The output contract, tested as a contract: the model's `add_to_output`
 * annotations are the whole of it, and this is the only thing that turns one
 * of those JSON objects into a value. What it refuses is what keeps a run that
 * came back the wrong shape from becoming a schedule with a hole in it.
 */

const fixture = () => compiled(docOf({
  employees: people(2),
  missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
  end: new Date(2026, 0, 5, 12, 0).getTime() + 2 * 60 * 60 * 1000,
}));

test('a well-formed output decodes to a flat assignment of the instance\'s size', () => {
  const { index, instance } = fixture();
  const raw = solverSolution(index, instance);
  raw.assignedMission[0][0] = 1;
  const decoded = decodeSolverOutput(raw, index, instance);
  assert.equal(decoded.assignment.length, index.employeeIds.length * index.segments.length);
  assert.equal(decoded.assignment[0], 1);
  assert.equal(decoded.quantities.shortestWaitMinutes, 480);
});

test('a matrix of the wrong dimensions is rejected', () => {
  const { index, instance } = fixture();
  const raw = solverSolution(index, instance);
  raw.assignedMission.pop();
  assert.throws(() => decodeSolverOutput(raw, index, instance), (error) => {
    assert.ok(error instanceof SolverOutputError);
    assert.equal(error.reason, 'dimension-mismatch');
    return true;
  });
});

test('a mission index past the mission count is rejected', () => {
  const { index, instance } = fixture();
  const raw = solverSolution(index, instance);
  raw.assignedMission[0][0] = index.missionIds.length + 1;
  assert.throws(() => decodeSolverOutput(raw, index, instance), SolverOutputError);
});

test('a version mismatch is rejected rather than read as this build\'s model', () => {
  const { index, instance } = fixture();
  const raw = solverSolution(index, instance);
  raw.echoedModelVersion = MODEL_VERSION + 1;
  assert.throws(() => decodeSolverOutput(raw, index, instance), SolverOutputError);
});

test('a missing quantity is malformed output, not a zero', () => {
  const { index, instance } = fixture();
  const raw = solverSolution(index, instance);
  delete raw.turnSpread;
  assert.throws(() => decodeSolverOutput(raw, index, instance), (error) => {
    assert.equal(error.reason, 'malformed-output');
    return true;
  });
});

test('every parsed matrix holds at most one mission per cell', () => {
  const { index, instance } = fixture();
  const schema = solverOutputSchemaFor(index, instance.requirementCount, instance.nightCount);
  fc.assert(fc.property(
    fc.array(
      fc.array(fc.integer({ min: 0, max: index.missionIds.length }), {
        minLength: index.segments.length, maxLength: index.segments.length,
      }),
      { minLength: index.employeeIds.length, maxLength: index.employeeIds.length },
    ),
    (matrix) => {
      const raw = { ...solverSolution(index, instance), assignedMission: matrix };
      const parsed = schema.safeParse(raw);
      assert.ok(parsed.success);
      // The representation itself is the guarantee: a cell is one number, so
      // "two missions at once" is not a value it can hold.
      for (const row of parsed.data.assignedMission) {
        for (const cell of row) assert.equal(typeof cell, 'number');
      }
    },
  ), { numRuns: 60 });
});
