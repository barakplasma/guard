import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyClearPin, applyMissionAssignees, applySwap, freezePastShifts, pinCovers,
} from '../src/lib/pins.js';
import { plan } from '../src/lib/planner.js';
import { toPlannerInput } from '../src/lib/planSchema.js';

const HOUR = 3600 * 1000;
const START = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();

const doc = (over = {}) => ({
  version: 1,
  title: '',
  start: START,
  end: START + 4 * HOUR,
  shiftMinutes: 60,
  employees: [
    { id: 'e1', name: 'A', start: null, end: null },
    { id: 'e2', name: 'B', start: null, end: null },
    { id: 'e3', name: 'C', start: null, end: null },
  ],
  missions: [
    { id: 'm1', name: 'Remote', type: 'remote', start: null, end: null, count: 1 },
  ],
  pins: [],
  ...over,
});

/* --- coverage -------------------------------------------------------- */

test('a null-range pin inherits the mission window, which inherits the plan', () => {
  const d = doc();
  const wholeMission = { missionId: 'm1', employeeId: 'e1', start: null, end: null };
  assert.equal(pinCovers(d, wholeMission, START, START + HOUR), true);
  assert.equal(pinCovers(d, wholeMission, START, START + 4 * HOUR), true);

  const oneHour = { missionId: 'm1', employeeId: 'e1', start: START, end: START + HOUR };
  assert.equal(pinCovers(d, oneHour, START, START + HOUR), true);
  assert.equal(pinCovers(d, oneHour, START, START + 2 * HOUR), false);
});

/* --- swapping -------------------------------------------------------- */

test('swapping removes the whole-mission pin of the person being replaced', () => {
  // e1 assigned from the Missions page, then swapped out for e2 on the row.
  const d = applyMissionAssignees(doc(), 'm1', ['e1']);
  assert.equal(d.pins.length, 1);

  const after = applySwap(d, {
    missionId: 'm1',
    employeeId: 'e2',
    start: START,
    end: START + 4 * HOUR,
    replacingEmployeeId: 'e1',
  });

  assert.equal(after.pins.length, 1, 'the old assignment is gone, not stacked');
  assert.equal(after.pins[0].employeeId, 'e2');

  // And it actually takes effect in the schedule.
  const result = plan(toPlannerInput(after));
  const own = result.shifts.filter((s) => s.missionId === 'm1');
  assert.equal(own.length, 1);
  assert.equal(own[0].employeeId, 'e2', 'the swap replaced the assignee');
  assert.equal(result.warnings.length === 0 || !result.warnings.some((w) => w.code === 'pin-overflow'), true);
});

test('swapping twice on the same row leaves a single pin', () => {
  let d = doc();
  d = applySwap(d, {
    missionId: 'm1', employeeId: 'e2', start: START, end: START + HOUR, replacingEmployeeId: 'e1',
  });
  d = applySwap(d, {
    missionId: 'm1', employeeId: 'e3', start: START, end: START + HOUR, replacingEmployeeId: 'e2',
  });
  assert.equal(d.pins.length, 1);
  assert.equal(d.pins[0].employeeId, 'e3');
});

test('swapping one seat of a multi-person mission leaves the other seat pinned', () => {
  const base = doc({
    missions: [{ id: 'm1', name: 'Remote', type: 'remote', start: null, end: null, count: 2 }],
  });
  const d = applyMissionAssignees(base, 'm1', ['e1', 'e2']);
  assert.equal(d.pins.length, 2);

  const after = applySwap(d, {
    missionId: 'm1',
    employeeId: 'e3',
    start: START,
    end: START + 4 * HOUR,
    replacingEmployeeId: 'e1',
  });

  const ids = after.pins.map((p) => p.employeeId).sort();
  assert.deepEqual(ids, ['e2', 'e3'], "only the replaced person's pin was removed");
});

test('swapping one seat of a multi-person mission leaves the other seat\'s per-shift pin alone', () => {
  // Both seats of the same slot pinned individually (not via the whole-mission
  // picker), so both pins share the exact same (missionId, start, end).
  const base = doc({
    missions: [{ id: 'm1', name: 'Gate', type: 'local', start: null, end: null, count: 2 }],
    pins: [
      { missionId: 'm1', employeeId: 'e1', start: START, end: START + HOUR },
      { missionId: 'm1', employeeId: 'e2', start: START, end: START + HOUR },
    ],
  });

  const after = applySwap(base, {
    missionId: 'm1',
    employeeId: 'e3',
    start: START,
    end: START + HOUR,
    replacingEmployeeId: 'e2',
  });

  const ids = after.pins.map((p) => p.employeeId).sort();
  assert.deepEqual(ids, ['e1', 'e3'], "e1's pin on the same slot must survive");
});

test('swapping does not disturb pins on other missions', () => {
  const base = doc({
    missions: [
      { id: 'm1', name: 'Remote', type: 'remote', start: null, end: null, count: 1 },
      { id: 'm2', name: 'Gate', type: 'local', start: null, end: null, count: 1 },
    ],
  });
  let d = applyMissionAssignees(base, 'm1', ['e1']);
  d = applyMissionAssignees(d, 'm2', ['e2']);

  const after = applySwap(d, {
    missionId: 'm1', employeeId: 'e3', start: START, end: START + 4 * HOUR, replacingEmployeeId: 'e1',
  });

  const m2 = after.pins.filter((p) => p.missionId === 'm2');
  assert.equal(m2.length, 1);
  assert.equal(m2[0].employeeId, 'e2');
});

