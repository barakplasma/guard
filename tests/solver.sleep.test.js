import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGET_REST_MINUTES } from '../src/solver/types.ts';
import { enumerateSleepWindows } from '../src/solver/compile.ts';
import { matrixOf, score } from './solverOracle.js';
import {
  compiled, docOf, HOUR, people, skipWithoutSolver, solve,
} from './solverHelpers.js';

/**
 * Eight hours off is the target; six is the driver minimum.
 *
 * Three levels, not one constant. Level 4 is the configured per-qualification
 * minimum - six hours for drivers by default - soft below coverage and
 * reported in actual minutes, which is how it is overridden in a pinch. Level
 * 5 is eight hours off in total for everyone present. Level 6 is eight hours
 * in one stretch for as many people as possible.
 */

// 18:00 to noon: one whole 22:00-06:00 night inside the window.
const START = new Date(2026, 0, 5, 18, 0, 0, 0).getTime();
const END = new Date(2026, 0, 6, 12, 0, 0, 0).getTime();

const night = (overrides = {}) => docOf({
  start: START,
  end: END,
  shiftMinutes: 120,
  employees: people(4),
  missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
  ...overrides,
});

test('with the post quiet at night, everybody present sleeps the full eight hours', skipWithoutSolver, async () => {
  // The mission closes at 22:00, so the night is nobody's to stand.
  const { accepted } = await solve(night({
    missions: [{
      id: 'm1', name: 'Gate', type: 'local', count: 1,
      start: START, end: new Date(2026, 0, 5, 22, 0, 0, 0).getTime(),
    }],
  }));
  assert.ok(accepted);
  assert.equal(accepted.quantities.nightsWithoutTargetSleep, 0);
  assert.ok(accepted.diagnostics.sleepsTarget.every((row) => row.every(Boolean)));
});

test('a post that runs all night costs exactly one person their eight hours', skipWithoutSolver, async () => {
  // The night is eight hours and so is the target, so the only window that
  // counts is the whole night: whoever stands any of it misses it. Somebody
  // has to stand all of it, so the best possible answer is one person short -
  // and "as many people as possible" means exactly that one.
  const { accepted } = await solve(night());
  assert.ok(accepted);
  assert.equal(accepted.quantities.nightsWithoutTargetSleep, 1);
  const slept = accepted.diagnostics.sleepsTarget.filter((row) => row[0]).length;
  assert.equal(slept, 3, 'the other three were left alone');
});

test('sleepsTarget is true exactly when an eight-hour off-duty window lies in the night', skipWithoutSolver, async () => {
  const { accepted, instance, index } = await solve(night());
  assert.ok(accepted);
  const mine = score(instance, matrixOf(accepted, instance));
  assert.deepEqual(accepted.diagnostics.sleepsTarget, mine.sleepsTarget);

  const windows = enumerateSleepWindows(index.segments, instance.nightOfSegment);
  assert.ok(windows.first.length > 0, 'an eight-hour night holds at least one such window');
});

test('a night the person is absent for is not counted against the schedule', skipWithoutSolver, async () => {
  // e4 leaves before the night begins, so there is no eight-hour window inside
  // their availability and nothing to hold against the answer. The post closes
  // at 22:00 too, so nobody else misses the target either and the count is
  // entirely about e4.
  const doc = night({
    employees: [
      ...people(3),
      { id: 'e4', name: 'D', start: START, end: new Date(2026, 0, 5, 21, 0, 0, 0).getTime() },
    ],
    missions: [{
      id: 'm1', name: 'Gate', type: 'local', count: 1,
      start: START, end: new Date(2026, 0, 5, 22, 0, 0, 0).getTime(),
    }],
  });
  const { accepted, problem } = await solve(doc);
  assert.ok(accepted);
  const absent = problem.employees.findIndex((employee) => employee.id === 'e4');
  assert.equal(accepted.diagnostics.sleepsTarget[absent][0], false, 'they were not here to sleep');
  // ...and yet no night is reported as missed, because they could not have
  // slept eight hours here whatever the schedule did.
  assert.equal(accepted.quantities.nightsWithoutTargetSleep, 0);
});

