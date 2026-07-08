// Re-exports the framework-agnostic scheduler so app code has a stable import
// path; scheduler/scheduler.js itself stays dependency-free and is also used
// directly by tests/scheduler.test.js (node:test) and tests.html.
export { generateShifts, computeStats } from '../../../scheduler/scheduler.js';
