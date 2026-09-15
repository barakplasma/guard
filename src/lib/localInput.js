/**
 * Conversions between the document's absolute instants / wall-clock minutes and
 * the strings a native `datetime-local` or `time` input speaks.
 *
 * Pure and DOM-free so the arithmetic is unit-testable. A native input's value
 * is *always* `HH:mm` on a 24-hour clock, whatever the device shows the user -
 * which is the point of using one. The 12-hour picker it replaced counted hours
 * inside their own half of the day, so stepping 12:00 back three hours landed
 * on 21:00, and the plan quietly jumped nine hours forward.
 *
 * Both directions are local-calendar, matching the rest of the app: a plan is
 * read in the viewer's timezone (ADR 003).
 */

const pad = (n) => String(n).padStart(2, '0');

/** Epoch ms -> "YYYY-MM-DDTHH:mm" in the viewer's timezone. */
export function toLocalDateTimeInput(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "YYYY-MM-DDTHH:mm" -> epoch ms, or `null` while the value is incomplete.
 *
 * Built from local calendar parts rather than `Date.parse`, which reads some
 * shapes as UTC. Seconds and milliseconds are dropped: the document stores
 * minutes, and a stray second would make two identical-looking plans differ.
 */
export function fromLocalDateTimeInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const [, year, month, day, hour, minute] = m;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/** Minutes past midnight -> "HH:mm". */
export function toClockInput(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '';
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** "HH:mm" -> minutes past midnight, or `null` while the value is incomplete. */
export function fromClockInput(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}
