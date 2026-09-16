/**
 * Evidence for ADR 008 defect 3 (docs/plans/08-history-and-staffing-bugs.md):
 * is the staffing pass *complete*?
 *
 * The engine fills one (mission, segment) demand at a time and never
 * reconsiders. Inside a single segment that is a bipartite assignment problem
 * walked greedily, so it can hand mission A somebody mission B needed and then
 * report a shortage that is an artifact of the walk rather than a fact about
 * the roster - the failure ADR 005's planning notes predicted ("filling the
 * commander seat by preference strands the driver seat and reports a shortage
 * that does not exist") and answered with scarcity ordering.
 *
 * This script measures how much of that gap scarcity ordering actually closed,
 * in two regimes, because the answer differs sharply between them:
 *
 *   1. Adversarial: small rosters, randomly placed exclusions. Single-slot,
 *      local-only plans with no night and no rest, so the whole problem is one
 *      independent segment that brute force settles exactly.
 *   2. Realistic: the rota shape AGENTS.md describes - a driver-required
 *      patrol, a gate, a commander-excluded kitchen, four days, hourly, swept
 *      from a critically tight roster up to a comfortable one.
 *
 * It is a measurement, not a test: it asserts nothing and is not part of
 * `npm test`. Run it with `node scripts/completenessSearch.mjs`.
 *
 * ponytail: brute force is exponential in headcount, which is why regime 1 is
 * capped at ten employees and three missions. It is an oracle for small
 * instances, not a scheduler. The upgrade path, if this ever needs to run over
 * a realistic roster, is the solver in ADR 011.
 */

import { plan } from '../src/lib/planner.js';

const HOUR = 60 * 60 * 1000;
const TAGS = ['driver', 'commander', 'medic'];

/**
 * Exact: can every mission be staffed to headcount with its tags covered?
 * Missions are placed in order with backtracking, so a "no" is a real proof
 * that no assignment exists, not a failure to find one.
 */
const covers = (crew, m) => m.requires.every(
  (r) => crew.filter((e) => e.tags.includes(r.tag)).length >= r.count,
);

function fullyStaffable(employees, missions) {
  const used = Array.from({ length: employees.length }, () => false);
  const place = (mi) => {
    if (mi === missions.length) return true;
    const m = missions[mi];
    const pool = employees.flatMap((e, i) => (
      !used[i] && !m.excludes.some((t) => e.tags.includes(t)) ? [i] : []
    ));
    if (pool.length < m.count) return false;
    const choose = (from, picked) => {
      if (picked.length === m.count) {
        if (!covers(picked.map((i) => employees[i]), m)) return false;
        picked.forEach((i) => { used[i] = true; });
        if (place(mi + 1)) return true;
        picked.forEach((i) => { used[i] = false; });
        return false;
      }
      for (let k = from; k < pool.length; k++) {
        if (choose(k + 1, [...picked, pool[k]])) return true;
      }
      return false;
    };
    return choose(0, []);
  };
  return place(0);
}

const shortagesOf = (result) => result.warnings.filter(
  (w) => w.code === 'understaffed' || w.code === 'missing-required-tag',
);

/* ------------------------------------------------------------------ */
/* Regime 1: adversarial small rosters                                 */
/* ------------------------------------------------------------------ */

const START = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
const SLOT_END = START + HOUR;

const planSlot = (employees, missions) => plan({
  start: START, end: SLOT_END, shiftMinutes: 60, strategy: 'balanced',
  employees, missions, pins: [], nightWindows: [],
  tags: TAGS.map((id) => ({ id })),
  onInvariantViolation: 'report',
});

/** Deterministic, so every rate printed here is reproducible and citable. */
function sweepRandom({ headcount, excludeRate, iterations = 8000, seed = 4242 }) {
  let state = seed;
  const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  let feasible = 0;
  const examples = [];
  let wrong = 0;
  for (let i = 0; i < iterations; i++) {
    const employees = Array.from({ length: headcount }, (_, j) => ({
      id: `e${j + 1}`, name: `E${j + 1}`, tags: TAGS.filter(() => rnd() < 0.4),
    }));
    const missions = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, j) => ({
      id: `m${j + 1}`, name: `M${j + 1}`, type: 'local',
      count: 1 + Math.floor(rnd() * 2),
      requires: TAGS.flatMap((t) => (rnd() < 0.25 ? [{ tag: t, count: 1 }] : [])),
      excludes: TAGS.filter(() => rnd() < excludeRate),
    }));
    if (!fullyStaffable(employees, missions)) continue;
    feasible++;
    const short = shortagesOf(planSlot(employees, missions));
    if (!short.length) continue;
    wrong++;
    if (examples.length < 2) examples.push({ employees, missions, short });
  }
  return { feasible, wrong, examples };
}

