import { t } from '../strings.js';

export const ERROR_FINDINGS = new Set(['engine-bug', 'missing-required-tag', 'rest-unsatisfied']);
export function findingText(w, doc) {
  const person = doc.employees.find((e) => e.id === w.employeeId)?.name ?? w.employeeId;
  const mission = doc.missions.find((m) => m.id === w.missionId)?.name ?? w.missionId;
  const tag = doc.tags?.find((item) => item.id === w.tag)?.name ?? w.tag;
  switch (w.code) {
    case 'engine-bug': return `${t.engineProblem} (${w.rule})`;
    case 'missing-required-tag': return t.missingQualification(mission, tag, w.needed);
    case 'rest-unsatisfied': return t.restShortfall(person, w.needed, Math.floor(w.got));
    case 'rest-incomplete': return t.restIncomplete(person);
    case 'pin-excluded-tag': return t.pinExcluded(person, mission);
    case 'tag-required-and-excluded': return t.contradictoryTag(mission, tag);
    case 'no-rest-between-shifts': return t.qualityNoRest(person, w.count);
    case 'same-mission-consecutive': return t.qualitySameMission(person, w.count);
    case 'long-unbroken-run': return t.qualityLongRun(person, w.count);
    default: return null;
  }
}
