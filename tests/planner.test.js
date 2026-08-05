import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, WARN } from '../src/lib/planner.js';

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;

/** Local wall-clock time - shifts are reasoned about in the viewer's timezone. */
function localTime(y, m, d, h = 0, min = 0) {
  return new Date(y, m, d, h, min, 0, 0).getTime();
}

const people = (n) => Array.from({ length: n }, (_, i) => ({
  id: `e${i + 1}`,
  name: `Emp${String(i + 1).padStart(2, '0')}`,
}));

const START = localTime(2026, 0, 5, 8, 0);

/* ------------------------------------------------------------------ */

test("the worked example: 4 on a remote mission, 6 rotating through a local one", () => {
  const start = START;
  const end = start + 12 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(10),
    missions: [
      { id: 'r', name: 'Remote', type: 'remote', start, end, count: 4 },
      { id: 'l', name: 'Local', type: 'local', start, end, count: 2 },
    ],
  });

  const remote = result.shifts.filter((s) => s.missionId === 'r');
  assert.equal(remote.length, 4, 'one row per person, spanning the whole mission');
  for (const s of remote) {
    assert.equal(s.start, start);
    assert.equal(s.end, end);
  }

  // The remote four are locked out of everything else.
  const remoteIds = new Set(remote.map((s) => s.employeeId));
  const localShifts = result.shifts.filter((s) => s.missionId === 'l');
  for (const s of localShifts) {
    assert.ok(!remoteIds.has(s.employeeId), `${s.employeeName} is on the remote mission`);
  }

  // The other six rotate, and share the load evenly: 12h x 2 seats / 6 people = 4h each.
  const localIds = new Set(localShifts.map((s) => s.employeeId));
  assert.equal(localIds.size, 6);
  const minutes = new Map();
  for (const s of localShifts) {
    minutes.set(s.employeeId, (minutes.get(s.employeeId) ?? 0) + (s.end - s.start) / MIN);
  }
  for (const [id, m] of minutes) {
    assert.equal(m, 240, `${id} worked ${m} minutes, expected 240`);
  }
});

test('local rotation spreads load within one shift length', () => {
  const start = START;
  const end = start + 8 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(5),
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 2 }],
  });

  const totals = result.stats.perEmployee.map((p) => p.minutes);
  assert.ok(Math.max(...totals) - Math.min(...totals) <= 60, `spread was ${result.stats.spreadMinutes}`);
  assert.equal(result.stats.spreadMinutes, Math.max(...totals) - Math.min(...totals));
});

test('gap maximization: nobody repeats until everyone has had a turn', () => {
  const start = START;
  const end = start + 6 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(6),
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 2 }],
  });

  // 6 people, 2 seats -> each slot uses 2, so a full cycle is 3 slots.
  const bySlot = new Map();
  for (const s of result.shifts) {
    if (!bySlot.has(s.start)) bySlot.set(s.start, []);
    bySlot.get(s.start).push(s.employeeId);
  }
  const slots = [...bySlot.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids);
  const firstCycle = new Set([...slots[0], ...slots[1], ...slots[2]]);
  assert.equal(firstCycle.size, 6, 'all six people appear before anyone repeats');

  for (const p of result.stats.perEmployee) {
    assert.ok(p.minGapMinutes == null || p.minGapMinutes >= 120, `min gap was ${p.minGapMinutes}`);
  }
});

test('nobody is ever double-booked across concurrent missions', () => {
  const start = START;
  const end = start + 4 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(6),
    missions: [
      { id: 'a', name: 'A', type: 'local', start, end, count: 2 },
      { id: 'b', name: 'B', type: 'local', start, end, count: 2 },
    ],
  });

  for (const a of result.shifts) {
    for (const b of result.shifts) {
      if (a === b) continue;
      if (a.employeeId !== b.employeeId) continue;
      assert.ok(!(a.start < b.end && b.start < a.end), `${a.employeeName} double-booked`);
    }
  }
});

test('availability windows exclude people from missions they only partly cover', () => {
  const start = START;
  const end = start + 4 * HOUR;
  const employees = [
    { id: 'e1', name: 'Full' },
    { id: 'e2', name: 'Late', start: start + 2 * HOUR },
  ];
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees,
    missions: [{ id: 'r', name: 'Remote', type: 'remote', start, end, count: 1 }],
  });

  const remote = result.shifts.filter((s) => s.missionId === 'r');
  assert.equal(remote.length, 1);
  assert.equal(remote[0].employeeId, 'e1', 'the partly-available person cannot hold a remote mission');
});

test('a mission that starts mid-slot is clamped, not rounded', () => {
  const start = START;
  const end = start + 3 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(4),
    // starts 30 minutes into the grid and ends 30 minutes into a later slot
    missions: [{
      id: 'l', name: 'Odd', type: 'local', start: start + 30 * MIN, end: start + 150 * MIN, count: 1,
    }],
  });

  const shifts = result.shifts.filter((s) => s.missionId === 'l').sort((a, b) => a.start - b.start);
  assert.equal(shifts[0].start, start + 30 * MIN, 'first segment begins exactly at the mission start');
  assert.equal(shifts.at(-1).end, start + 150 * MIN, 'last segment ends exactly at the mission end');

  // Coverage is continuous and never exceeds the headcount of 1.
  let cursor = start + 30 * MIN;
  for (const s of shifts) {
    assert.equal(s.start, cursor, 'no gap between segments');
    cursor = s.end;
  }
  assert.equal(cursor, start + 150 * MIN);
});

