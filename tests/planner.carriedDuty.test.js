import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/lib/planner.js';
import { planSchema, toPlannerInput } from '../src/lib/planSchema.js';
import { encodePlan, decodePlan } from '../src/lib/urlState.js';
import { clearStalePins } from '../src/lib/pins.js';

/**
 * ADR 015: duty already stood is an input to fairness.
 *
 * The rota is planned 72 hours at a time and rolled forward, and the engine
 * evens out the window it is given - so without this, an hour stops counting
 * the moment it falls behind the window, and a guard who came back from leave
 * stays permanently behind while the app reports a perfectly even spread.
 *
 * The last two tests are the ones that matter most. Both pin a way this feature
 * was actively dangerous before it was measured, and both would look like
 * over-testing to anyone who had not seen the numbers.
 */

const HOUR = 60 * 60 * 1000;
const BASE = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();

const doc = (over = {}) => planSchema.parse({
  start: BASE, end: BASE + 4 * HOUR, shiftMinutes: 60, strategy: 'balanced',
  employees: [{ id: 'e1', name: 'דנה' }, { id: 'e2', name: 'יוסי' }],
  missions: [{ id: 'm1', name: 'שער', type: 'local', count: 1 }],
  pins: [], tags: [],
  ...over,
});

const run = (d, now) => plan({ ...toPlannerInput(d, now), onInvariantViolation: 'report' });

/** Four guards who have each stood five hundred hours already. */
const VETERANS = [['e1', 'אבי'], ['e2', 'בני'], ['e3', 'גדי'], ['e4', 'דני']]
  .map(([id, name]) => ({ id, name, carriedMinutes: 30000 }));
const minutesOf = (result, id) => result.shifts
  .filter((s) => s.employeeId === id)
  .reduce((n, s) => n + (s.end - s.start), 0) / 60000;

test('a guard who has already stood duty is scheduled less', () => {
  const even = run(doc());
  assert.equal(minutesOf(even, 'e1'), minutesOf(even, 'e2'), 'the fixture is symmetrical');

  // Two hours of the four-hour window are enough to repay two hours of debt.
  const behind = run(doc({
    employees: [
      { id: 'e1', name: 'דנה', carriedMinutes: 120 },
      { id: 'e2', name: 'יוסי' },
    ],
  }));
  assert.ok(
    minutesOf(behind, 'e2') > minutesOf(behind, 'e1'),
    'the one who has stood less takes more of what is left',
  );
});

test('carried duty narrows the total gap while widening the window gap', () => {
  const result = run(doc({
    end: BASE + 6 * HOUR,
    employees: [
      { id: 'e1', name: 'דנה', carriedMinutes: 180 },
      { id: 'e2', name: 'יוסי' },
    ],
  }));
  // Deliberately not asserting the totals become *equal*. The engine fills one
  // slot at a time and never revisits a placement (ADR 008's defect 3), so it
  // narrows a debt rather than settling it exactly - and six hourly seats
  // cannot repay three hours and stay even anyway.
  const gap = Math.abs((minutesOf(result, 'e1') + 180) - minutesOf(result, 'e2'));
  assert.ok(gap < 180, `the three-hour gap narrows, to ${gap} minutes`);
  assert.ok(
    minutesOf(result, 'e2') > minutesOf(result, 'e1'),
    'and the window itself is deliberately unbalanced to do it',
  );
});

test('a document that carries nothing plans exactly as it always did', () => {
  // Every link written before the field existed decodes to zero, so this is the
  // compatibility statement, not a coincidence.
  const before = run(doc());
  const explicit = run(doc({
    employees: [
      { id: 'e1', name: 'דנה', carriedMinutes: 0, carriedStints: 0 },
      { id: 'e2', name: 'יוסי', carriedMinutes: 0, carriedStints: 0 },
    ],
  }));
  assert.deepEqual(explicit.shifts, before.shifts);
});

test('a guard carrying nothing encodes to the bytes they always did', () => {
  const plain = doc();
  const zeroed = doc({
    employees: [
      { id: 'e1', name: 'דנה', carriedMinutes: 0, carriedStints: 0 },
      { id: 'e2', name: 'יוסי', carriedMinutes: 0 },
    ],
  });
  assert.equal(encodePlan(plain), encodePlan(zeroed));
});

