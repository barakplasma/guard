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

test('time-restricted position (patrol, 22:00-06:00) is one continuous shift, same guard all window', () => {
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

  assert.equal(gateSlots.length, 12); // regular post still staffed every hourly slot
  // Patrol is ONE 22:00->06:00 block, not eight hourly rows - can't switch mid-shift.
  assert.equal(patrolSlots.length, 1);
  const block = patrolSlots[0];
  assert.equal(new Date(block.start).getHours(), 22);
  assert.equal(new Date(block.end).getHours(), 6);
  assert.equal((block.end - block.start) / HOUR, 8);
});

test('time-restricted block is clamped to the exact window when the slot grid is misaligned', () => {
  const patrol = { name: 'Patrol', timeRestricted: true, windowStart: '22:00', windowEnd: '06:00' };
  // A 20:30 start with 60-minute slots puts the grid on the half hour, out of
  // step with the 22:00 window. The block must still be exactly 22:00-06:00,
  // not 22:30-06:30 (no empty opening half hour, no staffing past close).
  const start = localTime(2024, 0, 1, 20, 30);
  const end = localTime(2024, 0, 2, 8, 30);

  const shifts = generateShifts({
    start,
    end,
    shiftMinutes: 60,
    positions: [patrol],
    guards: ['Alice', 'Bob', 'Carol'],
  });

  assert.equal(shifts.length, 1);
  const block = shifts[0];
  assert.equal(new Date(block.start).getHours(), 22);
  assert.equal(new Date(block.start).getMinutes(), 0);
  assert.equal(new Date(block.end).getHours(), 6);
  assert.equal(new Date(block.end).getMinutes(), 0);
  assert.equal((block.end - block.start) / HOUR, 8);
});

test('time-restricted window opening mid-slot is still fully staffed', () => {
  // 90-min slots from 00:00 land at :00, 1:30, 3:00, ... - none inside the
  // 20:00-21:00 tail of a 20:00-06:00 window. That tail must still be staffed,
  // as its own occurrence, not missed because no grid point falls in it.
  const patrol = { name: 'Patrol', timeRestricted: true, windowStart: '20:00', windowEnd: '06:00' };
  const start = localTime(2024, 0, 1, 0, 0);
  const end = localTime(2024, 0, 1, 21, 0);

  const shifts = generateShifts({ start, end, shiftMinutes: 90, positions: [patrol], guards: ['Alice', 'Bob'] });

  const sorted = shifts.slice().sort((a, b) => a.start - b.start);
  assert.equal(sorted.length, 2); // [00:00-06:00] and [20:00-21:00]
  assert.equal(new Date(sorted[0].start).getHours(), 0);
  assert.equal(new Date(sorted[0].end).getHours(), 6);
  assert.equal(new Date(sorted[1].start).getHours(), 20);
  assert.equal(new Date(sorted[1].end).getHours(), 21);
});

test('time-restricted: an off-grid existing shift splits the block at its real edges', () => {
  // Hourly grid, patrol 22:00-06:00, with an existing shift 22:15-23:15 whose
  // edges fall between grid points. New blocks must fill exactly the uncovered
  // parts (22:00-22:15 and 23:15-06:00) - no overstaffing of 22:15-23:00, no gap
  // at 23:15-00:00.
  const patrol = { name: 'Patrol', timeRestricted: true, windowStart: '22:00', windowEnd: '06:00' };
  const start = localTime(2024, 0, 1, 22, 0);
  const end = localTime(2024, 0, 2, 6, 0);
  const existingShifts = [
    { start: localTime(2024, 0, 1, 22, 15), end: localTime(2024, 0, 1, 23, 15), guard: 'Alice', position: 'Patrol' },
  ];

  const shifts = generateShifts({
    start,
    end,
    shiftMinutes: 60,
    positions: [patrol],
    guards: ['Alice', 'Bob', 'Carol'],
    existingShifts,
  });

  const sorted = shifts.slice().sort((a, b) => a.start - b.start);
  assert.equal(sorted.length, 2);
  assert.deepEqual([new Date(sorted[0].start).getHours(), new Date(sorted[0].start).getMinutes()], [22, 0]);
  assert.deepEqual([new Date(sorted[0].end).getHours(), new Date(sorted[0].end).getMinutes()], [22, 15]);
  assert.deepEqual([new Date(sorted[1].start).getHours(), new Date(sorted[1].start).getMinutes()], [23, 15]);
  assert.deepEqual([new Date(sorted[1].end).getHours(), new Date(sorted[1].end).getMinutes()], [6, 0]);
});

test('time-restricted: an existing partial-window shift only suppresses the slots it covers', () => {
  const patrol = { name: 'Patrol', timeRestricted: true, windowStart: '22:00', windowEnd: '06:00' };
  const start = localTime(2024, 0, 1, 22, 0);
  const end = localTime(2024, 0, 2, 6, 0);
  // An existing patrol that only covers the first hour (22:00-23:00) - e.g. from
  // an older/narrower window or a manually created shift. The remaining
  // 23:00-06:00 must still be staffed, as one continuous block.
  const existingShifts = [
    { start: localTime(2024, 0, 1, 22, 0), end: localTime(2024, 0, 1, 23, 0), guard: 'Alice', position: 'Patrol' },
  ];

  const shifts = generateShifts({
    start,
    end,
    shiftMinutes: 60,
    positions: [patrol],
    guards: ['Alice', 'Bob', 'Carol'],
    existingShifts,
  });

  assert.equal(shifts.length, 1); // the uncovered remainder, one block
  assert.equal(new Date(shifts[0].start).getHours(), 23);
  assert.equal(new Date(shifts[0].end).getHours(), 6);
  assert.equal((shifts[0].end - shifts[0].start) / HOUR, 7);
});

