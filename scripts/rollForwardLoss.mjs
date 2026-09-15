/**
 * ADR 012 decided that a rolled-past window is **exported**. Nothing exports it
 * yet. So what happens to that history today?
 *
 * It is deleted, silently, by the next ordinary edit.
 *
 * `pruneStalePins` has always done this, and until ADR 012 it was correct:
 * assignments outside the plan period were residue, and CLAUDE.md says so.
 * The export decision inverts that. The same pins are now the only durable
 * record of who actually stood post, and the only code that touches them
 * throws them away.
 *
 * Note the two-step shape, which is why this is easy to miss. `pruneStalePins`
 * is deliberately timid and declines to act on the edit that *moves* the
 * period - the date fields emit an edit on every intermediate value that
 * parses, and a half-typed year would take real history with it. So rolling the
 * window looks safe. The deletion happens on the *next* edit, when the window
 * is standing still again and the pins are already outside it.
 *
 * `clearStalePins` is the explicit half and has the same problem: it is the
 * button offered alongside the `PIN_OUT_OF_PERIOD` warning, and it deletes
 * rather than exports.
 *
 * Run it with `node scripts/rollForwardLoss.mjs`. A measurement, not a test.
 */

import { planSchema, prunePins } from '../src/lib/planSchema.js';
import { freezeElapsedBeforeEdit, pruneStalePins, countStalePins } from '../src/lib/pins.js';

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
  prunePins(pruneStalePins(prev, freezeElapsedBeforeEdit(prev, next, NOW))),
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
console.log(`\n${lost} assignments were deleted by an edit that had nothing to do with them.`);
console.log('Nothing exported them first. Under ADR 012 that is data loss on the');
console.log('normal path, and it is why the export blocks rather than follows the');
console.log('rest of ADR 009.');
