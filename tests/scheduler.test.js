import test from 'node:test';
import assert from 'node:assert/strict';
import { generateShifts, computeStats } from '../scheduler/scheduler.js';

const HOUR = 3600 * 1000;

// Positions are time-restricted via local hour/minute (see scheduler.js), so
// tests build timestamps with the LOCAL Date constructor, not Date.UTC - that
// way "the hour I asked for" and "the hour the scheduler reads" always agree,
// regardless of which timezone actually runs the suite.
function localTime(y, m, d, h = 0, min = 0) {
  return new Date(y, m, d, h, min, 0, 0).getTime();
}

const POS_A = { name: 'A' };
const POS_B = { name: 'B' };

test('demo case (3 guards, 2 named positions, 24x1h) balances hours ~16/16/16 instead of 24/12/12', () => {
  const start = localTime(2024, 0, 1, 0, 0);
  const end = start + 24 * HOUR;
  const guards = ['Alice', 'Bob', 'Carol'];

  const shifts = generateShifts({ start, end, shiftMinutes: 60, positions: [POS_A, POS_B], guards });
  assert.equal(shifts.length, 48); // 24 slots x 2 positions

  const { hoursPerGuard } = computeStats(shifts);
  for (const guard of guards) {
    const hours = hoursPerGuard.get(guard);
    assert.ok(Math.abs(hours - 16) <= 1, `${guard} worked ${hours}h, expected ~16h`);
  }
});

test('matches gs2.py output on a no-ties input (1 position, staggered availability)', () => {
  // Staggered existing shifts make every guard's nextAvailable distinct, so the
  // fairness tie-break never kicks in and the pick order is fully determined by
  // availability alone -- identical to gs2.py's heapq[(next_available, name)] behavior.
  const start = localTime(2024, 0, 1, 0, 0);
  const existingShifts = [
    { start: start - 3 * HOUR, end: start - 2 * HOUR, guard: 'Alice' }, // free at start-2h
    { start: start - 2 * HOUR, end: start - HOUR, guard: 'Bob' }, // free at start-1h
    { start: start - HOUR, end: start, guard: 'Carol' }, // free at start
  ];

  const shifts = generateShifts({
    start,
    end: start + 3 * HOUR,
    shiftMinutes: 60,
    positions: [POS_A],
    guards: ['Alice', 'Bob', 'Carol'],
    existingShifts,
  });

  assert.deepEqual(
    shifts.map((s) => s.guard),
    ['Alice', 'Bob', 'Carol'],
  );
});

test('validation errors', () => {
  assert.throws(
    () => generateShifts({ start: 10, end: 0, shiftMinutes: 60, positions: [POS_A], guards: ['A'] }),
    /Start time must be before end time/,
  );
  assert.throws(
    () => generateShifts({ start: 0, end: 10, shiftMinutes: 0, positions: [POS_A], guards: ['A'] }),
    /Shift length must be positive/,
  );
  assert.throws(
    () => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: [], guards: ['A'] }),
    /At least one position must be specified/,
  );
  assert.throws(
    () => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: [{ name: '' }], guards: ['A'] }),
    /Every position needs a name/,
  );
  assert.throws(
    () =>
      generateShifts({
        start: 0,
        end: 10,
        shiftMinutes: 60,
        positions: [{ name: 'Patrol', timeRestricted: true, windowStart: 'nope', windowEnd: '06:00' }],
        guards: ['A'],
      }),
    /windowStart must be an "HH:MM"/,
  );
  assert.throws(
    () => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: [POS_A], guards: [] }),
    /At least one guard must be specified/,
  );
  assert.throws(
    () => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: [POS_A], guards: ['A', 'A'] }),
    /Guard names must be unique/,
  );
  assert.throws(
    () => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: [POS_A, POS_B], guards: ['A'] }),
    /Not enough guards to fill positions/,
  );
});

