import { dayKey } from './format.js';

/**
 * Reshape the engine's flat shift list into the day -> time-slot -> mission
 * tree that both the on-screen agenda and the text exports render. Keeping this
 * in one place means the WhatsApp message and the screen can never drift apart.
 */
export function groupAgenda(result) {
  const slots = new Map();
  for (const shift of result.shifts) {
    const key = `${shift.start}|${shift.end}`;
    if (!slots.has(key)) slots.set(key, { start: shift.start, end: shift.end, missions: new Map() });
    const slot = slots.get(key);
    if (!slot.missions.has(shift.missionId)) {
      slot.missions.set(shift.missionId, {
        missionId: shift.missionId,
        missionName: shift.missionName,
        type: shift.type,
        entries: [],
      });
    }
    slot.missions.get(shift.missionId).entries.push(shift);
  }

  const days = new Map();
  for (const slot of [...slots.values()].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const key = dayKey(slot.start);
    if (!days.has(key)) days.set(key, { day: key, slots: [] });
    days.get(key).slots.push({
      start: slot.start,
      end: slot.end,
      missions: [...slot.missions.values()].sort((a, b) => (
        a.missionName < b.missionName ? -1 : a.missionName > b.missionName ? 1 : 0
      )),
    });
  }
  return [...days.values()].sort((a, b) => a.day - b.day);
}

/** Whether `now` falls inside `slot`'s [start, end) range. */
export function slotContainsInstant(slot, now) {
  return now != null && slot.start <= now && now < slot.end;
}

/**
 * The single most specific slot containing `now`, across every day - e.g. an
 * all-day remote mission and the current hour of a rotating local mission can
 * both contain `now` at once, since each distinct (start, end) is its own slot.
 * The shortest one is the actually-current shift, not the long-running block
 * that merely happens to still be open; ties break on the earlier start so the
 * result is deterministic. `null` if no slot contains `now`.
 */
export function findNowSlot(days, now) {
  let best = null;
  for (const day of days) {
    for (const slot of day.slots) {
      if (!slotContainsInstant(slot, now)) continue;
      const duration = slot.end - slot.start;
      const bestDuration = best ? best.end - best.start : Infinity;
      if (!best || duration < bestDuration || (duration === bestDuration && slot.start < best.start)) {
        best = slot;
      }
    }
  }
  return best;
}
