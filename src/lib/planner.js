/**
 * Shift planner.
 *
 * Pure ES module: no DOM, no `Date.now()`, no `Math.random()`, and no
 * imports only pure strategy, qualification, rest, and validation helpers.
 * All times are ms-epoch numbers. Given the same input it always produces
 * byte-identical output - that is what lets a plan live entirely in a shared
 * URL and render the same for everyone who opens it.
 *
 * Mission types:
 *   - `remote` - the same people staff it for its entire duration and are
 *     locked out of everything else while it runs.
 *   - `daily`  - one whole hold per adapter-resolved calendar occurrence.
 *   - `local`  - people rotate among whoever is still available, every
 *     `shiftMinutes`: the plan's, or the mission's own where it sets one, which
 *     may differ again inside the plan's night stretches.
 *
 * *Who* gets a given slot is the one decision this file delegates: the engine
 * works out who is eligible, and the chosen strategy (`strategies.js`) ranks
 * them. Everything else here - normalization, pins, the segment grid, merging,
 * the timeline - is the same whichever strategy is in force.
 *
 * Manual assignments ("pins") are inputs, not patches to the output, so
 * hand-edits survive re-planning and sharing. See `plan`'s jsdoc.
 */

import { getStrategy, DEFAULT_STRATEGY } from './strategies.js';
import { validateSchedule } from './invariants.js';
import { selectCrew, missingQualifications, requirementsOf } from './crew.js';
import { preferredRest, overlapsRest, assessRest, restCost, restMetrics, restDeficit } from './rest.js';
import { proposeCorrections } from './corrections.js';

const MINUTE = 60 * 1000;

/* ------------------------------------------------------------------ */
/* Warning codes                                                       */
/* ------------------------------------------------------------------ */

export const WARN = {
  ENGINE_BUG: 'engine-bug',
  UNDERSTAFFED: 'understaffed',
  EMPLOYEE_UNUSED: 'employee-unused',
  MISSION_OUTSIDE_WINDOW: 'mission-outside-window',
  EMPLOYEE_WINDOW_OUTSIDE_PLAN: 'employee-window-outside-plan',
  PIN_CONFLICT: 'pin-conflict',
  PIN_OVERFLOW: 'pin-overflow',
  PIN_UNAVAILABLE: 'pin-unavailable',
  PIN_OUT_OF_PERIOD: 'pin-out-of-period',
  PIN_AVAILABILITY_OVERRIDDEN: 'pin-availability-overridden',
};

/* ------------------------------------------------------------------ */
/* Normalization + validation                                          */
/* ------------------------------------------------------------------ */

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Is `person` kept off `mission` by an exclusion?
 *
 * Two kinds, deliberately one predicate (ADR 014). A qualification exclusion
 * says "no commander in the kitchen"; a per-person one says "not him, here",
 * which no statement about a qualification can express. Both are hard filters
 * on *automatic* assignment only - a pin still overrides either, visibly,
 * because a manual assignment is an input fact and not a suggestion.
 *
 * One predicate rather than a check at each of the five candidate filters:
 * remote eligibility, the scarcity pool, the local candidate list, repair
 * hints and correction substitutes. A guard that has to be repeated is a guard
 * that will eventually be repeated wrongly.
 */
export function isExcluded(mission, person) {
  return (mission.excludes ?? []).some((tag) => (person.tags ?? []).includes(tag))
    || (mission.excludeEmployees ?? []).includes(person.id);
}

/**
 * Resolve a pin to the window it actually refers to, following the
 * null-inheritance chain: a pin's missing bound comes from its mission, and a
 * mission's missing bound from the plan period.
 *
 * This lives here, rather than in `pins.js` next to the pin edits, because it
 * is the engine's own reading of a pin and `pins.js` already depends on this
 * module. `pinRange` there delegates to it. Two separate walks of the same
 * chain is exactly how the bug below got in.
 */
export function resolvePinWindow(pin, mission, planStart, planEnd) {
  return {
    start: pin.start ?? mission?.start ?? planStart,
    end: pin.end ?? mission?.end ?? planEnd,
  };
}

/**
 * Is `t` inside one of the plan's night stretches?
 *
 * The windows arrive as absolute instants, already resolved. Wall-clock hours
 * mean nothing without a timezone, and resolving one here would make the
 * schedule depend on where the person opening the link happens to be - so that
 * step lives in `toPlannerInput` (planSchema.js) and the engine only ever does
 * interval arithmetic. See CLAUDE.md.
 */
function isNight(t, nightWindows) {
  return nightWindows.some((w) => t >= w.start && t < w.end);
}

/**
 * The plan's nights as a tidy, non-overlapping, ascending list clipped to the
 * plan window - and the day stretches between them, which are simply its
 * complement.
 *
 * A mission whose night slots are a different length from its day ones anchors
 * each stretch at the stretch's own start, so the stretches have to be real
 * intervals rather than the "does this instant fall in a night" question
 * `isNight` asks. The caller's list is taken as given but not trusted to be
 * sorted or disjoint: it is built outside the engine (planSchema.js), and two
 * overlapping nights would otherwise produce two competing anchors.
 */
