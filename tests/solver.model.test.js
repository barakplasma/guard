import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LEVEL_COUNT, MODEL_VERSION, OBJECTIVE_ORDER } from '../src/solver/types.ts';
import { readModelSources } from '../src/solver/nativeRunner.ts';
import { docOf, people, skipWithoutSolver, solve } from './solverHelpers.js';

/**
 * The two constants the TypeScript and the model both carry, and the fact that
 * both entry files actually compile.
 *
 * `echoedModelVersion` is the one field in the output that says the JSON came
 * from the model this build knows. It is only worth anything while the number
 * on this side is the number in `rota-core.mzn`, which nothing but a test can
 * keep true.
 */

const core = readFileSync(fileURLToPath(new URL('../src/solver/model/rota-core.mzn', import.meta.url)), 'utf8');

const constantIn = (source, name) => {
  const match = source.match(new RegExp(`int:\\s*${name}\\s*=\\s*(\\d+);`));
  assert.ok(match, `${name} is declared in rota-core.mzn`);
  return Number(match[1]);
};

test('MODEL_VERSION in TypeScript equals the model\'s', () => {
  assert.equal(constantIn(core, 'MODEL_VERSION'), MODEL_VERSION);
});

test('LEVEL_COUNT agrees, and the objective list is that long', () => {
  assert.equal(constantIn(core, 'LEVEL_COUNT'), LEVEL_COUNT);
  assert.equal(OBJECTIVE_ORDER.length, LEVEL_COUNT);
});

test('the objectives array lists the quantities in ladder order', () => {
  const block = core.slice(core.indexOf('array[Levels] of var int: objectives = ['));
  const listed = block.slice(0, block.indexOf('];'))
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/[,\s]/)[0])
    .filter(Boolean);
  assert.deepEqual(listed, [...OBJECTIVE_ORDER]);
});

test('every quantity the schema expects is annotated for output', () => {
  for (const name of [...OBJECTIVE_ORDER, 'shortestWaitMinutes', 'echoedModelVersion',
    'assignedMission', 'seatsFilled', 'qualifiedSeatsFilled', 'nightRestMinutes',
    'sleepsTarget', 'longRunsByEmployee', 'dutyMinutes', 'turnsTaken', 'turnsOnMission',
    'nightMinutesInWindow']) {
    assert.match(core, new RegExp(`${name}\\s*::\\s*add_to_output`), `${name} is in the output contract`);
  }
});

test('the three files are the ones both runners read', () => {
  const sources = readModelSources();
  assert.equal(sources.core, core);
  assert.match(sources.optimize, /include "rota-core.mzn"/);
  assert.match(sources.check, /include "rota-core.mzn"/);
  assert.match(sources.optimize, /minimize objectives\[objectiveLevel\]/);
  assert.match(sources.check, /candidateAssignment/);
});

test('both entry files compile and run against a real instance', skipWithoutSolver, async () => {
  const start = new Date(2026, 0, 5, 12, 0, 0, 0).getTime();
  const { accepted, ladder, checked } = await solve(docOf({
    start,
    end: start + 2 * 60 * 60 * 1000,
    employees: people(2),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
  }));
  assert.equal(ladder.kind, 'candidate', 'rota-optimize.mzn compiled and solved');
  assert.equal(checked.kind, 'accepted', 'rota-check.mzn compiled and agreed');
  assert.equal(accepted.provenLevels, LEVEL_COUNT);
});
