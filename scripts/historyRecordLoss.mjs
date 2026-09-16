/**
 * Does an edit that has nothing to do with the past still change what the past
 * says?
 *
 * `historyDriftCheck.mjs` asks the engine, which is the right instrument for
 * shifts inside the period and the wrong one here: once the window has rolled,
 * those assignments appear in no schedule at all. The only thing that can still
 * read them is the export, so that is what this measures - the CSV rows, before
 * and after an ordinary edit.
 *
 * Four of the five edits below used to destroy or falsify the record, and none
 * of them are about the past. Measured on this fixture - two days stood, 96
 * rows on the record - before the fix:
 *
 *   remove a guard who has left      24 rows lost
 *   remove a mission that ended      48 rows lost
 *   rename a guard                   24 rows falsified
 *   edit their qualifications        24 rows falsified
 *
 * Removing the mission took half the record with it. Renaming did not lose a
 * row, which is worse in its own way: the file still had 96 rows and 24 of them
 * now named somebody who had not been there.
 *
 * The fix is that a pin which has become history carries its own copy of what
 * it needs to be read, stamped when it stops being an instruction. See ADR 012
 * and `captureHistory` in src/lib/pins.js.
 *
 *   node scripts/historyRecordLoss.mjs
 */

import { plan } from '../src/lib/planner.js';
import { planSchema, prunePins, toPlannerInput } from '../src/lib/planSchema.js';
import { acceptSchedule, captureHistory, freezeElapsedBeforeEdit } from '../src/lib/pins.js';
import { outOfPeriodLog } from '../src/lib/logExport.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BASE = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
const NOW = BASE + 2 * DAY;

const freezeBefore = (prev, next, now) => freezeElapsedBeforeEdit(prev, next, now, acceptSchedule(prev, now).result);

/** Exactly what PlanContext.setDoc does, with the clock held still. */
const setDoc = (prev, next) => planSchema.parse(
  prunePins(captureHistory(prev, freezeBefore(prev, next, NOW))),
);

const start = planSchema.parse({
  start: BASE, end: BASE + 2 * DAY, shiftMinutes: 60, strategy: 'rotation',
  employees: [
    { id: 'e1', name: 'דנה', tags: ['driver'] },
    { id: 'e2', name: 'יוסי', tags: ['medic'] },
    { id: 'e3', name: 'נועה', tags: [] },
    { id: 'e4', name: 'אבי', tags: [] },
  ],
  missions: [
    { id: 'm1', name: 'שער', type: 'local', count: 1 },
    { id: 'm2', name: 'סיור', type: 'local', count: 1 },
  ],
  tags: [{ id: 'driver', name: 'נהג' }, { id: 'medic', name: 'חובש' }],
  pins: [], tags_: undefined,
});

// Two days stood and frozen, then the window rolls on. Everything behind it is
// now history and nothing else.
const frozen = setDoc(start, start);
const rolled = setDoc(frozen, { ...frozen, start: BASE + 2 * DAY, end: BASE + 4 * DAY });

const before = outOfPeriodLog(rolled);
const key = (r) => `${r.missionId}|${r.employeeId}|${r.start}`;
const baseline = new Map(before.map((r) => [key(r), r]));

const EDITS = {
  'remove a guard who has left': (d) => ({ ...d, employees: d.employees.filter((e) => e.id !== 'e1') }),
  'remove a mission that ended': (d) => ({ ...d, missions: d.missions.filter((m) => m.id !== 'm1') }),
  'rename a guard': (d) => ({ ...d, employees: d.employees.map((e) => (e.id === 'e1' ? { ...e, name: 'דנה כהן' } : e)) }),
  'edit a guard’s qualifications': (d) => ({ ...d, employees: d.employees.map((e) => (e.id === 'e1' ? { ...e, tags: [] } : e)) }),
  'move a mission’s window': (d) => ({ ...d, missions: d.missions.map((m) => (m.id === 'm1' ? { ...m, start: BASE + 3 * DAY, end: BASE + 4 * DAY } : m)) }),
};

console.log(`Two days stood, then the window rolled on: ${before.length} rows on the record.`);
console.log('Each edit is applied through the real setDoc path, then the export is re-read.\n');
console.log('  edit                                 rows   lost   falsified');

let worst = 0;
for (const [label, apply] of Object.entries(EDITS)) {
  const after = outOfPeriodLog(setDoc(rolled, apply(rolled)));
  const seen = new Set(after.map(key));
  const lost = [...baseline.keys()].filter((k) => !seen.has(k)).length;
  const falsified = after.filter((r) => {
    const was = baseline.get(key(r));
    return was && (was.employeeName !== r.employeeName
      || was.missionName !== r.missionName
      || String(was.qualifications ?? []) !== String(r.qualifications ?? [])
      || was.start !== r.start || was.end !== r.end);
  }).length;
  worst = Math.max(worst, lost + falsified);
  console.log(`  ${label.padEnd(36)}${String(after.length).padStart(5)}${String(lost).padStart(7)}${String(falsified).padStart(12)}`);
}

console.log();
console.log(worst === 0
  ? 'No edit changed the record. A pin that has become history carries its own\nnames, qualifications and hours, so nothing it points at can rewrite it.'
  : `${worst} rows lost or falsified by an edit that was not about the past.`);

// Sanity: the engine still ignores all of it, so none of this moves a shift.
const shifts = plan(toPlannerInput(rolled, NOW)).shifts.length;
console.log(`\nThe engine schedules none of it: ${shifts} shifts in the current window either way.`);
