import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/lib/planner.js';
import { planSchema, toPlannerInput } from '../src/lib/planSchema.js';

/**
 * ADR 016: nobody stands more than six unbroken hours if anyone else is free.
 *
 * Evening out total time on duty is *what produces* an unbroken run - whoever
 * is behind has the fewest minutes, so they are the cheapest candidate for the
 * next slot and the one after that. Before this, where somebody joined a period
 * part-way through, half of those plans put a guard on post for a day or more,
 * and the worst was the whole seventy-two hour window.
 */

const HOUR = 60 * 60 * 1000;
const BASE = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();

const doc = (over = {}) => planSchema.parse({
  start: BASE, end: BASE + 24 * HOUR, shiftMinutes: 60, strategy: 'balanced',
  employees: [], missions: [], pins: [], tags: [],
  ...over,
});

const run = (d) => plan({ ...toPlannerInput(d), onInvariantViolation: 'report' });

/** The longest stretch anyone stands with no gap between consecutive rows. */
function longestRun(result) {
  const byPerson = new Map();
  for (const s of result.shifts) {
    if (!byPerson.has(s.employeeId)) byPerson.set(s.employeeId, []);
    byPerson.get(s.employeeId).push(s);
  }
  let worst = 0;
  for (const own of byPerson.values()) {
    own.sort((a, b) => a.start - b.start);
    let stretch = 0;
    let prevEnd = null;
    for (const s of own) {
      stretch = prevEnd === s.start ? stretch + (s.end - s.start) : s.end - s.start;
      prevEnd = s.end;
      if (stretch > worst) worst = stretch;
    }
  }
  return worst / HOUR;
}

const guards = (n, over = () => ({})) => Array.from({ length: n }, (_, i) => ({
  id: `e${i}`, name: `שומר ${i}`, ...over(i),
}));

test('somebody who joins part-way through is not made to work it all off', () => {
  // The reported shape: five seats, eight guards, one arriving a day late. The
  // latecomer has no minutes, so before ADR 016 the fairness key handed them
  // every slot until they were level - twenty-four hours without a break.
  const d = doc({
    end: BASE + 48 * HOUR,
    employees: guards(8, (i) => (i === 7 ? { start: BASE + 24 * HOUR } : {})),
    missions: [
      { id: 'gate', name: 'שער', type: 'local', count: 3 },
      { id: 'patrol', name: 'סיור', type: 'local', count: 2 },
    ],
  });
  assert.ok(longestRun(run(d)) <= 6, 'nobody stands more than six hours');
});

test('a saturated roster is still fully staffed', () => {
  // The tier is a preference, never a refusal. Five guards against five seats
  // means everyone works every slot and there is nobody to hand over to;
  // leaving a post empty to protect somebody's rest would be the worse failure
  // by a distance.
  const d = doc({
    employees: guards(5),
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 5 }],
  });
  const result = run(d);
  assert.equal(
    result.warnings.filter((w) => w.code === 'understaffed').length, 0,
    'every seat is filled',
  );
  assert.equal(longestRun(result), 24, 'even though it means a full day each');
  assert.ok(
    result.warnings.filter((w) => w.code === 'long-unbroken-run').length > 0,
    'and the engine says so, which is the right answer to a roster this thin',
  );
});

test('an ordinary rota is untouched', () => {
  // Two thirds of plans never reach three hours in a stretch, and this tier
  // must be invisible in all of them - it is why six hours was chosen over
  // three, and why no golden fixture moved.
  const d = doc({
    employees: guards(6),
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 2 }],
  });
  const result = run(d);
  assert.ok(longestRun(result) < 3, 'nowhere near the threshold');
  const hours = result.stats.perEmployee.map((p) => p.minutes / 60);
  assert.ok(Math.max(...hours) - Math.min(...hours) <= 1, 'and still evenly shared');
});

test('a pinned stretch counts towards the run', () => {
  // `occupy` tracks the stretch, so a person mid-run is mid-run however they
  // got there. Somebody manually placed on six hours is not then handed a
  // seventh by the fairness key.
  const pinEnd = BASE + 6 * HOUR;
  const d = doc({
    employees: guards(4),
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 1 }],
    pins: [{ missionId: 'm1', employeeId: 'e0', start: BASE, end: pinEnd }],
  });
  const result = run(d);
  const seventh = result.shifts.find((s) => s.start === pinEnd);
  assert.ok(seventh, 'the seventh hour is staffed');
  assert.notEqual(seventh.employeeId, 'e0', 'by somebody other than the person already on six');
});
