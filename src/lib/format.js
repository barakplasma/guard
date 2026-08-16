/**
 * Formatting helpers. Times are stored as absolute instants (epoch ms) and
 * always rendered in the *viewer's* timezone, so a shared link is correct for
 * whoever opens it rather than only for whoever made it.
 */

const LOCALE = 'he-IL';

const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const dayFmt = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'long', day: 'numeric', month: 'long',
});

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  year: 'numeric', month: '2-digit', day: '2-digit',
});

const shortDayFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'numeric' });

export const formatTime = (ms) => timeFmt.format(new Date(ms));
export const formatDay = (ms) => dayFmt.format(new Date(ms));
export const formatDate = (ms) => dateFmt.format(new Date(ms));

const timeFmtShort = new Intl.DateTimeFormat(LOCALE, {
  hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
});

/** "7:00" rather than "07:00" - the unpadded style the WhatsApp table export uses. */
export const formatTimeShort = (ms) => timeFmtShort.format(new Date(ms));

/** Like `formatRange`, but with `formatTimeShort` - same midnight-crossing suffix, shorter hours. */
export function formatRangeShort(start, end) {
  const from = formatTimeShort(start);
  const to = formatTimeShort(end);
  return dayKey(start) === dayKey(end) ? `${from}–${to}` : `${from}–${to} (${shortDayFmt.format(new Date(end))})`;
}

/**
 * A time range, with the end date appended when the range crosses midnight.
 * Without this a 24-hour remote mission reads as "22:00–22:00", which looks
 * like a zero-length shift rather than a full day on duty.
 */
export function formatRange(start, end) {
  const [from, to] = formatRangeLines(start, end);
  return `${from}–${to}`;
}

/**
 * The same range split in two, for the narrow time gutter of the portrait
 * agenda. The end keeps its date suffix: stacked without it, a 24-hour mission
 * reads as `22:00` over `22:00`, which is the zero-length-shift confusion the
 * suffix exists to prevent.
 */
export function formatRangeLines(start, end) {
  const to = formatTime(end);
  return [
    formatTime(start),
    dayKey(start) === dayKey(end) ? to : `${to} (${shortDayFmt.format(new Date(end))})`,
  ];
}

/** Local midnight of the day containing `ms` - the grouping key for the agenda. */
export function dayKey(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "3:30" style duration, for totals tables. */
export function formatDuration(minutes) {
  const sign = minutes < 0 ? '-' : '';
  const total = Math.round(Math.abs(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${sign}${h}:${String(m).padStart(2, '0')}`;
}

/* --- <input type="datetime-local"> bridging -------------------------- */

const pad = (n) => String(n).padStart(2, '0');

/** epoch ms -> "YYYY-MM-DDTHH:mm" in local time (what the input expects). */
export function toLocalInput(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" in local time -> epoch ms, or null if unparseable. */
export function fromLocalInput(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
