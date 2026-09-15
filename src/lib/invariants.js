const assignmentKey = (s) => `${s.employeeId}|${s.missionId}`;

/**
 * Do `intervals` cover every instant of `[from, to)` between them?
 *
 * Union, not containment. Both callers below deal in stretches the engine
 * reports or fills a piece at a time - a shortage is warned per grid segment,
 * and a local pin is emitted as one row per segment - so asking any single
 * interval to span the whole thing fails on correct output.
 */
function coversFully(intervals, from, to) {
  let cursor = from;
  for (const i of [...intervals].sort((a, b) => a.start - b.start)) {
    if (i.start > cursor) break;
    cursor = Math.max(cursor, i.end);
    if (cursor >= to) return true;
  }
  return cursor >= to;
}
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
    if (!s.pinned && (m.excludeEmployees ?? []).includes(e.id)) report('EXCLUDED_EMPLOYEE', details);
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
    // Every mission that is *running* here, not just the ones with somebody on
    // them. Checking `counts` alone is how an empty schedule slips through: a
    // mission nobody was assigned to contributes no entry, so an under-staffed
    // instant with zero people looks like no instant at all.
    if (next > (input.loggedBefore ?? -Infinity)) {
      const night = (input.nightWindows ?? []).some((w) => at >= w.start && at < w.end);
      for (const m of input.missions) {
        // The instant comes from the global edge list, so it can run past this
        // mission's own end - an unrelated availability edge at 31 minutes
        // against a mission ending at 30. Clamp to the mission's window before
        // asking whether a warning covers it, or a correct `understaffed` over
        // the mission's real extent reads as uncovered.
        // A missing bound inherits the plan's, the same way it does everywhere
        // else in the document. The engine normalizes these before we see them,
        // but the unit fixtures do not, and `Math.max(at, undefined)` is NaN -
        // which silently skips every comparison below rather than failing.
        const windows = m.type === 'daily'
          ? (m.occurrences ?? [])
          : [{ start: m.start ?? input.start, end: m.end ?? input.end }];
        for (const w of windows) {
          const from = Math.max(at, w.start);
          const to = Math.min(next, w.end);
          if (to <= from) continue;
          const want = m.type === 'local' && night ? m.nightCount ?? m.count : m.count;
          const got = counts.get(m.id) ?? 0;
          if (got >= want) continue;
          // Short is legal - there may genuinely not be enough people. Silent
          // is not. `understaffed` has to name this mission over this stretch,
          // or the schedule is lying about what it delivered. This is the check
          // an empty schedule cannot pass.
          const reported = coversFully(
            (result.warnings ?? []).filter((x) => x.code === 'understaffed' && x.missionId === m.id),
            from, to,
          );
          if (!reported) report('UNREPORTED_SHORTFALL', { missionId: m.id, start: from, end: to, want, got });
        }
      }
    }

    while (ti < result.timeline.length && result.timeline[ti].end <= at) ti++;
    const seg = result.timeline[ti];
    const actual = [...active].map(assignmentKey).sort();
    const listed = (seg?.onDuty ?? []).map(assignmentKey).sort();
    if (!seg || seg.start > at || seg.end < next || actual.length !== listed.length || actual.some((v, j) => v !== listed[j])) report('TIMELINE_MISMATCH', { start: at, end: next });
  }

  // Every pin the engine *accepted* has to be in the output. `input.pins` here
  // is the normalized set - whatever `normalizePins` rejected is already gone,
  // with a warning naming it - so anything still in this list is an assignment
  // a person made and the schedule promised to honour. Dropping one silently is
  // the worst failure this module can catch, because the URL still shows the
  // assignment and the agenda does not.
  for (const pin of input.pins ?? []) {
    const covering = result.shifts.filter((s) => s.missionId === pin.missionId
      && s.employeeId === pin.employeeId && s.end > pin.start && s.start < pin.end);
    if (!coversFully(covering, pin.start, pin.end)) {
      report('PIN_DROPPED', {
        missionId: pin.missionId, employeeId: pin.employeeId, start: pin.start, end: pin.end,
      });
    }
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
