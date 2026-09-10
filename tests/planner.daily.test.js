import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/lib/planner.js';

const H = 3600000;
function input(strategy = 'rotation') {
  return { start: 0, end: 7 * 24 * H, shiftMinutes: 60, strategy,
    employees: Array.from({ length: 15 }, (_, i) => ({ id: `e${i}`, name: `E${i}` })),
    missions: [{ id: 'k', name: 'Kitchen', type: 'daily', count: 2,
      occurrences: Array.from({ length: 7 }, (_, i) => ({ start: i * 24 * H, end: (i * 24 + 6) * H })) }], pins: [] };
}
for (const strategy of ['rotation', 'balanced']) {
  test(`${strategy}: each cook holds one occurrence, no repeats while peers await turns`, () => {
    const r = plan(input(strategy));
    assert.equal(r.shifts.length, 14);
    assert.equal(new Set(r.shifts.map((s) => s.employeeId)).size, 14);
    assert.ok(r.shifts.every((s) => s.type === 'daily' && s.end - s.start === 6 * H));
  });
}
test('whole and partial pins expand per occurrence and capacity does not leak across days', () => {
  const d = input();
  d.pins = [{ missionId: 'k', employeeId: 'e0' },
    { missionId: 'k', employeeId: 'e1', start: H, end: 2 * H }];
  const r = plan(d);
  assert.equal(r.shifts.filter((s) => s.employeeId === 'e0').length, 7);
  assert.ok(r.shifts.some((s) => s.employeeId === 'e1' && s.start === 0 && s.end === 6 * H && s.pinned));
  assert.equal(r.shifts.length, 14);
});
test('daily holds route local duty around cooks and local pins around holds', () => {
  const d = input();
  d.missions.push({ id: 'g', name: 'Guard', type: 'local', count: 1 });
  d.pins.push({ missionId: 'g', employeeId: 'e0', start: H, end: 2 * H });
  const r = plan(d);
  assert.ok(!r.shifts.some((s) => s.missionId === 'k' && s.start === 0 && s.employeeId === 'e0'));
  for (const seg of r.timeline) assert.equal(new Set(seg.onDuty.map((s) => s.employeeId)).size, seg.onDuty.length);
});
test('daily turns ignore future pins and count clipped occurrences as one', () => {
  const d = input();
  d.missions[0].count = 1;
  d.pins = [{ missionId: 'k', employeeId: 'e0', start: 6 * 24 * H, end: 7 * 24 * H }];
  assert.equal(plan(d).shifts.find((s) => s.start === 0).employeeId, 'e0');
});
