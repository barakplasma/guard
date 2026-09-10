import { formatDate, formatRange, formatTime } from './format.js';
import { pinRange } from './pins.js';
import { t } from '../strings.js';

/** "120/60" where the night length differs from the day one, else just "120". */
function lengthPair(day, night) {
  return night == null || night === day ? `${day}` : `${day}/${night}`;
}

/**
 * Render the plan *document* (not the computed schedule) as plain Hebrew
 * text: exactly what is encoded in the shareable link, in a form a human can
 * read without decoding it themselves. Pure and UI-free on purpose, like
 * `exportText.js`'s `whatsappText` - the copy button is just a thin wrapper
 * around this, and it is unit-tested directly.
 *
 * @param {object} doc - a parsed plan document (see planSchema.js)
 */
export function planToReadableText(doc) {
  const employeeById = new Map(doc.employees.map((e) => [e.id, e]));
  const missionById = new Map(doc.missions.map((m) => [m.id, m]));

  const lines = [doc.title.trim() || t.appTitle];
  lines.push(`${t.planStart}: ${formatDate(doc.start)} ${formatTime(doc.start)}`);
  lines.push(`${t.planEnd}: ${formatDate(doc.end)} ${formatTime(doc.end)}`);
  lines.push(`${t.shiftLength}: ${doc.shiftMinutes}`);
  lines.push(`${t.strategy}: ${t.strategyName(doc.strategy)}`);

  lines.push('', `${t.employees} (${doc.employees.length}):`);
  if (doc.employees.length === 0) lines.push(`- ${t.noEmployees}`);
  for (const e of doc.employees) {
    const window = e.start == null && e.end == null
      ? t.wholePeriod
      : formatRange(e.start ?? doc.start, e.end ?? doc.end);
    lines.push(`- ${e.name || t.employeeName}: ${window}`);
  }

  lines.push('', `${t.missions} (${doc.missions.length}):`);
  if (doc.missions.length === 0) lines.push(`- ${t.noMissions}`);
  for (const m of doc.missions) {
    const kind = m.type === 'remote' ? t.typeRemote : t.typeLocal;
    // An open-ended mission (start set, end null) runs to the plan's end and
    // follows that boundary if the period is later extended - printing a
    // concrete end time here would read exactly like a mission someone hand-
    // set an end for, which is not true and would go stale the moment the
    // plan period changes.
    const window = m.start == null && m.end == null
      ? t.wholePeriod
      : m.end == null
        ? `${formatDate(m.start)} ${formatTime(m.start)} — ${t.missionNoEnd}`
        : formatRange(m.start ?? doc.start, m.end);
    // "4/6" only when the two differ - a mission staffed the same round the
    // clock should not gain a second number that says nothing.
    const heads = m.type !== 'remote' && m.nightCount != null && m.nightCount !== m.count
      ? `${m.count}/${m.nightCount}`
      : `${m.count}`;
    // Shift lengths, in the same spirit and only when this mission actually
    // asks for its own: a mission rotating on the plan's default grid prints
    // nothing, because the plan's own line above already said what that is.
    // "120/60" when night differs from day, "120" when it does not.
    const dayLength = m.shiftMinutes;
    const nightLength = m.nightShiftMinutes;
    const shift = m.type === 'remote' || (dayLength == null && nightLength == null)
      ? ''
      : `, ${lengthPair(dayLength ?? doc.shiftMinutes, nightLength)} ${t.minutesShort}`;
    lines.push(`- ${m.name || t.missionName} (${kind}, ${heads}${shift}): ${window}`);
  }

  lines.push('', `${t.pinsSection} (${doc.pins.length}):`);
  if (doc.pins.length === 0) lines.push(`- ${t.noPins}`);
  for (const p of doc.pins) {
    const employeeName = employeeById.get(p.employeeId)?.name ?? p.employeeId;
    const mission = missionById.get(p.missionId);
    const missionName = mission?.name ?? p.missionId;
    // A pin's start and end are nullable independently, each inheriting the
    // mission's (then the plan's) boundary - the same resolution pinRange
    // already does for the engine, reused here so a start-only or end-only
    // pin doesn't print a literal `null` as the Unix epoch.
    const resolved = pinRange(doc, p);
    const window = p.start == null && p.end == null
      ? t.wholeMission
      : formatRange(resolved.start, resolved.end);
    const suffix = p.frozen ? ` (${t.frozenPinNote})` : '';
    lines.push(`- ${employeeName} ← ${missionName}: ${window}${suffix}`);
  }

  return lines.join('\n');
}
