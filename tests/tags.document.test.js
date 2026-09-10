import test from 'node:test';
import assert from 'node:assert/strict';
import { planSchema, toPlannerInput } from '../src/lib/planSchema.js';
import { removeTag } from '../src/lib/tags.js';
export function taggedDoc() {
  return planSchema.parse({ start: 0, end: 86400000, shiftMinutes: 60,
    tags: [{ id: 'driver', name: 'Driver', minNightRestMinutes: 360 }],
    employees: [{ id: 'a', name: 'A', tags: ['driver'] }],
    missions: [{ id: 'g', name: 'G', type: 'local', count: 1,
      requires: [{ tag: 'driver', count: 1 }], excludes: ['driver'] }] });
}
test('qualifications and rest reach the engine', () => {
  const input = toPlannerInput(taggedDoc());
  assert.equal(input.tags[0].minNightRestMinutes, 360);
  assert.deepEqual(input.employees[0].tags, ['driver']);
  assert.deepEqual(input.missions[0].requires, [{ tag: 'driver', count: 1 }]);
});
test('deleting a qualification prunes every reference without touching pins', () => {
  const d = taggedDoc(), next = removeTag(d, 'driver');
  assert.deepEqual(next.tags, []);
  assert.deepEqual(next.employees[0].tags, []);
  assert.deepEqual(next.missions[0].requires, []);
  assert.deepEqual(next.missions[0].excludes, []);
  assert.equal(next.pins, d.pins);
});
test('tag counts, rest and ids are validated', () => {
  const d = taggedDoc(); d.tags[0].minNightRestMinutes = -1;
  assert.equal(planSchema.safeParse(d).success, false);
});
