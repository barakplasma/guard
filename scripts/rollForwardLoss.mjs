/**
 * ADR 012 decided that a rolled-past window is **exported**. Nothing exports it
 * yet. So what happens to that history today?
 *
 * It *was* deleted, silently, by the next ordinary edit - 288 assignments from
 * an edit that only added an employee.
 *
 * `pruneStalePins` had always done that, and until ADR 012 it was correct:
 * assignments outside the plan period were residue, and CLAUDE.md said so. The
 * export decision inverted it. The same pins became the only durable record of
 * who actually stood post, and the only code that touched them threw them away.
 *
 * The two-step shape is why it was easy to miss. The prune was deliberately
 * timid and declined to act on the edit that *moved* the period, because the
 * date fields emit an edit on every intermediate value that parses. So rolling
 * the window looked safe; the deletion landed on the *next* edit.
 *
 * **Fixed.** Nothing removes recorded duty automatically any more - the prune
 * is gone, not narrowed, because every pin it could take had already elapsed.
 * The last row below now matches the one above it. Removal is explicit, and the
 * button beside the `PIN_OUT_OF_PERIOD` warning exports the record through
 * `outOfPeriodLog` before clearing it. This is the regression fixture.
 *
 * Run it with `node scripts/rollForwardLoss.mjs`. A measurement, not a test.
 */

import { planSchema, prunePins } from '../src/lib/planSchema.js';
import { acceptSchedule, captureHistory, freezeElapsedBeforeEdit, countStalePins } from '../src/lib/pins.js';

/**
 * The app's own path, spelled out: accept a schedule for `prev`, then freeze
 * elapsed rows out of *that* result. `freezeElapsedBeforeEdit` no longer solves
 * for itself, so every caller has to say which answer it is recording.
 */
const freezeBefore = (prev, next, now) => freezeElapsedBeforeEdit(prev, next, now, acceptSchedule(prev, now).result);


const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BASE = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
const NOW = BASE + 3 * DAY;

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
  prunePins(captureHistory(prev, freezeBefore(prev, next, NOW))),
);

const step = (label, value) => console.log(`  ${label.padEnd(44)} ${String(value).padStart(4)}`);

console.log('Seven-day rota, three days elapsed and logged.\n');
console.log('  step                                          logged');

const frozen = setDoc(doc, doc);
step('after the freeze records elapsed shifts', frozen.pins.length);

// Roll the 72-hour window forward past the logged days.
const rolled = setDoc(frozen, { ...frozen, start: BASE + 3 * DAY, end: BASE + 6 * DAY });
step('after rolling the window forward', rolled.pins.length);
step('  ...of which now outside the period', countStalePins(rolled));

// Any ordinary edit, with the window standing still again.
const afterEdit = setDoc(rolled, {
  ...rolled, employees: [...rolled.employees, { id: 'e9', name: 'שומר 9', tags: [] }],
});
step('after one unrelated edit (adding a person)', afterEdit.pins.length);

const lost = rolled.pins.length - afterEdit.pins.length;
console.log(`\nassignments deleted by an edit that had nothing to do with them: ${lost}`);
console.log(lost === 0
  ? 'None. Recorded duty now survives until somebody exports and clears it.'
  : 'DATA LOSS: history left the document without being exported first.');
