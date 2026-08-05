import { formatDate, formatTime } from './format.js';

const HEADERS = ['משימה', 'סוג', 'תאריך', 'התחלה', 'סיום', 'עובד', 'שיבוץ ידני'];

const TYPE_LABEL = { remote: 'מרוחקת', local: 'מקומית' };

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
export function shiftsToCsv(result) {
  const rows = [HEADERS];
  for (const s of result.shifts) {
    rows.push([
      s.missionName,
      TYPE_LABEL[s.type] ?? s.type,
      formatDate(s.start),
      formatTime(s.start),
      formatTime(s.end),
      s.employeeName,
      s.pinned ? 'כן' : '',
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
