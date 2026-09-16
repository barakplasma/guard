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

export function carmelRotaDocument(start) {
  return {
    start,
    end: start + 163 * HOUR,
    shiftMinutes: 60,
    strategy: 'rotation',
    employees: people(16),
    missions: [
      { id: 'm1', name: 'Gate', type: 'local', count: 1 },
      { id: 'm2', name: 'Kitchen', type: 'local', count: 2 },
      { id: 'm3', name: 'Carmel', type: 'local', count: 5 },
      { id: 'm4', name: 'Ops', type: 'local', count: 1 },
    ],
    pins: [{ missionId: 'm3', employeeId: 'e1' }],
  };
}

export function availabilityPlan(start, {
  hours = 2, employee = {}, missionId = 'm', missionType = 'remote', pin,
} = {}) {
  const end = start + hours * HOUR;
  return {
    start,
    end,
    input: {
      start,
      end,
      employees: [{ id: 'e1', name: 'Limited', ...employee }, { id: 'e2', name: 'Full' }],
      missions: [{ id: missionId, name: 'Duty', type: missionType, start, end, count: 1 }],
      ...(pin ? { pins: [{ missionId, employeeId: 'e1', start, end: start + HOUR, ...pin }] } : {}),
    },
  };
}

export function localDutyDocument(start, {
  hours = 2, count = 1, employees = people(2), pins = [], name = 'Duty',
} = {}) {
  const end = start + hours * HOUR;
  return {
    start,
    end,
    shiftMinutes: 60,
    employees,
    missions: [{ id: 'l', name, type: 'local', start, end, count }],
    pins,
  };
}
import { plan } from '../src/lib/planner.js';
