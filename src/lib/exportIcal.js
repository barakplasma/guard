import { groupAgenda } from './agenda.js';

const CRLF = '\r\n';
const FOLD_LIMIT = 75;
const pad = (n) => String(n).padStart(2, '0');

/** Escape text per RFC 5545 §3.3.11 - backslash, semicolon, comma, newline. */
function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Fold a content line at 75 octets (CRLF + single space continuation), never
 * splitting inside a multi-byte UTF-8 sequence - required because mission and
 * employee names are Hebrew, where every character is multiple octets.
 */
function foldLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= FOLD_LIMIT) return line;

  const decoder = new TextDecoder();
  const parts = [];
  let i = 0;
  let limit = FOLD_LIMIT;
  while (i < bytes.length) {
    let end = Math.min(i + limit, bytes.length);
    while (end > i && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(decoder.decode(bytes.slice(i, end)));
    i = end;
    limit = FOLD_LIMIT - 1; // continuation lines lose one octet to the leading space
  }
  return parts.map((p, idx) => (idx === 0 ? p : ` ${p}`)).join(CRLF);
}

/** epoch ms -> "YYYYMMDDTHHMMSSZ", timezone-independent like the rest of the app's storage. */
function formatIcsDateUTC(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
    + `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function buildEvent({ uid, dtstamp, start, end, summary, description }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDateUTC(dtstamp)}`,
    `DTSTART:${formatIcsDateUTC(start)}`,
    `DTEND:${formatIcsDateUTC(end)}`,
    `SUMMARY:${escapeText(summary)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  lines.push('END:VEVENT');
  return lines;
}

function buildCalendar(calName, eventGroups) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//guard//shift-planner//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (calName) lines.push(`X-WR-CALNAME:${escapeText(calName)}`);
  for (const group of eventGroups) lines.push(...group);
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/**
 * ICS calendar for one employee: one VEVENT per shift of theirs, titled with the
 * mission name. The description lists whoever else is on the same mission during
 * that same shift, so "who am I working with" survives an import into a phone
 * calendar with no access to the app.
 *
 * @param {object} result - the planner engine's output
 * @param {object} options
 * @param {string} options.employeeId
 * @param {string} options.employeeName - used as the calendar name, not per-event
 * @param {string} [options.title] - plan title, prefixed to the calendar name
 * @param {number} [options.now] - DTSTAMP instant; defaults to the real clock
 */
export function employeeIcs(result, { employeeId, employeeName, title = '', now = Date.now() } = {}) {
  const events = [];
  for (const day of groupAgenda(result)) {
    for (const slot of day.slots) {
      for (const mission of slot.missions) {
        const mine = mission.entries.find((e) => e.employeeId === employeeId);
        if (!mine) continue;
        const others = mission.entries
          .filter((e) => e.employeeId !== employeeId)
          .map((e) => e.employeeName)
          .join(', ');
        events.push(buildEvent({
          uid: `${mine.missionId}-${employeeId}-${mine.start}@guard.shifts`,
          dtstamp: now,
          start: mine.start,
          end: mine.end,
          summary: mine.missionName,
          description: others,
        }));
      }
    }
  }
  const calName = title.trim() ? `${title.trim()} — ${employeeName}` : employeeName;
  return buildCalendar(calName, events);
}

/**
 * ICS calendar for a manager: one VEVENT per mission per shift, titled with the
 * mission name, listing everyone assigned to it in the description.
 *
 * @param {object} result - the planner engine's output
 * @param {object} [options]
 * @param {string} [options.title] - plan title, used as the calendar name
 * @param {number} [options.now] - DTSTAMP instant; defaults to the real clock
 */
export function overviewIcs(result, { title = '', now = Date.now() } = {}) {
  const events = [];
  for (const day of groupAgenda(result)) {
    for (const slot of day.slots) {
      for (const mission of slot.missions) {
        const people = mission.entries.map((e) => e.employeeName).join(', ');
        events.push(buildEvent({
          uid: `${mission.missionId}-${slot.start}-${slot.end}@guard.shifts`,
          dtstamp: now,
          start: slot.start,
          end: slot.end,
          summary: mission.missionName,
          description: people,
        }));
      }
    }
  }
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
