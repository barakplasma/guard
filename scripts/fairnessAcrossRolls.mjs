/**
 * What does rolling the window forward do to fairness?
 *
 * ADR 012 plans 72 hours at a time and rolls forward. ADR 013 says the rota is
 * re-solved continuously against a moving present. Neither record asks what
 * happens to *accumulated* duty when the window moves, and the owner's stated
 * priority is exactly that: "rebalancing based on how much previous people have
 * already guarded, mixed with what the actual new requirements are".
 *
 * The engine evens out total time on duty **inside the window it is given**
 * (`balanced`, ADR 002). Until ADR 015, duty that had fallen out behind the
 * window was not in that sum, so a guard who carried a heavy week started the
 * next one level with everyone else and the debt never came back.
 *
 * What it looked like before that fix, on this fixture - the app reporting a
 * perfectly even spread over a gap that never closed:
 *
 *     roll   window spread   cumulative spread   busiest   idlest
 *        1           0.0h               18.0h       18h       0h
 *        2           0.0h               36.0h       36h       0h
 *        4           0.0h               36.0h       66h      30h
 *        8           0.0h               36.0h      126h      90h
 *
 * The window spread is the number the app shows. Reading 0.0h beside a
 * cumulative 36h is the whole defect in two columns.
 *
 * The simulation is the real path: `freezeElapsedBeforeEdit` at each step, then
 * the window moves, exactly as `setDoc` would do it. Cumulative duty is counted
 * from the frozen pins, which are the record of what was actually stood.
 *
 * Run it with `node scripts/fairnessAcrossRolls.mjs`. A measurement, not a test.
 */

import { plan } from '../src/lib/planner.js';
import { toPlannerInput } from '../src/lib/planSchema.js';
import { acceptSchedule, freezeElapsedBeforeEdit } from '../src/lib/pins.js';

/**
 * The app's own path, spelled out: accept a schedule for `prev`, then freeze
 * elapsed rows out of *that* result. `freezeElapsedBeforeEdit` no longer solves
 * for itself, so every caller has to say which answer it is recording.
 */
const freezeBefore = (prev, next, now) => freezeElapsedBeforeEdit(prev, next, now, acceptSchedule(prev, now).result);


const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const START = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
const HORIZON = 72 * HOUR;
const ROLL = 24 * HOUR;
const ROLLS = 8;

/**
 * The eighth guard is away for the first two days - leave, illness, a course.
 * Everyone else carries their share of it, so by the time they come back the
 * others are ahead and they are behind, through nobody's fault.
 *
 * That is the case worth asking about, and it is ordinary. With even demand and
 * everyone present the question does not arise: five seats over eight guards is
 * fifteen hours each per day whatever the engine does.
 */
const AWAY_UNTIL = START + 2 * DAY;
const employees = Array.from({ length: 8 }, (_, i) => ({
  id: `e${i + 1}`,
  name: `שומר ${i + 1}`,
  start: i === 7 ? AWAY_UNTIL : null,
  end: null,
  tags: [],
}));

/**
 * A roster that cannot be shared out evenly inside one window but can be over
 * several: five seats against eight guards, so three people are idle at any
 * instant and who they are is the engine's choice.
 */
const missions = [
  { id: 'gate', name: 'שער', type: 'local', count: 3, start: null, end: null, nightCount: null, shiftMinutes: null, nightShiftMinutes: null, requires: [], excludes: [], excludeEmployees: [] },
  { id: 'patrol', name: 'סיור', type: 'local', count: 2, start: null, end: null, nightCount: null, shiftMinutes: null, nightShiftMinutes: null, requires: [], excludes: [], excludeEmployees: [] },
];

let doc = {
  version: 1, title: '', start: START, end: START + HORIZON,
  shiftMinutes: 60, strategy: 'balanced', nightStart: '22:00', nightEnd: '06:00',
  employees, missions, pins: [], tags: [],
};

/** Minutes each guard is recorded as having stood, from the frozen pins. */
function loggedMinutes(d) {
  const total = new Map(d.employees.map((e) => [e.id, 0]));
  for (const p of d.pins) {
    if (!p.frozen) continue;
    const m = d.missions.find((x) => x.id === p.missionId);
    if (!m) continue;
    const from = p.start ?? m.start ?? d.start;
    const to = p.end ?? m.end ?? d.end;
    total.set(p.employeeId, (total.get(p.employeeId) ?? 0) + Math.max(0, to - from));
  }
  return total;
}

const spread = (totals) => {
  const values = [...totals.values()];
  return (Math.max(...values) - Math.min(...values)) / HOUR;
};

const inWindowSpread = (d, now) => {
  const result = plan({ ...toPlannerInput(d, now), onInvariantViolation: 'report' });
  const per = new Map(d.employees.map((e) => [e.id, 0]));
  for (const s of result.shifts) per.set(s.employeeId, (per.get(s.employeeId) ?? 0) + (s.end - s.start));
  return (Math.max(...per.values()) - Math.min(...per.values())) / HOUR;
};

console.log('Eight guards, five seats, a 72-hour window rolled forward a day at a time.');
console.log('Each roll freezes what has elapsed, exactly as setDoc does.');
console.log('The eighth guard is away for the first two days and then returns.\n');
console.log('  roll   window spread   cumulative spread   busiest   idlest');

let now = START;
for (let i = 0; i <= ROLLS; i++) {
  const windowSpread = inWindowSpread(doc, now);
  const totals = loggedMinutes(doc);
  const values = [...totals.values()].map((v) => v / HOUR);
  console.log([
    `  ${String(i).padStart(4)}`,
    `${windowSpread.toFixed(1)}h`.padStart(15),
    `${spread(totals).toFixed(1)}h`.padStart(20),
    `${Math.max(...values).toFixed(0)}h`.padStart(10),
    `${Math.min(...values).toFixed(0)}h`.padStart(9),
  ].join(''));

  if (i === ROLLS) break;
  // Roll: the present moves a day, then the window follows it.
  now += ROLL;
  const next = { ...doc, start: doc.start + ROLL, end: doc.end + ROLL };
  doc = freezeBefore(doc, next, now);
}

console.log('\n"window spread" is what the app shows: the gap between busiest and idlest');
console.log('inside the window it is planning. "cumulative spread" is the gap over every');
console.log('hour anyone has actually stood since the first day.');
