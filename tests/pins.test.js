import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyClearPin, applyClearPinsForMission, applyMissionAssignees, applySwap,
  clearStalePins, countStalePins, freezeElapsedBeforeEdit, freezePastShifts, pinCovers,
  pruneStalePins,
} from '../src/lib/pins.js';
import { WARN } from '../src/lib/planner.js';
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

test('clearing by mission+employee removes every pin regardless of range', () => {
  const d = doc({
    missions: [{ id: 'm1', name: 'Gate', type: 'local', start: null, end: null, count: 2 }],
    pins: [
      { missionId: 'm1', employeeId: 'e1', start: START, end: START + HOUR },
      { missionId: 'm1', employeeId: 'e1', start: START + HOUR, end: START + 2 * HOUR },
      { missionId: 'm1', employeeId: 'e2', start: START, end: START + HOUR },
    ],
  });
  const after = applyClearPinsForMission(d, { missionId: 'm1', employeeId: 'e1' });
  assert.equal(after.pins.length, 1);
  assert.equal(after.pins[0].employeeId, 'e2');
});

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
  for (const pin of frozen.pins) {
    assert.ok(pin.end <= now, 'a pinned shift must actually be in the past');
    assert.equal(pin.frozen, true, 'freeze-created pins are marked frozen, unlike a manual pin');
  }

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

/* --- freezing centrally, before every edit ---------------------------- */

test('freezeElapsedBeforeEdit locks in the past even on an edit that never went through the schedule screen', () => {
  // The regression this guards against: freezing only while SchedulePage is
  // mounted misses edits made from Employees/Missions, so by the time the
  // schedule is viewed again the past has already been reshuffled. Basing the
  // freeze on `prev` - the document as it stood right before this edit -
  // means it doesn't matter which page made the edit.
  const prev = doc({
    end: START + 2 * HOUR,
    missions: [{ id: 'm1', name: 'Gate', type: 'local', start: null, end: null, count: 1 }],
  });
  const before = plan(toPlannerInput(prev));
  const firstHour = before.shifts.find((s) => s.start === START);

  // An edit elsewhere in the document - e.g. adding an employee from the
  // Employees page - made after the first hour has already elapsed.
  const next = {
    ...prev,
    employees: [...prev.employees, { id: 'e4', name: 'D', start: null, end: null }],
  };
  const merged = freezeElapsedBeforeEdit(prev, next, START + HOUR);

  const after = plan(toPlannerInput(merged));
  const stillFirstHour = after.shifts.find((s) => s.start === START);
  assert.equal(stillFirstHour.employeeId, firstHour.employeeId, 'the past shift did not change hands');
  assert.equal(stillFirstHour.pinned, true);
});

test('freezeElapsedBeforeEdit lets an intentional clear of a frozen shift stick', () => {
  const prev = doc({
    end: START + 2 * HOUR,
    missions: [{ id: 'm1', name: 'Gate', type: 'local', start: null, end: null, count: 1 }],
  });
  const before = plan(toPlannerInput(prev));
  const firstHour = before.shifts.find((s) => s.start === START);

  // An earlier edit already froze the elapsed shift.
  const frozen = freezeElapsedBeforeEdit(prev, prev, START + HOUR);
  assert.equal(frozen.pins.length, 1, 'the elapsed shift got pinned');

  // The user clears that pin on purpose, then this clear is applied the same
  // way any other edit is - through freezeElapsedBeforeEdit.
  const cleared = applyClearPin(frozen, {
    missionId: 'm1', employeeId: firstHour.employeeId, start: firstHour.start, end: firstHour.end,
  });
  assert.equal(cleared.pins.length, 0);

  const result = freezeElapsedBeforeEdit(frozen, cleared, START + HOUR);
  assert.equal(result.pins.length, 0, 'the clear must survive, not be undone by the next freeze pass');
});

test('freezeElapsedBeforeEdit lets clearAllPins wipe frozen shifts too', () => {
  const prev = doc({
    end: START + 2 * HOUR,
    missions: [{ id: 'm1', name: 'Gate', type: 'local', start: null, end: null, count: 1 }],
  });
  const frozen = freezeElapsedBeforeEdit(prev, prev, START + HOUR);
  assert.ok(frozen.pins.length > 0, 'sanity check: something was actually frozen');

  const clearedAll = { ...frozen, pins: [] };
  const result = freezeElapsedBeforeEdit(frozen, clearedAll, START + HOUR);
  assert.equal(result.pins.length, 0, 'clearAllPins is not fought by the freeze step');
});

