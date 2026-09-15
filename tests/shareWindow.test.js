import test from 'node:test';
import assert from 'node:assert/strict';
import { SHARE_WINDOW_MS, clipResult, defaultShareFrom } from '../src/lib/shareWindow.js';

const HOUR = 3600 * 1000;
const day = (h) => new Date(2030, 8, 10, h).getTime();

test('a share reaches back to a whole hour, never further than it says', () => {
  const plan = { start: day(0), end: day(0) + 7 * 24 * HOUR };
  // 12:17 rounds up to 13:00, so the window opens at 10:00 - two and three
  // quarter hours back. Rounding down would have made "three hours" mean
  // three and three quarters.
  assert.equal(defaultShareFrom(plan, day(12) + 17 * 60 * 1000), day(10));
  // On the hour exactly, it is exactly three hours.
  assert.equal(defaultShareFrom(plan, day(12)), day(9));
});

test('and covers a day from there, no more', () => {
  assert.equal(SHARE_WINDOW_MS, 24 * HOUR);
});

test('a plan that has not started yet shares from its own start', () => {
  // Otherwise a rota written for next week copies an empty message: there is
  // nothing at all in the three hours around now.
  const plan = { start: day(12) + 7 * 24 * HOUR, end: day(12) + 8 * 24 * HOUR };
  assert.equal(defaultShareFrom(plan, day(12)), plan.start);
});

test('a plan already over shares from its start rather than past its end', () => {
  const plan = { start: day(0) - 7 * 24 * HOUR, end: day(0) - 6 * 24 * HOUR };
  assert.equal(defaultShareFrom(plan, day(12)), plan.start);
});

const result = {
  warnings: ['kept'],
  stats: { spreadMinutes: 0 },
  shifts: [
    { id: 'before', start: day(6), end: day(7) },
    { id: 'straddling', start: day(8) + 40 * 60 * 1000, end: day(9) + 40 * 60 * 1000 },
    { id: 'inside', start: day(10), end: day(11) },
    { id: 'after', start: day(20), end: day(21) },
  ],
};

test('clipping keeps the shifts that overlap the window', () => {
  const clipped = clipResult(result, day(9), day(12));
  assert.deepEqual(clipped.shifts.map((s) => s.id), ['straddling', 'inside']);
});

test('the shift already on post when the window opens is in it', () => {
  // Containment would drop it and the share would open on an empty hour.
  const clipped = clipResult(result, day(9), day(12));
  assert.ok(clipped.shifts.some((s) => s.id === 'straddling'));
});

test('clipping leaves the rest of the result alone', () => {
  const clipped = clipResult(result, day(9), day(12));
  assert.deepEqual(clipped.warnings, result.warnings);
  assert.equal(clipped.stats, result.stats);
  assert.equal(result.shifts.length, 4, 'and does not mutate the original');
});

test('no result is nothing to clip', () => {
  assert.equal(clipResult(undefined, day(9), day(12)), undefined);
});
