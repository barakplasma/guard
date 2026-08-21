/**
 * Shift planner.
 *
 * Pure ES module: no DOM, no `Date.now()`, no `Math.random()`, and no
 * dependency outside `strategies.js` (which plays by the same rules).
 * All times are ms-epoch numbers. Given the same input it always produces
 * byte-identical output - that is what lets a plan live entirely in a shared
 * URL and render the same for everyone who opens it.
 *
 * Two mission types:
 *   - `remote` - the same people staff it for its entire duration and are
 *     locked out of everything else while it runs.
 *   - `local`  - people rotate every `shiftMinutes` among whoever is still
 *     available.
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

const MINUTE = 60 * 1000;

/* ------------------------------------------------------------------ */
/* Warning codes                                                       */
/* ------------------------------------------------------------------ */

export const WARN = {
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
 * Does this pin's written range fall entirely outside the plan period?
 *
 * Only an explicit range can: a null start or end inherits the mission window,
 * which is itself clamped into the period, so an inherited pin always overlaps
 * it.
 *
 * On a remote mission the answer is always no, whatever the range says. A pin
 * there means the whole mission - the written range is not honoured, so it
 * cannot strand the pin outside the period either. Reading it literally would
 * mark a pin stale while the engine is busy staffing a mission with it, and
 * the cleanup built on this predicate would then delete a live assignment.
 */
export function isOutOfPeriod(pin, mission, planStart, planEnd) {
  if (mission?.type === 'remote') return false;
  if (pin.start == null && pin.end == null) return false;
  const start = pin.start ?? planStart;
  const end = pin.end ?? planEnd;
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
    out.push({ id: e.id, name: e.name, start, end });
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
    const start = Math.max(rawStart, planStart);
    const end = Math.min(rawEnd, planEnd);
    if (!(end > start)) {
      warnings.push({ code: WARN.MISSION_OUTSIDE_WINDOW, missionId: m.id });
      continue;
    }
    if (start !== rawStart || end !== rawEnd) {
      warnings.push({ code: WARN.MISSION_OUTSIDE_WINDOW, missionId: m.id, start, end });
    }
    out.push({
      id: m.id,
      name: m.name,
      type: m.type === 'remote' ? 'remote' : 'local',
      start,
      end,
      count: m.count,
    });
  }
  return out;
}

/**
 * Pins referencing a deleted employee or mission are dropped silently - a stale
 * shared link must keep working rather than erroring. Everything else that
 * cannot be honoured degrades to a warning.
 */
