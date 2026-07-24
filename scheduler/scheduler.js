/**
 * Pure, dependency-free ES module port of gs2.py's scheduling loop and compute_stats.
 * All times are ms-epoch numbers; callers convert Date <-> number at the edges.
 *
 * Unlike gs2.py, ties in guard availability are broken by (totalHours, insertion order)
 * instead of alphabetically by name, so hours stay balanced even when every guard starts
 * equally available (see CLAUDE.md gotchas / DESIGN.md section 4).
 *
 * Positions are named (e.g. "דרומי", "ש''ג") rather than
 * a plain headcount. A position can be time-restricted (e.g. patrol only staffed
 * 22:00-06:00) - "HH:MM" window strings are compared against each slot's LOCAL
 * hour/minute (the JS runtime's local timezone), matching the rest of the app's
 * "device-local time is the interface" convention. All positions share one
 * fairness pool: a guard's total hours across every position they fill (not
 * per-position) is what gets balanced. A position can require several guards
 * and can restrict staffing to a named eligible group.
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
    const peopleCount = p.peopleCount ?? 1;
    if (!Number.isInteger(peopleCount) || peopleCount < 1) {
      throw new Error(`${p.name}.peopleCount must be a positive integer.`);
    }
    const eligibleGuards = p.eligibleGuards ?? [];
    if (!Array.isArray(eligibleGuards)) throw new Error(`${p.name}.eligibleGuards must be an array.`);
    if (new Set(eligibleGuards).size !== eligibleGuards.length) {
      throw new Error(`${p.name}.eligibleGuards must not contain duplicates.`);
    }
    return {
      id: p.id ?? p.name,
      name: p.name,
      timeRestricted: !!p.timeRestricted,
      windowStart: p.windowStart,
      windowEnd: p.windowEnd,
      peopleCount,
      eligibleGuards,
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
 * @param {{id?:string,name:string,timeRestricted?:boolean,windowStart?:string,windowEnd?:string,peopleCount?:number,eligibleGuards?:string[]}[]} params.positions
 * @param {string[]} params.guards
 * @param {{start:number,end:number,guard:string,position?:string}[]} [params.existingShifts]
 * @param {Record<string, {start:number,end:number}[]>} [params.unavailablePeriods] - vacation
 * periods by guard name. A guard is skipped only for shifts that overlap one of their periods.
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
  unavailablePeriods = {},
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

  for (const [guard, periods] of Object.entries(unavailablePeriods)) {
    if (!Array.isArray(periods)) throw new Error(`Unavailable periods for ${guard} must be an array.`);
    for (const period of periods) {
      if (!(period?.end > period?.start)) throw new Error(`Unavailable period for ${guard} must have an end after its start.`);
    }
  }

  const shiftMs = shiftMinutes * 60 * 1000;
  const restMs = restMinutes * 60 * 1000;
  const windowMs = fairnessWindowMinutes == null ? null : fairnessWindowMinutes * 60 * 1000;
  const shiftHours = shiftMs / 3600000;

  // Per-guard state. `busyUntil` is a hard constraint (a shift actually covers
  // that time - can't double-book); `restedAt` = busyUntil + rest gap is a soft
  // preference. `seq` round-robins ties: a just-picked guard moves to the back.
  let seq = 0;
  const state = new Map(
    guards.map((g) => [g, { name: g, busyUntil: 0, restedAt: 0, seq: seq++, history: { total: 0, shifts: [] } }]),
  );

  // Seed availability + fairness from existing shifts, and count already
  // filled position slots so an overlapping generation fills only vacancies.
  const occupiedCounts = new Map();
  for (const shift of existingShifts) {
    if (shift.position != null) {
      const key = `${shift.start}|${shift.position}`;
      occupiedCounts.set(key, (occupiedCounts.get(key) || 0) + 1);
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

  const newShifts = [];

  for (let t = start; t < end; t += shiftMs) {
    const shiftEnd = t + shiftMs;
    const activePositions = normalizedPositions
      .filter((p) => isPositionActiveAt(p, t))
      .map((position) => ({
        ...position,
        remainingPeople: Math.max(0, position.peopleCount - (occupiedCounts.get(`${t}|${position.id}`) || 0)),
      }))
      .filter((position) => position.remainingPeople > 0)
      // Fill the most restricted positions first, before general positions
      // consume the people qualified for a restricted assignment.
      .sort((a, b) => {
        const aChoices = a.eligibleGuards.length || guards.length;
        const bChoices = b.eligibleGuards.length || guards.length;
        return aChoices - bChoices;
      });
    if (activePositions.length === 0) continue;

    const requiredPeople = activePositions.reduce((total, position) => total + position.remainingPeople, 0);
    if (guards.length < requiredPeople) {
      throw new Error('Not enough guards to fill positions');
    }

    const assignedThisSlot = new Set();
    for (const position of activePositions) {
      for (let i = 0; i < position.remainingPeople; i += 1) {
        const candidates = [...state.values()]
          .filter((guard) => guard.busyUntil <= t && !assignedThisSlot.has(guard.name))
          .filter((guard) => !(unavailablePeriods[guard.name] || []).some((period) => period.start < shiftEnd && period.end > t))
          .filter((guard) => position.eligibleGuards.length === 0 || position.eligibleGuards.includes(guard.name))
          .sort((a, b) => {
            const aRested = a.restedAt <= t ? 0 : 1;
            const bRested = b.restedAt <= t ? 0 : 1;
            if (aRested !== bRested) return aRested - bRested;
            const aLoad = loadAt(a.history, t, windowMs);
            const bLoad = loadAt(b.history, t, windowMs);
            if (aLoad !== bLoad) return aLoad - bLoad;
            if (a.busyUntil !== b.busyUntil) return a.busyUntil - b.busyUntil;
            return a.seq - b.seq;
          });
        const guard = candidates[0];
        if (!guard) {
          if (position.eligibleGuards.length) {
            throw new Error(`Not enough eligible guards to fill ${position.name}`);
          }
          throw new Error(`Not enough available guards at ${new Date(t).toISOString()} (others are on existing shifts)`);
        }
        assignedThisSlot.add(guard.name);
        newShifts.push({ start: t, end: shiftEnd, position: position.id, guard: guard.name });
        guard.busyUntil = shiftEnd;
        guard.restedAt = shiftEnd + restMs;
        guard.history.total += shiftHours;
        guard.history.shifts.push({ end: shiftEnd, hours: shiftHours });
        guard.seq = seq++;
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
