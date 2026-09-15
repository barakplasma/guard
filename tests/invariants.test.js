import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSchedule, validateSchedule, qualityWarnings } from '../src/lib/invariants.js';
const H = 3600000;
const input = { start: 0, end: 2 * H, shiftMinutes: 60,
  employees: [{ id: 'a', start: 0, end: H }],
  missions: [{ id: 'g', type: 'local', count: 1 }] };
const row = (patch = {}) => ({ missionId: 'g', employeeId: 'a', type: 'local',
  start: 0, end: H, slotStart: 0, slotEnd: H, pinned: false, ...patch });
const result = (shifts) => ({ shifts, timeline: [{ start: 0, end: H,
  onDuty: shifts.filter((s) => s.start < H && s.end > 0) }, { start: H, end: 2 * H,
  onDuty: shifts.filter((s) => s.start < 2 * H && s.end > H) }] });
const codes = (r, i = input) => checkSchedule(r, i).map((v) => v.rule);
test('checker accepts a valid slot and catches duplicate seats', () => {
  assert.deepEqual(codes(result([row()])), []);
  const c = codes(result([row(), row()]));
  assert.ok(c.includes('DOUBLE_BOOKED')); assert.ok(c.includes('OVERSTAFFED'));
});
test('row geometry and availability use the pin exemption only for availability', () => {
  assert.ok(codes(result([row({ end: 2 * H })])).includes('ROW_EXCEEDS_SLOT'));
  const later = row({ start: H, end: 2 * H, slotStart: H, slotEnd: 2 * H });
  assert.ok(codes(result([later])).includes('OUTSIDE_AVAILABILITY'));
  assert.deepEqual(codes(result([{ ...later, pinned: true }])), []);
  assert.ok(codes(result([row({ start: -H, pinned: true })])).includes('OUTSIDE_MISSION_WINDOW'));
});
test('holds must equal their whole occurrence, not merely fit inside it', () => {
  const i = { ...input, missions: [{ id: 'g', type: 'daily', count: 1, occurrences: [{ start: 0, end: H }] }] };
  assert.ok(codes(result([row({ type: 'daily', end: H / 2 })]), i).includes('DAILY_NOT_WHOLE'));
  assert.deepEqual(codes(result([row({ type: 'daily' })]), i), []);
});
test('timeline gaps and omissions are invalid independently of its onDuty list', () => {
  const r = result([row()]); r.timeline[0].end = H / 2;
  assert.ok(codes(r).includes('TIMELINE_GAP'));
  const omitted = result([row(), row()]); omitted.timeline[0].onDuty = [];
  assert.ok(codes(omitted).includes('DOUBLE_BOOKED'));
  assert.ok(codes(omitted).includes('TIMELINE_MISMATCH'));
});
test('strict errors name the fault; report mode retains shifts and findings', () => {
  const r = { ...result([row(), row()]), warnings: [] };
  assert.throws(() => validateSchedule(r, input), /DOUBLE_BOOKED.*a.*g/);
  assert.equal(validateSchedule(r, input, 'report'), r);
  assert.ok(r.warnings.some((w) => w.code === 'engine-bug'));
});
test('quality warnings aggregate distinct slots and skip deliberate pinned runs', () => {
  const rows = [0, 1, 2].map((n) => row({ start: n * H, end: (n + 1) * H, slotStart: n * H }));
  assert.equal(qualityWarnings(rows).find((w) => w.code === 'long-unbroken-run').count, 3);
  assert.deepEqual(qualityWarnings(rows.map((s) => ({ ...s, pinned: true }))), []);
  assert.deepEqual(qualityWarnings([row({ end: H / 2 }), row({ start: H / 2 })]), []);
});
test('qualification claims are checked and missing coverage is not an invariant', () => {
  assert.ok(codes(result([row({ qualifications: ['fake'] })])).includes('FALSE_QUALIFICATION'));
  assert.deepEqual(codes(result([row()]), { ...input, missions: [{ ...input.missions[0], requires: [{ tag: 'fake', count: 1 }] }] }), []);
});
test('a forged slot stamp cannot hide a row crossing a real grid boundary', () => {
  const shifted = row({ start: H / 2, end: 1.5 * H, slotStart: H / 2, slotEnd: 1.5 * H, pinned: true });
  assert.ok(codes(result([shifted])).includes('ROW_EXCEEDS_SLOT'));
});

test('unexpected sub-slot edges are rejected even with correct slot stamps and timeline', () => {
  const shifts = [row({ end: H / 10 }), row({ employeeId: 'b', start: H / 10 })];
  const r = { shifts, warnings: [], timeline: [
    { start: 0, end: H / 10, onDuty: [shifts[0]] },
    { start: H / 10, end: H, onDuty: [shifts[1]] },
    { start: H, end: 2 * H, onDuty: [] },
  ] };
  const i = { ...input, employees: [...input.employees, { id: 'b' }] };
  assert.deepEqual([...new Set(codes(r, i))], ['UNEXPECTED_SHIFT_BOUNDARY']);
  assert.throws(() => validateSchedule(r, i), /UNEXPECTED_SHIFT_BOUNDARY/);
  validateSchedule(r, i, 'report');
  assert.ok(r.warnings.some((w) => w.rule === 'UNEXPECTED_SHIFT_BOUNDARY'));
  // An actual availability change or accepted pin is a legitimate partial shift.
  assert.deepEqual(codes(r, { ...i, employees: [{ id: 'a', end: H / 10 }, { id: 'b' }] }), []);
  assert.deepEqual(codes(r, { ...i, pins: [{ missionId: 'g', employeeId: 'a', start: 0, end: H / 10 }] }), []);
  assert.deepEqual(codes(r, { ...i, missions: [...i.missions,
    { id: 'daily', type: 'daily', count: 1, occurrences: [{ start: H / 10, end: H }] }],
  }), [], 'daily assignments can impose real off-grid boundaries');
  const night = { ...i, nightWindows: [{ start: H / 10, end: H }] };
  assert.ok(codes(r, night).includes('UNEXPECTED_SHIFT_BOUNDARY'), 'unchanged night staffing is not a reason to split');
  assert.deepEqual(codes(r, { ...night, missions: [{ ...i.missions[0], nightCount: 2 }] }), [], 'changed night staffing is a real boundary');
});
