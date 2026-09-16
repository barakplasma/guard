import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyClearPin, applyClearPinsForMission, applyMissionAssignees, applySwap,
  clearStalePins, countStalePins, cutPin, freezeElapsedBeforeEdit, freezePastShifts, pinCovers,
} from '../src/lib/pins.js';
import { WARN } from '../src/lib/planner.js';
import { plan } from '../src/lib/planner.js';
import { planSchema, prunePins, toPlannerInput } from '../src/lib/planSchema.js';

const DAY = 24 * 60 * 60 * 1000;
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

function twoHourLocalDoc() {
  return doc({
    end: START + 2 * HOUR,
    missions: [{ id: 'm1', name: 'Gate', type: 'local', start: null, end: null, count: 1 }],
  });
}

function firstHourOf(d) {
  return plan(toPlannerInput(d)).shifts.find((shift) => shift.start === START);
}

const withExtraEmployee = (d) => ({
  ...d,
  employees: [...d.employees, { id: 'e4', name: 'D', start: null, end: null }],
});

function twoSeatPins() {
  const base = doc({
    missions: [{ id: 'm1', name: 'Remote', type: 'remote', start: null, end: null, count: 2 }],
  });
  return applyMissionAssignees(base, 'm1', ['e1', 'e2']);
}

function assertFirstHourPreserved(beforeDoc, afterDoc) {
  const before = firstHourOf(beforeDoc);
  const after = firstHourOf(afterDoc);
  assert.equal(after.employeeId, before.employeeId, 'the past shift did not change hands');
  assert.equal(after.pinned, true);
}

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

