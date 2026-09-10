import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCrew } from '../src/lib/crew.js';
const person = (id, ...tags) => ({ id, tags });
const requires = [{ tag: 'driver', count: 1 }, { tag: 'commander', count: 1 }];
test('prefer distinct role holders to a combined holder plus unqualified crew', () => {
  const crew = selectCrew([person('both', 'driver', 'commander'), person('none'), person('c', 'commander')], [], 2, requires);
  assert.deepEqual(crew.map((p) => p.id), ['both', 'c']);
});
test('combined qualifications cover both requirements within one available seat', () => {
  assert.deepEqual(selectCrew([person('both', 'driver', 'commander'), person('c', 'commander')], [], 1, requires).map((p) => p.id), ['both']);
});
test('scarcity, pins and counts use all crew without phantom shortages', () => {
  const candidates = [person('c', 'commander'), person('d', 'driver')];
  assert.deepEqual(selectCrew(candidates, [person('p', 'commander')], 1, requires).map((p) => p.id), ['d']);
  assert.equal(selectCrew([person('both', 'driver', 'commander')], [], 2, [{ tag: 'driver', count: 2 }]).length, 1);
});
test('an impossible requirement does not prevent filling other qualifications', () => {
  const crew = selectCrew([person('none'), person('d', 'driver')], [], 1, [...requires, { tag: 'medic', count: 1 }]);
  assert.equal(crew[0].id, 'd');
});
