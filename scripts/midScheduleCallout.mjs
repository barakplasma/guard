/**
 * Evidence for ADR 008 defect 3, in the form it was actually reported:
 * a mission added into a running schedule, starting in twenty minutes,
 * requiring two drivers. The app staffs one and reports it cannot find the
 * second - although the second driver is standing an ordinary post that any of
 * the other guards could hold.
 *
 * The mechanism is the demand walk's sort order. Demands are ordered
 * chronologically first and by scarcity only as a tiebreak within the same
 * instant (`a.start - b.start || a.pool - b.pool` in planner.js phase 3). A
 * mission inserted off the grid starts *later* than the hourly segment already
 * covering that time, so the unconstrained post is filled first, takes a scarce
 * driver, and the constrained mission that starts twenty minutes later cannot
 * get them back. The engine never reconsiders a placement.
 *
 * Which is why the sweep below is the interesting part: before #40, on the hour
 * it worked and twenty or thirty minutes past it did not, and a real callout
 * never starts neatly on the hour.
 *
 * **#40 fixed every offset this script tests** by lifting a constrained demand
 * ahead of the earlier, less-constrained one it overlaps (`offGridPriority` in
 * planner.js phase 3). All rows below now read `ok`, and the script is kept as
 * the regression fixture for that.
 *
 * Two limits on what it proves, worth stating because it is easy to over-read:
 *
 *   - It builds **independent plans with `pins: []`**, so it is not an
 *     end-to-end test of editing a running schedule with history present. That
 *     path goes through `setDoc`, freezing and pin normalization, none of which
 *     is exercised here.
 *   - It reports a shortage **anywhere in the horizon** as the callout's
 *     failure, which was true for these fixtures and is not true in general.
 *
 * `offGridFuzz.mjs` is the companion that asks whether #40 closed the class
 * rather than the shape. It did not: 2.8% of shortage instants over random
 * off-grid instances remain provably false.
 *
 * Run it with `node scripts/midScheduleCallout.mjs`. A measurement, not a test.
 */

import { plan } from '../src/lib/planner.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const START = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
const END = START + 24 * HOUR;

/** Eight guards, of whom exactly two drive. */
const EMPLOYEES = Array.from({ length: 8 }, (_, i) => ({
  id: `e${i + 1}`,
  name: `שומר ${i + 1}`,
  tags: i < 2 ? ['driver'] : [],
}));

const GATE = { id: 'gate', name: 'שער', type: 'local', count: 3, requires: [], excludes: [] };
const PATROL = { id: 'patrol', name: 'סיור', type: 'local', count: 2, requires: [], excludes: [] };

const BASE = {
  start: START, end: END, shiftMinutes: 60, strategy: 'balanced',
  employees: EMPLOYEES, pins: [], nightWindows: [],
  tags: [{ id: 'driver' }],
  onInvariantViolation: 'report',
};

const isDriver = (id) => EMPLOYEES.find((e) => e.id === id).tags.includes('driver');
const shortagesOf = (r) => r.warnings.filter(
  (w) => w.code === 'understaffed' || w.code === 'missing-required-tag',
);

/** The callout: two drivers, two hours, inserted `offset` minutes into the day. */
const calloutAt = (offset) => {
  const at = START + offset * MINUTE;
  return {
    id: 'callout', name: 'קריאה', type: 'local',
    start: at, end: at + 2 * HOUR,
    count: 2, requires: [{ tag: 'driver', count: 2 }], excludes: [],
  };
};

console.log('Eight guards, two of them drivers. Gate needs 3, patrol needs 2.');
console.log('A callout needing two drivers is inserted into the running schedule.\n');
console.log('  callout starts   crew it gets                 result');
for (const offset of [0, 20, 30, 45, 60, 90, 120]) {
  const callout = calloutAt(offset);
  const result = plan({ ...BASE, missions: [GATE, PATROL, callout] });
  const crew = result.shifts
    .filter((s) => s.missionId === 'callout' && s.start <= callout.start && s.end > callout.start)
    .map((s) => `${s.employeeName}${isDriver(s.employeeId) ? ' (driver)' : ''}`);
  const short = shortagesOf(result).length > 0;
  console.log(`  +${String(offset).padStart(3)} minutes    ${crew.join(', ').padEnd(27)} ${short ? 'SHORT A DRIVER' : 'ok'}`);
}

console.log('\nBefore #40 every off-the-hour offset here reported a missing driver, while');
console.log('seven seats were needed against eight guards and a full staffing existed.');
console.log('#40 fixed all of these offsets. This is now the regression fixture for');
console.log('that, not a live defect - see offGridFuzz.mjs for whether the class is');
console.log('closed, which it is not.');