test('carried duty survives a URL round-trip', () => {
  const d = doc({
    employees: [
      { id: 'e1', name: 'דנה', carriedMinutes: 420, carriedStints: 7 },
      { id: 'e2', name: 'יוסי' },
    ],
  });
  const back = decodePlan(encodePlan(d));
  assert.ok(back.ok);
  assert.equal(back.plan.employees[0].carriedMinutes, 420);
  assert.equal(back.plan.employees[0].carriedStints, 7);
  assert.equal(back.plan.employees[1].carriedMinutes, 0);
});

test('duty outside the period counts before anyone presses the button', () => {
  // The point of reading both sources. If only `carriedMinutes` counted, the
  // fairness rule would depend on somebody having tidied up first.
  const past = { start: BASE - 10 * HOUR, end: BASE - 6 * HOUR };
  const d = doc({
    missions: [
      { id: 'm1', name: 'שער', type: 'local', count: 1 },
      { id: 'old', name: 'ישן', type: 'local', ...past, count: 1 },
    ],
    pins: [{ missionId: 'old', employeeId: 'e1', ...past, frozen: true }],
  });
  const result = run(d);
  assert.ok(
    result.warnings.some((w) => w.code === 'pin-out-of-period'),
    'the pin really is outside the period',
  );
  assert.ok(
    minutesOf(result, 'e2') > minutesOf(result, 'e1'),
    'and those four hours still count against דנה',
  );
});

test('clearing residue moves the number without moving a shift', () => {
  // The button's safety argument, and the reason the engine reads both sources
  // rather than only the document field: pressing a cleanup must not change the
  // schedule, in either direction.
  const past = { start: BASE - 10 * HOUR, end: BASE - 6 * HOUR };
  const d = doc({
    missions: [
      { id: 'm1', name: 'שער', type: 'local', count: 1 },
      { id: 'old', name: 'ישן', type: 'local', ...past, count: 1 },
    ],
    pins: [{ missionId: 'old', employeeId: 'e1', ...past, frozen: true }],
  });
  const cleared = clearStalePins(d);
  assert.equal(cleared.pins.length, 0, 'the residue is gone');
  assert.equal(
    cleared.employees.find((e) => e.id === 'e1').carriedMinutes, 240,
    'and its four hours are now carried on the person',
  );
  assert.deepEqual(run(cleared).shifts, run(d).shifts, 'the schedule is untouched');
});

const danaRow = (stats) => stats.perEmployee.find((p) => p.employeeId === 'e1');

test('the summary reports carried duty the engine counts, before and after clearing', () => {
  // The schedule never moved when the residue was cleared, but the summary did:
  // it read only the document field, so four hours the engine was already
  // counting against דנה appeared in the table only after the button.
  const past = { start: BASE - 10 * HOUR, end: BASE - 6 * HOUR };
  const d = doc({
    missions: [
      { id: 'm1', name: 'שער', type: 'local', count: 1 },
      { id: 'old', name: 'ישן', type: 'local', ...past, count: 1 },
    ],
    pins: [{ missionId: 'old', employeeId: 'e1', ...past, frozen: true }],
  });
  const before = run(d).stats, after = run(clearStalePins(d)).stats;
  assert.equal(danaRow(before).carriedMinutes, 240, 'the pin is counted while it is still a pin');
  assert.equal(danaRow(before).carriedMinutes, danaRow(after).carriedMinutes);
  assert.equal(danaRow(before).totalStints, danaRow(after).totalStints);
  assert.equal(before.totalSpreadMinutes, after.totalSpreadMinutes);
});

