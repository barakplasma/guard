/**
 * Pure, dependency-free "how much sleep could each person get" report.
 *
 * Given a night window [nightStart, nightEnd) (ms epoch) and everyone's shifts,
 * it finds each person's LONGEST contiguous free block inside the window - the
 * best uninterrupted sleep the roster leaves them - plus their total free time
 * in the window. `minSleepHours` per person (e.g. drivers need 6) flags whoever
 * the roster can't give enough contiguous sleep.
 *
 * Times are ms-epoch numbers; callers build the window from a date + "HH:MM"
 * night bounds (handling the overnight wrap) at the edges, matching the rest of
 * the app's device-local-time convention.
 */

/**
 * People and shifts are matched by a stable `id` (each shift's `guard` is that
 * id), NOT by display name - names aren't unique, so keying by name would merge
 * two people who share one and mis-attribute their sleep. Callers map ids to
 * display names for rendering.
 *
 * @param {object} params
 * @param {number} params.nightStart - ms epoch, inclusive
 * @param {number} params.nightEnd - ms epoch, exclusive (must be > nightStart)
 * @param {{guard:string,start:number,end:number}[]} params.shifts - `guard` is the person id
 * @param {{id:string,minSleepHours?:number}[]} params.people
 * @returns {{id:string,minSleepHours:number,longestSleepHours:number,totalFreeHours:number,
 *            sleepStart:number|null,sleepEnd:number|null,meetsMinimum:boolean}[]}
 */
export function sleepReport({ nightStart, nightEnd, shifts, people }) {
  if (!(nightEnd > nightStart)) throw new Error('Night start must be before night end.');

  // Group each person's shifts, clipped to the window, keyed by person id.
  const busyById = new Map();
  for (const person of people) busyById.set(person.id, []);
  for (const shift of shifts) {
    const list = busyById.get(shift.guard);
    if (!list) continue; // shift for someone not in the report
    const s = Math.max(shift.start, nightStart);
    const e = Math.min(shift.end, nightEnd);
    if (s < e) list.push({ start: s, end: e });
  }

  return people.map((person) => {
    const minSleepHours = person.minSleepHours > 0 ? person.minSleepHours : 0;
    const busy = mergeIntervals(busyById.get(person.id));

    // Free gaps = the window minus the merged busy intervals.
    let longestMs = 0;
    let totalFreeMs = 0;
    let sleepStart = null;
    let sleepEnd = null;
    let cursor = nightStart;
    for (const iv of busy) {
      if (iv.start > cursor) {
        const gap = iv.start - cursor;
        totalFreeMs += gap;
        if (gap > longestMs) {
          longestMs = gap;
          sleepStart = cursor;
          sleepEnd = iv.start;
        }
      }
      cursor = Math.max(cursor, iv.end);
    }
    if (nightEnd > cursor) {
      const gap = nightEnd - cursor;
      totalFreeMs += gap;
      if (gap > longestMs) {
        longestMs = gap;
        sleepStart = cursor;
        sleepEnd = nightEnd;
      }
    }

    const longestSleepHours = longestMs / 3600000;
    return {
      id: person.id,
      minSleepHours,
      longestSleepHours,
      totalFreeHours: totalFreeMs / 3600000,
      sleepStart,
      sleepEnd,
      meetsMinimum: longestSleepHours >= minSleepHours,
    };
  });
}

// Sort by start and merge overlapping/touching intervals into disjoint ones.
function mergeIntervals(intervals) {
  if (intervals.length <= 1) return intervals.slice();
  const sorted = intervals.slice().sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}
