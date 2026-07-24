/**
 * Pure, dependency-free ES module port of gs2.py's scheduling loop and compute_stats.
 * All times are ms-epoch numbers; callers convert Date <-> number at the edges.
 *
 * Unlike gs2.py, ties in guard availability are broken by (totalHours, insertion order)
 * instead of alphabetically by name, so hours stay balanced even when every guard starts
 * equally available (see CLAUDE.md gotchas / DESIGN.md section 4).
 *
 * Positions are named (e.g. "דרומי", "ש''ג") rather than
 * a plain headcount. Each position also carries:
 *   - headcount: how many guards it needs at once (default 1).
 *   - timeRestricted + windowStart/windowEnd: an "HH:MM" window compared against
 *     LOCAL hour/minute (the JS runtime's local timezone), matching the rest of
 *     the app's "device-local time is the interface" convention.
 *   - guards: an optional list of specific assigned guard NAMES. When non-empty,
 *     that position PREFERS this list (used first, balanced among them across
 *     occurrences for fairness), but falls back to the wider pool when too few
 *     of them are free rather than leaving the post empty.
 *
 * Scheduling is demand-driven. A regular position produces one demand per
 * `shiftMinutes` slot. A time-restricted position produces one CONTINUOUS block
 * per WINDOW OCCURRENCE (e.g. 22:00-06:00 is a single 8h block, same guard end
 * to end - nobody switches out mid-shift) - derived from the window itself, NOT
 * the slot grid, so a window that opens or closes between grid points is neither
 * missed nor mis-clamped. Existing shifts split a block at their real edges so an
 * off-grid existing shift causes neither a gap nor overstaffing. Across days a
 * time-restricted post rotates - whoever filled it longest ago (or never) goes
 * next ("Alice one night, Bob the next"), outranking global hour-fairness. All
 * positions share one fairness pool: a guard's total hours across every position
 * they fill (not per-position) is what gets balanced.
 */

