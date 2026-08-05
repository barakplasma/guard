import test from 'node:test';
import assert from 'node:assert/strict';
import { slotContainsInstant } from '../src/lib/agenda.js';

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
