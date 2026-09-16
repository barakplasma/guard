/**
 * Run the MiniZinc ladder against the brute-force oracle on random instances.
 *
 *   node check.mjs [count] [firstSeed] [solver]
 *
 * Reports the first disagreement with its seed, so it can be replayed. Needs a
 * `minizinc` binary on PATH; see ADR 011 for what is being measured and why.
 */

import { solveRota } from './solve.mjs';
import { bruteForce, randomInstance, score, violations } from './oracle.mjs';

const count = Number(process.argv[2] ?? 200);
const first = Number(process.argv[3] ?? 1);
const solver = process.argv[4] ?? 'highs';

let checked = 0;
let unsat = 0;
const started = Date.now();

for (let seed = first; seed < first + count; seed++) {
  const inst = randomInstance(seed);
  const truth = bruteForce(inst);
  const got = solveRota(inst, { solver });

  if (!truth) {
    // The oracle found nothing feasible, so the solver must agree.
    if (got) {
      console.error(`seed ${seed}: solver answered where no assignment exists`);
      process.exit(1);
    }
    unsat++;
    continue;
  }
  if (!got) {
    console.error(`seed ${seed}: solver reported UNSAT, oracle found ${truth.score}`);
    console.error(JSON.stringify(inst));
    process.exit(1);
  }
  const bad = violations(inst, got.x);
  if (bad.length) {
    console.error(`seed ${seed}: solver broke a hard rule: ${bad.join('; ')}`);
    console.error(JSON.stringify(inst));
    process.exit(1);
  }
  // The solver's own reported objectives must match what its assignment
  // actually scores - a mismatch means the model computes something other than
  // what it claims, which no amount of agreeing on the total would reveal.
  const scored = score(inst, got.x);
  const claimed = [got.unmetQualifications, got.unfilledSeats, got.slotChurn, got.imbalance];
  if (scored.join() !== claimed.join()) {
    console.error(`seed ${seed}: model reports ${claimed} but its assignment scores ${scored}`);
    console.error(JSON.stringify(inst));
    process.exit(1);
  }
  if (scored.join() !== truth.score.join()) {
    console.error(`seed ${seed}: solver ${scored}, oracle ${truth.score}`);
    console.error(JSON.stringify(inst));
    process.exit(1);
  }
  if (!got.levels.every((l) => l.proved)) {
    console.error(`seed ${seed}: a level finished without proving optimality`);
    process.exit(1);
  }
  checked++;
}

const secs = (Date.now() - started) / 1000;
console.log(`${checked} instances agreed with the oracle (${unsat} infeasible) via ${solver} in ${secs.toFixed(1)}s`);
