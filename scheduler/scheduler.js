/**
 * Pure, dependency-free ES module port of gs2.py's scheduling loop and compute_stats.
 * All times are ms-epoch numbers; callers convert Date <-> number at the edges.
 *
 * Unlike gs2.py, ties in guard availability are broken by (totalHours, insertion order)
 * instead of alphabetically by name, so hours stay balanced even when every guard starts
 * equally available (see CLAUDE.md gotchas / DESIGN.md section 4).
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

/**
 * @param {object} params
 * @param {number} params.start - ms epoch
 * @param {number} params.end - ms epoch
 * @param {number} params.shiftMinutes
 * @param {number} params.positions
 * @param {string[]} params.guards
 * @param {{start:number,end:number,guards:string[]}[]} [params.existingShifts]
 * @returns {{start:number,end:number,guards:string[]}[]} only the newly generated shifts
 */
export function generateShifts({ start, end, shiftMinutes, positions, guards, existingShifts = [] }) {
  if (!(end > start)) throw new Error('Start time must be before end time.');
  if (!(shiftMinutes > 0)) throw new Error('Shift length must be positive.');
  if (!(positions > 0)) throw new Error('Number of positions must be positive.');
  if (!guards || guards.length === 0) throw new Error('At least one guard must be specified.');
  if (new Set(guards).size !== guards.length) throw new Error('Guard names must be unique.');
  if (guards.length < positions) throw new Error('Not enough guards to fill positions');

  const shiftMs = shiftMinutes * 60 * 1000;

  const nextAvailable = new Map(guards.map((g) => [g, 0]));
  const totalHours = new Map(guards.map((g) => [g, 0]));

  for (const shift of existingShifts) {
    const hours = (shift.end - shift.start) / 3600000;
    for (const g of shift.guards) {
      if (nextAvailable.has(g)) {
        nextAvailable.set(g, Math.max(nextAvailable.get(g), shift.end));
        totalHours.set(g, totalHours.get(g) + hours);
      }
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
    const popped = [];
    const assigned = [];
    for (let i = 0; i < positions; i++) {
      if (heap.size === 0) throw new Error('Not enough guards to fill positions');
      const item = heap.pop();
      if (item.nextAvailable > t) {
        throw new Error(`Guard ${item.name} is not available until ${new Date(item.nextAvailable).toISOString()}`);
      }
      assigned.push(item.name);
      popped.push(item);
    }
    const shiftEnd = t + shiftMs;
    for (const item of popped) {
      item.nextAvailable = shiftEnd;
      item.totalHours += shiftHours;
      item.seq = seq++;
      heap.push(item);
    }
    newShifts.push({ start: t, end: shiftEnd, guards: assigned });
  }

  return newShifts;
}

/**
 * @param {{start:number,end:number,guards:string[]}[]} shifts
 * @returns {{hoursPerGuard: Map<string, number>, variance: number|null}}
 */
export function computeStats(shifts) {
  const hoursPerGuard = new Map();
  for (const shift of shifts) {
    const hours = (shift.end - shift.start) / 3600000;
    for (const guard of shift.guards) {
      hoursPerGuard.set(guard, (hoursPerGuard.get(guard) || 0) + hours);
    }
  }

  const values = [...hoursPerGuard.values()];
  let variance = null;
  if (values.length > 1) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  }

  return { hoursPerGuard, variance };
}