test('swapping without a named predecessor still replaces the row pin', () => {
  let d = applySwap(doc(), {
    missionId: 'm1', employeeId: 'e2', start: START, end: START + HOUR,
  });
  d = applySwap(d, {
    missionId: 'm1', employeeId: 'e3', start: START, end: START + HOUR,
  });
  assert.equal(d.pins.length, 1);
  assert.equal(d.pins[0].employeeId, 'e3');
});

/* --- clearing -------------------------------------------------------- */

test('clearing a pin works on a whole-mission assignment, not just an exact range', () => {
  const d = applyMissionAssignees(doc(), 'm1', ['e1']);
  const after = applyClearPin(d, {
    missionId: 'm1', employeeId: 'e1', start: START, end: START + 4 * HOUR,
  });
  assert.equal(after.pins.length, 0);
});

test('clearing only removes the named person', () => {
  const base = doc({
    missions: [{ id: 'm1', name: 'Remote', type: 'remote', start: null, end: null, count: 2 }],
  });
  const d = applyMissionAssignees(base, 'm1', ['e1', 'e2']);
  const after = applyClearPin(d, {
    missionId: 'm1', employeeId: 'e1', start: START, end: START + 4 * HOUR,
  });
  assert.equal(after.pins.length, 1);
  assert.equal(after.pins[0].employeeId, 'e2');
});

/* --- mission roster -------------------------------------------------- */

/* --- freezing the past ------------------------------------------------ */

test('freezePastShifts pins every elapsed, auto-assigned shift and leaves the future alone', () => {
  const d = doc({
    end: START + 4 * HOUR,
    missions: [{ id: 'm1', name: 'Gate', type: 'local', start: null, end: null, count: 1 }],
  });
  const result = plan(toPlannerInput(d));
  const now = START + 2 * HOUR; // the first two hourly shifts have already happened

  const frozen = freezePastShifts(d, result, now);
  assert.equal(frozen.pins.length, 2, 'only the two elapsed shifts are pinned');
  for (const pin of frozen.pins) assert.ok(pin.end <= now, 'a pinned shift must actually be in the past');

  // The frozen pins reproduce exactly what the engine already decided.
  const past = result.shifts.filter((s) => s.end <= now);
  const pinnedIds = frozen.pins.map((p) => `${p.employeeId}@${p.start}`).sort();
  const pastIds = past.map((s) => `${s.employeeId}@${s.start}`).sort();
  assert.deepEqual(pinnedIds, pastIds);
});

test('freezePastShifts returns the same document when nothing has elapsed', () => {
  const d = doc({
    missions: [{ id: 'm1', name: 'Gate', type: 'local', start: null, end: null, count: 1 }],
  });
  const result = plan(toPlannerInput(d));
  const frozen = freezePastShifts(d, result, START - HOUR);
  assert.equal(frozen, d, 'no elapsed shifts means no document change at all');
});

test('freezePastShifts does not re-pin a shift that is already pinned', () => {
  const d = doc({
    missions: [{ id: 'm1', name: 'Gate', type: 'local', start: null, end: null, count: 1 }],
    pins: [{ missionId: 'm1', employeeId: 'e2', start: START, end: START + HOUR }],
  });
  const result = plan(toPlannerInput(d));
  const frozen = freezePastShifts(d, result, START + HOUR);
  assert.equal(frozen.pins.length, 1, 'the already-pinned shift is not duplicated');
});

test('a frozen shift survives an unrelated later edit to the document', () => {
  const d = doc({
    end: START + 2 * HOUR,
    missions: [{ id: 'm1', name: 'Gate', type: 'local', start: null, end: null, count: 1 }],
  });
  const before = plan(toPlannerInput(d));
  const firstHour = before.shifts.find((s) => s.start === START);

  const frozen = freezePastShifts(d, before, START + HOUR);

  // Adding a new employee reshuffles the balancer's choices for a local
  // mission - this is exactly the kind of edit that would otherwise rewrite
  // who already worked the first hour.
  const edited = {
    ...frozen,
    employees: [...frozen.employees, { id: 'e4', name: 'D', start: null, end: null }],
  };
  const after = plan(toPlannerInput(edited));
  const stillFirstHour = after.shifts.find((s) => s.start === START);

  assert.equal(stillFirstHour.employeeId, firstHour.employeeId, 'the past shift did not change hands');
  assert.equal(stillFirstHour.pinned, true);
});

test('setting a mission roster replaces whole-window pins but keeps per-shift ones', () => {
  const d = doc({
    pins: [
      { missionId: 'm1', employeeId: 'e1', start: null, end: null },
      { missionId: 'm1', employeeId: 'e2', start: START, end: START + HOUR },
    ],
  });
  const after = applyMissionAssignees(d, 'm1', ['e3']);
  assert.deepEqual(
    after.pins.map((p) => `${p.employeeId}:${p.start == null ? 'whole' : 'range'}`).sort(),
    ['e2:range', 'e3:whole'],
  );
});
