// Re-exports the framework-agnostic sleep report so app code has a stable
// import path; scheduler/sleep.js itself stays dependency-free and is also used
// directly by tests/sleep.test.js (node:test).
export { sleepReport } from '../../../scheduler/sleep.js';
