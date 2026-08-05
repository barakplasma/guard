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
 * Who is free during a given slot. Derived from the engine's timeline: a person
 * counts as off duty only if they are off duty for the *whole* slot, so the
 * "available now" list can never suggest someone who is mid-shift.
 */
export function offDutyDuring(result, slotStart, slotEnd) {
  const covering = result.timeline.filter((seg) => seg.start < slotEnd && seg.end > slotStart);
  if (covering.length === 0) return [];
  // Intersect the off-duty sets of every segment the slot touches: being free
  // for part of a slot is not being free for the slot.
  let free = null;
  for (const seg of covering) {
    const ids = new Set(seg.offDuty);
    free = free == null ? ids : new Set([...free].filter((id) => ids.has(id)));
  }
  return [...free];
}
