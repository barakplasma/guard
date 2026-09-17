/**
 * The model's output, checked against the instance that produced it.
 *
 * The `add_to_output` annotations in `rota-core.mzn` are the whole output
 * contract - there is no output item and no text to parse - and this is the
 * only thing that turns one of those JSON objects into a value. Dimensions and
 * cell domains are fixed *from the instance*, not from the model, so a run
 * that came back with a matrix of the wrong shape, a mission index past the
 * count, a missing quantity or a version mismatch is a `failed` outcome rather
 * than a schedule with a hole in it.
 */

import { z } from 'zod';
import { MODEL_VERSION } from './types.ts';
import type {
  InstanceIndex, NamedQuantities, SegmentDiagnostics, SolverInstance,
} from './types.ts';

const nonNegativeInt = z.number().int().min(0);

/** Exactly `length` entries, each in `0..max`. */
const fixedIntArray = (length: number, max: number) => z.array(z.number().int().min(0).max(max)).length(length);

const fixedIntMatrix = (rows: number, columns: number, max: number) => z.array(fixedIntArray(columns, max)).length(rows);

const fixedBoolMatrix = (rows: number, columns: number) => z.array(z.array(z.boolean()).length(columns)).length(rows);

/**
 * @param index the instance index the run was built from
 * @param requirementCount how many qualification requirements the instance carries
 * @param nightCount how many nights it carries
 */
export function solverOutputSchemaFor(index: InstanceIndex, requirementCount: number, nightCount: number) {
  const employees = index.employeeIds.length;
  const missions = index.missionIds.length;
  const segments = index.segments.length;
  return z.object({
    // One byte per cell, one mission or zero: two missions in one cell is not
    // a value this can hold, which is the representation ADR 017 asks for.
    assignedMission: fixedIntMatrix(employees, segments, missions),
    seatsFilled: fixedIntMatrix(missions, segments, employees),
    qualifiedSeatsFilled: fixedIntMatrix(requirementCount, segments, employees),
    nightRestMinutes: fixedIntMatrix(employees, nightCount, Number.MAX_SAFE_INTEGER),
    reachesTargetTotalRest: fixedBoolMatrix(employees, nightCount),
    sleepsTarget: fixedBoolMatrix(employees, nightCount),
    sleepsMinimum: fixedBoolMatrix(employees, nightCount),
    longRunsByEmployee: fixedIntArray(employees, Number.MAX_SAFE_INTEGER),
    dutyMinutes: fixedIntArray(employees, Number.MAX_SAFE_INTEGER),
    turnsTaken: fixedIntArray(employees, Number.MAX_SAFE_INTEGER),
    turnsOnMission: fixedIntMatrix(employees, missions, Number.MAX_SAFE_INTEGER),
    nightMinutesInWindow: fixedIntArray(employees, Number.MAX_SAFE_INTEGER),

    unmetQualificationMinutes: nonNegativeInt,
    unfilledSeatMinutes: nonNegativeInt,
    slotHandoverCount: nonNegativeInt,
    restShortfallMinutes: nonNegativeInt,
    nightsWithoutTargetTotalRest: nonNegativeInt,
    targetRestShortfallMinutes: nonNegativeInt,
    nightsWithoutTargetSleep: nonNegativeInt,
    nightsWithoutMinimumSleep: nonNegativeInt,
    longRunCount: nonNegativeInt,
    exemptHardVisits: nonNegativeInt,
    hardMissionSpread: nonNegativeInt,
    waitDeficitMinutes: nonNegativeInt,
    turnSpread: nonNegativeInt,
    sharedRoleCount: nonNegativeInt,
    nightDutySpreadMinutes: nonNegativeInt,
    missionRepeatCost: nonNegativeInt,
    nightHourRepeatCost: nonNegativeInt,
    shortestWaitMinutes: nonNegativeInt,

    // The one field that says the JSON came from the model this build knows.
    echoedModelVersion: z.literal(MODEL_VERSION),
  });
}

export interface DecodedOutput {
  assignment: Uint8Array;
  quantities: NamedQuantities;
  diagnostics: SegmentDiagnostics;
}

export class SolverOutputError extends Error {
  readonly reason: 'malformed-output' | 'dimension-mismatch';

  constructor(reason: 'malformed-output' | 'dimension-mismatch', detail: string) {
    super(detail);
    this.name = 'SolverOutputError';
    this.reason = reason;
  }
}

/**
 * Parse one solution object into the flat matrix and the named quantities.
 *
 * A shape failure and a value failure are told apart, because they mean
 * different things: a wrong dimension is the driver and the model disagreeing
 * about the instance, while a missing quantity is output the runner mangled.
 */
export function decodeSolverOutput(
  raw: unknown,
  index: InstanceIndex,
  instance: Pick<SolverInstance, 'requirementCount' | 'nightCount'>,
): DecodedOutput {
  const parsed = solverOutputSchemaFor(index, instance.requirementCount, instance.nightCount).safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    const dimension = issue?.code === 'too_big' || issue?.code === 'too_small';
    throw new SolverOutputError(
      dimension ? 'dimension-mismatch' : 'malformed-output',
      `${path || '<root>'}: ${issue?.message ?? 'unparseable solver output'}`,
    );
  }
  const value = parsed.data;
  const segmentCount = index.segments.length;
  const assignment = new Uint8Array(index.employeeIds.length * segmentCount);
  value.assignedMission.forEach((row, employee) => {
    row.forEach((mission, segment) => { assignment[employee * segmentCount + segment] = mission; });
  });

  return {
    assignment,
    quantities: {
      unmetQualificationMinutes: value.unmetQualificationMinutes,
      unfilledSeatMinutes: value.unfilledSeatMinutes,
      slotHandoverCount: value.slotHandoverCount,
      restShortfallMinutes: value.restShortfallMinutes,
      nightsWithoutTargetTotalRest: value.nightsWithoutTargetTotalRest,
      targetRestShortfallMinutes: value.targetRestShortfallMinutes,
      nightsWithoutTargetSleep: value.nightsWithoutTargetSleep,
      nightsWithoutMinimumSleep: value.nightsWithoutMinimumSleep,
      longRunCount: value.longRunCount,
      exemptHardVisits: value.exemptHardVisits,
      hardMissionSpread: value.hardMissionSpread,
      waitDeficitMinutes: value.waitDeficitMinutes,
      turnSpread: value.turnSpread,
      sharedRoleCount: value.sharedRoleCount,
      nightDutySpreadMinutes: value.nightDutySpreadMinutes,
      missionRepeatCost: value.missionRepeatCost,
      nightHourRepeatCost: value.nightHourRepeatCost,
      shortestWaitMinutes: value.shortestWaitMinutes,
    },
    diagnostics: {
      seatsFilled: value.seatsFilled,
      qualifiedSeatsFilled: value.qualifiedSeatsFilled,
      nightRestMinutes: value.nightRestMinutes,
      reachesTargetTotalRest: value.reachesTargetTotalRest,
      sleepsTarget: value.sleepsTarget,
      sleepsMinimum: value.sleepsMinimum,
      longRunsByEmployee: value.longRunsByEmployee,
      dutyMinutes: value.dutyMinutes,
      turnsTaken: value.turnsTaken,
      turnsOnMission: value.turnsOnMission,
      nightMinutesInWindow: value.nightMinutesInWindow,
    },
  };
}
