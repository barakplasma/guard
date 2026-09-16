/**
 * Corrections for unmet required qualifications ("the schedule needs a driver
 * at 18:00 and has none").
 *
 * The repair half lives in `planner.plan`: generated rows are the engine's own
 * output, so a repair is tried by re-running the whole engine with a "hint" -
 * a pre-seeded generated seat for a qualified employee - and keeping the hint
 * only when the resulting schedule is strictly better. Re-running the engine
 * is what makes every invariant a normal plan holds hold for the repaired one
 * too, with none of the row surgery a local swap would need.
 *
 * This module is the proposal half, for what generated duty cannot touch.
 * A frozen pin is preserved history: it is never modified automatically, but
 * `proposeCorrections` names the qualified employee it holds, the affected
 * assignments, and the rest impact, and the schedule changes only when a
 * person accepts the proposal. A manual pin is never replaced at all - the
 * most the engine can do is say so.
 *
 * Everything here is pure and deterministic: employee order is the document's,
 * windows are walked chronologically, and substitutes are ranked by the same
 * rest-cost ladder the staffing pass uses.
 */

import { missingQualifications } from './crew.js';
import { isExcluded } from './planner.js';
import { restCost, restMetrics } from './rest.js';

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/** Every window `mission` runs, cut where its crew can change. */
function windowsOf(mission, segmentsOf) {
  if (mission.type === 'local') return segmentsOf(mission).map((s) => ({ ...s }));
  if (mission.type === 'daily') return mission.occurrences.map((w) => ({ ...w, slot: w }));
  return [{ start: mission.start, end: mission.end, slot: { start: mission.start, end: mission.end } }];
}

/** Rows of `missionId` covering all of `[start, end)` - windows are cut at
 * every pin and shared edge, so within one window a row covers it whole. */
const covering = (rows, missionId, start, end) =>
  rows.filter((r) => r.missionId === missionId && r.start <= start && r.end >= end);

const freeOf = (rows, employeeId, start, end) =>
  !rows.some((r) => r.employeeId === employeeId && overlaps(r, { start, end }));

/** Excluded from `mission`, by qualification or by name - see `isExcluded`. */
const excluded = isExcluded;

/**
 * Unmet required-qualification windows over the raw rows, one per mission
 * grid segment - the row-level counterpart of the warning-level walk in
 * `plan`, at the granularity repairs work on. Sorted chronologically, then by
 * mission and tag, which is the deterministic order repairs are attempted in.
 */
