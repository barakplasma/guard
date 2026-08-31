import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/lib/planner.js';
import { planSchema, toPlannerInput, nightWindows } from '../src/lib/planSchema.js';

const HOUR = 3600 * 1000;

function localTime(y, m, d, h = 0, min = 0) {
  return new Date(y, m, d, h, min, 0, 0).getTime();
}

/** 06:00, so an eight-hour grid falls on 06:00 / 14:00 / 22:00. */
const START = localTime(2026, 0, 5, 6, 0);
const END = localTime(2026, 0, 6, 6, 0);

const ring = (n) => Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, name: `Emp${i + 1}` }));

const doc = (missions, extra) => planSchema.parse({
  start: START,
  end: END,
  shiftMinutes: 8 * 60,
  strategy: 'rotation',
  employees: ring(12),
  missions,
  ...extra,
});

/** How many people are on `missionId` at `t`, per the produced schedule. */
const staffedAt = (result, missionId, t) => result.shifts
  .filter((s) => s.missionId === missionId && s.start <= t && s.end > t).length;

const local = (patch) => ({
  id: 'l', name: 'Local', type: 'local', start: null, end: null, count: 2, ...patch,
});

/* ------------------------------------------------------------------ */

test('a mission can be staffed differently by night', () => {
  const result = plan(toPlannerInput(doc([local({ count: 2, nightCount: 4 })])));

  assert.equal(staffedAt(result, 'l', localTime(2026, 0, 5, 8)), 2, '08:00 is day');
  assert.equal(staffedAt(result, 'l', localTime(2026, 0, 5, 16)), 2, '16:00 is day');
  assert.equal(staffedAt(result, 'l', localTime(2026, 0, 5, 23)), 4, '23:00 is night');
  assert.equal(staffedAt(result, 'l', localTime(2026, 0, 6, 2)), 4, 'and so is 02:00, past midnight');
  assert.deepEqual(result.warnings.filter((w) => w.code === 'understaffed'), []);
});

test('the two headcounts can go either way round', () => {
  // The real rota this came from wanted more people by day on one mission and
  // more by night on the other, at the same time.
  const result = plan(toPlannerInput(doc([
    local({ id: 'a', name: 'A', count: 4, nightCount: 6 }),
    local({ id: 'b', name: 'B', count: 6, nightCount: 4 }),
  ])));

  const noon = localTime(2026, 0, 5, 12);
  const midnight = localTime(2026, 0, 6, 0);
  assert.equal(staffedAt(result, 'a', noon), 4);
  assert.equal(staffedAt(result, 'b', noon), 6);
  assert.equal(staffedAt(result, 'a', midnight), 6);
  assert.equal(staffedAt(result, 'b', midnight), 4);
  assert.deepEqual(result.warnings.filter((w) => w.code === 'understaffed'), []);
});

test('no shift straddles the night boundary, even off the shift grid', () => {
  // Night runs 23:00-05:00, which lands nowhere near the 06:00/14:00/22:00
  // grid. A segment spanning the boundary would have to pick one headcount and
  // leave the other side of itself short, so the boundary has to break it.
  const result = plan(toPlannerInput(
    doc([local({ count: 1, nightCount: 3 })], { nightStart: 23 * 60, nightEnd: 5 * 60 }),
  ));

  for (const s of result.shifts) {
    for (const edge of [localTime(2026, 0, 5, 23), localTime(2026, 0, 6, 5)]) {
      assert.ok(!(s.start < edge && s.end > edge), `${s.start}-${s.end} straddles ${edge}`);
    }
  }
  assert.equal(staffedAt(result, 'l', localTime(2026, 0, 5, 22, 30)), 1, '22:30 is still day');
  assert.equal(staffedAt(result, 'l', localTime(2026, 0, 5, 23, 30)), 3, '23:30 is night');
  assert.equal(staffedAt(result, 'l', localTime(2026, 0, 6, 5, 30)), 1, '05:30 is day again');
});

test('a mission with no night count is staffed the same round the clock', () => {
  // What every link written before the field existed decodes to.
  const result = plan(toPlannerInput(doc([local({ count: 3 })])));
  for (const h of [8, 16, 23]) {
    assert.equal(staffedAt(result, 'l', localTime(2026, 0, 5, h)), 3);
  }
});

test('a remote mission ignores the night count, since one set of people holds it', () => {
  const result = plan(toPlannerInput(doc([
    { id: 'r', name: 'Remote', type: 'remote', start: null, end: null, count: 2, nightCount: 5 },
  ])));

  assert.equal(result.shifts.filter((s) => s.missionId === 'r').length, 2);
  assert.equal(staffedAt(result, 'r', localTime(2026, 0, 5, 23)), 2);
});

test('night windows are resolved to instants, and wrap midnight', () => {
  // Opening at midnight, mid-night: the stretch that began at 22:00 the evening
  // *before* the plan still covers its first hours, so it has to be in the list
  // even though it starts before the period does.
  const midnightStart = localTime(2026, 0, 5, 0, 0);
  const windows = nightWindows(planSchema.parse({
    start: midnightStart, end: END, shiftMinutes: 60, nightStart: 22 * 60, nightEnd: 6 * 60,
  }));

  assert.ok(
    windows.some((w) => w.start < midnightStart && w.end > midnightStart),
    'the night already running when the plan opens must be covered',
  );
  for (const w of windows) assert.equal(w.end - w.start, 8 * HOUR, 'a 22:00-06:00 night is eight hours');

  // An empty night is empty, not a day long: equal bounds must not silently
  // apply every night headcount around the clock.
  assert.deepEqual(
    nightWindows(planSchema.parse({
      start: START, end: END, shiftMinutes: 60, nightStart: 60, nightEnd: 60,
    })),
    [],
  );
});

test('a night headcount too big for the roster warns rather than throwing', () => {
  const result = plan(toPlannerInput(planSchema.parse({
    start: START,
    end: END,
    shiftMinutes: 8 * 60,
    employees: ring(3),
    missions: [local({ count: 1, nightCount: 5 })],
  })));

  const short = result.warnings.filter((w) => w.code === 'understaffed');
  assert.ok(short.length > 0, 'the night shift is two people short and should say so');
  assert.equal(short[0].needed, 5, 'and report the headcount actually asked for');
});
