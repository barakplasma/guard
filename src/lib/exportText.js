import { formatDay, formatRange } from './format.js';
import { groupAgenda, offDutyDuring } from './agenda.js';

/**
 * Render the schedule as text suitable for pasting into WhatsApp.
 *
 * WhatsApp's own markup is deliberately minimal - `*bold*` is the only thing it
 * reliably renders, and it eats leading whitespace, so indentation is done with
 * bullet characters rather than spaces.
 *
 * Pure on purpose: this is unit-tested directly, and the copy button is just a
 * thin wrapper around it.
 *
 * @param {object} result - the planner engine's output
 * @param {object} [options]
 * @param {string} [options.title] - plan title, used as the message heading
 * @param {Map<string,string>} [options.employeeNames] - id -> name, for the off-duty line
 * @param {boolean} [options.includeOffDuty=false] - append who is free each slot
 */
export function whatsappText(result, { title = '', employeeNames, includeOffDuty = false } = {}) {
  const lines = [`*${title.trim() || 'סידור משמרות'}*`];

  for (const day of groupAgenda(result)) {
    lines.push('', `*${formatDay(day.day)}*`);
    for (const slot of day.slots) {
      lines.push(`${formatRange(slot.start, slot.end)}`);
      for (const mission of slot.missions) {
        const people = mission.entries.map((e) => e.employeeName).join(', ');
        lines.push(`• *${mission.missionName}*: ${people}`);
      }
      if (includeOffDuty && employeeNames) {
        const free = offDutyDuring(result, slot.start, slot.end)
          .map((id) => employeeNames.get(id))
          .filter(Boolean);
        if (free.length) lines.push(`  פנויים: ${free.join(', ')}`);
      }
    }
  }

  if (result.shifts.length === 0) lines.push('', 'אין משמרות משובצות.');
  return lines.join('\n');
}

/**
 * Copy to the clipboard, falling back to a hidden textarea + execCommand.
 * The fallback is not vestigial: `navigator.clipboard` is unavailable in
 * non-secure contexts (plain-HTTP LAN hosting) and on older mobile browsers,
 * which is exactly where this app is likely to be used.
 */
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** wa.me share link. Only useful online; the copy button is the offline path. */
export function whatsappShareLink(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
