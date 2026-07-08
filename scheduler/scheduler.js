/**
 * Pure, dependency-free ES module port of gs2.py's scheduling loop and compute_stats.
 * All times are ms-epoch numbers; callers convert Date <-> number at the edges.
 *
 * Unlike gs2.py, ties in guard availability are broken by (totalHours, insertion order)
 * instead of alphabetically by name, so hours stay balanced even when every guard starts
 * equally available (see CLAUDE.md gotchas / DESIGN.md section 4).
 *
 * Positions are named (e.g. "דרומי", "ש''ג") rather than
 * a plain headcount. A position can be time-restricted (e.g. patrol only staffed
 * 22:00-06:00) - "HH:MM" window strings are compared against each slot's LOCAL
 * hour/minute (the JS runtime's local timezone), matching the rest of the app's
 * "device-local time is the interface" convention. All positions share one
 * fairness pool: a guard's total hours across every position they fill (not
 * per-position) is what gets balanced.
 */

class MinHeap {
  constructor(compare) {
    this._compare = compare;
    this._items = [];
  }

  get size() {
    return this._items.length;
  }

  push(item) {
    const items = this._items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._compare(items[i], items[parent]) < 0) {
        [items[i], items[parent]] = [items[parent], items[i]];
        i = parent;
      } else {
        break;
      }
    }
  }

  pop() {
    const items = this._items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      const n = items.length;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < n && this._compare(items[left], items[smallest]) < 0) smallest = left;
        if (right < n && this._compare(items[right], items[smallest]) < 0) smallest = right;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest], items[i]];
        i = smallest;
      }
    }
    return top;
  }
}

function compareGuards(a, b) {
  if (a.nextAvailable !== b.nextAvailable) return a.nextAvailable - b.nextAvailable;
  if (a.totalHours !== b.totalHours) return a.totalHours - b.totalHours;
  return a.seq - b.seq;
}

function parseHHMM(value, label) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? '');
  if (!match) throw new Error(`${label} must be an "HH:MM" 24h string, got ${JSON.stringify(value)}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function minuteOfDay(t) {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

function isPositionActiveAt(position, t) {
  if (!position.timeRestricted) return true;
  const startMin = parseHHMM(position.windowStart, `${position.name}.windowStart`);
  const endMin = parseHHMM(position.windowEnd, `${position.name}.windowEnd`);
  const nowMin = minuteOfDay(t);
  // Windows like 22:00-06:00 wrap past midnight.
  return startMin <= endMin ? nowMin >= startMin && nowMin < endMin : nowMin >= startMin || nowMin < endMin;
}

function normalizePositions(positions) {
  if (!positions || positions.length === 0) throw new Error('At least one position must be specified.');
  return positions.map((p) => {
    if (!p.name) throw new Error('Every position needs a name.');
    if (p.timeRestricted) {
      parseHHMM(p.windowStart, `${p.name}.windowStart`);
      parseHHMM(p.windowEnd, `${p.name}.windowEnd`);
    }
    return { id: p.id ?? p.name, name: p.name, timeRestricted: !!p.timeRestricted, windowStart: p.windowStart, windowEnd: p.windowEnd };
  });
}

/**
 * @param {object} params
 * @param {number} params.start - ms epoch
 * @param {number} params.end - ms epoch
 * @param {number} params.shiftMinutes
 * @param {{id?:string,name:string,timeRestricted?:boolean,windowStart?:string,windowEnd?:string}[]} params.positions
 * @param {string[]} params.guards
 * @param {{start:number,end:number,guard:string}[]} [params.existingShifts]
 * @returns {{start:number,end:number,position:string,guard:string}[]} only the newly generated shifts
 */
export function generateShifts({ start, end, shiftMinutes, positions, guards, existingShifts = [] }) {
  if (!(end > start)) throw new Error('Start time must be before end time.');
  if (!(shiftMinutes > 0)) throw new Error('Shift length must be positive.');
  if (!guards || guards.length === 0) throw new Error('At least one guard must be specified.');
  if (new Set(guards).size !== guards.length) throw new Error('Guard names must be unique.');
  const normalizedPositions = normalizePositions(positions);

  const shiftMs = shiftMinutes * 60 * 1000;

  const nextAvailable = new Map(guards.map((g) => [g, 0]));
  const totalHours = new Map(guards.map((g) => [g, 0]));

  for (const shift of existingShifts) {
    const hours = (shift.end - shift.start) / 3600000;
    if (nextAvailable.has(shift.guard)) {
      nextAvailable.set(shift.guard, Math.max(nextAvailable.get(shift.guard), shift.end));
      totalHours.set(shift.guard, totalHours.get(shift.guard) + hours);
    }
  }

  let seq = 0;
  const heap = new MinHeap(compareGuards);
  for (const g of guards) {
    heap.push({ name: g, nextAvailable: nextAvailable.get(g), totalHours: totalHours.get(g), seq: seq++ });
  }

  const shiftHours = shiftMs / 3600000;
  const newShifts = [];

  for (let t = start; t < end; t += shiftMs) {
    const activePositions = normalizedPositions.filter((p) => isPositionActiveAt(p, t));
    const shiftEnd = t + shiftMs;
    const popped = [];

    for (const position of activePositions) {
      if (heap.size === 0) throw new Error('Not enough guards to fill positions');
      const item = heap.pop();
      if (item.nextAvailable > t) {
        throw new Error(`Guard ${item.name} is not available until ${new Date(item.nextAvailable).toISOString()}`);
      }
      popped.push(item);
      newShifts.push({ start: t, end: shiftEnd, position: position.id, guard: item.name });
    }

    for (const item of popped) {
      item.nextAvailable = shiftEnd;
      item.totalHours += shiftHours;
      item.seq = seq++;
      heap.push(item);
    }
  }

  return newShifts;
}

/**
 * @param {{start:number,end:number,guard:string}[]} shifts
 * @returns {{hoursPerGuard: Map<string, number>, variance: number|null}}
 */
export function computeStats(shifts) {
  const hoursPerGuard = new Map();
  for (const shift of shifts) {
    const hours = (shift.end - shift.start) / 3600000;
    hoursPerGuard.set(shift.guard, (hoursPerGuard.get(shift.guard) || 0) + hours);
  }

  const values = [...hoursPerGuard.values()];
  let variance = null;
  if (values.length > 1) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  }

  return { hoursPerGuard, variance };
}
