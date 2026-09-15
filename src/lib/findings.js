import { t } from '../strings.js';

export const ERROR_FINDINGS = new Set(['engine-bug', 'missing-required-tag', 'rest-unsatisfied', 'understaffed', 'long-shift']);
export const INFO_FINDINGS = new Set(['pin-availability-overridden', 'pin-out-of-period', 'pin-excluded-tag']);
export function findingText(w, doc) {
  const person = doc.employees.find((e) => e.id === w.employeeId)?.name ?? w.employeeId;
  const mission = doc.missions.find((m) => m.id === w.missionId)?.name ?? w.missionId;
  const tag = doc.tags?.find((item) => item.id === w.tag)?.name ?? w.tag;
  switch (w.code) {
    case 'engine-bug': return `${t.engineProblem} (${w.rule})`;
    case 'missing-required-tag': return t.missingQualification(mission, tag, w.needed);
    case 'rest-unsatisfied': return t.restShortfall(person, w.needed, Math.floor(w.got),
      w.longestMinutes == null ? null : Math.floor(w.longestMinutes));
    case 'rest-incomplete': return t.restIncomplete(person);
    case 'pin-excluded-tag': return t.pinExcluded(person, mission);
    case 'tag-required-and-excluded': return t.contradictoryTag(mission, tag);
    case 'no-rest-between-shifts': return t.qualityNoRest(person, w.count);
    case 'same-mission-consecutive': return t.qualitySameMission(person, w.count);
    case 'long-unbroken-run': return t.qualityLongRun(person, w.count);
    case 'short-shift': return t.shortShift(person, mission, w.actualMinutes, w.expectedMinutes);
    case 'long-shift': return t.longShift(person, mission, w.actualMinutes, w.expectedMinutes);
    case 'workload-outlier': return t.workloadOutlier(person, w.count, Math.round(w.average * 10) / 10);
    case 'understaffed': return t.warnUnderstaffed(mission, w.needed, w.got);
    case 'employee-unused': return t.warnEmployeeUnused(person);
    case 'mission-outside-window': return t.warnMissionOutside(mission);
    case 'employee-window-outside-plan': return t.warnEmployeeOutside(person);
    case 'pin-conflict': return t.warnPinConflict(person);
    case 'pin-overflow': return t.warnPinOverflow(person);
    case 'pin-unavailable': return t.warnPinUnavailable(person);
    case 'pin-out-of-period': return t.warnPinOutOfPeriod(w.count);
    case 'pin-availability-overridden': return t.warnPinAvailabilityOverridden(person);
    default: return w.code;
  }
}