test('seeds availability from existingShifts', () => {
  const start = localTime(2024, 0, 1, 0, 0);
  const existingShifts = [{ start, end: start + 2 * HOUR, guard: 'Alice' }];

  // Alice is busy until start+2h; Bob is free from t=0. With 1 position the first
  // two 1h slots must go to Bob since Alice is not yet available.
  const shifts = generateShifts({
    start,
    end: start + 3 * HOUR,
    shiftMinutes: 60,
    positions: [POS_A],
    guards: ['Alice', 'Bob'],
    existingShifts,
  });

  assert.deepEqual(
    shifts.map((s) => s.guard),
    ['Bob', 'Bob', 'Alice'],
  );
});

test('time-restricted position (patrol, 22:00-06:00 overnight window) only appears in-window', () => {
  const patrol = { name: 'Patrol', timeRestricted: true, windowStart: '22:00', windowEnd: '06:00' };
  const regular = { name: 'Gate' };

  // 20:00 -> 08:00 next day, 1h slots: 20,21,22,23,00,01,02,03,04,05,06,07
  const start = localTime(2024, 0, 1, 20, 0);
  const end = localTime(2024, 0, 2, 8, 0);

  const shifts = generateShifts({
    start,
    end,
    shiftMinutes: 60,
    positions: [regular, patrol],
    guards: ['Alice', 'Bob', 'Carol'],
  });

  const gateSlots = shifts.filter((s) => s.position === 'Gate');
  const patrolSlots = shifts.filter((s) => s.position === 'Patrol');

  assert.equal(gateSlots.length, 12); // staffed every slot
  // in-window slots: 22,23,00,01,02,03,04,05 (8 slots); 20,21,06,07 excluded
  assert.equal(patrolSlots.length, 8);

  const patrolHours = patrolSlots.map((s) => new Date(s.start).getHours());
  assert.deepEqual(patrolHours.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 22, 23].sort((a, b) => a - b));
});

test('restMinutes prevents back-to-back shifts (3 guards, 1 position rotates A/B/C)', () => {
  const start = localTime(2024, 0, 1, 0, 0);
  const shifts = generateShifts({
    start,
    end: start + 6 * HOUR,
    shiftMinutes: 60,
    positions: [POS_A],
    guards: ['Alice', 'Bob', 'Carol'],
    restMinutes: 60, // one full shift of rest between a guard's shifts
  });

  const order = shifts.map((s) => s.guard);
  assert.equal(order.length, 6);
  for (let i = 1; i < order.length; i++) {
    assert.notEqual(order[i], order[i - 1], `slot ${i} (${order[i]}) is back-to-back with slot ${i - 1}`);
  }
});

test('restMinutes falls back to under-rested guards rather than leaving a post empty', () => {
  const start = localTime(2024, 0, 1, 0, 0);
  // Only 2 guards for 4 single-position slots with a 2h rest gap - impossible to
  // honor fully, so the scheduler must still staff every slot (best effort).
  const shifts = generateShifts({
    start,
    end: start + 4 * HOUR,
    shiftMinutes: 60,
    positions: [POS_A],
    guards: ['Alice', 'Bob'],
    restMinutes: 120,
  });
  assert.equal(shifts.length, 4); // every slot filled, no throw
  // A guard is never double-booked onto two concurrent slots.
  for (let i = 1; i < shifts.length; i++) {
    assert.notEqual(shifts[i].guard, shifts[i - 1].guard);
  }
});

