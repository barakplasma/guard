import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGET_REST_MINUTES } from '../src/solver/types.ts';
import { matrixOf, score } from './solverOracle.js';
import {
  DAY, docOf, HOUR, loggedPin, people, skipWithoutSolver, solve,
} from './solverHelpers.js';

/**
 * Fairness is round robin by longest wait, and nothing else.
 *
 * Nobody wants equal hours - that is the owner's decision, and the reason
 * `balanced` is retired. Whoever has waited longest since their last duty goes
 * next, and somebody back from a long mission joins the end of the queue. The
 * wait is capped at the eight-hour rest target, because after a night's sleep
 * it no longer matters when somebody last guarded.
 */

const START = new Date(2026, 0, 12, 12, 0, 0, 0).getTime();

const gate = (overrides = {}) => docOf({
  start: START,
  end: START + 4 * HOUR,
  shiftMinutes: 60,
  employees: people(3),
  missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
  ...overrides,
});

test('no chosen turn begins after a wait shorter than the reported bottleneck', skipWithoutSolver, async () => {
  const { accepted, instance } = await solve(gate());
  assert.ok(accepted);
  const mine = score(instance, matrixOf(accepted, instance));
  assert.equal(mine.shortestWaitMinutes, accepted.quantities.shortestWaitMinutes);

  // The reported figure is the minimum over every turn the solver chose, so
  // "no turn began sooner" is the same statement read the other way.
  const reported = accepted.quantities.shortestWaitMinutes;
  let idle = instance.idleMinutesAtHorizonStart.map(
    (value) => Math.min(TARGET_REST_MINUTES, value),
  );
  for (let s = 0; s < instance.segmentCount; s++) {
    for (let e = 0; e < instance.employeeCount; e++) {
      const here = accepted.assignment[e * instance.segmentCount + s] !== 0;
      const before = s > 0 && accepted.assignment[e * instance.segmentCount + s - 1] !== 0;
      if (here && !before) assert.ok(idle[e] >= reported, `turn at segment ${s} waited ${idle[e]}`);
    }
    idle = idle.map((value, e) => (accepted.assignment[e * instance.segmentCount + s] !== 0
      ? 0
      : Math.min(TARGET_REST_MINUTES, value + instance.segmentMinutes[s])));
  }
});

test('a guard whose hold ended at the horizon start goes to the back of the queue', skipWithoutSolver, async () => {
  // e1 came off duty the moment the plan opens; the others have been rested
  // for days. One seat an hour, three people: the first hour must not be e1's.
  const doc = gate({
    pins: [loggedPin({ missionId: 'm1', employeeId: 'e1', start: START - HOUR, end: START })],
  });
  const { accepted, index } = await solve(doc);
  assert.ok(accepted);
  const e1 = index.employeeIds.indexOf('e1');
  const first = index.segments.findIndex((segment) => segment.start === START);
  assert.equal(
    accepted.assignment[e1 * index.segments.length + first],
    0,
    'somebody with a longer wait was free',
  );
});

test('two people equally rested are separated only by turns', skipWithoutSolver, async () => {
  // Both rested well past the cap, so the wait key ties at the start and the
  // queue is turn count alone (level 10).
  const doc = gate({
    end: START + 6 * HOUR,
    employees: people(2),
  });
  const { accepted } = await solve(doc);
  assert.ok(accepted);
  assert.equal(accepted.quantities.turnSpread, 0, 'six hourly slots split evenly between two');
  assert.deepEqual(accepted.diagnostics.turnsTaken, [3, 3]);
});

test('the wait is capped: two days off and eight hours off are the same queue position', skipWithoutSolver, async () => {
  const near = gate({
    employees: people(2),
    pins: [
      loggedPin({ missionId: 'm1', employeeId: 'e1', start: START - 9 * HOUR, end: START - 8 * HOUR }),
      loggedPin({ missionId: 'm1', employeeId: 'e2', start: START - 3 * DAY, end: START - 3 * DAY + HOUR }),
    ],
  });
  const { problem } = await solve(near);
  const idle = problem.employees.map((employee) => employee.memory.idleMinutesAtHorizonStart);
  assert.deepEqual(idle, [TARGET_REST_MINUTES, TARGET_REST_MINUTES],
    'a rested roster is symmetric at the start, which is what makes symmetry breaking pay');
});

test('turns already in the log count towards the spread', skipWithoutSolver, async () => {
  // e1 stood three turns yesterday, e2 none. Over two slots today the queue
  // should hand both to e2, which is what carrying the log into level 10 means.
  const doc = gate({
    end: START + 2 * HOUR,
    employees: people(2),
    pins: [
      loggedPin({ missionId: 'm1', employeeId: 'e1', start: START - 12 * HOUR, end: START - 9 * HOUR }),
    ],
  });
  const { accepted, problem } = await solve(doc);
  assert.ok(accepted);
  assert.equal(problem.employees[0].memory.turns, 3);
  assert.deepEqual(accepted.diagnostics.turnsTaken, [0, 2]);
});

test('a turn is one slot, not one unbroken run', skipWithoutSolver, async () => {
  // Two seats an hour and two people: everybody works every hour, so both
  // stand an unbroken block. Counting the block as one turn is what once made
  // the guard who never got a break the cheapest candidate forever.
  const doc = gate({
    end: START + 4 * HOUR,
    employees: people(2),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 2 }],
  });
  const { accepted } = await solve(doc);
  assert.ok(accepted);
  assert.deepEqual(accepted.diagnostics.turnsTaken, [4, 4]);
});

test('a remote hold is one claim taken once, however long it runs', skipWithoutSolver, async () => {
  const doc = docOf({
    start: START,
    end: START + 4 * HOUR,
    employees: people(2),
    missions: [{ id: 'm1', name: 'Patrol', type: 'remote', count: 1 }],
  });
  const { accepted } = await solve(doc);
  assert.ok(accepted);
  const total = accepted.diagnostics.turnsTaken.reduce((sum, n) => sum + n, 0);
  assert.equal(total, 1, 'held end to end by one set of people, charged once');
});

test('hours are never consulted: a long remote hold does not buy a break from the queue', skipWithoutSolver, async () => {
  // e1 holds a twelve-hour remote mission; e2 and e3 take hourly slots
  // elsewhere. Under equal-hours fairness e1 would be excluded from everything
  // for the rest of the window. Under round robin the only thing that matters
  // is that e1 is busy, which the single-assignment matrix already says.
  const doc = docOf({
    start: START,
    end: START + 4 * HOUR,
    employees: people(3),
    missions: [
      { id: 'm1', name: 'Patrol', type: 'remote', count: 1 },
      { id: 'm2', name: 'Gate', type: 'local', count: 1 },
    ],
  });
  const { accepted, index } = await solve(doc);
  assert.ok(accepted);
  const segments = index.segments.length;
  const patrol = index.missionIds.indexOf('m1') + 1;
  const holder = index.employeeIds.findIndex(
    (_, e) => accepted.assignment[e * segments] === patrol,
  );
  assert.ok(holder >= 0);
  for (let s = 0; s < segments; s++) {
    assert.equal(accepted.assignment[holder * segments + s], patrol, 'held end to end');
  }
  // And nobody is double-booked, which is a property of the representation
  // rather than of a constraint anyone had to write.
  assert.equal(accepted.quantities.unfilledSeatMinutes, 0);
});
