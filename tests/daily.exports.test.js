import test from 'node:test';
import assert from 'node:assert/strict';
import { planSchema, toPlannerInput } from '../src/lib/planSchema.js';
import { plan } from '../src/lib/planner.js';
import { planToReadableText } from '../src/lib/planText.js';
import { shiftsToCsv } from '../src/lib/exportCsv.js';
import { overviewIcs } from '../src/lib/exportIcal.js';
const start = new Date(2026, 8, 10, 8).getTime();
test('daily exports identify full-day duty and calendar keeps its end', () => {
  const doc = planSchema.parse({ start, end: start + 86400000, shiftMinutes: 60,
    employees: [{ id: 'a', name: 'A' }], missions: [{ id: 'k', name: 'K', type: 'daily', dayStart: 480, dayEnd: 480, count: 1 }] });
  const result = plan(toPlannerInput(doc));
  const text = planToReadableText(doc);
  assert.match(text, /יומית/);
  assert.match(text, /08:00–08:00/);
  assert.match(text, /למחרת/);
  assert.match(shiftsToCsv(result), /יומית/);
  assert.match(overviewIcs(result), /DURATION:P1D|DURATION:PT24H|DTEND/);
});
test('calendar does not weld adjacent daily occurrences held by the same cook', () => {
  const doc = planSchema.parse({ start, end: start + 2 * 86400000, shiftMinutes: 60,
    employees: [{ id: 'a', name: 'A' }], missions: [{ id: 'k', name: 'K', type: 'daily', dayStart: 480, dayEnd: 480, count: 1 }] });
  assert.equal(overviewIcs(plan(toPlannerInput(doc))).split('BEGIN:VEVENT').length - 1, 2);
});
