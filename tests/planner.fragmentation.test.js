import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { plan } from '../src/lib/planner.js';
import { decodePlan } from '../src/lib/urlState.js';
import { toPlannerInput } from '../src/lib/planSchema.js';
import { shortShiftsBlob } from './fixtures/short-shifts.js';

const MIN = 60000;
test('shared September 15 schedule has exactly 21 complete hourly shifts', () => {
  const decoded = decodePlan(shortShiftsBlob);
  assert.equal(decoded.ok, true);
  const input = toPlannerInput(decoded.plan);
  // Exact source timestamps, with the shared plan's Jerusalem night window.
  input.nightWindows = [{ start: Date.parse('2026-09-15T22:00:00+03:00'), end: Date.parse('2026-09-16T06:00:00+03:00') }];
  const result = plan(input);
  assert.equal(result.shifts.length, 21);
  for (const [i, s] of result.shifts.entries()) {
    assert.equal(s.start, input.start + i * 60 * MIN);
    assert.equal(s.end - s.start, 60 * MIN);
  }
});

test('rest preferences and unchanged night staffing never subdivide rotation slots', () => {
  fc.assert(fc.property(fc.record({
    strategy: fc.constantFrom('balanced', 'rotation'),
    minutes: fc.constantFrom(30, 60, 90, 120),
    rest: fc.array(fc.integer({ min: 1, max: 480 }), { minLength: 2, maxLength: 8 }),
    nightOffset: fc.integer({ min: 0, max: 119 }),
  }), ({ strategy, minutes, rest, nightOffset }) => {
    const input = { start: 0, end: 24 * 60 * MIN, shiftMinutes: minutes, strategy,
      employees: rest.map((_, i) => ({ id: `e${i}`, name: `E${i}`, tags: [`t${i}`] })),
      tags: rest.map((value, i) => ({ id: `t${i}`, name: `T${i}`, minNightRestMinutes: value })),
      missions: [{ id: 'g', name: 'Guard', type: 'local', count: 1 }],
      nightWindows: [{ start: nightOffset * MIN, end: (nightOffset + 8 * 60) * MIN }],
    };
    const result = plan(input);
    assert.equal(result.shifts.length, 24 * 60 / minutes);
    assert.ok(result.shifts.every((s) => s.end - s.start === minutes * MIN));
    assert.ok(!result.warnings.some((w) => w.code === 'understaffed'));
  }), { numRuns: 150, seed: 15092026 });
});
