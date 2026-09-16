import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const model = join(here, 'minizincGuardReference.mzn');
const scratch = mkdtempSync(join(tmpdir(), 'guard-minizinc-'));
const solver = process.env.MZN_SOLVER || 'gecode';

function pass(data, stage, best_coverage = 0, best_max_load = 0) {
  const input = join(scratch, `${stage}.json`);
  writeFileSync(input, JSON.stringify({ ...data, stage, best_coverage, best_max_load }));
  const run = spawnSync('minizinc',
    ['--solver', solver, model, input],
    { encoding: 'utf8', timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  if (!/==========/.test(run.stdout)) console.error({ stage, best_coverage, best_max_load, stdout: run.stdout });
  assert.match(run.stdout, /==========/, 'optimality was not proven');
  const solutions = [...run.stdout.matchAll(/(\{[\s\S]*?\})\n----------/g)];
  assert.ok(solutions.length > 0, run.stdout);
  return JSON.parse(solutions.at(-1)[1]);
}
function solve(data) {
  const coverage = pass(data, 1);
  // Fairness is never optimized while a correctness error remains. Besides
  // matching the product priority, this avoids spending CI time proving which
  // incomplete schedule is fairest.
  if (coverage.coverage_error > 0) return coverage;
  const load = pass(data, 2, coverage.coverage_error);
  return pass(data, 3, coverage.coverage_error, load.max_load);
}
const cube = (p, m, t, value) => Array.from({ length: p }, () =>
  Array.from({ length: m }, () => Array(t).fill(value)));
const fixture = ({ people, missions, durations, qualifications = 1 }) => ({
  P: people, M: missions, T: durations.length, Q: qualifications, duration: durations,
  demand: Array.from({ length: missions }, () => Array(durations.length).fill(0)),
  available: Array.from({ length: people }, () => Array(durations.length).fill(true)),
  excluded: Array.from({ length: people }, () => Array(missions).fill(false)),
  has_qualification: Array.from({ length: people }, () => Array(qualifications).fill(false)),
  required_qualification: Array.from({ length: missions }, () => Array(qualifications).fill(0)),
  pinned: cube(people, missions, durations.length, false),
  history: cube(people, missions, durations.length, -1),
});
const works = (result, data, person, mission, time) =>
  result.work[((person * data.M) + mission) * data.T + time];

try {
  const callout = fixture({ people: 8, missions: 3, durations: [20, 40, 60, 20] });
  callout.demand = [[3,3,3,3], [2,2,2,2], [0,2,2,2]];
  callout.has_qualification[0][0] = true;
  callout.has_qualification[1][0] = true;
  callout.required_qualification[2][0] = 2;
  const calloutResult = solve(callout);
  assert.equal(calloutResult.coverage_error, 0);
  for (const t of [1,2,3]) {
    assert.equal(works(calloutResult, callout, 0, 2, t), true);
    assert.equal(works(calloutResult, callout, 1, 2, t), true);
  }

  const impossible = structuredClone(callout);
  impossible.has_qualification[1][0] = false;
  const impossibleResult = solve(impossible);
  assert.ok(impossibleResult.coverage_error > 0);

  const pinned = structuredClone(callout);
  pinned.pinned[1][0][1] = true;
  const pinnedResult = solve(pinned);
  assert.equal(works(pinnedResult, pinned, 1, 0, 1), true);
  assert.ok(pinnedResult.coverage_error > 0);

  const dual = fixture({ people: 1, missions: 1, durations: [60], qualifications: 2 });
  dual.demand[0][0] = 1;
  dual.has_qualification[0] = [true, true];
  dual.required_qualification[0] = [1, 1];
  const dualResult = solve(dual);
  assert.equal(dualResult.coverage_error, 0);
  assert.equal(works(dualResult, dual, 0, 0, 0), true);

  const excluded = fixture({ people: 2, missions: 1, durations: [60] });
  excluded.demand[0][0] = 1;
  excluded.excluded[0][0] = true;
  const excludedResult = solve(excluded);
  assert.equal(works(excludedResult, excluded, 0, 0, 0), false);
  assert.equal(works(excludedResult, excluded, 1, 0, 0), true);

  const fair = fixture({ people: 4, missions: 1, durations: [60,60,60,60] });
  fair.demand[0] = [2,2,2,2];
  const fairResult = solve(fair);
  assert.equal(fairResult.coverage_error, 0);
  assert.equal(fairResult.max_load, 120);
  assert.equal(fairResult.spread, 0);

  const history = fixture({ people: 2, missions: 1, durations: [60,60] });
  history.demand[0] = [1,1];
  history.history[0][0][0] = 1;
  history.history[1][0][0] = 0;
  const historyResult = solve(history);
  assert.equal(works(historyResult, history, 0, 0, 0), true);
  assert.equal(works(historyResult, history, 1, 0, 0), false);

  console.log(JSON.stringify({
    solver: `MiniZinc CLI / ${solver}`,
    sharedRuntimeModel: 'scripts/minizincGuardReference.mzn',
    cases: 7,
    offGridCoverageError: calloutResult.coverage_error,
    infeasibleCoverageError: impossibleResult.coverage_error,
    pinnedCoverageError: pinnedResult.coverage_error,
    fairness: {
      maxLoad: fairResult.max_load,
      spread: fairResult.spread,
      workload: fairResult.workload,
    },
  }, null, 2));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
