import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedPins, countAt, normalizedInput, segmentGrid } from '../src/lib/planner.js';
import { nightWindows, toPlannerInput } from '../src/lib/planSchema.js';
import { MAX_UNBROKEN_MINUTES } from '../src/lib/strategies.js';
import {
  buildGlobalSegmentGrid, compileInstance, deriveSymmetryClasses, enumerateLongRunWindows,
  enumerateSleepWindows, seatsWantedMatrix,
} from '../src/solver/compile.ts';
import { TARGET_REST_MINUTES } from '../src/solver/types.ts';
import {
  compiled, docOf, HOUR, loggedPin, people, prepared,
} from './solverHelpers.js';

/**
 * Compilation is where the engine's answers become the model's parameters, so
 * every assertion here is of the form "this equals what `src/lib` already
 * says". A second implementation of the grid, the demand or the pins would
 * disagree with the engine about what a shift is, in a way neither side
 * reveals on its own reading.
 */

const START = new Date(2026, 0, 5, 12, 0, 0, 0).getTime();

test('seatsWanted equals countAt, per mission and per segment', () => {
  const doc = docOf({
    start: START,
    employees: people(4),
    missions: [
      { id: 'm1', name: 'Gate', type: 'local', count: 2, nightCount: 1 },
      { id: 'm2', name: 'Patrol', type: 'remote', count: 1 },
    ],
  });
  const { problem, instance, index } = compiled(doc);
  const normalized = normalizedInput(toPlannerInput(doc, doc.start));
  const nights = nightWindows(doc);

  index.missionIds.forEach((missionId, missionIndex) => {
    const mission = normalized.missions.find((m) => m.id === missionId);
    index.segments.forEach((segment, segmentIndex) => {
      const running = segment.start < mission.end && mission.start < segment.end;
      const wanted = instance.seatsWanted[missionIndex][segmentIndex];
      if (!running) { assert.equal(wanted, 0); return; }
      const expected = mission.type === 'local'
        ? countAt(mission, segment.start, nights)
        : mission.count;
      assert.equal(wanted, expected, `${missionId} at segment ${segmentIndex}`);
    });
  });
  assert.equal(problem.issues.length, 0);
});

test('the global grid is the union of every mission\'s own segment edges', () => {
  const doc = docOf({
    start: START,
    end: START + 6 * HOUR,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'A' },
      { id: 'e2', name: 'B', start: START + 90 * 60_000, end: START + 5 * HOUR },
    ],
    missions: [
      { id: 'm1', name: 'Gate', type: 'local', count: 1 },
      { id: 'm2', name: 'Ops', type: 'local', count: 1, shiftMinutes: 120 },
    ],
  });
  const problem = prepared(doc);
  const { segments } = buildGlobalSegmentGrid(problem);
  const mine = new Set(segments.flatMap((s) => [s.start, s.end]));

  for (const entry of segmentGrid(toPlannerInput(doc, doc.start))) {
    for (const segment of entry.segments) {
      assert.ok(mine.has(segment.start), `edge ${segment.start} of ${entry.mission.id}`);
      assert.ok(mine.has(segment.end), `edge ${segment.end} of ${entry.mission.id}`);
    }
  }
});

test('commitments are exactly the pins the engine accepted', () => {
  const doc = docOf({
    start: START,
    end: START + 4 * HOUR,
    employees: people(3),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
    pins: [
      { missionId: 'm1', employeeId: 'e1', start: START, end: START + HOUR },
      // Contested: the same seat, later in the document, so the engine drops it.
      { missionId: 'm1', employeeId: 'e2', start: START, end: START + HOUR },
    ],
  });
  const input = toPlannerInput(doc, doc.start);
  const accepted = acceptedPins(input);
  const problem = prepared(doc);

  assert.equal(problem.commitments.length, accepted.length);
  for (const pin of accepted) {
    assert.ok(problem.commitments.some((c) => c.employeeId === pin.employeeId
      && c.missionId === pin.missionId
      && c.coverage.start === pin.start && c.coverage.end === pin.end));
  }
  // And the pin the engine refused is reported, not swallowed.
  assert.ok(problem.issues.some((issue) => issue.code === 'pin-overflow' || issue.code === 'pin-conflict'));
});

test('an elapsed segment with a record keeps the headcount that was stood', () => {
  const doc = docOf({
    start: START,
    end: START + 4 * HOUR,
    employees: people(4),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 3 }],
    pins: [loggedPin({ missionId: 'm1', employeeId: 'e1', start: START, end: START + HOUR })],
  });
  // An hour has elapsed: the first segment is a log, the rest is a schedule.
  const problem = prepared(doc, START + HOUR);
  const { segments } = buildGlobalSegmentGrid(problem);
  const seats = seatsWantedMatrix(problem, segments);

  const elapsed = segments.findIndex((s) => s.end <= START + HOUR);
  assert.equal(seats[0][elapsed], 1, 'one person was recorded, so one is what it wanted');
  const later = segments.findIndex((s) => s.start >= START + HOUR);
  assert.equal(seats[0][later], 3, 'the future is staffed by today\'s headcount');
});

test('an elapsed segment with no record is prepared like any other', () => {
  const doc = docOf({
    start: START,
    end: START + 4 * HOUR,
    employees: people(4),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 3 }],
  });
  const problem = prepared(doc, START + HOUR);
  const { segments } = buildGlobalSegmentGrid(problem);
  const seats = seatsWantedMatrix(problem, segments);
  assert.equal(seats[0][0], 3);
});

