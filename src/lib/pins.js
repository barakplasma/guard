/**
 * Pin-list edits.
 *
 * Pure functions over the plan document's `pins` array, kept out of the React
 * context so they can be tested directly - the swap rule below is subtle enough
 * that it shipped a bug when it lived inline in a hook.
 *
 * A pin's `start`/`end` may be null, meaning "inherit the mission's window"
 * (and a mission's null window inherits the plan's). So a whole-mission
 * assignment and a per-shift assignment can refer to the same stretch of time
 * while looking nothing alike, and any edit keyed on the literal range will
 * miss one of them.
 */

import { plan as runPlanner, isOutOfPeriod, resolvePinWindow } from './planner.js';
import { toPlannerInput, dailyOccurrences } from './planSchema.js';

/** Resolve a pin's effective range, following the null-inheritance chain. */
export function pinRange(doc, pin) {
  const mission = doc.missions.find((m) => m.id === pin.missionId);
  return resolvePinWindow(pin, mission, doc.start, doc.end);
}

/** Does `pin` cover the whole of `[start, end)`? */
export function pinCovers(doc, pin, start, end) {
  const range = pinRange(doc, pin);
  const mission = doc.missions.find((m) => m.id === pin.missionId);
  if (mission?.type === 'daily') {
    return dailyOccurrences(doc, mission).some((w) => w.start <= start && w.end >= end
      && range.start < w.end && range.end > w.start);
  }
  return range.start <= start && range.end >= end;
}

/**
 * Whatever is left of `pin` once `[start, end)` is taken out of it: nothing
 * when the pin covered exactly that range, one pin when the range sits at one
 * of its ends, two when it is cut out of the middle.
 *
 * The bound that was not cut is kept **as written**, not as resolved: a pin
 * with `start: null` keeps `start: null` on its leading remainder, so that
 * remainder still follows the mission's window if the mission is later moved.
 * Only the cut bound becomes a literal instant, because that is the one thing
 * about the pin that is now a fact of its own rather than an inheritance.
 * Everything else on the pin - `frozen` above all - rides along unchanged, so
 * cutting a frozen pin yields frozen remainders.
 */
export function cutPin(doc, pin, start, end) {
  const range = pinRange(doc, pin);
  const out = [];
  if (range.start < start) out.push({ ...pin, end: start });
  if (range.end > end) out.push({ ...pin, start: end });
  return out;
}

/**
 * Record a manual swap: `employeeId` takes the shift `[start, end)` on
 * `missionId`, replacing `replacingEmployeeId`.
 *
 * The displaced person's pin must go, matched by coverage rather than exact
 * range: their assignment may be a whole-mission pin written from the Missions
 * page, which no exact-range match would find - leaving it in place means both
 * people stay pinned and compete on the next plan, so the swap either does
 * nothing (the newcomer is dropped as overflow) or quietly adds a person
 * instead of replacing one.
 *
 * It goes by being *cut*, not deleted. A local mission's pinned person now
 * appears in every shift slot they hold, each with its own swap dropdown, so
 * the range being swapped is usually a single hour of a much longer pin -
 * removing the pin whole would silently hand the rest of the week back to the
 * rotation. Only the hour actually swapped is taken away; a pin that covered
 * exactly that hour still disappears entirely, as before.
 *
 * The cut must stay scoped to `replacingEmployeeId`. A mission with more than
 * one seat can have two different people each individually pinned to the exact
 * same [start, end) - one pin per seat - and an earlier version of this
 * function matched on (missionId, start, end) alone, so swapping one seat
 * deleted the other seat's pin too. Only when the caller has no named
 * predecessor (a direct API call, not the schedule UI) do we fall back to
 * clearing whatever pin exactly held this row, since there is nothing more
 * specific to key on.
 */
export function applySwap(doc, { missionId, employeeId, start, end, replacingEmployeeId }) {
  const kept = [];
  for (const p of doc.pins) {
    const displaced = p.missionId === missionId && (replacingEmployeeId != null
      ? p.employeeId === replacingEmployeeId && pinCovers(doc, p, start, end)
      : p.start === start && p.end === end);
    if (displaced) kept.push(...cutPin(doc, p, start, end));
    else kept.push(p);
  }
  return { ...doc, pins: [...kept, { missionId, employeeId, start, end }] };
}

/**
 * Release `employeeId` from `[start, end)` of `missionId` - matching by
 * coverage, not by exact range, so the clear button also works on a
 * whole-mission assignment.
 *
 * Like a swap, this cuts rather than deletes: clearing one hour of a
 * whole-mission pin means "not this hour", not "not this week", and the
 * clear button now sits on every hour of such a pin.
 */
