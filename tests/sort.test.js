import test from 'node:test';
import assert from 'node:assert/strict';
import { sortByHebrewName } from '../src/lib/sort.js';

test('sorts Hebrew names by locale collation', () => {
  const list = [{ name: 'תמר' }, { name: 'אביגיל' }, { name: 'משה' }];
  const sorted = sortByHebrewName(list).map((e) => e.name);
  assert.deepEqual(sorted, ['אביגיל', 'משה', 'תמר']);
});

test('blank names sort first without throwing', () => {
  const list = [{ name: 'בן' }, { name: '' }, { name: 'אבי' }];
  const sorted = sortByHebrewName(list).map((e) => e.name);
  assert.deepEqual(sorted, ['', 'אבי', 'בן']);
});

test('equal names keep their original relative order (stable sort)', () => {
  const list = [
    { id: 'e1', name: 'דנה' },
    { id: 'e2', name: 'דנה' },
    { id: 'e3', name: 'אבי' },
  ];
  const sorted = sortByHebrewName(list).map((e) => e.id);
  assert.deepEqual(sorted, ['e3', 'e1', 'e2']);
});

test('does not mutate the input array', () => {
  const list = [{ name: 'ב' }, { name: 'א' }];
  const copy = [...list];
  sortByHebrewName(list);
  assert.deepEqual(list, copy);
});

test('supports a custom name key', () => {
  const list = [{ label: 'ב' }, { label: 'א' }];
  const sorted = sortByHebrewName(list, 'label').map((e) => e.label);
  assert.deepEqual(sorted, ['א', 'ב']);
});
