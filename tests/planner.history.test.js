import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/lib/planner.js';
import { toPlannerInput, planSchema, prunePins } from '../src/lib/planSchema.js';
import { acceptSchedule, captureHistory, freezeElapsedBeforeEdit } from '../src/lib/pins.js';

/**
 * The app's own path, spelled out: accept a schedule for `prev`, then freeze
 * elapsed rows out of *that* result. `freezeElapsedBeforeEdit` no longer solves
 * for itself, so every caller has to say which answer it is recording.
 */
const freezeBefore = (prev, next, now) => freezeElapsedBeforeEdit(prev, next, now, acceptSchedule(prev, now).result);


/**
 * ADR 009: elapsed time that already has a record is a record, not a slot to
 * fill. These pin the two halves of ADR 008's first defect, which
 * `scripts/historyDriftCheck.mjs` measures:
 *
 *   - raising a mission's headcount invented people into shifts that were over;
 *   - lowering it deleted people who genuinely stood post.
 *
 * Both came from applying today's `count` to time that has already happened.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BASE = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
const NOW = BASE + 3 * DAY; // three days into a seven-day rota

const doc = () => planSchema.parse({
  start: BASE, end: BASE + 7 * DAY, shiftMinutes: 60, strategy: 'rotation',
  employees: Array.from({ length: 8 }, (_, i) => ({ id: `e${i + 1}`, name: `שומר ${i + 1}` })),
  missions: [
    { id: 'm1', name: 'שער', type: 'local', count: 2 },
    { id: 'm2', name: 'סיור', type: 'local', count: 2 },
  ],
  pins: [], tags: [],
});

/** Exactly what PlanContext.setDoc does, with the clock held still. */
const setDoc = (previous, next) => planSchema.parse(
  prunePins(captureHistory(previous, freezeBefore(previous, next, NOW))),
);

/** Elapsed slot -> the set of people recorded on it. */
function pastRecord(document) {
  const out = new Map();
  for (const s of plan(toPlannerInput(document, NOW)).shifts) {
    if (s.end > NOW) continue;
    const key = `${s.missionId}|${s.start}|${s.end}`;
    if (!out.has(key)) out.set(key, new Set());
    out.get(key).add(s.employeeId);
  }
  return out;
}

function drift(before, after) {
  let erased = 0; let invented = 0;
  for (const [key, was] of before) {
    const is = after.get(key);
    if (!is) continue;
    for (const e of was) if (!is.has(e)) erased++;
    for (const e of is) if (!was.has(e)) invented++;
  }
  return { erased, invented };
}

/** The baseline has to be frozen first, or there is no record to protect. */
function frozenBaseline() {
  const original = doc();
  // A no-op edit, which is what any real edit does first: freeze, then apply.
  const frozen = setDoc(original, original);
  assert.ok(frozen.pins.length > 0, 'the freeze should have recorded elapsed shifts');
  return frozen;
}

test('raising a headcount does not invent people into shifts that are over', () => {
  const before = frozenBaseline();
  const baseline = pastRecord(before);

  const after = setDoc(before, {
    ...before,
    missions: before.missions.map((m) => (m.id === 'm1' ? { ...m, count: 3 } : m)),
  });

  const { invented, erased } = drift(baseline, pastRecord(after));
  assert.equal(invented, 0, 'nobody should be added to an elapsed shift');
  assert.equal(erased, 0, 'nobody should be removed from one either');
});

test('lowering a headcount does not delete people who stood post', () => {
  const before = frozenBaseline();
  const baseline = pastRecord(before);

  const after = setDoc(before, {
    ...before,
    missions: before.missions.map((m) => (m.id === 'm1' ? { ...m, count: 1 } : m)),
  });

  const { erased, invented } = drift(baseline, pastRecord(after));
  assert.equal(erased, 0, 'an elapsed shift keeps everyone it recorded');
  assert.equal(invented, 0);
});

test('the future still follows the new headcount', () => {
  const before = frozenBaseline();
  const after = setDoc(before, {
    ...before,
    missions: before.missions.map((m) => (m.id === 'm1' ? { ...m, count: 3 } : m)),
  });

  const result = plan(toPlannerInput(after, NOW));
  const at = NOW + 5 * HOUR;
  const onDuty = result.shifts.filter((s) => s.missionId === 'm1' && s.start <= at && s.end > at);
  assert.equal(onDuty.length, 3, 'a raised headcount applies to time not yet worked');
});

test('elapsed time with no record is still planned, so history stays visible', () => {
  // Nothing frozen: a plan opened for the first time after some of it elapsed.
  const result = plan(toPlannerInput(doc(), NOW));
  const at = BASE + 5 * HOUR;
  const onDuty = result.shifts.filter((s) => s.start <= at && s.end > at);
  assert.ok(onDuty.length > 0, 'an unrecorded elapsed shift is shown, not blanked');
});

test('omitting `now` reproduces the previous behaviour exactly', () => {
  const original = doc();
  assert.equal(
    JSON.stringify(plan(toPlannerInput(original))),
    JSON.stringify(plan({ ...toPlannerInput(original, undefined) })),
    'the adapter default must be "nothing has elapsed"',
  );
});