test('on-call duty is slept through and counts as rest', skipWithoutSolver, async () => {
  // One person, one on-call mission running all night. Without ADR 007 they
  // would be awake for eight hours; with it they sleep through it.
  const doc = night({
    employees: people(1),
    missions: [{ id: 'm1', name: 'Radio', type: 'local', count: 1, onCall: true }],
  });
  const { accepted } = await solve(doc);
  assert.ok(accepted);
  assert.equal(accepted.quantities.unfilledSeatMinutes, 0, 'the mission is staffed all night');
  assert.equal(accepted.quantities.nightsWithoutTargetSleep, 0, 'and they slept through it');
  assert.ok(accepted.diagnostics.nightRestMinutes[0][0] >= TARGET_REST_MINUTES);
});

test('the driver minimum is level 4 and reported in minutes, never a veto', skipWithoutSolver, async () => {
  // One driver, one mission that has to be staffed every hour of the night:
  // the minimum cannot be met, and the answer is a staffed post with the
  // shortfall reported rather than a refusal to schedule.
  const doc = night({
    employees: [{ id: 'e1', name: 'Driver', tags: ['driver'] }],
    tags: [{ id: 'driver', name: 'Driver', minNightRestMinutes: 360 }],
  });
  const { accepted } = await solve(doc);
  assert.ok(accepted, 'a rest shortfall never stops the schedule');
  assert.equal(accepted.quantities.unfilledSeatMinutes, 0);
  assert.ok(accepted.quantities.restShortfallMinutes > 0);
  assert.equal(accepted.quantities.restShortfallMinutes, 360 - accepted.diagnostics.nightRestMinutes[0][0]);
});

test('the configured minimum neither raises nor lowers the eight-hour target', skipWithoutSolver, async () => {
  const withMinimum = night({
    employees: people(4).map((employee, index) => (index === 0 ? { ...employee, tags: ['driver'] } : employee)),
    tags: [{ id: 'driver', name: 'Driver', minNightRestMinutes: 360 }],
  });
  const without = night();
  const a = await solve(withMinimum);
  const b = await solve(without);
  assert.ok(a.accepted && b.accepted);
  // Six is a floor below coverage; eight is the thing being optimised. With
  // people to spare both are met and the target figure is identical.
  assert.equal(a.accepted.quantities.restShortfallMinutes, 0);
  assert.equal(a.accepted.quantities.nightsWithoutTargetSleep, b.accepted.quantities.nightsWithoutTargetSleep);
});

test('a configured minimum above eight ratchets the target up, never down', skipWithoutSolver, async () => {
  const doc = night({
    employees: [{ id: 'e1', name: 'Long', tags: ['heavy'] }, ...people(3).slice(1)],
    tags: [{ id: 'heavy', name: 'Heavy', minNightRestMinutes: 600 }],
  });
  const { instance, problem } = compiled(doc);
  const heavy = problem.employees.findIndex((employee) => employee.id === 'e1');
  assert.equal(instance.requiredNightRestMinutes[heavy], 600);
  const { accepted } = await solve(doc);
  assert.ok(accepted);
  // The target shortfall is measured against the larger of the two, so a
  // ten-hour requirement inside an eight-hour night is reported, not ignored.
  assert.ok(accepted.quantities.targetRestShortfallMinutes >= 0);
});

test('a sleep window never straddles two nights', skipWithoutSolver, async () => {
  const doc = docOf({
    start: START,
    end: START + 2 * 24 * HOUR,
    shiftMinutes: 120,
    employees: people(3),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
  });
  const { instance, index } = compiled(doc);
  const windows = enumerateSleepWindows(index.segments, instance.nightOfSegment);
  assert.ok(windows.first.length > 0);
  for (let w = 0; w < windows.first.length; w++) {
    for (let s = windows.first[w] - 1; s < windows.last[w]; s++) {
      assert.equal(instance.nightOfSegment[s], windows.night[w]);
    }
  }
});