test('freezeElapsedBeforeEdit is a no-op before anything has elapsed', () => {
  const prev = doc({
    missions: [{ id: 'm1', name: 'Gate', type: 'local', start: null, end: null, count: 1 }],
  });
  const next = { ...prev, title: 'renamed' };
  const result = freezeElapsedBeforeEdit(prev, next, START - HOUR);
  assert.equal(result, next, 'nothing elapsed yet, so next is returned unchanged');
});

test('freezeElapsedBeforeEdit skips freezing when the previous document has no employees or missions yet', () => {
  const prev = doc({ employees: [], missions: [] });
  const next = { ...prev, title: 'x' };
  assert.equal(freezeElapsedBeforeEdit(prev, next, START + HOUR), next);
});

/* --- mission roster -------------------------------------------------- */

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

/* ---------------- assignments left outside the plan period ---------------- */

const stale = (over = {}) => doc({
  // A local mission: on a remote one a pin means the whole mission whatever
  // its written range says, so it can never be stranded outside the period.
  missions: [{ id: 'm1', name: 'Gate', type: 'local', start: null, end: null, count: 1 }],
  pins: [
    // Residue from a period the plan has since rolled past.
    { missionId: 'm1', employeeId: 'e1', start: START - 5 * HOUR, end: START - 4 * HOUR, frozen: true },
    { missionId: 'm1', employeeId: 'e2', start: START - 3 * HOUR, end: START - 2 * HOUR, frozen: true },
    // Beyond the end - the user may be about to extend to cover it.
    { missionId: 'm1', employeeId: 'e1', start: START + 9 * HOUR, end: START + 10 * HOUR },
    // Live, inside the period.
    { missionId: 'm1', employeeId: 'e2', start: START + HOUR, end: START + 2 * HOUR },
  ],
  ...over,
});

test('countStalePins counts everything outside the period, both sides', () => {
  assert.equal(countStalePins(stale()), 3);
  assert.equal(countStalePins(doc()), 0);
});

test('clearStalePins removes them all and leaves live pins alone', () => {
  const cleaned = clearStalePins(stale());
  assert.equal(cleaned.pins.length, 1);
  assert.equal(cleaned.pins[0].employeeId, 'e2');
  assert.equal(cleaned.pins[0].start, START + HOUR);
});

test('clearStalePins returns the same document when there is nothing to clear', () => {
  const d = doc();
  assert.equal(clearStalePins(d), d);
});

test('a pin on a remote mission is never stale, however its range reads', () => {
  // It is not honoured literally - it staffs the whole mission - so treating
  // it as residue would delete an assignment the engine is actively using.
  const d = doc({
    pins: [{ missionId: 'm1', employeeId: 'e1', start: START - 5 * HOUR, end: START - 4 * HOUR }],
  });
  assert.equal(d.missions[0].type, 'remote');
  assert.equal(countStalePins(d), 0);
  assert.equal(clearStalePins(d), d);
  assert.ok(plan(toPlannerInput(d)).shifts.some((sh) => sh.employeeId === 'e1'));
});

test('a whole-window pin is never stale, whatever the period is', () => {
  // Null start/end inherit the mission window, which is itself clamped into
  // the period, so an inherited pin always overlaps it.
  const d = doc({ pins: [{ missionId: 'm1', employeeId: 'e1', start: null, end: null }] });
  assert.equal(countStalePins(d), 0);
  assert.equal(clearStalePins(d), d);
});

test('the automatic prune drops finished history but never future assignments', () => {
  const prev = stale();
  const pruned = pruneStalePins(prev, { ...prev, title: 'renamed' });
  assert.equal(pruned.pins.length, 2, 'the two pre-period pins go');
  assert.ok(pruned.pins.some((p) => p.start === START + 9 * HOUR), 'the post-period one stays');
  assert.ok(pruned.pins.some((p) => p.start === START + HOUR), 'so does the live one');
});

test('the automatic prune refuses to act while the period itself is being edited', () => {
  // The date fields emit an edit on every intermediate value that parses, so a
  // half-typed year must never be able to delete history: setDoc navigates
  // with replace, and there is no way back.
  const prev = stale();
  const mid = { ...prev, start: START + 500 * HOUR, end: START + 504 * HOUR };
  assert.equal(pruneStalePins(prev, mid), mid, 'nothing removed while the window moves');

  // Once the window is standing still again, the ordinary cleanup resumes.
  assert.equal(pruneStalePins(mid, { ...mid, title: 'x' }).pins.length, 0);
});

test('the planner counts stale pins once instead of warning about each', () => {
  const r = plan(toPlannerInput(stale()));
  const outOfPeriod = r.warnings.filter((w) => w.code === WARN.PIN_OUT_OF_PERIOD);
  assert.equal(outOfPeriod.length, 1, 'one aggregated warning, not three');
  assert.equal(outOfPeriod[0].count, 3);
  assert.equal(
    r.warnings.filter((w) => w.code === WARN.PIN_UNAVAILABLE).length,
    0,
    'residue is not reported as a broken assignment',
  );
});