test('fairnessWindowMinutes gently resets stale load (old hours stop counting)', () => {
  const start = localTime(2024, 0, 1, 0, 0);
  // Alice logged 10h that ended 48h ago; Bob has done nothing.
  const existingShifts = [{ start: start - 58 * HOUR, end: start - 48 * HOUR, guard: 'Alice' }];
  const params = {
    start,
    end: start + 2 * HOUR,
    shiftMinutes: 60,
    positions: [POS_A],
    guards: ['Alice', 'Bob'],
    existingShifts,
  };

  const count = (arr, name) => arr.filter((g) => g === name).length;

  // All-time fairness still resents Alice's old 10h, so Bob takes both slots.
  const allTime = generateShifts(params).map((s) => s.guard);
  assert.equal(count(allTime, 'Bob'), 2);
  assert.equal(count(allTime, 'Alice'), 0);

  // A 24h window drops the 48h-old load, so Alice and Bob start even and split 1-1.
  const windowed = generateShifts({ ...params, fairnessWindowMinutes: 24 * 60 }).map((s) => s.guard);
  assert.equal(count(windowed, 'Alice'), 1);
  assert.equal(count(windowed, 'Bob'), 1);
});

test('existing shift at a (slot, position) is not regenerated as a duplicate row', () => {
  const start = localTime(2024, 0, 1, 0, 0);
  const existingShifts = [{ start, end: start + HOUR, guard: 'Alice', position: 'A' }];
  const shifts = generateShifts({
    start,
    end: start + 2 * HOUR,
    shiftMinutes: 60,
    positions: [POS_A],
    guards: ['Alice', 'Bob'],
    existingShifts,
  });
  // Only the second slot is generated; the first is already filled.
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].start, start + HOUR);
  assert.equal(shifts[0].position, 'A');
});

test('rest/window validation errors', () => {
  assert.throws(
    () => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: [POS_A], guards: ['A'], restMinutes: -1 }),
    /Rest minutes must be non-negative/,
  );
  assert.throws(
    () =>
      generateShifts({
        start: 0,
        end: 10,
        shiftMinutes: 60,
        positions: [POS_A],
        guards: ['A'],
        fairnessWindowMinutes: 0,
      }),
    /Fairness window must be positive/,
  );
});

test('a position creates one shift per required person and can restrict who fills it', () => {
  const start = localTime(2024, 0, 1, 8, 0);
  const shifts = generateShifts({
    start,
    end: start + HOUR,
    shiftMinutes: 60,
    positions: [
      { name: 'Patrol', peopleCount: 2, eligibleGuards: ['Alice', 'Bob'] },
      { name: 'Gate', peopleCount: 1 },
    ],
    guards: ['Alice', 'Bob', 'Carol'],
  });

  assert.equal(shifts.length, 3);
  assert.deepEqual(shifts.filter((shift) => shift.position === 'Patrol').map((shift) => shift.guard).sort(), ['Alice', 'Bob']);
  assert.equal(shifts.find((shift) => shift.position === 'Gate').guard, 'Carol');
});

test('an overlapping multi-person position generates only its unfilled places', () => {
  const start = localTime(2024, 0, 1, 8, 0);
  const shifts = generateShifts({
    start,
    end: start + HOUR,
    shiftMinutes: 60,
    positions: [{ name: 'Patrol', peopleCount: 2 }],
    guards: ['Alice', 'Bob', 'Carol'],
    existingShifts: [{ start, end: start + HOUR, position: 'Patrol', guard: 'Alice' }],
  });

  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].position, 'Patrol');
  assert.notEqual(shifts[0].guard, 'Alice');
});

test('computeStats variance matches the corrected worked example (gs2.py doctest is wrong, see CLAUDE.md)', () => {
  const start = localTime(2023, 9, 1, 9, 0);
  const shifts = [
    { start, end: start + 8 * HOUR, guard: 'Alice' },
    { start: start + 8 * HOUR, end: start + 12 * HOUR, guard: 'Bob' },
  ];

  const { hoursPerGuard, variance } = computeStats(shifts);
  assert.equal(hoursPerGuard.get('Alice'), 8);
  assert.equal(hoursPerGuard.get('Bob'), 4);
  assert.equal(variance, 4.0);
});

test('computeStats returns null variance for a single guard', () => {
  const start = localTime(2023, 9, 1, 9, 0);
  const { variance } = computeStats([{ start, end: start + HOUR, guard: 'Alice' }]);
  assert.equal(variance, null);
});
