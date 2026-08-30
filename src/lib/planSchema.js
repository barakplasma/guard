import { z } from 'zod';
import { STRATEGY, DEFAULT_STRATEGY } from './strategies.js';

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

/** Minutes past midnight, the unit both night boundaries are written in. */
const minuteOfDay = z.number().int().min(0).max(24 * 60 - 1);

/** 22:00 to 06:00 - the default night, and what every link written before it existed means. */
export const DEFAULT_NIGHT_START = 22 * 60;
export const DEFAULT_NIGHT_END = 6 * 60;

export const missionSchema = z.object({
  id,
  name: z.string().max(80),
  type: z.enum(['remote', 'local']),
  start: ts.nullable().default(null),
  end: ts.nullable().default(null),
  count: z.number().int().min(1).max(999),
  // Headcount for the plan's night stretches. `null` means "same as `count`",
  // which is what a link written before this field existed decodes to - and
  // what a mission staffed evenly round the clock keeps meaning.
  nightCount: z.number().int().min(1).max(999)
    .nullable()
    .default(null),
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
  // Which policy decides who works a given slot. Defaulted rather than
  // required so every link written before it existed still parses.
  strategy: z.enum([STRATEGY.BALANCED, STRATEGY.ROTATION]).default(DEFAULT_STRATEGY),
  // When night begins and ends, as wall-clock minutes past midnight. Defaulted
  // like `strategy`, so older links keep their old meaning: with no mission
  // carrying a `nightCount`, these two decide nothing at all.
  nightStart: minuteOfDay.default(DEFAULT_NIGHT_START),
  nightEnd: minuteOfDay.default(DEFAULT_NIGHT_END),
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
    strategy: DEFAULT_STRATEGY,
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

const DAY = 24 * 60 * 60 * 1000;

/** `minutes` past midnight, `offset` days on from `day`'s midnight, in local time. */
function atMinute(day, offset, minutes) {
  const d = new Date(day);
  d.setDate(d.getDate() + offset);
  d.setHours(0, minutes, 0, 0);
  return d.getTime();
}

/**
 * The plan's night stretches, as absolute instants.
 *
 * This is where a wall-clock hour becomes a real moment, and it is deliberately
 * *outside* the engine. "22:00" is not a point in time until a timezone says so,
 * and `planner.js` may not consult one - it would make the same document
 * schedule differently for whoever opened the link. So the resolution happens
 * once, here in the adapter, and the engine only ever sees intervals.
 *
 * The trade that leaves: the boundary is read in the *viewer's* timezone, so a
 * plan opened several timezones away splits its nights where the reader's clock
 * says 22:00, not the author's. For a Hebrew, Israel-only rota that is the
 * reading people actually want, and it is the only part of the document that
 * behaves this way - see CLAUDE.md.
 *
 * Boundaries are stepped with `Date` rather than by adding milliseconds so a
 * daylight-saving change keeps night starting at 22:00 on both sides of it.
 */
export function nightWindows(doc) {
  // Equal bounds mean an empty night, not a 24-hour one: with no width there is
  // no stretch to staff differently, and treating it as all day would silently
  // apply every night headcount around the clock.
  if (doc.nightStart === doc.nightEnd) return [];
  // Start a day early: a night beginning at 22:00 the evening before the plan
  // opens still covers the plan's first hours.
  const cursor = new Date(doc.start);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - 1);

  const out = [];
  const days = Math.ceil((doc.end - doc.start) / DAY) + 2;
  for (let i = 0; i <= days; i++) {
    const start = atMinute(cursor, i, doc.nightStart);
    // A night that ends earlier in the day than it starts runs past midnight.
    const end = atMinute(cursor, doc.nightEnd <= doc.nightStart ? i + 1 : i, doc.nightEnd);
    if (end > doc.start && start < doc.end) out.push({ start, end });
  }
  return out;
}

/** Shape the document into the planner engine's input. */
export function toPlannerInput(doc) {
  return {
    start: doc.start,
    end: doc.end,
    shiftMinutes: doc.shiftMinutes,
    strategy: doc.strategy,
    nightWindows: nightWindows(doc),
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
      nightCount: m.nightCount ?? undefined,
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
