import test from 'node:test';
import assert from 'node:assert/strict';
import { sleepReport } from '../scheduler/sleep.js';

const HOUR = 3600 * 1000;

// Night window built with the LOCAL Date constructor (see scheduler.js) so the
// hours in the test read the same as the hours the report computes.
function localTime(y, m, d, h = 0, min = 0) {
  return new Date(y, m, d, h, min, 0, 0).getTime();
}

const nightStart = localTime(2024, 0, 1, 22, 0); // 22:00
const nightEnd = localTime(2024, 0, 2, 6, 0); // 06:00 next day (8h window)

test('a free person could sleep the whole night window', () => {
  const [row] = sleepReport({ nightStart, nightEnd, shifts: [], people: [{ name: 'Alice' }] });
  assert.equal(row.longestSleepHours, 8);
  assert.equal(row.totalFreeHours, 8);
  assert.equal(row.sleepStart, nightStart);
  assert.equal(row.sleepEnd, nightEnd);
  assert.equal(row.meetsMinimum, true); // no minimum set
});

test('longest contiguous block is the largest gap between shifts, not total free time', () => {
  // Two 1h shifts split the night into three gaps: 22-00 (2h), 01-03 (2h), 04-06 (2h)
  const shifts = [
    { guard: 'Bob', start: localTime(2024, 0, 2, 0, 0), end: localTime(2024, 0, 2, 1, 0) },
    { guard: 'Bob', start: localTime(2024, 0, 2, 3, 0), end: localTime(2024, 0, 2, 4, 0) },
  ];
  const [row] = sleepReport({ nightStart, nightEnd, shifts, people: [{ name: 'Bob' }] });
  assert.equal(row.longestSleepHours, 2); // biggest single block, not the 6h total
  assert.equal(row.totalFreeHours, 6);
});

test('shifts are clipped to the window and overlaps merged', () => {
  // A shift that starts before the window and overlaps another: 20:00-23:30 and
  // 23:00-01:00 merge to busy 22:00-01:00 inside the window; free 01:00-06:00 = 5h.
  const shifts = [
    { guard: 'Cara', start: localTime(2024, 0, 1, 20, 0), end: localTime(2024, 0, 1, 23, 30) },
    { guard: 'Cara', start: localTime(2024, 0, 1, 23, 0), end: localTime(2024, 0, 2, 1, 0) },
  ];
  const [row] = sleepReport({ nightStart, nightEnd, shifts, people: [{ name: 'Cara' }] });
  assert.equal(row.longestSleepHours, 5);
  assert.equal(row.sleepStart, localTime(2024, 0, 2, 1, 0));
  assert.equal(row.sleepEnd, nightEnd);
});

test('minSleepHours flags a driver who cannot get enough contiguous sleep', () => {
  // A patrol block 00:00-04:00 leaves gaps of 2h (22-00) and 2h (04-06); a
  // driver needing 6h fails, a regular guard with no minimum passes.
  const shifts = [{ guard: 'Dan', start: localTime(2024, 0, 2, 0, 0), end: localTime(2024, 0, 2, 4, 0) }];
  const rows = sleepReport({
    nightStart,
    nightEnd,
    shifts,
    people: [
      { name: 'Dan', minSleepHours: 6 },
      { name: 'Eve' },
    ],
  });
  const dan = rows.find((r) => r.name === 'Dan');
  const eve = rows.find((r) => r.name === 'Eve');
  assert.equal(dan.longestSleepHours, 2);
  assert.equal(dan.meetsMinimum, false);
  assert.equal(eve.longestSleepHours, 8);
  assert.equal(eve.meetsMinimum, true);
});

test('a fully-booked night yields zero sleep', () => {
  const shifts = [{ guard: 'Fin', start: nightStart, end: nightEnd }];
  const [row] = sleepReport({ nightStart, nightEnd, shifts, people: [{ name: 'Fin', minSleepHours: 6 }] });
  assert.equal(row.longestSleepHours, 0);
  assert.equal(row.totalFreeHours, 0);
  assert.equal(row.sleepStart, null);
  assert.equal(row.meetsMinimum, false);
});

test('night start must be before night end', () => {
  assert.throws(
    () => sleepReport({ nightStart: nightEnd, nightEnd: nightStart, shifts: [], people: [] }),
    /Night start must be before night end/,
  );
});
