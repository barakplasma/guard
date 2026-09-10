import test from 'node:test';
import assert from 'node:assert/strict';
import { planSchema } from '../src/lib/planSchema.js';
import { encodePlan, decodePlan } from '../src/lib/urlState.js';
test('daily times and qualifications coexist in the URL without tuple collision', () => {
  const d = planSchema.parse({ start: 0, end: 86400000, shiftMinutes: 60,
    tags: [{ id: 'd', name: 'Driver', minNightRestMinutes: 360 }],
    employees: [{ id: 'a', name: 'A', tags: ['d'] }],
    missions: [{ id: 'k', name: 'K', type: 'daily', count: 1, dayStart: 0, dayEnd: 0,
      requires: [{ tag: 'd', count: 1 }], excludes: ['d'] }] });
  assert.deepEqual(decodePlan(encodePlan(d)).plan, d);
});
test('absent and explicitly empty qualifications encode identically', () => {
  const d = planSchema.parse({ start: 0, end: 86400000, shiftMinutes: 60,
    employees: [{ id: 'a', name: 'A' }], missions: [{ id: 'k', name: 'K', type: 'local', count: 1 }] });
  const legacy = structuredClone(d);
  delete legacy.tags; delete legacy.employees[0].tags;
  delete legacy.missions[0].requires; delete legacy.missions[0].excludes;
  assert.equal(encodePlan(d), encodePlan(legacy));
});
