import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, WARN } from '../src/lib/planner.js';

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;

function localTime(y, m, d, h = 0, min = 0) {
  return new Date(y, m, d, h, min, 0, 0).getTime();
}

const people = (n) => Array.from({ length: n }, (_, i) => ({
  id: `e${i + 1}`,
  name: `Emp${String(i + 1).padStart(2, '0')}`,
}));

const START = localTime(2026, 0, 5, 8, 0);

/* ------------------------------------------------------------------ */

test('whole-mission pins staff a remote mission with exactly those people', () => {
  const start = START;
  const end = start + 6 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(8),
    missions: [{ id: 'r', name: 'Remote', type: 'remote', start, end, count: 3 }],
    // No start/end: "these people, for the whole mission".
    pins: [
      { missionId: 'r', employeeId: 'e7' },
      { missionId: 'r', employeeId: 'e8' },
    ],
  });

  const remote = result.shifts.filter((s) => s.missionId === 'r');
  assert.equal(remote.length, 3, 'the engine fills the remaining seat');

  const pinned = remote.filter((s) => s.pinned).map((s) => s.employeeId).sort();
  assert.deepEqual(pinned, ['e7', 'e8']);
  for (const s of remote) {
    assert.equal(s.start, start, 'pinned people cover the whole mission');
    assert.equal(s.end, end);
  }
});

test('a per-shift pin displaces the generated person, who is rescheduled elsewhere', () => {
  const start = START;
  const end = start + 4 * HOUR;
  const input = {
    start,
    end,
    shiftMinutes: 60,
    employees: people(4),
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
  };

  const before = plan(input);
  const firstSlot = before.shifts.find((s) => s.start === start);
  // Pick someone the planner did *not* choose for that slot.
  const other = input.employees.find((e) => e.id !== firstSlot.employeeId);

  const after = plan({
    ...input,
    pins: [{ missionId: 'l', employeeId: other.id, start, end: start + HOUR }],
  });

  const newFirst = after.shifts.find((s) => s.start === start);
  assert.equal(newFirst.employeeId, other.id, 'the pinned person now holds the slot');
  assert.equal(newFirst.pinned, true);

  // The displaced person is not dropped from the plan - they work later instead.
  assert.ok(
    after.shifts.some((s) => s.employeeId === firstSlot.employeeId),
    'the displaced person is rescheduled rather than idled',
  );
});

test('pinned time counts toward the fairness totals', () => {
  const start = START;
  const end = start + 6 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(3),
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
    // Give e1 the first two hours by hand.
    pins: [
      { missionId: 'l', employeeId: 'e1', start, end: start + HOUR },
      { missionId: 'l', employeeId: 'e1', start: start + HOUR, end: start + 2 * HOUR },
    ],
  });

  const totals = new Map(result.stats.perEmployee.map((p) => [p.employeeId, p.minutes]));
  assert.equal(totals.get('e1'), 120, 'e1 keeps exactly the two pinned hours');
  // 6 slots total, e1 took 2 by hand, so the other two split the remaining 4 evenly
  // rather than e1 being handed more on top.
  assert.equal(totals.get('e2'), 120);
  assert.equal(totals.get('e3'), 120);
});

test('a person pinned to two overlapping missions keeps the first and warns', () => {
  const start = START;
  const end = start + 2 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(4),
    missions: [
      { id: 'a', name: 'A', type: 'local', start, end, count: 1 },
      { id: 'b', name: 'B', type: 'local', start, end, count: 1 },
    ],
    pins: [
      { missionId: 'a', employeeId: 'e1' },
      { missionId: 'b', employeeId: 'e1' },
    ],
  });

  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_CONFLICT && w.employeeId === 'e1'));
  const e1 = result.shifts.filter((s) => s.employeeId === 'e1');
  assert.ok(e1.every((s) => s.missionId === 'a'), 'only the first pin was honoured');
  // Mission B is still staffed, just by somebody else.
  assert.ok(result.shifts.some((s) => s.missionId === 'b'));
});

test('pins beyond the headcount are dropped with a warning', () => {
  const start = START;
  const end = start + 2 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(4),
    missions: [{ id: 'r', name: 'Remote', type: 'remote', start, end, count: 1 }],
    pins: [
      { missionId: 'r', employeeId: 'e1' },
      { missionId: 'r', employeeId: 'e2' },
    ],
  });

  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_OVERFLOW && w.employeeId === 'e2'));
  const remote = result.shifts.filter((s) => s.missionId === 'r');
  assert.equal(remote.length, 1);
  assert.equal(remote[0].employeeId, 'e1');
});

test('a pin outside the person\'s availability is dropped with a warning', () => {
  const start = START;
  const end = start + 4 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'Late', start: start + 2 * HOUR },
      { id: 'e2', name: 'Full' },
    ],
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
    pins: [{ missionId: 'l', employeeId: 'e1', start, end: start + HOUR }],
  });

  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_UNAVAILABLE && w.employeeId === 'e1'));
  const firstSlot = result.shifts.find((s) => s.start === start);
  assert.equal(firstSlot.employeeId, 'e2', 'the slot is covered by whoever is actually available');
});

test('pins naming a deleted employee or mission are ignored silently', () => {
  const start = START;
  const end = start + 2 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(2),
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
    pins: [
      { missionId: 'gone', employeeId: 'e1' },
      { missionId: 'l', employeeId: 'ghost' },
    ],
  });

  // Stale references are a normal consequence of editing a shared link; they
  // must not produce noise, only be dropped.
  const pinWarnings = result.warnings.filter((w) => String(w.code).startsWith('pin-'));
  assert.equal(pinWarnings.length, 0);
  assert.ok(result.shifts.length > 0);
});

test('planning is idempotent: the same document yields the same schedule', () => {
  const start = START;
  const end = start + 8 * HOUR;
  const input = {
    start,
    end,
    shiftMinutes: 30,
    employees: people(7),
    missions: [
      { id: 'r', name: 'Remote', type: 'remote', start, end: start + 4 * HOUR, count: 2 },
      { id: 'l', name: 'Gate', type: 'local', start, end, count: 2 },
    ],
    pins: [
      { missionId: 'r', employeeId: 'e5' },
      { missionId: 'l', employeeId: 'e1', start: start + 2 * HOUR, end: start + 150 * MIN },
    ],
  };

  const a = plan(input);
  const b = plan(input);
  assert.equal(JSON.stringify(a.shifts), JSON.stringify(b.shifts));
  assert.equal(JSON.stringify(a.timeline), JSON.stringify(b.timeline));
  assert.equal(JSON.stringify(a.warnings), JSON.stringify(b.warnings));
});

test('re-pinning the person the planner already chose changes nothing but the flag', () => {
  const start = START;
  const end = start + 3 * HOUR;
  const input = {
    start,
    end,
    shiftMinutes: 60,
    employees: people(3),
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
  };

  const before = plan(input);
  const first = before.shifts.find((s) => s.start === start);
  const after = plan({
    ...input,
    pins: [{ missionId: 'l', employeeId: first.employeeId, start, end: start + HOUR }],
  });

  const pinnedFirst = after.shifts.find((s) => s.start === start);
  assert.equal(pinnedFirst.employeeId, first.employeeId);
  assert.equal(pinnedFirst.pinned, true);
  assert.equal(after.shifts.length, before.shifts.length);
});
