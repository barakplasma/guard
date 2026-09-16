/**
 * How many people sleep eight hours at each night shift length?
 *
 * The owner has weighed a longer or shorter night shift to let more people
 * sleep. With `nightsWithoutTargetSleep` a named quantity of the model, that is
 * a sweep rather than a redesign: prepare one document at each
 * `nightShiftMinutes`, run the ladder, and print the count of people sleeping
 * eight hours and the shortest wait at each length.
 *
 * A measurement script like the others in `scripts/`. It asserts nothing.
 *
 *   MINIZINC=/path/to/minizinc node scripts/sleepByNightShiftLength.mjs [guards] [missions]
 */
import { planSchema } from '../src/lib/planSchema.js';
import { prepareProblem } from '../src/solver/prepare.ts';
import { compileInstance } from '../src/solver/compile.ts';
import { runLadder } from '../src/solver/ladder.ts';
import { checkCandidate } from '../src/solver/check.ts';
import { minizincAvailable, NativeRunner } from '../src/solver/nativeRunner.ts';

const LENGTHS = [60, 90, 120, 180, 240];
const guards = Number(process.argv[2] ?? 8);
const missionCount = Number(process.argv[3] ?? 2);

if (!minizincAvailable()) {
  console.error('minizinc is not on PATH; set MINIZINC or install the bundle.');
  process.exit(1);
}

// 18:00 to noon the next day: one whole 22:00-06:00 night, which is the
// stretch the question is about.
const start = new Date(2026, 0, 5, 18, 0, 0, 0).getTime();

function document(nightShiftMinutes) {
  return planSchema.parse({
    version: 1,
    start,
    end: start + 18 * 60 * 60 * 1000,
    shiftMinutes: 120,
    employees: Array.from({ length: guards }, (_, i) => ({ id: `e${i + 1}`, name: `Emp${i + 1}` })),
    missions: Array.from({ length: missionCount }, (_, i) => ({
      id: `m${i + 1}`,
      name: `Mission ${i + 1}`,
      type: 'local',
      count: 1,
      nightShiftMinutes,
    })),
    pins: [],
  });
}

const runner = new NativeRunner();
console.log(`${guards} guards, ${missionCount} local missions, one night\n`);
console.log('night slot  segments  elapsed  proved  sleeping  shortest wait  unfilled');

for (const nightShiftMinutes of LENGTHS) {
  const doc = document(nightShiftMinutes);
  const problem = prepareProblem(doc, { now: start });
  const { instance, index } = compileInstance(problem);
  const controller = new AbortController();
  const began = Date.now();
  const ladder = await runLadder(instance, index, runner, problem.revision, {
    timeLimitMsPerLevel: 20_000, signal: controller.signal,
  });
  if (ladder.kind !== 'candidate') {
    console.log(`${String(nightShiftMinutes).padStart(10)}  ${String(instance.segmentCount).padStart(8)}  ${ladder.kind}`);
    continue;
  }
  const checked = await checkCandidate(instance, index, ladder.candidate, runner, controller.signal, 5000);
  const elapsed = Date.now() - began;
  if (checked.kind !== 'accepted') {
    console.log(`${String(nightShiftMinutes).padStart(10)}  ${String(instance.segmentCount).padStart(8)}  rejected: ${checked.detail}`);
    continue;
  }
  const { accepted } = checked;
  const sleeping = accepted.diagnostics.sleepsTarget.filter((row) => row.some(Boolean)).length;
  console.log([
    String(nightShiftMinutes).padStart(10),
    String(instance.segmentCount).padStart(8),
    `${String(elapsed).padStart(6)}ms`,
    String(accepted.provenLevels).padStart(6),
    String(sleeping).padStart(8),
    String(accepted.quantities.shortestWaitMinutes).padStart(13),
    String(accepted.quantities.unfilledSeatMinutes).padStart(8),
  ].join('  '));
}

await runner.dispose();
