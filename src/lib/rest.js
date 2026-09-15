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

/** Added total-rest deficit first, then added continuous-rest deficit. */
export function restCost(employee, tags, nights, shifts, start, end, lo, hi) {
  const needed = target(employee, tags);
  const cost = [0, 0];
  if (!needed) return cost;
  for (const night of nights) {
    const from = Math.max(start, night.start, employee.start ?? start);
    const to = Math.min(end, night.end, employee.end ?? end);
    if (to <= from || !overlap({ start: from, end: to }, { start: lo, end: hi })) continue;
    const before = measureRest(shifts, from, to);
    const after = measureRest([...shifts, { start: lo, end: hi }], from, to);
    cost[0] += Math.min(needed, before.total) - Math.min(needed, after.total);
    cost[1] += Math.min(needed, before.longest) - Math.min(needed, after.longest);
  }
  return cost;
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
