import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/lib/planner.js';
import { planSchema, toPlannerInput } from '../src/lib/planSchema.js';
import { applyCorrection } from '../src/lib/pins.js';

const H = 3600000;
// An evening in the life of the shared schedule: two initiative missions run
// 18:00-20:00, a remote scout mission runs alongside, and exactly one person
// is a qualified driver - the shape whose driver went missing in the shared
// plan this module exists to fix.
function input() {
  return {
    start: 16 * H, end: 23 * H, shiftMinutes: 60,
    nightWindows: [{ start: 22 * H, end: 23 * H }],
    tags: [{ id: 'd', name: 'Driver', minNightRestMinutes: 360 }],
    employees: [
      { id: 'd1', name: 'נהג א׳', tags: ['d'] },
      { id: 'd2', name: 'נהג ב׳', tags: ['d'], start: 0, end: 17 * H }, // gone before the initiatives
      { id: 'c1', name: 'חייל א׳', tags: [] },
      { id: 'c2', name: 'חייל ב׳', tags: [] },
    ],
    missions: [
      { id: 'initiative1', name: 'יוזמה 1', type: 'local', start: 18 * H, end: 20 * H, count: 1 },
      { id: 'initiative2', name: 'יוזמה 2', type: 'local', start: 18 * H, end: 20 * H, count: 1, requires: [{ tag: 'd', count: 1 }] },
      { id: 'scout', name: 'סיור', type: 'remote', start: 17 * H, end: 21 * H, count: 1 },
    ],
    pins: [],
  };
}

const shiftsOn = (r, missionId) => r.shifts.filter((s) => s.missionId === missionId);

test('a driver swallowed by a generated duty is reassigned onto the mission that needs them', () => {
  // Before the repair pass existed, balanced fairness put the only qualified
  // driver on the scout mission (the initiatives start later, and 17:00-21:00
  // carries no rest cost), leaving יוזמה 2 without its driver for two hours.
  const r = plan(input());
  const onInitiative = shiftsOn(r, 'initiative2');
  assert.equal(onInitiative.length, 2, 'both hourly slots are staffed');
  assert.ok(onInitiative.every((s) => s.employeeId === 'd1'));
  assert.ok(!r.warnings.some((w) => w.code === 'missing-required-tag'), JSON.stringify(r.warnings));
  assert.ok(shiftsOn(r, 'scout').some((s) => s.employeeId === 'c1'), 'the scout mission is re-staffed, not dropped');
  assert.ok(!r.warnings.some((w) => w.code === 'engine-bug'), JSON.stringify(r.warnings));
  assert.equal(r.proposals.length, 0, 'a repairable schedule needs no proposal');
});

test('preserved history holding the driver yields an accept-to-apply proposal', () => {
  const d = input();
  d.missions = d.missions.filter((m) => m.id !== 'initiative1');
  d.pins = [{ missionId: 'scout', employeeId: 'd1', start: 17 * H, end: 21 * H, frozen: true }];
  const r = plan(d);
  // The engine never acts on its own: the frozen shift stays exactly as it was.
  assert.ok(shiftsOn(r, 'scout').every((s) => s.employeeId === 'd1' && s.frozen));
  assert.ok(r.warnings.some((w) => w.code === 'missing-required-tag'));
  const [p] = r.proposals;
  assert.equal(p.code, 'correction-proposal');
  assert.equal(p.missionId, 'initiative2');
  assert.equal(p.driverId, 'd1');
  assert.deepEqual(p.release.map((x) => [x.missionId, x.start, x.end]), [['scout', 17 * H, 21 * H]]);
  // With the driver moved onto the short window, c1 is free to stand in.
  assert.equal(p.release[0].substituteId, 'c1');
  assert.equal(p.restImpact, null, 'the evening release touches no night window');
});

