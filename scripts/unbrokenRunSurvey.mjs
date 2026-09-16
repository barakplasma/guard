/**
 * How often does the engine schedule somebody for a stretch nobody could stand?
 *
 * `balanced` evens out total time on duty, and evening out is what produces an
 * unbroken run: whoever is behind has the fewest minutes, so they are the
 * cheapest candidate for the next slot, and the one after that, until they are
 * level. `invariants.js` calls three consecutive slots a `long-unbroken-run` and
 * reports it rather than preventing it.
 *
 * This asks how big the problem is on **current behaviour**, over random rosters
 * where nobody carries anything, so ADR 015 plays no part. Plans where the seats
 * outnumber the people are skipped - there everybody works everything and the
 * strategy has no choice to make.
 *
 * The split is the finding. See ADR 016.
 *
 * Run it with `node scripts/unbrokenRunSurvey.mjs`. A measurement, not a test.
 */

import { plan } from '../src/lib/planner.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const START = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
const PLANS = 3000;

let state = 424242;
const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (n) => Math.floor(rnd() * n);

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
    let run = 0;
    let prevEnd = null;
    for (const s of own) {
      run = prevEnd === s.start ? run + (s.end - s.start) : s.end - s.start;
      prevEnd = s.end;
      if (run > worst) worst = run;
    }
  }
  return worst / HOUR;
}

const BANDS = ['<3h', '3-6h', '6-12h', '12-24h', '>=24h'];
const band = (h) => (h < 3 ? '<3h' : h < 6 ? '3-6h' : h < 12 ? '6-12h' : h < 24 ? '12-24h' : '>=24h');
const empty = () => Object.fromEntries(BANDS.map((b) => [b, 0]));

const groups = {
  'everyone present from the start': empty(),
  'somebody joins part-way in': empty(),
};
const counts = { 'everyone present from the start': 0, 'somebody joins part-way in': 0 };
let measured = 0;
let worst = 0;

for (let i = 0; i < PLANS; i++) {
  const hours = [24, 48, 72][pick(3)];
  const people = 4 + pick(9);
  // Somebody joining part-way through is ordinary - leave, a course, a new
  // arrival - and it is the case the split below is about.
  const late = rnd() < 0.4 ? 1 + pick(2) : 0;
  const employees = Array.from({ length: people }, (_, k) => ({
    id: `e${k}`,
    name: `שומר ${k}`,
    start: k < late ? START + (1 + pick(Math.max(1, Math.floor(hours / 24)))) * DAY : undefined,
    tags: [],
  }));

  const missionCount = 1 + pick(3);
  let seats = 0;
  const missions = Array.from({ length: missionCount }, (_, k) => {
    const count = 1 + pick(Math.max(1, people - 2));
    seats += count;
    return { id: `m${k}`, name: `M${k}`, type: 'local', count, requires: [], excludes: [] };
  });
  if (seats >= people) continue;

  let result;
  try {
    result = plan({
      start: START, end: START + hours * HOUR, shiftMinutes: 60, strategy: 'balanced',
      employees, missions, pins: [], nightWindows: [], tags: [], onInvariantViolation: 'report',
    });
  } catch { continue; }

  const run = longestRun(result);
  const group = late ? 'somebody joins part-way in' : 'everyone present from the start';
  measured++;
  counts[group]++;
  groups[group][band(run)]++;
  if (run > worst) worst = run;
}

console.log(`plans measured : ${measured}   random rosters, nobody carrying anything\n`);
for (const [name, bands] of Object.entries(groups)) {
  console.log(`  ${name} (${counts[name]} plans)`);
  for (const b of BANDS) {
    const share = counts[name] ? (100 * bands[b] / counts[name]).toFixed(1) : '0.0';
    console.log(`    longest run ${b.padEnd(7)}: ${String(bands[b]).padStart(5)}  ${share}%`);
  }
  console.log('');
}
console.log(`worst seen     : ${worst.toFixed(0)}h`);
console.log('\nWith everyone present the engine is fine. The trigger is somebody whose');
console.log('availability starts after the plan does: `balanced` sees them on zero minutes');
console.log('and pours duty into them until they are level, because nothing in the key it');
console.log('ranks on says a person has to sleep.');
