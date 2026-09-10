import test from 'node:test';
import assert from 'node:assert/strict';
import { planSchema, toPlannerInput, dailyOccurrences } from '../src/lib/planSchema.js';
import { applyClearPin, applySwap, freezePastShifts, clearStalePins } from '../src/lib/pins.js';
import { plan } from '../src/lib/planner.js';
const at = (d, h = 8) => new Date(2026, 8, d, h).getTime();
function doc(pins) {
  return planSchema.parse({ start: at(10), end: at(13), shiftMinutes: 60,
    employees: ['a', 'b', 'c'].map((id) => ({ id, name: id })),
    missions: [{ id: 'k', name: 'K', type: 'daily', count: 1, dayStart: 480, dayEnd: 480 }], pins });
}
test('partial daily pin can be cleared and swapped by its displayed occurrence', () => {
  const d = doc([{ missionId: 'k', employeeId: 'b', start: at(10, 9), end: at(10, 10) }]);
  const target = { missionId: 'k', employeeId: 'b', start: at(10), end: at(11) };
  assert.equal(applyClearPin(d, target).pins.length, 0);
  const swapped = applySwap(d, { ...target, employeeId: 'c', replacingEmployeeId: 'b' });
  assert.equal(swapped.pins.length, 1);
  assert.equal(plan(toPlannerInput(swapped)).shifts[0].employeeId, 'c');
});
test('clearing a day from an all-days pin preserves neighboring days and frozen flag', () => {
  const d = doc([{ missionId: 'k', employeeId: 'b', frozen: true }]);
  const next = applyClearPin(d, { missionId: 'k', employeeId: 'b', start: at(11), end: at(12) });
  const pinned = plan(toPlannerInput(next)).shifts.filter((s) => s.pinned);
  assert.deepEqual(pinned.map((s) => s.start), [at(10), at(12)]);
  assert.ok(pinned.every((s) => s.frozen));
});
test('freezing and stale cleanup preserve daily boundaries', () => {
  const d = doc([]), result = plan(toPlannerInput(d));
  const frozen = freezePastShifts(d, result, at(11));
  assert.equal(frozen.pins.length, 1);
  assert.deepEqual({ start: frozen.pins[0].start, end: frozen.pins[0].end }, dailyOccurrences(d, d.missions[0])[0]);
  assert.equal(clearStalePins({ ...frozen, start: at(11) }).pins.length, 0);
});
test('report-mode engine evidence must never become historical pins', () => {
  const d = doc([]), result = plan(toPlannerInput(d));
  result.warnings.push({ code: 'engine-bug', rule: 'DOUBLE_BOOKED' });
  assert.equal(freezePastShifts(d, result, at(13)), d);
});
