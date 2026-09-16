/**
 * Does an ordinary edit change who guarded in the PAST?
 *
 * Freezing (`freezeElapsedBeforeEdit`) exists to stop exactly that: before any
 * mutation lands, whatever the engine had already decided for an elapsed,
 * auto-assigned shift becomes a real pin. It works for the case it was built
 * for - nobody is ever quietly swapped for somebody else.
 *
 * It could not cover headcount on its own, because a mission carries one
 * `count` for all time. The freeze records *who* stood a past slot; it has
 * nowhere to record *how many seats existed then*. So raising a mission's
 * headcount re-staffed every past slot to the new number and invented people
 * into history who were never there, and lowering it deleted people who
 * genuinely stood post - 72 of each, three days into this rota.
 *
 * **ADR 009 fixed both.** An elapsed segment that already carries a record
 * defers to it: no demand is raised for it and the headcount cap does not
 * apply. Both columns read zero below, and this is now the regression fixture.
 * A segment with no record is still planned, so opening a plan whose first days
 * have elapsed shows history rather than blanking it.
 *
 * Moving the plan's start forward is the case still open: that history is in
 * the document but outside the period, so the engine ignores it and it is
 * counted once as PIN_OUT_OF_PERIOD rather than shown. ADR 012's export
 * decision is what settles it.
 *
 * Run it with `node scripts/historyDriftCheck.mjs`. It is a measurement, not a
 * test, and is deliberately outside `npm test`.
 */

import { plan } from '../src/lib/planner.js';
import { toPlannerInput, planSchema, prunePins } from '../src/lib/planSchema.js';
import { freezeElapsedBeforeEdit } from '../src/lib/pins.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BASE = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
const NOW = BASE + 3 * DAY; // three days into a seven-day rota

const doc = planSchema.parse({
  start: BASE, end: BASE + 7 * DAY, shiftMinutes: 60, strategy: 'rotation',
  employees: Array.from({ length: 8 }, (_, i) => ({ id: `e${i + 1}`, name: `שומר ${i + 1}` })),
  missions: [
    { id: 'm1', name: 'שער', type: 'local', count: 2 },
    { id: 'm2', name: 'סיור', type: 'local', count: 2 },
  ],
  pins: [], tags: [],
});

/** Exactly what PlanContext.setDoc does, with the clock held still. */
const setDoc = (prev, next) => planSchema.parse(
  prunePins(freezeElapsedBeforeEdit(prev, next, NOW)),
);

/** Past slot -> the set of people recorded on it. A slot can hold several. */
function pastRecord(document) {
  const out = new Map();
  // `NOW` is passed the way `SchedulePage` passes it, so this measures the app
  // as it actually renders rather than the engine with no sense of elapsed time.
  for (const s of plan(toPlannerInput(document, NOW)).shifts) {
    if (s.end > NOW) continue;
    const key = `${s.missionId}|${s.start}|${s.end}`;
    if (!out.has(key)) out.set(key, new Set());
    out.get(key).add(s.employeeId);
  }
  return out;
}

function drift(before, after) {
  let erased = 0; let invented = 0; let unreachable = 0;
  for (const [key, was] of before) {
    if (!after.has(key)) { unreachable += was.size; continue; }
    const is = after.get(key);
    for (const e of was) if (!is.has(e)) erased++;
    for (const e of is) if (!was.has(e)) invented++;
  }
  return { erased, invented, unreachable };
}

const EDITS = {
  'add an employee': (d) => ({ ...d, employees: [...d.employees, { id: 'e9', name: 'שומר 9', tags: [] }] }),
  'raise a mission headcount': (d) => ({ ...d, missions: d.missions.map((m) => (m.id === 'm1' ? { ...m, count: 3 } : m)) }),
  'lower a mission headcount': (d) => ({ ...d, missions: d.missions.map((m) => (m.id === 'm1' ? { ...m, count: 1 } : m)) }),
  'add a third mission': (d) => ({ ...d, missions: [...d.missions, { id: 'm3', name: 'חמ"ל', type: 'local', count: 1, requires: [], excludes: [] }] }),
  'switch strategy to balanced': (d) => ({ ...d, strategy: 'balanced' }),
  'change shift length to 2h': (d) => ({ ...d, shiftMinutes: 120 }),
  'extend the plan end by 2 days': (d) => ({ ...d, end: d.end + 2 * DAY }),
  'move the plan start forward 1d': (d) => ({ ...d, start: d.start + DAY }),
  'limit an employee availability': (d) => ({ ...d, employees: d.employees.map((e) => (e.id === 'e2' ? { ...e, start: NOW, end: d.end } : e)) }),
};

// Freeze first. A real edit freezes before it applies, and an elapsed slot with
// no record has no history to protect - see ADR 009's `covered` gate.
const frozen = setDoc(doc, doc);
const baseline = pastRecord(frozen);
const assignments = [...baseline.values()].reduce((n, s) => n + s.size, 0);
console.log(`Three days into a seven-day rota: ${baseline.size} past slots, ${assignments} assignments.`);
console.log('Each edit below is applied through the real setDoc path, then the past is re-read.\n');
console.log('  edit                                erased   invented   unreachable');
for (const [label, apply] of Object.entries(EDITS)) {
  let after;
  try {
    after = pastRecord(setDoc(frozen, apply(frozen)));
  } catch (err) {
    console.log(`  ${label.padEnd(34)} threw: ${err.message.slice(0, 32)}`);
    continue;
  }
  const { erased, invented, unreachable } = drift(baseline, after);
  const flag = erased ? '  <- people deleted from the record'
    : invented ? '  <- people invented into the record'
      : unreachable ? '  <- history fell outside the period' : '';
  console.log(`  ${label.padEnd(34)} ${String(erased).padStart(6)}   ${String(invented).padStart(8)}`
    + `   ${String(unreachable).padStart(11)}${flag}`);
}

console.log('\nBefore ADR 009 landed, raising a headcount invented 72 people into shifts');
console.log('that were over and lowering it deleted 72 who had stood post, because');
console.log("today's `count` was applied to time that had already happened. Elapsed");
console.log('slots that carry a record now defer to it; slots with no record are still');
console.log('planned, so history stays visible rather than blanking.');