function normalizePins(pins, employeeById, missionById, planStart, planEnd, warnings) {
  // Assignments left behind by a plan window that has since moved on. They are
  // not broken - they were true when they were written - so they are counted
  // once rather than reported one by one: a rota rolled forward a few days
  // carries dozens, and forty identical "cannot be honoured" alerts read as a
  // scheduler malfunction instead of the harmless residue they are.
  let outOfPeriod = 0;
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
      // Two different situations reach here, and conflating them buries the
      // one worth acting on. A pin wholly outside the *plan period* is just
      // residue from a window that has moved; a pin inside the period that
      // still clamps to nothing genuinely cannot be honoured, because the
      // mission does not run when the pin says it does - unlike an
      // availability mismatch below, that is not a fact the engine can work
      // around.
      if (isOutOfPeriod(p, mission, planStart, planEnd)) outOfPeriod += 1;
      else warnings.push({ code: WARN.PIN_UNAVAILABLE, missionId: mission.id, employeeId: employee.id });
      return;
    }
    resolved.push({
      mission, employee, start, end, frozen: Boolean(p.frozen), index,
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
    const concurrent = sameMission.filter((q) => overlaps(q.start, q.end, c.start, c.end));
    if (concurrent.length >= c.mission.count) {
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
  if (outOfPeriod > 0) warnings.push({ code: WARN.PIN_OUT_OF_PERIOD, count: outOfPeriod });

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
        id: e.id, name: e.name, start: e.start, end: e.end, busy: [], busyUntil: -Infinity,
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

function occupy(st, missionId, start, end, counter) {
  st.busy.push({ start, end });
  st.busyUntil = Math.max(st.busyUntil, end);
  const minutes = (end - start) / MINUTE;
  st.minutes += minutes;
  st.missionMinutes.set(missionId, (st.missionMinutes.get(missionId) ?? 0) + minutes);
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
 * @param {number} params.shiftMinutes - rotation length for local missions
 * @param {'balanced'|'rotation'} [params.strategy] - which policy picks who
 *   works a given slot; see `strategies.js`. Defaults to `balanced`, the
 *   original hours-evening behaviour. An unrecognised name falls back to that
 *   default rather than throwing.
 * @param {{id:string,name:string,start?:number,end?:number}[]} params.employees
 *   `start`/`end` default to the whole plan window.
 * @param {{id:string,name:string,type:'remote'|'local',start?:number,end?:number,count:number}[]} params.missions
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
 *   shifts: {missionId:string,missionName:string,type:string,employeeId:string,employeeName:string,start:number,end:number,pinned:boolean,frozen:boolean}[],
 *   timeline: {start:number,end:number,onDuty:{employeeId:string,missionId:string}[],offDuty:string[],unavailable:string[]}[],
 *   stats: {perEmployee:{employeeId:string,name:string,minutes:number,stints:number,minGapMinutes:number|null}[], spreadMinutes:number},
 *   warnings: object[],
 * }}
 */
export function plan({
  start, end, shiftMinutes, strategy: strategyName = DEFAULT_STRATEGY,
  employees = [], missions = [], pins = [],
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

  const warnings = [];
  const emps = normalizeEmployees(employees, start, end, warnings);
  if (emps.length === 0) throw new Error('No employee is available during the plan window.');
  const miss = normalizeMissions(missions, start, end, warnings);

  const employeeById = new Map(emps.map((e) => [e.id, e]));
  const missionById = new Map(miss.map((m) => [m.id, m]));
  const goodPins = normalizePins(pins, employeeById, missionById, start, end, warnings);

  const strategy = getStrategy(strategyName);
  const state = makeState(emps, strategy);
  let seqCounter = emps.length;
  const nextSeq = () => seqCounter++;

  /** Raw assignments before adjacent-row merging. */
  const rows = [];
  const addRow = (mission, st, blockStart, blockEnd, pinned, frozen = false) => {
    occupy(st, mission.id, blockStart, blockEnd, nextSeq);
    rows.push({
      missionId: mission.id,
      missionName: mission.name,
      type: mission.type,
      employeeId: st.id,
      employeeName: st.name,
      start: blockStart,
      end: blockEnd,
      pinned,
      frozen,
    });
  };

  /* --- 1. pins are immovable: place them before anything else competes --- */
  for (const pin of goodPins) {
    addRow(missionById.get(pin.missionId), state.get(pin.employeeId), pin.start, pin.end, true, pin.frozen);
  }

  /* --- 2. remote missions: hard constraints, so they claim people first --- */
  const eligibleForRemote = (m) => [...state.values()].filter(
    (st) => isAvailable(st, m.start, m.end) && isFree(st, m.start, m.end),
  );

  const remotes = miss.filter((m) => m.type === 'remote');
  // Scarcest first within a start time, so an easy mission cannot greedily take
  // the only person a constrained one could have used. Pool sizes are measured
  // once, up front, so the ordering can't depend on assignments made mid-sort.
  const remotePool = new Map(remotes.map((m) => [m.id, eligibleForRemote(m).length]));
  remotes.sort((a, b) => (
    a.start - b.start
    || remotePool.get(a.id) - remotePool.get(b.id)
    || (b.end - b.start) - (a.end - a.start)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  ));

  for (const m of remotes) {
    const alreadyPinned = rows.filter((r) => r.missionId === m.id && r.pinned).length;
    const need = m.count - alreadyPinned;
    if (need <= 0) continue;

    const candidates = eligibleForRemote(m);
    candidates.sort((a, b) => strategy.compare(a, b, {
      mission: m, start: m.start, end: m.end, kind: 'remote',
    }));

    const picked = candidates.slice(0, need);
    for (const st of picked) addRow(m, st, m.start, m.end, false);

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

  /* --- 3. local missions on a segment grid --- */
  // Boundaries: the global shift grid plus every availability edge, shared
  // across all local missions since an employee's window genuinely affects
  // whether *any* mission can be staffed across it. Each mission's own start/end
  // is added only to its own segmentation below - so it gets a properly clamped
  // partial segment at its own edges, without leaking into an unrelated
  // mission's grid (a remote or local mission ending off-grid must not fragment
  // some other local mission's otherwise-clean hourly slots).
  const locals = miss.filter((m) => m.type === 'local');
  const baseBoundaries = new Set([start, end]);
  for (let t = start; t < end; t += shiftMinutes * MINUTE) baseBoundaries.add(t);
  for (const e of emps) { baseBoundaries.add(e.start); baseBoundaries.add(e.end); }

  const demands = [];
  for (const m of locals) {
    const edges = [...baseBoundaries, m.start, m.end]
      .filter((t) => t >= m.start && t <= m.end)
      .sort((a, b) => a - b);
    for (let i = 1; i < edges.length; i++) {
      const segStart = edges[i - 1];
      const segEnd = edges[i];
      if (segEnd <= segStart) continue;
      const covered = rows.filter(
        (r) => r.missionId === m.id && r.start <= segStart && r.end >= segEnd,
      ).length;
      const need = m.count - covered;
      if (need > 0) demands.push({ mission: m, start: segStart, end: segEnd, need });
    }
  }

  // Chronological, then most-constrained-first so two concurrent local missions
  // cannot starve each other. Pool size counts who could ever work the segment
  // (availability only, ignoring current bookings) so it is a fixed property of
  // the demand rather than something that shifts as assignments are made.
  for (const d of demands) {
    d.pool = [...state.values()].filter((st) => isAvailable(st, d.start, d.end)).length;
  }
  demands.sort((a, b) => (
    a.start - b.start
    || a.pool - b.pool
    || (a.mission.id < b.mission.id ? -1 : a.mission.id > b.mission.id ? 1 : 0)
  ));

  for (const d of demands) {
    const candidates = [...state.values()].filter(
      (st) => isAvailable(st, d.start, d.end) && isFree(st, d.start, d.end),
    );
    // Who among them actually gets it is the strategy's call - see
    // `strategies.js` for what each one optimizes for.
    candidates.sort((a, b) => strategy.compare(a, b, {
      mission: d.mission, start: d.start, end: d.end, kind: 'local',
    }));

    const picked = candidates.slice(0, d.need);
    for (const st of picked) addRow(d.mission, st, d.start, d.end, false);

    if (picked.length < d.need) {
      warnings.push({
        code: WARN.UNDERSTAFFED,
        missionId: d.mission.id,
        start: d.start,
        end: d.end,
        needed: d.need,
        got: picked.length,
      });
    }
  }

  const shifts = mergeRows(rows);

  for (const e of emps) {
    if (!shifts.some((s) => s.employeeId === e.id)) {
      warnings.push({ code: WARN.EMPLOYEE_UNUSED, employeeId: e.id });
    }
  }

  return {
    shifts,
    timeline: buildTimeline(shifts, emps, start, end),
    stats: buildStats(shifts, emps),
    warnings,
  };
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
function buildTimeline(shifts, employees, planStart, planEnd) {
  const points = new Set([planStart, planEnd]);
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

function buildStats(shifts, employees) {
  const perEmployee = employees.map((e) => {
    const own = shifts.filter((s) => s.employeeId === e.id).sort((a, b) => a.start - b.start);
    const minutes = own.reduce((sum, s) => sum + (s.end - s.start) / MINUTE, 0);

    let minGapMinutes = null;
    for (let i = 1; i < own.length; i++) {
      const gap = (own[i].start - own[i - 1].end) / MINUTE;
      if (minGapMinutes == null || gap < minGapMinutes) minGapMinutes = gap;
    }

    return { employeeId: e.id, name: e.name, minutes, stints: own.length, minGapMinutes };
  });

  const totals = perEmployee.map((p) => p.minutes);
  const spreadMinutes = totals.length ? Math.max(...totals) - Math.min(...totals) : 0;
  return { perEmployee, spreadMinutes };
}
