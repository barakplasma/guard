/**
 * The honest version of `vsEngine.mjs`: compare over a whole horizon, not one
 * instant, and ask what the difference is actually made of.
 *
 *   node vsPlan.mjs [iterations]
 *
 * `vsEngine.mjs` and `scripts/offGridFuzz.mjs` both ask a **per-instant**
 * question: at the moment the engine reports a shortage, does some assignment
 * of the people free right then cover every seat? Both answer "yes, 2.8% of the
 * time", from independent searches.
 *
 * That question is weaker than the one the engine has to answer, and reading
 * 2.8% as "defects" overstates it. A local mission is held in whole grid slots.
 * If an off-grid mission claims two commanders at +30 minutes, the people who
 * could have covered an hourly post from :00 are not free for the whole hour,
 * so the engine leaves it empty - and an instant-wise oracle, which never has to
 * commit anyone past the instant it is looking at, calls that a false shortage.
 *
 * So this runs the same generator over the **whole 12-hour horizon** through the
 * real adapter, and solves each instance twice:
 *
 *   - **free**, where crew may change hands inside a slot and the model pays for
 *     it only at level 3;
 *   - **slot-disciplined**, where `capChurn = 0` from the start makes a slot
 *     indivisible exactly as the engine treats it.
 *
 * The gap between those two is the price of the slot discipline. The gap between
 * slot-disciplined and the engine is what the greedy walk actually leaves on the
 * table. Only the second is a defect.
 */

import { plan } from '../../src/lib/planner.js';
import { toInstance } from './fromPlan.mjs';
import { solveRota } from './solve.mjs';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const START = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
const END = START + 12 * HOUR;
const TAGS = ['driver', 'commander', 'medic'];

const iterations = Number(process.argv[2] ?? 60);

let state = 20260915;
const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;

/**
 * Seats the engine left empty, counted on the model's own global grid so the
 * two numbers mean the same thing. Segment-seats, not minutes: a seat empty for
 * one segment is one, however long that segment is.
 */
function engineShortfall(input, inst) {
  const { segs, missions } = inst.index;
  let unfilled = 0;
  missions.forEach((mission, mi) => {
    segs.forEach((seg, si) => {
      const want = inst.want[mi][si];
      if (want <= 0) return;
      const on = new Set(input.shifts
        .filter((s) => s.missionId === mission.id && s.start <= seg.start && s.end >= seg.end)
        .map((s) => s.employeeId));
      unfilled += Math.max(0, want - on.size);
    });
  });
  return unfilled;
}

let compared = 0;
let engineWorse = 0;
let costOfDiscipline = 0;
let greedyLoss = 0;
let engineTotal = 0;
const started = Date.now();

for (let iter = 0; iter < iterations; iter++) {
  const n = 4 + Math.floor(rnd() * 5);
  const employees = Array.from({ length: n }, (_, i) => ({
    id: `e${i + 1}`, name: `G${i + 1}`, tags: TAGS.filter(() => rnd() < 0.35),
  }));
  const nm = 2 + Math.floor(rnd() * 3);
  const missions = Array.from({ length: nm }, (_, i) => {
    const offGrid = i > 0 && rnd() < 0.7;
    const s = offGrid ? START + Math.floor(rnd() * 6) * HOUR + Math.floor(rnd() * 11 + 1) * 5 * MIN : START;
    const e = offGrid ? s + (1 + Math.floor(rnd() * 3)) * HOUR : END;
    return {
      id: `m${i + 1}`, name: `M${i + 1}`, type: 'local',
      start: offGrid ? s : undefined, end: offGrid ? e : undefined,
      count: 1 + Math.floor(rnd() * 3),
      requires: TAGS.flatMap((t) => (rnd() < 0.3 ? [{ tag: t, count: 1 + Math.floor(rnd() * 2) }] : [])),
      excludes: [],
    };
  });

  const input = {
    start: START, end: END, shiftMinutes: 60, strategy: 'balanced',
    employees, missions, pins: [], nightWindows: [], tags: TAGS.map((id) => ({ id })),
    onInvariantViolation: 'report',
  };

  let result;
  try { result = plan(input); } catch { continue; }

  const inst = toInstance(input);
  const free = solveRota(inst);
  // `capChurn: 0` from the first level: a slot is indivisible, as it is for the
  // engine. Everything else about the ladder is unchanged.
  const strict = solveRota(inst, { capChurn: 0, levels: [1, 2] });
  if (!free || !strict) continue;

  const engine = engineShortfall(result, inst);
  compared++;
  engineTotal += engine;
  costOfDiscipline += strict.unfilledSeats - free.unfilledSeats;
  greedyLoss += engine - strict.unfilledSeats;
  if (engine > strict.unfilledSeats) engineWorse++;
}

const secs = (Date.now() - started) / 1000;
console.log(`plans compared over 12h  : ${compared}`);
console.log(`seats the engine left empty: ${engineTotal}`);
console.log(`...that a slot-disciplined solver also leaves: ${engineTotal - greedyLoss}`);
console.log(`greedy loss (the real defect): ${greedyLoss}  on ${engineWorse} plans`);
console.log(`price of the slot discipline : ${costOfDiscipline} further seats`);
console.log(`elapsed                  : ${secs.toFixed(1)}s`);
