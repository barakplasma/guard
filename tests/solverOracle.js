import { OBJECTIVE_ORDER, TARGET_REST_MINUTES } from '../src/solver/types.ts';

/**
 * A second implementation of the model, in JavaScript.
 *
 * Deliberately a second one. `prototype/minizinc/check.mjs` was built around
 * the observation that a model can compute something other than it claims, and
 * that comparing totals alone would never notice - so this scores an
 * assignment matrix independently and the tests compare it against what
 * MiniZinc reported for the same matrix. Where the two disagree, one of them
 * is wrong and the test says which quantity.
 *
 * It is also the brute-force oracle: over instances small enough to enumerate,
 * the lexicographic minimum computed here is what the ladder has to find.
 *
 * Symmetry breaking is deliberately **not** reproduced. It prunes permutations
 * of interchangeable people, which changes neither feasibility (one
 * representative of each class survives) nor any quantity below (that is what
 * makes a class a class), so an oracle that enforced it would only be testing
 * that the two implementations agree about the pruning.
 */

const isOn = (assignment, employee, segment, mission) => assignment[employee][segment] === mission + 1;
const onDuty = (assignment, employee, segment) => assignment[employee][segment] !== 0;

function pinnedCells(instance) {
  const cells = new Set();
  for (let i = 0; i < instance.pinCount; i++) {
    cells.add(`${instance.pinEmployee[i] - 1}|${instance.pinSegment[i] - 1}`);
  }
  return cells;
}

/** Does this matrix satisfy every hard rule in `rota-core.mzn`? */
export function isFeasible(instance, assignment) {
  const pinned = pinnedCells(instance);
  for (let i = 0; i < instance.pinCount; i++) {
    const employee = instance.pinEmployee[i] - 1;
    const segment = instance.pinSegment[i] - 1;
    if (assignment[employee][segment] !== instance.pinMission[i]) return false;
  }
  for (let e = 0; e < instance.employeeCount; e++) {
    for (let s = 0; s < instance.segmentCount; s++) {
      const here = assignment[e][s];
      if (here === 0) continue;
      const mission = here - 1;
      const isPinned = pinned.has(`${e}|${s}`);
      if (!isPinned && !instance.isAvailable[e][s]) return false;
      if (!isPinned && !instance.isAllowed[e][mission]) return false;
      if (instance.seatsWanted[mission][s] === 0) return false;
    }
  }
  for (let m = 0; m < instance.missionCount; m++) {
    for (let s = 0; s < instance.segmentCount; s++) {
      let filled = 0;
      for (let e = 0; e < instance.employeeCount; e++) if (isOn(assignment, e, s, m)) filled++;
      if (filled > instance.seatsWanted[m][s]) return false;
      if (s > 0 && instance.holdOfSegment[m][s] > 0
        && instance.holdOfSegment[m][s] === instance.holdOfSegment[m][s - 1]) {
        for (let e = 0; e < instance.employeeCount; e++) {
          if (isOn(assignment, e, s, m) !== isOn(assignment, e, s - 1, m)) return false;
        }
      }
    }
  }
  return true;
}

function turnsOnMissionOf(instance, assignment) {
  const turns = [];
  for (let e = 0; e < instance.employeeCount; e++) {
    const row = [];
    for (let m = 0; m < instance.missionCount; m++) {
      let count = 0;
      for (let s = 0; s < instance.segmentCount; s++) {
        if (instance.seatsWanted[m][s] === 0) continue;
        const entersSlot = s === 0
          || instance.slotOfSegment[m][s] !== instance.slotOfSegment[m][s - 1]
          || instance.holdOfSegment[m][s] !== instance.holdOfSegment[m][s - 1];
        if (entersSlot && isOn(assignment, e, s, m)) count++;
      }
      row.push(count);
    }
    turns.push(row);
  }
  return turns;
}

