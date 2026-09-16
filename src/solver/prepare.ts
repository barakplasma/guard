/**
 * The plan document, read once, into the one value the solver path uses.
 *
 * Every rule here already exists somewhere in `src/lib` and is *called*, not
 * restated: the segment grid comes from `segmentGrid`, the surviving pins and
 * the findings they raised from `normalizedInput`, the nights from
 * `nightWindows`, the daily holds from `dailyOccurrences`, and the headcount
 * at an instant from `countAt` one module along, in `compile.ts`. A second
 * implementation of any of those would disagree with the engine about what a
 * shift *is*, in a way neither side reveals on its own reading.
 *
 * `prepareProblem` is pure and never throws on a half-typed document: a plan
 * is somebody's only copy and a validation error takes the whole thing down.
 * Everything it cannot use comes back as a `PreparationIssue`.
 *
 * `now` enters here, exactly as it enters `toPlannerInput` today, and nowhere
 * else in `src/solver`.
 */

import {
  normalizedInput, segmentGrid, isOutOfPeriod, isElapsedBeforePeriod, resolvePinWindow,
} from '../lib/planner.js';
import { nightWindows, dailyOccurrences, toPlannerInput } from '../lib/planSchema.js';
import { digestOf } from './revision.ts';
import {
  MAX_MISSIONS, MODEL_VERSION, TARGET_REST_MINUTES,
} from './types.ts';
import type {
  Commitment, DutyMemory, EmployeeId, Exclusions, InstantMs, Interval, MissionId,
  PreparationIssue, PreparedEmployee, PreparedMission, PreparedProblem,
  ProblemRevision, QualificationId, Requirement,
} from './types.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * 60 * 1000;

/** How far back the log is read when the document does not say. */
export const DEFAULT_MEMORY_DAYS = 21;

/**
 * The document as `planSchema.parse` returns it. Typed loosely on purpose:
 * the strict draft schema is step 1's own concern and does not gate this
 * module, and a half-filled row must reach here rather than fail validation.
 */
// oxlint-disable-next-line no-explicit-any
type Draft = any;

const asInstant = (value: number): InstantMs => value as InstantMs;
const interval = (start: number, end: number): Interval => ({ start: asInstant(start), end: asInstant(end) });

/* ------------------------------------------------------------------ */
/* Nights, occurrences, qualifications                                 */
/* ------------------------------------------------------------------ */

