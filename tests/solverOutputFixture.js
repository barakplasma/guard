import { MODEL_VERSION } from '../src/solver/types.ts';

/**
 * A well-formed solver output for an instance, as `schemas.ts` expects one.
 *
 * Shared by the three suites that script a runner rather than run a solver:
 * the shape is the output *contract*, so three copies of it would be three
 * chances for a test to keep passing against a contract the model no longer
 * honours.
 */
export const grid = (rows, columns, value = 0) => Array.from(
  { length: rows },
  () => Array.from({ length: columns }, () => value),
);

export function solverSolution(index, instance, overrides = {}) {
  const employees = index.employeeIds.length;
  const missions = index.missionIds.length;
  const segments = index.segments.length;
  return {
    assignedMission: grid(employees, segments),
    seatsFilled: grid(missions, segments),
    qualifiedSeatsFilled: grid(instance.requirementCount, segments),
    nightRestMinutes: grid(employees, instance.nightCount),
    reachesTargetTotalRest: grid(employees, instance.nightCount, false),
    sleepsTarget: grid(employees, instance.nightCount, false),
    sleepsMinimum: grid(employees, instance.nightCount, false),
    longRunsByEmployee: Array.from({ length: employees }, () => 0),
    dutyMinutes: Array.from({ length: employees }, () => 0),
    turnsTaken: Array.from({ length: employees }, () => 0),
    turnsOnMission: grid(employees, missions),
    nightMinutesInWindow: Array.from({ length: employees }, () => 0),
    unmetQualificationMinutes: 0,
    unfilledSeatMinutes: 0,
    slotHandoverCount: 0,
    restShortfallMinutes: 0,
    nightsWithoutTargetTotalRest: 0,
    targetRestShortfallMinutes: 0,
    nightsWithoutTargetSleep: 0,
    nightsWithoutMinimumSleep: 0,
    longRunCount: 0,
    cooldownBreachCount: 0,
    waitDeficitMinutes: 0,
    turnSpread: 0,
    sharedRoleCount: 0,
    nightDutySpreadMinutes: 0,
    missionRepeatCost: 0,
    nightHourRepeatCost: 0,
    shortestWaitMinutes: 480,
    echoedModelVersion: MODEL_VERSION,
    ...overrides,
  };
}

/** The same, with a flat assignment laid into the matrix. */
export function solverSolutionFor(index, instance, assignment, overrides = {}) {
  const segments = index.segments.length;
  return solverSolution(index, instance, {
    assignedMission: Array.from({ length: index.employeeIds.length }, (_, e) => Array.from(
      { length: segments }, (__, s) => assignment[e * segments + s],
    )),
    ...overrides,
  });
}

/** The named quantities of a fixture, without the diagnostics around them. */
export function quantitiesOf(raw) {
  const quantities = { ...raw };
  for (const key of ['assignedMission', 'seatsFilled', 'qualifiedSeatsFilled', 'nightRestMinutes',
    'reachesTargetTotalRest', 'sleepsTarget', 'sleepsMinimum', 'longRunsByEmployee', 'dutyMinutes',
    'turnsTaken', 'turnsOnMission', 'nightMinutesInWindow', 'echoedModelVersion']) {
    delete quantities[key];
  }
  return quantities;
}

export const finishedRun = (status, lastSolution) => ({
  kind: 'finished', status, lastSolution, solutionCount: lastSolution ? 1 : 0, statistics: {},
});
