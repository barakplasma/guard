import test from 'node:test';
import assert from 'node:assert/strict';
import { outOfPeriodLog, outOfPeriodCount, logFilename } from '../src/lib/logExport.js';
import {
  captureHistory, clearStalePins, countStalePins,
  applyRemoveEmployee, applyRemoveMission, applyClearManualPins, releasablePins,
} from '../src/lib/pins.js';
import { planSchema, prunePins } from '../src/lib/planSchema.js';
import { shiftsToCsv } from '../src/lib/exportCsv.js';

/**
 * ADR 012: a rolled-past window is exported, not dropped. The export is
 * therefore the only durable record, so what it carries has to be exactly what
 * the button removes - otherwise clearing loses assignments the export never
 * saw, which is the failure the whole decision exists to prevent.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BASE = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();

const doc = (over = {}) => planSchema.parse({
  title: 'משמרות ינואר',
  start: BASE + 3 * DAY, end: BASE + 6 * DAY, shiftMinutes: 60, strategy: 'rotation',
  employees: [
    { id: 'e1', name: 'דנה', tags: ['driver'] },
    { id: 'e2', name: 'יוסי', tags: [] },
  ],
  missions: [{ id: 'm1', name: 'שער', type: 'local', count: 2 }],
  tags: [{ id: 'driver', name: 'נהג' }],
  pins: [
    // Two assignments from the window the plan has rolled past.
    { missionId: 'm1', employeeId: 'e1', start: BASE + HOUR, end: BASE + 2 * HOUR, frozen: true },
    { missionId: 'm1', employeeId: 'e2', start: BASE + HOUR, end: BASE + 2 * HOUR, frozen: false },
    // One inside the current period, which is not history.
    { missionId: 'm1', employeeId: 'e1', start: BASE + 4 * DAY, end: BASE + 4 * DAY + HOUR },
  ],
  ...over,
});

test('an assignment beyond the period end is not exported as history', () => {
  // `isOutOfPeriod` is true on both sides of the window, which is right for the
  // engine - it schedules neither - and wrong for a file that says what
  // happened. Before this split, an assignment made for a week after the period
  // was written here as completed duty and then removed by the button beside
  // the warning: somebody's plan, consumed by narrowing the period.
  const later = { start: BASE + 20 * DAY, end: BASE + 20 * DAY + 4 * HOUR };
  const d = doc({
    missions: [{ id: 'next', name: 'שבוע הבא', type: 'local', ...later, count: 1 }],
    pins: [{ missionId: 'next', employeeId: 'e1', ...later, frozen: false }],
  });
  assert.equal(outOfPeriodLog(d).length, 0, 'nothing to export');
  assert.equal(countStalePins(d), 0, 'and nothing offered for removal');
  assert.equal(clearStalePins(d).pins.length, 1, 'so pressing the button leaves it alone');
});

test('the export carries exactly what the button removes', () => {
  const d = doc();
  assert.equal(outOfPeriodCount(d), countStalePins(d),
    'the export and the cleanup must share one predicate');

  const exported = outOfPeriodLog(d);
  const remaining = clearStalePins(d).pins.length;
  assert.equal(exported.length + remaining, d.pins.length,
    'every pin is either exported or kept, never silently dropped');
});

test('a logged assignment keeps who, when, which mission, and how it was made', () => {
  const [first] = outOfPeriodLog(doc());
  assert.equal(first.employeeName, 'דנה');
  assert.equal(first.missionName, 'שער');
  assert.equal(first.start, BASE + HOUR);
  assert.equal(first.end, BASE + 2 * HOUR);
  assert.equal(first.pinned, true, 'every logged row is a recorded assignment');
  assert.equal(first.frozen, true, 'preserved history is distinguishable from a hand edit');
  assert.deepEqual(first.qualifications, ['driver']);
});

test('the log renders through the ordinary CSV export', () => {
  const csv = shiftsToCsv({ shifts: outOfPeriodLog(doc()) }, doc());
  assert.ok(csv.includes('דנה'), 'the person is named');
  assert.ok(csv.includes('שער'), 'so is the mission');
  assert.ok(csv.startsWith('﻿'), 'the BOM survives, or Excel mangles the Hebrew');
});

test('the order is stable, so two exports of one document match', () => {
  const d = doc();
  assert.deepEqual(outOfPeriodLog(d), outOfPeriodLog(d));
});

test('a pin naming a deleted person or mission is omitted, not exported blank', () => {
  const d = doc({ employees: [{ id: 'e2', name: 'יוסי', tags: [] }] });
  const rows = outOfPeriodLog(d);
  assert.ok(rows.every((r) => r.employeeName), 'no row without a name');
  assert.ok(rows.every((r) => r.missionName), 'no row without a mission');
});

test('the filename says which plan and which days it covers', () => {
  const name = logFilename(doc());
  assert.ok(name.startsWith('משמרות-ינואר-history-'), name);
  assert.ok(name.endsWith('.csv'), name);
});

test('nothing outside the period means nothing to export', () => {
  const d = doc({ start: BASE, end: BASE + 6 * DAY });
  assert.equal(outOfPeriodCount(d), 0);
  assert.deepEqual(outOfPeriodLog(d), []);
});

/* --- history must not be a set of live references --------------------- */

