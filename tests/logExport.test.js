import test from 'node:test';
import assert from 'node:assert/strict';
import { outOfPeriodLog, outOfPeriodCount, logFilename } from '../src/lib/logExport.js';
import { clearStalePins, countStalePins } from '../src/lib/pins.js';
import { planSchema } from '../src/lib/planSchema.js';
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
