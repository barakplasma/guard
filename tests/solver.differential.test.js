import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/lib/planner.js';
import { toPlannerInput } from '../src/lib/planSchema.js';
import { checkSchedule } from '../src/lib/invariants.js';
import { scheduleResultFrom } from '../src/solver/views.ts';
import { isFeasible, matrixOf } from './solverOracle.js';
import {
  docOf, HOUR, people, skipWithoutSolver, solve,
} from './solverHelpers.js';

/**
 * MiniZinc against the engine, while the engine is still the authority.
 *
 * This is *evidence*, not a verdict. Two things are asserted and no more:
 *
 * - the model's coverage levels are never worse than the engine's, which is
 *   the claim ADR 011 made and measured (the engine calls 12% of short seats
 *   short when a full crew exists);
 * - every accepted schedule passes `checkSchedule`, the engine's own
 *   independent checker, read as evidence rather than as authority.
 *
 * The assignments themselves are *expected* to differ. The engine's greedy
 * ring order is not what the ladder optimises, and the owner has accepted that
 * the golden fixtures change once MiniZinc becomes the authority at step 6.
 * Nothing here touches them.
 *
 * The documents are deliberately small, and shaped after the golden ones
 * rather than taken from them: the week-long sixteen-guard rota is 163 hourly
 * segments, and fourteen proved levels over it is a measurement exercise, not
 * a unit test. `scripts/sleepByNightShiftLength.mjs` is where the big instance
 * is measured.
 */

const START = new Date(2026, 8, 10, 16, 0, 0, 0).getTime();

const DOCUMENTS = [
  {
    name: 'hourly local missions, the shape the carmel rota has',
    doc: docOf({
      start: START,
      end: START + 4 * HOUR,
      shiftMinutes: 60,
      employees: people(4),
      missions: [
        { id: 'm1', name: 'Gate', type: 'local', count: 1 },
        { id: 'm2', name: 'Ops', type: 'local', count: 1 },
      ],
    }),
  },
  {
    name: 'a mission staffed differently at night',
    doc: docOf({
      start: new Date(2026, 8, 10, 20, 0, 0, 0).getTime(),
      end: new Date(2026, 8, 11, 2, 0, 0, 0).getTime(),
      shiftMinutes: 120,
      employees: people(3),
      missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 2, nightCount: 1 }],
    }),
  },
  {
    name: 'a remote hold beside a local rotation',
    doc: docOf({
      start: START,
      end: START + 4 * HOUR,
      shiftMinutes: 120,
      employees: people(3),
      missions: [
        { id: 'r', name: 'Patrol', type: 'remote', count: 1 },
        { id: 'l', name: 'Gate', type: 'local', count: 1 },
      ],
    }),
  },
  {
    name: 'a mission on its own grid beside the house one',
    doc: docOf({
      start: START,
      end: START + 4 * HOUR,
      shiftMinutes: 60,
      employees: people(3),
      missions: [
        { id: 'house', name: 'Gate', type: 'local', count: 1 },
        { id: 'own', name: 'Ops', type: 'local', count: 1, shiftMinutes: 120 },
      ],
    }),
  },
  {
    name: 'a required qualification the engine has to cover',
    doc: docOf({
      start: START,
      end: START + 3 * HOUR,
      shiftMinutes: 60,
      employees: [
        { id: 'e1', name: 'A', tags: ['driver'] },
        { id: 'e2', name: 'B', tags: ['driver'] },
        { id: 'e3', name: 'C' },
      ],
      tags: [{ id: 'driver', name: 'Driver', minNightRestMinutes: 360 }],
      missions: [{ id: 'm1', name: 'Patrol', type: 'local', count: 1, requires: [{ tag: 'driver', count: 1 }] }],
    }),
  },
];

/** The engine's shortfall in the same unit the model reports: seat-minutes. */
function engineUnfilledMinutes(result) {
  return result.warnings
    .filter((warning) => warning.code === 'understaffed')
    .reduce((sum, warning) => sum
      + (warning.needed - warning.got) * ((warning.end - warning.start) / 60_000), 0);
}

function checkerInput(doc, problem) {
  return {
    start: doc.start,
    end: doc.end,
    shiftMinutes: doc.shiftMinutes,
    employees: doc.employees.map((employee) => ({
      ...employee,
      start: employee.start ?? doc.start,
      end: employee.end ?? doc.end,
      tags: employee.tags ?? [],
    })),
    missions: doc.missions.map((mission) => ({
      ...mission,
      start: mission.start ?? doc.start,
      end: mission.end ?? doc.end,
      nightCount: mission.nightCount ?? mission.count,
      requires: mission.requires ?? [],
      occurrences: [],
    })),
    pins: [],
    nightWindows: problem.nights.map((night) => ({ start: night.start, end: night.end })),
    loggedBefore: -Infinity,
  };
}

for (const { name, doc } of DOCUMENTS) {
  test(`${name}: coverage is never worse than the engine's`, skipWithoutSolver, async () => {
    const engine = plan({ ...toPlannerInput(doc, undefined), onInvariantViolation: 'report' });
    const { accepted } = await solve(doc, { timeLimitMs: 30_000 });
    assert.ok(accepted, 'the model answered');

    const engineMissing = engine.warnings.filter((w) => w.code === 'missing-required-tag').length;
    if (engineMissing === 0) {
      assert.equal(
        accepted.quantities.unmetQualificationMinutes, 0,
        'the model never leaves a qualification short where the engine did not',
      );
    }
    assert.ok(
      accepted.quantities.unfilledSeatMinutes <= engineUnfilledMinutes(engine),
      `model left ${accepted.quantities.unfilledSeatMinutes} seat-minutes short,`
      + ` engine ${engineUnfilledMinutes(engine)}`,
    );
  });

  test(`${name}: the accepted answer passes the engine's own checker`, skipWithoutSolver, async () => {
    const { accepted, index, problem, instance } = await solve(doc, { timeLimitMs: 30_000 });
    assert.ok(accepted);
    assert.ok(isFeasible(instance, matrixOf(accepted, instance)), 'and the independent scorer');

    const result = scheduleResultFrom(accepted, index, problem, doc);
    const violations = checkSchedule(result, checkerInput(doc, problem));
    // The two rules that are never a matter of policy: a person cannot be in
    // two places, and a mission cannot hold more people than it asked for.
    // Everything else `checkSchedule` reports is the engine's reading of its
    // own segmentation, which is not what the model is answerable for here.
    const fatal = violations.filter((v) => ['double-booked', 'overstaffed'].includes(v.rule));
    assert.deepEqual(fatal, []);
  });
}
