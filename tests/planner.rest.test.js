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
test('an on-call mission is slept through: night rest survives duty on it', () => {
  // Same shape as the single-crew test above that reports rest-unsatisfied -
  // the on-call flag is the only difference.
  const d = input(1);
  d.missions[0].onCall = true;
  const r = plan(d);
  assert.equal(r.shifts.length, 8);
  assert.ok(!r.warnings.some((w) => w.code === 'rest-unsatisfied'));
});

for (const strategy of ['balanced', 'rotation']) {
  test(`${strategy}: on-call selection does not deprioritize a person in a rest block`, () => {
    const d = input(2);
    d.strategy = strategy;
    d.missions[0].end = H;
    assert.equal(plan(d).shifts[0].employeeId, 'e1', 'ordinary duty protects the driver');
    d.missions[0].onCall = true;
    assert.equal(plan(d).shifts[0].employeeId, 'e0', 'on-call respects strategy ordering');
  });

  test(`${strategy}: an on-call pin permits uninterrupted rest across mixed assignments`, () => {
    const d = input(2);
    d.strategy = strategy;
    d.missions.unshift({ id: 'call', name: 'Call', type: 'local', count: 1, onCall: true, start: 2 * H, end: 3 * H });
    d.pins = [{ missionId: 'call', employeeId: 'e0' }];
    const r = plan(d);
    assert.ok(r.shifts.some((s) => s.missionId === 'call' && s.employeeId === 'e0' && s.pinned));
    assert.ok(!r.warnings.some((w) => ['rest-unsatisfied', 'understaffed'].includes(w.code)));
    assert.ok(r.shifts.filter((s) => s.employeeId === 'e0' && s.missionId === 'g').every((s) => s.start >= 6 * H));
    const ordinaryMinutes = r.shifts.filter((s) => s.employeeId === 'e0' && s.missionId === 'g').reduce((n, s) => n + (s.end - s.start) / 60000, 0);
    assert.ok(ordinaryMinutes > 0);
    assert.equal(r.stats.perEmployee.find((e) => e.employeeId === 'e0').minutes, 60 + ordinaryMinutes, 'on-call and ordinary hours both count');
    for (const e of d.employees) {
      const shifts = r.shifts.filter((s) => s.employeeId === e.id).sort((a, b) => a.start - b.start);
      for (let i = 1; i < shifts.length; i++) assert.ok(shifts[i - 1].end <= shifts[i].start, 'on-call still blocks overlapping assignments');
    }
    d.missions[0].onCall = false;
    assert.ok(plan(d).warnings.some((w) => w.code === 'rest-unsatisfied' && w.employeeId === 'e0'));
  });
}

test('ordinary duty still interrupts rest between pinned on-call duties', () => {
  const d = input(1);
  d.missions = [
    { id: 'before', name: 'Before', type: 'remote', count: 1, onCall: true, start: 0, end: 3 * H },
    { id: 'awake', name: 'Awake', type: 'local', count: 1, start: 3 * H, end: 4 * H },
    { id: 'after', name: 'After', type: 'remote', count: 1, onCall: true, start: 4 * H, end: 8 * H },
  ];
  d.pins = d.missions.map((m) => ({ missionId: m.id, employeeId: 'e0' }));
  const r = plan(d);
  const warning = r.warnings.find((w) => w.code === 'rest-unsatisfied');
  assert.equal(warning.got, 240, 'rest cannot bridge the ordinary hour');
  assert.equal(warning.needed, 360);
  assert.equal(r.stats.perEmployee[0].minutes, 480);
  assert.ok(r.shifts.every((s) => s.pinned));
});

for (const type of ['local', 'remote', 'daily']) {
  test(`${type}: on-call preserves qualification, exclusion, and availability constraints`, () => {
    const d = input(4);
    d.tags.push({ id: 'excluded', name: 'Excluded' });
    d.employees[1].tags = ['d', 'excluded'];
    d.employees[2].tags = ['d'];
    d.employees[2].end = 0;
    d.missions = [{ id: 'g', name: 'G', type, count: 1, onCall: true,
      requires: [{ tag: 'd', count: 1 }], excludes: ['excluded'],
      ...(type === 'daily' ? { occurrences: [{ start: 0, end: 8 * H }] } : {}) }];
    const r = plan(d);
    assert.ok(r.shifts.length > 0);
    assert.ok(r.shifts.every((s) => s.employeeId === 'e0'));
    assert.ok(!r.warnings.some((w) => ['rest-unsatisfied', 'missing-required-tag', 'understaffed'].includes(w.code)));
    assert.equal(r.stats.perEmployee.find((e) => e.employeeId === 'e0').minutes, 480);
  });
}

test('on-call hours remain part of balanced workload selection', () => {
  const d = input(2);
  d.tags = [];
  d.missions = [
    { id: 'call', name: 'Call', type: 'remote', count: 1, onCall: true, start: 0, end: 4 * H },
    { id: 'g', name: 'G', type: 'local', count: 1, start: 4 * H, end: 8 * H },
  ];
  d.pins = [{ missionId: 'call', employeeId: 'e0' }];
  const r = plan(d);
  assert.ok(r.shifts.filter((s) => s.missionId === 'g').every((s) => s.employeeId === 'e1'));
  assert.deepEqual(r.stats.perEmployee.map((e) => e.minutes), [240, 240]);
});
