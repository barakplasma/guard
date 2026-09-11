import { topOfHour } from './planSchema.js';

const HOUR = 60 * 60 * 1000;

/** The top of this hour, or the next one if we are past it. Exact hours stay put. */
const ceilToHour = (ms) => (topOfHour(ms) === ms ? ms : topOfHour(ms) + HOUR);

/**
 * The slice of the schedule a share carries.
 *
 * Sending the whole plan means sending history: whoever reads the message on
 * their phone needs the shift starting now and the ones after it, not the
 * three days already worked. So a share reaches a little way back - far enough
 * that the shift currently on post is in it - and no more than a day forward.
 *
 * Pure, and outside the components, so the rule is testable and the WhatsApp
 * message and the calendar files can never disagree about what "the next 24
 * hours" means.
 */

/** The most one share carries. */
export const SHARE_WINDOW_MS = 24 * HOUR;

/** How far back a share reaches by default, before rounding to the hour. */
export const SHARE_LOOKBACK_MS = 3 * HOUR;

/**
 * Where a share starts when nobody has chosen: three hours back from the top of
 * the *coming* hour, so the window lands on the boundaries the shifts do and
 * never reaches further back than it said it would. Rounding the other way
 * makes "three hours" mean anything up to four.
 *
 * Clamped into the plan, which matters more than it looks: a rota written for
 * next week has nothing at all in the three hours around now, and a share
 * defaulting there would copy an empty message.
 */
export function defaultShareFrom({ start, end }, now = Date.now()) {
  const back = ceilToHour(now) - SHARE_LOOKBACK_MS;
  if (back < start || back > end) return start;
  return back;
}

/**
 * The same engine result carrying only the shifts that overlap `[from, to)`.
 *
 * Overlap, not containment: the shift that began twenty minutes before the
 * window is the one on post right now, and dropping it would make the share
 * open on an empty hour. The rest of the result rides along untouched - the
 * exports read `shifts` and nothing else.
 */
export function clipResult(result, from, to) {
  if (!result || (from == null && to == null)) return result;
  return {
    ...result,
    shifts: result.shifts.filter((s) => (to == null || s.start < to) && (from == null || s.end > from)),
  };
}
