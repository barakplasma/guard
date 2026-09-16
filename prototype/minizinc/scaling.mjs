/**
 * How far does the model actually go, and on which backend?
 *
 *   node scaling.mjs [solver] [maxHours]
 *
 * ADR 011 selected **Chuffed, explicitly**. This script is the measurement that
 * says it should not have: Chuffed proves this model's optimum up to roughly a
 * four-hour horizon and then stops proving anything at all, while three other
 * backends in the same MiniZinc distribution prove a perfectly balanced
 * 72-hour schedule in seconds.
 *
 * The fixture is `scripts/midScheduleCallout.mjs`'s roster - eight guards of
 * whom two drive, a gate wanting three, a patrol wanting two, and a callout
 * needing both drivers inserted twenty minutes past the hour - stretched to
 * each horizon. Perfect play is `u=0 f=0 churn=0`, and with 8 guards against 5
 * seats an imbalance of 0 or 1 is reachable at every length.
 *
 * `proved` is one character per lexicographic level. A level that returns a
 * value without proving it is not a result: the ladder passes each optimum down
 * as a cap, so an unproven one poisons every level below it.
 */

import { toInstance } from './fromPlan.mjs';
import { solveRota } from './solve.mjs';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const START = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();

const solver = process.argv[2] ?? 'highs';
const maxHours = Number(process.argv[3] ?? 72);

const employees = Array.from({ length: 8 }, (_, i) => ({
  id: `e${i + 1}`, name: `G${i + 1}`, tags: i < 2 ? ['driver'] : [],
}));
const at = START + 20 * MIN;

const plan = (hours) => ({
  start: START,
  end: START + hours * HOUR,
  shiftMinutes: 60,
  strategy: 'balanced',
  employees,
  missions: [
    { id: 'gate', name: 'שער', type: 'local', count: 3, requires: [], excludes: [] },
    { id: 'patrol', name: 'סיור', type: 'local', count: 2, requires: [], excludes: [] },
    {
      id: 'callout', name: 'קריאה', type: 'local', start: at, end: at + 2 * HOUR,
      count: 2, requires: [{ tag: 'driver', count: 2 }], excludes: [],
    },
  ],
  pins: [],
  nightWindows: [],
  tags: [{ id: 'driver' }],
});

console.log(`solver: ${solver}\n`);
console.log('  horizon  segments   elapsed  proved  unmet  unfilled  churn  imbalance');
for (const hours of [2, 4, 6, 12, 24, 48, 72, 96].filter((h) => h <= maxHours)) {
  const inst = toInstance(plan(hours));
  const started = Date.now();
  let got;
  try {
    got = solveRota(inst, { solver, timeLimitMs: 20000 });
  } catch (e) {
    console.log(`  ${String(hours).padStart(5)}h  ${String(inst.nS).padStart(8)}  failed: ${String(e.message).slice(0, 40)}`);
    continue;
  }
  const ms = `${Date.now() - started}ms`;
  const proof = got.levels.map((l) => (l.proved ? 'y' : 'n')).join('');
  console.log([
    `  ${String(hours).padStart(5)}h`,
    String(inst.nS).padStart(9),
    ms.padStart(10),
    proof.padStart(7),
    String(got.unmetQualifications).padStart(6),
    String(got.unfilledSeats).padStart(9),
    String(got.slotChurn).padStart(6),
    String(got.imbalance).padStart(10),
  ].join(''));
}
