/**
 * Sequential lexicographic driver for `rota.mzn` (ADR 011's prototype).
 *
 * MiniZinc has no portable lexicographic `solve minimize [a, b, c]` across
 * backends, so the ladder is climbed here: solve for level 1, read its proven
 * optimum, pass it back as a cap, solve for level 2 inside that set, and so on.
 * Three solves of one model, not three models - the hard rules have a single
 * definition, which is the entire point of moving them into a model.
 *
 * This is prototype code. It shells out to a MiniZinc binary and is measured by
 * `oracle.mjs`; nothing in `src/` imports it.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MODEL = join(HERE, 'rota.mzn');

const bool = (b) => (b ? 'true' : 'false');

/**
 * @typedef {object} Instance
 * @property {number} nE
 * @property {number} nM
 * @property {number} nS
 * @property {number[][]} want      seats per [mission][segment], 0 = not running
 * @property {number[][]} slotOf    grid slot id per [mission][segment]
 * @property {number[][]} holdOf    indivisible-hold group id, 0 = none
 * @property {boolean[][]} avail    [employee][segment]
 * @property {boolean[][]} allowed  [employee][mission]
 * @property {boolean[][][]} pinned [employee][mission][segment]
 * @property {{mission:number,count:number,holds:boolean[]}[]} requires 0-based mission
 */

/**
 * Interchangeable employees, as a class id each.
 *
 * Derived here rather than taken from the caller: it is a property of the
 * instance, and a caller that got it wrong would silently prune real solutions.
 * Two employees are interchangeable when nothing in the instance distinguishes
 * them - same availability, same exclusions, same qualifications, and neither
 * pinned anywhere, since a pin names a person.
 */
function symClasses(inst) {
  const key = (e) => (inst.pinned[e].some((row) => row.some(Boolean))
    ? `pinned:${e}`
    : [
      inst.avail[e].map(Number).join(''),
      inst.allowed[e].map(Number).join(''),
      inst.requires.map((r) => Number(r.holds[e])).join(''),
    ].join('|'));
  const ids = new Map();
  const seen = new Map();
  for (let e = 0; e < inst.nE; e++) {
    const k = key(e);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  let next = 1;
  return Array.from({ length: inst.nE }, (_, e) => {
    const k = key(e);
    if (seen.get(k) < 2) return 0;
    if (!ids.has(k)) ids.set(k, next++);
    return ids.get(k);
  });
}

/** MiniZinc data for an instance. Indices are 1-based on the model's side. */
export function toDzn(inst, { level, capUnmet, capUnfilled, capChurn }) {
  const { nE, nM, nS } = inst;
  const flatPinned = [];
  for (let e = 0; e < nE; e++) {
    for (let m = 0; m < nM; m++) {
      for (let s = 0; s < nS; s++) flatPinned.push(bool(inst.pinned[e][m][s]));
    }
  }
  const req = inst.requires;
  return [
    `nE = ${nE};`,
    `nM = ${nM};`,
    `nS = ${nS};`,
    `want = array2d(1..${nM}, 1..${nS}, [${inst.want.flat().join(', ')}]);`,
    `slotOf = array2d(1..${nM}, 1..${nS}, [${inst.slotOf.flat().join(', ')}]);`,
    `holdOf = array2d(1..${nM}, 1..${nS}, [${inst.holdOf.flat().join(', ')}]);`,
    `avail = array2d(1..${nE}, 1..${nS}, [${inst.avail.flat().map(bool).join(', ')}]);`,
    `allowed = array2d(1..${nE}, 1..${nM}, [${inst.allowed.flat().map(bool).join(', ')}]);`,
    `pinned = array3d(1..${nE}, 1..${nM}, 1..${nS}, [${flatPinned.join(', ')}]);`,
    `nReq = ${req.length};`,
    `reqMission = [${req.map((r) => r.mission + 1).join(', ')}];`,
    `reqCount = [${req.map((r) => r.count).join(', ')}];`,
    // array2d rejects a zero-length first dimension the way `[]` does not, so an
    // instance with no qualification requirements writes the empty literal.
    req.length
      ? `reqHolds = array2d(1..${req.length}, 1..${nE}, [${req.flatMap((r) => r.holds.map(bool)).join(', ')}]);`
      : 'reqHolds = array2d(1..0, 1..0, []);',
    `level = ${level};`,
    `capUnmet = ${capUnmet};`,
    `capUnfilled = ${capUnfilled};`,
    `capChurn = ${capChurn};`,
    `symClass = [${symClasses(inst).join(', ')}];`,
    '',
  ].join('\n');
}

function parseOutput(text, inst) {
  const num = (key) => {
    const m = text.match(new RegExp(`${key} = (-?\\d+);`));
    if (!m) throw new Error(`solver output has no ${key}:\n${text}`);
    return Number(m[1]);
  };
  const xs = text.match(/x = \[([^\]]*)\];/);
  if (!xs) throw new Error(`solver output has no assignment:\n${text}`);
  const flat = xs[1].split(',').map((v) => Number(v.trim()));
  const { nE, nM, nS } = inst;
  const x = [];
  let i = 0;
  for (let e = 0; e < nE; e++) {
    x.push([]);
    for (let m = 0; m < nM; m++) {
      x[e].push([]);
      for (let s = 0; s < nS; s++) x[e][m].push(flat[i++] === 1);
    }
  }
  return {
    x,
    unmetQualifications: num('unmetQualifications'),
    unfilledSeats: num('unfilledSeats'),
    slotChurn: num('slotChurn'),
    imbalance: num('imbalance'),
  };
}

