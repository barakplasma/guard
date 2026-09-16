/**
 * How long a stretch does anyone actually stand without a break?
 *
 * `balanced` evens out total time on duty, and evening out is exactly what
 * produces an unbroken run: somebody who is behind has the fewest minutes, so
 * they are the cheapest candidate for the next slot, and the one after that,
 * until they are level. `invariants.js` calls three consecutive slots a
 * `long-unbroken-run`, so the engine already considers this a quality problem -
 * it reports it rather than preventing it.
 *
 * Two reasons this script exists.
 *
 * **It measures something already true on `main`.** Eight guards, five seats,
 * the eighth away for the first two days: the window that still contains the
 * absence hands them a forty-hour unbroken run to catch up. No carried duty
 * involved, nothing to do with ADR 015. Recorded rather than fixed, because
 * fixing it means changing what `balanced` optimises and that is the owner's
 * call, not a tidy-up.
 *
 * **It is the guard rail on ADR 015.** Carried duty enters the same fairness key,
 * so an unclamped debt buys a run as long as the debt: a 36-hour gap bought
 * seventy-two unbroken hours before the clamp existed. The clamp is measured
 * here, and so is what it costs - see the table in ADR 015.
 *
 * Run it with `node scripts/unbrokenRuns.mjs`. A measurement, not a test.
 */

import { plan } from '../src/lib/planner.js';
import { toPlannerInput } from '../src/lib/planSchema.js';
import { freezeElapsedBeforeEdit } from '../src/lib/pins.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const START = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
const HORIZON = 72 * HOUR;
const ROLL = 24 * HOUR;
const ROLLS = 8;
const AWAY_UNTIL = START + 2 * DAY;

const mission = (id, name, count) => ({
  id, name, type: 'local', count, start: null, end: null, nightCount: null,
  shiftMinutes: null, nightShiftMinutes: null, requires: [], excludes: [], excludeEmployees: [],
});

let doc = {
  version: 1, title: '', start: START, end: START + HORIZON,
  shiftMinutes: 60, strategy: 'balanced', nightStart: '22:00', nightEnd: '06:00',
  employees: Array.from({ length: 8 }, (_, i) => ({
    id: `e${i + 1}`, name: `שומר ${i + 1}`, start: i === 7 ? AWAY_UNTIL : null, end: null, tags: [],
  })),
  missions: [mission('gate', 'שער', 3), mission('patrol', 'סיור', 2)],
  pins: [], tags: [],
};

/** The longest stretch anyone stands with no gap between consecutive rows. */
function longestRun(result) {
  const byPerson = new Map();
  for (const s of result.shifts) {
    if (!byPerson.has(s.employeeId)) byPerson.set(s.employeeId, []);
    byPerson.get(s.employeeId).push(s);
  }
  let worst = 0;
  let who = null;
  for (const [id, own] of byPerson) {
    own.sort((a, b) => a.start - b.start);
    let run = 0;
    let prevEnd = null;
    for (const s of own) {
      run = prevEnd === s.start ? run + (s.end - s.start) : s.end - s.start;
      prevEnd = s.end;
      if (run > worst) { worst = run; who = id; }
    }
  }
  return { hours: worst / HOUR, who };
}

console.log('Eight guards, five seats, a 72-hour window rolled forward a day at a time.');
console.log('The eighth guard is away for the first two days and then returns.\n');
console.log('  roll   longest unbroken run   stood by');

let now = START;
for (let i = 0; i <= ROLLS; i++) {
  const result = plan({ ...toPlannerInput(doc, now), onInvariantViolation: 'report' });
  const { hours, who } = longestRun(result);
  const name = doc.employees.find((e) => e.id === who)?.name ?? '';
  console.log(`  ${String(i).padStart(4)}   ${`${hours.toFixed(0)}h`.padStart(18)}   ${name}`);
  if (i === ROLLS) break;
  now += ROLL;
  doc = freezeElapsedBeforeEdit(doc, { ...doc, start: doc.start + ROLL, end: doc.end + ROLL }, now);
}

console.log('\nRoll 1 is the pre-existing behaviour and has nothing to do with carried duty:');
console.log('the window still contains the absence, so evening it out inside that window');
console.log('means one very long stretch. The steady state afterwards is what ADR 015 is');
console.log('answerable for - unclamped it read 72h, 58h, 34h as the debt was repaid.');
