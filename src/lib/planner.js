/**
 * Shift planner.
 *
 * Pure, dependency-free ES module: no DOM, no `Date.now()`, no `Math.random()`.
 * All times are ms-epoch numbers. Given the same input it always produces
 * byte-identical output - that is what lets a plan live entirely in a shared
 * URL and render the same for everyone who opens it.
 *
 * Two mission types:
 *   - `remote` - the same people staff it for its entire duration and are
 *     locked out of everything else while it runs.
 *   - `local`  - people rotate every `shiftMinutes` among whoever is still
 *     available, balancing total time and spreading each person's turns as far
 *     apart as possible.
 *
 * Manual assignments ("pins") are inputs, not patches to the output, so
 * hand-edits survive re-planning and sharing. See `plan`'s jsdoc.
 */

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
};

/* ------------------------------------------------------------------ */
/* Normalization + validation                                          */
/* ------------------------------------------------------------------ */

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
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
function normalizePins(pins, employeeById, missionById, warnings) {
  const out = [];
  const perMission = new Map();
  for (const p of pins) {
    const mission = missionById.get(p.missionId);
    const employee = employeeById.get(p.employeeId);
    if (!mission || !employee) continue; // stale reference

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
      warnings.push({ code: WARN.PIN_UNAVAILABLE, missionId: mission.id, employeeId: employee.id });
      continue;
    }
    // A frozen pin (freezeElapsedBeforeEdit, src/lib/pins.js) records what
    // already happened. Someone's availability window changing afterwards
    // must not retroactively make that shift "invalid" - the past cannot
    // become unavailable - or the engine would reassign it to someone else
    // on the next render, which is exactly what freezing exists to prevent.
    if (!p.frozen && (employee.start > start || employee.end < end)) {
      warnings.push({
        code: WARN.PIN_UNAVAILABLE, missionId: mission.id, employeeId: employee.id, start, end,
      });
      continue;
    }

    // A person cannot be in two places at once. Pins are appended to the
    // document in edit order, so the *latest* one written wins - a fresh
    // manual assignment must never be silently discarded in favour of a
    // stale pin the same person happens to still hold elsewhere; the older,
    // now-conflicting pin is the one that gets superseded.
    const clashIndex = out.findIndex(
      (q) => q.employeeId === employee.id && overlaps(q.start, q.end, start, end),
    );
    if (clashIndex !== -1) {
      const displaced = out[clashIndex];
      warnings.push({
        code: WARN.PIN_CONFLICT,
        missionId: displaced.missionId,
        employeeId: employee.id,
        start: displaced.start,
        end: displaced.end,
      });
      out.splice(clashIndex, 1);
      const displacedSiblings = perMission.get(displaced.missionId);
      if (displacedSiblings) {
        const idx = displacedSiblings.indexOf(displaced);
        if (idx !== -1) displacedSiblings.splice(idx, 1);
      }
    }

    // More pins than the mission has seats at some instant: keep the earliest.
    const sameMission = perMission.get(mission.id) || [];
    const concurrent = sameMission.filter((q) => overlaps(q.start, q.end, start, end));
    if (concurrent.length >= mission.count) {
      warnings.push({
        code: WARN.PIN_OVERFLOW, missionId: mission.id, employeeId: employee.id, start, end,
      });
      continue;
    }

    const pin = { missionId: mission.id, employeeId: employee.id, start, end };
    out.push(pin);
    sameMission.push(pin);
    perMission.set(mission.id, sameMission);
  }
  return out;
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
function makeState(employees) {
  let seq = 0;
  return new Map(
    employees.map((e) => [
      e.id,
      {
        id: e.id, name: e.name, start: e.start, end: e.end, busy: [], busyUntil: -Infinity,
        minutes: 0, missionMinutes: new Map(), lastEnd: -Infinity, seq: seq++, stints: 0,
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
 * @param {{id:string,name:string,start?:number,end?:number}[]} params.employees
 *   `start`/`end` default to the whole plan window.
 * @param {{id:string,name:string,type:'remote'|'local',start?:number,end?:number,count:number}[]} params.missions
 * @param {{missionId:string,employeeId:string,start?:number,end?:number,frozen?:boolean}[]} [params.pins]
 *   Hard, hand-made assignments. Omitting `start`/`end` pins the person to the
 *   mission's whole window (how people are assigned to a remote mission);
 *   supplying them pins one specific shift (how a manual swap is recorded).
 *   `frozen: true` marks a pin the engine wrote for itself to lock in an
 *   already-elapsed shift (see pins.js's freezeElapsedBeforeEdit) - it skips
 *   the availability check below, since the past cannot become "unavailable".
 * @returns {{
 *   shifts: {missionId:string,missionName:string,type:string,employeeId:string,employeeName:string,start:number,end:number,pinned:boolean}[],
 *   timeline: {start:number,end:number,onDuty:{employeeId:string,missionId:string}[],offDuty:string[],unavailable:string[]}[],
 *   stats: {perEmployee:{employeeId:string,name:string,minutes:number,stints:number,minGapMinutes:number|null}[], spreadMinutes:number},
 *   warnings: object[],
 * }}
 */
export function plan({ start, end, shiftMinutes, employees = [], missions = [], pins = [] }) {
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
  const goodPins = normalizePins(pins, employeeById, missionById, warnings);

  const state = makeState(emps);
  let seqCounter = emps.length;
  const nextSeq = () => seqCounter++;

  /** Raw assignments before adjacent-row merging. */
  const rows = [];
  const addRow = (mission, st, blockStart, blockEnd, pinned) => {
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
    });
  };

  /* --- 1. pins are immovable: place them before anything else competes --- */
  for (const pin of goodPins) {
    addRow(missionById.get(pin.missionId), state.get(pin.employeeId), pin.start, pin.end, true);
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
    candidates.sort((a, b) => (
      a.minutes - b.minutes
      || a.lastEnd - b.lastEnd
      || a.seq - b.seq
    ));

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
    // The fairness core:
    //   1. fewest minutes so far      -> even rotation
    //   2. earliest `lastEnd`         -> maximizes the gap since last on duty
    //   3. fewest minutes on *this* mission -> rotates people across mission types,
    //      not just across time - otherwise two concurrent local missions can settle
    //      into "always the same person on A, always the other on B" even though their
    //      total minutes stay perfectly balanced.
    //   4. `seq`                      -> round-robin among exact ties
    candidates.sort((a, b) => (
      a.minutes - b.minutes
      || a.lastEnd - b.lastEnd
      || (a.missionMinutes.get(d.mission.id) ?? 0) - (b.missionMinutes.get(d.mission.id) ?? 0)
      || a.seq - b.seq
    ));

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
 * meaningful per row for the UI's clear-pin action.
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
