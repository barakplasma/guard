import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { plan } from '../src/lib/planner.js';
const M = 60000;
test('pinned capacity respects the smaller daytime headcount', () => {
  const r = plan({ start: 0, end: 120 * M, shiftMinutes: 60,
    employees: ['a', 'b'].map((id) => ({ id, name: id })),
    missions: [{ id: 'g', name: 'G', type: 'local', count: 1, nightCount: 2 }],
    nightWindows: [{ start: 60 * M, end: 120 * M }],
    pins: ['a', 'b'].map((employeeId) => ({ employeeId, missionId: 'g' })) });
  assert.ok(r.timeline.filter((s) => s.start < 60 * M).every((s) => s.onDuty.length <= 1));
});
test('an off-grid pin cannot overlap a generated row on the same mission', () => {
  const r = plan({ start: 0, end: 120 * M, shiftMinutes: 60,
    employees: ['a', 'b'].map((id) => ({ id, name: id })),
    missions: [{ id: 'g', name: 'G', type: 'local', count: 1 }],
    pins: [{ employeeId: 'a', missionId: 'g', start: 15 * M, end: 45 * M }] });
  assert.ok(r.timeline.every((s) => s.onDuty.length === 1));
});
test('daily missions, tags and contested/frozen pins preserve all engine invariants', () => {
  fc.assert(fc.property(fc.record({
    count: fc.integer({ min: 1, max: 3 }), nightCount: fc.integer({ min: 1, max: 3 }),
    type: fc.constantFrom('local', 'remote', 'daily'),
    pins: fc.array(fc.record({ person: fc.integer({ min: 0, max: 3 }),
      from: fc.integer({ min: 0, max: 90 }), length: fc.integer({ min: 1, max: 60 }), frozen: fc.boolean() }), { maxLength: 6 }),
    tags: fc.boolean(),
  }), (s) => {
    const input = { start: 0, end: 120 * M, shiftMinutes: 60,
      employees: Array.from({ length: 4 }, (_, i) => ({ id: `e${i}`, name: `E${i}`, tags: i % 2 ? ['d'] : [] })),
      tags: [{ id: 'd', name: 'D' }],
      missions: [{ id: 'g', name: 'G', type: s.type, count: s.count, nightCount: s.nightCount,
        occurrences: [{ start: 0, end: 60 * M }, { start: 60 * M, end: 120 * M }],
        requires: s.tags ? [{ tag: 'd', count: 1 }] : [] }],
      nightWindows: [{ start: 60 * M, end: 120 * M }],
      pins: s.pins.map((p) => ({ missionId: 'g', employeeId: `e${p.person}`, start: p.from * M, end: (p.from + p.length) * M, frozen: p.frozen })) };
    assert.deepEqual(plan(input), plan(input));
  }), { numRuns: 250, seed: 526462738 });
});
