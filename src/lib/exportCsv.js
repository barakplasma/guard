import { formatDate, formatTime } from './format.js';

const HEADERS = ['תאריך', 'שעת התחלה', 'שעת סיום', 'שם השומר', 'שם המשימה', 'סוג', 'שיבוץ ידני'];

const TYPE_LABEL = { remote: 'מרוחקת', local: 'מקומית', daily: 'יומית' };

function cell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV of every shift.
 *
 * Prefixed with a UTF-8 BOM because Excel otherwise opens Hebrew as mojibake -
 * which is the whole point of exporting for most people here. CRLF line endings
 * for the same reason.
 */
export function shiftsToCsv(result, { tags = [], missions = [] } = {}) {
  const named = (id) => tags.find((t) => t.id === id)?.name ?? id;
  const qualified = tags.length > 0 || result.shifts.some((s) => s.qualifications?.length);
  const overnight = result.shifts.some((s) => formatDate(s.start) !== formatDate(s.end));
  const rows = [[...HEADERS, ...(overnight ? ['תאריך סיום'] : []), ...(qualified ? ['הסמכות', 'הסמכות נדרשות'] : [])]];
  for (const s of result.shifts) {
    rows.push([
      formatDate(s.start),
      formatTime(s.start),
      formatTime(s.end),
      s.employeeName,
      s.missionName,
      TYPE_LABEL[s.type] ?? s.type,
      s.pinned ? 'כן' : '',
      ...(overnight ? [formatDate(s.end)] : []),
      ...(qualified ? [(s.qualifications ?? []).map(named).join(' / '),
        (missions.find((m) => m.id === s.missionId)?.requires ?? []).map((r) => `${named(r.tag)} × ${r.count}`).join(' / ')] : []),
    ]);
  }
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** Trigger a browser download of `text` as `filename`. */
export function downloadCsv(text, filename = 'shifts.csv') {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: revoking synchronously can cancel the download in
  // some browsers before it has actually started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
