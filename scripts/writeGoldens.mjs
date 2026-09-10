/**
 * Regenerate the golden schedule fixtures in `tests/fixtures/`.
 *
 * Run it only when a change to the engine is *meant* to move existing plans -
 * which, for a document that sets none of the newer per-mission fields, it
 * never is. The whole point of the fixtures is that this script does not need
 * running. `node scripts/writeGoldens.mjs`
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { plan } from '../src/lib/planner.js';
import { toPlannerInput } from '../src/lib/planSchema.js';
import { GOLDEN_DOCS, project } from '../tests/goldenDocs.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
mkdirSync(dir, { recursive: true });

for (const { name, build } of GOLDEN_DOCS) {
  const doc = build();
  const snapshot = project(plan(toPlannerInput(doc)), doc.start);
  const file = join(dir, `${name}.golden.json`);
  writeFileSync(file, `${JSON.stringify(snapshot)}\n`);
  console.log(`${file}: ${snapshot.shifts.length} shifts`);
}
