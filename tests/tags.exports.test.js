import test from 'node:test';
import assert from 'node:assert/strict';
import { planSchema, toPlannerInput } from '../src/lib/planSchema.js';
import { plan } from '../src/lib/planner.js';
import { planToReadableText } from '../src/lib/planText.js';
import { shiftsToCsv } from '../src/lib/exportCsv.js';
test('shared plan text and CSV carry named qualifications and requirements', () => {
  const doc = planSchema.parse({ start: 0, end: 3600000, shiftMinutes: 60,
    tags: [{ id: 'd', name: 'נהג', minNightRestMinutes: 360 }],
    employees: [{ id: 'a', name: 'אבי', tags: ['d'] }],
    missions: [{ id: 'g', name: 'שער', type: 'local', count: 1, requires: [{ tag: 'd', count: 1 }] }] });
  const text = planToReadableText(doc);
  assert.match(text, /נהג/); assert.match(text, /360/);
  const csv = shiftsToCsv(plan(toPlannerInput(doc)), doc);
  assert.match(csv, /נהג/); assert.match(csv, /הסמכות נדרשות/);
});
