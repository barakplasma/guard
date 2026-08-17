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

import { plan as runPlanner } from './planner.js';
import { toPlannerInput } from './planSchema.js';

/** Resolve a pin's effective range, following the null-inheritance chain. */
export function pinRange(doc, pin) {
  const mission = doc.missions.find((m) => m.id === pin.missionId);
  return {
    start: pin.start ?? mission?.start ?? doc.start,
    end: pin.end ?? mission?.end ?? doc.end,
  };
}

/** Does `pin` cover the whole of `[start, end)`? */
export function pinCovers(doc, pin, start, end) {
  const range = pinRange(doc, pin);
  return range.start <= start && range.end >= end;
}

/**
 * Record a manual swap: `employeeId` takes the shift `[start, end)` on
 * `missionId`, replacing `replacingEmployeeId`.
 *
 * The displaced person's pin must be removed, matched by coverage rather than
 * exact range: their assignment may be a whole-mission pin written from the
 * Missions page, which no exact-range match would find - leaving it in place
 * means both people stay pinned and compete on the next plan, so the swap
 * either does nothing (the newcomer is dropped as overflow) or quietly adds a
 * person instead of replacing one.
 *
 * That removal must stay scoped to `replacingEmployeeId`. A mission with more
 * than one seat can have two different people each individually pinned to the
 * exact same [start, end) - one pin per seat - and an earlier version of this
 * function matched on (missionId, start, end) alone, so swapping one seat
 * deleted the other seat's pin too. Only when the caller has no named
 * predecessor (a direct API call, not the schedule UI) do we fall back to
 * clearing whatever pin exactly held this row, since there is nothing more
 * specific to key on.
 */
export function applySwap(doc, { missionId, employeeId, start, end, replacingEmployeeId }) {
  const kept = doc.pins.filter((p) => {
    if (p.missionId !== missionId) return true;
    if (replacingEmployeeId != null) {
      return !(p.employeeId === replacingEmployeeId && pinCovers(doc, p, start, end));
    }
    return !(p.start === start && p.end === end);
  });
  return { ...doc, pins: [...kept, { missionId, employeeId, start, end }] };
}

/**
 * Remove whatever pin is holding `employeeId` over `[start, end)` of
 * `missionId` - matching by coverage, not by exact range, so the clear button
 * also works on a whole-mission assignment.
 */
export function applyClearPin(doc, { missionId, employeeId, start, end }) {
  return {
    ...doc,
    pins: doc.pins.filter((p) => !(
      p.missionId === missionId
      && p.employeeId === employeeId
      && pinCovers(doc, p, start, end)
    )),
  };
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
 * Set a mission's fixed roster from the Missions page. Only whole-window pins
 * are replaced; per-shift pins are manual swaps made on the schedule and are
 * edited there.
 */
export function applyMissionAssignees(doc, missionId, employeeIds) {
  return {
    ...doc,
    pins: [
      ...doc.pins.filter(
        (p) => !(p.missionId === missionId && p.start == null && p.end == null),
      ),
      ...employeeIds.map((employeeId) => ({ missionId, employeeId, start: null, end: null })),
    ],
  };
}
