import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { plan } from '../src/lib/planner.js';
import { nightWindows } from '../src/lib/planSchema.js';

const MIN = 60 * 1000;
const BASE = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();

/**
 * Random but well-formed plan documents. Property tests here guard the things
 * that must hold for *every* input, not just the hand-written scenarios:
 * no double-booking, no overstaffing, availability respected, determinism.
 */
const planArb = fc.record({
  hours: fc.integer({ min: 1, max: 12 }),
  strategy: fc.constantFrom('balanced', 'rotation'),
  shiftMinutes: fc.constantFrom(30, 60, 90, 120),
  restMinutes: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 480 })),
  employeeCount: fc.integer({ min: 1, max: 8 }),
  missions: fc.array(
    fc.record({
      type: fc.constantFrom('local', 'remote', 'daily'),
      qualified: fc.boolean(),
      exclude: fc.boolean(),
      count: fc.integer({ min: 1, max: 3 }),
      nightCount: fc.integer({ min: 1, max: 3 }),
      // A grid of its own, or the plan's - and by night, a third possibility
      // again. Mixed grids beside each other are the case the properties
      // below have to keep holding for; `null` keeps plenty of missions on the
      // shared grid so the two paths are exercised together.
      shiftMinutes: fc.constantFrom(null, 60, 120, 180),
      nightShiftMinutes: fc.constantFrom(null, 60, 120, 180),
      offsetMin: fc.integer({ min: 0, max: 300 }),
      lengthMin: fc.integer({ min: 30, max: 600 }),
    }),
    { minLength: 1, maxLength: 4 },
  ),
  pins: fc.array(fc.record({ employee: fc.nat(), mission: fc.nat(),
    whole: fc.boolean(), frozen: fc.boolean(), from: fc.integer({ min: 0, max: 300 }),
    length: fc.integer({ min: 1, max: 180 }),
  }), { maxLength: 6 }),
  limited: fc.array(fc.record({
    index: fc.nat(),
    fromMin: fc.integer({ min: 0, max: 300 }),
  }), { maxLength: 3 }),
  // Boundaries on and off the shift grid, and the degenerate equal pair.
  nightStart: fc.constantFrom(0, 6 * 60, 22 * 60, 23 * 60 + 30),
  nightEnd: fc.constantFrom(0, 5 * 60, 6 * 60, 8 * 60),
});

function build(spec) {
  const start = BASE;
  const end = start + spec.hours * 60 * MIN;

  const employees = Array.from({ length: spec.employeeCount }, (_, i) => ({
    id: `e${i + 1}`,
    name: `Emp${i + 1}`,
    tags: i % 2 ? ['driver'] : [],
  }));
  for (const l of spec.limited) {
    const e = employees[l.index % employees.length];
    // Keep at least a minute of real availability: an employee whose window
    // falls entirely outside the plan is a documented throw, not an invariant
    // violation, and is covered by the unit tests instead.
    if (e) e.start = start + Math.min(l.fromMin, spec.hours * 60 - 1) * MIN;
  }

  const missions = spec.missions.map((m, i) => ({
    id: `m${i + 1}`,
    name: `M${i + 1}`,
    type: m.type,
    requires: m.qualified ? [{ tag: 'driver', count: 1 }] : [],
    excludes: m.exclude ? ['driver'] : [],
    start: start + m.offsetMin * MIN,
    end: start + (m.offsetMin + m.lengthMin) * MIN,
    count: m.count,
    nightCount: m.nightCount,
    shiftMinutes: m.shiftMinutes,
    nightShiftMinutes: m.nightShiftMinutes,
  })).filter((m) => m.start < end);

  for (const m of missions) if (m.type === 'daily') {
    const middle = m.start + (m.end - m.start) / 2;
    m.occurrences = [{ start: m.start, end: middle }, { start: middle, end: m.end }];
  }
  return {
    tags: [{ id: 'driver', name: 'Driver', minNightRestMinutes: spec.restMinutes }],
    pins: missions.length ? spec.pins.map((p) => ({
      employeeId: employees[p.employee % employees.length].id,
      missionId: missions[p.mission % missions.length].id, frozen: p.frozen,
      ...(p.whole ? {} : { start: start + p.from * MIN, end: start + (p.from + p.length) * MIN }),
    })) : [],
    start,
    end,
    shiftMinutes: spec.shiftMinutes,
    strategy: spec.strategy,
    employees,
    missions,
    nightWindows: nightWindows({
      start, end, nightStart: spec.nightStart, nightEnd: spec.nightEnd,
    }),
  };
}

/**
 * What a mission is allowed to have on at `t`. A remote mission is held whole
 * by one set of people and never varies; a local one takes its night headcount
 * inside a night window.
 */
function seatsAt(input, mission, t) {
  if (mission.type !== 'local') return mission.count;
  const night = input.nightWindows.some((w) => t >= w.start && t < w.end);
  return night ? mission.nightCount : mission.count;
}

