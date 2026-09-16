/**
 * Plan input <-> model instance (ADR 011's adapter, prototype).
 *
 * The thing every acceptance criterion past the oracle needs, and the reason
 * `segmentGrid`, `acceptedPins` and `countAt` are exported from `planner.js`:
 * this file must not re-derive where a shift begins, which pins survived, or
 * how many people a mission wants at 03:00. A second implementation of any of
 * those would be wrong eventually, in a way neither side reveals on its own.
 *
 * What it does derive is the mapping between the engine's *per-mission* grids
 * and the model's *global* segment index, which has no counterpart in the
 * engine because the engine never needs one - it walks one mission at a time.
 */

import { segmentGrid, acceptedPins, countAt } from '../../src/lib/planner.js';

const covers = (w, at) => at >= w.start && at < w.end;

/** The windows a mission is actually running in, whatever its type. */
const windowsOf = (m) => (m.type === 'daily' ? m.occurrences : [{ start: m.start, end: m.end }]);

/**
 * Turn a planner input into an instance of `rota.mzn`.
 *
 * Returns the instance plus the `index` needed to read an answer back: the
 * absolute bounds of every segment, and the mission and employee order the
 * model's 1-based indices refer to.
 */
export function toInstance(input) {
  const { start, end, nightWindows = [] } = input;
  const grids = segmentGrid(input);
  const pins = acceptedPins(input);
  const employees = [...input.employees].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const missions = grids.map((g) => g.mission);

  // The global grid is every edge any mission is cut on, unioned. Cutting more
  // finely than a given mission needs is harmless - `holdOf` and `slotOf` carry
  // what must not come apart - while cutting less finely would lose an edge
  // somebody's availability or headcount actually turns on.
  const edges = new Set([start, end]);
  for (const { mission, segments } of grids) {
    for (const w of windowsOf(mission)) { edges.add(w.start); edges.add(w.end); }
    // A remote or daily mission is held whole, so the engine never walks its
    // segments and neither do we (`tests/planner.segmentGrid.test.js` pins that
    // trap). Its window edges above are the only cuts it contributes.
    if (mission.type !== 'local') continue;
    for (const seg of segments) { edges.add(seg.start); edges.add(seg.end); }
  }
  const bounds = [...edges].filter((t) => t >= start && t <= end).sort((a, b) => a - b);
  const segs = [];
  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i] > bounds[i - 1]) segs.push({ start: bounds[i - 1], end: bounds[i] });
  }

  const nS = segs.length;
  const want = [];
  const slotOf = [];
  const holdOf = [];
  // Slot and hold ids only ever have to be distinguishable within one mission's
  // row, so a counter shared across missions is fine and keeps them small.
  let nextId = 1;

  missions.forEach((mission, mi) => {
    const own = grids[mi].segments;
    const wins = windowsOf(mission);
    const slotIds = new Map();
    const holdIds = new Map();
    want.push([]);
    slotOf.push([]);
    holdOf.push([]);
    for (const seg of segs) {
      const win = wins.find((w) => covers(w, seg.start));
      if (!win) {
        want[mi].push(0);
        slotOf[mi].push(0);
        holdOf[mi].push(0);
        continue;
      }
      want[mi].push(countAt(mission, seg.start, nightWindows));
      if (mission.type === 'local') {
        // The slot this segment sits in, taken from the mission's own grid -
        // not recomputed, because the stamp is the whole point.
        const grid = own.find((s) => covers(s, seg.start));
        const key = grid ? grid.slot.start : seg.start;
        if (!slotIds.has(key)) slotIds.set(key, nextId++);
        slotOf[mi].push(slotIds.get(key));
        holdOf[mi].push(0);
      } else {
        // One indivisible hold per window: the whole mission if remote, one per
        // calendar occurrence if daily.
        if (!holdIds.has(win.start)) holdIds.set(win.start, nextId++);
        const id = holdIds.get(win.start);
        holdOf[mi].push(id);
        // A hold is not a rotation grid, and the churn term must not double up
        // on the hard constraint that already governs it.
        slotOf[mi].push(0);
      }
    }
  });

  const avail = employees.map((e) => segs.map(
    (seg) => (e.start ?? start) <= seg.start && (e.end ?? end) >= seg.end,
  ));
  const allowed = employees.map((e) => missions.map(
    (m) => !(m.excludes ?? []).some((t) => (e.tags ?? []).includes(t))
      && !(m.excludeEmployees ?? []).includes(e.id),
  ));

  const pinned = employees.map((e) => missions.map((m) => segs.map((seg) => pins.some(
    (p) => p.employeeId === e.id && p.missionId === m.id
      && p.start <= seg.start && p.end >= seg.end,
  ))));

  const requires = [];
  missions.forEach((m, mi) => {
    for (const r of m.requires ?? []) {
      requires.push({ mission: mi, count: r.count, holds: employees.map((e) => (e.tags ?? []).includes(r.tag)) });
    }
  });

  return {
    nE: employees.length,
    nM: missions.length,
    nS,
    want,
    slotOf,
    holdOf,
    avail,
    allowed,
    pinned,
    requires,
    index: { segs, missions, employees },
  };
}

/**
 * Read an answer back as shift rows, in the engine's own shape.
 *
 * Adjacent segments held by the same person on the same mission are rejoined
 * **only within one slot**, never across a slot boundary - the same rule
 * `mergeRows` follows, and for the same reason: welding consecutive shifts
 * together turns a guard who held eleven slots into one 88-hour row. A hold is
 * a single slot by construction, so a remote mission still comes back whole.
 */
export function toRows(inst, x) {
  const { segs, missions, employees } = inst.index;
  const rows = [];
  employees.forEach((e, ei) => {
    missions.forEach((m, mi) => {
      let open = null;
      const flush = () => { if (open) rows.push(open); open = null; };
      segs.forEach((seg, si) => {
        if (!x[ei][mi][si]) return flush();
        const slot = inst.slotOf[mi][si] || inst.holdOf[mi][si];
        if (open && open.end === seg.start && open.slot === slot) {
          open.end = seg.end;
          return;
        }
        flush();
        open = {
          missionId: m.id,
          missionName: m.name,
          type: m.type,
          employeeId: e.id,
          employeeName: e.name,
          start: seg.start,
          end: seg.end,
          slot,
        };
      });
      flush();
    });
  });
  return rows.sort((a, b) => a.start - b.start
    || (a.missionId < b.missionId ? -1 : a.missionId > b.missionId ? 1 : 0)
    || (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0));
}
