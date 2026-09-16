/**
 * The durable record of duty the plan period has moved past (ADR 012).
 *
 * Once a rolled-past window is *exported* rather than kept or dropped, the
 * assignments outside the period stop being residue and become the only lasting
 * evidence of who actually stood post. So they need a shape the CSV export can
 * take, which the engine cannot give them - it ignores everything outside the
 * period by design, so they appear in no schedule result.
 *
 * This builds those rows directly from the pins, using `isElapsedBeforePeriod`,
 * the same predicate `clearStalePins` removes on and `plan()` reports as the
 * warning's `elapsed`. Sharing one predicate is what keeps the three honest:
 * what the warning says is clearable is what the export carries is what the
 * button removes. `tests/logExport.test.js` asserts that.
 *
 * Pure: no DOM, no clock. The download itself stays in `exportCsv.js`.
 */

import { isElapsedBeforePeriod, resolvePinWindow } from './planner.js';

/**
 * Assignments outside the plan period, shaped like the engine's own shift rows
 * so `shiftsToCsv` can render them unchanged.
 *
 * Sorted chronologically, then by mission and employee id, so two exports of
 * the same document are byte-identical. A pin naming an employee or mission the
 * document no longer has is skipped rather than exported with a blank name: it
 * cannot be read back as a record of anything, and a row that says only "someone
 * was somewhere" is worse than an honest omission.
 */
export function outOfPeriodLog(doc) {
  const missionById = new Map(doc.missions.map((m) => [m.id, m]));
  const employeeById = new Map(doc.employees.map((e) => [e.id, e]));

  return doc.pins
    // Elapsed only. `isOutOfPeriod` is also true beyond the period's end, and
    // an assignment for next week written into this file as completed duty
    // would be a lie the file outlives.
    .filter((p) => isElapsedBeforePeriod(p, missionById.get(p.missionId), doc.start, doc.end))
    .flatMap((p) => {
      const mission = missionById.get(p.missionId);
      const employee = employeeById.get(p.employeeId);
      if (!mission || !employee) return [];
      const { start, end } = resolvePinWindow(p, mission, doc.start, doc.end);
      if (!(end > start)) return [];
      return [{
        missionId: mission.id,
        missionName: mission.name,
        type: mission.type,
        employeeId: employee.id,
        employeeName: employee.name,
        start,
        end,
        // Every row here is a record of duty, so it is "manual" in the CSV's
        // sense whether a person wrote it or the freeze did. The distinction
        // that matters to a reader months later is in `frozen`.
        pinned: true,
        frozen: Boolean(p.frozen),
        ...((employee.tags ?? []).length ? { qualifications: [...employee.tags] } : {}),
      }];
    })
    .sort((a, b) => a.start - b.start
      || (a.missionId < b.missionId ? -1 : a.missionId > b.missionId ? 1 : 0)
      || (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0));
}

/** How many assignments `outOfPeriodLog` would carry. */
export const outOfPeriodCount = (doc) => outOfPeriodLog(doc).length;

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * A filename that says which plan and which span the record covers, so a
 * folder of these is still readable a year later. Dates come from the log
 * itself rather than the plan period, which by then names a different window.
 */
export function logFilename(doc, rows = outOfPeriodLog(doc)) {
  const title = (doc.title || 'guard').trim().replace(/[\s/\\:*?"<>|]+/g, '-').slice(0, 40);
  if (rows.length === 0) return `${title}-history.csv`;
  const from = day(rows[0].start);
  const to = day(Math.max(...rows.map((r) => r.end)));
  return from === to ? `${title}-history-${from}.csv` : `${title}-history-${from}_${to}.csv`;
}