const describe = ({ employees, missions, short }) => [
  `      employees: ${employees.map((e) => `${e.id}[${e.tags.join(',') || '-'}]`).join(' ')}`,
  `      missions : ${missions.map((m) => `${m.id} count=${m.count}`
    + ` requires=${m.requires.map((r) => `${r.tag}x${r.count}`).join('+') || '-'}`
    + ` excludes=${m.excludes.join(',') || '-'}`).join(' | ')}`,
  `      engine   : ${[...new Set(short.map((w) => w.code))].join(', ')}`,
].join('\n');

console.log('Regime 1 - adversarial: small rosters, random exclusions\n');
console.log('  roster  exclusions   feasible   falsely short    rate');
let firstExample = null;
for (const headcount of [3, 4, 5, 6, 8, 10]) {
  for (const [label, excludeRate] of [['none ', 0], ['some ', 0.12], ['many ', 0.3]]) {
    const { feasible, wrong, examples } = sweepRandom({ headcount, excludeRate });
    if (!feasible) continue;
    firstExample ??= examples[0];
    const rate = (100 * wrong / feasible).toFixed(2);
    console.log(`  ${String(headcount).padStart(4)}    ${label}      ${String(feasible).padStart(6)}`
      + `   ${String(wrong).padStart(10)}   ${rate.padStart(6)}%`);
  }
}
if (firstExample) {
  console.log('\n  a falsely-short instance (every mission is staffable in full):');
  console.log(describe(firstExample));
}

/* ------------------------------------------------------------------ */
/* Regime 2: the rota shape this app is actually used for              */
/* ------------------------------------------------------------------ */

/** Patrol needs a driver, kitchen refuses commanders - AGENTS.md's example. */
const REAL_MISSIONS = [
  { id: 'patrol', name: 'Patrol', type: 'local', count: 3, nightCount: 2, requires: [{ tag: 'driver', count: 1 }], excludes: [] },
  { id: 'gate', name: 'Gate', type: 'local', count: 4, nightCount: 3, requires: [], excludes: [] },
  { id: 'kitchen', name: 'Kitchen', type: 'local', count: 3, nightCount: 1, requires: [], excludes: ['commander'] },
];

function realisticRota(headcount, days = 4) {
  const end = START + days * 24 * HOUR;
  const employees = Array.from({ length: headcount }, (_, i) => ({
    id: `e${i + 1}`, name: `G${i + 1}`,
    tags: [...(i % 4 === 0 ? ['driver'] : []), ...(i % 5 === 0 ? ['commander'] : [])],
  }));
  const nightWindows = Array.from({ length: days + 1 }, (_, d) => {
    const base = new Date(2026, 0, 5 + d, 22, 0, 0, 0).getTime();
    return { start: base, end: base + 8 * HOUR };
  }).filter((w) => w.end > START && w.start < end);

  const result = plan({
    start: START, end, shiftMinutes: 60, strategy: 'rotation',
    employees, missions: REAL_MISSIONS, pins: [], nightWindows,
    tags: [{ id: 'driver' }, { id: 'commander' }],
    onInvariantViolation: 'report',
  });

  // Re-solve each reported-short segment exactly over everyone free in it.
  // Nobody is availability-limited and no mission is remote, so within a
  // segment the whole roster is free and one exact pass settles it.
  const isNight = (t) => nightWindows.some((w) => t >= w.start && t < w.end);
  const short = shortagesOf(result);
  const artifacts = short.filter((w) => fullyStaffable(
    employees,
    REAL_MISSIONS.map((m) => ({ ...m, count: isNight(w.start) ? (m.nightCount ?? m.count) : m.count })),
  )).length;

  const minutes = result.stats.perEmployee.map((s) => s.minutes).sort((a, b) => a - b);
  return {
    shifts: result.shifts.length,
    short: short.length,
    artifacts,
    spreadHours: ((minutes.at(-1) - minutes[0]) / 60).toFixed(1),
  };
}

console.log('\n\nRegime 2 - realistic: patrol + gate + kitchen, 4 days, hourly, rotation');
console.log('  (10 seats by day, so 10 guards is a critically tight roster)\n');
console.log('  guards   shifts   reported short   of those, false   hours spread');
for (const headcount of [10, 11, 12, 13, 14, 15, 17, 20]) {
  const r = realisticRota(headcount);
  console.log(`  ${String(headcount).padStart(6)}   ${String(r.shifts).padStart(6)}`
    + `   ${String(r.short).padStart(14)}   ${String(r.artifacts).padStart(15)}`
    + `   ${String(r.spreadHours).padStart(9)}h`);
}