test("one mission's off-grid edge does not fragment an unrelated mission's shifts", () => {
  const start = START;
  const end = start + 2 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(6),
    missions: [
      // Ends 30 minutes into the second hour - an edge that belongs only to it.
      { id: 'r', name: 'Bridge', type: 'remote', start, end: start + 90 * MIN, count: 1 },
      { id: 'l', name: 'Local', type: 'local', start, end, count: 1 },
    ],
  });

  const local = result.shifts.filter((s) => s.missionId === 'l').sort((a, b) => a.start - b.start);
  assert.equal(local.length, 2, 'the clean two-hour grid is not fragmented by the other mission');
  assert.deepEqual(local.map((s) => s.start), [start, start + HOUR]);
  assert.deepEqual(local.map((s) => s.end), [start + HOUR, end]);
});

test('understaffing warns and returns a partial plan instead of throwing', () => {
  const start = START;
  const end = start + 2 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(2),
    missions: [{ id: 'l', name: 'Busy', type: 'local', start, end, count: 5 }],
  });

  const short = result.warnings.filter((w) => w.code === WARN.UNDERSTAFFED);
  assert.ok(short.length > 0, 'expected an understaffed warning');
  assert.equal(short[0].missionId, 'l');
  assert.ok(result.shifts.length > 0, 'still returns the shifts it could fill');
  assert.ok(short.every((w) => w.got < w.needed));
});

test('overlapping remote missions with a scarce pool resolve deterministically', () => {
  const start = START;
  const end = start + 4 * HOUR;
  const input = {
    start,
    end,
    shiftMinutes: 60,
    employees: people(3),
    missions: [
      { id: 'r1', name: 'R1', type: 'remote', start, end: start + 3 * HOUR, count: 2 },
      { id: 'r2', name: 'R2', type: 'remote', start, end: start + 2 * HOUR, count: 2 },
    ],
  };
  const a = plan(input);
  const b = plan(input);
  assert.deepEqual(a.shifts, b.shifts);

  // Three people cannot fill four concurrent remote seats.
  assert.ok(a.warnings.some((w) => w.code === WARN.UNDERSTAFFED));
  // Whoever was placed still holds their mission end to end.
  for (const s of a.shifts) {
    const m = input.missions.find((x) => x.id === s.missionId);
    assert.equal(s.start, m.start);
    assert.equal(s.end, m.end);
  }
});

test('the timeline partitions every employee at every moment', () => {
  const start = START;
  const end = start + 4 * HOUR;
  const employees = [
    ...people(4),
    { id: 'e5', name: 'Partial', start, end: start + 2 * HOUR },
  ];
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees,
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 2 }],
  });

  assert.ok(result.timeline.length > 0);
  for (const seg of result.timeline) {
    const seen = [
      ...seg.onDuty.map((o) => o.employeeId),
      ...seg.offDuty,
      ...seg.unavailable,
    ];
    assert.equal(new Set(seen).size, seen.length, 'no employee appears in two buckets');
    assert.equal(seen.length, employees.length, 'every employee is accounted for');
    assert.ok(seg.end > seg.start);
  }

  // Segments tile the whole plan window with no gaps or overlaps.
  assert.equal(result.timeline[0].start, start);
  assert.equal(result.timeline.at(-1).end, end);
  for (let i = 1; i < result.timeline.length; i++) {
    assert.equal(result.timeline[i].start, result.timeline[i - 1].end);
  }
});

test('an unused employee is reported', () => {
  const start = START;
  const end = start + HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(3),
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
  });
  const unused = result.warnings.filter((w) => w.code === WARN.EMPLOYEE_UNUSED);
  assert.equal(unused.length, 2);
});

test('validation errors', () => {
  const base = {
    start: START,
    end: START + HOUR,
    shiftMinutes: 60,
    employees: people(2),
    missions: [{ id: 'l', name: 'Gate', type: 'local', count: 1 }],
  };

  assert.throws(() => plan({ ...base, end: base.start }), /end after it starts/);
  assert.throws(() => plan({ ...base, start: NaN }), /numeric timestamps/);
  assert.throws(() => plan({ ...base, shiftMinutes: 0 }), /Shift length must be positive/);
  assert.throws(() => plan({ ...base, employees: [] }), /At least one employee/);
  assert.throws(
    () => plan({ ...base, employees: [{ id: 'a', name: 'X' }, { id: 'b', name: 'X' }] }),
    /names must be unique/,
  );
  assert.throws(
    () => plan({ ...base, employees: [{ id: 'a', name: 'X' }, { id: 'a', name: 'Y' }] }),
    /ids must be unique/,
  );
  assert.throws(
    () => plan({ ...base, missions: [{ id: 'l', name: 'Gate', type: 'local', count: 0 }] }),
    /at least one person/,
  );
  assert.throws(
    () => plan({
      ...base,
      missions: [{
        id: 'l', name: 'Gate', type: 'local', start: base.end, end: base.start, count: 1,
      }],
    }),
    /must end after it starts/,
  );
});
