/**
 * The model, as strings, inside the bundle.
 *
 * Vite's `?raw` suffix is what keeps the app's promise that nothing is fetched
 * at runtime: the three `.mzn` files are inlined at build time and precached
 * like any other module, so a plan solved offline needs no network. Node reads
 * the same files off disk in `nativeRunner.ts` - one source of truth, two ways
 * of reaching it.
 */
import core from './rota-core.mzn?raw'
import optimize from './rota-optimize.mzn?raw'
import check from './rota-check.mzn?raw'
import type { ModelSources } from '../runner.ts'

export const MODEL_SOURCES: ModelSources = { core, optimize, check }
