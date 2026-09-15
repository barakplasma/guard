import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { plan } from '../src/lib/planner.js';
import { toPlannerInput } from '../src/lib/planSchema.js';
import { GOLDEN_DOCS, project } from './goldenDocs.js';

/**
 * The fixtures were captured from the engine as it stood before shift length
 * became a per-mission field, and none of the three documents sets one. They
 * are the standing proof of the promise the whole app rests on: a plan lives
 * in a URL, so a link someone shared last week must still render exactly the
 * schedule they shared. A refactor of the segment grid is precisely the kind
 * of change that can move every assignment in the country by an hour without
 * a single existing test noticing.
 *
 * If one of these fails, the answer is essentially never to regenerate it.
 * `scripts/writeGoldens.mjs` exists for the one case where the engine is
 * *meant* to reschedule old plans. September 2026: mixed-remote-local was
 * updated because unchanged night staffing must not split Yard's 90-minute
 * shifts. The other three legacy snapshots remain unchanged.
 */

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

for (const { name, build } of GOLDEN_DOCS) {
  test(`${name} schedules exactly as it did before shift length went per-mission`, () => {
    const doc = build();
    const actual = project(plan(toPlannerInput(doc)), doc.start);
    const expected = JSON.parse(readFileSync(join(dir, `${name}.golden.json`), 'utf8'));

    // Compared as text, not deepEqual: key order and number formatting are part
    // of "byte-identical", and a diff of the first differing row is far more
    // useful than a structural report on a 1467-row list.
    assert.equal(
      JSON.stringify(actual.shifts) === JSON.stringify(expected.shifts),
      true,
      firstDifference(actual.shifts, expected.shifts),
    );
    assert.deepEqual(actual.timeline, expected.timeline);
    assert.deepEqual(actual.stats, expected.stats);
    // Plan 04 intentionally adds diagnostic warnings; the legacy warning
    // payload and every assignment/statistic remain frozen byte-for-byte.
    const qualityCodes = new Set(['no-rest-between-shifts', 'same-mission-consecutive', 'long-unbroken-run']);
    assert.deepEqual(actual.warnings.filter((w) => !qualityCodes.has(w.code)), expected.warnings);
    assert.ok(actual.warnings.filter((w) => qualityCodes.has(w.code)).every((w) => Number.isInteger(w.count) && w.count > 0));
  });
}

function firstDifference(actual, expected) {
  const n = Math.max(actual.length, expected.length);
  for (let i = 0; i < n; i++) {
    const a = JSON.stringify(actual[i]);
    const b = JSON.stringify(expected[i]);
    if (a !== b) return `shift ${i} moved:\n  now      ${a}\n  fixture  ${b}`;
  }
  return 'shift lists differ';
}
