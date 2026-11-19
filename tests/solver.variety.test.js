import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY, docOf, HOUR, loggedPin, people, skipWithoutSolver, solve,
} from './solverHelpers.js';

/**
 * The last three levels mix people up.
 *
 * Nobody should always do the same mission when they could rotate - drivers
 * should swap the morning and the night patrol - and night is much harder than
 * day, so the same person must not always hold 01:00 while somebody else only
 * ever holds 13:00. Three levels, in the order the owner's emphasis suggests:
 * 12 evens out night minutes over the memory, 13 charges a turn by how often
 * the log already shows that person on that mission, 14 charges a night
 * segment by how often the log shows them beginning at that hour.
 *
 * All three sit below coverage, rest and the round robin, so none of them can
 * leave a post short or call anybody back early. What they settle is the tie.
 */

const START = new Date(2026, 0, 12, 12, 0, 0, 0).getTime();

test('the driver the log shows on the night patrol takes the morning one', skipWithoutSolver, async () => {
  // Two patrols, two drivers, both equally rested and equally used. The only
  // thing separating them is what the log says they did last: level 13 charges
  // a turn by how often that person has already had that mission.
  const doc = docOf({
    start: START,
    end: START + HOUR,
    shiftMinutes: 60,
    employees: people(2),
    missions: [
      { id: 'morning', name: 'Morning patrol', type: 'local', count: 1 },
      { id: 'night', name: 'Night patrol', type: 'local', count: 1 },
    ],
    pins: [
      loggedPin({ missionId: 'night', employeeId: 'e1', start: START - 2 * DAY, end: START - 2 * DAY + HOUR }),
      loggedPin({ missionId: 'morning', employeeId: 'e2', start: START - 2 * DAY, end: START - 2 * DAY + HOUR }),
    ],
  });
  const { accepted, index } = await solve(doc);
  assert.ok(accepted);
  const segments = index.segments.length;
  const morning = index.missionIds.indexOf('morning') + 1;
  const nightPatrol = index.missionIds.indexOf('night') + 1;
  const e1 = index.employeeIds.indexOf('e1');
  const e2 = index.employeeIds.indexOf('e2');

  assert.equal(accepted.assignment[e1 * segments], morning, 'they swap');
  assert.equal(accepted.assignment[e2 * segments], nightPatrol);
  assert.equal(accepted.quantities.missionRepeatCost, 0);
});

test('night minutes even out over the memory, not only inside this window', skipWithoutSolver, async () => {
  // One night hour to hand out and two people. e1 already stood four night
  // hours this fortnight and e2 none; level 12 reads the log, so the hour is
  // e2's even though inside this window they are identical.
  const nightStart = new Date(2026, 0, 12, 23, 0, 0, 0).getTime();
  const doc = docOf({
    start: nightStart,
    end: nightStart + HOUR,
    shiftMinutes: 60,
    employees: people(2),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
    pins: Array.from({ length: 4 }, (_, i) => loggedPin({
      missionId: 'm1',
      employeeId: 'e1',
      start: nightStart - (i + 2) * DAY,
      end: nightStart - (i + 2) * DAY + HOUR,
    })),
  });
  const { accepted, index, problem } = await solve(doc);
  assert.ok(accepted);
  assert.equal(problem.employees[0].memory.nightMinutes, 240);
  assert.equal(problem.employees[1].memory.nightMinutes, 0);

  const e2 = index.employeeIds.indexOf('e2');
  assert.notEqual(accepted.assignment[e2 * index.segments.length], 0, 'the night hour went to the one who has stood fewer');
});

test('the person the log shows at 01:00 every night is not chosen for 01:00 again', skipWithoutSolver, async () => {
  // Level 14: standing a night segment costs the number of turns the log shows
  // that person beginning at that hour, so the 01:00 post moves around.
  const oneAm = new Date(2026, 0, 13, 1, 0, 0, 0).getTime();
  const doc = docOf({
    start: oneAm,
    end: oneAm + HOUR,
    shiftMinutes: 60,
    employees: people(2),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
    pins: [
      // Three 01:00 holds for e1 - but at 13:00 for e2, so the two carry the
      // same total night minutes and only the *hour* separates them.
      loggedPin({ missionId: 'm1', employeeId: 'e1', start: oneAm - 2 * DAY, end: oneAm - 2 * DAY + HOUR }),
      loggedPin({ missionId: 'm1', employeeId: 'e1', start: oneAm - 3 * DAY, end: oneAm - 3 * DAY + HOUR }),
      loggedPin({ missionId: 'm1', employeeId: 'e2', start: oneAm - 2 * DAY, end: oneAm - 2 * DAY + HOUR }),
      loggedPin({ missionId: 'm1', employeeId: 'e2', start: oneAm - 3 * DAY, end: oneAm - 3 * DAY + HOUR }),
    ],
  });
  // e2's holds are moved to 01:00 as well, then one of e1's is doubled, so the
  // log shows e1 at that hour more often than e2 while everything else ties.
  doc.pins.push(loggedPin({
    missionId: 'm1', employeeId: 'e1', start: oneAm - 4 * DAY, end: oneAm - 4 * DAY + HOUR,
  }));

  const { accepted, index, problem } = await solve(doc);
  assert.ok(accepted);
  assert.equal(problem.employees[0].memory.hourHolds[1], 3);
  assert.equal(problem.employees[1].memory.hourHolds[1], 2);

  const e2 = index.employeeIds.indexOf('e2');
  assert.notEqual(accepted.assignment[e2 * index.segments.length], 0, 'the 01:00 post moved');
  assert.equal(accepted.quantities.nightHourRepeatCost, 2);
});

test('variety never costs coverage: every seat is still filled', skipWithoutSolver, async () => {
  const doc = docOf({
    start: START,
    end: START + 2 * HOUR,
    shiftMinutes: 60,
    employees: people(2),
    missions: [
      { id: 'a', name: 'Gate', type: 'local', count: 1 },
      { id: 'b', name: 'Ops', type: 'local', count: 1 },
    ],
    pins: [
      loggedPin({ missionId: 'a', employeeId: 'e1', start: START - DAY, end: START - DAY + 5 * HOUR }),
      loggedPin({ missionId: 'b', employeeId: 'e2', start: START - DAY, end: START - DAY + 5 * HOUR }),
    ],
  });
  const { accepted } = await solve(doc);
  assert.ok(accepted);
  assert.equal(accepted.quantities.unfilledSeatMinutes, 0, 'four seat-hours, two people, all covered');
});
