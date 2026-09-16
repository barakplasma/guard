/**
 * `PreparedProblem` -> the parameter list of `rota-core.mzn`, plus the index
 * that reads the answer back.
 *
 * The successor of `prototype/minizinc/fromPlan.mjs::toInstance`, split into
 * functions that can be tested one at a time. Two rules hold throughout:
 *
 * - **Time is a segment index on the model side.** Nothing epoch-sized crosses
 *   the boundary; every duration is `segmentMinutes`. An instance is therefore
 *   the same whichever week the plan is in, which is what makes the revision a
 *   useful cache key and the goldens readable.
 * - **The grid is the union of the missions' own grids**, never a fresh one.
 *   `segmentGrid` cut each mission in `prepare.ts`; here those cuts are merged
 *   into one global grid and every mission's slot stamp is carried across, so
 *   the model and the engine cannot disagree about where a shift begins.
 */

import { countAt } from '../lib/planner.js';
import { MAX_UNBROKEN_MINUTES } from '../lib/strategies.js';
import { LEVEL_COUNT, TARGET_REST_MINUTES } from './types.ts';
import type {
  InstanceIndex, InstantMs, Interval, PreparedMission, PreparedProblem, SolverInstance,
} from './types.ts';

const MINUTE = 60_000;

/** What the ladder adds to an instance per run. */
export interface LadderParams {
  readonly objectiveLevel: number;
  /** One per level, `-1` where uncapped. */
  readonly objectiveCap: readonly number[];
  /** Check mode only: the matrix to fix, as model-side mission indices. */
  readonly candidateAssignment?: readonly (readonly number[])[];
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/* ------------------------------------------------------------------ */
/* The global grid                                                     */
/* ------------------------------------------------------------------ */

/**
 * Every edge any mission, person or night is cut on, merged into one grid.
 *
 * A local mission contributes the segments `segmentGrid` gave it; a remote or
 * daily mission contributes only the bounds of the window it is held across,
 * because nothing inside one is divisible; availability and night edges
 * contribute theirs, so no segment can straddle a boundary and have to pick a
 * side.
 */
export function buildGlobalSegmentGrid(problem: PreparedProblem): { segments: Interval[]; edges: InstantMs[] } {
  const points = new Set<number>([problem.horizon.start, problem.horizon.end]);
  const add = (t: number) => {
    if (t > problem.horizon.start && t < problem.horizon.end) points.add(t);
  };
  for (const mission of problem.missions) {
    if (mission.kind === 'local') {
      for (const segment of mission.segments) { add(segment.start); add(segment.end); }
    } else if (mission.kind === 'daily') {
      for (const occurrence of mission.occurrences) { add(occurrence.start); add(occurrence.end); }
    } else {
      add(mission.window.start); add(mission.window.end);
    }
  }
  for (const employee of problem.employees) { add(employee.available.start); add(employee.available.end); }
  for (const night of problem.nights) { add(night.start); add(night.end); }
  for (const commitment of problem.commitments) { add(commitment.coverage.start); add(commitment.coverage.end); }

  const edges = [...points].sort((a, b) => a - b) as InstantMs[];
  const segments: Interval[] = [];
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] > edges[i - 1]) segments.push({ start: edges[i - 1], end: edges[i] });
  }
  return { segments, edges };
}

/* ------------------------------------------------------------------ */
/* Demand                                                              */
/* ------------------------------------------------------------------ */

/**
 * `countAt` shaped for one prepared mission.
 *
 * The predicate that decides whether an instant is inside a night lives in
 * `countAt`, so the day/night headcount split has one definition on both
 * paths. The shim carries the two fields it reads, nothing else.
 */
function seatsAt(mission: PreparedMission, at: InstantMs, nights: readonly Interval[]): number {
  if (mission.kind !== 'local') return mission.seats;
  return countAt(
    { count: mission.daySeats, nightCount: mission.nightSeats },
    at,
    nights.map((night) => ({ start: night.start as number, end: night.end as number })),
  );
}

/** Is this mission running across the whole of `segment`? */
function isRunning(mission: PreparedMission, segment: Interval): boolean {
  if (mission.kind === 'daily') {
    return mission.occurrences.some((w) => overlaps(segment, w));
  }
  return overlaps(segment, mission.window);
}