function forEveryPlan(assertion, numRuns = 300) {
  fc.assert(fc.property(planArb, (spec) => {
    const input = build(spec);
    if (input.missions.length === 0) return;
    assertion(input, plan(input));
  }), { numRuns });
}

test('nobody is ever double-booked', () => {
  forEveryPlan((input, { shifts }) => {

    const employeeIds = new Set(shifts.map((shift) => shift.employeeId));
    for (const employeeId of employeeIds) {
      const list = shifts.filter((shift) => shift.employeeId === employeeId);
      list.sort((a, b) => a.start - b.start);
      for (let i = 1; i < list.length; i++) {
        assert.ok(list[i].start >= list[i - 1].end, 'overlapping shifts for one person');
      }
    }
  });
});

test('coverage never exceeds a mission headcount', () => {
  forEveryPlan((input, { shifts }) => {

    for (const mission of input.missions) {
      const own = shifts.filter((s) => s.missionId === mission.id);
      // Check every boundary instant: coverage can only change at an edge.
      const points = new Set(own.flatMap((s) => [s.start, s.end - 1]));
      for (const p of points) {
        const cover = own.filter((s) => s.start <= p && s.end > p).length;
        const seats = seatsAt(input, mission, p);
        assert.ok(cover <= seats, `mission ${mission.id} overstaffed at ${p}: ${cover}/${seats}`);
      }
    }
  });
});

test('every assignment falls inside the person\'s availability and the mission window', () => {
  forEveryPlan((input, { shifts }) => {

    for (const s of shifts) {
      const e = input.employees.find((x) => x.id === s.employeeId);
      const m = input.missions.find((x) => x.id === s.missionId);
      // Availability binds the *engine*, not the planner-of-record. A manual
      // assignment is a statement about what actually happened, so it outranks
      // a stale availability window rather than being cancelled by one - see
      // normalizePins. Only auto-assigned shifts are the engine's own choice
      // and must therefore respect availability.
      if (!s.pinned) {
        assert.ok(s.start >= (e.start ?? input.start), 'shift starts before the person is available');
        assert.ok(s.end <= (e.end ?? input.end), 'shift ends after the person leaves');
      }
      // Geometry never yields, pinned or not: a shift outside the mission's own
      // window is not a schedule anyone could work.
      assert.ok(s.start >= Math.max(m.start, input.start), 'shift starts before the mission');
      assert.ok(s.end <= Math.min(m.end, input.end), 'shift ends after the mission');
    }
  });
});

test('remote missions are held end to end by the same people', () => {
  forEveryPlan((input, { shifts }) => {

    for (const m of input.missions.filter((x) => x.type === 'remote')) {
      const own = shifts.filter((s) => s.missionId === m.id);
      const from = Math.max(m.start, input.start);
      const to = Math.min(m.end, input.end);
      for (const s of own) {
        assert.equal(s.start, from, 'a remote shift must span the whole mission');
        assert.equal(s.end, to);
      }
    }
  });
});

test('every local shift lies inside one slot of its own mission grid', () => {
  // The bound the whole per-mission grid rests on. A row that outran its slot
  // would mean two shifts wearing one row - the shape that surfaced eleven
  // slots as a single 88-hour block - and one that named a slot it is not
  // inside would break both `mergeRows` and the ring's turn count. Remote
  // holds are the documented exception: the slot is the mission itself.
  forEveryPlan((input, { shifts }) => {

    for (const s of shifts) {
      assert.ok(Number.isFinite(s.slotStart) && Number.isFinite(s.slotEnd), 'every row names a slot');
      assert.ok(s.slotStart <= s.start, 'a row starts before the slot it claims');
      assert.ok(s.slotEnd >= s.end, 'a row outruns the slot it claims');
    }
  });
});

test('identical input produces identical output', () => {
  forEveryPlan((input, result) => {
    assert.equal(JSON.stringify(result), JSON.stringify(plan(input)));
  }, 200);
});

test('the timeline always tiles the plan window exactly', () => {
  forEveryPlan((input, { timeline }) => {
    if (timeline.length === 0) return;

    assert.equal(timeline[0].start, input.start);
    assert.equal(timeline.at(-1).end, input.end);
    for (let i = 1; i < timeline.length; i++) {
      assert.equal(timeline[i].start, timeline[i - 1].end);
    }
  }, 200);
});


test('daily rows equal an occurrence even with contested pins and mixed grids', () => {
  forEveryPlan((input, { shifts }) => {
    for (const s of shifts.filter((row) => row.type === 'daily')) {
      const mission = input.missions.find((m) => m.id === s.missionId);
      assert.ok(mission.occurrences.some((w) => s.start === Math.max(input.start, w.start) && s.end === Math.min(input.end, w.end)));
    }
  }, 200);
});
