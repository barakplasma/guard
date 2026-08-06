import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftsToCsv } from '../src/lib/exportCsv.js';
import { whatsappText, whatsappShareLink } from '../src/lib/exportText.js';
import { groupAgenda, offDutyDuring } from '../src/lib/agenda.js';
import { employeeIcs, overviewIcs } from '../src/lib/exportIcal.js';
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

/* --- iCal -------------------------------------------------------------- */

/** Two people sharing every shift of a single mission, so co-workers are non-empty. */
function schedulePair() {
  return plan({
    start: START,
    end: START + HOUR,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'אבי' },
      { id: 'e2', name: 'דנה' },
    ],
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 2 }],
  });
}

test('an ICS calendar is wrapped in VCALENDAR/VERSION 2.0', () => {
  const ics = overviewIcs(schedulePair(), { title: 'בדיקה' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('VERSION:2.0\r\n'));
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
});

test('overviewIcs makes one VEVENT per mission per shift, listing everyone on it', () => {
  const result = schedulePair();
  const ics = overviewIcs(result, { title: 'בדיקה' });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1, 'one shared slot -> one event');
  assert.ok(ics.includes('SUMMARY:שער'));
  assert.ok(ics.includes('DESCRIPTION:אבי\\, דנה') || ics.includes('DESCRIPTION:דנה\\, אבי'));
});

test('employeeIcs makes one VEVENT per shift of that employee only', () => {
  const result = schedule();
  const mine = result.shifts.filter((s) => s.employeeId === 'e1');
  const ics = employeeIcs(result, { employeeId: 'e1', employeeName: 'אבי' });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, mine.length);
});

test('employeeIcs describes co-workers on the same mission and shift', () => {
  const result = schedulePair();
  const ics = employeeIcs(result, { employeeId: 'e1', employeeName: 'אבי' });
  const descLine = ics.split('\r\n').find((l) => l.startsWith('DESCRIPTION:'));
  assert.ok(ics.includes('SUMMARY:שער'));
  assert.ok(descLine?.includes('דנה'), 'the other person on the same shift is named');
  assert.ok(!descLine?.includes('אבי'), 'the employee is not listed as their own co-worker');
});

test('employeeIcs omits DESCRIPTION when the employee works alone', () => {
  const result = schedule();
  const ics = employeeIcs(result, { employeeId: 'e1', employeeName: 'אבי' });
  assert.ok(!ics.includes('DESCRIPTION:'));
});

test('ICS escapes commas, semicolons and backslashes in text', () => {
  const result = plan({
    start: START,
    end: START + HOUR,
    shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'A; B\\C' }],
    missions: [{ id: 'm1', name: 'Gate, North', type: 'local', count: 1 }],
  });
  const ics = overviewIcs(result);
  assert.ok(ics.includes('SUMMARY:Gate\\, North'));
  assert.ok(ics.includes('DESCRIPTION:A\\; B\\\\C'));
});

test('a long Hebrew mission name survives a long line intact', () => {
  const longName = 'משימה '.repeat(30).trim();
  const result = plan({
    start: START,
    end: START + HOUR,
    shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'אבי' }],
    missions: [{ id: 'm1', name: longName, type: 'local', count: 1 }],
  });
  const ics = overviewIcs(result);
  // Folding is the `ics` library's job, not ours - the RFC only "SHOULD"s a 75
  // octet line length, and real calendar clients (Google Calendar included)
  // are tolerant of long lines. What matters here is that the library's own
  // fold/unfold round trip does not corrupt Hebrew (multi-byte UTF-8) text.
  const unfolded = ics.replace(/\r\n[ \t]/g, '');
  assert.ok(unfolded.includes(`SUMMARY:${longName}`), 'unfolding the wrapped line recovers the full name');
  assert.ok(!ics.includes('�'), 'no mangled characters from a mid-codepoint fold');
});

test('ICS UIDs are stable for the same input', () => {
  const result = schedulePair();
  const a = overviewIcs(result, { title: 'בדיקה', now: START });
  const b = overviewIcs(result, { title: 'בדיקה', now: START + HOUR });
  assert.equal(a.match(/UID:[^\r\n]+/)[0], b.match(/UID:[^\r\n]+/)[0], 'UID must not depend on generation time');
});