/**
 * How many people each mission wants in each segment.
 *
 * With the one rule the solver owns rather than the model (ADR 009): **an
 * elapsed segment that a commitment covers keeps the headcount that was
 * actually stood.** Nothing more is demanded there and nothing can be evicted,
 * because today's roster is not evidence about the past. An elapsed segment
 * with no record is treated like any other.
 */
export function seatsWantedMatrix(problem: PreparedProblem, segments: readonly Interval[]): number[][] {
  const coveredBy = commitmentCoverage(problem, segments);
  return problem.missions.map((mission, missionIndex) => segments.map((segment, segmentIndex) => {
    if (!isRunning(mission, segment)) return 0;
    const recorded = coveredBy[missionIndex][segmentIndex];
    if (segment.end <= problem.loggedBefore && recorded > 0) return recorded;
    return seatsAt(mission, segment.start, problem.nights);
  }));
}

/** `[missionIndex][segmentIndex]` -> how many commitments cover that cell. */
function commitmentCoverage(problem: PreparedProblem, segments: readonly Interval[]): number[][] {
  const missionIndexById = new Map(problem.missions.map((m, i) => [m.id, i]));
  const counts = problem.missions.map(() => segments.map(() => 0));
  for (const commitment of problem.commitments) {
    const missionIndex = missionIndexById.get(commitment.missionId);
    if (missionIndex === undefined) continue;
    segments.forEach((segment, segmentIndex) => {
      if (overlaps(segment, commitment.coverage)) counts[missionIndex][segmentIndex] += 1;
    });
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Slots and holds                                                     */
/* ------------------------------------------------------------------ */

/**
 * Which rotation slot, and which indivisible hold, each cell belongs to.
 *
 * Slot ids are minted from the mission's own `slotBounds` - the *grid's* slot,
 * not the segment's own extent, so an availability edge tearing a slot in two
 * leaves both halves naming the one slot they are inside. Hold ids are minted
 * per remote mission and per daily occurrence. Both counters run across every
 * mission, so a slot id and a hold id can never collide.
 */
export function slotAndHoldMatrices(
  problem: PreparedProblem,
  segments: readonly Interval[],
): { slotOfSegment: number[][]; holdOfSegment: number[][]; slotBoundsById: Map<number, Interval> } {
  const slotOfSegment: number[][] = [];
  const holdOfSegment: number[][] = [];
  const slotBoundsById = new Map<number, Interval>();
  let nextId = 1;

  for (const mission of problem.missions) {
    const slots = segments.map(() => 0);
    const holds = segments.map(() => 0);

    if (mission.kind === 'local') {
      const bounds = mission.slotBounds;
      const idOfBound = new Map<number, number>();
      for (let i = 0; i + 1 < bounds.length; i++) {
        const id = nextId++;
        idOfBound.set(bounds[i], id);
        slotBoundsById.set(id, { start: bounds[i], end: bounds[i + 1] });
      }
      segments.forEach((segment, segmentIndex) => {
        if (!isRunning(mission, segment)) return;
        let lo = 0;
        while (lo + 2 < bounds.length && bounds[lo + 1] <= segment.start) lo++;
        slots[segmentIndex] = idOfBound.get(bounds[lo]) ?? 0;
      });
    } else if (mission.kind === 'remote') {
      const id = nextId++;
      slotBoundsById.set(id, mission.window);
      segments.forEach((segment, segmentIndex) => {
        if (!isRunning(mission, segment)) return;
        slots[segmentIndex] = id;
        holds[segmentIndex] = id;
      });
    } else {
      for (const occurrence of mission.occurrences) {
        const id = nextId++;
        slotBoundsById.set(id, occurrence);
        segments.forEach((segment, segmentIndex) => {
          if (!overlaps(segment, occurrence)) return;
          slots[segmentIndex] = id;
          holds[segmentIndex] = id;
        });
      }
    }
    slotOfSegment.push(slots);
    holdOfSegment.push(holds);
  }
  return { slotOfSegment, holdOfSegment, slotBoundsById };
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export function availabilityMatrix(problem: PreparedProblem, segments: readonly Interval[]): boolean[][] {
  return problem.employees.map((employee) => segments.map(
    (segment) => segment.start >= employee.available.start && segment.end <= employee.available.end,
  ));
}

/** Exclusions filter automatic candidates only; a commitment still overrides them, visibly. */
export function allowedMatrix(problem: PreparedProblem): boolean[][] {
  return problem.employees.map((employee) => problem.missions.map((mission) => {
    if (mission.exclusions.employees.has(employee.id)) return false;
    for (const tag of mission.exclusions.tags) if (employee.qualifications.has(tag)) return false;
    return true;
  }));
}

/* ------------------------------------------------------------------ */
/* Commitments and requirements                                        */
/* ------------------------------------------------------------------ */

/**
 * One triple per (commitment, covered segment).
 *
 * Two triples naming the same cell with different missions are deliberately
 * **not** merged: the model then reports the instance infeasible, which is the
 * honest answer. Silently dropping one of two facts is how a manual assignment
 * disappears without anybody being told.
 */
export function commitmentTriples(
  problem: PreparedProblem,
  segments: readonly Interval[],
): { pinEmployee: number[]; pinMission: number[]; pinSegment: number[] } {
  const employeeIndexById = new Map(problem.employees.map((e, i) => [e.id, i + 1]));
  const missionIndexById = new Map(problem.missions.map((m, i) => [m.id, i + 1]));
  const pinEmployee: number[] = [];
  const pinMission: number[] = [];
  const pinSegment: number[] = [];
  for (const commitment of problem.commitments) {
    const employee = employeeIndexById.get(commitment.employeeId);
    const mission = missionIndexById.get(commitment.missionId);
    if (employee === undefined || mission === undefined) continue;
    segments.forEach((segment, segmentIndex) => {
      if (!overlaps(segment, commitment.coverage)) return;
      pinEmployee.push(employee);
      pinMission.push(mission);
      pinSegment.push(segmentIndex + 1);
    });
  }
  return { pinEmployee, pinMission, pinSegment };
}

export function requirementTables(problem: PreparedProblem): {
  requirementMission: number[]; requirementSeats: number[]; holdsRequirement: boolean[][];
} {
  const requirementMission: number[] = [];
  const requirementSeats: number[] = [];
  const holdsRequirement: boolean[][] = [];
  problem.missions.forEach((mission, missionIndex) => {
    for (const requirement of mission.requires) {
      requirementMission.push(missionIndex + 1);
      requirementSeats.push(requirement.seats);
      holdsRequirement.push(problem.employees.map((e) => e.qualifications.has(requirement.tag)));
    }
  });
  return { requirementMission, requirementSeats, holdsRequirement };
}

/* ------------------------------------------------------------------ */
/* Nights, hours, memory                                               */
/* ------------------------------------------------------------------ */

/** 0 for a day segment, else the 1-based index of the night it lies in. */
export function nightOfSegment(problem: PreparedProblem, segments: readonly Interval[]): number[] {
  return segments.map((segment) => {
    const index = problem.nights.findIndex((night) => segment.start >= night.start && segment.end <= night.end);
    return index < 0 ? 0 : index + 1;
  });
}

/** The hour of the day a segment begins, on the viewer's clock - like the nights. */
export function hourOfSegment(segments: readonly Interval[]): number[] {
  return segments.map((segment) => new Date(segment.start).getHours());
}

export interface MemoryTables {
  idleMinutesAtHorizonStart: number[];
  recentTurns: number[];
  recentNightMinutes: number[];
  recentTurnsOnMission: number[][];
  heldWithinCooldown: boolean[][];
  recentHourHolds: number[][];
  repeatAfterDays: number[];
}

export function memoryTables(problem: PreparedProblem): MemoryTables {
  return {
    idleMinutesAtHorizonStart: problem.employees.map((e) => e.memory.idleMinutesAtHorizonStart),
    recentTurns: problem.employees.map((e) => e.memory.turns),
    recentNightMinutes: problem.employees.map((e) => e.memory.nightMinutes),
    recentTurnsOnMission: problem.employees.map(
      (e) => problem.missions.map((m) => e.memory.turnsOnMission.get(m.id) ?? 0),
    ),
    heldWithinCooldown: problem.employees.map(
      (e) => problem.missions.map((m) => e.memory.heldWithinCooldown.has(m.id)),
    ),
    recentHourHolds: problem.employees.map((e) => [...e.memory.hourHolds]),
    repeatAfterDays: problem.missions.map((m) => m.repeatAfterDays ?? 0),
  };
}

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every *minimal* window of consecutive segments whose minutes exceed the cap:
 * for each first segment, the smallest last segment past it. Linear, and
 * minimal so a person on duty across any longer window is caught by one of
 * these rather than by all of them.
 *
 * `MAX_UNBROKEN_MINUTES` is imported rather than restated so ADR 016's number
 * keeps one definition.
 */
export function enumerateLongRunWindows(
  segments: readonly Interval[],
  capMinutes: number = MAX_UNBROKEN_MINUTES,
): { first: number[]; last: number[] } {
  const minutes = segments.map((s) => (s.end - s.start) / MINUTE);
  const first: number[] = [];
  const last: number[] = [];
  let end = 0;
  let total = 0;
  for (let start = 0; start < segments.length; start++) {
    if (end < start) { end = start; total = 0; }
    while (end < segments.length && total <= capMinutes) { total += minutes[end]; end++; }
    if (total > capMinutes) { first.push(start + 1); last.push(end); }
    total -= minutes[start];
  }
  return { first, last };
}

/**
 * Every minimal window of consecutive segments *inside one night* long enough
 * for the eight-hour target. The same shape as the long-run windows, read the
 * other way round: a person off duty across one of these has slept.
 */
export function enumerateSleepWindows(
  segments: readonly Interval[],
  nights: readonly number[],
  minutes: number = TARGET_REST_MINUTES,
): { first: number[]; last: number[]; night: number[] } {
  const lengths = segments.map((s) => (s.end - s.start) / MINUTE);
  const first: number[] = [];
  const last: number[] = [];
  const night: number[] = [];
  for (let start = 0; start < segments.length; start++) {
    const inNight = nights[start];
    if (!inNight) continue;
    let total = 0;
    for (let end = start; end < segments.length && nights[end] === inNight; end++) {
      total += lengths[end];
      if (total >= minutes) { first.push(start + 1); last.push(end + 1); night.push(inNight); break; }
    }
  }
  return { first, last, night };
}

/* ------------------------------------------------------------------ */
/* Symmetry                                                            */
/* ------------------------------------------------------------------ */

/**
 * People who are interchangeable in every respect the model can see get a
 * shared class id, so the solver orders them instead of walking their
 * permutations. Anyone named by a commitment is a singleton: their row is
 * already fixed somewhere, so swapping them for an equal is not a symmetry.
 *
 * The eight-hour cap on the remembered wait is what makes this pay: it makes
 * most of a rested roster identical at the horizon start, which is exactly
 * when there are permutations worth not walking.
 */
export function deriveSymmetryClasses(
  problem: PreparedProblem,
  isAvailable: readonly (readonly boolean[])[],
  isAllowed: readonly (readonly boolean[])[],
  holdsRequirement: readonly (readonly boolean[])[],
  memory: MemoryTables,
): number[] {
  const committed = new Set(problem.commitments.map((c) => c.employeeId));
  const keyOf = (index: number) => [
    isAvailable[index].map((v) => (v ? 1 : 0)).join(''),
    isAllowed[index].map((v) => (v ? 1 : 0)).join(''),
    holdsRequirement.map((row) => (row[index] ? 1 : 0)).join(''),
    problem.employees[index].requiredNightRestMinutes,
    memory.idleMinutesAtHorizonStart[index],
    memory.recentTurns[index],
    memory.recentNightMinutes[index],
    memory.recentTurnsOnMission[index].join(','),
    memory.heldWithinCooldown[index].map((v) => (v ? 1 : 0)).join(''),
    memory.recentHourHolds[index].join(','),
  ].join('|');

  const byKey = new Map<string, number[]>();
  problem.employees.forEach((employee, index) => {
    if (committed.has(employee.id)) return;
    const key = keyOf(index);
    const group = byKey.get(key);
    if (group) group.push(index); else byKey.set(key, [index]);
  });

  const classes = problem.employees.map(() => 0);
  let next = 1;
  // Only a run of *adjacent* rows can be lex-ordered by the model's
  // constraint, so a class is minted per maximal adjacent run within a group.
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    let runStart = 0;
    for (let i = 1; i <= group.length; i++) {
      if (i < group.length && group[i] === group[i - 1] + 1) continue;
      if (i - runStart >= 2) {
        const id = next++;
        for (let j = runStart; j < i; j++) classes[group[j]] = id;
      }
      runStart = i;
    }
  }
  return classes;
}

/* ------------------------------------------------------------------ */
/* compileInstance                                                     */
/* ------------------------------------------------------------------ */

export function compileInstance(problem: PreparedProblem): { instance: SolverInstance; index: InstanceIndex } {
  const { segments } = buildGlobalSegmentGrid(problem);
  const seatsWanted = seatsWantedMatrix(problem, segments);
  const { slotOfSegment, holdOfSegment, slotBoundsById } = slotAndHoldMatrices(problem, segments);
  const isAvailable = availabilityMatrix(problem, segments);
  const isAllowed = allowedMatrix(problem);
  const pins = commitmentTriples(problem, segments);
  const requirements = requirementTables(problem);
  const nights = nightOfSegment(problem, segments);
  const memory = memoryTables(problem);
  const longRun = enumerateLongRunWindows(segments);
  const sleep = enumerateSleepWindows(segments, nights);

  const instance: SolverInstance = {
    employeeCount: problem.employees.length,
    missionCount: problem.missions.length,
    segmentCount: segments.length,
    nightCount: problem.nights.length,
    pinCount: pins.pinEmployee.length,
    requirementCount: requirements.requirementMission.length,
    longRunWindowCount: longRun.first.length,
    sleepWindowCount: sleep.first.length,

    segmentMinutes: segments.map((s) => Math.round((s.end - s.start) / MINUTE)),
    nightOfSegment: nights,
    seatsWanted,
    slotOfSegment,
    holdOfSegment,

    isAvailable,
    isAllowed,

    idleMinutesAtHorizonStart: memory.idleMinutesAtHorizonStart,
    recentTurns: memory.recentTurns,
    recentNightMinutes: memory.recentNightMinutes,
    recentTurnsOnMission: memory.recentTurnsOnMission,
    heldWithinCooldown: memory.heldWithinCooldown,
    recentHourHolds: memory.recentHourHolds,
    hourOfSegment: hourOfSegment(segments),
    repeatAfterDays: memory.repeatAfterDays,
    requiredNightRestMinutes: problem.employees.map((e) => e.requiredNightRestMinutes),
    symmetryClass: deriveSymmetryClasses(problem, isAvailable, isAllowed, requirements.holdsRequirement, memory),

    // Index 0 is OFF_DUTY, which is always sleepable; an on-call mission may be
    // slept through and so counts as rest (ADR 007).
    isSleepable: [true, ...problem.missions.map((m) => m.onCall)],

    pinEmployee: pins.pinEmployee,
    pinMission: pins.pinMission,
    pinSegment: pins.pinSegment,

    requirementMission: requirements.requirementMission,
    requirementSeats: requirements.requirementSeats,
    holdsRequirement: requirements.holdsRequirement,

    longRunFirstSegment: longRun.first,
    longRunLastSegment: longRun.last,

    sleepWindowFirstSegment: sleep.first,
    sleepWindowLastSegment: sleep.last,
    sleepWindowNight: sleep.night,
  };

  const index: InstanceIndex = {
    segments,
    employeeIds: problem.employees.map((e) => e.id),
    missionIds: problem.missions.map((m) => m.id),
    slotOfSegment,
    holdOfSegment,
    slotBoundsById,
    nights: problem.nights,
    requirementCount: requirements.requirementMission.length,
  };

  return { instance, index };
}

/**
 * The object handed to `Model.addJson`.
 *
 * Empty 2-D parameters are written as `[]` rather than as a list of empty
 * rows: MiniZinc reads a `0..0` array that way and a list of empty rows only
 * by accident.
 */
export function instanceToJsonData(instance: SolverInstance, ladder: LadderParams): Record<string, unknown> {
  const data: Record<string, unknown> = { ...instance };
  for (const key of ['seatsWanted', 'slotOfSegment', 'holdOfSegment', 'recentTurnsOnMission', 'heldWithinCooldown', 'holdsRequirement'] as const) {
    const value = data[key] as readonly unknown[];
    if (value.length === 0) data[key] = [];
  }
  if (ladder.objectiveCap.length !== LEVEL_COUNT) {
    throw new Error(`objectiveCap must carry ${LEVEL_COUNT} entries`);
  }
  data.objectiveLevel = ladder.objectiveLevel;
  data.objectiveCap = [...ladder.objectiveCap];
  if (ladder.candidateAssignment) data.candidateAssignment = ladder.candidateAssignment;
  return data;
}

/** A flat 0-based assignment as the nested matrix check mode fixes. */
export function assignmentToMatrix(assignment: Uint8Array, employeeCount: number, segmentCount: number): number[][] {
  const rows: number[][] = [];
  for (let employee = 0; employee < employeeCount; employee++) {
    const row: number[] = [];
    for (let segment = 0; segment < segmentCount; segment++) {
      row.push(assignment[employee * segmentCount + segment]);
    }
    rows.push(row);
  }
  return rows;
}
