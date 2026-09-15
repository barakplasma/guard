import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityWarnings } from '../src/lib/invariants.js';
import { plan } from '../src/lib/planner.js';
const H = 3600000;
const input = { start: 0, end: 8 * H, shiftMinutes: 60,
  employees: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id })),
  missions: [{ id: 'g', name: 'Guard', type: 'local', count: 1 }],
};
const row = (patch = {}) => ({ missionId: 'g', employeeId: 'a', type: 'local',
  start: 0, end: H, slotStart: 0, slotEnd: H, pinned: false, ...patch });

test('runtime duration findings compare each local duty with its configured length', () => {
  const warnings = qualityWarnings([row({ end: H / 10 }), row({ start: H, end: 3 * H, slotStart: H, slotEnd: 2 * H })], input);
  assert.ok(warnings.some((w) => w.code === 'short-shift' && w.actualMinutes === 6 && w.expectedMinutes === 60));
  assert.ok(warnings.some((w) => w.code === 'long-shift' && w.actualMinutes === 120 && w.expectedMinutes === 60));
  assert.ok(!qualityWarnings([row()], input).some((w) => /^(short|long)-shift$/.test(w.code)));
});

test('duration findings respect mission/night overrides, full holds, and pinned partial rows', () => {
  const i = { ...input, nightWindows: [{ start: H, end: 8 * H }],
    missions: [{ ...input.missions[0], shiftMinutes: 120, nightShiftMinutes: 30 }] };
  const warnings = qualityWarnings([row({ end: H / 2, pinned: true }),
    row({ start: H, end: 1.5 * H, slotStart: H, slotEnd: 1.5 * H }),
    row({ type: 'remote', end: 8 * H }), row({ type: 'daily', end: 8 * H })], i);
  assert.equal(warnings.filter((w) => /^(short|long)-shift$/.test(w.code)).length, 1);
  assert.ok(warnings.some((w) => w.code === 'short-shift' && w.expectedMinutes === 120));
});

test('workload review includes deliberate assignments but counts fragmented slots once', () => {
  const rows = [0, 2, 4].map((n) => row({ start: n * H, end: (n + 1) * H, slotStart: n * H, slotEnd: (n + 1) * H, pinned: true }));
  const warning = qualityWarnings(rows, input).find((w) => w.code === 'workload-outlier');
  assert.equal(warning.count, 3);
  assert.equal(warning.average, 0.75);
  assert.ok(!qualityWarnings([row({ end: H / 3 }), row({ start: H / 3, end: 2 * H / 3 }), row({ start: 2 * H / 3 })], input)
    .some((w) => w.code === 'workload-outlier'));
  assert.ok(!qualityWarnings(rows, { ...input, employees: [input.employees[0]] }).some((w) => w.code === 'workload-outlier'));
});

test('generated schedules report both concentration and available people left unused', () => {
  const result = plan({ ...input, pins: [{ missionId: 'g', employeeId: 'a' }] });
  assert.ok(result.warnings.some((w) => w.code === 'workload-outlier' && w.employeeId === 'a' && w.count === 8));
  assert.deepEqual(result.warnings.filter((w) => w.code === 'employee-unused').map((w) => w.employeeId).sort(), ['b', 'c', 'd']);
});

test('invalid row timestamps remain hard errors, not nonsensical duration advice', () => {
  assert.ok(!qualityWarnings([row({ end: NaN }), row({ end: 0 })], input)
    .some((w) => ['short-shift', 'long-shift'].includes(w.code)));
});