function parseHHMM(value, label) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? '');
  if (!match) throw new Error(`${label} must be an "HH:MM" 24h string, got ${JSON.stringify(value)}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizePositions(positions) {
  if (!positions || positions.length === 0) throw new Error('At least one position must be specified.');
  return positions.map((p) => {
    if (!p.name) throw new Error('Every position needs a name.');
    let windowStartMin = null;
    let windowEndMin = null;
    if (p.timeRestricted) {
      windowStartMin = parseHHMM(p.windowStart, `${p.name}.windowStart`);
      windowEndMin = parseHHMM(p.windowEnd, `${p.name}.windowEnd`);
    }
    // Missing/0/negative headcount means "one guard" (also the default for rows
    // that predate the headcount field, which read back as 0 from PocketBase).
    const headcount = Number.isInteger(p.headcount) && p.headcount >= 1 ? p.headcount : 1;
    // An empty assigned list means "no preference, any guard" (null sentinel);
    // a non-empty list is a preference, not a hard restriction (see below).
    const assigned = p.guards && p.guards.length > 0 ? new Set(p.guards) : null;
    return {
      id: p.id ?? p.name,
      name: p.name,
      timeRestricted: !!p.timeRestricted,
      windowStart: p.windowStart,
      windowEnd: p.windowEnd,
      windowStartMin,
      windowEndMin,
      headcount,
      assigned,
    };
  });
}

// Every occurrence of a time-restricted position's window that intersects
// [rangeStart, rangeEnd), clamped to it, as [open, close] ms pairs. Enumerated
// by local calendar day (advancing the day field, not adding 24h) so the bounds
// land on the intended wall-clock time even across a daylight-saving transition,
// and wrap windows like 22:00-06:00 are handled.
function windowOccurrences(p, rangeStart, rangeEnd) {
  const occ = [];
  if (p.windowStartMin === p.windowEndMin) return occ; // zero-length window is never active
  const sh = Math.floor(p.windowStartMin / 60);
  const sm = p.windowStartMin % 60;
  const eh = Math.floor(p.windowEndMin / 60);
  const em = p.windowEndMin % 60;
  const base = new Date(rangeStart);
  // Start a day early so an occurrence that opened yesterday and wraps into the
  // range (e.g. 22:00 -> 06:00) is included.
  for (let day = -1; ; day++) {
    const openDate = new Date(base.getFullYear(), base.getMonth(), base.getDate() + day, sh, sm, 0, 0);
    const open = openDate.getTime();
    if (open >= rangeEnd) break;
    let close = new Date(openDate.getFullYear(), openDate.getMonth(), openDate.getDate(), eh, em, 0, 0).getTime();
    if (close <= open) {
      close = new Date(openDate.getFullYear(), openDate.getMonth(), openDate.getDate() + 1, eh, em, 0, 0).getTime();
    }
    const os = Math.max(open, rangeStart);
    const oc = Math.min(close, rangeEnd);
    if (os < oc) occ.push([os, oc]);
  }
  return occ;
}

/**
 * Sum a guard's hours that count toward fairness at time `t`.
 * With no window this is the all-time total (original behavior); with a
 * trailing window only shifts that ended within the last `windowMs` count,
 * so past load "gently resets" over time instead of penalizing a guard forever.
 */
function loadAt(history, t, windowMs) {
  if (windowMs == null) return history.total;
  let sum = 0;
  for (const entry of history.shifts) {
    if (entry.end > t - windowMs) sum += entry.hours;
  }
  return sum;
}

/**
 * @param {object} params
 * @param {number} params.start - ms epoch
 * @param {number} params.end - ms epoch
 * @param {number} params.shiftMinutes
 * @param {{id?:string,name:string,timeRestricted?:boolean,windowStart?:string,windowEnd?:string,headcount?:number,guards?:string[]}[]} params.positions
 *   `headcount` is guards-per-slot (default 1); `guards` is an optional list of
 *   assigned guard names that, when set, that position draws from first before
 *   falling back to the wider pool.
 * @param {string[]} params.guards
 * @param {{start:number,end:number,guard:string,position?:string}[]} [params.existingShifts]
 * @param {number} [params.restMinutes=0] - minimum rest between a guard's shifts (anti-back-to-back).
 *   Guards who haven't rested this long are only used as a last resort to avoid leaving a post empty.
 * @param {number|null} [params.fairnessWindowMinutes=null] - if set, balance load over a trailing
 *   window of this many minutes instead of all time (e.g. 1440 = a rolling 24h window).
 * @returns {{start:number,end:number,position:string,guard:string}[]} only the newly generated shifts
 */
export function generateShifts({
  start,
  end,
  shiftMinutes,
  positions,
  guards,
  existingShifts = [],
  restMinutes = 0,
  fairnessWindowMinutes = null,
}) {
  if (!(end > start)) throw new Error('Start time must be before end time.');
  if (!(shiftMinutes > 0)) throw new Error('Shift length must be positive.');
  if (!guards || guards.length === 0) throw new Error('At least one guard must be specified.');
  if (new Set(guards).size !== guards.length) throw new Error('Guard names must be unique.');
  if (!(restMinutes >= 0)) throw new Error('Rest minutes must be non-negative.');
  if (fairnessWindowMinutes != null && !(fairnessWindowMinutes > 0)) {
    throw new Error('Fairness window must be positive.');
  }
  const normalizedPositions = normalizePositions(positions);

  const shiftMs = shiftMinutes * 60 * 1000;
  const restMs = restMinutes * 60 * 1000;
  const windowMs = fairnessWindowMinutes == null ? null : fairnessWindowMinutes * 60 * 1000;

  const guardSet = new Set(guards);
  // Every assigned guard must be part of the overall guard pool - otherwise the
  // position could never be staffed (the guard has no scheduling state). The
  // Generate page enforces this by unioning assigned guards into the pool.
  for (const p of normalizedPositions) {
    if (!p.assigned) continue;
    for (const name of p.assigned) {
      if (!guardSet.has(name)) {
        throw new Error(`Position ${p.name} assigns guard "${name}" who is not in the guard pool`);
      }
    }
  }

  // Per-guard state. `busyUntil` is a hard constraint (a shift actually covers
  // that time - can't double-book); `restedAt` = busyUntil + rest gap is a soft
  // preference. `seq` round-robins ties: a just-picked guard moves to the back.
  let seq = 0;
  const state = new Map(
    guards.map((g) => [g, { name: g, busyUntil: 0, restedAt: 0, seq: seq++, history: { total: 0, shifts: [] } }]),
  );

  // Seed availability + fairness from existing shifts, and record their
  // [start,end) intervals per position (so we never double-staff a seat already
  // filled). Also seed per-post rotation: when each guard last filled a
  // time-restricted post (`${positionId} ${guardName}` -> last block start;
  // absent = never, so newcomers rotate in first and then whoever did it longest
  // ago goes next).
  const timeRestrictedIds = new Set(normalizedPositions.filter((p) => p.timeRestricted).map((p) => p.id));
  const lastDidPosition = new Map();
  const rotationKey = (positionId, name) => `${positionId} ${name}`;

  const existingByPosition = new Map();
  for (const shift of existingShifts) {
    if (shift.position != null) {
      if (!existingByPosition.has(shift.position)) existingByPosition.set(shift.position, []);
      existingByPosition.get(shift.position).push({ start: shift.start, end: shift.end });
      if (timeRestrictedIds.has(shift.position) && shift.guard != null) {
        const key = rotationKey(shift.position, shift.guard);
        lastDidPosition.set(key, Math.max(lastDidPosition.get(key) ?? -Infinity, shift.start));
      }
    }
    const st = state.get(shift.guard);
    if (st) {
      const hours = (shift.end - shift.start) / 3600000;
      st.busyUntil = Math.max(st.busyUntil, shift.end);
      st.restedAt = Math.max(st.restedAt, shift.end + restMs);
      st.history.total += hours;
      st.history.shifts.push({ end: shift.end, hours });
    }
  }
  const existingCoverAt = (positionId, t) => {
    const intervals = existingByPosition.get(positionId);
    if (!intervals) return 0;
    let n = 0;
    for (const iv of intervals) if (iv.start <= t && t < iv.end) n++;
    return n;
  };

  // Split [os, oc) at existing-shift edges into segments of uniform existing
  // coverage, so an off-grid existing shift can't cause overstaffing or a gap -
  // each emitted block runs to the existing shift's real edge, with a constant
  // `need`, and one guard holds it end to end.
  const coverageSegments = (positionId, os, oc) => {
    const intervals = existingByPosition.get(positionId) || [];
    const edges = new Set([os, oc]);
    for (const iv of intervals) {
      if (iv.start > os && iv.start < oc) edges.add(iv.start);
      if (iv.end > os && iv.end < oc) edges.add(iv.end);
    }
    const sorted = [...edges].sort((a, b) => a - b);
    const segs = [];
    for (let i = 1; i < sorted.length; i++) {
      const segStart = sorted[i - 1];
      const segEnd = sorted[i];
      const mid = (segStart + segEnd) / 2;
      let cover = 0;
      for (const iv of intervals) if (iv.start <= mid && mid < iv.end) cover++;
      segs.push({ start: segStart, end: segEnd, cover });
    }
    return segs;
  };

  // A "demand" is one block to fill: `need` guards on `position` from `blockStart`
  // to `blockEnd`. Regular posts demand per grid slot; time-restricted posts
  // demand per window occurrence (minus what existing shifts already cover).
  const demands = [];
  for (const p of normalizedPositions) {
    if (p.timeRestricted) {
      for (const [os, oc] of windowOccurrences(p, start, end)) {
        for (const seg of coverageSegments(p.id, os, oc)) {
          const need = p.headcount - seg.cover;
          if (need > 0) {
            demands.push({ position: p, blockStart: seg.start, blockEnd: seg.end, need, assigned: p.assigned });
          }
        }
      }
    } else {
      for (let t = start; t < end; t += shiftMs) {
        const need = p.headcount - existingCoverAt(p.id, t);
        if (need > 0) {
          demands.push({ position: p, blockStart: t, blockEnd: Math.min(t + shiftMs, end), need, assigned: p.assigned });
        }
      }
    }
  }

  // Assign chronologically; within the same start, most-constrained (smallest
  // eligible pool, assigned before wide-open) first so a restricted post isn't
  // starved by a greedy pick a wide-open post could have taken instead. A guard
  // picked for a block is busy until its end, so overlapping demands can't reuse
  // them (no double-booking) without any extra bookkeeping.
  const poolSize = (d) => (d.assigned ? d.assigned.size : guards.length + 1);
  demands.sort((a, b) => a.blockStart - b.blockStart || poolSize(a) - poolSize(b));

  // If the seats demanded at a single instant exceed the whole pool, no
  // assignment could ever fill them (preserves the original error message).
  const needByStart = new Map();
  for (const d of demands) needByStart.set(d.blockStart, (needByStart.get(d.blockStart) || 0) + d.need);
  for (const total of needByStart.values()) {
    if (guards.length < total) throw new Error('Not enough guards to fill positions');
  }

  const newShifts = [];
  for (const demand of demands) {
    const ref = demand.blockStart;
    // Available guards: off duty at the block's start (no double-booking). A
    // restricted post PREFERS its assigned guards but falls back to the wider
    // pool when too few are free, rather than leaving the post empty.
    const candidates = [...state.values()].filter((s) => s.busyUntil <= ref);
    if (candidates.length < demand.need) {
      throw new Error(`Not enough available guards for position ${demand.position.name} at ${new Date(ref).toISOString()}`);
    }
    // Order of preference:
    //   1. assigned guards first (when the post has a list),
    //   2. for a time-restricted post, whoever filled it longest ago (or never)
    //      - the day-to-day rotation, which outranks global hour-fairness,
    //   3. rested guards, 4. lightest load in the fairness window,
    //   5. longest since last on duty, 6. round-robin order.
    const rotatePost = demand.position.timeRestricted;
    candidates.sort((a, b) => {
      if (demand.assigned) {
        const aAssigned = demand.assigned.has(a.name) ? 0 : 1;
        const bAssigned = demand.assigned.has(b.name) ? 0 : 1;
        if (aAssigned !== bAssigned) return aAssigned - bAssigned;
      }
      if (rotatePost) {
        const aLast = lastDidPosition.get(rotationKey(demand.position.id, a.name)) ?? -Infinity;
        const bLast = lastDidPosition.get(rotationKey(demand.position.id, b.name)) ?? -Infinity;
        if (aLast !== bLast) return aLast - bLast;
      }
      const aRested = a.restedAt <= ref ? 0 : 1;
      const bRested = b.restedAt <= ref ? 0 : 1;
      if (aRested !== bRested) return aRested - bRested;
      const aLoad = loadAt(a.history, ref, windowMs);
      const bLoad = loadAt(b.history, ref, windowMs);
      if (aLoad !== bLoad) return aLoad - bLoad;
      if (a.busyUntil !== b.busyUntil) return a.busyUntil - b.busyUntil;
      return a.seq - b.seq;
    });

    const blockHours = (demand.blockEnd - demand.blockStart) / 3600000;
    for (const st of candidates.slice(0, demand.need)) {
      newShifts.push({ start: demand.blockStart, end: demand.blockEnd, position: demand.position.id, guard: st.name });
      st.busyUntil = demand.blockEnd;
      st.restedAt = demand.blockEnd + restMs;
      st.history.total += blockHours;
      st.history.shifts.push({ end: demand.blockEnd, hours: blockHours });
      st.seq = seq++;
      if (rotatePost) lastDidPosition.set(rotationKey(demand.position.id, st.name), demand.blockStart);
    }
  }

  return newShifts;
}

/**
 * @param {{start:number,end:number,guard:string}[]} shifts
 * @returns {{hoursPerGuard: Map<string, number>, variance: number|null}}
 */
export function computeStats(shifts) {
  const hoursPerGuard = new Map();
  for (const shift of shifts) {
    const hours = (shift.end - shift.start) / 3600000;
    hoursPerGuard.set(shift.guard, (hoursPerGuard.get(shift.guard) || 0) + hours);
  }

  const values = [...hoursPerGuard.values()];
  let variance = null;
  if (values.length > 1) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  }

  return { hoursPerGuard, variance };
}
