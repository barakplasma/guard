import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/lib/planner.js';
const H = 3600000;
function input(type = 'local') {
  return { start: 0, end: 2 * H, shiftMinutes: 60,
    tags: [{ id: 'd', name: 'Driver' }, { id: 'c', name: 'Commander' }],
    employees: [{ id: 'both', name: 'Both', tags: ['d', 'c'] }, { id: 'c', name: 'C', tags: ['c'] }, { id: 'none', name: 'None' }],
    missions: [{ id: 'g', name: 'G', type, count: 2, requires: [{ tag: 'd', count: 1 }, { tag: 'c', count: 1 }],
      ...(type === 'daily' ? { occurrences: [{ start: 0, end: 2 * H }] } : {}) }] };
}
for (const type of ['local', 'remote', 'daily']) test(`${type}: qualification coverage is complete and visible`, () => {
  const r = plan(input(type));
  assert.ok(r.shifts.every((s) => s.employeeId !== 'none'));
  assert.ok(r.shifts.some((s) => s.qualifications?.includes('d')));
  assert.ok(!r.warnings.some((w) => w.code === 'missing-required-tag'));
});
test('combined holder covers two roles within one seat', () => {
  const d = input(); d.missions[0].count = 1;
  assert.ok(plan(d).shifts.every((s) => s.employeeId === 'both'));
});
test('excluded candidates never fill automatically; explicit pins override with a finding', () => {
  const d = input(); d.missions[0].excludes = ['c'];
  assert.ok(plan(d).shifts.every((s) => s.employeeId === 'none'));
  d.pins = [{ missionId: 'g', employeeId: 'both' }];
  const r = plan(d);
  assert.ok(r.shifts.some((s) => s.employeeId === 'both' && s.pinned));
  assert.ok(r.warnings.some((w) => w.code === 'pin-excluded-tag'));
});
test('missing qualifications aggregate windows even when unqualified pins fill capacity', () => {
  const d = input(); d.missions[0].count = 1;
  d.pins = [{ missionId: 'g', employeeId: 'none' }];
  const r = plan(d), warnings = r.warnings.filter((w) => w.code === 'missing-required-tag');
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((w) => w.windows.length > 0));
});
for (const type of ['local', 'remote', 'daily']) test(`${type}: completely empty mission still reports missing qualifications at its own window`, () => {
  const d = input(type);
  d.employees = [{ id: 'none', name: 'None', tags: ['c'] }];
  d.missions[0].start = H;
  d.missions[0].excludes = ['c'];
  if (type === 'daily') d.missions[0].occurrences = [{ start: H, end: 2 * H }];
  const r = plan(d);
  assert.equal(r.shifts.length, 0);
  const missing = r.warnings.find((w) => w.code === 'missing-required-tag');
  assert.ok(missing);
  assert.deepEqual(missing.windows.map(({ start, end }) => ({ start, end })), [{ start: H, end: 2 * H }]);
});
test('understaffing includes pinned people in the reported crew size', () => {
  const d = input(); d.missions[0].count = 4;
  d.pins = [{ missionId: 'g', employeeId: 'both' }];
  assert.ok(plan(d).warnings.filter((w) => w.code === 'understaffed').every((w) => w.got === 3));
});

for (const type of ['local', 'remote', 'daily']) {
  for (const constraint of ['excludes', 'requires']) test(`${type}: scarce eligible crew is reserved before a generic mission`, () => {
    const missions = ['a', 'b'].map((id) => ({ id, name: id, type, count: 1,
      ...(type === 'daily' ? { occurrences: [{ start: 0, end: H }] } : {}) }));
    missions[1][constraint] = constraint === 'excludes' ? ['x'] : [{ tag: 'd', count: 1 }];
    const result = plan({ start: 0, end: H, shiftMinutes: 60, missions,
      employees: [{ id: 'a', name: 'A', tags: ['d'] }, { id: 'b', name: 'B', tags: ['x'] }] });
    assert.equal(result.shifts.length, 2);
    assert.equal(result.shifts.find((s) => s.missionId === 'b').employeeId, 'a');
    assert.ok(!result.warnings.some((w) => ['understaffed', 'missing-required-tag'].includes(w.code)));
  });
}
