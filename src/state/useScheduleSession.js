import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prepareProblem } from '../solver/prepare.ts';
import { compileInstance } from '../solver/compile.ts';
import { scheduleResultFrom } from '../solver/views.ts';
import { BrowserRunner } from '../solver/runner.ts';
import { MODEL_SOURCES } from '../solver/model/sources.ts';
import {
  DEFAULT_CHECK_TIME_LIMIT_MS, DEFAULT_DEBOUNCE_MS, DEFAULT_LEVEL_TIME_LIMIT_MS, SolveSession,
} from '../solver/session.ts';

/**
 * Where the worker's own assets live.
 *
 * Absolute, not relative. The worker reaches these through `importScripts`,
 * which has no document to be relative *to*: a `./` path is simply rejected as
 * an invalid URL, and the failure arrives as a worker-side SyntaxError that
 * leaves the page saying "solving" forever. `document.baseURI` is what the
 * build's `base` setting means, resolved.
 */
const solverAsset = (name) => new URL(`solver/${name}`, document.baseURI).href;

/**
 * The MiniZinc path, beside the engine rather than instead of it.
 *
 * ADR 017's migration order is explicit that there is no step where two
 * authorities exist: until step 6 the engine's result is what the page renders
 * and what history is frozen out of, and this hook only feeds the debug
 * section's differential view. Flipping `acceptSchedule` is the whole of step
 * 6 and is deliberately not done here.
 *
 * `enabled` is off by default, and nothing about the solver is imported until
 * it is turned on: the 19 MB WebAssembly runtime is not something a reader who
 * opened a shared link to look at tonight's rota should pay for.
 *
 * `status: 'stale'` means `shown` belongs to an older revision. It is rendered
 * behind the pending banner ADR 017 asks for, so nothing downstream can
 * mistake it for the answer to the document on screen.
 */
export default function useScheduleSession(doc, enabled, now) {
  const [outcome, setOutcome] = useState(null);
  const sessionRef = useRef(null);
  const [, bump] = useState(0);

  // `now` is held steady per document on purpose. It reaches the problem as
  // `loggedBefore`, so letting it tick would give every render a new revision
  // and re-solve a question nobody asked again.
  const problem = useMemo(() => {
    if (!enabled) return null;
    if (doc.employees.length === 0 || doc.missions.length === 0) return null;
    return prepareProblem(doc, { now });
  }, [doc, enabled, now]);

  const ensureSession = useCallback(() => {
    if (!sessionRef.current) {
      // See `solverAsset`: absolute, not relative. The worker resolves these with
      // `importScripts`, which has no document to be relative *to*: a `./`
      // path is simply rejected as an invalid URL, and the failure arrives as
      // a worker-side SyntaxError that leaves the page saying "solving"
      // forever. `document.baseURI` is what the build's `base` setting means.
      sessionRef.current = new SolveSession({
        runner: new BrowserRunner({
          workerURL: solverAsset('minizinc-worker.js'),
          wasmURL: solverAsset('minizinc.wasm'),
          dataURL: solverAsset('minizinc.data'),
        }, MODEL_SOURCES),
        timeLimitMsPerLevel: DEFAULT_LEVEL_TIME_LIMIT_MS,
        checkTimeLimitMs: DEFAULT_CHECK_TIME_LIMIT_MS,
        debounceMs: DEFAULT_DEBOUNCE_MS,
        onOutcome: (next) => { setOutcome(next); bump((n) => n + 1); },
      });
    }
    return sessionRef.current;
  }, []);

  useEffect(() => {
    if (!problem) return;
    ensureSession().request(problem);
  }, [problem, ensureSession]);

  useEffect(() => () => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
  }, []);

  const session = sessionRef.current;
  const accepted = problem ? session?.acceptedFor(problem.revision) ?? null : null;
  const shown = accepted ?? session?.lastAccepted() ?? null;

  const status = (() => {
    if (!enabled) return 'idle';
    if (!problem) return 'idle';
    if (accepted) return 'ready';
    if (outcome && outcome.revision === problem.revision) {
      if (outcome.kind === 'infeasible') return 'infeasible';
      if (outcome.kind === 'unknown') return 'unknown';
      if (outcome.kind === 'failed') return 'failed';
      if (outcome.kind === 'cancelled') return 'idle';
    }
    return shown ? 'stale' : 'solving';
  })();

  const result = useMemo(() => {
    if (!accepted || !problem) return null;
    const { index } = compileInstance(problem);
    return scheduleResultFrom(accepted, index, problem, doc);
  }, [accepted, problem, doc]);

  return { status, accepted, shown, outcome, result, problem };
}
