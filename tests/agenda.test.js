import test from 'node:test';
import assert from 'node:assert/strict';
import { findNowSlot, slotContainsInstant } from '../src/lib/agenda.js';

const slot = { start: 1000, end: 2000 };

test('instant at the start is inside the slot', () => {
  assert.equal(slotContainsInstant(slot, 1000), true);
});

test('instant at the end is outside the slot (exclusive)', () => {
  assert.equal(slotContainsInstant(slot, 2000), false);
});

test('instant strictly inside is inside the slot', () => {
  assert.equal(slotContainsInstant(slot, 1500), true);
});

test('instant before or after the slot is outside', () => {
  assert.equal(slotContainsInstant(slot, 999), false);
  assert.equal(slotContainsInstant(slot, 2001), false);
});

test('a null/undefined instant is never inside any slot', () => {
  assert.equal(slotContainsInstant(slot, null), false);
  assert.equal(slotContainsInstant(slot, undefined), false);
});

test('findNowSlot prefers the shortest concurrent slot over a long-running one', () => {
  // An all-morning remote mission and the current hour of a rotating local
  // mission both contain "now" - the hourly one is the actually-current shift.
  const days = [{
    day: 0,
    slots: [
      { start: 8 * 3600_000, end: 14 * 3600_000 },
      { start: 10 * 3600_000, end: 11 * 3600_000 },
    ],
  }];
  const now = 10.5 * 3600_000;
  const result = findNowSlot(days, now);
  assert.deepEqual(result, { start: 10 * 3600_000, end: 11 * 3600_000 });
});

test('findNowSlot returns null when nothing contains now', () => {
  const days = [{ day: 0, slots: [{ start: 0, end: 1000 }] }];
  assert.equal(findNowSlot(days, 5000), null);
});

test('findNowSlot ties on duration break on the earlier start, deterministically', () => {
  const days = [{
    day: 0,
    slots: [
      { start: 2000, end: 3000 },
      { start: 1500, end: 2500 },
    ],
  }];
  // Both are 1000ms long and both contain 2200 - the earlier-starting one wins.
  const result = findNowSlot(days, 2200);
  assert.deepEqual(result, { start: 1500, end: 2500 });
});

test('findNowSlot searches across multiple days', () => {
  const days = [
    { day: 0, slots: [{ start: 0, end: 1000 }] },
    { day: 1, slots: [{ start: 5000, end: 6000 }] },
  ];
  assert.deepEqual(findNowSlot(days, 5500), { start: 5000, end: 6000 });
});
