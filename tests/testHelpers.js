export const HOUR = 60 * 60 * 1000;
export const MINUTE = 60 * 1000;

export function localTime(year, month, day, hour = 0, minute = 0) {
  return new Date(year, month, day, hour, minute, 0, 0).getTime();
}

export function people(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `e${index + 1}`,
    name: `Emp${String(index + 1).padStart(2, '0')}`,
  }));
}

export function runPlan(overrides) {
  return plan({ shiftMinutes: 60, employees: [], missions: [], ...overrides });
}
import { plan } from '../src/lib/planner.js';
