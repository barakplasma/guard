// Browser-runnable mirror of tests/scheduler.test.js (node:test can't run in a
// browser). Same cases, plain assertions, renders pass/fail to the DOM so the
// suite works on the phone with zero tooling - open pb_public/tests.html.
import { generateShifts, computeStats } from './lib/scheduler.js';

const HOUR = 3600 * 1000;
const results = [];

// Positions are time-restricted via local hour/minute, so timestamps are
// built with the LOCAL Date constructor, not Date.UTC - see scheduler.js.
function localTime(y, m, d, h = 0, min = 0) {
  return new Date(y, m, d, h, min, 0, 0).getTime();
}

const POS_A = { name: 'A' };
const POS_B = { name: 'B' };

function check(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (err) {
    results.push({ name, pass: false, error: err.message });
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `expected ${expected}, got ${actual}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(message || `expected ${b}, got ${a}`);
}

function assertThrows(fn, message) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message || 'expected function to throw');
}

check('demo case (3 guards, 2 named positions, 24x1h) balances hours ~16/16/16', () => {
  const start = localTime(2024, 0, 1, 0, 0);
  const end = start + 24 * HOUR;
  const guards = ['Alice', 'Bob', 'Carol'];
  const shifts = generateShifts({ start, end, shiftMinutes: 60, positions: [POS_A, POS_B], guards });
  assertEqual(shifts.length, 48);
  const { hoursPerGuard } = computeStats(shifts);
  for (const guard of guards) {
    const hours = hoursPerGuard.get(guard);
    if (Math.abs(hours - 16) > 1) throw new Error(`${guard} worked ${hours}h, expected ~16h`);
  }
});

check('matches gs2.py output on a no-ties input (1 position, staggered availability)', () => {
  const start = localTime(2024, 0, 1, 0, 0);
  const existingShifts = [
    { start: start - 3 * HOUR, end: start - 2 * HOUR, guard: 'Alice' },
    { start: start - 2 * HOUR, end: start - HOUR, guard: 'Bob' },
    { start: start - HOUR, end: start, guard: 'Carol' },
  ];
  const shifts = generateShifts({
    start,
    end: start + 3 * HOUR,
    shiftMinutes: 60,
    positions: [POS_A],
    guards: ['Alice', 'Bob', 'Carol'],
    existingShifts,
  });
  assertDeepEqual(shifts.map((s) => s.guard), ['Alice', 'Bob', 'Carol']);
});

check('validation errors', () => {
  assertThrows(() => generateShifts({ start: 10, end: 0, shiftMinutes: 60, positions: [POS_A], guards: ['A'] }));
  assertThrows(() => generateShifts({ start: 0, end: 10, shiftMinutes: 0, positions: [POS_A], guards: ['A'] }));
  assertThrows(() => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: [], guards: ['A'] }));
  assertThrows(() => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: [{ name: '' }], guards: ['A'] }));
  assertThrows(() =>
    generateShifts({
      start: 0,
      end: 10,
      shiftMinutes: 60,
      positions: [{ name: 'Patrol', timeRestricted: true, windowStart: 'nope', windowEnd: '06:00' }],
      guards: ['A'],
    }),
  );
  assertThrows(() => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: [POS_A], guards: [] }));
  assertThrows(() => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: [POS_A], guards: ['A', 'A'] }));
  assertThrows(() => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: [POS_A, POS_B], guards: ['A'] }));
});

check('seeds availability from existingShifts', () => {
  const start = localTime(2024, 0, 1, 0, 0);
  const existingShifts = [{ start, end: start + 2 * HOUR, guard: 'Alice' }];
  const shifts = generateShifts({
    start,
    end: start + 3 * HOUR,
    shiftMinutes: 60,
    positions: [POS_A],
    guards: ['Alice', 'Bob'],
    existingShifts,
  });
  assertDeepEqual(shifts.map((s) => s.guard), ['Bob', 'Bob', 'Alice']);
});

check('time-restricted position (patrol, 22:00-06:00) is one continuous shift, same guard all window', () => {
  const patrol = { name: 'Patrol', timeRestricted: true, windowStart: '22:00', windowEnd: '06:00' };
  const regular = { name: 'Gate' };
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
  assertEqual(gateSlots.length, 12);
  assertEqual(patrolSlots.length, 1); // one 22:00->06:00 block, not eight hourly rows
  assertEqual((patrolSlots[0].end - patrolSlots[0].start) / HOUR, 8);
});

check('time-restricted window opening mid-slot is still fully staffed', () => {
  const patrol = { name: 'Patrol', timeRestricted: true, windowStart: '20:00', windowEnd: '06:00' };
  const start = localTime(2024, 0, 1, 0, 0);
  const end = localTime(2024, 0, 1, 21, 0);
  const shifts = generateShifts({ start, end, shiftMinutes: 90, positions: [patrol], guards: ['Alice', 'Bob'] });
  const sorted = shifts.slice().sort((a, b) => a.start - b.start);
  assertEqual(sorted.length, 2);
  assertEqual(new Date(sorted[1].start).getHours(), 20);
  assertEqual(new Date(sorted[1].end).getHours(), 21);
});

check('time-restricted: an off-grid existing shift splits the block at its real edges', () => {
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
  assertEqual(sorted.length, 2);
  assertEqual((sorted[0].end - sorted[0].start) / (60 * 1000), 15);
  assertEqual(new Date(sorted[1].start).getHours(), 23);
  assertEqual(new Date(sorted[1].start).getMinutes(), 15);
});

check('time-restricted: an existing partial-window shift only suppresses the slots it covers', () => {
  const patrol = { name: 'Patrol', timeRestricted: true, windowStart: '22:00', windowEnd: '06:00' };
  const start = localTime(2024, 0, 1, 22, 0);
  const end = localTime(2024, 0, 2, 6, 0);
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
  assertEqual(shifts.length, 1);
  assertEqual((shifts[0].end - shifts[0].start) / HOUR, 7);
});

check('a position with headcount 2 staffs two distinct guards per slot', () => {
  const start = localTime(2024, 0, 1, 0, 0);
  const shifts = generateShifts({
    start,
    end: start + 4 * HOUR,
    shiftMinutes: 60,
    positions: [{ name: 'Gate', headcount: 2 }],
    guards: ['Alice', 'Bob', 'Carol'],
  });
  assertEqual(shifts.length, 8);
  const bySlot = new Map();
  for (const s of shifts) {
    if (!bySlot.has(s.start)) bySlot.set(s.start, new Set());
    bySlot.get(s.start).add(s.guard);
  }
  for (const guards of bySlot.values()) assertEqual(guards.size, 2);
});

check('assigned guards: prefers its list and rotates among them when enough are available', () => {
  const patrol = {
    name: 'Patrol',
    timeRestricted: true,
    windowStart: '22:00',
    windowEnd: '06:00',
    guards: ['Bob', 'Carol'],
  };
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
  assertEqual(patrolGuards.length, 2);
  if (patrolGuards.includes('Alice')) throw new Error('Alice is not assigned and must not staff patrol');
  assertDeepEqual([...patrolGuards].sort(), ['Bob', 'Carol']);
});

check('time-restricted post rotates guards day to day, even against global hour-fairness', () => {
  const patrol = { name: 'Patrol', timeRestricted: true, windowStart: '22:00', windowEnd: '06:00' };
  const existingShifts = [{ start: localTime(2023, 11, 30, 8, 0), end: localTime(2023, 11, 30, 20, 0), guard: 'Alice' }];
  const start = localTime(2024, 0, 1, 22, 0);
  const end = localTime(2024, 0, 4, 6, 0);
  const shifts = generateShifts({
    start,
    end,
    shiftMinutes: 60,
    positions: [patrol],
    guards: ['Alice', 'Bob'],
    existingShifts,
  });
  const nightlyGuards = shifts.sort((a, b) => a.start - b.start).map((s) => s.guard);
  assertEqual(nightlyGuards.length, 3);
  for (let i = 1; i < nightlyGuards.length; i++) {
    if (nightlyGuards[i] === nightlyGuards[i - 1]) throw new Error(`night ${i} repeats ${nightlyGuards[i]}`);
  }
  if (!(nightlyGuards.includes('Alice') && nightlyGuards.includes('Bob'))) throw new Error('both guards take turns');
});

check('assigned guards: falls back to someone off-list when too few assigned are available', () => {
  const patrol = {
    name: 'Patrol',
    timeRestricted: true,
    windowStart: '22:00',
    windowEnd: '06:00',
    headcount: 2,
    guards: ['Bob'],
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
  assertEqual(shifts.length, 2);
  const guardsOnPatrol = shifts.map((s) => s.guard);
  if (!guardsOnPatrol.includes('Bob')) throw new Error('the sole assigned guard is used');
  const offList = guardsOnPatrol.filter((g) => g !== 'Bob');
  assertEqual(offList.length, 1);
  if (!['Alice', 'Carol'].includes(offList[0])) throw new Error('second seat should be off-list');
});

check('computeStats variance matches the corrected worked example ([4h, 8h] -> 4.0)', () => {
  const start = localTime(2023, 9, 1, 9, 0);
  const shifts = [
    { start, end: start + 8 * HOUR, guard: 'Alice' },
    { start: start + 8 * HOUR, end: start + 12 * HOUR, guard: 'Bob' },
  ];
  const { hoursPerGuard, variance } = computeStats(shifts);
  assertEqual(hoursPerGuard.get('Alice'), 8);
  assertEqual(hoursPerGuard.get('Bob'), 4);
  assertEqual(variance, 4.0);
});

check('restMinutes prevents back-to-back shifts (3 guards, 1 position)', () => {
  const start = localTime(2024, 0, 1, 0, 0);
  const shifts = generateShifts({
    start,
    end: start + 6 * HOUR,
    shiftMinutes: 60,
    positions: [POS_A],
    guards: ['Alice', 'Bob', 'Carol'],
    restMinutes: 60,
  });
  const order = shifts.map((s) => s.guard);
  assertEqual(order.length, 6);
  for (let i = 1; i < order.length; i++) {
    if (order[i] === order[i - 1]) throw new Error(`slot ${i} (${order[i]}) is back-to-back`);
  }
});

check('restMinutes falls back to under-rested guards rather than leaving a post empty', () => {
  const start = localTime(2024, 0, 1, 0, 0);
  const shifts = generateShifts({
    start,
    end: start + 4 * HOUR,
    shiftMinutes: 60,
    positions: [POS_A],
    guards: ['Alice', 'Bob'],
    restMinutes: 120,
  });
  assertEqual(shifts.length, 4);
});

check('fairnessWindowMinutes gently resets stale load (old hours stop counting)', () => {
  const start = localTime(2024, 0, 1, 0, 0);
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

  const allTime = generateShifts(params).map((s) => s.guard);
  assertEqual(count(allTime, 'Bob'), 2);
  assertEqual(count(allTime, 'Alice'), 0);

  const windowed = generateShifts({ ...params, fairnessWindowMinutes: 24 * 60 }).map((s) => s.guard);
  assertEqual(count(windowed, 'Alice'), 1);
  assertEqual(count(windowed, 'Bob'), 1);
});

check('existing shift at a (slot, position) is not regenerated as a duplicate row', () => {
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
  assertEqual(shifts.length, 1);
  assertEqual(shifts[0].start, start + HOUR);
});

check('rest/window validation errors', () => {
  assertThrows(() =>
    generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: [POS_A], guards: ['A'], restMinutes: -1 }),
  );
  assertThrows(() =>
    generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: [POS_A], guards: ['A'], fairnessWindowMinutes: 0 }),
  );
});

check('computeStats returns null variance for a single guard', () => {
  const start = localTime(2023, 9, 1, 9, 0);
  const { variance } = computeStats([{ start, end: start + HOUR, guard: 'Alice' }]);
  assertEqual(variance, null);
});

const list = document.getElementById('results');
for (const result of results) {
  const li = document.createElement('li');
  li.className = result.pass ? 'pass' : 'fail';
  li.textContent = result.pass ? `PASS - ${result.name}` : `FAIL - ${result.name}: ${result.error}`;
  list.appendChild(li);
}
const failed = results.filter((r) => !r.pass).length;
document.title = `${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length}) - scheduler tests`;
