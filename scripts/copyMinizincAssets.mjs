/**
 * Copy MiniZinc's WebAssembly assets into `public/solver/`.
 *
 * The worker script, the `.wasm` and the `.data` file cannot be bundled the
 * way a module can - the worker fetches them by URL at init - so they are
 * served as static assets and precached by the service worker. `public/solver`
 * is gitignored: these are build outputs of a dependency, not source.
 *
 * Run from `prebuild` and `predev` so a checkout that has only ever run
 * `npm install` still has them.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, 'public', 'solver');

const FILES = ['minizinc-worker.js', 'minizinc.wasm', 'minizinc.data'];

async function main() {
  // Reached by path rather than by `require.resolve`: the package's `exports`
  // map deliberately does not expose `package.json`, and the three files below
  // are worker assets rather than module entry points.
  const dist = join(root, 'node_modules', 'minizinc', 'dist');
  try {
    await stat(dist);
  } catch {
    // Not installed yet (a bare checkout running `npm run dev` before
    // `npm install` finishes). The build fails loudly later if it matters.
    console.warn('minizinc is not installed; skipping solver assets');
    return;
  }
  await mkdir(target, { recursive: true });
  for (const file of FILES) {
    await copyFile(join(dist, file), join(target, file));
  }
  console.log(`copied ${FILES.length} MiniZinc assets into public/solver`);
}

await main();