test('a position with headcount 2 staffs two distinct guards per slot', () => {
  const start = localTime(2024, 0, 1, 0, 0);
  const shifts = generateShifts({
    start,
    end: start + 4 * HOUR,
    shiftMinutes: 60,
    positions: [{ name: 'Gate', headcount: 2 }],
    guards: ['Alice', 'Bob', 'Carol'],
  });

  assert.equal(shifts.length, 8); // 4 slots x 2 seats
  const bySlot = new Map();
  for (const s of shifts) {
    if (!bySlot.has(s.start)) bySlot.set(s.start, new Set());
    bySlot.get(s.start).add(s.guard);
  }
  for (const guards of bySlot.values()) {
    assert.equal(guards.size, 2); // two different guards, never the same one twice
  }
});

test('assigned guards: prefers its list and rotates among them when enough are available', () => {
  const patrol = {
    name: 'Patrol',
    timeRestricted: true,
    windowStart: '22:00',
    windowEnd: '06:00',
    guards: ['Bob', 'Carol'],
  };
  // Two nights so the assigned pool has to rotate; Alice must never appear.
  const start = localTime(2024, 0, 1, 22, 0);
  const end = localTime(2024, 0, 3, 6, 0);

  const shifts = generateShifts({
    start,
    end,
    shiftMinutes: 60,
    positions: [patrol],
    guards: ['Alice', 'Bob', 'Carol'],
  });

  const patrolGuards = shifts.map((s) => s.guard);
  assert.equal(patrolGuards.length, 2); // one continuous block per night
  // Both assigned guards are free, so the off-list fallback is never triggered.
  assert.ok(!patrolGuards.includes('Alice'), 'Alice is off-list and not needed here');
  assert.deepEqual([...patrolGuards].sort(), ['Bob', 'Carol']); // rotated for fairness
});

test('time-restricted post rotates guards day to day, even against global hour-fairness', () => {
  const patrol = { name: 'Patrol', timeRestricted: true, windowStart: '22:00', windowEnd: '06:00' };
  // Alice is carrying a big daytime load, so pure hour-fairness would keep
  // handing patrol to the lighter Bob every night. Rotation must still put
  // Alice on some nights so the post alternates.
  const existingShifts = [{ start: localTime(2023, 11, 30, 8, 0), end: localTime(2023, 11, 30, 20, 0), guard: 'Alice' }];
  const start = localTime(2024, 0, 1, 22, 0);
  const end = localTime(2024, 0, 4, 6, 0); // three overnight windows

  const shifts = generateShifts({
    start,
    end,
    shiftMinutes: 60,
    positions: [patrol],
    guards: ['Alice', 'Bob'],
    existingShifts,
  });

  const nightlyGuards = shifts.sort((a, b) => a.start - b.start).map((s) => s.guard);
  assert.equal(nightlyGuards.length, 3); // one continuous block per night
  // No guard does patrol two nights running.
  for (let i = 1; i < nightlyGuards.length; i++) {
    assert.notEqual(nightlyGuards[i], nightlyGuards[i - 1], `night ${i} repeats ${nightlyGuards[i]}`);
  }
  assert.ok(nightlyGuards.includes('Alice') && nightlyGuards.includes('Bob'), 'both guards take turns');
});

test('assigned guards: falls back to someone off-list when too few assigned are available', () => {
  const patrol = {
    name: 'Patrol',
    timeRestricted: true,
    windowStart: '22:00',
    windowEnd: '06:00',
    headcount: 2,
    guards: ['Bob'], // only one assigned, but two needed at once
  };
  const start = localTime(2024, 0, 1, 22, 0);
  const end = localTime(2024, 0, 2, 6, 0);

  const shifts = generateShifts({
    start,
    end,
    shiftMinutes: 60,
    positions: [patrol],
    guards: ['Alice', 'Bob', 'Carol'],
  });

  assert.equal(shifts.length, 2); // one continuous block, headcount 2, no throw
  const guardsOnPatrol = shifts.map((s) => s.guard);
  assert.ok(guardsOnPatrol.includes('Bob'), 'the sole assigned guard is used');
  // The second seat is pulled from off-list (Alice or Carol).
  const offList = guardsOnPatrol.filter((g) => g !== 'Bob');
  assert.equal(offList.length, 1);
  assert.ok(['Alice', 'Carol'].includes(offList[0]));
});

test('assigned guards must be part of the overall guard pool', () => {
  assert.throws(
    () =>
      generateShifts({
        start: localTime(2024, 0, 1, 0, 0),
        end: localTime(2024, 0, 1, 2, 0),
        shiftMinutes: 60,
        positions: [{ name: 'Gate', guards: ['Zoe'] }],
        guards: ['Alice', 'Bob'],
      }),
    /assigns guard "Zoe" who is not in the guard pool/,
  );
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