test('an accepted correction applies as pins and survives a replan and re-encode', () => {
  const base = Date.parse('2030-09-10T16:00:00Z');
  const spec = input();
  spec.missions = spec.missions.filter((m) => m.id !== 'initiative1');
  const doc = planSchema.parse({
    start: base, end: base + 7 * H, shiftMinutes: 60,
    tags: [{ id: 'd', name: 'Driver', minNightRestMinutes: 360 }],
    employees: spec.employees.map((e) => ({ ...e,
      start: e.start == null ? null : base + (e.start - spec.start),
      end: e.end == null ? null : base + (e.end - spec.start) })),
    missions: spec.missions.map((m) => ({ ...m, start: base + (m.start - spec.start), end: base + (m.end - spec.start) })),
    pins: [{ missionId: 'scout', employeeId: 'd1', start: base + (17 * H - spec.start), end: base + (21 * H - spec.start), frozen: true }],
  });
  const { proposals } = plan(toPlannerInput(doc));
  const next = applyCorrection(doc, proposals[0]);
  const pins = next.pins;
  assert.ok(pins.some((p) => p.missionId === 'initiative2' && p.employeeId === 'd1' && !p.frozen), 'the driver lands on the mission');
  assert.ok(pins.some((p) => p.missionId === 'scout' && p.employeeId === 'c1' && !p.frozen), 'the substitute takes the released duty');
  assert.ok(!pins.some((p) => p.missionId === 'scout' && p.employeeId === 'd1'), 'the released history pin is gone');
  // The corrected document re-plans without the shortage and round-trips the schema.
  const r = plan(toPlannerInput(planSchema.parse(next)));
  assert.ok(shiftsOn(r, 'initiative2').every((s) => s.employeeId === 'd1'));
  assert.ok(!r.warnings.some((w) => w.code === 'missing-required-tag'), JSON.stringify(r.warnings));
  assert.equal(r.proposals.length, 0);
});

test('a manual assignment is never replaced - the blocker is explained instead', () => {
  const d = input();
  d.pins = [{ missionId: 'scout', employeeId: 'd1', start: 17 * H, end: 21 * H }];
  const r = plan(d);
  assert.ok(shiftsOn(r, 'scout').every((s) => s.employeeId === 'd1' && s.pinned && !s.frozen), 'the manual assignment stands');
  assert.ok(r.warnings.some((w) => w.code === 'missing-required-tag'));
  assert.deepEqual(r.proposals.map((p) => p.code), ['correction-blocked']);
  assert.equal(r.proposals[0].driverId, 'd1');
  assert.deepEqual(r.proposals[0].manual.map((x) => x.missionId), ['scout']);
});

test('the proposal reports what moving the driver does to their night rest', () => {
  const d = input();
  d.end = 30 * H;
  d.nightWindows = [{ start: 22 * H, end: 30 * H }];
  d.missions = d.missions.filter((m) => m.id === 'initiative2');
  // Preserved history holds the driver on a scout mission that both blocks
  // the short window and runs two hours into the night.
  d.missions.push({ id: 'scout', name: 'סיור', type: 'remote', start: 17 * H, end: 26 * H, count: 1 });
  d.pins = [{ missionId: 'scout', employeeId: 'd1', start: 17 * H, end: 26 * H, frozen: true }];
  const r = plan(d);
  const [p] = r.proposals;
  assert.equal(p.code, 'correction-proposal');
  assert.equal(p.driverId, 'd1');
  assert.deepEqual(p.release.map((x) => [x.missionId, x.start, x.end, x.substituteId]),
    [['scout', 17 * H, 26 * H, 'c1']]);
  assert.deepEqual(p.restImpact, {
    needed: 360,
    before: { totalMinutes: 240, longestMinutes: 240 },
    after: { totalMinutes: 480, longestMinutes: 480 },
  }, 'the release repairs both the coverage and the driver’s night');
  assert.ok(r.warnings.some((w) => w.code === 'rest-unsatisfied' && w.employeeId === 'd1'),
    'the shortfall is real until the proposal is accepted');
});

test('an unavoidable shortage explains itself without inventing a proposal', () => {
  const d = input();
  d.employees = d.employees.filter((e) => e.id !== 'd1');
  const r = plan(d);
  assert.ok(r.warnings.some((w) => w.code === 'missing-required-tag'));
  assert.equal(r.proposals.length, 0);
});

test('a sole driver held by history can still be proposed - with no substitute invented', () => {
  const d = input();
  d.employees = d.employees.filter((e) => e.id === 'd1');
  d.missions = d.missions.filter((m) => m.id !== 'initiative1');
  d.pins = [{ missionId: 'scout', employeeId: 'd1', start: 17 * H, end: 21 * H, frozen: true }];
  const r = plan(d);
  const [p] = r.proposals;
  assert.equal(p.code, 'correction-proposal');
  assert.equal(p.release[0].substituteId, null, 'nobody exists to stand in - the duty returns to automatic staffing');
});
