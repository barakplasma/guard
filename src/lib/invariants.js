const assignmentKey = (s) => `${s.employeeId}|${s.missionId}`;
function stretches(input) {
  const nights = [];
  for (const w of [...(input.nightWindows ?? [])].sort((a, b) => a.start - b.start)) {
    const start = Math.max(input.start, w.start), end = Math.min(input.end, w.end);
    if (end <= start) continue;
    const prev = nights.at(-1);
    if (prev && start <= prev.end) prev.end = Math.max(prev.end, end);
    else nights.push({ start, end, night: true });
  }
  const all = [];
  let cursor = input.start;
  for (const w of nights) {
    if (w.start > cursor) all.push({ start: cursor, end: w.start, night: false });
    all.push(w); cursor = w.end;
  }
  if (cursor < input.end) all.push({ start: cursor, end: input.end, night: false });
  return all;
}
/** Pure output validation. Sweep actual rows independently of the timeline. */
export function checkSchedule(result, input) {
  const violations = [];
  const report = (rule, details = {}) => violations.push({ rule, ...details });
  const missions = new Map(input.missions.map((m) => [m.id, m]));
  const employees = new Map(input.employees.map((e) => [e.id, e]));
  const spans = stretches(input);
  // Independent of the planner's segmentation: every internal edge must have
  // a hard scheduling reason. Soft preferences cannot create rotation turns.
  const sharedEdges = input.employees.flatMap((e) => [e.start, e.end]);
  for (const m of input.missions) if (m.type === 'daily') {
    for (const w of m.occurrences ?? []) sharedEdges.push(w.start, w.end);
  }
  const allowedEdges = new Map(input.missions.map((m) => [m.id, new Set([
    input.start, input.end, m.start, m.end, ...sharedEdges,
    ...(input.pins ?? []).filter((p) => p.missionId === m.id).flatMap((p) => [p.start, p.end]),
    ...((m.nightCount ?? m.count) === m.count ? [] : (input.nightWindows ?? []).flatMap((w) => [w.start, w.end])),
  ])]));
  const events = new Map();
  const edge = (at) => { if (!events.has(at)) events.set(at, { add: [], remove: [] }); return events.get(at); };
  edge(input.start); edge(input.end);
  for (const w of input.nightWindows ?? []) { edge(w.start); edge(w.end); }
  for (const s of result.shifts) {
    const m = missions.get(s.missionId), e = employees.get(s.employeeId);
    const details = { missionId: s.missionId, employeeId: s.employeeId, start: s.start, end: s.end };
    if (!m || !e || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.end <= s.start) {
      report('INVALID_ROW', details); continue;
    }
    const lo = Math.max(input.start, m.start ?? input.start), hi = Math.min(input.end, m.end ?? input.end);
    if (s.start < lo || s.end > hi) report('OUTSIDE_MISSION_WINDOW', details);
    if (!s.pinned && (s.start < (e.start ?? input.start) || s.end > (e.end ?? input.end))) report('OUTSIDE_AVAILABILITY', details);
    if ((s.qualifications ?? []).some((tag) => !(e.tags ?? []).includes(tag))) report('FALSE_QUALIFICATION', details);
    if (!s.pinned && (m.excludes ?? []).some((tag) => (e.tags ?? []).includes(tag))) report('EXCLUDED_QUALIFICATION', details);
    if (m.type === 'remote' && (s.start !== lo || s.end !== hi)) report('REMOTE_NOT_WHOLE', details);
    if (m.type === 'daily' && !(m.occurrences ?? []).some((w) => s.start === Math.max(lo, w.start) && s.end === Math.min(hi, w.end))) report('DAILY_NOT_WHOLE', details);
    if (m.type === 'local') {
      const day = m.shiftMinutes ?? input.shiftMinutes, night = m.nightShiftMinutes ?? day;
      const span = day === night ? { start: input.start, end: input.end, night: false }
        : spans.find((w) => w.start <= s.start && w.end > s.start);
      const step = (span?.night ? night : day) * 60000;
      const slotStart = span ? span.start + Math.floor((s.start - span.start) / step) * step : NaN;
      const slotEnd = Math.min(span?.end ?? NaN, slotStart + step);
      if (s.slotStart !== slotStart || s.slotEnd !== slotEnd || s.start < slotStart || s.end > slotEnd) report('ROW_EXCEEDS_SLOT', details);
      if ([s.start, s.end].some((at) => at !== slotStart && at !== slotEnd && !allowedEdges.get(m.id).has(at))) {
        report('UNEXPECTED_SHIFT_BOUNDARY', details);
      }
    }
    edge(s.start).add.push(s); edge(s.end).remove.push(s);
  }
  let previous = input.start;
  for (const seg of result.timeline) {
    if (seg.start !== previous || seg.end <= seg.start || seg.end > input.end) report('TIMELINE_GAP', { start: seg.start, end: seg.end });
    previous = seg.end; edge(seg.start); edge(seg.end);
  }
  if (previous !== input.end) report('TIMELINE_GAP');
  const active = new Set();
  const times = [...events.keys()].sort((a, b) => a - b);
  let ti = 0;
  for (let i = 0; i < times.length - 1; i++) {
    const at = times[i], next = times[i + 1], event = events.get(at);
    for (const s of event.remove) active.delete(s);
    for (const s of event.add) active.add(s);
    if (at < input.start || at >= input.end) continue;
    const people = new Map(), counts = new Map();
    for (const s of active) {
      if (people.has(s.employeeId)) report('DOUBLE_BOOKED', { employeeId: s.employeeId, missionId: s.missionId, otherMissionId: people.get(s.employeeId), start: at, end: next });
      people.set(s.employeeId, s.missionId);
      counts.set(s.missionId, (counts.get(s.missionId) ?? 0) + 1);
    }
    for (const [id, count] of counts) {
      const m = missions.get(id);
      const night = (input.nightWindows ?? []).some((w) => at >= w.start && at < w.end);
      const capacity = m.type === 'local' && night ? m.nightCount ?? m.count : m.count;
      // Elapsed time is the log, and the log can legitimately hold more people
      // than the mission's *current* headcount - somebody lowered it after the
      // fact. Capacity is only a rule about time still to be scheduled.
      const logged = next <= (input.loggedBefore ?? -Infinity);
      if (!logged && count > capacity) report('OVERSTAFFED', { missionId: id, start: at, end: next });
    }
    while (ti < result.timeline.length && result.timeline[ti].end <= at) ti++;
    const seg = result.timeline[ti];
    const actual = [...active].map(assignmentKey).sort();
    const listed = (seg?.onDuty ?? []).map(assignmentKey).sort();
    if (!seg || seg.start > at || seg.end < next || actual.length !== listed.length || actual.some((v, j) => v !== listed[j])) report('TIMELINE_MISMATCH', { start: at, end: next });
  }
  return violations;
}

