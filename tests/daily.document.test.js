import test from 'node:test';
import assert from 'node:assert/strict';
import { planSchema, toPlannerInput } from '../src/lib/planSchema.js';
import { encodePlan, decodePlan } from '../src/lib/urlState.js';

const at = (day, hour = 8) => new Date(2026, 8, day, hour).getTime();
const doc = (patch = {}) => planSchema.parse({
  start: at(10), end: at(13), shiftMinutes: 60,
  missions: [{ id: 'k', name: 'Kitchen', type: 'daily', count: 2,
    dayStart: 480, dayEnd: 480, ...patch }],
});

test('08:00–08:00 yields one full calendar-day occurrence per day', () => {
  assert.deepEqual(toPlannerInput(doc()).missions[0].occurrences,
    [10, 11, 12].map((d) => ({ start: at(d), end: at(d + 1) })));
});
test('daily bounds survive URL including midnight and unset bounds', () => {
  for (const dayEnd of [0, 480, null]) {
    const d = doc({ dayStart: 0, dayEnd });
    assert.deepEqual(decodePlan(encodePlan(d)).plan, d);
  }
});
test('daily windows are clipped, overnight includes previous day, incomplete is empty', () => {
  const d = doc({ dayStart: 22 * 60, dayEnd: 10 * 60, start: at(10, 9), end: at(11, 9) });
  assert.deepEqual(toPlannerInput(d).missions[0].occurrences,
    [{ start: at(10, 9), end: at(10, 10) }, { start: at(10, 22), end: at(11, 9) }]);
  assert.deepEqual(toPlannerInput(doc({ dayStart: null })).missions[0].occurrences, []);
});
test('DST keeps daily boundaries at 08:00 local', () => {
  const prev = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Jerusalem';
    const d = doc();
    d.start = new Date(2026, 9, 24, 8).getTime();
    d.end = new Date(2026, 9, 27, 8).getTime();
    const windows = toPlannerInput(d).missions[0].occurrences;
    assert.equal(windows.length, 3);
    assert.ok(windows.every((w) => new Date(w.start).getHours() === 8 && new Date(w.end).getHours() === 8));
    assert.equal(windows[0].end - windows[0].start, 25 * 3600000);
  } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
});