export function applyClearPin(doc, { missionId, employeeId, start, end }) {
  const pins = [];
  for (const p of doc.pins) {
    const held = p.missionId === missionId
      && p.employeeId === employeeId
      && pinCovers(doc, p, start, end);
    if (held) pins.push(...cutPin(doc, p, start, end));
    else pins.push(p);
  }
  return { ...doc, pins };
}

/**
 * Remove every pin naming `employeeId` on `missionId`, regardless of range.
 * For the rare warning that can't name an exact range to match on (a pin
 * clamped down to nothing by the mission's own window, e.g. `PIN_UNAVAILABLE`
 * without a `start`/`end`) - broader than `applyClearPin`, but there is
 * nothing more specific to key on, and this is only ever offered to clear a
 * pin the engine already reported as unusable.
 */
export function applyClearPinsForMission(doc, { missionId, employeeId }) {
  return {
    ...doc,
    pins: doc.pins.filter((p) => !(p.missionId === missionId && p.employeeId === employeeId)),
  };
}

/**
 * Turn every already-elapsed, auto-assigned shift in `result` into a pin, so
 * that a later edit elsewhere in the document can never reshuffle who already
 * worked a shift that is in the past. `result` must be the schedule computed
 * from `doc` itself - a shift only counts as "already decided" once the
 * engine actually produced it that way for this document.
 *
 * Returns `doc` unchanged (same reference) when there is nothing to freeze,
 * so callers can cheaply tell whether anything changed.
 *
 * This only locks in the outcome; it does not stop anyone from editing the
 * past on purpose - a frozen shift is a normal pin, swappable and clearable
 * like any other. It is marked `frozen: true` for one reason only: so a later
 * edit to someone's availability can't retroactively make the past "invalid"
 * and have the engine reshuffle it - see planner.js's normalizePins, which
 * skips the availability check for these pins specifically. Everything else
 * about a frozen pin (conflict handling, seat limits, swapping, clearing)
 * behaves exactly like a pin a person wrote by hand.
 */
export function freezePastShifts(doc, result, now) {
  if (result.warnings?.some((w) => w.code === 'engine-bug')) return doc;
  const newPins = result.shifts
    .filter((s) => !s.pinned && s.end <= now)
    .map((s) => ({
      missionId: s.missionId, employeeId: s.employeeId, start: s.start, end: s.end, frozen: true,
    }));
  if (newPins.length === 0) return doc;
  return { ...doc, pins: [...doc.pins, ...newPins] };
}

/**
 * Carry `prev`'s already-elapsed assignments forward into `next`, before
 * `next`'s own edit takes effect. This is the actual guard against the past
 * changing hands: every document mutation goes through this (`PlanContext`'s
 * `setDoc`), not just ones made from the schedule screen, so an edit on the
 * Employees or Missions page can't reshuffle history either.
 *
 * The snapshot is taken from `prev` on purpose. Freezing what `next` looks
 * like instead would immediately re-pin a shift the caller just cleared on
 * purpose - `applyClearPin`/`clearAllPins` remove a pin from `next`, but that
 * same shift is already pinned in `prev`, so `freezePastShifts` skips it
 * there and the clear survives.
 */
export function freezeElapsedBeforeEdit(prev, next, now = Date.now()) {
  if (prev.employees.length === 0 || prev.missions.length === 0) return next;
  let result;
  try {
    result = runPlanner(toPlannerInput(prev));
  } catch {
    return next;
  }
  const frozenPrev = freezePastShifts(prev, result, now);
  if (frozenPrev === prev) return next;
  const newPins = frozenPrev.pins.slice(prev.pins.length);
  return { ...next, pins: [...next.pins, ...newPins] };
}

/**
 * Record an accepted correction proposal (see lib/corrections.js).
 *
 * Every released assignment is a frozen (machine-preserved) pin: with a named
 * substitute it is recorded as a swap - the substitute's pin is explicit,
 * because a person accepted this - and without one the old pin is simply cut,
 * handing the duty back to automatic staffing. The driver's new assignment on
 * the short mission is written as its own pin. All of it travels in the URL
 * like any other edit, so a reload shows the accepted correction, not the
 * proposal again.
 *
 * Matching is by coverage and scoped to the released employee, exactly like
 * the schedule screen's swap: a frozen pin covering more than the released
 * window keeps its remainder, still frozen.
 */