/** Every named quantity in `rota-core.mzn`, computed from the matrix alone. */
export function score(instance, assignment) {
  const { segmentMinutes, nightOfSegment } = instance;
  const pinned = pinnedCells(instance);

  let unmetQualificationMinutes = 0;
  const qualifiedSeatsFilled = [];
  for (let r = 0; r < instance.requirementCount; r++) {
    const mission = instance.requirementMission[r] - 1;
    const row = [];
    for (let s = 0; s < instance.segmentCount; s++) {
      let got = 0;
      for (let e = 0; e < instance.employeeCount; e++) {
        if (instance.holdsRequirement[r][e] && isOn(assignment, e, s, mission)) got++;
      }
      row.push(got);
      if (instance.seatsWanted[mission][s] > 0) {
        unmetQualificationMinutes += Math.max(0, instance.requirementSeats[r] - got) * segmentMinutes[s];
      }
    }
    qualifiedSeatsFilled.push(row);
  }

  let unfilledSeatMinutes = 0;
  let slotHandoverCount = 0;
  const seatsFilled = [];
  for (let m = 0; m < instance.missionCount; m++) {
    const row = [];
    for (let s = 0; s < instance.segmentCount; s++) {
      let filled = 0;
      for (let e = 0; e < instance.employeeCount; e++) if (isOn(assignment, e, s, m)) filled++;
      row.push(filled);
      unfilledSeatMinutes += (instance.seatsWanted[m][s] - filled) * segmentMinutes[s];
      if (s > 0 && instance.seatsWanted[m][s] > 0 && instance.seatsWanted[m][s - 1] > 0
        && instance.slotOfSegment[m][s] === instance.slotOfSegment[m][s - 1]) {
        for (let e = 0; e < instance.employeeCount; e++) {
          if (isOn(assignment, e, s, m) !== isOn(assignment, e, s - 1, m)) slotHandoverCount++;
        }
      }
    }
    seatsFilled.push(row);
  }

  const nightRestMinutes = [];
  for (let e = 0; e < instance.employeeCount; e++) {
    const row = [];
    for (let n = 1; n <= instance.nightCount; n++) {
      let rest = 0;
      for (let s = 0; s < instance.segmentCount; s++) {
        if (nightOfSegment[s] !== n || !instance.isAvailable[e][s]) continue;
        if (instance.isSleepable[assignment[e][s]]) rest += segmentMinutes[s];
      }
      row.push(rest);
    }
    nightRestMinutes.push(row);
  }

  let restShortfallMinutes = 0;
  let targetRestShortfallMinutes = 0;
  let nightsWithoutTargetSleep = 0;
  const sleepsTarget = [];
  for (let e = 0; e < instance.employeeCount; e++) {
    const row = [];
    for (let n = 1; n <= instance.nightCount; n++) {
      const rest = nightRestMinutes[e][n - 1];
      const required = instance.requiredNightRestMinutes[e];
      if (required > 0) restShortfallMinutes += Math.max(0, required - rest);
      const present = instance.nightOfSegment.some(
        (night, s) => night === n && instance.isAvailable[e][s],
      );
      if (present) {
        targetRestShortfallMinutes += Math.max(0, Math.max(required, TARGET_REST_MINUTES) - rest);
      }
      let canSleep = false;
      let sleeps = false;
      for (let w = 0; w < instance.sleepWindowCount; w++) {
        if (instance.sleepWindowNight[w] !== n) continue;
        let available = true;
        let asleep = true;
        for (let s = instance.sleepWindowFirstSegment[w] - 1; s < instance.sleepWindowLastSegment[w]; s++) {
          if (!instance.isAvailable[e][s]) { available = false; asleep = false; break; }
          if (!instance.isSleepable[assignment[e][s]]) asleep = false;
        }
        canSleep = canSleep || available;
        sleeps = sleeps || asleep;
      }
      row.push(sleeps);
      if (canSleep && !sleeps) nightsWithoutTargetSleep++;
    }
    sleepsTarget.push(row);
  }

  const longRunsByEmployee = [];
  for (let e = 0; e < instance.employeeCount; e++) {
    let runs = 0;
    for (let w = 0; w < instance.longRunWindowCount; w++) {
      let all = true;
      for (let s = instance.longRunFirstSegment[w] - 1; s < instance.longRunLastSegment[w]; s++) {
        if (!onDuty(assignment, e, s)) { all = false; break; }
      }
      if (all) runs++;
    }
    longRunsByEmployee.push(runs);
  }
  const longRunCount = longRunsByEmployee.reduce((sum, n) => sum + n, 0);

  const turnsOnMission = turnsOnMissionOf(instance, assignment);
  let cooldownBreachCount = 0;
  for (let e = 0; e < instance.employeeCount; e++) {
    for (let m = 0; m < instance.missionCount; m++) {
      if (instance.repeatAfterDays[m] <= 0) continue;
      const turns = turnsOnMission[e][m];
      cooldownBreachCount += (instance.heldWithinCooldown[e][m] && turns >= 1 ? 1 : 0)
        + Math.max(0, turns - 1);
    }
  }

  const dutyMinutes = [];
  const nightMinutesInWindow = [];
  let shortestWaitMinutes = TARGET_REST_MINUTES;
  for (let e = 0; e < instance.employeeCount; e++) {
    let duty = 0;
    let night = 0;
    let idle = Math.min(TARGET_REST_MINUTES, instance.idleMinutesAtHorizonStart[e]);
    for (let s = 0; s < instance.segmentCount; s++) {
      if (s > 0) {
        idle = onDuty(assignment, e, s - 1)
          ? 0
          : Math.min(TARGET_REST_MINUTES, idle + segmentMinutes[s - 1]);
      }
      if (onDuty(assignment, e, s)) {
        duty += segmentMinutes[s];
        if (nightOfSegment[s] > 0) night += segmentMinutes[s];
        const starts = (s === 0 || !onDuty(assignment, e, s - 1)) && !pinned.has(`${e}|${s}`);
        if (starts) shortestWaitMinutes = Math.min(shortestWaitMinutes, idle);
      }
    }
    dutyMinutes.push(duty);
    nightMinutesInWindow.push(night);
  }

  const turnsTaken = turnsOnMission.map((row) => row.reduce((sum, n) => sum + n, 0));
  const totalTurns = turnsTaken.map((turns, e) => turns + instance.recentTurns[e]);
  const totalNight = nightMinutesInWindow.map((night, e) => night + instance.recentNightMinutes[e]);

  let sharedRoleCount = 0;
  for (let e = 0; e < instance.employeeCount; e++) {
    for (let m = 0; m < instance.missionCount; m++) {
      let held = 0;
      for (let r = 0; r < instance.requirementCount; r++) {
        if (instance.requirementMission[r] - 1 === m && instance.holdsRequirement[r][e]) held++;
      }
      if (held <= 1) continue;
      for (let s = 0; s < instance.segmentCount; s++) {
        if (instance.seatsWanted[m][s] > 0 && isOn(assignment, e, s, m)) sharedRoleCount += held - 1;
      }
    }
  }

  let missionRepeatCost = 0;
  for (let e = 0; e < instance.employeeCount; e++) {
    for (let m = 0; m < instance.missionCount; m++) {
      missionRepeatCost += instance.recentTurnsOnMission[e][m] * turnsOnMission[e][m];
    }
  }

  let nightHourRepeatCost = 0;
  for (let e = 0; e < instance.employeeCount; e++) {
    for (let s = 0; s < instance.segmentCount; s++) {
      if (nightOfSegment[s] > 0 && onDuty(assignment, e, s)) {
        nightHourRepeatCost += instance.recentHourHolds[e][instance.hourOfSegment[s]];
      }
    }
  }

  return {
    unmetQualificationMinutes,
    unfilledSeatMinutes,
    slotHandoverCount,
    restShortfallMinutes,
    targetRestShortfallMinutes,
    nightsWithoutTargetSleep,
    longRunCount,
    cooldownBreachCount,
    waitDeficitMinutes: TARGET_REST_MINUTES - shortestWaitMinutes,
    turnSpread: Math.max(...totalTurns) - Math.min(...totalTurns),
    sharedRoleCount,
    nightDutySpreadMinutes: Math.max(...totalNight) - Math.min(...totalNight),
    missionRepeatCost,
    nightHourRepeatCost,
    shortestWaitMinutes,
    // Diagnostics, for the tests that read them.
    seatsFilled,
    qualifiedSeatsFilled,
    nightRestMinutes,
    sleepsTarget,
    longRunsByEmployee,
    dutyMinutes,
    turnsTaken,
    turnsOnMission,
    nightMinutesInWindow,
  };
}