test('a pin inside the period that its mission cannot host is still a real warning', () => {
  const d = doc({
    missions: [{ id: 'm1', name: 'M1', type: 'local', start: START, end: START + HOUR, count: 1 }],
    pins: [{ missionId: 'm1', employeeId: 'e1', start: START + 2 * HOUR, end: START + 3 * HOUR }],
  });
  const codes = plan(toPlannerInput(d)).warnings.map((w) => w.code);
  assert.ok(codes.includes(WARN.PIN_UNAVAILABLE), 'the actionable case keeps its own warning');
  assert.ok(!codes.includes(WARN.PIN_OUT_OF_PERIOD));
});

/* --- residue on a mission that has itself dropped out of the period --- */

/** One employee, one mission, one pin - varied per case. */
const residue = (mission, pin) => doc({ missions: [mission], pins: [pin] });

const outOfPeriodCount = (d) => {
  const w = plan(toPlannerInput(d)).warnings.find((x) => x.code === WARN.PIN_OUT_OF_PERIOD);
  return w ? w.count : 0;
};

const BEFORE = { start: START - 10 * HOUR, end: START - 9 * HOUR };

test('residue is collectable even when its mission fell out of the period too', () => {
  // A missing bound on a pin inherits the *mission's*, not the plan's. Reading
  // it straight from the plan period answered "not stale" for every pin on a
  // mission that had itself dropped out, so that history could never be
  // collected by anything and rode along in the URL forever.
  const cases = [
    ['inherited range', { id: 'm1', name: 'M', type: 'local', ...BEFORE, count: 1 },
      { missionId: 'm1', employeeId: 'e1', start: null, end: null, frozen: true }],
    ['half-inherited range', { id: 'm1', name: 'M', type: 'local', ...BEFORE, count: 1 },
      { missionId: 'm1', employeeId: 'e1', start: START - 10 * HOUR, end: null, frozen: true }],
    ['remote mission', { id: 'm1', name: 'M', type: 'remote', ...BEFORE, count: 1 },
      { missionId: 'm1', employeeId: 'e1', ...BEFORE, frozen: true }],
  ];

  for (const [label, mission, pin] of cases) {
    const d = residue(mission, pin);
    assert.equal(plan(toPlannerInput(d)).shifts.length, 0, `${label}: staffs nothing`);
    assert.equal(countStalePins(d), 1, `${label}: is collectable`);
    assert.equal(clearStalePins(d).pins.length, 0, `${label}: the button removes it`);
  }
});

test('a live remote pin is never collected, however stale its range reads', () => {
  // The written range is not honoured on a remote mission - the pin staffs the
  // whole thing - so judging it by that range would delete a live assignment.
  const d = residue(
    { id: 'm1', name: 'M', type: 'remote', start: null, end: null, count: 1 },
    { missionId: 'm1', employeeId: 'e1', ...BEFORE, frozen: false },
  );
  assert.equal(plan(toPlannerInput(d)).shifts.length, 1, 'it is staffing the mission');
  assert.equal(countStalePins(d), 0);
  assert.equal(clearStalePins(d), d);
});

test('the reported count is exactly what the button will remove', () => {
  // The button only exists alongside this warning, so a count taken anywhere
  // that cannot see a dropped mission would strand that history with no way to
  // reach it. Both sides share one predicate; this is that contract.
  const cases = [
    residue({ id: 'm1', name: 'M', type: 'local', ...BEFORE, count: 1 },
      { missionId: 'm1', employeeId: 'e1', start: null, end: null, frozen: true }),
    residue({ id: 'm1', name: 'M', type: 'remote', ...BEFORE, count: 1 },
      { missionId: 'm1', employeeId: 'e1', ...BEFORE, frozen: true }),
    residue({ id: 'm1', name: 'M', type: 'remote', start: null, end: null, count: 1 },
      { missionId: 'm1', employeeId: 'e1', ...BEFORE, frozen: false }),
    stale(),
  ];
  for (const d of cases) assert.equal(outOfPeriodCount(d), countStalePins(d));
});

test('clearing residue never changes a single shift', () => {
  // The whole safety argument for the button. If this can fail, the button is
  // not a cleanup, it is an edit.
  for (const d of [stale(), residue(
    { id: 'm1', name: 'M', type: 'local', ...BEFORE, count: 1 },
    { missionId: 'm1', employeeId: 'e1', start: null, end: null, frozen: true },
  )]) {
    assert.deepEqual(
      plan(toPlannerInput(clearStalePins(d))).shifts,
      plan(toPlannerInput(d)).shifts,
    );
  }
});
