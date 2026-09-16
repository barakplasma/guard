import test from 'node:test';
import assert from 'node:assert/strict';
import { OBJECTIVE_ORDER } from '../src/solver/types.ts';
import {
  bruteForce, isFeasible, matrixOf, objectivesOf, score,
} from './solverOracle.js';
import {
  compiled, docOf, HOUR, people, skipWithoutSolver, solve,
} from './solverHelpers.js';

/**
 * The model against an exhaustive search.
 *
 * Two questions, and the second is the one worth having. Does the ladder find
 * the lexicographic optimum a brute force over every feasible matrix finds?
 * And - separately - do the numbers MiniZinc *reports* match what its own
 * assignment actually scores? A model can compute something other than it
 * claims, and comparing totals alone would never notice; this is the check
 * `prototype/minizinc/check.mjs` was built around, carried over to the matrix.
 */

const START = new Date(2026, 0, 5, 12, 0, 0, 0).getTime();

const tiny = (overrides = {}) => docOf({
  start: START,
  end: START + 2 * HOUR,
  shiftMinutes: 60,
  employees: people(2),
  missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
  ...overrides,
});

test('the ladder finds the brute-force optimum on a tiny instance', skipWithoutSolver, async () => {
  const doc = tiny();
  const { instance } = compiled(doc);
  const expected = bruteForce(instance);
  assert.ok(expected.feasibleCount > 1, 'there has to be something to choose between');

  const { accepted, ladder } = await solve(doc);
  assert.equal(ladder.kind, 'candidate');
  assert.ok(accepted, 'check mode accepted the candidate');
  assert.deepEqual(objectivesOf(accepted.quantities), expected.objectives);
});

test('the accepted matrix is feasible and scores exactly what MiniZinc reported', skipWithoutSolver, async () => {
  const doc = tiny({
    end: START + 3 * HOUR,
    employees: people(3),
    missions: [
      { id: 'm1', name: 'Gate', type: 'local', count: 1 },
      { id: 'm2', name: 'Ops', type: 'local', count: 1 },
    ],
  });
  const { accepted, instance } = await solve(doc);
  assert.ok(accepted);
  const matrix = matrixOf(accepted, instance);
  assert.ok(isFeasible(instance, matrix), 'the answer satisfies every hard rule');

  const mine = score(instance, matrix);
  for (const key of [...OBJECTIVE_ORDER, 'shortestWaitMinutes']) {
    assert.equal(accepted.quantities[key], mine[key], key);
  }
  assert.deepEqual(accepted.diagnostics.dutyMinutes, mine.dutyMinutes);
  assert.deepEqual(accepted.diagnostics.turnsTaken, mine.turnsTaken);
  assert.deepEqual(accepted.diagnostics.seatsFilled, mine.seatsFilled);
});

test('a pinned cell is a fact the optimum has to be built around', skipWithoutSolver, async () => {
  const doc = tiny({
    pins: [{ missionId: 'm1', employeeId: 'e2', start: START, end: START + HOUR }],
  });
  const { instance } = compiled(doc);
  const expected = bruteForce(instance);
  const { accepted, index } = await solve(doc);
  assert.ok(accepted);
  assert.deepEqual(objectivesOf(accepted.quantities), expected.objectives);

  const e2 = index.employeeIds.indexOf('e2');
  const first = index.segments.findIndex((s) => s.start === START);
  assert.equal(accepted.assignment[e2 * index.segments.length + first], 1);
});

test('too few people is infeasible nowhere and short everywhere', skipWithoutSolver, async () => {
  // One person, two missions wanting one each, every hour: the seats cannot
  // all be filled, and the honest answer is a partial schedule with the
  // shortfall reported - not a refusal to plan.
  const doc = tiny({
    employees: people(1),
    missions: [
      { id: 'm1', name: 'Gate', type: 'local', count: 1 },
      { id: 'm2', name: 'Ops', type: 'local', count: 1 },
    ],
  });
  const { accepted, instance } = await solve(doc);
  assert.ok(accepted, 'a shortage is a schedule with a shortfall, not an error');
  assert.ok(accepted.quantities.unfilledSeatMinutes > 0);
  assert.deepEqual(
    objectivesOf(accepted.quantities),
    bruteForce(instance).objectives,
  );
});

test('an availability window the optimum has to respect', skipWithoutSolver, async () => {
  const doc = tiny({
    employees: [
      { id: 'e1', name: 'A', start: START + HOUR, end: START + 2 * HOUR },
      { id: 'e2', name: 'B' },
    ],
  });
  const { instance } = compiled(doc);
  const { accepted, index } = await solve(doc);
  assert.ok(accepted);
  assert.deepEqual(objectivesOf(accepted.quantities), bruteForce(instance).objectives);

  const e1 = index.employeeIds.indexOf('e1');
  const first = index.segments.findIndex((s) => s.start === START);
  assert.equal(accepted.assignment[e1 * index.segments.length + first], 0, 'not before they arrive');
});
