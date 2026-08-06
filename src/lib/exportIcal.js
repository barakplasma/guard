import { createEvents } from 'ics';

/**
 * A short, deterministic fingerprint of the plan's actual output. Mission and
 * employee ids are only unique *within* one plan (fresh documents both start
 * numbering at "m1"/"e1"), so two unrelated plans covering the same instant
 * would otherwise mint identical UIDs - and calendar clients treat UID as
 * event identity, so importing the second plan could silently overwrite or
 * merge with the first. Hashing the full assignment list ties every UID to
 * the plan that produced it, while staying stable across re-exports of the
 * same, unchanged plan.
 */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function planFingerprint(result) {
  // Names, not just ids, because two unrelated plans can easily share both
  // ids (fresh documents both start numbering at "m1"/"e1") *and* an absolute
  // time window (the same recurring slot, week over week) - names are what
  // actually distinguishes them in that case.
  const key = result.shifts
    .map((s) => `${s.missionId}|${s.missionName}|${s.employeeId}|${s.employeeName}|${s.start}|${s.end}`)
    .join(';');
  return fnv1a(key);
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

const sameRoster = (a, b) => a.length === b.length
  && new Set(a.map((r) => r.employeeId)).size === new Set([...a, ...b].map((r) => r.employeeId)).size;

/**
 * Slice one mission's own rows into maximal, non-overlapping intervals with a
 * stable roster - at every boundary where someone starts or stops, whoever is
 * covering that instant is recomputed, so two coworkers with staggered start
 * times (a pin covering the whole mission plus an auto-assigned neighbour who
 * is only available for part of it) each show up exactly where they overlap
 * rather than in two disjoint, single-person events. Adjacent slices with an
 * identical roster are merged back together, mirroring the engine's own
 * mergeRows so a single steady roster still yields one event, not several.
 */
function missionSlices(rows) {
  const boundaries = [...new Set(rows.flatMap((r) => [r.start, r.end]))].sort((a, b) => a - b);
  const slices = [];
  for (let i = 1; i < boundaries.length; i++) {
    const segStart = boundaries[i - 1];
    const segEnd = boundaries[i];
    const covering = rows.filter((r) => r.start <= segStart && r.end >= segEnd);
    if (covering.length === 0) continue;
    slices.push({ start: segStart, end: segEnd, rows: covering });
  }

  const merged = [];
  for (const slice of slices) {
    const prev = merged[merged.length - 1];
    if (prev && prev.end === slice.start && sameRoster(prev.rows, slice.rows)) {
      prev.end = slice.end;
    } else {
      merged.push({ ...slice });
    }
  }
  return merged;
}

/**
 * One event description for the `ics` library. Times are passed as raw
 * epoch-ms with `*InputType/*OutputType: 'utc'`, which `ics` reads with
 * `Date#getUTC*` - exactly the timezone-independent absolute instant the rest
 * of the app already stores, so DTSTART/DTEND come out correct regardless of
 * which timezone generates or opens the file.
 */
function toIcsEvent({ uid, dtstamp, start, end, title, description }) {
  return {
    uid,
    // `timestamp` drives DTSTAMP; it isn't in `ics`'s public TS type but is a
    // real, honoured field - without it every export would carry the real
    // wall-clock time, breaking byte-for-byte reproducibility of re-exports.
    timestamp: dtstamp,
    title,
    description: description || undefined,
    start,
    end,
    startInputType: 'utc',
    startOutputType: 'utc',
    endInputType: 'utc',
    endOutputType: 'utc',
  };
}

function buildCalendar(calName, events) {
  const { error, value } = createEvents(events, calName ? { calName } : {});
  if (error) throw error;
  return value;
}

/**
 * ICS calendar for one employee: one VEVENT per shift of theirs, titled with the
 * mission name. The description lists whoever else is on the same mission at any
 * point during that shift - found by genuine time overlap against every other row
 * on the mission, not by matching the shift's exact (start, end) pair. A pin can
 * cover a mission for a custom range while an auto-generated neighbour only fills
 * part of it (say, someone's availability starts mid-shift), so two coworkers on
 * the same mission at the same moment can easily have different row boundaries.
 *
 * @param {object} result - the planner engine's output
 * @param {object} options
 * @param {string} options.employeeId
 * @param {string} options.employeeName - used as the calendar name, not per-event
 * @param {string} [options.title] - plan title, prefixed to the calendar name
 * @param {number} [options.now] - DTSTAMP instant; defaults to the real clock
 */
export function employeeIcs(result, { employeeId, employeeName, title = '', now = Date.now() } = {}) {
  const planId = planFingerprint(result);
  const mine = result.shifts
    .filter((s) => s.employeeId === employeeId)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const events = mine.map((shift) => {
    const others = result.shifts
      .filter((s) => s.missionId === shift.missionId && s.employeeId !== employeeId
        && overlaps(s.start, s.end, shift.start, shift.end))
      .map((s) => s.employeeName);
    return toIcsEvent({
      uid: `${planId}-${shift.missionId}-${employeeId}-${shift.start}@guard.shifts`,
      dtstamp: now,
      start: shift.start,
      end: shift.end,
      title: shift.missionName,
      description: [...new Set(others)].join(', '),
    });
  });

  const calName = title.trim() ? `${title.trim()} — ${employeeName}` : employeeName;
  return buildCalendar(calName, events);
}

/**
 * ICS calendar for a manager: one VEVENT per mission per continuously-staffed
 * interval, listing everyone assigned to it in the description. Missions are
 * sliced independently of each other (and of the shared shift-length grid), so
 * a mission whose own assignments have staggered boundaries still produces
 * accurate, non-overlapping events instead of duplicated ones that each
 * undercount who was actually on duty.
 *
 * @param {object} result - the planner engine's output
 * @param {object} [options]
 * @param {string} [options.title] - plan title, used as the calendar name
 * @param {number} [options.now] - DTSTAMP instant; defaults to the real clock
 */
export function overviewIcs(result, { title = '', now = Date.now() } = {}) {
  const planId = planFingerprint(result);
  const byMission = new Map();
  for (const s of result.shifts) {
    if (!byMission.has(s.missionId)) byMission.set(s.missionId, []);
    byMission.get(s.missionId).push(s);
  }

  const slices = [];
  for (const [missionId, rows] of byMission) {
    for (const slice of missionSlices(rows)) slices.push({ missionId, ...slice });
  }
  // Chronological order, same as the on-screen agenda - the file has no
  // ordering requirement, but a readable one is nicer to skim.
  slices.sort((a, b) => a.start - b.start || a.end - b.end
    || (a.missionId < b.missionId ? -1 : a.missionId > b.missionId ? 1 : 0));

  const events = slices.map((slice) => toIcsEvent({
    uid: `${planId}-${slice.missionId}-${slice.start}-${slice.end}@guard.shifts`,
    dtstamp: now,
    start: slice.start,
    end: slice.end,
    title: slice.rows[0].missionName,
    description: slice.rows.map((r) => r.employeeName).join(', '),
  }));
  return buildCalendar(title.trim() || 'סידור משמרות', events);
}

/** Trigger a browser download of `text` as `filename`. */
export function downloadIcs(text, filename = 'shifts.ics') {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