test('ICS DTSTART/DTEND/DTSTAMP use UTC basic format', () => {
  const ics = overviewIcs(schedulePair());
  assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z/);
  assert.match(ics, /DTSTART:\d{8}T\d{6}Z/);
  assert.match(ics, /DTEND:\d{8}T\d{6}Z/);
});

test('ICS UIDs are namespaced by the plan, so two plans reusing the same short ids never collide', () => {
  const planA = plan({
    start: START,
    end: START + HOUR,
    shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'אבי' }],
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 1 }],
  });
  const planB = plan({
    start: START,
    end: START + HOUR,
    shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'דנה' }],
    missions: [{ id: 'm1', name: 'ריכוז', type: 'local', count: 1 }],
  });

  const uidA = overviewIcs(planA).match(/UID:[^\r\n]+/)[0];
  const uidB = overviewIcs(planB).match(/UID:[^\r\n]+/)[0];
  assert.notEqual(uidA, uidB, 'two unrelated plans with the same mission/employee ids must not collide');

  const empUidA = employeeIcs(planA, { employeeId: 'e1', employeeName: 'אבי' }).match(/UID:[^\r\n]+/)[0];
  const empUidB = employeeIcs(planB, { employeeId: 'e1', employeeName: 'דנה' }).match(/UID:[^\r\n]+/)[0];
  assert.notEqual(empUidA, empUidB, 'the per-employee export must also be namespaced by plan');
});

/**
 * A pin can cover a mission for a custom range while an auto-assigned neighbour
 * only fills part of it (their availability starts mid-shift, say), so two
 * coworkers on the same mission at the same moment can end up with different
 * row boundaries: one wholesale row spanning the whole window, another split
 * at wherever the auto-fill kicked in.
 */
function scheduleStaggeredCoworkers() {
  const missionEnd = START + 2 * HOUR;
  return plan({
    start: START,
    end: missionEnd,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'אבי' },
      { id: 'e2', name: 'דנה' },
    ],
    missions: [{ id: 'm1', name: 'שער', type: 'local', count: 2 }],
    pins: [
      { missionId: 'm1', employeeId: 'e1' }, // whole mission window
      { missionId: 'm1', employeeId: 'e2', start: START + HOUR / 2 },
    ],
  });
}

test('employeeIcs finds a coworker whose row overlaps without matching it exactly', () => {
  const result = scheduleStaggeredCoworkers();
  // Sanity check: this scenario really does stagger row boundaries rather
  // than collapsing into one shared range.
  const distinctRanges = new Set(result.shifts.map((s) => `${s.start}-${s.end}`));
  assert.ok(distinctRanges.size > 1, 'the scenario must actually produce staggered row boundaries');

  const ics = employeeIcs(result, { employeeId: 'e1', employeeName: 'אבי' });
  const descLine = ics.split('\r\n').find((l) => l.startsWith('DESCRIPTION:'));
  assert.ok(descLine?.includes('דנה'), 'a coworker on an overlapping-but-different range is still found');
});

test('overviewIcs slices a mission at roster changes, combining genuinely overlapping coworkers', () => {
  // אבי covers the whole two hours; דנה only joins for the second half. So
  // there really are two distinct rosters here - the fix is not that this
  // collapses into one event, but that the *overlapping* half (both of them,
  // together) is not wrongly split into two single-person events the way
  // exact-range matching would split it.
  const result = scheduleStaggeredCoworkers();
  const ics = overviewIcs(result);
  const events = ics.split('BEGIN:VEVENT').slice(1);
  assert.equal(events.length, 2, 'one event for the אבי-only half, one for the shared half');

  const descriptions = events.map((e) => e.match(/DESCRIPTION:([^\r\n]+)/)?.[1] ?? '');
  const soloEvent = descriptions.find((d) => !d.includes('דנה'));
  const sharedEvent = descriptions.find((d) => d.includes('דנה'));
  assert.ok(soloEvent?.includes('אבי'), 'the אבי-only half lists just אבי');
  assert.ok(sharedEvent?.includes('אבי'), 'the shared half lists both coworkers, not just the one whose row starts there');
});
