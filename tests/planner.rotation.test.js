import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/lib/planner.js';
import { mergedRuns } from '../src/lib/strategies.js';

const HOUR = 3600 * 1000;

function localTime(y, m, d, h = 0, min = 0) {
  return new Date(y, m, d, h, min, 0, 0).getTime();
}

const START = localTime(2026, 0, 5, 8, 0);

/** Ring order is document order, so name them for their place in it. */
const ring = (n) => Array.from({ length: n }, (_, i) => ({
  id: `e${i + 1}`,
  name: `Emp${String(i + 1).padStart(2, '0')}`,
}));

/** Every recorded rest gap, so two strategies can be compared on the worst one. */
const gaps = (r) => r.stats.perEmployee.map((p) => p.minGapMinutes).filter((g) => g != null);

/** Auto-assigned rows for one mission, in clock order, as employee ids. */
function order(result, missionId = 'l') {
  return result.shifts
    .filter((s) => s.missionId === missionId && !s.pinned)
    .sort((a, b) => a.start - b.start)
    .map((s) => s.employeeId);
}

const rotate = (extra) => plan({
  start: START,
  end: START + 8 * HOUR,
  shiftMinutes: 60,
  strategy: 'rotation',
  employees: ring(4),
  missions: [{ id: 'l', name: 'Local', type: 'local', start: START, end: START + 8 * HOUR, count: 1 }],
  ...extra,
});

/* ------------------------------------------------------------------ */

test('turns go round the ring, in list order, and wrap', () => {
  assert.deepEqual(
    order(rotate()),
    ['e1', 'e2', 'e3', 'e4', 'e1', 'e2', 'e3', 'e4'],
  );
});

test('hours are deliberately not balanced: a long remote mission costs one turn', () => {
  // e1 holds a six-hour remote mission - six times anyone else's time on duty,
  // but one single turn.
  const result = plan({
    start: START,
    end: START + 10 * HOUR,
    shiftMinutes: 60,
    strategy: 'rotation',
    employees: ring(4),
    missions: [
      { id: 'r', name: 'Remote', type: 'remote', start: START, end: START + 6 * HOUR, count: 1 },
      { id: 'l', name: 'Local', type: 'local', start: START, end: START + 10 * HOUR, count: 1 },
    ],
    pins: [{ missionId: 'r', employeeId: 'e1' }],
  });

  const byId = new Map(result.stats.perEmployee.map((p) => [p.employeeId, p]));
  assert.equal(byId.get('e1').stints, 2, 'six hours on the remote mission is one turn');
  assert.equal(byId.get('e1').minutes, 7 * 60);

  // Coming off at 14:00, e1 is the least rested person alive, so the 14:00 slot
  // goes to whoever has been off longest - not straight back to them.
  const slots = order(result);
  assert.deepEqual(slots.slice(0, 8), ['e2', 'e3', 'e4', 'e2', 'e3', 'e4', 'e2', 'e3']);
  assert.equal(slots[8], 'e1', 'and they rejoin the ring once they have rested');

  // The point of the strategy: turns are even, hours are not, and that is not
  // a bug to be fixed by looking at the spread figure.
  assert.equal(result.stats.spreadMinutes, 4 * 60);
});

test('somebody unavailable for their turn keeps their place in the ring', () => {
  const employees = ring(4);
  // e2 arrives an hour late, so their first turn - slot 2 - passes to e3.
  employees[1].start = START + 2 * HOUR;

  // e2 takes the very next slot they can cover rather than waiting a full lap.
  assert.deepEqual(
    order(rotate({ employees })),
    ['e1', 'e3', 'e2', 'e4', 'e1', 'e3', 'e2', 'e4'],
  );
});

test('a by-name assignment moves only that person', () => {
  // e3 is named for slot 5 (13:00). Everyone else keeps their place.
  const result = rotate({
    pins: [{
      missionId: 'l',
      employeeId: 'e3',
      start: START + 5 * HOUR,
      end: START + 6 * HOUR,
    }],
  });

  const all = result.shifts
    .sort((a, b) => a.start - b.start)
    .map((s) => s.employeeId);
  assert.deepEqual(all, ['e1', 'e2', 'e3', 'e4', 'e1', 'e3', 'e2', 'e4']);

  // The lap before the pin is untouched, and e3's own next turn is the one
  // that moved - they drop behind e2 and e4, who had not yet had their second.
  assert.equal(all.slice(0, 4).join(), 'e1,e2,e3,e4');
});

test('a pin late in the day does not disturb the morning', () => {
  // The engine places pins before it fills any slot, so a running "who went
  // last" counter would push e4 to the back of the ring at 08:00 for a shift
  // they do not work until 15:00. Turns are counted as of each slot instead.
  const pinned = rotate({
    pins: [{
      missionId: 'l',
      employeeId: 'e4',
      start: START + 7 * HOUR,
      end: START + 8 * HOUR,
    }],
  });
  assert.deepEqual(order(pinned).slice(0, 4), ['e1', 'e2', 'e3', 'e4']);
});

