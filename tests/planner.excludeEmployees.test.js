import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, isExcluded } from '../src/lib/planner.js';
import { planSchema, toPlannerInput } from '../src/lib/planSchema.js';
import { encodePlan, decodePlan } from '../src/lib/urlState.js';

/**
 * ADR 014, first half: a mission can keep a named person off it.
 *
 * A qualification exclusion cannot say "not him, here", and minting a tag to
 * name one individual pollutes the same list that drives required coverage and
 * night rest. So this is its own field, with the same semantics the tag version
 * already has - a hard filter on automatic assignment that a pin overrides
 * visibly.
 */

const HOUR = 60 * 60 * 1000;
const BASE = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();

const doc = (over = {}) => planSchema.parse({
  start: BASE, end: BASE + 4 * HOUR, shiftMinutes: 60, strategy: 'balanced',
  employees: [
    { id: 'e1', name: 'דנה' },
    { id: 'e2', name: 'יוסי' },
    { id: 'e3', name: 'מיכל' },
  ],
  missions: [{ id: 'm1', name: 'שער', type: 'local', count: 1 }],
  pins: [], tags: [],
  ...over,
});

const run = (d) => plan({ ...toPlannerInput(d), onInvariantViolation: 'report' });
const whoWorked = (result) => new Set(result.shifts.map((s) => s.employeeId));

test('an excluded person is never assigned automatically', () => {
  const d = doc({
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 1, excludeEmployees: ['e1'] }],
  });
  assert.ok(!whoWorked(run(d)).has('e1'), 'דנה is excluded from this mission');
});

test('excluding one person does not exclude the others', () => {
  const d = doc({
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 1, excludeEmployees: ['e1'] }],
  });
  const worked = whoWorked(run(d));
  assert.ok(worked.has('e2') || worked.has('e3'), 'somebody still stands the post');
});

test('the mission is reported short rather than staffed by an excluded person', () => {
  // Everyone but one is excluded, and the mission needs two.
  const d = doc({
    missions: [{
      id: 'm1', name: 'שער', type: 'local', count: 2, excludeEmployees: ['e1', 'e2'],
    }],
  });
  const result = run(d);
  assert.ok(!whoWorked(result).has('e1'));
  assert.ok(!whoWorked(result).has('e2'));
  assert.ok(
    result.warnings.some((w) => w.code === 'understaffed'),
    'an honest shortage beats quietly ignoring the exclusion',
  );
});

test('a pin overrides an exclusion, visibly', () => {
  const d = doc({
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 1, excludeEmployees: ['e1'] }],
    pins: [{ missionId: 'm1', employeeId: 'e1', start: null, end: null }],
  });
  const result = run(d);
  assert.ok(whoWorked(result).has('e1'), 'a manual assignment is an input fact');
  assert.ok(
    result.warnings.some((w) => w.code === 'pin-excluded-employee' && w.employeeId === 'e1'),
    'and the override is reported rather than silent',
  );
  assert.ok(
    !result.warnings.some((w) => w.code === 'engine-bug'),
    'a pinned override is not an invariant violation',
  );
});

test('exclusion works on remote missions too', () => {
  const d = doc({
    missions: [{
      id: 'm1', name: 'סיור', type: 'remote', count: 1, excludeEmployees: ['e1', 'e2'],
    }],
  });
  assert.deepEqual([...whoWorked(run(d))], ['e3']);
});

test('isExcluded covers both kinds and neither leaks into the other', () => {
  const person = { id: 'e1', tags: ['driver'] };
  assert.equal(isExcluded({ excludes: [], excludeEmployees: [] }, person), false);
  assert.equal(isExcluded({ excludes: ['driver'], excludeEmployees: [] }, person), true);
  assert.equal(isExcluded({ excludes: [], excludeEmployees: ['e1'] }, person), true);
  assert.equal(isExcluded({ excludes: ['medic'], excludeEmployees: ['e2'] }, person), false);
  assert.equal(isExcluded({}, person), false, 'a mission with neither field excludes nobody');
});

test('the field survives a URL round-trip', () => {
  const d = doc({
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 1, excludeEmployees: ['e1', 'e3'] }],
  });
  const back = decodePlan(encodePlan(d));
  assert.ok(back.ok);
  assert.deepEqual(back.plan.missions[0].excludeEmployees, ['e1', 'e3']);
});

test('a mission excluding nobody encodes to the bytes it always did', () => {
  // ADR 006: an appended position is written only when it carries a value, so
  // every link already shared keeps its exact string.
  const plain = doc();
  const explicitlyEmpty = doc({
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 1, excludeEmployees: [] }],
  });
  assert.equal(encodePlan(plain), encodePlan(explicitlyEmpty));
});
