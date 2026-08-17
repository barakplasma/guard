import {
  formatDay, formatRangeShort, formatTimeShort,
} from './format.js';
import { groupAgenda } from './agenda.js';

/**
 * How many of the day's slots each mission appears in. A mission seen once (a
 * remote mission, a one-off pin) gets its own range-in-header block; anything
 * seen more than once rotates through the day and is eligible to merge with
 * any other rotating mission active at the same clock time.
 */
function countOccurrences(day) {
  const counts = new Map();
  for (const slot of day.slots) {
    for (const mission of slot.missions) {
      counts.set(mission.missionId, (counts.get(mission.missionId) ?? 0) + 1);
    }
  }
  return counts;
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
 * Rotating missions active at the same clock time share one header and one row -
 * e.g. two guard posts rotating hourly read as one "*post A, post B*" block with
 * "7:00 - X, Y" underneath, rather than two separate blocks repeating every hour.
 * The row is positional: each mission's names appear in the same left-to-right
 * order the header lists the missions in, not resorted by name. The header
 * reprints whenever the active mission set changes, or anything else (a one-off
 * mission's own block) is rendered in between - so a reader scanning down never
 * has to guess which header a row still belongs to.
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
    const occurrences = countOccurrences(day);
    // The mission ids of the currently open rotating-row header, or null when
    // the next rotating row must start a fresh one instead of continuing it.
    let run = null;

    for (const slot of day.slots) {
      const singleOccurrence = slot.missions.filter((m) => occurrences.get(m.missionId) === 1);
      const rotating = slot.missions.filter((m) => occurrences.get(m.missionId) !== 1);

      for (const mission of singleOccurrence) {
        lines.push('', `*${formatRangeShort(slot.start, slot.end)} ${mission.missionName}*`, joinNames(mission.entries));
        run = null;
      }

      if (rotating.length > 0) {
        const missionIds = rotating.map((m) => m.missionId);
        const continuesRun = run
          && run.length === missionIds.length
          && run.every((id, i) => id === missionIds[i]);
        if (!continuesRun) {
          lines.push('', `*${rotating.map((m) => m.missionName).join(', ')}*`);
          run = missionIds;
        }
        const names = rotating.map((m) => joinNames(m.entries)).join(', ');
        lines.push(`${formatTimeShort(slot.start)} - ${names}`);
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
