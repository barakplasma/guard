/**
 * One way in to MiniZinc, three implementations behind it.
 *
 * The seam exists so the ladder and the check can be unit-tested without a
 * solver in the room: `RecordedRunner` is how "UNKNOWN, ERROR and malformed
 * output never produce an accepted schedule" is asserted at all, and those are
 * exactly the paths a real solver will not reproduce on demand.
 *
 * `lastSolution` is the raw `output.json` object of the last solution message,
 * untyped on purpose. `schemas.ts` is the only thing that turns one into a
 * value.
 */

import type { FailureReason } from './types.ts';

export type MiniZincStatus =
  | 'OPTIMAL_SOLUTION' | 'SATISFIED' | 'ALL_SOLUTIONS'
  | 'UNSATISFIABLE' | 'UNBOUNDED' | 'UNSAT_OR_UNBOUNDED' | 'UNKNOWN' | 'ERROR';

export interface RunRequest {
  readonly entry: 'rota-optimize.mzn' | 'rota-check.mzn';
  readonly data: Record<string, unknown>;
  readonly timeLimitMs: number;
}

export type RunResult =
  | { kind: 'finished'; status: MiniZincStatus; lastSolution: unknown | null; solutionCount: number; statistics: Record<string, unknown> }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: FailureReason; detail: string };

export interface MiniZincRunner {
  run(request: RunRequest, signal: AbortSignal): Promise<RunResult>;
  dispose(): Promise<void>;
}

/** The two entry files and the core they share, as source text. */
export interface ModelSources {
  readonly core: string;
  readonly optimize: string;
  readonly check: string;
}

/**
 * How long past its own time limit a run may go before the runner gives up on
 * it. Generous: a cold WebAssembly start on a phone is seconds of work before
 * the solver's clock starts.
 */
export const WATCHDOG_GRACE_MS = 60_000;

export const SOLVER_OPTIONS = {
  solver: 'highs',
  'output-mode': 'json',
  'free-search': true,
  statistics: true,
} as const;

function entrySource(sources: ModelSources, entry: RunRequest['entry']): string {
  return entry === 'rota-optimize.mzn' ? sources.optimize : sources.check;
}

/* ------------------------------------------------------------------ */
/* Browser                                                             */
/* ------------------------------------------------------------------ */

export interface BrowserAssets {
  readonly workerURL: string;
  readonly wasmURL: string;
  readonly dataURL: string;
}

/**
 * The shipped path: MiniZinc compiled to WebAssembly, in one worker.
 *
 * `init` happens on the first `run`, never at page load, so a reader who only
 * opens a shared link to look at the agenda pays nothing for a solver they
 * never ask to run. `numWorkers: 1` is ADR 011's ruling.
 *
 * The package is imported dynamically for the same reason: the module graph of
 * a page that never solves must not contain it.
 */
export class BrowserRunner implements MiniZincRunner {
  #assets: BrowserAssets;

  #sources: ModelSources;

  #ready: Promise<typeof import('minizinc')> | null = null;

  constructor(assets: BrowserAssets, sources: ModelSources) {
    this.#assets = assets;
    this.#sources = sources;
  }

