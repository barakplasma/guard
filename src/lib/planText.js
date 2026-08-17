import { formatDate, formatRange, formatTime } from './format.js';
import { pinRange } from './pins.js';
import { t } from '../strings.js';

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
    const window = m.start == null && m.end == null
      ? t.wholePeriod
      : formatRange(m.start ?? doc.start, m.end ?? doc.end);
    lines.push(`- ${m.name || t.missionName} (${kind}, ${m.count}): ${window}`);
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