function stretches(nightWindows, planStart, planEnd) {
  const nights = [];
  const clipped = nightWindows
    .map((w) => ({ start: Math.max(w.start, planStart), end: Math.min(w.end, planEnd) }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  for (const w of clipped) {
    const last = nights[nights.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else nights.push({ ...w });
  }

  const days = [];
  let cursor = planStart;
  for (const n of nights) {
    if (n.start > cursor) days.push({ start: cursor, end: n.start });
    cursor = n.end;
  }
  if (planEnd > cursor) days.push({ start: cursor, end: planEnd });
  return { nights, days };
}

/** How many people a mission needs at `t`, which on a local mission can differ by night. */
function countAt(mission, t, nightWindows) {
  return isNight(t, nightWindows) ? mission.nightCount : mission.count;
}

/** A remote pin's own range is not honoured, so it resolves as if unwritten. */
const WHOLE_MISSION = { start: null, end: null };

/**
 * A remote mission is one slot: it is claimed once and held end to end, so its
 * own window is the only unit there is to merge within or charge a turn for.
 */
const wholeMissionSlot = (mission) => ({ start: mission.start, end: mission.end });

/**
 * Is this pin residue - does the window it refers to fall entirely outside the
 * plan period?
 *
 * On a remote mission the pin's written range is ignored, because a pin there
 * means the whole mission however it was written. What decides the answer is
 * the *mission's* window, not the pin's: a remote pin whose range reads as
 * long past is still staffing the mission right now, and calling it residue
 * would let the cleanup delete a live assignment.
 *
 * The chain has to be walked in full. Resolving a missing bound straight to
 * the plan period instead of the mission's - which an earlier version did -
 * silently answers "no" for every pin on a mission that has itself dropped out
 * of the period, so that mission's frozen history could never be collected by
 * anything and rode along in the URL forever.
 */
export function isOutOfPeriod(pin, mission, planStart, planEnd) {
  const written = mission?.type === 'remote' ? WHOLE_MISSION : pin;
  const { start, end } = resolvePinWindow(written, mission, planStart, planEnd);
  return end <= planStart || start >= planEnd;
}

/**
 * Employees clamped to the plan window. An employee with no window of their own
 * defaults to the whole period, which is the common case.
 */
function normalizeEmployees(employees, planStart, planEnd, warnings) {
  const out = [];
  for (const e of employees) {
    const rawStart = e.start == null ? planStart : e.start;
    const rawEnd = e.end == null ? planEnd : e.end;
    const start = Math.max(rawStart, planStart);
    const end = Math.min(rawEnd, planEnd);
    if (!(end > start)) {
      warnings.push({ code: WARN.EMPLOYEE_WINDOW_OUTSIDE_PLAN, employeeId: e.id });
      continue;
    }
    out.push({ id: e.id, name: e.name, tags: e.tags ?? [], start, end });
  }
  return out;
}

/**
 * A mission's own rotation lengths, or `null` where it defers.
 *
 * Remote missions have no slots to size - one set of people holds the whole
 * window - so both fields are ignored there for the same reason `nightCount`
 * is, rather than quietly shaping a grid nothing rotates on.
 */
function slotMinutesOf(mission) {
  if (mission.type !== 'local') return { day: null, night: null };
  const day = mission.shiftMinutes ?? null;
  const night = mission.nightShiftMinutes ?? null;
  for (const value of [day, night]) {
    if (value != null && !(value > 0)) {
      throw new Error(`Mission "${mission.name}" needs a positive shift length.`);
    }
  }
  return { day, night };
}

function normalizeOccurrences(windows, lo, hi) {
  const out = windows.map((w) => {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end <= w.start) {
      throw new Error('Daily occurrences must have finite increasing bounds.');
    }
    return { start: Math.max(lo, w.start), end: Math.min(hi, w.end) };
  }).filter((w) => w.end > w.start).sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < out.length; i++) {
    if (out[i].start < out[i - 1].end) throw new Error('Daily occurrences must not overlap.');
  }
  return out;
}

/** Missions clamped to the plan window; ones that fall entirely outside are dropped. */
function normalizeMissions(missions, planStart, planEnd, warnings) {
  const out = [];
  for (const m of missions) {
    const rawStart = m.start == null ? planStart : m.start;
    const rawEnd = m.end == null ? planEnd : m.end;
    if (!(rawEnd > rawStart)) {
      throw new Error(`Mission "${m.name}" must end after it starts.`);
    }
    if (!(Number.isInteger(m.count) && m.count >= 1)) {
      throw new Error(`Mission "${m.name}" needs at least one person.`);
    }
    // A mission that does not say otherwise is staffed the same round the
    // clock, which is what every plan written before night counts existed
    // means. Remote missions are held whole by one set of people, so the
    // day/night split has nothing to act on and is ignored there.
    const nightCount = m.type !== 'local' || m.nightCount == null ? m.count : m.nightCount;
    if (!(Number.isInteger(nightCount) && nightCount >= 1)) {
      throw new Error(`Mission "${m.name}" needs at least one person at night.`);
    }
    const start = Math.max(rawStart, planStart);
    const end = Math.min(rawEnd, planEnd);
    if (!(end > start)) {
      warnings.push({ code: WARN.MISSION_OUTSIDE_WINDOW, missionId: m.id });
      continue;
    }
    if (start !== rawStart || end !== rawEnd) {
      warnings.push({ code: WARN.MISSION_OUTSIDE_WINDOW, missionId: m.id, start, end });
    }
    const slot = slotMinutesOf(m);
    out.push({
      id: m.id,
      name: m.name,
      requires: requirementsOf(m.requires), excludes: m.excludes ?? [],
      excludeEmployees: m.excludeEmployees ?? [],
      type: ['remote', 'daily'].includes(m.type) ? m.type : 'local',
      ...(m.type === 'daily' ? { occurrences: normalizeOccurrences(m.occurrences ?? [], start, end) } : {}),
      start,
      end,
      count: m.count,
      nightCount,
      shiftMinutes: slot.day,
      nightShiftMinutes: slot.night,
      onCall: Boolean(m.onCall),
    });
  }
  return out;
}

/**
 * Pins referencing a deleted employee or mission are dropped silently - a stale
 * shared link must keep working rather than erroring. Everything else that
 * cannot be honoured degrades to a warning.
 */
function normalizePins(pins, employeeById, missionById, planStart, planEnd, warnings, nightWindows, loggedBefore = -Infinity) {
  // --- Step 1: resolve every pin to its effective [start, end) coverage ---
  // Everything downstream (dedup, availability, conflicts, capacity) has to
  // reason about coverage, never the literal written range - a whole-mission
  // pin and a per-shift pin can describe the identical assignment while
  // looking nothing alike (see CLAUDE.md). `index` is the pin's position in
  // the document - the only thing that lets step 4 tell a fresh manual
  // decision apart from a stale one.
  const resolved = [];
  pins.forEach((p, index) => {
    const mission = missionById.get(p.missionId);
    const employee = employeeById.get(p.employeeId);
    if (!mission || !employee) return; // stale reference

    // On a remote mission a pin always means the whole mission - that is what
    // "remote" means. A partial range can survive a mission being switched from
    // local to remote; honouring it literally would fill a seat for only part of
    // the window and silently leave the rest short.
    const remote = mission.type === 'remote';
    const start = remote
      ? mission.start
      : Math.max(p.start == null ? mission.start : p.start, mission.start);
    const end = remote
      ? mission.end
      : Math.min(p.end == null ? mission.end : p.end, mission.end);
    if (!(end > start)) {
      // Two situations reach here, and conflating them buries the one worth
      // acting on. Residue from a period the plan has moved past is counted in
      // aggregate by `plan()` below and says nothing here. A pin still inside
      // the period that clamps to nothing genuinely cannot be honoured - the
      // mission does not run when the pin says it does - and unlike an
      // availability mismatch that is not a fact the engine can work around.
      if (!isOutOfPeriod(p, mission, planStart, planEnd)) {
        warnings.push({ code: WARN.PIN_UNAVAILABLE, missionId: mission.id, employeeId: employee.id });
      }
      return;
    }
    const windows = mission.type === 'daily'
      ? mission.occurrences.filter((w) => overlaps(start, end, w.start, w.end))
      : [{ start, end }];
    if (!windows.length && !isOutOfPeriod(p, mission, planStart, planEnd)) {
      warnings.push({ code: WARN.PIN_UNAVAILABLE, missionId: mission.id, employeeId: employee.id });
    }
    for (const w of windows) resolved.push({
      mission, employee, ...w, frozen: Boolean(p.frozen), index,
    });
  });

  // --- Step 2: collapse same-coverage duplicates into one claimant --------
  // A whole-mission pin and a literal range that happens to equal the
  // mission's own window - or a byte-identical duplicate written twice -
  // describe one real assignment. Left unmerged they consume two seats,
  // trigger a bogus PIN_CONFLICT ("assigned to two overlapping missions"
  // when it is one mission), and double up PIN_OVERFLOW. A merged claimant
  // only counts as "frozen" (for the seat-contest precedence in step 4) when
  // *every* raw pin behind it was machine-written - one explicit (human) pin
  // among the duplicates makes the whole claim explicit - and inherits the
  // most recent of their document positions, since that is the freshest
  // decision behind the merged claim.
  const claimants = [];
  const claimByKey = new Map();
  for (const r of resolved) {
    const key = [r.mission.id, r.employee.id, r.start, r.end].join('|');
    const existing = claimByKey.get(key);
    if (existing) {
      existing.frozen = existing.frozen && r.frozen;
      existing.index = Math.max(existing.index, r.index);
      continue;
    }
    claimByKey.set(key, r);
    claimants.push(r);
  }

  // --- Step 3: availability is informational, never a veto -----------------
  // "What I change manually must always win and become fact for the
  // algorithm to work around." A manual assignment (frozen or explicit) is a
  // statement about what actually happened; a stale availability window is
  // just that - stale. It no longer drops the pin, only notes the mismatch
  // for a human to notice. (There used to be a bypass here for frozen pins
  // specifically, so that a later availability edit could not invalidate an
  // already-elapsed shift; now that availability can never invalidate *any*
  // pin, that bypass has nothing left to protect against and is gone.)
  for (const c of claimants) {
    if (c.employee.start > c.start || c.employee.end < c.end) {
      warnings.push({
        code: WARN.PIN_AVAILABILITY_OVERRIDDEN, missionId: c.mission.id, employeeId: c.employee.id, start: c.start, end: c.end,
      });
    }
  }

  // --- Step 4: settle contested seats and person-conflicts ------------------
  // Priority, highest first: an explicit (human) pin beats a frozen
  // (machine-written) one; within the same class, the more recently written
  // pin wins - pins are appended to the document in edit order, so a later
  // index is a newer decision; a stable id comparison breaks any remaining
  // tie, per CLAUDE.md. Processing claimants in this order, instead of
  // document order, means the walk never has to *evict* anything it already
  // placed: whichever claim is handled first is, by construction, the one
  // that should hold the seat, so a later, lower-priority claim for the same
  // person or the same seat is simply rejected.
  const ordered = [...claimants].sort((a, b) => (
    Number(a.frozen) - Number(b.frozen)
    || b.index - a.index
    || (a.employee.id < b.employee.id ? -1 : a.employee.id > b.employee.id ? 1 : 0)
  ));

  const accepted = [];
  const perMission = new Map();
  for (const c of ordered) {
    // A person cannot be in two places at once. Whoever already holds an
    // overlapping seat outranks this claim (it was placed earlier in this
    // priority order, i.e. it IS the fresher or more explicit decision), so
    // this one is the one that loses - "the old assignment was cancelled".
    const personClash = accepted.some(
      (q) => q.employeeId === c.employee.id && overlaps(q.start, q.end, c.start, c.end),
    );
    if (personClash) {
      warnings.push({
        code: WARN.PIN_CONFLICT, missionId: c.mission.id, employeeId: c.employee.id, start: c.start, end: c.end,
      });
      continue;
    }

    // More claimants than the mission has seats at some instant: whoever was
    // already placed (higher priority) keeps the seat, this one overflows.
    const sameMission = perMission.get(c.mission.id) || [];
    // Capacity is measured at every change inside the claim, not the roomiest
    // headcount or a count of intervals that merely overlap different parts.
    //
    // A claim wholly inside elapsed time is exempt (ADR 009). Today's `count`
    // is not evidence about how many people stood a post that is already over,
    // so applying it there deletes people who genuinely were on duty the moment
    // somebody lowers the headcount. The record outranks the setting.
    const points = new Set([c.start, ...sameMission.flatMap((q) => [q.start, q.end]),
      ...nightWindows.flatMap((w) => [w.start, w.end])]);
    const overflows = c.end > loggedBefore && [...points].some((at) => at >= c.start && at < c.end
      && sameMission.filter((q) => q.start <= at && q.end > at).length
        >= countAt(c.mission, at, nightWindows));
    if (overflows) {
      warnings.push({
        code: WARN.PIN_OVERFLOW, missionId: c.mission.id, employeeId: c.employee.id, start: c.start, end: c.end,
      });
      continue;
    }

    const pin = {
      missionId: c.mission.id, employeeId: c.employee.id, start: c.start, end: c.end, frozen: c.frozen, index: c.index,
    };
    accepted.push(pin);
    sameMission.push(pin);
    perMission.set(c.mission.id, sameMission);
  }

  // Hand back the accepted pins in document order, not priority order - the
  // priority walk above only needs to decide *who wins*; nothing downstream
  // (plan()'s addRow loop, which drives fairness tie-breaking for the people
  // scheduled around these pins) should have to care that the walk itself
  // ran newest-first.
  accepted.sort((a, b) => a.index - b.index);
  return accepted.map(({ index: _index, ...pin }) => pin);
}

/* ------------------------------------------------------------------ */
/* Per-employee scheduling state                                       */
/* ------------------------------------------------------------------ */

/**
 * `busyUntil` is hard (a person genuinely occupies that time, so they can never
 * be double-booked). `minutes` drives even rotation, `lastEnd` drives gap
 * maximization, and `seq` - bumped on every pick - round-robins exact ties so
 * the rotation cannot collapse onto whoever happens to sort first.
 */
function makeState(employees, strategy) {
  let seq = 0;
  return new Map(
    employees.map((e, index) => [
      e.id,
      {
        id: e.id, name: e.name, tags: e.tags ?? [], start: e.start, end: e.end, busy: [], busyUntil: -Infinity,
        minutes: 0, missionMinutes: new Map(), lastEnd: -Infinity, seq: seq++, stints: 0,
        ...(strategy.seed ? strategy.seed(e, index) : null),
      },
    ]),
  );
}

function isFree(st, start, end) {
  for (const iv of st.busy) if (overlaps(iv.start, iv.end, start, end)) return false;
  return true;
}

function isAvailable(st, start, end) {
  return st.start <= start && st.end >= end;
}

function occupy(st, mission, start, end, slotStart, counter) {
  // `slotStart` and the `remote` flag are both for the ring in strategies.js,
  // which charges one turn per distinct slot entered and one per remote hold
  // however long it runs. Nothing else here reads either, and `isFree` only
  // ever looks at start/end.
  st.busy.push({ start, end, slotStart, missionId: mission.id, ...(mission.type !== 'local' ? { remote: true } : null) });
  st.busyUntil = Math.max(st.busyUntil, end);
  const minutes = (end - start) / MINUTE;
  st.minutes += minutes;
  st.missionMinutes.set(mission.id, (st.missionMinutes.get(mission.id) ?? 0) + minutes);
  st.lastEnd = Math.max(st.lastEnd, end);
  st.stints += 1;
  st.seq = counter();
  return st;
}

/* ------------------------------------------------------------------ */
/* Main entry point                                                    */
/* ------------------------------------------------------------------ */

/**
 * @param {object} params
 * @param {number} params.start - plan window start, ms epoch
 * @param {number} params.end - plan window end, ms epoch
 * @param {number} params.shiftMinutes - default rotation length for local
 *   missions; a mission may override it and its night variant per mission
 * @param {'balanced'|'rotation'} [params.strategy] - which policy picks who
 *   works a given slot; see `strategies.js`. Defaults to `balanced`, the
 *   original hours-evening behaviour. An unrecognised name falls back to that
 *   default rather than throwing.
 * @param {{id:string,name:string,start?:number,end?:number}[]} params.employees
 *   `start`/`end` default to the whole plan window.
 * @param {{id:string,name:string,type:'remote'|'local'|'daily',start?:number,end?:number,count:number,nightCount?:number,shiftMinutes?:number,nightShiftMinutes?:number}[]} params.missions
 *   `count` is the daytime headcount; `nightCount` replaces it inside the plan's
 *   night stretches, and defaults to `count`. `shiftMinutes` is this mission's
 *   own slot length, defaulting to the plan's, and `nightShiftMinutes` its
 *   night variant, defaulting to the mission's day length - so one mission can
 *   run two-hour shifts by day and one-hour shifts at night while the rest of
 *   the plan stays hourly. All three are ignored on a remote mission, which one
 *   set of people holds end to end.
 * @param {{start:number,end:number}[]} [params.nightWindows] - the plan's night
 *   stretches as absolute instants. Resolved by the caller, never here: a
 *   wall-clock hour needs a timezone, and reading one in the engine would make
 *   a shared link schedule differently for whoever opens it.
 * @param {{missionId:string,employeeId:string,start?:number,end?:number,frozen?:boolean}[]} [params.pins]
 *   Hard, hand-made assignments. Omitting `start`/`end` pins the person to the
 *   mission's whole window (how people are assigned to a remote mission);
 *   supplying them pins one specific shift (how a manual swap is recorded).
 *   `frozen: true` marks a pin the engine wrote for itself to lock in an
 *   already-elapsed shift (see pins.js's freezeElapsedBeforeEdit), as opposed
 *   to one a person typed by hand - the only thing that distinction affects
 *   is which one wins when two pins contest the same seat (an explicit pin
 *   always outranks a frozen one). Neither kind can ever be invalidated by
 *   availability: a manual assignment is an input fact, not a suggestion the
 *   engine may veto (see normalizePins).
 * @returns {{
 *   shifts: {missionId:string,missionName:string,type:string,employeeId:string,employeeName:string,start:number,end:number,slotStart:number,slotEnd:number,pinned:boolean,frozen:boolean}[],
 *   timeline: {start:number,end:number,onDuty:{employeeId:string,missionId:string}[],offDuty:string[],unavailable:string[]}[],
 *   stats: {perEmployee:{employeeId:string,name:string,minutes:number,stints:number,minGapMinutes:number|null}[], spreadMinutes:number},
 *   warnings: object[],
 *   rest: {employeeId:string,start:number,end:number,needed:number,totalMinutes:number,longestMinutes:number}[],
 *   proposals: object[],
 * }}
 */
function planOnce({
  start, end, shiftMinutes, strategy: strategyName = DEFAULT_STRATEGY,
  employees = [], missions = [], pins = [], nightWindows = [], tags = [],
  repairHints = [],
  // The instant before which time is a *log* rather than a schedule (ADR 009).
  // An absolute ms epoch, resolved by the adapter exactly like `nightWindows`,
  // because the engine has no clock of its own and must not grow one.
  // `-Infinity` means "nothing has elapsed", which is what every caller written
  // before this field meant and what keeps the golden fixtures byte-identical.
  loggedBefore = -Infinity,
  onInvariantViolation = 'throw',
}) {
  /* --- structural validation: these are bugs in the input, not planner findings --- */
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Plan window must be numeric timestamps.');
  if (!(end > start)) throw new Error('Plan must end after it starts.');
  if (!(shiftMinutes > 0)) throw new Error('Shift length must be positive.');
  if (employees.length === 0) throw new Error('At least one employee is required.');
  // Blank names are allowed (a row still being filled in); only real names have
  // to be distinct, and only so the output is readable - identity is by id.
  const names = employees.map((e) => e.name.trim()).filter(Boolean);
  if (new Set(names).size !== names.length) throw new Error('Employee names must be unique.');
  if (new Set(employees.map((e) => e.id)).size !== employees.length) throw new Error('Employee ids must be unique.');

  const tagIds = new Set(tags.map((t) => t.id));
  if (tagIds.size !== tags.length) throw new Error('Qualification ids must be unique.');
  for (const m of missions) for (const r of m.requires ?? []) {
    if (!Number.isInteger(r.count) || r.count < 1) throw new Error('Qualification counts must be positive integers.');
  }
  const warnings = [];
  const emps = normalizeEmployees(employees, start, end, warnings);
  if (emps.length === 0) throw new Error('No employee is available during the plan window.');
  const miss = normalizeMissions(missions, start, end, warnings);

  const employeeById = new Map(emps.map((e) => [e.id, e]));
  const missionById = new Map(miss.map((m) => [m.id, m]));
  for (const m of miss) {
    for (const r of m.requires) if (m.excludes.includes(r.tag)) warnings.push({ code: 'tag-required-and-excluded', missionId: m.id, tag: r.tag });
  }
  const goodPins = normalizePins(pins, employeeById, missionById, start, end, warnings, nightWindows, loggedBefore);

  for (const p of goodPins) {
    const m = missionById.get(p.missionId), e = employeeById.get(p.employeeId);
    if (m.excludes.some((t) => e.tags.includes(t))) warnings.push({ code: 'pin-excluded-tag', missionId: m.id, employeeId: e.id, start: p.start, end: p.end });
    if (m.excludeEmployees.includes(e.id)) warnings.push({ code: 'pin-excluded-employee', missionId: m.id, employeeId: e.id, start: p.start, end: p.end });
  }

  // Assignments left behind by a period that has since moved on. Counted once
  // rather than reported one by one: a rota carried across a few days
  // accumulates dozens, and a wall of identical "cannot be honoured" alerts
  // reads as a scheduler malfunction rather than the harmless residue it is.
  //
  // Counted from the *raw* missions, deliberately. A mission that has itself
  // dropped out of the period is gone from `missionById`, so everything pinned
  // to it disappears inside normalizePins before anything can notice - and the
  // button that clears residue only exists alongside this warning, so a count
  // taken in there would leave that history with no way to reach it. Sharing
  // the predicate with `clearStalePins` is what keeps the number honest: what
  // is reported here is exactly what the button removes.
  const rawMissionById = new Map(missions.map((m) => [m.id, m]));
  const outOfPeriod = pins.filter(
    (p) => isOutOfPeriod(p, rawMissionById.get(p.missionId), start, end),
  ).length;
  if (outOfPeriod > 0) warnings.push({ code: WARN.PIN_OUT_OF_PERIOD, count: outOfPeriod });

  const strategy = getStrategy(strategyName);
  const state = makeState(emps, strategy);
  // On-call duty can be slept through, so pins on such missions must not push
  // anyone's sleep block out of the night, and staffing one must not cost the
  // crew their rest window - see `choose` and `assessRest` below.
  const sleepable = new Set([...missionById.values()].filter((m) => m.onCall).map((m) => m.id));
  const rest = preferredRest(emps, tags, nightWindows,
    goodPins.filter((p) => !sleepable.has(p.missionId)), start, end);
  const choose = (candidates, fixed, need, mission, lo, hi) => {
    // Sleep-compatible duty: rest blocks neither deprioritize nor exclude
    // anyone from an on-call mission.
    if (mission.onCall) return selectCrew(candidates, fixed, need, mission.requires);
    // Priority ladder per candidate: configured total-minimum deficit, then
    // the 8-hour total and 6-hour continuous preferences, then overlap with a
    // reserved rest block. `selectCrew` re-reads the same vector per crew, so
    // qualification coverage still outranks every tier here.
    const costs = new Map(candidates.map((e) => [e.id, [
      ...restCost(e, tags, nightWindows, rows.filter((r) => r.employeeId === e.id && !sleepable.has(r.missionId)), start, end, lo, hi),
      Number(overlapsRest(e.id, lo, hi, rest)),
    ]]));
    const ordered = [...candidates].sort((a, b) => {
      const left = costs.get(a.id), right = costs.get(b.id);
      return left.map((v, i) => v - right[i]).find((v) => v !== 0) ?? 0;
    });
    return selectCrew(ordered, fixed, need, mission.requires, costs);
  };
  let seqCounter = emps.length;
  const nextSeq = () => seqCounter++;

  /** Raw assignments before adjacent-row merging. */
  const rows = [];
  // `slot` is the grid slot the row belongs to - the mission's own window for a
  // remote hold, which is claimed once and held whole. Every row carries it
  // because there is no longer one global step anyone downstream could
  // rediscover by arithmetic: `mergeRows` rejoins rows within a slot, and the
  // ring counts distinct slots entered.
  const addRow = (mission, st, blockStart, blockEnd, slot, pinned, frozen = false) => {
    occupy(st, mission, blockStart, blockEnd, slot.start, nextSeq);
    rows.push({
      missionId: mission.id,
      missionName: mission.name,
      type: mission.type,
      employeeId: st.id,
      employeeName: st.name,
      start: blockStart,
      end: blockEnd,
      slotStart: slot.start,
      slotEnd: slot.end,
      pinned,
      frozen,
      ...(st.tags.length ? { qualifications: [...st.tags] } : {}),
    });
  };

  /* --- the segment grid local missions rotate on --- */
  // Two things make a segment, and only one of them is the rotation grid.
  //
  // These are the other one: edges every mission is cut on whatever it rotates
  // on. The plan's own bounds; every employee's availability edge, shared
  // across all missions since an employee's window genuinely affects whether
  // *any* mission can be staffed across it. A night edge only cuts missions
  // whose headcount changes there. Each mission's own start/end is added to its
  // own segmentation, so it gets a properly clamped partial segment at its own
  // edges without leaking into an unrelated mission's grid (a remote or local
  // mission ending off-grid must not fragment some other local mission's
  // otherwise-clean hourly slots).
  const sharedEdges = [start, end];
  // Rest is a preference for choosing crew, never a reason to shorten a shift.
  for (const m of miss) if (m.type === 'daily') for (const w of m.occurrences) sharedEdges.push(w.start, w.end);
  for (const e of emps) { sharedEdges.push(e.start, e.end); }

  /** Grid points from `from`, stepping `minutes`, up to but not including `to`. */
  const stepInto = (into, from, to, minutes) => {
    for (let t = from; t < to; t += minutes * MINUTE) into.add(t);
  };

  /** A set of grid points as the ascending slot bounds of the whole plan window. */
  const boundsOf = (points) => [...new Set([...points, end])].sort((a, b) => a - b);

  // The house grid: the plan's `shiftMinutes`, stepped from its start. A
  // mission that overrides neither length rotates on exactly this - the same
  // points, produced by the same loop that always produced them - which is
  // what makes an already-shared link segment the way it always did, whatever
  // its neighbours on the page now ask for. tests/planner.golden.test.js is
  // the standing proof.
  const housePoints = new Set();
  stepInto(housePoints, start, end, shiftMinutes);
  const houseBounds = boundsOf(housePoints);

  const { nights, days } = stretches(nightWindows, start, end);

  // Keyed on the normalized mission object so each mission owns its grid cache.
  const boundsCache = new Map();
  /**
   * The rotation grid this mission turns on, as ascending slot bounds spanning
   * the plan window.
   *
   * With equal day and night lengths the grid is anchored once, at the plan's
   * start. With different ones each stretch is anchored at its own beginning
   * (or at the plan's start, where the plan opens mid-stretch), which is what
   * "two hours by day, one by night" actually means: night starts a fresh
   * hourly grid at 22:00 rather than inheriting whatever phase the two-hour
   * grid happened to be in. A stretch whose length is not a whole number of
   * slots leaves one partial slot at its end, the same way the plan's own end
   * has always left one.
   */
  const slotBoundsFor = (mission) => {
    const dayMinutes = mission.shiftMinutes ?? shiftMinutes;
    const nightMinutes = mission.nightShiftMinutes ?? dayMinutes;
    if (dayMinutes === shiftMinutes && nightMinutes === shiftMinutes) return houseBounds;

    const hit = boundsCache.get(mission);
    if (hit) return hit;
    const points = new Set([start]);
    if (dayMinutes === nightMinutes) {
      stepInto(points, start, end, dayMinutes);
    } else {
      for (const w of nights) stepInto(points, w.start, w.end, nightMinutes);
      for (const w of days) stepInto(points, w.start, w.end, dayMinutes);
    }
    const bounds = boundsOf(points);
    boundsCache.set(mission, bounds);
    return bounds;
  };

  // Built lazily but before anything is placed, because phase 1 needs it too: a
  // pin on a local mission is emitted one row per segment. A grid depends only
  // on the plan window, the employees' availability edges, the night edges and
  // the mission's own fields, none of which the phases below touch, so when it
  // is computed cannot change what it produces - and one shared `segmentsOf`
  // means the pinned rows and the demand walk can never disagree about where a
  // segment starts.
  //
  // The slot a segment belongs to is the *grid's* slot, not the segment's own
  // extent: an availability edge tearing a slot in two leaves both halves
  // reporting the one slot they are both inside, which is what lets `mergeRows`
  // put them back together and the ring charge them as one turn. It is also
  // deliberately not clamped to the mission's window, so two missions cutting
  // the same grid slot at different points still name the same slot.
  const segmentCache = new Map();
  const segmentsOf = (mission) => {
    const hit = segmentCache.get(mission);
    if (hit) return hit;
    const bounds = slotBoundsFor(mission);
    const pinEdges = goodPins.filter((p) => p.missionId === mission.id).flatMap((p) => [p.start, p.end]);
    const nightEdges = mission.count === mission.nightCount ? [] : nightWindows.flatMap((w) => [w.start, w.end]);
    const edges = [...new Set([...bounds, ...sharedEdges, ...pinEdges, ...nightEdges, mission.start, mission.end])]
      .filter((t) => t >= mission.start && t <= mission.end)
      .sort((a, b) => a - b);
    const segments = [];
    let slot = 0;
    for (let i = 1; i < edges.length; i++) {
      if (!(edges[i] > edges[i - 1])) continue;
      const segStart = edges[i - 1];
      while (slot + 2 < bounds.length && bounds[slot + 1] <= segStart) slot++;
      segments.push({
        start: segStart,
        end: edges[i],
        slot: { start: bounds[slot], end: bounds[slot + 1] },
      });
    }
    segmentCache.set(mission, segments);
    return segments;
  };

  /* --- 1. pins are immovable: place them before anything else competes --- */
  // A pin on a remote mission stays one row over the whole mission: that is
  // what remote means, one set of people holding it end to end. A pin on a
  // *local* mission is emitted as one row per segment of that mission's grid
  // instead. The engine's decision is identical either way - phase 3 sees the
  // segment covered and asks for one person fewer - but a single row spanning
  // the pin's entire coverage is the wrong *shape*: a whole-mission pin
  // resolves to the mission's whole window, so it surfaced as one 163-hour
  // "shift", took a slot of its own in the agenda (which keys slots by start
  // and end), and left every hourly slot of that mission reading one person
  // short.
  //
  // Accepted pin edges split their mission's segments so automatic demand
  // cannot overlap a partial pin. Slot identity stays on the original grid.
  for (const pin of goodPins) {
    const mission = missionById.get(pin.missionId);
    const st = state.get(pin.employeeId);
    if (mission.type !== 'local') {
      addRow(mission, st, pin.start, pin.end, mission.type === 'daily' ? pin : wholeMissionSlot(mission), true, pin.frozen);
      continue;
    }
    for (const seg of segmentsOf(mission)) {
      const rowStart = Math.max(seg.start, pin.start);
      const rowEnd = Math.min(seg.end, pin.end);
      if (rowEnd > rowStart) addRow(mission, st, rowStart, rowEnd, seg.slot, true, pin.frozen);
    }
  }

  /* --- 1b. repair hints: a generated seat reserved for a qualification ---
   * The repair orchestration in `plan` tries schedules in which a qualified
   * employee is pre-seeded onto a short local segment. Hints ride through the
   * same segment machinery as pins but stay ordinary generated duty: an input
   * to this one run, never a decision the plan remembers. Local only,
   * deliberately: a remote or daily mission picks any free qualified person
   * through coverage maximization already, so a hint there could never help -
   * and the remote/daily phases count only real pins as occupancy, so a hint
   * row would double-staff the very seat it was meant to fill. A hint that
   * would double-book, overstaff, or ignore availability is skipped here,
   * which simply makes that trial equal the base schedule and the
   * orchestrator move on to the next candidate.
   */
  for (const hint of repairHints) {
    const mission = missionById.get(hint.missionId);
    const st = state.get(hint.employeeId);
    if (!mission || !st || mission.type !== 'local') continue;
    const window = { start: hint.start ?? mission.start, end: hint.end ?? mission.end };
    for (const seg of segmentsOf(mission)) {
      const rowStart = Math.max(seg.start, window.start);
      const rowEnd = Math.min(seg.end, window.end);
      if (rowEnd <= rowStart) continue;
      const covered = rows.filter((r) => r.missionId === mission.id && r.start <= rowStart && r.end >= rowEnd);
      if (covered.length >= countAt(mission, rowStart, nightWindows)) continue;
      if (covered.some((r) => r.employeeId === st.id)) continue;
      if (!isFree(st, rowStart, rowEnd) || !isAvailable(st, rowStart, rowEnd)) continue;
      addRow(mission, st, rowStart, rowEnd, seg.slot, false);
    }
  }

  /* --- 2. remote missions: hard constraints, so they claim people first --- */
  const eligibleForRemote = (m) => [...state.values()].filter(
    (st) => isAvailable(st, m.start, m.end) && isFree(st, m.start, m.end)
      && !isExcluded(m, st),
  );

  const remotes = miss.flatMap((m) => m.type === 'remote' ? [m]
    : m.type === 'daily' ? m.occurrences.map((w) => ({ ...m, ...w })) : []);
  // Scarcest first within a start time, so an easy mission cannot greedily take
  // the only person a constrained one could have used. Pool sizes are measured
  // once, up front, so the ordering can't depend on assignments made mid-sort.
  const scarcity = (m, candidates, lo, hi) => {
    const fixed = rows.filter((r) => r.missionId === m.id && r.start <= lo && r.end >= hi)
      .map((r) => state.get(r.employeeId));
    let pool = candidates.length;
    for (const requirement of m.requires) {
      if (fixed.filter((st) => st.tags.includes(requirement.tag)).length >= requirement.count) continue;
      pool = Math.min(pool, candidates.filter((st) => st.tags.includes(requirement.tag)).length);
    }
    return pool;
  };
  const remotePool = new Map(remotes.map((m) => [m, scarcity(m, eligibleForRemote(m), m.start, m.end)]));
  remotes.sort((a, b) => (
    a.start - b.start
    || remotePool.get(a) - remotePool.get(b)
    || (b.end - b.start) - (a.end - a.start)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  ));

  for (const m of remotes) {
    const alreadyPinned = rows.filter((r) => r.missionId === m.id && r.pinned && r.start === m.start && r.end === m.end).length;
    const need = m.count - alreadyPinned;
    if (need <= 0) continue;

    const candidates = eligibleForRemote(m);
    candidates.sort((a, b) => strategy.compare(a, b, {
      mission: m, start: m.start, end: m.end, kind: m.type, planStart: start, shiftMinutes,
    }));

    const fixed = rows.filter((r) => r.missionId === m.id && r.start <= m.start && r.end >= m.end).map((r) => state.get(r.employeeId));
    const picked = choose(candidates, fixed, need, m, m.start, m.end);
    for (const st of picked) addRow(m, st, m.start, m.end, wholeMissionSlot(m), false);

    if (picked.length < need) {
      warnings.push({
        code: WARN.UNDERSTAFFED,
        missionId: m.id,
        start: m.start,
        end: m.end,
        needed: m.count,
        got: alreadyPinned + picked.length,
      });
    }
  }

  /* --- 3. local missions on the segment grid built above --- */
  const locals = miss.filter((m) => m.type === 'local');
  const demands = [];
  for (const m of locals) {
    for (const seg of segmentsOf(m)) {
      const covered = rows.filter(
        (r) => r.missionId === m.id && r.start <= seg.start && r.end >= seg.end,
      ).length;
      // Elapsed time that already has a record is a record, not a slot to fill
      // (ADR 009). Raising a mission's headcount today must not retroactively
      // staff a shift that is already over with somebody who was never there:
      // the freeze records *who* held a slot and has nowhere to record how many
      // seats existed then, so today's `count` is not evidence about the past.
      //
      // Gated on `covered` deliberately. An elapsed segment nobody is recorded
      // on has no history to protect, and the schedule it *would* have had is
      // still the most useful thing to show - so it is planned as before. Only
      // a segment with a record defers to it.
      if (seg.end <= loggedBefore && covered > 0) continue;
      const need = countAt(m, seg.start, nightWindows) - covered;
      if (need > 0) {
        demands.push({
          mission: m, start: seg.start, end: seg.end, slot: seg.slot, need,
        });
      }
    }
  }

  // Chronological, then most-constrained-first so concurrent local missions
  // cannot starve each other. A constrained mission beginning inside an
  // already-running ordinary segment is the one exception: place its first
  // segment before the earlier demand, or the earlier post can consume the
  // scarce qualified staff before a real-world off-grid callout is considered.
  // Pool size counts who could ever work the segment
  // (availability and qualification restrictions, ignoring current bookings) so it is a fixed property of
  // the demand rather than something that shifts as assignments are made.
  for (const d of demands) {
    const eligible = [...state.values()].filter((st) => isAvailable(st, d.start, d.end)
      && !isExcluded(d.mission, st));
    d.pool = scarcity(d.mission, eligible, d.start, d.end);
  }
  for (const d of demands) {
    d.offGridPriority = d.mission.requires.length > 0 && demands.some((other) => (
      other !== d && other.start < d.start && other.end > d.start && other.pool > d.pool
    ));
  }
  demands.sort((a, b) => (
    Number(b.offGridPriority) - Number(a.offGridPriority)
    || a.start - b.start
    || a.pool - b.pool
    || (a.mission.id < b.mission.id ? -1 : a.mission.id > b.mission.id ? 1 : 0)
  ));

  for (const d of demands) {
    const candidates = [...state.values()].filter(
      (st) => isAvailable(st, d.start, d.end) && isFree(st, d.start, d.end)
        && !isExcluded(d.mission, st),
    );
    // Who among them actually gets it is the strategy's call - see
    // `strategies.js` for what each one optimizes for.
    candidates.sort((a, b) => strategy.compare(a, b, {
      mission: d.mission, start: d.start, end: d.end, kind: 'local', planStart: start, shiftMinutes,
    }));

    const fixed = rows.filter((r) => r.missionId === d.mission.id && r.start <= d.start && r.end >= d.end).map((r) => state.get(r.employeeId));
    const picked = choose(candidates, fixed, d.need, d.mission, d.start, d.end);
    for (const st of picked) addRow(d.mission, st, d.start, d.end, d.slot, false);

    if (picked.length < d.need) {
      warnings.push({
        code: WARN.UNDERSTAFFED,
        missionId: d.mission.id,
        start: d.start,
        end: d.end,
        needed: countAt(d.mission, d.start, nightWindows),
        got: fixed.length + picked.length,
      });
    }
  }

  // Whatever pinned history still blocks a qualified person is described in a
  // proposal the UI offers for acceptance - the engine itself never edits a
  // pin. (Repairs of generated duty happen one level up, in `plan`, by
  // re-running this function with repair hints.) Runs before merging so it
  // reasons about the same segment rows the staffing pass produced.
  const proposals = proposeCorrections(rows, {
    employees: emps, tags, missions: miss, nightWindows, start, end, sleepable, segmentsOf,
  });

  const shifts = mergeRows(rows);

  for (const e of emps) {
    if (!shifts.some((s) => s.employeeId === e.id)) {
      warnings.push({ code: WARN.EMPLOYEE_UNUSED, employeeId: e.id });
    }
  }

  const result = {
    shifts,
    timeline: buildTimeline(shifts, emps, start, end, miss.filter((m) => m.requires.length)
      .flatMap((m) => m.type === 'daily' ? m.occurrences.flatMap((w) => [w.start, w.end]) : [m.start, m.end])),
    stats: buildStats(shifts, emps, sleepable),
    warnings,
    // Per-employee, per-night total and continuous rest, and the actionable
    // corrections for shortages that only an accepted change can fix.
    rest: restMetrics(shifts, emps, tags, nightWindows, start, end, sleepable),
    proposals,
  };
  const missing = new Map();
  for (const seg of result.timeline) {
    // A qualification gap in elapsed time is a historical fact, not a finding.
    // The engine no longer staffs that time (ADR 009), so reporting it would
    // be an alert nobody can act on, arriving on every render.
    if (seg.end <= loggedBefore) continue;
    for (const m of miss) {
      const running = m.type === 'daily' ? m.occurrences.some((w) => seg.start >= w.start && seg.start < w.end)
        : seg.start >= m.start && seg.start < m.end;
      if (!running || !m.requires.length) continue;
      const crew = seg.onDuty.filter((r) => r.missionId === m.id).map((r) => state.get(r.employeeId));
      for (const r of missingQualifications(crew, m.requires)) {
        const key = `${m.id}|${r.tag}`;
        if (!missing.has(key)) missing.set(key, { code: 'missing-required-tag', missionId: m.id, tag: r.tag, needed: r.needed, windows: [] });
        const windows = missing.get(key).windows, last = windows.at(-1);
        if (last && last.end === seg.start && last.got === r.got) last.end = seg.end;
        else windows.push({ start: seg.start, end: seg.end, got: r.got });
      }
    }
  }
  warnings.push(...missing.values());
  warnings.push(...assessRest(shifts, emps, tags, nightWindows, start, end, sleepable));
  return validateSchedule(result, { start, end, shiftMinutes, employees: emps, missions: miss, pins: goodPins, nightWindows, loggedBefore }, onInvariantViolation);
}

/**
 * Plan, then repair what generated duty can repair.
 *
 * When the base schedule leaves a required qualification unmet, each short
 * window is tried with a repair hint - a pre-seeded generated seat for a
 * qualified employee (see phase 1b) - and the hinted schedule is kept only
 * when it is strictly better on the resulting output: fewer unmet
 * qualification minutes, then fewer understaffed minutes, then a lower total
 * rest deficit. Everything a hint rearranges is rearranged by the engine's
 * own phases, so every invariant a normal plan holds holds for the repaired
 * one too, and the repair is recomputed from scratch on every replan -
 * generated output, never a remembered edit. Preserved history and manual
 * assignments are never hintable (see `repairCandidates`); those are the
 * proposal half's domain (see corrections.js).
 */
export function plan(input) {
  const base = planOnce(input);
  if (input.repairHints?.length) return base; // a trial: never recurse
  const shortages = base.warnings.filter((w) => w.code === 'missing-required-tag');
  if (!shortages.length) return base;

  const quality = (result) => {
    let missing = 0, understaffed = 0;
    for (const w of result.warnings) {
      if (w.code === 'missing-required-tag') {
        for (const win of w.windows) missing += (w.needed - win.got) * (win.end - win.start);
      } else if (w.code === WARN.UNDERSTAFFED) {
        understaffed += (w.needed - w.got) * (w.end - w.start);
      }
    }
    return [missing, understaffed, restDeficit(result.rest)];
  };
  let best = base;
  let hints = [];
  for (const warning of shortages) {
    for (const win of warning.windows) {
      const hint = { missionId: warning.missionId, start: win.start, end: win.end };
      for (const employee of repairCandidates(input, base, warning, win)) {
        const trial = planOnce({ ...input, repairHints: [...hints, { ...hint, employeeId: employee.id }] });
        // Staffing is never sacrificed for qualification coverage: a repair
        // that empties one post to fill another is no repair.
        const baseQuality = quality(best), trialQuality = quality(trial);
        if (trialQuality[1] <= baseQuality[1] && lexLess(trialQuality, baseQuality)) {
          best = trial;
          hints = [...hints, { ...hint, employeeId: employee.id }];
          break;
        }
      }
    }
  }
  return best;
}

/** Lexicographic comparison: the first differing tier decides. */
const lexLess = (a, b) => (a.map((v, i) => v - b[i]).find((v) => v !== 0) ?? 0) < 0;

/**
 * Who may be hinted onto a short window: qualified, available for all of it,
 * not excluded from the mission, and neither already covering the window nor
 * held over it by a pin - pins are decisions, so a driver preserved history
 * or a manual assignment holds is proposal territory, never an auto-repair.
 */
function repairCandidates(input, base, warning, win) {
  const mission = input.missions.find((m) => m.id === warning.missionId);
  if (!mission) return [];
  return input.employees.filter((e) => (e.tags ?? []).includes(warning.tag)
    && !isExcluded(mission, e)
    && (e.start ?? input.start) <= win.start && (e.end ?? input.end) >= win.end
    && !base.shifts.some((s) => s.employeeId === e.id && s.missionId === mission.id
      && s.start <= win.start && s.end >= win.end)
    && !base.shifts.some((s) => s.employeeId === e.id && s.pinned && s.start < win.end && win.start < s.end));
}

/* ------------------------------------------------------------------ */
/* Post-processing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Join back-to-back rows for the same person on the same mission, so a segment
 * split caused by an unrelated mission edge doesn't surface as two half rows.
 * Pinned and generated rows never merge into each other - `pinned` has to stay
 * meaningful per row for the UI's clear-pin action. Frozen and non-frozen
 * pinned rows are kept apart the same way, so a merged row's lock/pin icon
 * never misrepresents part of the range it covers.
 *
 * Rows are never joined *across a shift boundary*, only within one. Repairing a
 * segment an unrelated availability edge tore in half is the whole point of
 * merging; welding consecutive shifts together is not, and used to be the same
 * operation. A guard held over eleven slots in a row surfaced as one 88-hour
 * row - which read as a single monstrous shift, gave the agenda a second slot
 * that also began at 22:00 but ended four days later, and let `stints` report
 * that whole ordeal as a single turn. Bounded to one slot, `stints` counts
 * shifts worked, which is the number that means something under `rotation`.
 *
 * "Within one shift" is read off the row's own `slotStart` rather than worked
 * out by modulo arithmetic on a plan-wide step, because since shift length
 * became a per-mission field there is no plan-wide step to do arithmetic on.
 * On the house grid the two agree exactly: a row starting on a shift boundary
 * opens a new slot, so its `slotStart` differs from that of the row ending
 * where it begins, and no other row can start mid-slot without sharing one.
 */
function mergeRows(rows) {
  const sorted = [...rows].sort((a, b) => (
    a.start - b.start
    || (a.missionId < b.missionId ? -1 : a.missionId > b.missionId ? 1 : 0)
    || (a.employeeName < b.employeeName ? -1 : a.employeeName > b.employeeName ? 1 : 0)
    || (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0)
  ));

  const out = [];
  for (const row of sorted) {
    const prev = out.find(
      (r) => r.missionId === row.missionId
        && r.employeeId === row.employeeId
        && r.pinned === row.pinned
        && r.frozen === row.frozen
        && r.slotStart === row.slotStart
        && r.end === row.start,
    );
    if (prev) prev.end = row.end;
    else out.push({ ...row });
  }
  return out.sort((a, b) => (
    a.start - b.start
    || (a.missionName < b.missionName ? -1 : a.missionName > b.missionName ? 1 : 0)
    || (a.employeeName < b.employeeName ? -1 : a.employeeName > b.employeeName ? 1 : 0)
    || (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0)
  ));
}

/**
 * Who is on duty, off duty, and unavailable at every moment - the segment list
 * the UI renders directly. Segments break at every shift edge and every
 * availability edge, so within a segment nothing changes.
 */
function buildTimeline(shifts, employees, planStart, planEnd, demandEdges = []) {
  const points = new Set([planStart, planEnd, ...demandEdges]);
  for (const s of shifts) { points.add(s.start); points.add(s.end); }
  for (const e of employees) { points.add(e.start); points.add(e.end); }
  const edges = [...points].filter((t) => t >= planStart && t <= planEnd).sort((a, b) => a - b);

  const timeline = [];
  for (let i = 1; i < edges.length; i++) {
    const segStart = edges[i - 1];
    const segEnd = edges[i];
    if (segEnd <= segStart) continue;

    const onDuty = shifts
      .filter((s) => s.start <= segStart && s.end >= segEnd)
      .map((s) => ({ employeeId: s.employeeId, missionId: s.missionId }));
    const busy = new Set(onDuty.map((o) => o.employeeId));

    const offDuty = [];
    const unavailable = [];
    for (const e of employees) {
      if (busy.has(e.id)) continue;
      if (e.start <= segStart && e.end >= segEnd) offDuty.push(e.id);
      else unavailable.push(e.id);
    }
    timeline.push({ start: segStart, end: segEnd, onDuty, offDuty, unavailable });
  }
  return timeline;
}

function buildStats(shifts, employees, sleepable) {
  const perEmployee = employees.map((e) => {
    const own = shifts.filter((s) => s.employeeId === e.id).sort((a, b) => a.start - b.start);
    const minutes = own.reduce((sum, s) => sum + (s.end - s.start) / MINUTE, 0);

    // On-call duty is slept through, so it does not interrupt rest the way an
    // ordinary shift does - skip it here just as `preferredRest` does when
    // deciding who to schedule, so the gap on either side of an on-call shift
    // reads as the rest it actually was rather than as two zero-length gaps.
    const awake = own.filter((s) => !sleepable.has(s.missionId));
    let minGapMinutes = null;
    for (let i = 1; i < awake.length; i++) {
      const gap = (awake[i].start - awake[i - 1].end) / MINUTE;
      if (minGapMinutes == null || gap < minGapMinutes) minGapMinutes = gap;
    }

    return { employeeId: e.id, name: e.name, minutes, stints: own.length, minGapMinutes };
  });

  const totals = perEmployee.map((p) => p.minutes);
  const spreadMinutes = totals.length ? Math.max(...totals) - Math.min(...totals) : 0;
  return { perEmployee, spreadMinutes };
}
