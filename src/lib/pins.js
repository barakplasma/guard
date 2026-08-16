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
 * like any other.
 */
export function freezePastShifts(doc, result, now) {
  const newPins = result.shifts
    .filter((s) => !s.pinned && s.end <= now)
    .map((s) => ({
      missionId: s.missionId, employeeId: s.employeeId, start: s.start, end: s.end,
    }));
  if (newPins.length === 0) return doc;
  return { ...doc, pins: [...doc.pins, ...newPins] };
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
