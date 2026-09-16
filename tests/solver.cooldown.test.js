import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY, docOf, HOUR, loggedPin, people, prepared, skipWithoutSolver, solve,
} from './solverHelpers.js';

/**
 * A hated mission comes round once per rotation.
 *
 * Kitchen duty and its like should fall to a person once every 7, 14 or 21
 * days rather than whenever the queue happens to reach them. Level 8, above
 * round robin on purpose: the cooldown decides who is *eligible*, the wait
 * decides who goes next among them.
 *
 * Soft, so a roster with nobody else free still gets an answer and a reported
 * breach rather than a refusal to schedule.
 */

const START = new Date(2026, 0, 12, 12, 0, 0, 0).getTime();

// One hourly slot by default. Two slots and two people is a different
// question: the level charges one for every *extra* turn inside the window as
// well as for a turn inside the cooldown, so somebody would breach either way
// and the minimum would be one rather than zero.
const kitchen = (overrides = {}) => docOf({
  start: START,
  end: START + HOUR,
  shiftMinutes: 60,
  employees: people(2),
  missions: [{ id: 'k', name: 'Kitchen', type: 'local', count: 1, repeatAfterDays: 7 }],
  ...overrides,
});

test('somebody inside their cooldown is not sent back while anyone else is free', skipWithoutSolver, async () => {
  const doc = kitchen({
    pins: [loggedPin({
      missionId: 'k', employeeId: 'e1', missionName: 'Kitchen',
      start: START - 2 * DAY, end: START - 2 * DAY + HOUR,
    })],
  });
  const problem = prepared(doc);
  assert.ok(problem.employees[0].memory.heldWithinCooldown.has('k'));

  const { accepted, index } = await solve(doc);
  assert.ok(accepted);
  assert.equal(accepted.quantities.cooldownBreachCount, 0);
  const e1 = index.employeeIds.indexOf('e1');
  for (let s = 0; s < index.segments.length; s++) {
    assert.equal(accepted.assignment[e1 * index.segments.length + s], 0, 'e1 stayed out of the kitchen');
  }
});

test('the cooldown yields to coverage when nobody else is free, and the breach is reported', skipWithoutSolver, async () => {
  const doc = kitchen({
    employees: people(1),
    pins: [loggedPin({
      missionId: 'k', employeeId: 'e1', missionName: 'Kitchen',
      start: START - 2 * DAY, end: START - 2 * DAY + HOUR,
    })],
  });
  const { accepted } = await solve(doc);
  assert.ok(accepted, 'coverage outranks the cooldown, which is what soft means');
  assert.equal(accepted.quantities.unfilledSeatMinutes, 0);
  assert.ok(accepted.quantities.cooldownBreachCount > 0, 'and the breach is said out loud');
});

test('a turn older than the cooldown is no obstacle', skipWithoutSolver, async () => {
  const doc = kitchen({
    employees: people(1),
    pins: [loggedPin({
      missionId: 'k', employeeId: 'e1', missionName: 'Kitchen',
      start: START - 9 * DAY, end: START - 9 * DAY + HOUR,
    })],
  });
  const { accepted } = await solve(doc);
  assert.ok(accepted);
  assert.equal(accepted.quantities.cooldownBreachCount, 0);
  assert.equal(accepted.quantities.unfilledSeatMinutes, 0);
});

test('a second turn inside this window costs one too', skipWithoutSolver, async () => {
  // Two hourly kitchen slots and one person: whoever takes both takes it twice
  // inside the cooldown, which is the same offence the log records.
  const { accepted } = await solve(kitchen({ end: START + 2 * HOUR, employees: people(1) }));
  assert.ok(accepted);
  assert.equal(accepted.diagnostics.turnsTaken[0], 2);
  assert.equal(accepted.quantities.cooldownBreachCount, 1, 'one extra turn, one breach');
});

test('with two people the two kitchen slots go to different people', skipWithoutSolver, async () => {
  const { accepted } = await solve(kitchen({ end: START + 2 * HOUR }));
  assert.ok(accepted);
  assert.equal(accepted.quantities.cooldownBreachCount, 0);
  assert.deepEqual([...accepted.diagnostics.turnsTaken].sort(), [1, 1]);
});

test('a mission with no cooldown never reports a breach, however often it comes round', skipWithoutSolver, async () => {
  const { accepted } = await solve(kitchen({
    end: START + 2 * HOUR,
    employees: people(1),
    missions: [{ id: 'k', name: 'Gate', type: 'local', count: 1 }],
  }));
  assert.ok(accepted);
  assert.equal(accepted.diagnostics.turnsTaken[0], 2);
  assert.equal(accepted.quantities.cooldownBreachCount, 0);
});

test('the cooldown is measured from the log, so a shorter memory cannot see it', skipWithoutSolver, async () => {
  const pins = [loggedPin({
    missionId: 'k', employeeId: 'e1', missionName: 'Kitchen',
    start: START - 5 * DAY, end: START - 5 * DAY + HOUR,
  })];
  const remembered = prepared(kitchen({ pins, memoryDays: 21 }));
  const forgotten = prepared(kitchen({ pins, memoryDays: 3 }));
  assert.ok(remembered.employees[0].memory.heldWithinCooldown.has('k'));
  assert.equal(forgotten.employees[0].memory.heldWithinCooldown.has('k'), false);
  // Which is exactly why a cooldown longer than the memory is reported.
  assert.ok(prepared(kitchen({ pins, memoryDays: 3 })).issues
    .some((issue) => issue.code === 'cooldown-beyond-memory'));
});