/** The plan's nights, clipped to the horizon and merged, as the model's `Nights`. */
export function resolveNights(draft: Draft): Interval[] {
  const raw: { start: number; end: number }[] = nightWindows(draft);
  const clipped = raw
    .map((w) => ({ start: Math.max(w.start, draft.start), end: Math.min(w.end, draft.end) }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const w of clipped) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  return merged.map((w) => interval(w.start, w.end));
}

/**
 * The nights over the *memory* horizon, not only the plan's.
 *
 * The same function and the same wall-clock rule, asked a wider question: the
 * log reaches back `memoryDays`, and "how many night minutes has this person
 * already stood" is unanswerable over a window that stops at the plan's start.
 * Resolved here rather than in the engine for the reason `nightWindows` gives
 * - a wall-clock hour is not a moment until a timezone says so.
 */
function memoryNights(draft: Draft, memoryStart: number): { start: number; end: number }[] {
  return nightWindows({ ...draft, start: Math.min(memoryStart, draft.start) });
}

function exclusionsOf(mission: Draft): Exclusions {
  return {
    tags: new Set((mission.excludes ?? []) as QualificationId[]),
    employees: new Set((mission.excludeEmployees ?? []) as EmployeeId[]),
  };
}

function requirementsOf(mission: Draft): Requirement[] {
  return (mission.requires ?? []).map((r: Draft) => ({
    tag: r.tag as QualificationId,
    seats: r.count as number,
  }));
}

/** The highest minimum any qualification the person holds asks for; 0 when none does. */
function requiredNightRest(employee: Draft, tags: Draft[]): number {
  const held = new Set<string>(employee.tags ?? []);
  return Math.max(0, ...tags
    .filter((tag) => held.has(tag.id))
    .map((tag) => tag.minNightRestMinutes ?? 0));
}

/* ------------------------------------------------------------------ */
/* The log as memory                                                   */
/* ------------------------------------------------------------------ */

/** One person's running totals while the log is walked. */
interface Tally {
  lastEnd: number;
  turns: number;
  nightMinutes: number;
  turnsOnMission: Map<MissionId, number>;
  heldWithinCooldown: Set<MissionId>;
  hourHolds: number[];
  lastOnMission: Map<MissionId, number>;
}

const blankTally = (): Tally => ({
  lastEnd: -Infinity,
  turns: 0,
  nightMinutes: 0,
  turnsOnMission: new Map(),
  heldWithinCooldown: new Set(),
  hourHolds: Array.from({ length: 24 }, () => 0),
  lastOnMission: new Map(),
});

interface LoggedTurn {
  employeeId: EmployeeId;
  missionId: MissionId;
  start: number;
  end: number;
}

/**
 * Logged duty inside the memory horizon, resolved to literal instants.
 *
 * Read from the **raw** missions, exactly like the `pin-out-of-period` count
 * and for the same reason: a mission that has itself dropped out of the period
 * is already gone from the normalized list, and the hours its pins record are
 * no less real. A pin carrying a record already has literal bounds; one that
 * does not is resolved through the whole chain by `resolvePinWindow`.
 */
export function loggedTurns(draft: Draft, memoryDays: number): LoggedTurn[] {
  const missionById = new Map<string, Draft>(draft.missions.map((m: Draft) => [m.id, m]));
  const memoryStart = draft.start - memoryDays * DAY;
  const out: LoggedTurn[] = [];
  for (const pin of draft.pins) {
    const mission = missionById.get(pin.missionId);
    if (!isElapsedBeforePeriod(pin, mission, draft.start, draft.end)) continue;
    const window = resolvePinWindow(pin, mission, draft.start, draft.end);
    if (!(window.end > window.start)) continue;
    if (window.end <= memoryStart) continue;
    out.push({
      employeeId: pin.employeeId as EmployeeId,
      missionId: pin.missionId as MissionId,
      start: window.start,
      end: window.end,
    });
  }
  return out;
}

/**
 * What the log says about each person, as the model's memory parameters.
 *
 * There is no `carriedMinutes`, `carriedStints` or `lastDutyEnd` behind any of
 * this. The owner's decision is that duty is exported and never cleared, so
 * the rows stay in the document and every number about the past is derived
 * from them here, at preparation time - which is what removes the whole class
 * of bug where a total has to be stamped exactly when a window rolls.
 *
 * `idleMinutesAtHorizonStart` is capped at eight hours on purpose: after a
 * night's sleep it no longer matters when somebody last stood post, and the
 * cap is what keeps the round-robin level a small-domain quantity.
 */
export function readDutyMemory(draft: Draft, memoryDays = DEFAULT_MEMORY_DAYS): Map<EmployeeId, DutyMemory> {
  const turns = loggedTurns(draft, memoryDays);
  const nights = memoryNights(draft, draft.start - memoryDays * DAY);
  const slotMs = Math.max(1, (draft.shiftMinutes ?? 60) * MINUTE);
  const repeatById = new Map<string, number | null>(
    draft.missions.map((m: Draft) => [m.id, m.repeatAfterDays ?? null]),
  );

  const byEmployee = new Map<EmployeeId, Tally>();
  for (const employee of draft.employees) {
    byEmployee.set(employee.id as EmployeeId, blankTally());
  }

  for (const turn of turns) {
    let at = byEmployee.get(turn.employeeId);
    // A record whose guard has since left the roster still happened; it only
    // stops mattering because nothing will ask about them again.
    if (!at) { at = blankTally(); byEmployee.set(turn.employeeId, at); }

    // No grid left to name a slot on, so a turn is one plan shift length, at
    // least one - the same approximation ADR 015 recorded for carried stints.
    const stints = Math.max(1, Math.round((turn.end - turn.start) / slotMs));
    at.turns += stints;
    at.turnsOnMission.set(turn.missionId, (at.turnsOnMission.get(turn.missionId) ?? 0) + stints);
    at.lastEnd = Math.max(at.lastEnd, turn.end);
    at.lastOnMission.set(turn.missionId, Math.max(at.lastOnMission.get(turn.missionId) ?? -Infinity, turn.end));
    at.hourHolds[new Date(turn.start).getHours()] += 1;
    for (const night of nights) {
      at.nightMinutes += Math.max(0, Math.min(turn.end, night.end) - Math.max(turn.start, night.start)) / MINUTE;
    }
  }

  const out = new Map<EmployeeId, DutyMemory>();
  for (const [employeeId, at] of byEmployee) {
    for (const [missionId, lastEnd] of at.lastOnMission) {
      const repeatAfterDays = repeatById.get(missionId);
      if (!repeatAfterDays) continue;
      if (draft.start - lastEnd < repeatAfterDays * DAY) at.heldWithinCooldown.add(missionId);
    }
    const idle = at.lastEnd === -Infinity
      ? TARGET_REST_MINUTES
      : Math.max(0, Math.min(TARGET_REST_MINUTES, Math.round((draft.start - at.lastEnd) / MINUTE)));
    out.set(employeeId, {
      idleMinutesAtHorizonStart: idle as DutyMemory['idleMinutesAtHorizonStart'],
      turns: at.turns,
      nightMinutes: Math.round(at.nightMinutes) as DutyMemory['nightMinutes'],
      turnsOnMission: at.turnsOnMission,
      heldWithinCooldown: at.heldWithinCooldown,
      hourHolds: at.hourHolds,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Issues                                                              */
/* ------------------------------------------------------------------ */

/**
 * The engine's warning codes are the solver's issue codes, unchanged, so
 * `findings.js` renders them without knowing which path produced them. Only
 * the structural ones cross over: quality findings are a reading of an
 * accepted answer and belong in `views.ts`.
 */
const CARRIED_CODES = new Set([
  'mission-outside-window', 'employee-window-outside-plan', 'pin-conflict',
  'pin-overflow', 'pin-unavailable', 'pin-availability-overridden',
]);

/**
 * Assignments the engine is ignoring because the period has moved past them.
 *
 * Both numbers, for the reason ADR 012's correction gives: `count` is
 * everything outside the window, which is worth knowing about whichever side
 * it fell on, and `elapsed` is the half that is actually history. Counted from
 * the raw missions, because a mission that dropped out of the period takes its
 * pins out of every normalized list before anything can see them.
 */
export function countStaleCommitments(draft: Draft): { count: number; elapsed: number } {
  const missionById = new Map<string, Draft>(draft.missions.map((m: Draft) => [m.id, m]));
  const stale = draft.pins.filter(
    (p: Draft) => isOutOfPeriod(p, missionById.get(p.missionId), draft.start, draft.end),
  );
  const elapsed = stale.filter(
    (p: Draft) => isElapsedBeforePeriod(p, missionById.get(p.missionId), draft.start, draft.end),
  ).length;
  return { count: stale.length, elapsed };
}

/* ------------------------------------------------------------------ */
/* prepareProblem                                                      */
/* ------------------------------------------------------------------ */

export function prepareProblem(draft: Draft, clock: { now: number }): PreparedProblem {
  const horizon = interval(draft.start, draft.end);
  const loggedBefore = asInstant(clock.now);
  const memoryDays = draft.memoryDays ?? DEFAULT_MEMORY_DAYS;
  const issues: PreparationIssue[] = [];

  const input = toPlannerInput(draft, clock.now);
  const normalized = normalizedInput(input);
  const grid: { mission: Draft; segments: { start: number; end: number; slot: { start: number; end: number } }[] }[] =
    segmentGrid(input);
  const segmentsByMission = new Map<string, { start: number; end: number; slot: { start: number; end: number } }[]>(
    grid.map((entry) => [entry.mission.id, entry.segments]),
  );

  for (const warning of normalized.warnings) {
    if (CARRIED_CODES.has(warning.code)) issues.push(warning as PreparationIssue);
  }

  const stale = countStaleCommitments(draft);
  if (stale.count > 0) {
    issues.push({ code: 'pin-out-of-period', count: stale.count, elapsed: stale.elapsed });
  }

  const nights = resolveNights(draft);
  const memory = readDutyMemory(draft, memoryDays);
  const emptyMemory: DutyMemory = {
    idleMinutesAtHorizonStart: TARGET_REST_MINUTES as DutyMemory['idleMinutesAtHorizonStart'],
    turns: 0,
    nightMinutes: 0 as DutyMemory['nightMinutes'],
    turnsOnMission: new Map(),
    heldWithinCooldown: new Set(),
    hourHolds: Array.from({ length: 24 }, () => 0),
  };

  const employees: PreparedEmployee[] = normalized.employees.map((employee: Draft) => ({
    id: employee.id as EmployeeId,
    available: interval(employee.start, employee.end),
    qualifications: new Set((employee.tags ?? []) as QualificationId[]),
    requiredNightRestMinutes: requiredNightRest(employee, draft.tags ?? []) as PreparedEmployee['requiredNightRestMinutes'],
    memory: memory.get(employee.id as EmployeeId) ?? emptyMemory,
  }));

  const rawById = new Map<string, Draft>(draft.missions.map((m: Draft) => [m.id, m]));
  const missions: PreparedMission[] = [];
  for (const mission of normalized.missions) {
    const raw = rawById.get(mission.id) ?? mission;
    const repeatAfterDays: number | null = raw.repeatAfterDays ?? null;
    if (repeatAfterDays != null && repeatAfterDays > memoryDays) {
      issues.push({
        code: 'cooldown-beyond-memory',
        missionId: mission.id as MissionId,
        repeatAfterDays,
        memoryDays,
      });
    }
    const common = {
      id: mission.id as MissionId,
      requires: requirementsOf(mission),
      exclusions: exclusionsOf(mission),
      onCall: Boolean(mission.onCall),
      repeatAfterDays,
    };
    for (const requirement of common.requires) {
      if (common.exclusions.tags.has(requirement.tag)) {
        issues.push({ code: 'tag-required-and-excluded', missionId: common.id, tag: requirement.tag });
      }
    }
    const window = interval(mission.start, mission.end);

    if (mission.type === 'remote') {
      missions.push({ ...common, kind: 'remote', window, seats: mission.count });
      continue;
    }
    if (mission.type === 'daily') {
      if (raw.dayStart == null || raw.dayEnd == null) {
        issues.push({ code: 'daily-missing-clock', missionId: common.id });
      }
      const occurrences: Interval[] = (mission.occurrences?.length
        ? mission.occurrences
        : dailyOccurrences(draft, raw)
      ).map((w: { start: number; end: number }) => interval(w.start, w.end));
      missions.push({ ...common, kind: 'daily', window, occurrences, seats: mission.count });
      continue;
    }

    const segments = segmentsByMission.get(mission.id) ?? [];
    const bounds = [...new Set(segments.flatMap((s) => [s.slot.start, s.slot.end]))]
      .sort((a, b) => a - b)
      .map(asInstant);
    missions.push({
      ...common,
      kind: 'local',
      window,
      daySeats: mission.count,
      nightSeats: mission.nightCount,
      slotBounds: bounds,
      segments: segments.map((s) => interval(s.start, s.end)),
    });
  }

  if (missions.length > MAX_MISSIONS) {
    issues.push({ code: 'too-many-missions', count: missions.length, limit: MAX_MISSIONS });
  }

  /**
   * A remote commitment is the whole mission, whatever range was written -
   * `acceptedPins` already widened it and preparation keeps that. Provenance
   * is the `frozen` flag read plainly: the freeze writes machine records, a
   * person writes everything else.
   */
  const commitments: Commitment[] = normalized.pins.map((pin: Draft) => ({
    employeeId: pin.employee.id as EmployeeId,
    missionId: pin.mission.id as MissionId,
    coverage: interval(pin.start, pin.end),
    provenance: pin.frozen ? 'logged' as const : 'manual' as const,
  }));

  const problem: Omit<PreparedProblem, 'revision'> = {
    horizon,
    loggedBefore,
    nights,
    employees,
    missions,
    commitments,
    memoryDays,
    issues,
  };

  return {
    ...problem,
    revision: digestOf({ model: MODEL_VERSION, problem }) as ProblemRevision,
  };
}
