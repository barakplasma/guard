/**
 * The Node-side runner: a real `minizinc` binary, for tests and the
 * measurement scripts.
 *
 * Its own module, and never imported by anything the browser bundles - the
 * static `node:` imports below would otherwise end up in the module graph of a
 * page that must run offline with no platform underneath it.
 *
 * It skips itself when the binary is absent, and the tests that need it report
 * *skipped* rather than passed: a green run that proved nothing is worse than
 * a red one.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseJsonStream, SOLVER_OPTIONS } from './runner.ts';
import type { MiniZincRunner, ModelSources, RunRequest, RunResult } from './runner.ts';

const MODEL_DIR = fileURLToPath(new URL('./model/', import.meta.url));

/** The three model files, read off disk. The browser gets them through `?raw`. */
export function readModelSources(): ModelSources {
  return {
    core: readFileSync(join(MODEL_DIR, 'rota-core.mzn'), 'utf8'),
    optimize: readFileSync(join(MODEL_DIR, 'rota-optimize.mzn'), 'utf8'),
    check: readFileSync(join(MODEL_DIR, 'rota-check.mzn'), 'utf8'),
  };
}

export function minizincBinary(): string {
  return process.env.MINIZINC ?? 'minizinc';
}

/** Is a solver actually reachable? Called by every test that needs one. */
export function minizincAvailable(binary = minizincBinary()): boolean {
  try {
    return spawnSync(binary, ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

export class NativeRunner implements MiniZincRunner {
  #binary: string;

  #modelDir: string;

  constructor(options: { binary?: string; modelDir?: string } = {}) {
    this.#binary = options.binary ?? minizincBinary();
    // The files stay where they are so `minizinc` resolves the core's
    // `include` itself, instead of a temp copy that could drift from them.
    this.#modelDir = options.modelDir ?? MODEL_DIR;
  }

  async run(request: RunRequest, signal: AbortSignal): Promise<RunResult> {
    const dir = await mkdtemp(join(tmpdir(), 'guard-mzn-'));
    try {
      const dataPath = join(dir, 'data.json');
      await writeFile(dataPath, JSON.stringify(request.data));
      const args = [
        '--json-stream', '--output-mode', 'json', '--solver', SOLVER_OPTIONS.solver,
        '-f', '--statistics', '--time-limit', String(request.timeLimitMs),
        join(this.#modelDir, request.entry), dataPath,
      ];
      return await new Promise<RunResult>((resolve) => {
        const child = spawn(this.#binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let cancelled = false;
        let stdout = '';
        let stderr = '';
        const cancel = () => { cancelled = true; child.kill('SIGTERM'); };
        if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });

        child.stdout.on('data', (chunk) => { stdout += String(chunk); });
        child.stderr.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', (error) => {
          signal.removeEventListener('abort', cancel);
          resolve({ kind: 'failed', reason: 'worker', detail: String(error) });
        });
        child.on('close', () => {
          signal.removeEventListener('abort', cancel);
          resolve(cancelled ? { kind: 'cancelled' } : parseJsonStream(stdout, stderr));
        });
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async dispose(): Promise<void> { /* nothing to hold open */ }
}
