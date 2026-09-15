const MINUTE = 60000;
const overlap = (a, b) => a.start < b.end && b.start < a.end;
function target(employee, tags) {
  return Math.max(0, ...tags.filter((t) => (employee.tags ?? []).includes(t.id)).map((t) => t.minNightRestMinutes ?? 0));
}

/** Preferred blocks only: staffing may override them; no work accounting. */
export function preferredRest(employees, tags, nights, pins, start, end) {
  const blocks = [];
  for (const night of nights) {
    for (const e of employees) {
      const needed = target(e, tags) * MINUTE;
      const lo = Math.max(start, night.start), hi = Math.min(end, night.end);
      if (!needed || hi - lo < needed) continue;
      const ownPins = pins.filter((p) => p.employeeId === e.id);
      const points = new Set([lo, hi - needed]);
      // Pin edges allow a feasible off-hour block instead of rounding it away.
      for (let at = lo; at + needed <= hi; at += 30 * MINUTE) points.add(at);
      for (const p of ownPins) { points.add(p.end); points.add(p.start - needed); }
      let best = null, cost = Infinity;
      for (const at of [...points].sort((a, b) => a - b)) {
        const b = { employeeId: e.id, start: at, end: at + needed };
        if (b.start < lo || b.end > hi || ownPins.some((p) => overlap(p, b))) continue;
        const score = blocks.reduce((n, p) => n + Math.max(0, Math.min(p.end, b.end) - Math.max(p.start, b.start)), 0);
        if (score < cost) { best = b; cost = score; }
      }
      if (best) blocks.push(best);
    }
  }
  return blocks;
}

export function overlapsRest(employeeId, start, end, blocks) {
  return blocks.some((b) => b.employeeId === employeeId && overlap(b, { start, end }));
}

/** Measure the union of awake duty, so overlapping rows cannot double-count it. */
function measureRest(shifts, lo, hi) {
  let cursor = lo, total = 0, longest = 0;
  for (const s of [...shifts].sort((a, b) => a.start - b.start)) {
    if (!overlap(s, { start: lo, end: hi })) continue;
    const gap = Math.max(0, s.start - cursor);
    total += gap;
    longest = Math.max(longest, gap);
    cursor = Math.max(cursor, Math.min(hi, s.end));
  }
  const tail = Math.max(0, hi - cursor);
  return { total: (total + tail) / MINUTE, longest: Math.max(longest, tail) / MINUTE };
}

/**
 * Preference ideals for anyone holding a qualification with a rest
 * requirement. The configured per-qualification minimum stays the number that
 * is enforced and reported; these sit below it in the staffing priority
 * ladder - worth a trade only once the minimum itself is safe, but above
 * ordinary fairness. Eight total and six uninterrupted hours, in minutes.
 */
export const PREFERRED_TOTAL_MINUTES = 8 * 60;
export const PREFERRED_CONTINUOUS_MINUTES = 6 * 60;

/**
 * The added rest cost of duty on `[lo, hi)`, as a priority ladder: added
 * deficit against the configured *total* minimum first, then the shortfall
 * against the total preference, then against the continuous preference.
 * Tiers only differentiate among schedules that already tie on the tier
 * above, so a driver falling below the target always outweighs a colleague's
 * imperfect night, and an employee without any rest requirement costs zero
 * and stays fairness-governed.
 */
export function restCost(employee, tags, nights, shifts, start, end, lo, hi) {
  const needed = target(employee, tags);
  const cost = [0, 0, 0];
  if (!needed) return cost;
  // Preferences ratchet up with the configuration, never down: a 420-minute
  // minimum is also the smallest "ideal" worth aiming at.
  const totalWanted = Math.max(needed, PREFERRED_TOTAL_MINUTES);
  const continuousWanted = Math.max(needed, PREFERRED_CONTINUOUS_MINUTES);
  for (const night of nights) {
    const from = Math.max(start, night.start, employee.start ?? start);
    const to = Math.min(end, night.end, employee.end ?? end);
    if (to <= from || !overlap({ start: from, end: to }, { start: lo, end: hi })) continue;
    const before = measureRest(shifts, from, to);
    const after = measureRest([...shifts, { start: lo, end: hi }], from, to);
    cost[0] += Math.min(needed, before.total) - Math.min(needed, after.total);
    cost[1] += Math.min(totalWanted, before.total) - Math.min(totalWanted, after.total);
    cost[2] += Math.min(continuousWanted, before.longest) - Math.min(continuousWanted, after.longest);
  }
  return cost;
}

/**
 * Per-employee, per-night total and continuous rest in minutes, alongside the
 * configured minimum. Pure reporting - the planner and the findings panel read
 * actual shortfalls from here rather than re-deriving them, and proposals
 * quote a driver's before/after impact from it.
 */
export function restMetrics(shifts, employees, tags, nights, start, end, sleepable = new Set()) {
  const out = [];
  for (const e of employees) {
    const needed = target(e, tags);
    if (!needed) continue;
    const own = shifts.filter((s) => s.employeeId === e.id && !sleepable.has(s.missionId));
    for (const night of nights) {
      const lo = Math.max(start, night.start), hi = Math.min(end, night.end);
      if (hi <= lo) continue;
      const { total, longest } = measureRest(own, Math.max(lo, e.start ?? lo), Math.min(hi, e.end ?? hi));
      out.push({ employeeId: e.id, start: lo, end: hi, needed, totalMinutes: total, longestMinutes: longest });
    }
  }
  return out;
}

/** Total minutes by which employees fall short of their configured minimum. */
export function restDeficit(metrics) {
  return metrics.reduce((sum, m) => sum + Math.max(0, m.needed - m.totalMinutes), 0);
}

/**
 * Measure total off-duty time in the final output, never a promised
 * block. `sleepable` holds the ids of on-call missions: duty on one can be
 * slept through, so it does not interrupt the rest being measured here.
 */
export function assessRest(shifts, employees, tags, nights, start, end, sleepable = new Set()) {
  const out = [];
  for (const e of employees) {
    const needed = target(e, tags);
    if (!needed) continue;
    const own = shifts.filter((s) => s.employeeId === e.id && !sleepable.has(s.missionId))
      .sort((a, b) => a.start - b.start);
    for (const night of nights) {
      const lo = Math.max(start, night.start), hi = Math.min(end, night.end);
      if (hi <= lo) continue;
      const { total, longest } = measureRest(own, Math.max(lo, e.start ?? lo), Math.min(hi, e.end ?? hi));
      const partial = lo !== night.start || hi !== night.end || (e.start ?? start) > lo || (e.end ?? end) < hi;
      if (partial || total < needed) out.push({ code: partial ? 'rest-incomplete' : 'rest-unsatisfied', employeeId: e.id,
        start: lo, end: hi, needed, got: total, longestMinutes: longest });
    }
  }
  return out;
}
