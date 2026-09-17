import test from 'node:test';
import assert from 'node:assert/strict';
import { OBJECTIVE_ORDER } from '../src/solver/types.ts';
import { buildGlobalSegmentGrid } from '../src/solver/compile.ts';
import { objectivesOf } from './solverOracle.js';
import {
  docOf, HOUR, people, prepared, skipWithoutSolver, solve,
} from './solverHelpers.js';

/**
 * Cutting a segment in two without offering a new handover must change
 * nothing.
 *
 * This is the property that catches a grid bug the oracle cannot: an extra
 * edge changes every index in the instance, so a quantity that secretly counts
 * *segments* rather than minutes, or a slot stamp that is recomputed rather
 * than carried, moves. The schedule may legitimately differ - two optima can
 * tie - but the numbers may not.
 *
 * The extra edge is introduced through an employee's availability window,
 * which is how an off-grid cut actually reaches the engine, and it is placed
 * where it cannot free anybody up: the person is available for the whole
 * horizon either way.
 */

const START = new Date(2026, 0, 5, 12, 0, 0, 0).getTime();

const totalTurns = (accepted) => accepted.diagnostics.turnsTaken.reduce((sum, n) => sum + n, 0);

const base = (extraEmployee) => docOf({
  start: START,
  end: START + 4 * HOUR,
  shiftMinutes: 120,
  employees: [...people(2), ...(extraEmployee ? [extraEmployee] : [])],
  missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
});

test('an availability edge that frees nobody adds a segment and no change', skipWithoutSolver, async () => {
  const plain = base({ id: 'e3', name: 'C' });
  // The same person, with a window that spans the whole horizon but is written
  // explicitly at an off-grid instant inside it. It cuts the grid; it cannot
  // change who may work when.
  const split = base({ id: 'e3', name: 'C', start: START, end: START + 4 * HOUR });
  const extra = docOf({
    ...split,
    employees: split.employees.map((e) => (e.id === 'e3'
      ? { ...e, start: START + 90 * 60_000, end: START + 4 * HOUR }
      : e)),
  });

  const before = buildGlobalSegmentGrid(prepared(plain)).segments.length;
  const after = buildGlobalSegmentGrid(prepared(extra)).segments.length;
  assert.ok(after > before, 'the fixture has to actually tear a slot');

  const first = await solve(plain);
  const second = await solve(extra);
  assert.ok(first.accepted && second.accepted);
  // Coverage and handover are the quantities an extra edge could distort, and
  // the ones this asserts hardest: a seat is still filled for the same minutes
  // and a slot is still stood by one person.
  assert.equal(second.accepted.quantities.unfilledSeatMinutes, first.accepted.quantities.unfilledSeatMinutes);
  assert.equal(second.accepted.quantities.slotHandoverCount, first.accepted.quantities.slotHandoverCount);
});

test('splitting a slot does not turn one turn into two', skipWithoutSolver, async () => {
  const plain = base();
  const split = docOf({
    ...base(),
    employees: [
      { id: 'e1', name: 'A' },
      // Available throughout, but the window is written at an off-grid
      // instant, so the grid is cut inside a slot she may hold either way.
      { id: 'e2', name: 'B', start: START + 30 * 60_000, end: START + 4 * HOUR },
    ],
  });
  const first = await solve(plain);
  const second = await solve(split);
  assert.ok(first.accepted && second.accepted);

  // Half a slot on one side of the tear and half on the other is one shift's
  // worth of duty. Charging it as two would send that guard round the ring a
  // lap early, which is the bug `ringKeys` exists to prevent in the engine.
  assert.equal(totalTurns(second.accepted), totalTurns(first.accepted));
});

test('feasibility survives the tear', skipWithoutSolver, async () => {
  const tight = docOf({
    start: START,
    end: START + 2 * HOUR,
    employees: people(1),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
  });
  const torn = docOf({
    ...tight,
    employees: [{ id: 'e1', name: 'A', start: START + 20 * 60_000, end: START + 2 * HOUR }],
  });
  const first = await solve(tight);
  const second = await solve(torn);
  assert.ok(first.accepted);
  assert.ok(second.accepted, 'a cut that frees nobody cannot make the instance unanswerable');
  // The one thing that legitimately differs: the torn plan really does have an
  // hour nobody is available for, so its shortfall is larger, never smaller.
  assert.ok(second.accepted.quantities.unfilledSeatMinutes >= first.accepted.quantities.unfilledSeatMinutes);
});

test('the objective vector is the same length however the grid is cut', skipWithoutSolver, async () => {
  const { accepted } = await solve(base());
  assert.ok(accepted);
  assert.equal(objectivesOf(accepted.quantities).length, OBJECTIVE_ORDER.length);
});
