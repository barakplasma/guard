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
 *     each slot's LOCAL hour/minute (the JS runtime's local timezone), matching
 *     the rest of the app's "device-local time is the interface" convention.
 *   - guards: an optional list of specific assigned guard NAMES. When non-empty,
 *     that position is staffed ONLY from this list (balanced among them across
 *     occurrences for fairness); generation errors if too few are available.
 *
 * A time-restricted position is one CONTINUOUS shift per window: the same
 * guard(s) hold the entire window (e.g. 22:00-06:00 is a single 8h block, not
 * eight hourly rows), so nobody switches out mid-shift. Regular (non-time-
 * restricted) positions still rotate every `shiftMinutes` slot. All positions
 * share one fairness pool: a guard's total hours across every position they fill
 * (not per-position) is what gets balanced.
 */

function parseHHMM(value, label) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? '');
  if (!match) throw new Error(`${label} must be an "HH:MM" 24h string, got ${JSON.stringify(value)}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function minuteOfDay(t) {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

function isPositionActiveAt(position, t) {
  if (!position.timeRestricted) return true;
  const startMin = parseHHMM(position.windowStart, `${position.name}.windowStart`);
  const endMin = parseHHMM(position.windowEnd, `${position.name}.windowEnd`);
  const nowMin = minuteOfDay(t);
  // Windows like 22:00-06:00 wrap past midnight.
  return startMin <= endMin ? nowMin >= startMin && nowMin < endMin : nowMin >= startMin || nowMin < endMin;
}

function normalizePositions(positions) {
  if (!positions || positions.length === 0) throw new Error('At least one position must be specified.');
  return positions.map((p) => {
    if (!p.name) throw new Error('Every position needs a name.');
    if (p.timeRestricted) {
      parseHHMM(p.windowStart, `${p.name}.windowStart`);
      parseHHMM(p.windowEnd, `${p.name}.windowEnd`);
    }
    // Missing/0/negative headcount means "one guard" (also the default for rows
    // that predate the headcount field, which read back as 0 from PocketBase).
    const headcount = Number.isInteger(p.headcount) && p.headcount >= 1 ? p.headcount : 1;
    // An empty assigned list means "any guard is eligible" (null sentinel).
    const assigned = p.guards && p.guards.length > 0 ? new Set(p.guards) : null;
    return {
      id: p.id ?? p.name,
      name: p.name,
      timeRestricted: !!p.timeRestricted,
      windowStart: p.windowStart,
      windowEnd: p.windowEnd,
      headcount,
      assigned,
    };
  });
}

/**
 * Sum a guard's hours that count toward fairness at slot time `t`.
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
 *   assigned guard names that, when set, is the ONLY pool that position draws from.
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

  // Seed availability + fairness from existing shifts. `existingByPosition`
  // records the [start,end) intervals already filled per position so we never
  // emit a duplicate seat when a generation range overlaps shifts that already
  // exist - counted by "how many rows cover time t" so it works for both hourly
  // regular rows and continuous time-restricted windows.
  const existingByPosition = new Map();
  for (const shift of existingShifts) {
    if (shift.position != null) {
      if (!existingByPosition.has(shift.position)) existingByPosition.set(shift.position, []);
      existingByPosition.get(shift.position).push({ start: shift.start, end: shift.end });
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

  const newShifts = [];
  // For a time-restricted position, how far its currently-assigned window
  // reaches - so we don't re-demand it on every slot inside the window.
  const coveredUntil = new Map();

  for (let t = start; t < end; t += shiftMs) {
    // A "demand" is one seat to fill at this slot: which position, until when
    // (`blockEnd`), how many seats (`need`), and the eligible pool (`assigned`
    // Set or null for "anyone").
    const demands = [];
    for (const p of normalizedPositions) {
      if (!isPositionActiveAt(p, t)) continue;

      if (p.timeRestricted) {
        // One continuous shift per window: only demand at the window's opening,
        // and reserve the whole contiguous active block.
        if ((coveredUntil.get(p.id) ?? 0) > t) continue;
        let blockEnd = t + shiftMs;
        while (blockEnd < end && isPositionActiveAt(p, blockEnd)) blockEnd += shiftMs;
        coveredUntil.set(p.id, blockEnd);
        const need = p.headcount - existingCoverAt(p.id, t);
        if (need > 0) demands.push({ position: p, blockEnd, need, assigned: p.assigned });
      } else {
        const need = p.headcount - existingCoverAt(p.id, t);
        if (need > 0) demands.push({ position: p, blockEnd: t + shiftMs, need, assigned: p.assigned });
      }
    }
    if (demands.length === 0) continue;

    const totalNeed = demands.reduce((sum, d) => sum + d.need, 0);
    if (guards.length < totalNeed) {
      throw new Error('Not enough guards to fill positions');
    }

    // Assign most-constrained demands first (smallest eligible pool, assigned
    // before unrestricted) so a restricted post isn't starved by a greedy pick
    // that a wide-open post could have taken instead.
    const poolSize = (d) => (d.assigned ? d.assigned.size : guards.length + 1);
    demands.sort((a, b) => poolSize(a) - poolSize(b));

    const usedThisSlot = new Set();
    for (const demand of demands) {
      // Only guards not on duty at `t` (no double-booking), not already picked
      // this slot, and - for a restricted post - on its assigned list.
      const candidates = [...state.values()].filter(
        (s) =>
          s.busyUntil <= t &&
          !usedThisSlot.has(s.name) &&
          (demand.assigned == null || demand.assigned.has(s.name)),
      );
      if (candidates.length < demand.need) {
        const scope = demand.assigned ? 'assigned ' : '';
        throw new Error(
          `Not enough available ${scope}guards for position ${demand.position.name} at ${new Date(t).toISOString()}`,
        );
      }
      // Prefer rested guards, then lightest load in the fairness window, then
      // longest since last on duty, then round-robin order.
      candidates.sort((a, b) => {
        const aRested = a.restedAt <= t ? 0 : 1;
        const bRested = b.restedAt <= t ? 0 : 1;
        if (aRested !== bRested) return aRested - bRested;
        const aLoad = loadAt(a.history, t, windowMs);
        const bLoad = loadAt(b.history, t, windowMs);
        if (aLoad !== bLoad) return aLoad - bLoad;
        if (a.busyUntil !== b.busyUntil) return a.busyUntil - b.busyUntil;
        return a.seq - b.seq;
      });

      const blockHours = (demand.blockEnd - t) / 3600000;
      for (const st of candidates.slice(0, demand.need)) {
        newShifts.push({ start: t, end: demand.blockEnd, position: demand.position.id, guard: st.name });
        st.busyUntil = demand.blockEnd;
        st.restedAt = demand.blockEnd + restMs;
        st.history.total += blockHours;
        st.history.shifts.push({ end: demand.blockEnd, hours: blockHours });
        st.seq = seq++;
        usedThisSlot.add(st.name);
      }
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