test('an assignment beyond the period is a plan, not duty already stood', () => {
  // Out of period on the far side. Counting it as carried duty sent דנה to the
  // back of this window's queue for a shift she has not worked yet.
  const later = { start: BASE + 10 * HOUR, end: BASE + 14 * HOUR };
  const d = doc({
    missions: [
      { id: 'm1', name: 'שער', type: 'local', count: 1 },
      { id: 'next', name: 'הבא', type: 'local', ...later, count: 1 },
    ],
    pins: [{ missionId: 'next', employeeId: 'e1', ...later }],
  });
  const result = run(d);
  assert.ok(result.warnings.some((w) => w.code === 'pin-out-of-period' && w.elapsed === 0));
  assert.equal(minutesOf(result, 'e1'), minutesOf(result, 'e2'), 'the window is shared evenly');
  assert.equal(result.stats.perEmployee.find((p) => p.employeeId === 'e1').carriedMinutes, undefined);
});

test('a newcomer is not handed every hour there is', () => {
  // A guard joining a roster where everyone else has stood five hundred hours
  // is five hundred hours behind, and `balanced` picks the fewest minutes for
  // every slot. Before debts were measured against the least-worked person
  // rather than in absolute hours, the newcomer stood 72 of a 72-hour window
  // without a break while the rest did 18 each.
  const HOURS = 72;
  const d = doc({
    end: BASE + HOURS * HOUR,
    employees: [
      ...VETERANS,
      { id: 'e5', name: 'חדש' },
    ],
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 2 }],
  });
  const result = run(d);
  const worked = (id) => minutesOf(result, id) / 60;
  const everyone = ['e1', 'e2', 'e3', 'e4', 'e5'].map(worked);
  const spread = Math.max(...everyone) - Math.min(...everyone);
  // Not asserting they come out level. The newcomer *is* behind and takes a
  // little more, which is the feature working; what must not happen is the
  // window tilting wholesale onto one person. Unclamped this reads 62h against
  // everyone else's 20h, and before debts were normalized at all, 72h.
  assert.ok(spread <= 8, `the window is not tilted onto one person, spread was ${spread}h`);
  assert.ok(worked('e5') < HOURS / 2, 'and the newcomer is not on post for most of the window');
});

test('a debt cannot buy a long unbroken run', () => {
  // Repayment and unbroken duty are the same quantity under a greedy
  // minutes-first rule, so the debt one window may repay is clamped to two
  // shift slots - the engine's own bar, since `invariants.js` calls three
  // consecutive slots a `long-unbroken-run`. Unclamped, a 36-hour gap bought
  // seventy-two unbroken hours.
  const d = doc({
    end: BASE + 24 * HOUR,
    employees: [
      { id: 'e1', name: 'דנה', carriedMinutes: 36 * 60 },
      { id: 'e2', name: 'יוסי' }, { id: 'e3', name: 'מיכל' }, { id: 'e4', name: 'אבי' },
    ],
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 1 }],
  });
  // דנה is owed 36 hours and the window is 24, so an unclamped debt would give
  // her all of it in one stretch.
  const own = run(d).shifts
    .filter((s) => s.employeeId === 'e1')
    .sort((a, b) => a.start - b.start);
  let longest = 0;
  let stretch = 0;
  let prevEnd = null;
  for (const s of own) {
    stretch = prevEnd === s.start ? stretch + (s.end - s.start) : s.end - s.start;
    prevEnd = s.end;
    longest = Math.max(longest, stretch);
  }
  assert.ok(longest / HOUR <= 6, `longest unbroken stretch was ${longest / HOUR}h`);
});

test('rotation carries turns, not hours, and only where rest ties', () => {
  // `rotation` ranks rest first and turns second, and that order is load
  // bearing (ADR 002) - so carried turns decide exactly where the rest key
  // ties, which is the case the ring exists for: more seats in a slot than
  // there are rested people.
  const d = doc({
    strategy: 'rotation',
    end: BASE + 1 * HOUR,
    employees: [
      { id: 'e1', name: 'דנה', carriedStints: 5 },
      { id: 'e2', name: 'יוסי' },
      { id: 'e3', name: 'מיכל' },
      { id: 'e4', name: 'אבי' },
    ],
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 3 }],
  });
  const worked = new Set(run(d).shifts.map((s) => s.employeeId));
  assert.equal(worked.size, 3, 'three of the four stand the hour');
  assert.ok(!worked.has('e1'), 'and it is not the one five turns ahead');
});
