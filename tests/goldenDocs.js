/**
 * The documents the golden test pins, and the projection it compares.
 *
 * Kept beside the fixtures rather than inside the test so the generator script
 * and the test can never disagree about what was captured.
 *
 * Times are built from local wall-clock parts and compared as offsets from the
 * plan's own start, because the night boundaries resolve in the viewer's
 * timezone (see planSchema.js's `nightWindows`) - absolute epoch numbers in a
 * committed fixture would make the suite fail on a machine set to another zone
 * for reasons that have nothing to do with the scheduler.
 */

import { planSchema } from '../src/lib/planSchema.js';
import { carmelRotaDocument } from './testHelpers.js';

const HOUR = 3600 * 1000;
const MINUTE = 60 * 1000;

export function localTime(y, m, d, h = 0, min = 0) {
  return new Date(y, m, d, h, min, 0, 0).getTime();
}

const people = (n) => Array.from({ length: n }, (_, i) => ({
  id: `e${i + 1}`,
  name: `Emp${String(i + 1).padStart(2, '0')}`,
}));

/**
 * The rota this whole line of work came from: a week, 16 guards, four hourly
 * local missions, `rotation`, and one person pinned to a whole mission. It sets
 * no per-mission shift lengths, so it is the document that must not move.
 */
function carmelRota() {
  const start = localTime(2026, 8, 10, 16, 0);
  return planSchema.parse({
    ...carmelRotaDocument(start),
    title: 'כרמל',
  });
}

/** The eight-hour grid with day/night headcounts, from planner.nightcount.test.js. */
function nightCounts() {
  const start = localTime(2026, 0, 5, 6, 0);
  return planSchema.parse({
    start,
    end: localTime(2026, 0, 6, 6, 0),
    shiftMinutes: 8 * 60,
    strategy: 'rotation',
    employees: people(12),
    missions: [
      { id: 'a', name: 'A', type: 'local', count: 4, nightCount: 6 },
      { id: 'b', name: 'B', type: 'local', count: 6, nightCount: 4 },
    ],
  });
}

/**
 * Remote and local side by side, on the default `balanced` strategy, with
 * availability windows that cut the grid off its own boundaries and both kinds
 * of pin.
 */
function mixed() {
  const start = localTime(2026, 2, 3, 12, 0);
  return planSchema.parse({
    title: 'מעורב',
    start,
    end: start + 48 * HOUR,
    shiftMinutes: 90,
    employees: [
      ...people(6),
      { id: 'e7', name: 'Emp07', start: start + 5 * HOUR, end: start + 40 * HOUR },
      { id: 'e8', name: 'Emp08', start: start + 90 * MINUTE, end: null },
    ],
    missions: [
      {
        id: 'r1', name: 'Radio', type: 'remote', start: start + 2 * HOUR, end: start + 26 * HOUR, count: 2,
      },
      { id: 'l1', name: 'Gate', type: 'local', count: 2, nightCount: 3 },
      {
        id: 'l2', name: 'Yard', type: 'local', start: start + 30 * MINUTE, end: start + 20 * HOUR, count: 1,
      },
    ],
    pins: [
      { missionId: 'r1', employeeId: 'e3' },
      { missionId: 'l1', employeeId: 'e5', start: start + 3 * HOUR, end: start + 6 * HOUR },
    ],
  });
}

/**
 * Everything that used to make the ring's turn count awkward, in one document:
 * two-hour slots, availability edges that tear a slot in two, missions whose
 * own windows end mid-slot so one guard can take the first half of a slot on
 * one and the second half on another, and a remote hold that must stay a
 * single turn however long it runs. `rotation` is the only strategy that
 * counts turns at all, so this is the fixture that pins that half of the
 * refactor against the arithmetic it replaced.
 */
function rotationGrid() {
  const start = localTime(2026, 5, 1, 8, 0);
  return planSchema.parse({
    start,
    end: start + 30 * HOUR,
    shiftMinutes: 120,
    strategy: 'rotation',
    employees: [
      ...people(5),
      { id: 'e6', name: 'Emp06', start: start + 3 * HOUR, end: null },
      { id: 'e7', name: 'Emp07', start: null, end: start + 17 * HOUR },
      { id: 'e8', name: 'Emp08', start: start + 90 * MINUTE, end: start + 25 * HOUR },
    ],
    missions: [
      { id: 'a', name: 'Alpha', type: 'local', start: null, end: start + 9 * HOUR, count: 2 },
      {
        id: 'b', name: 'Bravo', type: 'local', start: start + 9 * HOUR, end: null, count: 2, nightCount: 3,
      },
      { id: 'c', name: 'Charlie', type: 'local', count: 1 },
      {
        id: 'd', name: 'Delta', type: 'remote', start: start + 4 * HOUR, end: start + 21 * HOUR, count: 1,
      },
    ],
    pins: [{ missionId: 'c', employeeId: 'e2', start: start + 6 * HOUR, end: start + 8 * HOUR }],
  });
}

export const GOLDEN_DOCS = [
  { name: 'carmel-rota', build: carmelRota },
  { name: 'night-counts', build: nightCounts },
  { name: 'mixed-remote-local', build: mixed },
  { name: 'rotation-grid', build: rotationGrid },
];

/**
 * What the golden fixture records: every field `plan()` documented before
 * per-mission grids existed, with instants rebased to whole minutes from the
 * plan's start.
 *
 * A projection rather than the raw result, on purpose. The promise this test
 * enforces is that a link written before this feature renders identically, and
 * `slotStart`/`slotEnd` are new fields nothing older can be reading. Comparing
 * the raw object would fail on the addition itself while saying nothing about
 * whether a single person's shift moved.
 *
 * Positional tuples for the two long lists, for the same reason `urlState.js`
 * uses them: the week-long rota is 1467 shifts and 163 timeline segments over
 * 16 people, and repeating nine key names per row turns a fixture that has to
 * live in the repo forever into a third of a megabyte.
 */
export function project(result, planStart) {
  const at = (t) => (t - planStart) / MINUTE;
  return {
    shifts: result.shifts.map((s) => [
      at(s.start), at(s.end), s.missionId, s.missionName, s.type,
      s.employeeId, s.employeeName, s.pinned ? 1 : 0, s.frozen ? 1 : 0,
    ]),
    timeline: result.timeline.map((seg) => [
      at(seg.start), at(seg.end),
      seg.onDuty.map((o) => [o.employeeId, o.missionId]),
      seg.offDuty,
      seg.unavailable,
    ]),
    stats: result.stats,
    warnings: result.warnings.map((w) => (
      w.start == null ? w : { ...w, start: at(w.start), end: at(w.end) }
    )),
  };
}
