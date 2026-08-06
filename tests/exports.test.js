import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftsToCsv } from '../src/lib/exportCsv.js';
import { whatsappText, whatsappShareLink } from '../src/lib/exportText.js';
import { groupAgenda, offDutyDuring } from '../src/lib/agenda.js';
import { plan } from '../src/lib/planner.js';

const HOUR = 3600 * 1000;
const START = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();

/** A small, fully determined schedule the assertions can be written against. */
function schedule() {
  return plan({
    start: START,
    end: START + 2 * HOUR,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'אבי' },
      { id: 'e2', name: 'דנה' },
      { id: 'e3', name: 'יוסי' },
    ],
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 1 }],
  });
}

/* --- CSV ------------------------------------------------------------- */

test('CSV starts with a BOM so Excel reads Hebrew correctly', () => {
  const csv = shiftsToCsv(schedule());
  assert.equal(csv.charCodeAt(0), 0xfeff);
});

test('CSV has a header row and one row per shift', () => {
  const result = schedule();
  const lines = shiftsToCsv(result).replace(/^﻿/, '').trimEnd().split('\r\n');
  assert.equal(lines.length, result.shifts.length + 1);
  assert.equal(lines[0], 'תאריך,שעת התחלה,שעת סיום,שם השומר,שם המשימה,סוג,שיבוץ ידני');
  assert.deepEqual(lines[1].split(','), ['05.01.2026', '08:00', '09:00', 'אבי', 'שער', 'מקומית', '']);
});

test('CSV emits a separate row for every simultaneous mission assignment', () => {
  const result = plan({
    start: START,
    end: START + HOUR,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'אבי' },
      { id: 'e2', name: 'דנה' },
    ],
    missions: [{ id: 'm1', name: 'שער כפול', type: 'local', count: 2 }],
  });
  const lines = shiftsToCsv(result).replace(/^﻿/, '').trimEnd().split('\r\n');

  assert.equal(result.shifts.length, 2);
  assert.equal(lines.length, 3);
  const assignmentRows = lines.slice(1).map((line) => line.split(','));
  assert.deepEqual(assignmentRows.map((row) => [row[0], row[1], row[2], row[4]]), [
    ['05.01.2026', '08:00', '09:00', 'שער כפול'],
    ['05.01.2026', '08:00', '09:00', 'שער כפול'],
  ]);
  assert.deepEqual(new Set(assignmentRows.map((row) => row[3])), new Set(['אבי', 'דנה']));
});

test('CSV escapes quotes and commas', () => {
  const result = plan({
    start: START,
    end: START + HOUR,
    shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'O\'Brien, Sean "Red"' }],
    missions: [{ id: 'm1', name: 'Gate, North', type: 'local', count: 1 }],
  });
  const csv = shiftsToCsv(result);
  assert.ok(csv.includes('"Gate, North"'), 'a comma forces quoting');
  assert.ok(csv.includes('"O\'Brien, Sean ""Red"""'), 'inner quotes are doubled');
});

test('CSV marks manual assignments', () => {
  const result = plan({
    start: START,
    end: START + HOUR,
    shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'אבי' }, { id: 'e2', name: 'דנה' }],
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 1 }],
    pins: [{ missionId: 'm1', employeeId: 'e2' }],
  });
  const rows = shiftsToCsv(result).replace(/^﻿/, '').trimEnd().split('\r\n');
  const pinnedRow = rows.slice(1).map((row) => row.split(',')).find((row) => row[3] === 'דנה');
  assert.equal(pinnedRow?.[6], 'כן', 'the pinned row is flagged');
});

/* --- WhatsApp -------------------------------------------------------- */

test('WhatsApp text uses WhatsApp markup and lists people per mission', () => {
  const result = schedule();
  const text = whatsappText(result, { title: 'סופ״ש' });
  const lines = text.split('\n');

  assert.equal(lines[0], '*סופ״ש*');
  assert.ok(lines.some((l) => /^\*.+\*$/.test(l) && l !== '*סופ״ש*'), 'a bold day header');
  assert.ok(lines.some((l) => /^\d{2}:\d{2}–\d{2}:\d{2}$/.test(l)), 'a time range line');
  assert.ok(lines.some((l) => l.startsWith('• *שער*: ')), 'a bulleted mission line');

  // Every scheduled person appears somewhere in the message.
  for (const s of result.shifts) assert.ok(text.includes(s.employeeName));
});

test('WhatsApp text falls back to a default heading', () => {
  const text = whatsappText(schedule(), {});
  assert.equal(text.split('\n')[0], '*סידור משמרות*');
});

test('WhatsApp text can append the off-duty list', () => {
  const result = schedule();
  const employeeNames = new Map([['e1', 'אבי'], ['e2', 'דנה'], ['e3', 'יוסי']]);

  const without = whatsappText(result, { employeeNames });
  assert.ok(!without.includes('פנויים:'));

  const withOff = whatsappText(result, { employeeNames, includeOffDuty: true });
  assert.ok(withOff.includes('פנויים:'), 'off-duty line is present when asked for');
});

test('an empty schedule produces a readable message rather than a bare heading', () => {
  const result = plan({
    start: START,
    end: START + HOUR,
    shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'אבי' }],
    missions: [],
  });
  const text = whatsappText(result, { title: 'ריק' });
  assert.ok(text.includes('אין משמרות משובצות.'));
});

test('the wa.me link escapes the message', () => {
  const link = whatsappShareLink('*כותרת*\n• שער: אבי');
  assert.ok(link.startsWith('https://wa.me/?text='));
  assert.ok(!link.includes('\n'), 'newlines must be percent-encoded');
  assert.equal(decodeURIComponent(link.split('text=')[1]), '*כותרת*\n• שער: אבי');
});

/* --- agenda grouping ------------------------------------------------- */

test('groupAgenda buckets shifts by day and slot', () => {
  const result = schedule();
  const days = groupAgenda(result);
  assert.equal(days.length, 1, 'a two-hour plan spans one day');
  assert.equal(days[0].slots.length, 2, 'two hourly slots');
  for (const slot of days[0].slots) {
    assert.equal(slot.missions.length, 1);
    assert.equal(slot.missions[0].missionName, 'שער');
  }
});

test('offDutyDuring only lists people free for the whole slot', () => {
  const result = schedule();
  const slot = groupAgenda(result)[0].slots[0];
  const free = offDutyDuring(result, slot.start, slot.end);
  const onDuty = result.shifts
    .filter((s) => s.start < slot.end && s.end > slot.start)
    .map((s) => s.employeeId);
  for (const id of onDuty) assert.ok(!free.includes(id), 'someone on duty was listed as free');
  assert.equal(free.length + onDuty.length, 3);
});

/* --- range formatting ------------------------------------------------ */

test('a range that crosses midnight shows the end date', async () => {
  const { formatRange } = await import('../src/lib/format.js');
  const sameDay = formatRange(START, START + 2 * HOUR);
  assert.ok(!sameDay.includes('('), `expected no date suffix, got ${sameDay}`);

  // A 24-hour remote mission would otherwise read as "08:00–08:00".
  const overnight = formatRange(START, START + 24 * HOUR);
  assert.ok(overnight.includes('('), `expected a date suffix, got ${overnight}`);
  assert.ok(overnight.startsWith('08:00–08:00 ('), overnight);
});