test('swapping the whole of a whole-mission pin cuts all of it away', () => {
  // e1 assigned from the Missions page, then swapped out for e2 on the row -
  // and on a remote mission that row *is* the whole mission, so the cut takes
  // the entire pin and nothing is left over.
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
  const d = twoSeatPins();
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

/* --- cutting a pin around one shift ----------------------------------- */

// A local mission, where a whole-mission pin is now visible - and editable -
// in every shift slot it covers, not just as one long row.
const localDoc = (over = {}) => doc({
  missions: [{ id: 'm1', name: 'Gate', type: 'local', start: null, end: null, count: 1 }],
  ...over,
});

test('clearing one hour of a whole-mission pin cuts it in two rather than dropping it', () => {
  const d = applyMissionAssignees(localDoc(), 'm1', ['e1']);
  const after = applyClearPin(d, {
    missionId: 'm1', employeeId: 'e1', start: START + HOUR, end: START + 2 * HOUR,
  });

  assert.equal(after.pins.length, 2);
  // The bound that was not cut stays null, so each remainder still follows the
  // mission's window if it is later moved.
  assert.deepEqual(
    after.pins.map((p) => [p.start, p.end]),
    [[null, START + HOUR], [START + 2 * HOUR, null]],
  );
  assert.ok(after.pins.every((p) => !pinCovers(after, p, START + HOUR, START + 2 * HOUR)));
  assert.ok(pinCovers(after, after.pins[0], START, START + HOUR));
  assert.ok(pinCovers(after, after.pins[1], START + 2 * HOUR, START + 4 * HOUR));

  // And the cleared hour really does go back to the rotation.
  const result = plan(toPlannerInput(after));
  const hour = result.shifts.filter((s) => s.start === START + HOUR && s.missionId === 'm1');
  assert.equal(hour.length, 1);
  assert.notEqual(hour[0].employeeId, 'e1');
});

test('clearing an hour at either end of a whole-mission pin leaves a single remainder', () => {
  const d = applyMissionAssignees(localDoc(), 'm1', ['e1']);

  const first = applyClearPin(d, {
    missionId: 'm1', employeeId: 'e1', start: START, end: START + HOUR,
  });
  assert.deepEqual(first.pins.map((p) => [p.start, p.end]), [[START + HOUR, null]]);

  const last = applyClearPin(d, {
    missionId: 'm1', employeeId: 'e1', start: START + 3 * HOUR, end: START + 4 * HOUR,
  });
  assert.deepEqual(last.pins.map((p) => [p.start, p.end]), [[null, START + 3 * HOUR]]);
});

test('swapping one hour of a whole-mission pin cuts the holder and pins the newcomer', () => {
  const d = applyMissionAssignees(localDoc(), 'm1', ['e1']);
  const after = applySwap(d, {
    missionId: 'm1',
    employeeId: 'e2',
    start: START + HOUR,
    end: START + 2 * HOUR,
    replacingEmployeeId: 'e1',
  });

  assert.deepEqual(
    after.pins.map((p) => [p.employeeId, p.start, p.end]),
    [
      ['e1', null, START + HOUR],
      ['e1', START + 2 * HOUR, null],
      ['e2', START + HOUR, START + 2 * HOUR],
    ],
    'e1 keeps everything but the swapped hour, which is now e2\'s',
  );

  const result = plan(toPlannerInput(after));
  const held = (t) => result.shifts.find((s) => s.missionId === 'm1' && s.start === t).employeeId;
  assert.equal(held(START), 'e1');
  assert.equal(held(START + HOUR), 'e2');
  assert.equal(held(START + 2 * HOUR), 'e1');
});

test('cutting a frozen pin leaves frozen remainders', () => {
  // History stays history: the part of an elapsed assignment that was not
  // corrected must keep the flag that stops a later availability edit from
  // reshuffling it.
  const d = localDoc({
    pins: [{
      missionId: 'm1', employeeId: 'e1', start: null, end: null, frozen: true,
    }],
  });
  const after = applyClearPin(d, {
    missionId: 'm1', employeeId: 'e1', start: START + HOUR, end: START + 2 * HOUR,
  });
  assert.equal(after.pins.length, 2);
  assert.ok(after.pins.every((p) => p.frozen === true));
});

test('cutPin returns nothing when the pin covers exactly the range taken out of it', () => {
  const d = localDoc();
  const wholeMission = { missionId: 'm1', employeeId: 'e1', start: null, end: null };
  assert.deepEqual(cutPin(d, wholeMission, START, START + 4 * HOUR), []);
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
  const d = twoSeatPins();
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

test('freezing the past adds nothing for a whole-mission pin whose hours have elapsed', () => {
  // A pin on a local mission now produces one row per hour, and every one of
  // them is `pinned`. They must not be mistaken for the engine's own choices
  // and frozen a second time: that would turn one assignment into a pile of
  // literal-range pins, and the whole-mission pin would stop following the
  // mission's window.
  const prev = doc({
    missions: [{ id: 'm1', name: 'Gate', type: 'local', start: null, end: null, count: 1 }],
    pins: [{ missionId: 'm1', employeeId: 'e1', start: null, end: null }],
  });
  const next = { ...prev, title: 'edited' };
  const merged = freezeElapsedBeforeEdit(prev, next, START + 3 * HOUR);
  assert.deepEqual(merged.pins, prev.pins, 'the pinned hours were already decided by hand');
});

test('a frozen shift survives an unrelated later edit to the document', () => {
  const d = twoHourLocalDoc();
  const before = plan(toPlannerInput(d));
  const frozen = freezePastShifts(d, before, START + HOUR);

  // Adding a new employee reshuffles the balancer's choices for a local
  // mission - this is exactly the kind of edit that would otherwise rewrite
  // who already worked the first hour.
  const edited = withExtraEmployee(frozen);
  assertFirstHourPreserved(d, edited);
});

/* --- freezing centrally, before every edit ---------------------------- */

test('freezeElapsedBeforeEdit locks in the past even on an edit that never went through the schedule screen', () => {
  // The regression this guards against: freezing only while SchedulePage is
  // mounted misses edits made from Employees/Missions, so by the time the
  // schedule is viewed again the past has already been reshuffled. Basing the
  // freeze on `prev` - the document as it stood right before this edit -
  // means it doesn't matter which page made the edit.
  const prev = twoHourLocalDoc();
  // An edit elsewhere in the document - e.g. adding an employee from the
  // Employees page - made after the first hour has already elapsed.
  const next = withExtraEmployee(prev);
  const merged = freezeElapsedBeforeEdit(prev, next, START + HOUR);

  assertFirstHourPreserved(prev, merged);
});

test('freezeElapsedBeforeEdit lets an intentional clear of a frozen shift stick', () => {
  const prev = twoHourLocalDoc();
  const firstHour = firstHourOf(prev);

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
  const prev = twoHourLocalDoc();
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

test('setting a mission roster releases everyone left off it, whole pin or partial', () => {
  // The picker lists anyone holding a pin on the mission, e2's single shift
  // included, so a name missing from the list was deliberately unticked - and
  // unticking has to be able to undo a tick whose range was since trimmed.
  const d = doc({
    pins: [
      { missionId: 'm1', employeeId: 'e1', start: null, end: null },
      { missionId: 'm1', employeeId: 'e2', start: START, end: START + HOUR },
    ],
  });
  const after = applyMissionAssignees(d, 'm1', ['e3']);
  assert.deepEqual(
    after.pins.map((p) => `${p.employeeId}:${p.start == null ? 'whole' : 'range'}`),
    ['e3:whole'],
  );
});

test('a roster edit leaves a partially assigned person exactly as they are', () => {
  // e1 kept on the list while e3 is added: the picker cannot express a range,
  // so rewriting e1's trimmed assignment from here would silently undo the cut.
  const d = doc({
    pins: [
      { missionId: 'm1', employeeId: 'e1', start: null, end: START + HOUR },
      { missionId: 'm1', employeeId: 'e1', start: START + 2 * HOUR, end: null },
    ],
  });
  const after = applyMissionAssignees(d, 'm1', ['e1', 'e3']);
  assert.deepEqual(after.pins.filter((p) => p.employeeId === 'e1'), d.pins);
  assert.deepEqual(
    after.pins.filter((p) => p.employeeId === 'e3'),
    [{ missionId: 'm1', employeeId: 'e3', start: null, end: null }],
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

test('countStalePins counts what has elapsed, not what is merely outside', () => {
  // Three pins sit outside the period and only two of them are history. The
  // third is beyond the end - an assignment somebody made for later, which the
  // engine ignores but which is a plan rather than a record. Counting it here
  // would put it in the export as completed duty and then delete it.
  assert.equal(countStalePins(stale()), 2);
  assert.equal(countStalePins(doc()), 0);
});

test('clearStalePins removes elapsed history and leaves everything else alone', () => {
  const cleaned = clearStalePins(stale());
  assert.equal(cleaned.pins.length, 2, 'the live pin and the one beyond the end both survive');
  assert.ok(
    cleaned.pins.some((p) => p.start === START + HOUR),
    'the live pin is untouched',
  );
  assert.ok(
    cleaned.pins.some((p) => p.start === START + 9 * HOUR),
    'and so is the assignment beyond the end - that is a plan, not residue',
  );
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

test('no edit removes recorded duty on its own (ADR 012)', () => {
  // There used to be an automatic prune here, and it was correct while
  // out-of-period pins were residue. Once a rolled-past window is *exported*,
  // those pins are the only durable record, and the prune deleted 288 of them
  // per unrelated edit - see scripts/rollForwardLoss.mjs. Removal is explicit
  // now, and this asserts that nothing does it silently.
  const prev = stale();
  const rolled = { ...prev, start: START + 500 * HOUR, end: START + 504 * HOUR };
  assert.equal(
    planSchema.parse(prunePins(rolled)).pins.length,
    prev.pins.length,
    'rolling the window past history keeps all of it',
  );
  assert.equal(
    planSchema.parse(prunePins({ ...rolled, title: 'x' })).pins.length,
    prev.pins.length,
    'and so does the next ordinary edit, which is where the loss used to land',
  );
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

/**
 * What the warning reports as *clearable*, which is the number the button acts
 * on. Deliberately `elapsed` rather than `count`: the warning counts everything
 * the engine is ignoring, on both sides of the window, and only the elapsed
 * half is history the button may export and remove.
 */
const outOfPeriodCount = (d) => {
  const w = plan(toPlannerInput(d)).warnings.find((x) => x.code === WARN.PIN_OUT_OF_PERIOD);
  return w ? w.elapsed : 0;
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
  // reach it. One shared predicate keeps the three honest - what the warning
  // reports as clearable is what the export carries is what the button removes.
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

test('an assignment beyond the period end is never called history', () => {
  // The bug this pins: `isOutOfPeriod` is true on both sides of the window, so
  // an assignment made for next week was written into the history CSV as
  // completed duty and then deleted by the button. Somebody's plan, consumed by
  // narrowing the period.
  const later = { start: START + 7 * DAY, end: START + 7 * DAY + 4 * HOUR };
  const d = doc({
    missions: [{ id: 'next', name: 'Next week', type: 'local', ...later, count: 1 }],
    pins: [{ missionId: 'next', employeeId: 'e1', ...later, frozen: false }],
  });
  assert.equal(outOfPeriodCount(d), 0, 'the warning reports nothing clearable');
  assert.equal(countStalePins(d), 0, 'the button does not offer to remove it');
  assert.equal(clearStalePins(d).pins.length, 1, 'and pressing it anyway leaves it alone');

  // It is still reported, because the engine is not scheduling it and the user
  // should know. That is the half that stays two-sided.
  const result = plan({ ...toPlannerInput(d), onInvariantViolation: 'report' });
  const warning = result.warnings.find((w) => w.code === 'pin-out-of-period');
  assert.ok(warning, 'the warning still names it');
  assert.equal(warning.count, 1, 'counted among what is being ignored');
  assert.equal(warning.elapsed, 0, 'but none of it is clearable history');
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
