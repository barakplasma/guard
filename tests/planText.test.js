import test from 'node:test';
import assert from 'node:assert/strict';
import { planToReadableText } from '../src/lib/planText.js';
import { planSchema } from '../src/lib/planSchema.js';

const HOUR = 3600 * 1000;
const START = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();

const doc = (over = {}) => planSchema.parse({
  version: 1,
  title: 'סוף שבוע',
  start: START,
  end: START + 4 * HOUR,
  shiftMinutes: 60,
  employees: [
    { id: 'e1', name: 'אבי', start: null, end: null },
    { id: 'e2', name: 'דנה', start: START + HOUR, end: START + 3 * HOUR },
  ],
  missions: [
    { id: 'm1', name: 'שער', type: 'local', start: null, end: null, count: 2 },
  ],
  pins: [],
  ...over,
});

test('lists the title, period, and shift length', () => {
  const text = planToReadableText(doc());
  const lines = text.split('\n');
  assert.equal(lines[0], 'סוף שבוע');
  assert.ok(lines.some((l) => l.includes('60')));
});

test('an unrestricted employee reads as "whole period", a limited one shows its range', () => {
  const text = planToReadableText(doc());
  assert.ok(text.includes('אבי: כל התקופה'));
  assert.ok(text.includes('דנה: 09:00'));
});

test('a mission shows its type and headcount', () => {
  const text = planToReadableText(doc());
  assert.ok(text.includes('שער (מקומית, 2): כל התקופה'));
});

test('a whole-mission pin reads distinctly from a per-shift one', () => {
  const text = planToReadableText(doc({
    pins: [
      { missionId: 'm1', employeeId: 'e1', start: null, end: null },
      { missionId: 'm1', employeeId: 'e2', start: START, end: START + HOUR },
    ],
  }));
  assert.ok(text.includes('אבי ← שער: כל המשימה'));
  assert.ok(text.includes('דנה ← שער: 08:00'));
});

test('a pin with only one endpoint set resolves the other from the mission/plan, not a literal null', () => {
  const text = planToReadableText(doc({
    pins: [
      // Only `start` set - `end` must inherit the mission's end (START + 4h),
      // not print as the Unix epoch.
      { missionId: 'm1', employeeId: 'e1', start: START + HOUR, end: null },
    ],
  }));
  assert.ok(text.includes('אבי ← שער: 09:00'));
  assert.ok(!text.includes('1970'));
});

test('a frozen pin is noted as such', () => {
  const text = planToReadableText(doc({
    pins: [{ missionId: 'm1', employeeId: 'e1', start: null, end: null, frozen: true }],
  }));
  assert.ok(text.includes('הוקפא אוטומטית'));
});

test('an empty plan says so for each section rather than rendering nothing', () => {
  const text = planToReadableText(doc({ employees: [], missions: [], pins: [] }));
  assert.ok(text.includes('עדיין לא הוגדרו עובדים'));
  assert.ok(text.includes('עדיין לא הוגדרו משימות'));
  assert.ok(text.includes('אין שיבוצים ידניים'));
});

test('a pin referencing a name that no longer exists still renders using the raw id', () => {
  const text = planToReadableText(doc({
    pins: [{ missionId: 'gone', employeeId: 'e1', start: null, end: null }],
  }));
  assert.ok(text.includes('אבי ← gone'));
});
