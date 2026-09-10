import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/lib/planner.js';
const H = 3600000;
function input(n = 4) {
  return { start: 0, end: 8 * H, shiftMinutes: 60, nightWindows: [{ start: 0, end: 8 * H }],
    tags: [{ id: 'd', name: 'Driver', minNightRestMinutes: 360 }],
    employees: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, name: `E${i}`, tags: i === 0 ? ['d'] : [] })),
    missions: [{ id: 'g', name: 'G', type: 'local', count: 1 }] };
}
test('rest is preserved with spare crew, and is not counted as work', () => {
  const d = input(), r = plan(d);
  assert.ok(!r.warnings.some((w) => w.code === 'rest-unsatisfied'));
  const driver = r.shifts.filter((s) => s.employeeId === 'e0');
  assert.ok(driver.reduce((n, s) => n + s.end - s.start, 0) <= 2 * H);
  assert.equal(r.stats.perEmployee.find((e) => e.employeeId === 'e0').minutes,
    driver.reduce((n, s) => n + (s.end - s.start) / 60000, 0));
});
test('staff duties anyway when rest cannot coexist with coverage', () => {
  const r = plan(input(1));
  assert.equal(r.shifts.length, 8);
  assert.ok(!r.warnings.some((w) => w.code === 'understaffed'));
  assert.ok(r.warnings.some((w) => w.code === 'rest-unsatisfied' && w.got === 0));
});
test('two drivers cannot cover eight hours and each sleep six; report actual deficit', () => {
  const d = input(2); d.employees[1].tags = ['d'];
  d.missions[0].requires = [{ tag: 'd', count: 1 }];
  const r = plan(d);
  assert.ok(r.warnings.some((w) => w.code === 'rest-unsatisfied'));
  assert.ok(!r.warnings.some((w) => w.code === 'missing-required-tag'));
});
test('pins stand, multiple rest tags use maximum, partial nights are not certified', () => {
  const d = input(); d.tags.push({ id: 'c', name: 'C', minNightRestMinutes: 420 });
  d.employees[0].tags.push('c'); d.pins = [{ missionId: 'g', employeeId: 'e0' }];
  const r = plan(d);
  assert.equal(r.warnings.find((w) => w.code === 'rest-unsatisfied').needed, 420);
  d.nightWindows[0].start = -H;
  assert.ok(plan(d).warnings.some((w) => w.code === 'rest-incomplete'));
});
test('rest-preserving combined roles beat separate roles that break rest unnecessarily', () => {
  const d = input(3);
  d.tags = [{ id: 'rest', name: 'Rest', minNightRestMinutes: 360 }, { id: 'd', name: 'D' }, { id: 'c', name: 'C' }];
  d.employees[0].tags = ['rest', 'd']; d.employees[1].tags = ['d', 'c'];
  d.missions[0].count = 2;
  d.missions[0].requires = [{ tag: 'd', count: 1 }, { tag: 'c', count: 1 }];
  assert.ok(!plan(d).warnings.some((w) => w.code === 'rest-unsatisfied'));
});
