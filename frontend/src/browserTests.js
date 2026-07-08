// Browser-runnable mirror of tests/scheduler.test.js (node:test can't run in a
// browser). Same cases, plain assertions, renders pass/fail to the DOM so the
// suite works on the phone with zero tooling - open pb_public/tests.html.
import { generateShifts, computeStats } from './lib/scheduler.js';

const HOUR = 3600 * 1000;
const results = [];

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

check('demo case (3 guards, 2 positions, 24x1h) balances hours ~16/16/16', () => {
  const start = Date.UTC(2024, 0, 1, 0, 0, 0);
  const end = start + 24 * HOUR;
  const guards = ['Alice', 'Bob', 'Carol'];
  const shifts = generateShifts({ start, end, shiftMinutes: 60, positions: 2, guards });
  assertEqual(shifts.length, 24);
  const { hoursPerGuard } = computeStats(shifts);
  for (const guard of guards) {
    const hours = hoursPerGuard.get(guard);
    if (Math.abs(hours - 16) > 1) throw new Error(`${guard} worked ${hours}h, expected ~16h`);
  }
});

check('matches gs2.py output on a no-ties input (positions=1, staggered availability)', () => {
  const start = Date.UTC(2024, 0, 1, 0, 0, 0);
  const existingShifts = [
    { start: start - 3 * HOUR, end: start - 2 * HOUR, guards: ['Alice'] },
    { start: start - 2 * HOUR, end: start - HOUR, guards: ['Bob'] },
    { start: start - HOUR, end: start, guards: ['Carol'] },
  ];
  const shifts = generateShifts({
    start,
    end: start + 3 * HOUR,
    shiftMinutes: 60,
    positions: 1,
    guards: ['Alice', 'Bob', 'Carol'],
    existingShifts,
  });
  assertDeepEqual(shifts.map((s) => s.guards[0]), ['Alice', 'Bob', 'Carol']);
});

check('validation errors mirror gs2.py asserts', () => {
  assertThrows(() => generateShifts({ start: 10, end: 0, shiftMinutes: 60, positions: 1, guards: ['A'] }));
  assertThrows(() => generateShifts({ start: 0, end: 10, shiftMinutes: 0, positions: 1, guards: ['A'] }));
  assertThrows(() => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: 0, guards: ['A'] }));
  assertThrows(() => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: 1, guards: [] }));
  assertThrows(() => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: 1, guards: ['A', 'A'] }));
  assertThrows(() => generateShifts({ start: 0, end: 10, shiftMinutes: 60, positions: 2, guards: ['A'] }));
});

check('seeds availability from existingShifts', () => {
  const start = Date.UTC(2024, 0, 1, 0, 0, 0);
  const existingShifts = [{ start, end: start + 2 * HOUR, guards: ['Alice'] }];
  const shifts = generateShifts({
    start,
    end: start + 3 * HOUR,
    shiftMinutes: 60,
    positions: 1,
    guards: ['Alice', 'Bob'],
    existingShifts,
  });
  assertDeepEqual(shifts.map((s) => s.guards[0]), ['Bob', 'Bob', 'Alice']);
});

check('computeStats variance matches the corrected worked example ([4h, 8h] -> 4.0)', () => {
  const start = Date.UTC(2023, 9, 1, 9, 0, 0);
  const shifts = [
    { start, end: start + 8 * HOUR, guards: ['Alice'] },
    { start: start + 8 * HOUR, end: start + 12 * HOUR, guards: ['Bob'] },
  ];
  const { hoursPerGuard, variance } = computeStats(shifts);
  assertEqual(hoursPerGuard.get('Alice'), 8);
  assertEqual(hoursPerGuard.get('Bob'), 4);
  assertEqual(variance, 4.0);
});

check('computeStats returns null variance for a single guard', () => {
  const start = Date.UTC(2023, 9, 1, 9, 0, 0);
  const { variance } = computeStats([{ start, end: start + HOUR, guards: ['Alice'] }]);
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
