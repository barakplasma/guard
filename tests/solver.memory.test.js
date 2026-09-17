import test from 'node:test';
import assert from 'node:assert/strict';
import { readDutyMemory, loggedTurns, countStaleCommitments } from '../src/solver/prepare.ts';
import { TARGET_REST_MINUTES } from '../src/solver/types.ts';
import { DAY, docOf, HOUR, loggedPin, people, prepared } from './solverHelpers.js';

/**
 * The log is the scheduler's memory.
 *
 * There is no `carriedMinutes`, no `carriedStints` and no `lastDutyEnd`: the
 * owner's decision is that duty is exported and never cleared, so the rows
 * stay in the document and every number about the past is derived from them
 * here. That removes the whole class of bug where a total has to be stamped at
 * exactly the moment a window rolls - which is what ADR 015 spent a release
 * getting right.
 */

const START = new Date(2026, 0, 12, 12, 0, 0, 0).getTime();

const withLog = (pins, overrides = {}) => docOf({
  start: START,
  end: START + DAY,
  employees: people(2),
  missions: [
    { id: 'm1', name: 'Gate', type: 'local', count: 1 },
    { id: 'm2', name: 'Kitchen', type: 'local', count: 1, repeatAfterDays: 7 },
  ],
  pins,
  ...overrides,
});

test('idle minutes at the horizon start are capped at eight hours', () => {
  const recent = readDutyMemory(withLog([
    loggedPin({ missionId: 'm1', employeeId: 'e1', start: START - 2 * HOUR, end: START - HOUR }),
  ]));
  assert.equal(recent.get('e1').idleMinutesAtHorizonStart, 60);

  const distant = readDutyMemory(withLog([
    loggedPin({ missionId: 'm1', employeeId: 'e1', start: START - 5 * DAY, end: START - 5 * DAY + HOUR }),
  ]));
  assert.equal(
    distant.get('e1').idleMinutesAtHorizonStart,
    TARGET_REST_MINUTES,
    'after a night\'s sleep it no longer matters when somebody last stood post',
  );
});

test('somebody with nothing in the log is fully rested, not at zero', () => {
  const memory = readDutyMemory(withLog([]));
  assert.equal(memory.get('e2').idleMinutesAtHorizonStart, TARGET_REST_MINUTES);
  assert.equal(memory.get('e2').turns, 0);
});

test('turns, night minutes and per-mission turns are counted only inside memoryDays', () => {
  const doc = withLog([
    loggedPin({ missionId: 'm1', employeeId: 'e1', start: START - 2 * DAY, end: START - 2 * DAY + HOUR }),
    loggedPin({ missionId: 'm2', employeeId: 'e1', start: START - 3 * DAY, end: START - 3 * DAY + HOUR }),
    // Ten days back: inside the default 21-day memory, outside a 5-day one.
    loggedPin({ missionId: 'm1', employeeId: 'e1', start: START - 10 * DAY, end: START - 10 * DAY + HOUR }),
  ]);
  const wide = readDutyMemory(doc, 21).get('e1');
  assert.equal(wide.turns, 3);
  assert.equal(wide.turnsOnMission.get('m1'), 2);
  assert.equal(wide.turnsOnMission.get('m2'), 1);

  const narrow = readDutyMemory(doc, 5).get('e1');
  assert.equal(narrow.turns, 2, 'the ten-day-old turn is outside a five-day memory');
  assert.equal(narrow.turnsOnMission.get('m1'), 1);
});

test('night minutes are measured over the memory horizon, not only the plan window', () => {
  // 23:00-01:00 four days before the plan opens: entirely inside a night that
  // `nightWindows` would never produce for the plan's own window.
  const nightStart = new Date(2026, 0, 8, 23, 0, 0, 0).getTime();
  const memory = readDutyMemory(withLog([
    loggedPin({ missionId: 'm1', employeeId: 'e1', start: nightStart, end: nightStart + 2 * HOUR }),
  ]));
  assert.equal(memory.get('e1').nightMinutes, 120);
});

test('a daytime turn contributes no night minutes', () => {
  const noon = new Date(2026, 0, 9, 12, 0, 0, 0).getTime();
  const memory = readDutyMemory(withLog([
    loggedPin({ missionId: 'm1', employeeId: 'e1', start: noon, end: noon + 2 * HOUR }),
  ]));
  assert.equal(memory.get('e1').nightMinutes, 0);
});

test('a mission held inside its repeatAfterDays is in heldWithinCooldown', () => {
  const inside = readDutyMemory(withLog([
    loggedPin({ missionId: 'm2', employeeId: 'e1', start: START - 3 * DAY, end: START - 3 * DAY + HOUR }),
  ]));
  assert.ok(inside.get('e1').heldWithinCooldown.has('m2'));

  const outside = readDutyMemory(withLog([
    loggedPin({ missionId: 'm2', employeeId: 'e1', start: START - 9 * DAY, end: START - 9 * DAY + HOUR }),
  ]));
  assert.equal(outside.get('e1').heldWithinCooldown.has('m2'), false);
});

test('a mission with no cooldown never lands in heldWithinCooldown', () => {
  const memory = readDutyMemory(withLog([
    loggedPin({ missionId: 'm1', employeeId: 'e1', start: START - HOUR, end: START }),
  ]));
  assert.equal(memory.get('e1').heldWithinCooldown.size, 0);
});

test('hour-of-day counts use the viewer\'s clock, like the night windows', () => {
  const at3am = new Date(2026, 0, 10, 3, 0, 0, 0).getTime();
  const memory = readDutyMemory(withLog([
    loggedPin({ missionId: 'm1', employeeId: 'e1', start: at3am, end: at3am + HOUR }),
    loggedPin({ missionId: 'm1', employeeId: 'e1', start: at3am + DAY, end: at3am + DAY + HOUR }),
  ]));
  const holds = memory.get('e1').hourHolds;
  assert.equal(holds.length, 24);
  assert.equal(holds[3], 2);
  assert.equal(holds.reduce((sum, n) => sum + n, 0), 2);
});

