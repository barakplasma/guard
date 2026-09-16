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
/**
 * These fixtures are deliberately partial - each exists to provoke one rule, so
 * most of them describe a mission nobody is on for part of the window. That is
 * a real shortfall, and `UNREPORTED_SHORTFALL` would fire on nearly all of them
 * and drown out the rule under test. So unless a test supplies its own
 * warnings, blanket `understaffed` cover is synthesized for every mission:
 * these tests are not the ones asserting that shortages get reported. The
 * dedicated tests for that are at the bottom of this file, and the property
 * suite exercises it across ~1900 generated plans.
 */
const blanketCover = (i) => i.missions.map(
  (m) => ({ code: 'understaffed', missionId: m.id, start: -Infinity, end: Infinity }),
);
// Unconditional: `validateSchedule(..., 'report')` mutates `r.warnings` in
// place, so "did the caller supply warnings" is not a question this helper can
// answer after the first call.
const codes = (r, i = input) => checkSchedule(
  { ...r, warnings: [...(r.warnings ?? []), ...blanketCover(i)] },
  i,
).map((v) => v.rule);
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

test('a shortfall nobody reported is an engine bug', () => {
  // The check an empty schedule cannot pass. Mission `g` runs the whole plan
  // and needs one person; the second hour has nobody and says nothing about it.
  const short = { ...result([row()]), warnings: [] };
  assert.ok(checkSchedule(short, input).some((v) => v.rule === 'UNREPORTED_SHORTFALL'));

  // Reporting it makes the same schedule legal: short is allowed, silent is not.
  const honest = { ...result([row()]), warnings: [{ code: 'understaffed', missionId: 'g', start: H, end: 2 * H }] };
  assert.deepEqual(checkSchedule(honest, input).map((v) => v.rule), []);
});

test('a schedule with no shifts at all is caught, not waved through', () => {
  const empty = { shifts: [], warnings: [], timeline: [{ start: 0, end: 2 * H, onDuty: [] }] };
  assert.ok(checkSchedule(empty, input).some((v) => v.rule === 'UNREPORTED_SHORTFALL'));
});

test('warnings may tile the shortfall in pieces', () => {
  // The engine reports per grid segment, so no single warning spans the gap.
  const pieces = { ...result([row()]), warnings: [
    { code: 'understaffed', missionId: 'g', start: H, end: H * 1.5 },
    { code: 'understaffed', missionId: 'g', start: H * 1.5, end: 2 * H },
  ] };
  assert.deepEqual(checkSchedule(pieces, input).map((v) => v.rule), []);
});

test('an accepted pin that vanished from the output is an engine bug', () => {
  const i = { ...input, employees: [{ id: 'a' }], pins: [{ missionId: 'g', employeeId: 'a', start: 0, end: 2 * H }] };
  const dropped = { shifts: [], warnings: [{ code: 'understaffed', missionId: 'g', start: 0, end: 2 * H }],
    timeline: [{ start: 0, end: 2 * H, onDuty: [] }] };
  assert.ok(checkSchedule(dropped, i).some((v) => v.rule === 'PIN_DROPPED'));
});

test('a pin honoured as several rows, one per segment, is not dropped', () => {
  const i = { ...input, employees: [{ id: 'a' }], pins: [{ missionId: 'g', employeeId: 'a', start: 0, end: 2 * H }] };
  const halves = [row({ pinned: true }), row({ pinned: true, start: H, end: 2 * H, slotStart: H, slotEnd: 2 * H })];
  const r = { ...result(halves), warnings: [] };
  assert.ok(!checkSchedule(r, i).some((v) => v.rule === 'PIN_DROPPED'));
});