/** Strict callers never receive invalid output; report mode preserves evidence. */
export function validateSchedule(result, input, mode = 'throw') {
  if (!['throw', 'report'].includes(mode)) throw new Error('Unknown invariant violation mode.');
  const violations = checkSchedule(result, input);
  if (violations.length && mode === 'throw') {
    const v = violations[0];
    throw new Error(`Engine invariant ${v.rule}: ${JSON.stringify(v)}. This is a bug in the scheduler.`);
  }
  result.warnings.push(...violations.map((v) => ({ code: 'engine-bug', ...v })), ...qualityWarnings(result.shifts, input));
  return result;
}

/** Aggregated quality findings: a pin breaks the automatic-duty run. */
export function qualityWarnings(shifts, input) {
  const byEmployee = new Map();
  for (const s of shifts) {
    if (!byEmployee.has(s.employeeId)) byEmployee.set(s.employeeId, []);
    byEmployee.get(s.employeeId).push(s);
  }
  const out = [];
  const turns = new Map([...byEmployee].map(([id, rows]) => [id,
    new Set(rows.map((s) => `${s.missionId}|${s.slotStart}`)).size]));
  const average = input?.employees.length ? [...turns.values()].reduce((n, count) => n + count, 0) / input.employees.length : Infinity;
  const missions = new Map((input?.missions ?? []).map((m) => [m.id, m]));
  for (const [employeeId, rows] of byEmployee) {
    const count = turns.get(employeeId);
    if (count >= 3 && count > 2 * average) out.push({ code: 'workload-outlier', employeeId, count, average });
    for (const s of rows) {
      const mission = missions.get(s.missionId);
      if (s.type !== 'local' || !mission) continue;
      const day = mission.shiftMinutes ?? input.shiftMinutes;
      const night = (input.nightWindows ?? []).some((w) => s.start >= w.start && s.start < w.end);
      const expectedMinutes = night ? mission.nightShiftMinutes ?? day : day;
      const actualMinutes = (s.end - s.start) / 60000;
      if (!Number.isFinite(actualMinutes) || actualMinutes <= 0) continue;
      if (actualMinutes !== expectedMinutes) out.push({ code: actualMinutes < expectedMinutes ? 'short-shift' : 'long-shift',
        missionId: s.missionId, employeeId, start: s.start, end: s.end, actualMinutes, expectedMinutes, count: 1 });
    }
    rows.sort((a, b) => a.start - b.start || a.end - b.end);
    let prev = null, run = new Set(), longest = 0, adjacent = 0, same = 0;
    for (const s of rows) {
      if (s.pinned) { prev = null; run = new Set(); continue; }
      const key = s.type === 'local' ? `local:${s.slotStart}` : `${s.missionId}:${s.slotStart}`;
      if (prev && prev.end === s.start) {
        const sameSlot = prev.missionId === s.missionId && prev.slotStart === s.slotStart;
        if (!sameSlot) { adjacent++; if (prev.missionId === s.missionId) same++; }
      } else run = new Set();
      run.add(key); longest = Math.max(longest, run.size); prev = s;
    }
    if (adjacent) out.push({ code: 'no-rest-between-shifts', employeeId, count: adjacent });
    if (same) out.push({ code: 'same-mission-consecutive', employeeId, count: same });
    if (longest >= 3) out.push({ code: 'long-unbroken-run', employeeId, count: longest });
  }
  return out;
}