/**
 * One MiniZinc run. `solver` and `timeLimitMs` are passed through so the
 * measurement script can vary them without this file knowing what it is
 * measuring.
 */
function runOnce(inst, level, caps, { solver, timeLimitMs, mzn }) {
  const dir = mkdtempSync(join(tmpdir(), 'rota-'));
  try {
    const data = join(dir, 'inst.dzn');
    writeFileSync(data, toDzn(inst, { level, ...caps }));
    // `-f` hands the search over to the solver's own heuristics instead of the
    // model's declaration order. Not a micro-optimisation: on the callout
    // fixture Chuffed's default fixed order returned UNKNOWN - no solution at
    // all - in thirty seconds on the churn level, and free search proved the
    // optimum in well under one. Optimality proofs stay proofs either way; the
    // driver checks for them separately.
    const args = ['--solver', solver, '--output-mode', 'item', '-f'];
    if (timeLimitMs) args.push('--time-limit', String(timeLimitMs));
    args.push(mzn, data);
    const out = execFileSync('minizinc', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (out.includes('=====UNSATISFIABLE=====')) return null;
    // Without `=========` MiniZinc only proved the bound it printed, not
    // optimality - a capped round that stopped early would be reported as an
    // optimum and poison every level below it.
    return { ...parseOutput(out, inst), proved: out.includes('==========') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Climb the ladder. Returns the last level's solution plus each level's optimum, or
 * `null` if the hard constraints alone are unsatisfiable - which for this model
 * means contradictory pins, since every soft goal is a slack term.
 */
export function solveRota(inst, opts = {}) {
  // HiGHS rather than Chuffed, on measurement - see `scaling.mjs` and ADR 011.
  // Chuffed proves this model's optimum up to about a four-hour horizon and
  // then stops proving anything, which is not a tuning problem: the fairness
  // level is a bound on a sum over every assignment, and a MIP relaxation gives
  // that away for free where lazy clause generation has to search for it.
  const cfg = { solver: 'highs', timeLimitMs: 0, mzn: MODEL, ...opts };
  // A caller may pin a cap before the ladder starts and may climb only part of
  // it. `vsPlan.mjs` uses both to hold `slotChurn` at zero from the first level,
  // which is how the engine treats a slot - indivisible - so the two can be
  // compared on the same terms.
  let caps = {
    capUnmet: cfg.capUnmet ?? -1,
    capUnfilled: cfg.capUnfilled ?? -1,
    capChurn: cfg.capChurn ?? -1,
  };
  let best = null;
  const levels = [];
  for (const level of cfg.levels ?? [1, 2, 3, 4]) {
    const got = runOnce(inst, level, caps, cfg);
    if (!got) return null;
    best = got;
    const reached = [got.unmetQualifications, got.unfilledSeats, got.slotChurn, got.imbalance][level - 1];
    levels.push({ level, objective: reached, proved: got.proved });
    if (level === 1) caps = { ...caps, capUnmet: got.unmetQualifications };
    if (level === 2) caps = { ...caps, capUnfilled: got.unfilledSeats };
    // A cap the caller pinned is theirs, not the ladder's to overwrite.
    if (level === 3 && cfg.capChurn == null) caps = { ...caps, capChurn: got.slotChurn };
  }
  return { ...best, levels };
}
