import test from 'node:test';
import assert from 'node:assert/strict';
import { generateShifts, computeStats } from '../scheduler/scheduler.js';

const HOUR = 3600 * 1000;

test('demo case (3 guards, 2 positions, 24x1h) balances hours ~16/16/16 instead of 24/12/12', () => {
  const start = Date.UTC(2024, 0, 1, 0, 0, 0);
  const end = start + 24 * HOUR;
  const guards = ['Alice', 'Bob', 'Carol'];

  const shifts = generateShifts({ start, end, shiftMinutes: 60, positions: 2, guards });
  assert.equal(shifts.length, 24);

  const { hoursPerGuard } = computeStats(shifts);
  for (const guard of guards) {
    const hours = hoursPerGuard.get(guard);
    assert.ok(Math.abs(hours - 16) <= 1, `${guard} worked ${hours}h, expected ~16h`);
  }
});

test('matches gs2.py output on a no-ties input (positions=1, staggered availability)', () => {
  // Staggered existing shifts make every guard's nextAvailable distinct, so the
  // fairness tie-break never kicks in and the pick order is fully determined by
  // availability alone -- identical to gs2.py's heapq[(next_available, name)] behavior.
  const start = Date.UTC(2024, 0, 1, 0, 0, 0);
  const existingShifts = [
    { start: start - 3 * HOUR, end: start - 2 * HOUR, guards: ['Alice'] }, // free at start-2h
    { start: start - 2 * HOUR, end: start - HOUR, guards: ['Bob'] }, // free at start-1h
    { start: start - HOUR, end: start, guards: ['Carol'] }, // free at start
  ];

  const shifts = generateShifts({
    start,
    end: start + 3 * HOUR,
    shiftMinutes: 60,
    positions: 1,
    guards: ['Alice', 'Bob', 'Carol'],
    existingShifts,
  });

  assert.deepEqual(
    shifts.map((s) => s.guards[0]),
    ['Alice', 'Bob', 'Carol'],
  );
});

test('validation errors mirror gs2.py asserts', () => {
  assert.throws(
    () => generateShifts({ start: 10, end: 0, shiftMinutes: 60, positions: 1, guards: ['A'] }),
    /Start time must be before end time/,
  );
  assert.throws(
    () => generateShifts({ start: 0, end: 10, shiftMinutes: 0, positions: 1, guards: ['A'] }),
    /Shift length must be positive/,
  );
  assert.throws(
    () => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: 0, guards: ['A'] }),
    /Number of positions must be positive/,
  );
  assert.throws(
    () => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: 1, guards: [] }),
    /At least one guard must be specified/,
  );
  assert.throws(
    () => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: 1, guards: ['A', 'A'] }),
    /Guard names must be unique/,
  );
  assert.throws(
    () => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: 2, guards: ['A'] }),
    /Not enough guards to fill positions/,
  );
});

test('seeds availability from existingShifts', () => {
  const start = Date.UTC(2024, 0, 1, 0, 0, 0);
  const existingShifts = [{ start, end: start + 2 * HOUR, guards: ['Alice'] }];

  // Alice is busy until start+2h; Bob is free from t=0. With positions=1 the first
  // two 1h slots must go to Bob since Alice is not yet available.
  const shifts = generateShifts({
    start,
    end: start + 3 * HOUR,
    shiftMinutes: 60,
    positions: 1,
    guards: ['Alice', 'Bob'],
    existingShifts,
  });

  assert.deepEqual(
    shifts.map((s) => s.guards[0]),
    ['Bob', 'Bob', 'Alice'],
  );
});

test('computeStats variance matches the corrected worked example (gs2.py doctest is wrong, see CLAUDE.md)', () => {
  const start = Date.UTC(2023, 9, 1, 9, 0, 0);
  const shifts = [
    { start, end: start + 8 * HOUR, guards: ['Alice'] },
    { start: start + 8 * HOUR, end: start + 12 * HOUR, guards: ['Bob'] },
  ];

  const { hoursPerGuard, variance } = computeStats(shifts);
  assert.equal(hoursPerGuard.get('Alice'), 8);
  assert.equal(hoursPerGuard.get('Bob'), 4);
  assert.equal(variance, 4.0);
});

test('computeStats returns null variance for a single guard', () => {
  const start = Date.UTC(2023, 9, 1, 9, 0, 0);
  const { variance } = computeStats([{ start, end: start + HOUR, guards: ['Alice'] }]);
  assert.equal(variance, null);
});