export function applyCorrection(doc, proposal) {
  let next = doc;
  for (const r of proposal.release) {
    next = r.substituteId != null
      ? applySwap(next, {
        missionId: r.missionId, employeeId: r.substituteId, start: r.start, end: r.end, replacingEmployeeId: proposal.driverId,
      })
      : applyClearPin(next, { missionId: r.missionId, employeeId: proposal.driverId, start: r.start, end: r.end });
  }
  return {
    ...next,
    pins: [...next.pins, { missionId: proposal.missionId, employeeId: proposal.driverId, start: proposal.start, end: proposal.end }],
  };
}

/**
 * Set a mission's roster from the Missions page.
 *
 * The picker lists everyone holding *any* pin on the mission, because a
 * whole-mission assignment no longer stays whole: clearing or swapping one
 * shift cuts it into ranges, and someone who still works six days of seven
 * must not vanish from the roster. So ticking and unticking a name have to be
 * exact inverses of each other over that wider list:
 *
 *   - unticking removes every pin that person holds here, whole or partial -
 *     nothing else could undo a tick whose range has since been trimmed;
 *   - ticking someone with no pin at all writes them a whole-mission one;
 *   - someone who is already pinned in *some* form keeps exactly the pins they
 *     have. The picker cannot express a range, so rewriting theirs from here
 *     would silently swallow a swap or a cut. Re-assigning them to the whole
 *     mission is untick-then-tick, which reads the same way round.
 */
export function applyMissionAssignees(doc, missionId, employeeIds) {
  const selected = new Set(employeeIds);
  const kept = doc.pins.filter(
    (p) => p.missionId !== missionId || selected.has(p.employeeId),
  );
  const alreadyPinned = new Set(
    kept.filter((p) => p.missionId === missionId).map((p) => p.employeeId),
  );
  return {
    ...doc,
    pins: [
      ...kept,
      ...employeeIds
        .filter((employeeId) => !alreadyPinned.has(employeeId))
        .map((employeeId) => ({ missionId, employeeId, start: null, end: null })),
    ],
  };
}

/** Is this pin residue from a period the plan has moved past? */
function isStale(doc, pin) {
  const mission = doc.missions.find((m) => m.id === pin.missionId);
  return isOutOfPeriod(pin, mission, doc.start, doc.end);
}

/**
 * Drop every assignment that falls entirely outside the plan period.
 *
 * These accumulate on their own: each edit freezes the elapsed part of the
 * schedule into pins, and rolling the period forward leaves that history
 * behind, pointing at hours the plan no longer covers. The engine already
 * ignores them, so removing them changes no shift - it only stops the record
 * of long-finished periods riding along in the URL forever.
 *
 * This is the *explicit* cleanup, offered as a button. Deletion here is
 * irreversible - `setDoc` navigates with `replace`, so there is no history
 * entry to go back to - which is exactly why the automatic path below is much
 * more cautious than this one.
 */
export function clearStalePins(doc) {
  const pins = doc.pins.filter((p) => !isStale(doc, p));
  return pins.length === doc.pins.length ? doc : { ...doc, pins };
}

/** How many pins `clearStalePins` would remove. */
export function countStalePins(doc) {
  return doc.pins.filter((p) => isStale(doc, p)).length;
}

/**
 * The automatic half of the same cleanup, deliberately timid on two counts.
 *
 * It refuses to act when the edit moves the period, because the period fields
 * fire an edit on every intermediate value that parses - typing a year in the
 * end-date box walks through several - and a momentarily wild window would
 * take real history with it, unrecoverably. So the window has to be standing
 * still for this to run at all.
 *
 * And it only ever drops pins that finished *before* the period starts. A pin
 * beyond the end is far more likely to be wanted: extending the end to cover
 * it is the documented workflow, so treating it as residue would delete the
 * assignment a moment before the user reaches for it. Those are left to the
 * explicit button, where someone has said out loud that they want them gone.
 *
 * The guard only holds for the edit that moves the window, which leaves one
 * accepted gap: land a nonsense period and then edit something else before
 * correcting it, and that edit collects real history. Closing it would need a
 * notion of a *settled* window, which this app has no way to form - the engine
 * has no clock, and there is no undo to fall back on. Note that rolling the
 * period forward deliberately and then editing anything is not that gap: the
 * history really is residue by then, and collecting it is the point.
 */
export function pruneStalePins(prev, next) {
  if (prev.start !== next.start || prev.end !== next.end) return next;
  const pins = next.pins.filter((p) => {
    if (!isStale(next, p)) return true;
    return (p.end ?? next.end) > next.start;
  });
  return pins.length === next.pins.length ? next : { ...next, pins };
}
