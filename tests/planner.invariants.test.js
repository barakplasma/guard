import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { plan } from '../src/lib/planner.js';

const MIN = 60 * 1000;
const BASE = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();

/**
 * Random but well-formed plan documents. Property tests here guard the things
 * that must hold for *every* input, not just the hand-written scenarios:
 * no double-booking, no overstaffing, availability respected, determinism.
 */
const planArb = fc.record({
  hours: fc.integer({ min: 1, max: 12 }),
  shiftMinutes: fc.constantFrom(30, 60, 90, 120),
  employeeCount: fc.integer({ min: 1, max: 8 }),
  missions: fc.array(
    fc.record({
      type: fc.constantFrom('local', 'remote'),
      count: fc.integer({ min: 1, max: 3 }),
      offsetMin: fc.integer({ min: 0, max: 300 }),
      lengthMin: fc.integer({ min: 30, max: 600 }),
    }),
    { minLength: 1, maxLength: 4 },
  ),
  limited: fc.array(fc.record({
    index: fc.nat(),
    fromMin: fc.integer({ min: 0, max: 300 }),
  }), { maxLength: 3 }),
});

function build(spec) {
  const start = BASE;
  const end = start + spec.hours * 60 * MIN;

  const employees = Array.from({ length: spec.employeeCount }, (_, i) => ({
    id: `e${i + 1}`,
    name: `Emp${i + 1}`,
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
    start: start + m.offsetMin * MIN,
    end: start + (m.offsetMin + m.lengthMin) * MIN,
    count: m.count,
  })).filter((m) => m.start < end);

  return { start, end, shiftMinutes: spec.shiftMinutes, employees, missions };
}

test('nobody is ever double-booked', () => {
  fc.assert(fc.property(planArb, (spec) => {
    const input = build(spec);
    if (input.missions.length === 0) return;
    const { shifts } = plan(input);

    const byEmployee = new Map();
    for (const s of shifts) {
      if (!byEmployee.has(s.employeeId)) byEmployee.set(s.employeeId, []);
      byEmployee.get(s.employeeId).push(s);
    }
    for (const list of byEmployee.values()) {
      list.sort((a, b) => a.start - b.start);
      for (let i = 1; i < list.length; i++) {
        assert.ok(list[i].start >= list[i - 1].end, 'overlapping shifts for one person');
      }
    }
  }), { numRuns: 300 });
});

test('coverage never exceeds a mission headcount', () => {
  fc.assert(fc.property(planArb, (spec) => {
    const input = build(spec);
    if (input.missions.length === 0) return;
    const { shifts } = plan(input);

    for (const mission of input.missions) {
      const own = shifts.filter((s) => s.missionId === mission.id);
      // Check every boundary instant: coverage can only change at an edge.
      const points = new Set(own.flatMap((s) => [s.start, s.end - 1]));
      for (const p of points) {
        const cover = own.filter((s) => s.start <= p && s.end > p).length;
        assert.ok(cover <= mission.count, `mission ${mission.id} overstaffed: ${cover}/${mission.count}`);
      }
    }
  }), { numRuns: 300 });
});

test('every assignment falls inside the person\'s availability and the mission window', () => {
  fc.assert(fc.property(planArb, (spec) => {
    const input = build(spec);
    if (input.missions.length === 0) return;
    const { shifts } = plan(input);

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
  }), { numRuns: 300 });
});

test('remote missions are held end to end by the same people', () => {
  fc.assert(fc.property(planArb, (spec) => {
    const input = build(spec);
    if (input.missions.length === 0) return;
    const { shifts } = plan(input);

    for (const m of input.missions.filter((x) => x.type === 'remote')) {
      const own = shifts.filter((s) => s.missionId === m.id);
      const from = Math.max(m.start, input.start);
      const to = Math.min(m.end, input.end);
      for (const s of own) {
        assert.equal(s.start, from, 'a remote shift must span the whole mission');
        assert.equal(s.end, to);
      }
    }
  }), { numRuns: 300 });
});

test('identical input produces identical output', () => {
  fc.assert(fc.property(planArb, (spec) => {
    const input = build(spec);
    if (input.missions.length === 0) return;
    assert.equal(JSON.stringify(plan(input)), JSON.stringify(plan(input)));
  }), { numRuns: 200 });
});

test('the timeline always tiles the plan window exactly', () => {
  fc.assert(fc.property(planArb, (spec) => {
    const input = build(spec);
    if (input.missions.length === 0) return;
    const { timeline } = plan(input);
    if (timeline.length === 0) return;

    assert.equal(timeline[0].start, input.start);
    assert.equal(timeline.at(-1).end, input.end);
    for (let i = 1; i < timeline.length; i++) {
      assert.equal(timeline[i].start, timeline[i - 1].end);
    }
  }), { numRuns: 200 });
});
