import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, segmentGrid } from '../src/lib/planner.js';

/**
 * `segmentGrid` is the engine's own grid, exposed.
 *
 * It exists so anything outside `plan()` - ADR 011's solver adapter first -
 * can ask where a plan's shifts begin without building a second answer that is
 * subtly different. The whole value of that is in it being the *same* answer,
 * so these tests compare it against what the engine actually emits rather than
 * against a hand-written expectation, which would only pin the copy.
 */

const HOUR = 60 * 60 * 1000;
const BASE = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();

const emp = (id, over = {}) => ({ id, name: id, start: null, end: null, tags: [], ...over });
const mission = (id, over = {}) => ({
  id, name: id, type: 'local', count: 1, start: null, end: null,
  nightCount: null, shiftMinutes: null, nightShiftMinutes: null,
  requires: [], excludes: [], excludeEmployees: [], ...over,
});

const input = (over = {}) => ({
  start: BASE, end: BASE + 6 * HOUR, shiftMinutes: 60, strategy: 'balanced',
  employees: [emp('e1'), emp('e2'), emp('e3')],
  missions: [mission('m1')],
  pins: [], nightWindows: [], tags: [],
  ...over,
});

const gridOf = (i) => new Map(segmentGrid(i).map((g) => [g.mission.id, g.segments]));

test('every row the engine emits sits inside a segment that names the same slot', () => {
  const cases = [
    input(),
    // A mission on its own grid beside one on the house grid.
    input({ missions: [mission('m1'), mission('m2', { shiftMinutes: 120, count: 1 })] }),
    // An availability edge tearing a slot in two.
    input({ employees: [emp('e1'), emp('e2', { end: BASE + 90 * 60 * 1000 }), emp('e3')] }),
    // A night stretch with its own headcount and its own shift length.
    input({
      end: BASE + 24 * HOUR,
      nightWindows: [{ start: BASE + 14 * HOUR, end: BASE + 22 * HOUR }],
      missions: [mission('m1', { count: 2, nightCount: 1, nightShiftMinutes: 120 })],
    }),
    // A partial pin, whose bounds join its own mission's segment edges.
    input({
      missions: [mission('m1', { count: 2 })],
      pins: [{ missionId: 'm1', employeeId: 'e1', start: BASE + 90 * 60 * 1000, end: BASE + 3 * HOUR }],
    }),
  ];

  for (const [i, it] of cases.entries()) {
    const grid = gridOf(it);
    const result = plan({ ...it, onInvariantViolation: 'report' });
    for (const row of result.shifts) {
      const segments = grid.get(row.missionId);
      assert.ok(segments, `case ${i}: no grid for ${row.missionId}`);
      // A row may be several merged segments, so it has to be *covered* by
      // segments of its own slot rather than equal to one of them.
      const inSlot = segments.filter((s) => s.slot.start === row.slotStart && s.slot.end === row.slotEnd);
      assert.ok(
        inSlot.some((s) => s.start <= row.start && s.end >= row.end)
          || (inSlot.length && inSlot[0].start <= row.start && inSlot[inSlot.length - 1].end >= row.end),
        `case ${i}: row ${row.missionId} ${row.start}-${row.end} is outside its own slot's segments`,
      );
    }
  }
});

test('the grid is type-agnostic, and a caller has to know that', () => {
  // Worth pinning because it is a trap. A remote mission is one hold, one set
  // of people end to end - and the grid still cuts it on the house grid,
  // because `segmentsOf` reads shift lengths and never looks at `type`. The
  // engine gets away with it by not asking: phase 2 claims remote and daily
  // missions whole and only local missions walk the segments.
  //
  // So a caller outside the engine - ADR 011's adapter - must decide by type
  // and not by what this returns. Reading these six segments as six shifts
  // would hand a remote mission a different crew every hour.
  const it = input({ missions: [mission('m1', { type: 'remote', count: 1 })] });
  const [{ segments }] = segmentGrid(it);
  assert.equal(segments.length, 6, 'cut on the house grid, like any other mission');

  const result = plan({ ...it, onInvariantViolation: 'report' });
  const rows = result.shifts.filter((r) => r.missionId === 'm1');
  assert.equal(rows.length, 1, 'while the engine holds it whole');
  assert.deepEqual([rows[0].start, rows[0].end], [BASE, BASE + 6 * HOUR]);
});

test('a mission overriding nothing lands on the house grid exactly', () => {
  const it = input();
  const [{ segments }] = segmentGrid(it);
  assert.deepEqual(
    segments.map((s) => s.start - BASE),
    [0, HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR, 5 * HOUR],
  );
  assert.ok(segments.every((s) => s.slot.start === s.start && s.slot.end === s.end));
});

test('an availability edge tears a slot without renaming it', () => {
  // Both halves must report the one slot they are inside - that stamp, not
  // modulo arithmetic, is what mergeRows rejoins on and what ringKeys counts.
  const at = BASE + 90 * 60 * 1000;
  const it = input({ employees: [emp('e1'), emp('e2', { end: at }), emp('e3')] });
  const [{ segments }] = segmentGrid(it);
  const torn = segments.filter((s) => s.slot.start === BASE + HOUR);
  assert.equal(torn.length, 2, 'the second hour is cut in two');
  assert.deepEqual(torn.map((s) => s.end), [at, BASE + 2 * HOUR]);
  assert.ok(torn.every((s) => s.slot.end === BASE + 2 * HOUR), 'both halves name the whole hour');
});

test('the grid is a pure function of its input', () => {
  const it = input({ missions: [mission('m1'), mission('m2', { shiftMinutes: 180 })] });
  assert.deepEqual(segmentGrid(it), segmentGrid(it));
});