test('only elapsed rows are memory: an assignment for next week is not history', () => {
  const doc = withLog([
    // After the window, so out of period but not elapsed.
    { missionId: 'm1', employeeId: 'e1', start: START + 3 * DAY, end: START + 3 * DAY + HOUR, frozen: false, record: null },
  ]);
  assert.deepEqual(loggedTurns(doc, 21), []);
  const stale = countStaleCommitments(doc);
  assert.equal(stale.count, 1, 'the engine is ignoring it, which is worth knowing');
  assert.equal(stale.elapsed, 0, 'but it is a plan, not a record');
});

test('a hand-made pin behind the window counts as memory, record or not', () => {
  const doc = withLog([
    { missionId: 'm1', employeeId: 'e1', start: START - 2 * HOUR, end: START - HOUR, frozen: false, record: null },
  ]);
  assert.equal(loggedTurns(doc, 21).length, 1);
  assert.equal(readDutyMemory(doc).get('e1').turns, 1);
});

test('a turn longer than one shift counts as several, at least one', () => {
  const doc = withLog([
    loggedPin({ missionId: 'm1', employeeId: 'e1', start: START - 5 * HOUR, end: START - 2 * HOUR }),
  ], { shiftMinutes: 60 });
  assert.equal(readDutyMemory(doc).get('e1').turns, 3);

  const short = withLog([
    loggedPin({ missionId: 'm1', employeeId: 'e1', start: START - 70 * 60_000, end: START - 60 * 60_000 }),
  ], { shiftMinutes: 120 });
  assert.equal(readDutyMemory(short).get('e1').turns, 1, 'never zero');
});

test('a mission held whole is one turn, however long the hold ran', () => {
  // A remote mission is one claim taken once - the same rule `ringKeys`
  // follows inside the engine. Charged by the plan's shift length a
  // twelve-hour hold would read as twelve turns and send its holder round the
  // ring eleven laps early.
  const doc = withLog([
    loggedPin({
      missionId: 'r1', employeeId: 'e1', missionName: 'Patrol', missionType: 'remote',
      start: START - 14 * HOUR, end: START - 2 * HOUR,
    }),
  ], {
    shiftMinutes: 60,
    missions: [{
      id: 'r1', name: 'Patrol', type: 'remote', count: 1,
      start: START - 14 * HOUR, end: START - 2 * HOUR,
    }],
  });
  const memory = readDutyMemory(doc);
  assert.equal(memory.get('e1').turns, 1);
  assert.equal(memory.get('e1').turnsOnMission.get('r1'), 1);
});

test('a local turn is charged against its own mission\'s shift length', () => {
  // There is no single global step to do arithmetic on: a two-hour חמ"ל slot
  // is one turn and so is the hourly gate slot beside it, and reading the
  // plan default for both is exactly the arithmetic `gridFor` exists to stop.
  const doc = withLog([
    loggedPin({ missionId: 'slow', employeeId: 'e1', start: START - 5 * HOUR, end: START - HOUR }),
    loggedPin({ missionId: 'fast', employeeId: 'e2', start: START - 5 * HOUR, end: START - HOUR }),
  ], {
    shiftMinutes: 60,
    missions: [
      { id: 'slow', name: 'War room', type: 'local', count: 1, shiftMinutes: 120 },
      { id: 'fast', name: 'Gate', type: 'local', count: 1 },
    ],
  });
  const memory = readDutyMemory(doc);
  assert.equal(memory.get('e1').turns, 2, 'four hours of two-hour slots');
  assert.equal(memory.get('e2').turns, 4, 'four hours of the plan\'s own hourly slots');
});

test('the record says what type it was, so a deleted mission is still charged right', () => {
  // A recorded pin outlives the mission it names (ADR 012's second
  // correction), and the live lists are the fallback, never the source.
  const doc = withLog([
    loggedPin({
      missionId: 'gone', employeeId: 'e1', missionName: 'Convoy', missionType: 'remote',
      start: START - 14 * HOUR, end: START - 2 * HOUR,
    }),
  ], { shiftMinutes: 60 });
  assert.equal(readDutyMemory(doc).get('e1').turns, 1);
});

test('memoryDays reaches the model through prepareProblem, which is the only route', () => {
  const doc = withLog([], { memoryDays: 7 });
  assert.equal(prepared(doc).memoryDays, 7);
});

test('a cooldown longer than the memory is reported, never clamped', () => {
  const doc = docOf({
    start: START,
    memoryDays: 14,
    employees: people(2),
    missions: [{ id: 'm2', name: 'Kitchen', type: 'local', count: 1, repeatAfterDays: 21 }],
  });
  const issue = prepared(doc).issues.find((i) => i.code === 'cooldown-beyond-memory');
  assert.ok(issue);
  assert.equal(issue.repeatAfterDays, 21);
  assert.equal(issue.memoryDays, 14);
});

test('the memory of a guard whose mission has dropped out of the period is still read', () => {
  // The mission's own window is behind the plan, so it is gone from every
  // normalized list - and the hours its pins record are no less real.
  const doc = docOf({
    start: START,
    employees: people(2),
    missions: [{
      id: 'm1', name: 'Gate', type: 'local', count: 1,
      start: START - 4 * DAY, end: START - 3 * DAY,
    }],
    pins: [loggedPin({ missionId: 'm1', employeeId: 'e1', start: START - 4 * DAY, end: START - 4 * DAY + HOUR })],
  });
  assert.equal(readDutyMemory(doc).get('e1').turns, 1);
});