/** The objective vector, in ladder order. */
export const objectivesOf = (quantities) => OBJECTIVE_ORDER.map((key) => quantities[key]);

const lexLess = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
};

/**
 * Every feasible matrix, and the lexicographically smallest objective vector
 * among them. Exponential by construction - only ever called on instances
 * small enough that `(missionCount + 1) ** (employeeCount * segmentCount)`
 * is a few thousand.
 */
export function bruteForce(instance, levels = OBJECTIVE_ORDER.length) {
  const cells = instance.employeeCount * instance.segmentCount;
  const values = instance.missionCount + 1;
  const total = values ** cells;
  if (total > 400_000) throw new Error(`instance too large to enumerate: ${total} matrices`);

  let best = null;
  let bestObjectives = null;
  let feasibleCount = 0;
  for (let code = 0; code < total; code++) {
    const assignment = [];
    let rest = code;
    for (let e = 0; e < instance.employeeCount; e++) {
      const row = [];
      for (let s = 0; s < instance.segmentCount; s++) {
        row.push(rest % values);
        rest = Math.floor(rest / values);
      }
      assignment.push(row);
    }
    if (!isFeasible(instance, assignment)) continue;
    feasibleCount++;
    const objectives = objectivesOf(score(instance, assignment)).slice(0, levels);
    if (!bestObjectives || lexLess(objectives, bestObjectives)) {
      bestObjectives = objectives;
      best = assignment;
    }
  }
  return { best, objectives: bestObjectives, feasibleCount };
}

/** A flat accepted assignment as the nested matrix the oracle scores. */
export function matrixOf(accepted, instance) {
  const rows = [];
  for (let e = 0; e < instance.employeeCount; e++) {
    const row = [];
    for (let s = 0; s < instance.segmentCount; s++) {
      row.push(accepted.assignment[e * instance.segmentCount + s]);
    }
    rows.push(row);
  }
  return rows;
}