test('symmetry classes exclude anyone a commitment names', () => {
  const doc = docOf({
    start: START,
    end: START + 3 * HOUR,
    employees: people(3),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
    pins: [{ missionId: 'm1', employeeId: 'e2', start: START, end: START + HOUR }],
  });
  const { problem, instance } = compiled(doc);
  const committed = problem.employees.findIndex((e) => e.id === 'e2');
  assert.equal(instance.symmetryClass[committed], 0, 'a pinned row is not a permutation to prune');
});

test('three identical people share one symmetry class', () => {
  const doc = docOf({
    start: START,
    end: START + 3 * HOUR,
    employees: people(3),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
  });
  const { instance } = compiled(doc);
  assert.deepEqual(new Set(instance.symmetryClass).size, 1);
  assert.ok(instance.symmetryClass.every((value) => value === 1));
});

test('deriveSymmetryClasses only groups adjacent rows, which is what the model can order', () => {
  const doc = docOf({
    start: START,
    end: START + 2 * HOUR,
    employees: [
      { id: 'e1', name: 'A' },
      { id: 'e2', name: 'B', start: START, end: START + HOUR },
      { id: 'e3', name: 'C' },
    ],
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
  });
  const { problem, instance, index } = compiled(doc);
  const classes = deriveSymmetryClasses(
    problem,
    problem.employees.map((_, i) => index.segments.map((__, s) => instance.isAvailable[i][s])),
    instance.isAllowed,
    instance.holdsRequirement,
    {
      idleMinutesAtHorizonStart: instance.idleMinutesAtHorizonStart,
      recentTurns: instance.recentTurns,
      recentNightMinutes: instance.recentNightMinutes,
      recentTurnsOnMission: instance.recentTurnsOnMission,
      heldWithinCooldown: instance.heldWithinCooldown,
      recentHourHolds: instance.recentHourHolds,
      repeatAfterDays: instance.repeatAfterDays,
    },
  );
  // e1 and e3 are identical but not adjacent, so neither may be ordered
  // against the other by the model's `symmetryClass[e] == symmetryClass[e+1]`.
  assert.deepEqual(classes, [0, 0, 0]);
});

test('long-run windows are minimal and use ADR 016\'s own constant', () => {
  const segments = Array.from({ length: 10 }, (_, i) => ({
    start: START + i * HOUR, end: START + (i + 1) * HOUR,
  }));
  const windows = enumerateLongRunWindows(segments);
  assert.equal(MAX_UNBROKEN_MINUTES, 360);
  // Seven hourly segments exceed six hours; the minimal window is seven long.
  assert.deepEqual(windows.first.slice(0, 2), [1, 2]);
  assert.deepEqual(windows.last.slice(0, 2), [7, 8]);
  for (let i = 0; i < windows.first.length; i++) {
    const span = windows.last[i] - windows.first[i] + 1;
    assert.equal(span, 7, 'no window is longer than it has to be');
  }
});

test('sleep windows stay inside one night and reach the eight-hour target', () => {
  const doc = docOf({
    start: new Date(2026, 0, 5, 18, 0, 0, 0).getTime(),
    end: new Date(2026, 0, 6, 12, 0, 0, 0).getTime(),
    employees: people(2),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
  });
  const { problem, instance, index } = compiled(doc);
  const windows = enumerateSleepWindows(index.segments, instance.nightOfSegment);
  assert.ok(windows.first.length > 0, 'a 22:00-06:00 night holds an eight-hour window');
  for (let i = 0; i < windows.first.length; i++) {
    const night = windows.night[i];
    let minutes = 0;
    for (let s = windows.first[i] - 1; s < windows.last[i]; s++) {
      assert.equal(instance.nightOfSegment[s], night, 'a sleep window never leaves its night');
      minutes += instance.segmentMinutes[s];
    }
    assert.ok(minutes >= TARGET_REST_MINUTES);
    assert.ok(minutes - instance.segmentMinutes[windows.last[i] - 1] < TARGET_REST_MINUTES, 'minimal');
  }
  assert.ok(problem.nights.length >= 1);
});

test('compiling is deterministic: the same document gives the same instance', () => {
  const doc = docOf({
    start: START,
    employees: people(5),
    missions: [
      { id: 'm1', name: 'Gate', type: 'local', count: 1, nightCount: 2 },
      { id: 'm2', name: 'Patrol', type: 'remote', count: 1 },
    ],
  });
  const a = compileInstance(prepared(doc));
  const b = compileInstance(prepared(doc));
  assert.deepEqual(a.instance, b.instance);
  assert.equal(prepared(doc).revision, prepared(doc).revision);
});

test('a rename does not change the revision, because names never reach the solver', () => {
  const base = {
    start: START,
    employees: people(3),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
  };
  const before = prepared(docOf(base));
  const renamed = prepared(docOf({
    ...base,
    employees: base.employees.map((e) => ({ ...e, name: `${e.name} renamed` })),
    missions: [{ id: 'm1', name: 'Front gate', type: 'local', count: 1 }],
  }));
  assert.equal(before.revision, renamed.revision);
});

test('a remote mission is one hold, a daily mission one hold per occurrence', () => {
  const doc = docOf({
    start: START,
    end: START + 2 * 24 * HOUR,
    employees: people(3),
    missions: [
      { id: 'm1', name: 'Patrol', type: 'remote', count: 1 },
      { id: 'm2', name: 'Kitchen', type: 'daily', count: 1, dayStart: 8 * 60, dayEnd: 16 * 60 },
    ],
  });
  const { instance, index } = compiled(doc);
  const remote = index.missionIds.indexOf('m1');
  const daily = index.missionIds.indexOf('m2');
  assert.equal(new Set(instance.holdOfSegment[remote].filter(Boolean)).size, 1);
  assert.ok(new Set(instance.holdOfSegment[daily].filter(Boolean)).size >= 2);
});
