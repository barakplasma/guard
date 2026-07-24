import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { generateShifts, computeStats } from '../scheduler/scheduler.js';

// Property-based tests (fast-check): instead of one hand-picked scenario, throw
// hundreds of randomized rosters at generateShifts and assert the invariants
// that must ALWAYS hold - no guard is ever in two places at once, every active
// post is staffed exactly to its headcount with no gaps or overstaffing, and
// (in the unconstrained case) the load is fair. A counterexample is shrunk to a
// minimal failing roster automatically.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const posId = (p) => p.id ?? p.name;
const headcountOf = (p) => (Number.isInteger(p.headcount) && p.headcount >= 1 ? p.headcount : 1);

// Mirror of scheduler.js's window check - the spec the coverage assertion holds
// generateShifts to (local hour/minute, wrapping past midnight).
function activeAt(pos, t) {
  if (!pos.timeRestricted) return true;
  const [sh, sm] = pos.windowStart.split(':').map(Number);
  const [eh, em] = pos.windowEnd.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const d = new Date(t);
  const now = d.getHours() * 60 + d.getMinutes();
  return startMin <= endMin ? now >= startMin && now < endMin : now >= startMin || now < endMin;
}

// The instants where coverage or activeness can change: shift edges, slot-grid
// points, and window open/close each day. Coverage is constant between adjacent
// boundaries, so sampling each gap's midpoint checks the whole timeline exactly.
function boundaryMidpoints({ start, end, shiftMinutes, positions }, shifts) {
  const pts = new Set([start, end]);
  const shiftMs = shiftMinutes * MINUTE;
  for (let t = start; t <= end; t += shiftMs) pts.add(Math.min(t, end));
  for (const s of shifts) {
    if (s.start > start) pts.add(s.start);
    if (s.end < end) pts.add(s.end);
  }
  // window open/close for each day the range spans
  for (const p of positions) {
    if (!p.timeRestricted) continue;
    for (const hhmm of [p.windowStart, p.windowEnd]) {
      const [h, m] = hhmm.split(':').map(Number);
      const d0 = new Date(start);
      for (let day = -1; day <= 2; day++) {
        const inst = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + day, h, m, 0, 0).getTime();
        if (inst > start && inst < end) pts.add(inst);
      }
    }
  }
  const sorted = [...pts].sort((a, b) => a - b);
  const mids = [];
  for (let i = 1; i < sorted.length; i++) mids.push((sorted[i - 1] + sorted[i]) / 2);
  return mids;
}

function assertHardInvariants(input, shifts) {
  const { start, end, guards } = input;
  const guardSet = new Set(guards);

  for (const s of shifts) {
    assert.ok(s.end > s.start, 'shift end must be after start');
    assert.ok(s.start >= start && s.end <= end, 'shift must be within [start, end]');
    assert.ok(guardSet.has(s.guard), `shift guard ${s.guard} must be from the pool`);
  }

  // No guard is ever booked onto two overlapping shifts.
  const byGuard = new Map();
  for (const s of shifts) {
    if (!byGuard.has(s.guard)) byGuard.set(s.guard, []);
    byGuard.get(s.guard).push(s);
  }
  for (const [g, list] of byGuard) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i].start >= list[i - 1].end, `guard ${g} is double-booked`);
    }
  }

  // Exactly `headcount` guards on each active post at every instant, and none
  // when the post is closed - no gaps, no overstaffing.
  for (const t of boundaryMidpoints(input, shifts)) {
    for (const p of input.positions) {
      const id = posId(p);
      let cover = 0;
      for (const s of shifts) if (s.position === id && s.start <= t && t < s.end) cover++;
      const expected = activeAt(p, t) ? headcountOf(p) : 0;
      assert.equal(cover, expected, `${p.name} @ ${new Date(t).toISOString()}: ${cover} != ${expected}`);
    }
  }
}

// A randomized roster with enough guards that generation never has to leave a
// post empty (guards >= total headcount => every post staffable simultaneously).
function scenarioArb(extra = {}) {
  return fc
    .record({
      positions: fc.array(
        fc.record({
          timeRestricted: fc.boolean(),
          headcount: fc.integer({ min: 1, max: 2 }),
          windowStart: fc.constantFrom('20:00', '22:00', '00:00', '21:30', '18:00'),
          windowEnd: fc.constantFrom('06:00', '04:00', '08:00', '23:00', '02:00'),
          ...(extra.positions || {}),
        }),
        { minLength: 1, maxLength: 3 },
      ),
      extraGuards: fc.integer({ min: 0, max: 3 }),
      shiftMinutes: fc.constantFrom(30, 60, 90, 120),
      startHour: fc.integer({ min: 0, max: 23 }),
      startMinute: fc.constantFrom(0, 15, 30),
      slots: fc.integer({ min: 1, max: 20 }),
      restMultiplier: extra.restMultiplier ?? fc.constantFrom(0, 1, 2),
      fairnessWindowHours: extra.fairnessWindowHours ?? fc.constantFrom(0, 24),
    })
    .map((cfg) => {
      const positions = cfg.positions.map((p, i) => ({ ...p, id: `p${i}`, name: `P${i}` }));
      const totalHeadcount = positions.reduce((s, p) => s + headcountOf(p), 0);
      const guards = Array.from({ length: totalHeadcount + cfg.extraGuards }, (_, i) => `g${i}`);
      const shiftMs = cfg.shiftMinutes * MINUTE;
      const start = new Date(2024, 0, 1, cfg.startHour, cfg.startMinute, 0, 0).getTime();
      return {
        start,
        end: start + cfg.slots * shiftMs,
        shiftMinutes: cfg.shiftMinutes,
        positions,
        guards,
        restMinutes: cfg.restMultiplier * cfg.shiftMinutes,
        fairnessWindowMinutes: cfg.fairnessWindowHours ? cfg.fairnessWindowHours * 60 : null,
      };
    });
}

test('invariants hold for any roster: no double-booking, exact coverage, valid guards', () => {
  fc.assert(
    fc.property(scenarioArb(), (input) => {
      const shifts = generateShifts(input);
      assertHardInvariants(input, shifts);
    }),
    { numRuns: 200 },
  );
});

test('generation is deterministic (same input -> same output)', () => {
  fc.assert(
    fc.property(scenarioArb(), (input) => {
      assert.deepEqual(generateShifts(input), generateShifts({ ...input }));
    }),
    { numRuns: 100 },
  );
});

test('unconstrained load is fair: max-min hours per guard <= one shift', () => {
  // Regular posts only, no rest gap, no fairness window - the case the balancer
  // is meant to solve exactly. Every guard's total should be within one shift of
  // every other's.
  const fairArb = scenarioArb({
    positions: { timeRestricted: fc.constant(false) },
    restMultiplier: fc.constant(0),
    fairnessWindowHours: fc.constant(0),
  });
  fc.assert(
    fc.property(fairArb, (input) => {
      const shifts = generateShifts(input);
      assertHardInvariants(input, shifts);

      const { hoursPerGuard } = computeStats(shifts);
      const hours = input.guards.map((g) => hoursPerGuard.get(g) || 0);
      const spread = Math.max(...hours) - Math.min(...hours);
      const shiftHours = input.shiftMinutes / 60;
      assert.ok(spread <= shiftHours + 1e-9, `unfair: spread ${spread}h > one shift ${shiftHours}h`);
    }),
    { numRuns: 200 },
  );
});