test('deleting a guard does not delete the record of what they stood', () => {
  // The reported failure, reproduced. Two mechanisms lost it, not one:
  // `prunePins` dropped the pin because its employee was gone, and even with
  // the pin kept, `outOfPeriodLog` skipped any row it could not name.
  const before = doc();
  assert.equal(outOfPeriodCount(before), 2);

  const edited = captureHistory(before, {
    ...before,
    employees: before.employees.filter((e) => e.id !== 'e1'),
  });
  const after = planSchema.parse(prunePins(edited));

  const rows = outOfPeriodLog(after);
  assert.equal(rows.length, 2, 'both elapsed assignments are still on the record');
  const hers = rows.find((r) => r.employeeId === 'e1');
  assert.equal(hers.employeeName, 'דנה', 'named from the record, not the roster she has left');
  assert.deepEqual(hers.qualifications, ['driver'], 'and qualified as she was at the time');
});

test('deleting a mission does not delete the record of duty on it', () => {
  const before = doc();
  const edited = captureHistory(before, { ...before, missions: [] });
  const after = planSchema.parse(prunePins(edited));

  const rows = outOfPeriodLog(after);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.missionName === 'שער'));
  assert.ok(rows.every((r) => r.type === 'local'));
});

/**
 * The two tests above build the edit by hand. The app's own buttons also
 * deleted the removed guard's or mission's pins inside the edit - before
 * `captureHistory` could stamp them or `prunePins` could spare the stamped
 * ones - so the fix they prove never reached the screen. `setDoc`'s order,
 * applied to the mutators the UI actually calls:
 */
const throughSetDoc = (before, edit) => planSchema.parse(prunePins(captureHistory(before, edit(before))));

test('the remove-guard button keeps the record, already stamped or not', () => {
  for (const before of [doc(), captureHistory(doc(), doc())]) {
    const after = throughSetDoc(before, (d) => applyRemoveEmployee(d, 'e1'));
    assert.equal(outOfPeriodLog(after).length, 2, 'both elapsed assignments are still on the record');
    assert.equal(outOfPeriodLog(after).find((r) => r.employeeId === 'e1').employeeName, 'דנה');
    assert.ok(after.pins.every((p) => p.employeeId !== 'e1' || p.record), 'her live assignment is gone');
  }
});

test('the remove-mission button keeps the record of duty on it', () => {
  const after = throughSetDoc(captureHistory(doc(), doc()), (d) => applyRemoveMission(d, 'm1'));
  assert.equal(outOfPeriodLog(after).length, 2);
  assert.ok(after.pins.every((p) => p.record), 'only the history survives');
});

test('clearing manual assignments clears only what is not yet history', () => {
  const before = captureHistory(doc(), doc());
  assert.equal(releasablePins(before).length, 1, 'the dialog counts the one live pin');
  const after = throughSetDoc(before, applyClearManualPins);
  assert.equal(outOfPeriodLog(after).length, 2);
  assert.equal(releasablePins(after).length, 0, 'and the button then has nothing left to offer');
});

test('renaming a guard does not rewrite what the history file says they did', () => {
  // The accuracy issue from the same review. A record read through the live
  // employee list is a record of who they are now, not of who stood the post.
  const before = doc();
  const stamped = captureHistory(before, before);
  const renamed = planSchema.parse({
    ...stamped,
    employees: stamped.employees.map((e) => (e.id === 'e1' ? { ...e, name: 'דנה כהן', tags: [] } : e)),
  });

  const hers = outOfPeriodLog(renamed).find((r) => r.employeeId === 'e1');
  assert.equal(hers.employeeName, 'דנה', 'the name she held when she stood it');
  assert.deepEqual(hers.qualifications, ['driver'], 'and the qualification she held then');
});

test('an assignment still inside the period keeps following its mission', () => {
  // The other half of the rule: only history is stamped. A live pin is still an
  // instruction, so it must keep inheriting - stamping it would freeze it
  // against a mission the user may yet move.
  const before = doc();
  const after = captureHistory(before, before);
  const live = after.pins.find((p) => p.start === BASE + 4 * DAY);
  assert.equal(live.record, null);
});

test('a window rolled forward and a guard removed in the same edit still records them', () => {
  // The case that decides which document each half of captureHistory reads.
  // Under the old period this assignment is not history yet; under the new one
  // it is, and by then she is already gone from the roster. Asking one document
  // both questions loses it in one direction or the other.
  const before = doc({
    start: BASE, end: BASE + 3 * DAY, pins: [
      { missionId: 'm1', employeeId: 'e1', start: BASE + HOUR, end: BASE + 2 * HOUR, frozen: true },
    ],
  });
  assert.equal(outOfPeriodCount(before), 0, 'nothing is history yet');

  const rolled = captureHistory(before, {
    ...before,
    start: BASE + 3 * DAY,
    end: BASE + 6 * DAY,
    employees: before.employees.filter((e) => e.id !== 'e1'),
  });
  const after = planSchema.parse(prunePins(rolled));

  const rows = outOfPeriodLog(after);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].employeeName, 'דנה');
});

test('a stamped pin no longer follows a mission window that moves', () => {
  // Bounds are live references too. A whole-mission pin inherits the mission's
  // window, so moving the mission would otherwise move the recorded hours.
  const before = doc({
    start: BASE + 3 * DAY, end: BASE + 6 * DAY,
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 1, start: BASE, end: BASE + HOUR }],
    pins: [{ missionId: 'm1', employeeId: 'e1', start: null, end: null, frozen: true }],
  });
  const stamped = captureHistory(before, before);
  const moved = planSchema.parse({
    ...stamped,
    missions: [{ ...stamped.missions[0], start: BASE + DAY, end: BASE + DAY + HOUR }],
  });

  const rows = outOfPeriodLog(moved);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].start, BASE, 'the hours it recorded, not the hours the mission now covers');
  assert.equal(rows[0].end, BASE + HOUR);
});
