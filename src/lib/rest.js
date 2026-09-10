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

/** Measure continuous off-duty time in the final output, never a promised block. */
export function assessRest(shifts, employees, tags, nights, start, end) {
  const out = [];
  for (const e of employees) {
    const needed = target(e, tags);
    if (!needed) continue;
    const own = shifts.filter((s) => s.employeeId === e.id).sort((a, b) => a.start - b.start);
    for (const night of nights) {
      const lo = Math.max(start, night.start), hi = Math.min(end, night.end);
      if (hi <= lo) continue;
      let cursor = lo, longest = 0;
      for (const s of own) {
        if (!overlap(s, { start: lo, end: hi })) continue;
        longest = Math.max(longest, s.start - cursor);
        cursor = Math.max(cursor, Math.min(hi, s.end));
      }
      longest = Math.max(longest, hi - cursor) / MINUTE;
      const partial = lo !== night.start || hi !== night.end || (e.start ?? start) > lo || (e.end ?? end) < hi;
      if (partial || longest < needed) out.push({ code: partial ? 'rest-incomplete' : 'rest-unsatisfied', employeeId: e.id,
        start: lo, end: hi, needed, got: longest });
    }
  }
  return out;
}
