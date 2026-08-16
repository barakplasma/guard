import {
  formatDay, formatRangeShort, formatTimeShort,
} from './format.js';
import { groupAgenda } from './agenda.js';

/** Reshape a day's slot->mission tree into mission->slots, the order this export reads in. */
function missionsInDay(day) {
  const missions = new Map();
  for (const slot of day.slots) {
    for (const mission of slot.missions) {
      if (!missions.has(mission.missionId)) {
        missions.set(mission.missionId, { missionName: mission.missionName, slots: [] });
      }
      missions.get(mission.missionId).slots.push({ start: slot.start, end: slot.end, entries: mission.entries });
    }
  }
  return [...missions.values()].sort((a, b) => (
    a.missionName < b.missionName ? -1 : a.missionName > b.missionName ? 1 : 0
  ));
}

/** "A ו-B" for two names, "A, B ו-C" for more - how the group actually writes a roster. */
function joinNames(entries) {
  const names = entries.map((e) => e.employeeName);
  if (names.length < 2) return names.join('');
  if (names.length === 2) return `${names[0]} ו${names[1]}`;
  return `${names.slice(0, -1).join(', ')} ו${names[names.length - 1]}`;
}

/**
 * Render the schedule as text suitable for pasting into WhatsApp: a bold mission
 * header followed by one plain line per shift time, in the "7:00 שם ושם" style
 * people actually type by hand, rather than a repeated "mission: names" table row.
 *
 * WhatsApp's own markup is deliberately minimal - `*bold*` is the only thing it
 * reliably renders, and it eats leading whitespace, so there is no indentation.
 *
 * A mission with a single occurrence (a remote mission, a one-off pin) puts its
 * time range in the header instead, since there is no list of rows to hang it on.
 *
 * Pure on purpose: this is unit-tested directly, and the copy button is just a
 * thin wrapper around it.
 *
 * @param {object} result - the planner engine's output
 * @param {object} [options]
 * @param {string} [options.title] - plan title, used as the message heading
 */
export function whatsappText(result, { title = '' } = {}) {
  const lines = [`*${title.trim() || 'סידור משמרות'}*`];

  for (const day of groupAgenda(result)) {
    lines.push('', `*${formatDay(day.day)}*`);
    for (const mission of missionsInDay(day)) {
      if (mission.slots.length === 1) {
        const { start, end, entries } = mission.slots[0];
        lines.push('', `*${formatRangeShort(start, end)} ${mission.missionName}*`, joinNames(entries));
      } else {
        lines.push('', `*${mission.missionName}*`);
        for (const slot of mission.slots) {
          lines.push(`${formatTimeShort(slot.start)} - ${joinNames(slot.entries)}`);
        }
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
