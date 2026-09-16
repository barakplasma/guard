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
 * **It is how ADR 016 was found.** Eight guards, five seats, the eighth away for
 * the first two days: before that record, the window still containing the
 * absence handed them a **forty-seven hour** unbroken run to catch up, with no
 * carried duty involved at all. It now reads six at every roll.
 *
 * **It is the guard rail on ADR 015.** Carried duty enters the same fairness key,
 * so before the run was capped directly a 36-hour debt bought seventy-two
 * unbroken hours repaying itself. Both records are measured here.
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

console.log('\nEvery roll should read at or under six hours (ADR 016). Before that cap the');
console.log('same fixture read 24h then 47h with no carried duty involved at all, and');
console.log('72h, 58h, 34h once ADR 015 gave it a debt to repay.');
