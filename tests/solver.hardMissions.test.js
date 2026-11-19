import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignmentBySegment, compiled, DAY, docOf, HOUR, loggedPin, people, prepared,
  skipWithoutSolver, solve,
} from './solverHelpers.js';

/**
 * A hard mission goes round everybody before it comes back to anybody.
 *
 * Kitchen duty and its like. Two levels, not one: level 10 keeps drivers and
 * commanders out of the rotation, level 11 spreads it across everybody who is
 * in it. Above round robin on purpose - this decides who is eligible for the
 * kitchen, the wait decides who goes next among them.
 *
 * There is no cooldown in days anywhere here, and that is the point. "Once per
 * rotation" is the rule, and a rotation's length is a fact about the roster
 * rather than a figure to type in: with ten people and a daily kitchen a
 * rotation is ten days, and five the moment half of them are away. Minimising
 * `max - min` over the visit counts says exactly "everybody once before
 * anybody twice" and needs no date arithmetic, so nothing here can outrun
 * `memoryDays` either.
 *
 * Soft, like every level: a roster with nobody else free still gets an answer
 * and a reported repeat rather than a refusal to schedule.
 */

const START = new Date(2026, 0, 12, 12, 0, 0, 0).getTime();

/** A kitchen that comes round once a day, for as many days as the plan runs. */
const kitchen = (overrides = {}) => docOf({
  start: START,
  end: START + 3 * DAY,
  shiftMinutes: 60,
  employees: people(3),
  missions: [{
    id: 'k', name: 'Kitchen', type: 'daily', count: 1, hard: true,
    dayStart: 12 * 60, dayEnd: 13 * 60,
  }],
  ...overrides,
});

/** Who held the kitchen, once per day it ran. */
const holders = (accepted, index) => assignmentBySegment(accepted, index)
  .flat()
  .filter((cell) => cell.missionId === 'k')
  .map((cell) => cell.employeeId);

test('three kitchen days and three people is one each', skipWithoutSolver, async () => {
  const { accepted, index } = await solve(kitchen());
  assert.ok(accepted);
  assert.equal(accepted.quantities.unfilledSeatMinutes, 0);
  assert.equal(accepted.quantities.hardMissionSpread, 0, 'nobody went twice');
  assert.deepEqual([...new Set(holders(accepted, index))].sort(), ['e1', 'e2', 'e3']);
});

test('a fourth person means somebody sits it out, not that somebody goes twice', skipWithoutSolver, async () => {
  const { accepted, index } = await solve(kitchen({ employees: people(4) }));
  assert.ok(accepted);
  // Three days between four people: one person is spare, and the best
  // possible spread is the one that difference forces.
  assert.equal(accepted.quantities.hardMissionSpread, 1);
  const took = holders(accepted, index);
  assert.equal(took.length, 3);
  assert.equal(new Set(took).size, 3, 'three different people');
});

test('the log is part of the rotation, so yesterday\'s cook goes last', skipWithoutSolver, async () => {
  // One kitchen day and two people, and the log already shows e1 at it. Giving
  // it to e1 again reads 2/0; giving it to e2 reads 1/1.
  const doc = kitchen({
    end: START + DAY,
    employees: people(2),
    pins: [loggedPin({
      missionId: 'k', employeeId: 'e1', missionName: 'Kitchen', missionType: 'daily',
      start: START - 2 * DAY, end: START - 2 * DAY + HOUR,
    })],
  });
  assert.equal(prepared(doc).employees[0].memory.visitsOnMission.get('k'), 1);

  const { accepted, index } = await solve(doc);
  assert.ok(accepted);
  assert.equal(accepted.quantities.hardMissionSpread, 0);
  assert.deepEqual(holders(accepted, index), ['e2']);
});

test('a driver or a commander is not in the rotation at all', skipWithoutSolver, async () => {
  // e3 is the commander. Three kitchen days between the other two is 2/1 - a
  // spread of one - and handing e3 a day would make it 1/1/1 and score zero.
  // Level 10 is what stops the solver taking that trade.
  const doc = kitchen({
    employees: [...people(2), { id: 'e3', name: 'Commander', tags: ['cmd'] }],
    tags: [{ id: 'cmd', name: 'Commander', exemptFromHardMissions: true }],
  });
  const { instance, problem } = compiled(doc);
  const commander = problem.employees.findIndex((employee) => employee.id === 'e3');
  assert.equal(instance.isExemptFromHard[commander], true);
  assert.equal(instance.isHardMission[0], true);

  const { accepted, index } = await solve(doc);
  assert.ok(accepted);
  assert.equal(accepted.quantities.exemptHardVisits, 0, 'the commander was left out');
  assert.equal(accepted.quantities.hardMissionSpread, 1, 'three days between the other two');
  assert.ok(!holders(accepted, index).includes('e3'));
});

test('...but the exemption yields when there is nobody else', skipWithoutSolver, async () => {
  const doc = kitchen({
    end: START + DAY,
    employees: [{ id: 'e1', name: 'Commander', tags: ['cmd'] }],
    tags: [{ id: 'cmd', name: 'Commander', exemptFromHardMissions: true }],
  });
  const { accepted } = await solve(doc);
  assert.ok(accepted, 'coverage outranks the exemption, which is what soft means');
  assert.equal(accepted.quantities.unfilledSeatMinutes, 0);
  assert.equal(accepted.quantities.exemptHardVisits, 1, 'and it is said out loud');
});

test('two hours back to back are one turn at the kitchen, not two', skipWithoutSolver, async () => {
  // Three hourly slots on one local hard mission and two people. Somebody has
  // to stand two of them back to back, and that stint is one visit to the
  // kitchen - so the counts read 1/1 and the spread is zero. Were adjacent
  // slots charged separately the same answer would read 2/1, and the level
  // would be pushing for a handover in the middle of a single stint.
  const doc = kitchen({
    end: START + 3 * HOUR,
    employees: people(2),
    missions: [{ id: 'k', name: 'Kitchen', type: 'local', count: 1, hard: true }],
  });
  const { accepted } = await solve(doc);
  assert.ok(accepted);
  assert.equal(accepted.quantities.unfilledSeatMinutes, 0);

  const slots = accepted.diagnostics.turnsOnMission.map((row) => row[0]);
  assert.equal(slots.reduce((sum, n) => sum + n, 0), 3, 'three slots were stood');
  assert.deepEqual([...slots].sort(), [1, 2], 'and somebody stood two of them');
  assert.equal(accepted.quantities.hardMissionSpread, 0, 'which is still one visit each');
});

test('a mission nobody marked hard never reports a rotation at all', skipWithoutSolver, async () => {
  const { accepted } = await solve(kitchen({
    employees: people(2),
    missions: [{
      id: 'k', name: 'Gate', type: 'daily', count: 1,
      dayStart: 12 * 60, dayEnd: 13 * 60,
    }],
  }));
  assert.ok(accepted);
  assert.equal(accepted.quantities.hardMissionSpread, 0);
  assert.equal(accepted.quantities.exemptHardVisits, 0);
});