export function shortageWindows(rows, missions, segmentsOf) {
  const out = [];
  for (const m of missions) {
    if (!m.requires.length || m.excludes.some((t) => m.requires.some((r) => r.tag === t))) continue;
    for (const w of windowsOf(m, segmentsOf)) {
      const crew = covering(rows, m.id, w.start, w.end).map((r) => ({ tags: r.qualifications ?? [] }));
      for (const miss of missingQualifications(crew, m.requires)) {
        out.push({ mission: m, tag: miss.tag, start: w.start, end: w.end, got: miss.got, needed: miss.needed, slot: w.slot });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start
    || (a.mission.id < b.mission.id ? -1 : a.mission.id > b.mission.id ? 1 : 0)
    || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

/** The same shortages, adjacent segments with an equal shortfall merged -
 * the reporting shape proposals and the findings panel want. */
export function mergedShortages(rows, missions, segmentsOf) {
  const out = [];
  for (const w of shortageWindows(rows, missions, segmentsOf)) {
    const last = out.at(-1);
    if (last && last.mission.id === w.mission.id && last.tag === w.tag && last.end === w.start && last.got === w.got) {
      last.end = w.end;
    } else {
      const { slot: _slot, ...rest } = w;
      out.push(rest);
    }
  }
  return out;
}

/** Build an output row shaped exactly like the staffing pass's `addRow`. */
function makeRow(mission, employee, start, end, slot) {
  return {
    missionId: mission.id,
    missionName: mission.name,
    type: mission.type,
    employeeId: employee.id,
    employeeName: employee.name,
    start,
    end,
    slotStart: slot.start,
    slotEnd: slot.end,
    pinned: false,
    frozen: false,
    ...((employee.tags ?? []).length ? { qualifications: [...employee.tags] } : {}),
  };
}

/**
 * A deterministic stand-in for a released assignment: free and available for
 * that row's window, not excluded, and the mission's required qualifications
 * still covered with them in the crew. Ranked by the staffing pass's rest
 * ladder, then by employee order. Advisory only - the proposal names them,
 * acceptance applies them.
 */
function bestSubstitute(rows, row, ctx) {
  const mission = ctx.missions.find((m) => m.id === row.missionId);
  const crew = covering(rows, mission.id, row.start, row.end).map((r) => ({ tags: r.qualifications ?? [] }));
  let best = null, bestCost = null;
  for (const e of ctx.employees) {
    if (e.id === row.employeeId) continue;
    if (!freeOf(rows, e.id, row.start, row.end)) continue;
    if (e.start > row.start || e.end < row.end) continue;
    if (excluded(mission, e)) continue;
    if (missingQualifications([...crew, { tags: e.tags ?? [] }], mission.requires).length) continue;
    const cost = restCost(e, ctx.tags, ctx.nightWindows,
      rows.filter((r) => r.employeeId === e.id && !ctx.sleepable.has(r.missionId)),
      ctx.start, ctx.end, row.start, row.end);
    const rank = bestCost == null ? -1 : cost.map((v, i) => v - bestCost[i]).find((v) => v !== 0) ?? 0;
    if (rank < 0 || (rank === 0 && (best == null || e.id < best.id))) { best = e; bestCost = cost; }
  }
  return best;
}

/**
 * Proposals for the shortages no repair may touch, plus the explicit
 * explanation when only a manual assignment is in the way. One proposal per
 * merged window: the qualified employee held by preserved history, what would
 * be released, who could stand in, and what it does to their night rest.
 */
export function proposeCorrections(rows, ctx) {
  const proposals = [];
  for (const w of mergedShortages(rows, ctx.missions, ctx.segmentsOf)) {
    const { mission, tag, start, end } = w;
    const actionable = [];
    let blocked = null;
    for (const D of ctx.employees) {
      if (!(D.tags ?? []).includes(tag)) continue;
      if (D.start > start || D.end < end) continue;
      if (excluded(mission, D)) continue;
      if (covering(rows, mission.id, start, end).some((r) => r.employeeId === D.id)) continue;
      const holdRows = rows.filter((r) => r.employeeId === D.id && overlaps(r, { start, end }));
      const manualRows = holdRows.filter((r) => r.pinned && !r.frozen);
      if (manualRows.length) {
        // A manual assignment is never replaced; name it and say why not.
        blocked ??= {
          code: 'correction-blocked',
          missionId: mission.id, missionName: mission.name, tagId: tag, start, end,
          driverId: D.id, driverName: D.name,
          manual: manualRows.map((r) => ({
            missionId: r.missionId,
            missionName: ctx.missions.find((m) => m.id === r.missionId)?.name ?? r.missionId,
            start: r.start, end: r.end,
          })),
        };
        continue;
      }
      const release = holdRows.filter((r) => r.frozen);
      if (!release.length) continue; // generated duty: the repair pass's domain
      actionable.push({ driver: D, release });
    }
    if (blocked) { proposals.push(blocked); continue; }
    if (!actionable.length) continue;

    actionable.sort((a, b) => a.release.length - b.release.length
      || (a.driver.id < b.driver.id ? -1 : a.driver.id > b.driver.id ? 1 : 0));
    const { driver, release } = actionable[0];

    // Judge substitutes on the schedule the correction would produce: the
    // driver moved onto the short window displaces whatever generated duty
    // filled it, so those rows leave the hypothetical too - otherwise they
    // phantom-block every free colleague.
    const slot = windowsOf(mission, ctx.segmentsOf).find((x) => x.start <= start && x.end >= end)?.slot
      ?? { start, end };
    let hypothetical = rows.filter((r) => !release.includes(r)
      && !(r.missionId === mission.id && !r.pinned && overlaps(r, { start, end })));
    hypothetical = [...hypothetical, makeRow(mission, driver, start, end, slot)];
    const releaseEntries = [...release].sort((a, b) => a.start - b.start).map((r) => {
      const sub = bestSubstitute(hypothetical, r, ctx);
      return {
        missionId: r.missionId,
        missionName: ctx.missions.find((m) => m.id === r.missionId)?.name ?? r.missionId,
        start: r.start, end: r.end,
        substituteId: sub?.id ?? null,
        substituteName: sub?.name ?? null,
      };
    });

    proposals.push({
      code: 'correction-proposal',
      missionId: mission.id, missionName: mission.name, tagId: tag, start, end,
      driverId: driver.id, driverName: driver.name,
      release: releaseEntries,
      restImpact: restImpactFor(rows, hypothetical, driver, [w, ...release], ctx),
    });
  }
  return proposals;
}

/** The driver's worst affected night, before and after the correction. */
function restImpactFor(beforeRows, afterRows, driver, changes, ctx) {
  const from = Math.min(...changes.map((c) => c.start));
  const to = Math.max(...changes.map((c) => c.end));
  const pick = (rows) => restMetrics(rows, [driver], ctx.tags, ctx.nightWindows, ctx.start, ctx.end, ctx.sleepable)
    .filter((m) => overlaps(m, { start: from, end: to }))
    .sort((a, b) => a.totalMinutes - b.totalMinutes)[0];
  const before = pick(beforeRows);
  const after = pick(afterRows);
  if (!before || !after) return null;
  return {
    needed: before.needed,
    before: { totalMinutes: before.totalMinutes, longestMinutes: before.longestMinutes },
    after: { totalMinutes: after.totalMinutes, longestMinutes: after.longestMinutes },
  };
}
