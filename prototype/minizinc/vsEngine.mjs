/**
 * The measurement ADR 011 actually turns on: at the instants where the shipped
 * engine reports a shortage, does the model find a full staffing?
 *
 *   node vsEngine.mjs [iterations]
 *
 * `scripts/offGridFuzz.mjs` established that 2.8% of the engine's shortage
 * instants are provably false - a full staffing exists and the greedy walk did
 * not find it, because it never reconsiders a placement. That script proves the
 * staffing exists with a bespoke recursive search written for the purpose. This
 * one asks the same question of `rota.mzn`, which is the thing that would
 * actually ship.
 *
 * One shortage instant is one *segment*: the missions live at that moment, each
 * wanting its headcount, everybody free. No rest and no availability windows, so
 * the instants are independent and a single-segment instance is the whole
 * question. That is a narrower claim than "the model schedules the rota" and it
 * is deliberately the narrow one - it is the claim the defect is about.
 *
 * The generator is `offGridFuzz.mjs`'s, seed included, so the two scripts are
 * looking at the same instances.
 */

import { plan } from '../../src/lib/planner.js';
import { solveRota } from './solve.mjs';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const START = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
const END = START + 12 * HOUR;
const TAGS = ['driver', 'commander', 'medic'];

const iterations = Number(process.argv[2] ?? 400);

let state = 20260915;
const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;

/** The instant's live missions as a one-segment instance of the model. */
function instantInstance(employees, live) {
  const nE = employees.length;
  const nM = live.length;
  const requires = [];
  live.forEach((m, mi) => {
    for (const r of m.requires ?? []) {
      requires.push({ mission: mi, count: r.count, holds: employees.map((e) => e.tags.includes(r.tag)) });
    }
  });
  return {
    nE,
    nM,
    nS: 1,
    want: live.map((m) => [m.count]),
    // One segment, so every mission's single segment is its own slot and the
    // churn term has nothing to say here by construction.
    slotOf: live.map(() => [0]),
    avail: employees.map(() => [true]),
    allowed: employees.map((e) => live.map((m) => !(m.excludes ?? []).some((t) => e.tags.includes(t)))),
    pinned: employees.map(() => live.map(() => [false])),
    requires,
  };
}

let instants = 0;
let solverFilled = 0;
let solverAgreedShort = 0;
let plansShort = 0;
let plansWithAFalseShortage = 0;
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

  let result;
  try {
    result = plan({
      start: START, end: END, shiftMinutes: 60, strategy: 'balanced',
      employees, missions, pins: [], nightWindows: [], tags: TAGS.map((id) => ({ id })),
      onInvariantViolation: 'report',
    });
  } catch { continue; }

  const short = result.warnings.filter((w) => w.code === 'understaffed' || w.code === 'missing-required-tag');
  if (!short.length) continue;

  for (const w of short) {
    const t = w.start ?? w.windows?.[0]?.start;
    if (t == null) continue;
    const live = missions.filter((m) => (m.start ?? START) <= t && (m.end ?? END) > t);
    if (!live.length) continue;
    instants++;
    const got = solveRota(instantInstance(employees, live));
    if (!got) throw new Error('the model found no assignment where an empty one is always feasible');
    // Every seat filled and every qualification met is exactly what the engine
    // said could not be done at this instant.
    if (got.unmetQualifications === 0 && got.unfilledSeats === 0) {
      solverFilled++;
      plansWithAFalseShortage++;
      break;
    }
    solverAgreedShort++;
  }
  plansShort++;
}

const secs = (Date.now() - started) / 1000;
console.log(`shortage instants solved  : ${instants}`);
console.log(`model found a full crew   : ${solverFilled}  (${instants ? (100 * solverFilled / instants).toFixed(1) : 0}%)`);
console.log(`model agreed it was short : ${solverAgreedShort}`);
// Two denominators, because they answer different questions and mixing them up
// is easy. offGridFuzz.mjs reports the first: shortage warnings examined. The
// second is the one a user feels - plans where the app cried short and a full
// crew existed.
console.log(`plans with a shortage     : ${plansShort}`);
console.log(`...of which falsely short : ${plansWithAFalseShortage}  (${plansShort ? (100 * plansWithAFalseShortage / plansShort).toFixed(1) : 0}%)`);
console.log(`elapsed                   : ${secs.toFixed(1)}s  (${instants ? (1000 * secs / instants).toFixed(0) : 0}ms per instant, three solves each)`);
