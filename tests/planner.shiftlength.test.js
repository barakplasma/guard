import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/lib/planner.js';
import { planSchema, toPlannerInput } from '../src/lib/planSchema.js';

const HOUR = 3600 * 1000;
const MINUTE = 60 * 1000;

function localTime(y, m, d, h = 0, min = 0) {
  return new Date(y, m, d, h, min, 0, 0).getTime();
}

const ring = (n) => Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, name: `Emp${i + 1}` }));

const doc = (missions, extra) => planSchema.parse({
  start: localTime(2026, 8, 10, 16, 0),
  end: localTime(2026, 8, 11, 16, 0),
  shiftMinutes: 60,
  strategy: 'rotation',
  employees: ring(12),
  missions,
  ...extra,
});

/** One mission's slots, as "HH:MM-HH:MM" pairs in clock order, de-duplicated. */
function slots(result, missionId) {
  const seen = new Set();
  return result.shifts
    .filter((s) => s.missionId === missionId)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((s) => `${clock(s.start)}-${clock(s.end)}`)
    .filter((label) => (seen.has(label) ? false : seen.add(label)));
}

function clock(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const staffedAt = (result, missionId, t) => result.shifts
  .filter((s) => s.missionId === missionId && s.start <= t && s.end > t).length;

const ops = (patch) => ({
  id: 'h', name: 'חמ"ל', type: 'local', start: null, end: null, count: 1, ...patch,
});

/* ------------------------------------------------------------------ */

test('two-hour shifts by day and one-hour shifts at night', () => {
  // The request this feature exists for. The plan opens at 16:00, night runs
  // 22:00-06:00, and חמ"ל rotates on 120 by day and 60 by night: 16-18, 18-20,
  // 20-22, then hourly through the night, then two-hourly again from 06:00.
  const result = plan(toPlannerInput(doc([ops({ shiftMinutes: 120, nightShiftMinutes: 60 })])));

  assert.deepEqual(slots(result, 'h').slice(0, 16), [
    '16:00-18:00', '18:00-20:00', '20:00-22:00',
    '22:00-23:00', '23:00-00:00', '00:00-01:00', '01:00-02:00', '02:00-03:00',
    '03:00-04:00', '04:00-05:00', '05:00-06:00',
    '06:00-08:00', '08:00-10:00', '10:00-12:00', '12:00-14:00', '14:00-16:00',
  ]);

  // And the seat is filled at every instant of the period, not just tidily cut.
  for (let t = localTime(2026, 8, 10, 16, 0); t < localTime(2026, 8, 11, 16, 0); t += 15 * MINUTE) {
    assert.equal(staffedAt(result, 'h', t), 1, `nobody on חמ"ל at ${clock(t)}`);
  }
});

test('a mission with its own length rotates on it while its neighbours do not', () => {
  const result = plan(toPlannerInput(doc([
    ops({ shiftMinutes: 120, nightShiftMinutes: 60 }),
    { id: 'g', name: 'ש"ג', type: 'local', start: null, end: null, count: 1 },
  ])));

  assert.deepEqual(slots(result, 'h').slice(0, 3), ['16:00-18:00', '18:00-20:00', '20:00-22:00']);
  assert.deepEqual(slots(result, 'g').slice(0, 3), ['16:00-17:00', '17:00-18:00', '18:00-19:00']);
});

test('a day length on its own applies through the night too', () => {
  // `nightShiftMinutes: null` means "same as by day", so nothing changes at
  // 22:00 - the grid runs straight through, anchored once at the plan's start.
  const result = plan(toPlannerInput(doc([ops({ shiftMinutes: 120 })])));

  for (const s of result.shifts) {
    assert.equal(s.end - s.start, 2 * HOUR, `${clock(s.start)}-${clock(s.end)} is not two hours`);
  }
  assert.ok(slots(result, 'h').includes('22:00-00:00'), 'the grid crosses nightfall unbroken');
});

test('a night that is not a whole number of slots leaves one partial slot at daybreak', () => {
  // Night 22:00-06:30 with hourly night slots: eight whole hours and a
  // half-hour tail. Nothing may straddle 06:30, where the two-hour day grid
  // starts afresh.
  const result = plan(toPlannerInput(doc(
    [ops({ shiftMinutes: 120, nightShiftMinutes: 60 })],
    { nightStart: 22 * 60, nightEnd: 6 * 60 + 30 },
  )));

  const labels = slots(result, 'h');
  assert.ok(labels.includes('06:00-06:30'), `no partial slot at daybreak: ${labels.join(' ')}`);
  assert.ok(labels.includes('06:30-08:30'), 'and the day grid restarts at the boundary');

  const daybreak = localTime(2026, 8, 11, 6, 30);
  for (const s of result.shifts) {
    assert.ok(!(s.start < daybreak && s.end > daybreak), `${clock(s.start)}-${clock(s.end)} straddles 06:30`);
  }
});

test('a plan opening mid-stretch anchors the first slot on its own start', () => {
  // 17:00 is five hours into the day stretch, and the grid has to start
  // somewhere: it starts here, and the stretch's last slot is the short one.
  const result = plan(toPlannerInput(planSchema.parse({
    start: localTime(2026, 8, 10, 17, 0),
    end: localTime(2026, 8, 11, 8, 0),
    shiftMinutes: 60,
    strategy: 'rotation',
    employees: ring(8),
    missions: [ops({ shiftMinutes: 120, nightShiftMinutes: 60 })],
  })));

  assert.deepEqual(slots(result, 'h').slice(0, 5), [
    '17:00-19:00', '19:00-21:00', '21:00-22:00', '22:00-23:00', '23:00-00:00',
  ]);
});

test('a night longer than the night itself is one slot ending at daybreak', () => {
  // The schema caps a shift at a day, not at the night's own length. Ten hours
  // of night slot inside an eight-hour night is simply one partial slot, which
  // is a sane reading and not worth a validation error while someone types.
  const result = plan(toPlannerInput(doc([ops({ shiftMinutes: 120, nightShiftMinutes: 600 })])));
  assert.ok(slots(result, 'h').includes('22:00-06:00'));
});

test('a remote mission ignores both lengths, as it ignores the night headcount', () => {
  const result = plan(toPlannerInput(doc([{
    id: 'r',
    name: 'Remote',
    type: 'remote',
    start: null,
    end: null,
    count: 2,
    shiftMinutes: 120,
    nightShiftMinutes: 30,
  }])));

  const own = result.shifts.filter((s) => s.missionId === 'r');
  assert.equal(own.length, 2, 'two people, one row each, end to end');
  for (const s of own) assert.equal(s.end - s.start, 24 * HOUR);
});

test('every row lands inside one slot of its own mission', () => {
  // The property the whole refactor turns on, checked directly: `slotStart`
  // and `slotEnd` are on the row, and the row never outruns them.
  const result = plan(toPlannerInput(doc([
    ops({ shiftMinutes: 120, nightShiftMinutes: 60 }),
    { id: 'g', name: 'ש"ג', type: 'local', start: null, end: null, count: 2 },
  ], {
    employees: [
      ...ring(6),
      { id: 'x', name: 'Late', start: localTime(2026, 8, 10, 19, 30), end: null },
    ],
  })));

  for (const s of result.shifts) {
    assert.ok(s.slotStart <= s.start && s.slotEnd >= s.end, `${clock(s.start)}-${clock(s.end)} outruns its slot`);
  }
});

test('setting a mission to the plan default changes nothing', () => {
  // The equal-length branch has to land on exactly the house grid, or a
  // mission spelling out the default it already had would silently reshuffle.
  const missions = [{ id: 'g', name: 'ש"ג', type: 'local', start: null, end: null, count: 2 }];
  const inherited = plan(toPlannerInput(doc(missions)));
  const spelled = plan(toPlannerInput(doc([{ ...missions[0], shiftMinutes: 60 }])));
  assert.equal(JSON.stringify(inherited), JSON.stringify(spelled));
});

test('a zero-length shift is a bug in the input, not a planner finding', () => {
  assert.throws(
    () => plan({
      start: 0,
      end: 4 * HOUR,
      shiftMinutes: 60,
      employees: ring(2),
      missions: [{
        id: 'l', name: 'Local', type: 'local', start: 0, end: 4 * HOUR, count: 1, shiftMinutes: 0,
      }],
    }),
    /positive shift length/,
  );
});
