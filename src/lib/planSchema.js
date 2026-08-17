import { z } from 'zod';

/**
 * The plan document is the single source of truth: everything the planner
 * types, including manual assignments, lives here and nowhere else. The
 * schedule is a pure function of this object, which is what lets the whole plan
 * travel in a URL.
 */

export const SCHEMA_VERSION = 1;

const id = z.string().min(1).max(64);
const ts = z.number().int().finite();

export const employeeSchema = z.object({
  id,
  // Names may be blank while the planner is still typing - a half-filled row
  // must never fail validation and take the whole document down with it.
  name: z.string().max(80),
  start: ts.nullable().default(null),
  end: ts.nullable().default(null),
});

export const missionSchema = z.object({
  id,
  name: z.string().max(80),
  type: z.enum(['remote', 'local']),
  start: ts.nullable().default(null),
  end: ts.nullable().default(null),
  count: z.number().int().min(1).max(999),
});

export const pinSchema = z.object({
  missionId: id,
  employeeId: id,
  start: ts.nullable().default(null),
  end: ts.nullable().default(null),
  // Set only by freezeElapsedBeforeEdit (src/lib/pins.js): the engine decided
  // this before it was ever a shared decision to protect, so unlike a pin a
  // person actually chose, it must not be invalidated by a later availability
  // edit - see planner.js's normalizePins.
  frozen: z.boolean().default(false),
});

export const planSchema = z.object({
  version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  title: z.string().max(120).default(''),
  start: ts,
  end: ts,
  shiftMinutes: z.number().int().min(5).max(24 * 60),
  employees: z.array(employeeSchema).default([]),
  missions: z.array(missionSchema).default([]),
  pins: z.array(pinSchema).default([]),
});

/** Short, stable ids. Not cryptographic - just unique within one plan. */
export function makeId(prefix, existing = []) {
  const taken = new Set(existing);
  for (let n = 1; ; n++) {
    const candidate = `${prefix}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Round `date` down to the start of its hour, in local time. */
export function topOfHour(date) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

/** The start of the hour *after* `date`'s - unconditionally, even right at :00. */
export function nextTopOfHour(date) {
  return topOfHour(date) + 60 * 60 * 1000;
}

/** A sensible starting document: tonight, hourly shifts, nothing else filled in. */
export function emptyPlan(now = Date.now()) {
  const start = topOfHour(now);
  return planSchema.parse({
    version: SCHEMA_VERSION,
    title: '',
    start,
    end: start + 24 * 60 * 60 * 1000,
    shiftMinutes: 60,
    employees: [],
    missions: [],
    pins: [],
  });
}

/**
 * Drop pins whose employee or mission no longer exists. Called after any delete
 * so the document never carries dangling references around in the URL.
 */
export function prunePins(doc) {
  const employeeIds = new Set(doc.employees.map((e) => e.id));
  const missionIds = new Set(doc.missions.map((m) => m.id));
  const pins = doc.pins.filter((p) => employeeIds.has(p.employeeId) && missionIds.has(p.missionId));
  return pins.length === doc.pins.length ? doc : { ...doc, pins };
}

/** Shape the document into the planner engine's input. */
export function toPlannerInput(doc) {
  return {
    start: doc.start,
    end: doc.end,
    shiftMinutes: doc.shiftMinutes,
    employees: doc.employees.map((e) => ({
      id: e.id,
      name: e.name,
      start: e.start ?? undefined,
      end: e.end ?? undefined,
    })),
    missions: doc.missions.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      start: m.start ?? undefined,
      end: m.end ?? undefined,
      count: m.count,
    })),
    pins: doc.pins.map((p) => ({
      missionId: p.missionId,
      employeeId: p.employeeId,
      start: p.start ?? undefined,
      end: p.end ?? undefined,
      frozen: Boolean(p.frozen),
    })),
  };
}