test('the ring is shared across concurrent local missions', () => {
  const result = plan({
    start: START,
    end: START + 3 * HOUR,
    shiftMinutes: 60,
    strategy: 'rotation',
    employees: ring(6),
    missions: [
      { id: 'a', name: 'A', type: 'local', start: START, end: START + 3 * HOUR, count: 1 },
      { id: 'b', name: 'B', type: 'local', start: START, end: START + 3 * HOUR, count: 1 },
    ],
  });

  // Six people, six slots: serving either mission takes your turn, so
  // everybody works exactly once and nobody works twice.
  const worked = result.shifts.map((s) => s.employeeId).sort();
  assert.deepEqual(worked, ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  for (const p of result.stats.perEmployee) assert.equal(p.stints, 1);
});

test('an unrelated availability edge does not cost a guard two turns', () => {
  // e4 is available only from 10:00, which puts a boundary at 10:00 on every
  // mission's grid. e1's 09:00-11:00 stint is split in two by it; counting
  // rows rather than merged runs would charge them for two turns and send
  // them to the back of a four-person ring a lap early.
  const employees = ring(4);
  employees[3].start = START + 2 * HOUR;

  const result = plan({
    start: START,
    end: START + 4 * HOUR,
    shiftMinutes: 120,
    strategy: 'rotation',
    employees,
    missions: [{ id: 'l', name: 'Local', type: 'local', start: START, end: START + 4 * HOUR, count: 1 }],
  });

  const stints = new Map(result.stats.perEmployee.map((p) => [p.employeeId, p.stints]));
  assert.equal(stints.get('e1'), 1, 'one continuous stint, not two');
});

test('the result does not depend on the order pins were written in', () => {
  const a = { missionId: 'l', employeeId: 'e2', start: START + 3 * HOUR, end: START + 4 * HOUR };
  const b = { missionId: 'l', employeeId: 'e4', start: START + 6 * HOUR, end: START + 7 * HOUR };
  assert.deepEqual(
    JSON.parse(JSON.stringify(rotate({ pins: [a, b] }).shifts)),
    JSON.parse(JSON.stringify(rotate({ pins: [b, a] }).shifts)),
  );
});

test('omitting the strategy is byte-identical to asking for the old one', () => {
  const input = {
    start: START,
    end: START + 8 * HOUR,
    shiftMinutes: 60,
    employees: ring(4),
    missions: [{ id: 'l', name: 'Local', type: 'local', start: START, end: START + 8 * HOUR, count: 1 }],
  };
  assert.equal(
    JSON.stringify(plan(input)),
    JSON.stringify(plan({ ...input, strategy: 'balanced' })),
  );
});

test('an unknown strategy name falls back to the default instead of throwing', () => {
  const input = {
    start: START,
    end: START + 4 * HOUR,
    shiftMinutes: 60,
    employees: ring(3),
    missions: [{ id: 'l', name: 'Local', type: 'local', start: START, end: START + 4 * HOUR, count: 1 }],
  };
  assert.equal(
    JSON.stringify(plan({ ...input, strategy: 'from-a-newer-build' })),
    JSON.stringify(plan(input)),
  );
});

test('mergedRuns joins touching and overlapping intervals, and sorts', () => {
  assert.deepEqual(
    mergedRuns([{ start: 30, end: 40 }, { start: 0, end: 10 }, { start: 10, end: 20 }]),
    [{ start: 0, end: 20 }, { start: 30, end: 40 }],
  );
  assert.deepEqual(mergedRuns([]), []);
});

test('a lopsided frozen past does not let a fresh guard double up', () => {
  // The shape of a real report. The frozen block is uneven: e1, e2 and e3 each
  // worked it twice, e4 not at all, and e4 is then named by hand for 14:00.
  //
  // Balancing hours sees e4 as the least-worked person alive and hands them
  // 15:00 as well - a second turn immediately after their first - while e1,
  // who came off at 12:00, waits. Ranking on rest instead sends it to e1.
  const employees = ring(4);
  const END = START + 10 * HOUR;
  const frozen = [['e1', 0], ['e2', 1], ['e3', 2], ['e1', 3], ['e2', 4], ['e3', 5]]
    .map(([employeeId, h]) => ({
      missionId: 'l',
      employeeId,
      start: START + h * HOUR,
      end: START + (h + 1) * HOUR,
      frozen: true,
    }));

  const input = {
    start: START,
    end: END,
    shiftMinutes: 60,
    employees,
    missions: [{ id: 'l', name: 'Local', type: 'local', start: START, end: END, count: 1 }],
    pins: [
      ...frozen,
      { missionId: 'l', employeeId: 'e4', start: START + 6 * HOUR, end: START + 7 * HOUR },
    ],
  };

  const at = (r, h) => r.shifts.find((s) => s.start === START + h * HOUR).employeeId;

  const balanced = plan({ ...input, strategy: 'balanced' });
  assert.equal(at(balanced, 7), 'e4', 'fewest hours wins, so e4 goes straight back on');
  assert.equal(Math.min(...gaps(balanced)), 0, 'back to back, with no rest at all');

  const rotated = plan({ ...input, strategy: 'rotation' });
  assert.equal(at(rotated, 7), 'e1', 'longest rested goes next');
  assert.equal(at(rotated, 8), 'e2');
  assert.equal(at(rotated, 9), 'e3');

  const e4 = rotated.stats.perEmployee.find((p) => p.employeeId === 'e4');
  assert.equal(e4.stints, 1, 'e4 keeps the single turn they were named for');
  // 120 is the spacing baked into the frozen block itself; what matters is
  // that no fresh decision drags the worst gap below what it inherited.
  assert.equal(Math.min(...gaps(rotated)), 2 * 60);
  assert.ok(
    Math.min(...gaps(rotated)) > Math.min(...gaps(balanced)),
    'rotation leaves everyone better rested than balancing hours did',
  );
});