  #ensureReady(): Promise<typeof import('minizinc')> {
    if (!this.#ready) {
      this.#ready = import('minizinc').then(async (MiniZinc) => {
        await MiniZinc.init({ ...this.#assets, numWorkers: 1 });
        return MiniZinc;
      });
    }
    return this.#ready;
  }

  async run(request: RunRequest, signal: AbortSignal): Promise<RunResult> {
    let MiniZinc: typeof import('minizinc');
    try {
      MiniZinc = await this.#ensureReady();
    } catch (error) {
      this.#ready = null;
      return { kind: 'failed', reason: 'worker', detail: String(error) };
    }
    if (signal.aborted) return { kind: 'cancelled' };

    const model = new MiniZinc.Model();
    // `use: false` on the core: it is a file the entry's `include` resolves,
    // not a model in its own right. Passed as a model file it is compiled
    // twice - once on its own and once through the include - and every
    // declaration in it collides with itself.
    model.addFile('rota-core.mzn', this.#sources.core, false);
    model.addFile(request.entry, entrySource(this.#sources, request.entry));
    model.addJson(request.data);

    let lastSolution: unknown | null = null;
    let solutionCount = 0;
    let errorDetail: string | null = null;
    let cancelled = false;

    const progress = model.solve({
      options: { ...SOLVER_OPTIONS, 'time-limit': request.timeLimitMs },
    });
    const cancel = () => { cancelled = true; progress.cancel(); };
    signal.addEventListener('abort', cancel, { once: true });

    try {
      progress.on('solution', (solution) => {
        solutionCount += 1;
        lastSolution = (solution as { output?: { json?: unknown } }).output?.json ?? null;
      });
      progress.on('error', (error) => { errorDetail = String((error as { message?: string }).message ?? error); });
      // A watchdog, because a worker that dies on its own does not always
      // settle the promise it handed out - a bad asset URL throws inside
      // `importScripts` and nothing ever resolves, which the page renders as
      // "solving" forever. The solver has its own time limit; this only fires
      // well past it, and it fires as a failure rather than as an answer.
      const result = await Promise.race([
        progress,
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`the solver did not answer within ${request.timeLimitMs + WATCHDOG_GRACE_MS}ms`)),
            request.timeLimitMs + WATCHDOG_GRACE_MS,
          );
          void Promise.resolve(progress).finally(() => clearTimeout(timer));
        }),
      ]);
      // A cancelled progress resolves as cancelled whatever status the package
      // reports afterwards: the answer was never wanted.
      if (cancelled || signal.aborted) return { kind: 'cancelled' };
      if (errorDetail) return { kind: 'failed', reason: 'model-error', detail: errorDetail };
      return {
        kind: 'finished',
        status: result.status as MiniZincStatus,
        lastSolution,
        solutionCount,
        statistics: (result.statistics ?? {}) as Record<string, unknown>,
      };
    } catch (error) {
      if (cancelled || signal.aborted) return { kind: 'cancelled' };
      return { kind: 'failed', reason: 'worker', detail: String(error) };
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  async dispose(): Promise<void> {
    if (!this.#ready) return;
    const MiniZinc = await this.#ready.catch(() => null);
    this.#ready = null;
    // So the browser test can assert the worker count returns to zero.
    MiniZinc?.shutdown();
  }
}

/* ------------------------------------------------------------------ */
/* Recorded                                                            */
/* ------------------------------------------------------------------ */

/** Returns its script in order, and throws once exhausted rather than repeating. */
export class RecordedRunner implements MiniZincRunner {
  #script: RunResult[];

  #cursor = 0;

  readonly requests: RunRequest[] = [];

  constructor(script: RunResult[]) {
    this.#script = script;
  }

  async run(request: RunRequest, signal: AbortSignal): Promise<RunResult> {
    this.requests.push(request);
    if (signal.aborted) return { kind: 'cancelled' };
    if (this.#cursor >= this.#script.length) {
      throw new Error(`RecordedRunner: no scripted result for run ${this.#cursor + 1}`);
    }
    const result = this.#script[this.#cursor];
    this.#cursor += 1;
    return result;
  }

  async dispose(): Promise<void> { /* nothing to hold open */ }
}

/** One JSON message per line, exactly as `--json-stream` writes it. */
export function parseJsonStream(stdout: string, stderr = ''): RunResult {
  let lastSolution: unknown | null = null;
  let solutionCount = 0;
  let status: MiniZincStatus | null = null;
  let statistics: Record<string, unknown> = {};
  let errorDetail: string | null = null;

  for (const line of stdout.split('\n')) {
    const text = line.trim();
    if (!text) continue;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { kind: 'failed', reason: 'malformed-output', detail: `unparseable message: ${text.slice(0, 200)}` };
    }
    if (message.type === 'solution') {
      solutionCount += 1;
      lastSolution = (message.output as { json?: unknown } | undefined)?.json ?? null;
    } else if (message.type === 'status') {
      status = message.status as MiniZincStatus;
    } else if (message.type === 'statistics') {
      statistics = { ...statistics, ...(message.statistics as Record<string, unknown>) };
    } else if (message.type === 'error') {
      errorDetail = String(message.message ?? 'model error');
    }
  }
  if (errorDetail) return { kind: 'failed', reason: 'model-error', detail: errorDetail };
  if (!status) {
    // A satisfaction problem that finds an answer and stops prints no status
    // line at all - `--json-stream` emits one for an optimum, for
    // unsatisfiable and for a time limit, and nothing for "here it is". Check
    // mode is exactly that shape, so a solution with no status is SATISFIED.
    if (solutionCount > 0) return { kind: 'finished', status: 'SATISFIED', lastSolution, solutionCount, statistics };
    return { kind: 'failed', reason: 'malformed-output', detail: stderr.trim() || 'solver reported no status and no solution' };
  }
  return { kind: 'finished', status, lastSolution, solutionCount, statistics };
}
