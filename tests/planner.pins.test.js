import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { plan, WARN } from '../src/lib/planner.js';
import { HOUR, MINUTE as MIN, localTime, people, runPlan } from './testHelpers.js';

const START = localTime(2026, 0, 5, 8, 0);

/* ------------------------------------------------------------------ */

test('whole-mission pins staff a remote mission with exactly those people', () => {
  const start = START;
  const end = start + 6 * HOUR;
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(8),
    missions: [{ id: 'r', name: 'Remote', type: 'remote', start, end, count: 3 }],
    // No start/end: "these people, for the whole mission".
    pins: [
      { missionId: 'r', employeeId: 'e7' },
      { missionId: 'r', employeeId: 'e8' },
    ],
  });

  const remote = result.shifts.filter((s) => s.missionId === 'r');
  assert.equal(remote.length, 3, 'the engine fills the remaining seat');

  const pinned = remote.filter((s) => s.pinned).map((s) => s.employeeId).sort();
  assert.deepEqual(pinned, ['e7', 'e8']);
  for (const s of remote) {
    assert.equal(s.start, start, 'pinned people cover the whole mission');
    assert.equal(s.end, end);
  }
});

test('a per-shift pin displaces the generated person, who is rescheduled elsewhere', () => {
  const start = START;
  const end = start + 4 * HOUR;
  const input = {
    start,
    end,
    shiftMinutes: 60,
    employees: people(4),
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
  };

  const before = plan(input);
  const firstSlot = before.shifts.find((s) => s.start === start);
  // Pick someone the planner did *not* choose for that slot.
  const other = input.employees.find((e) => e.id !== firstSlot.employeeId);

  const after = runPlan({
    ...input,
    pins: [{ missionId: 'l', employeeId: other.id, start, end: start + HOUR }],
  });

  const newFirst = after.shifts.find((s) => s.start === start);
  assert.equal(newFirst.employeeId, other.id, 'the pinned person now holds the slot');
  assert.equal(newFirst.pinned, true);

  // The displaced person is not dropped from the plan - they work later instead.
  assert.ok(
    after.shifts.some((s) => s.employeeId === firstSlot.employeeId),
    'the displaced person is rescheduled rather than idled',
  );
});

test('pinned time counts toward the fairness totals', () => {
  const start = START;
  const end = start + 6 * HOUR;
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(3),
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
    // Give e1 the first two hours by hand.
    pins: [
      { missionId: 'l', employeeId: 'e1', start, end: start + HOUR },
      { missionId: 'l', employeeId: 'e1', start: start + HOUR, end: start + 2 * HOUR },
    ],
  });

  const totals = new Map(result.stats.perEmployee.map((p) => [p.employeeId, p.minutes]));
  assert.equal(totals.get('e1'), 120, 'e1 keeps exactly the two pinned hours');
  // 6 slots total, e1 took 2 by hand, so the other two split the remaining 4 evenly
  // rather than e1 being handed more on top.
  assert.equal(totals.get('e2'), 120);
  assert.equal(totals.get('e3'), 120);
});

test('a person pinned to two overlapping missions keeps the latest and warns', () => {
  const start = START;
  const end = start + 2 * HOUR;
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(4),
    missions: [
      { id: 'a', name: 'A', type: 'local', start, end, count: 1 },
      { id: 'b', name: 'B', type: 'local', start, end, count: 1 },
    ],
    // 'a' was pinned first, then the person was manually reassigned to 'b' -
    // the more recent edit must win, not the stale one.
    pins: [
      { missionId: 'a', employeeId: 'e1' },
      { missionId: 'b', employeeId: 'e1' },
    ],
  });

  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_CONFLICT && w.employeeId === 'e1'));
  const e1 = result.shifts.filter((s) => s.employeeId === 'e1');
  assert.ok(e1.every((s) => s.missionId === 'b'), 'only the latest pin was honoured');
  // Mission A is still staffed, just by somebody else.
  assert.ok(result.shifts.some((s) => s.missionId === 'a'));
});

test('flipping a mission to open-ended widens its window - a whole-mission pin now stretches with it, with a warning', () => {
  // Rule 4: availability may never veto a manual pin, so e1's whole-mission
  // pin is honoured all the way to the widened end, not dropped - it is
  // reported informationally instead. (This test used to assert the
  // opposite: that the widened pin was rejected and e1 was capped at their
  // own availability. That was the pre-"manual assignment is an input fact"
  // behavior the user explicitly asked to remove - see CLAUDE.md/rule 4.)
  const start = START;
  const missionEnd = start + 2 * HOUR;
  const planEnd = start + 4 * HOUR;

  const employees = [
    { id: 'e1', name: 'Emp01', start, end: missionEnd },
    { id: 'e2', name: 'Emp02' },
  ];
  const missionWithEnd = (end) => [{ id: 'm', name: 'Gate', type: 'local', start, end, count: 1 }];
  const pins = [{ missionId: 'm', employeeId: 'e1' }]; // whole-mission pin, no explicit start/end

  // Baseline: the mission's explicit end matches e1's availability, so there
  // is nothing to override.
  const before = runPlan({
    start, end: planEnd, shiftMinutes: 60, employees, missions: missionWithEnd(missionEnd), pins,
  });
  assert.ok(!before.warnings.some((w) => w.code === WARN.PIN_AVAILABILITY_OVERRIDDEN));

  // Now flip the mission open-ended (end: null). normalizeMissions resolves
  // that to the plan's end, which e1's own window does not cover.
  const after = runPlan({
    start, end: planEnd, shiftMinutes: 60, employees, missions: missionWithEnd(null), pins,
  });
  const warning = after.warnings.find(
    (w) => w.code === WARN.PIN_AVAILABILITY_OVERRIDDEN && w.employeeId === 'e1' && w.missionId === 'm',
  );
  assert.ok(warning, 'widening the mission past e1 availability must warn, not silently reject the pin');
  assert.ok(
    after.shifts.some((s) => s.employeeId === 'e1' && s.missionId === 'm' && s.end === planEnd),
    "e1's manual assignment is honoured for the mission's full, widened window - it is a fact, not a suggestion",
  );
});

test('reassigning someone off a whole-mission pin onto a specific shift wins, not the old pin', () => {
  // e1 is pinned to a remote mission for the whole window (e.g. from the
  // Missions page), then separately hand-assigned to one shift of a local
  // mission that falls inside that same window - a manual swap made on the
  // schedule page. The newer, more specific pin must win even though the
  // wider pin was never explicitly cleared.
  const start = START;
  const end = start + 4 * HOUR;
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(4),
    missions: [
      { id: 'r', name: 'Remote', type: 'remote', start, end, count: 1 },
      { id: 'l', name: 'Gate', type: 'local', start, end, count: 1 },
    ],
    pins: [
      { missionId: 'r', employeeId: 'e1' },
      { missionId: 'l', employeeId: 'e1', start: start + HOUR, end: start + 2 * HOUR },
    ],
  });

  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_CONFLICT && w.employeeId === 'e1'));
  const e1Local = result.shifts.filter((s) => s.missionId === 'l' && s.employeeId === 'e1');
  assert.equal(e1Local.length, 1, 'the specific manual shift still belongs to e1');
  assert.equal(e1Local[0].start, start + HOUR);
  // The remote mission is not left empty - someone else covers it instead.
  assert.ok(result.shifts.some((s) => s.missionId === 'r'));
});

test('pins beyond the headcount are dropped with a warning, keeping the newest', () => {
  // Rule 5: on a contested seat the newest manual assignment wins. e2 was
  // pinned after e1, so e2 now keeps the seat and e1 is the one reported
  // overflowed - the reverse of what this test asserted before "keep the
  // earliest" was replaced with "keep the newest" as the user's explicit
  // product decision.
  const start = START;
  const end = start + 2 * HOUR;
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(4),
    missions: [{ id: 'r', name: 'Remote', type: 'remote', start, end, count: 1 }],
    pins: [
      { missionId: 'r', employeeId: 'e1' },
      { missionId: 'r', employeeId: 'e2' },
    ],
  });

  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_OVERFLOW && w.employeeId === 'e1'));
  const remote = result.shifts.filter((s) => s.missionId === 'r');
  assert.equal(remote.length, 1);
  assert.equal(remote[0].employeeId, 'e2');
});

test('a pin outside the person\'s availability is honoured, with an informational warning', () => {
  // Rule 4: "what I change manually must always win... for the algorithm to
  // work around" - a stale availability window can no longer cancel a manual
  // assignment. This test used to assert the opposite (pin dropped, e2 covers
  // instead); that was exactly the override the user reported as the bug.
  const start = START;
  const end = start + 4 * HOUR;
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'Late', start: start + 2 * HOUR },
      { id: 'e2', name: 'Full' },
    ],
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
    pins: [{ missionId: 'l', employeeId: 'e1', start, end: start + HOUR }],
  });

  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_AVAILABILITY_OVERRIDDEN && w.employeeId === 'e1'));
  assert.ok(!result.warnings.some((w) => w.code === WARN.PIN_UNAVAILABLE));
  const firstSlot = result.shifts.find((s) => s.start === start);
  assert.equal(firstSlot.employeeId, 'e1', 'the manual assignment stands even though it overrides availability');
});

test('a frozen pin survives even when the employee is no longer available for it', () => {
  // The scenario freezeElapsedBeforeEdit exists to protect: an already-elapsed
  // shift was locked in for e1, then e1's availability was tightened afterwards
  // (e.g. they can only work from some later time on). The frozen pin must not
  // be treated as a fresh, invalid manual assignment - the past cannot become
  // "unavailable". Under rule 4 this is no longer special to frozen pins (no
  // pin is ever dropped for availability, frozen or not), but it is still the
  // scenario worth guarding: the mismatch is now reported informationally
  // rather than being silently swallowed by a bypass.
  const start = START;
  const end = start + 2 * HOUR;
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'Late', start: start + HOUR },
      { id: 'e2', name: 'Full' },
    ],
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
    pins: [{
      missionId: 'l', employeeId: 'e1', start, end: start + HOUR, frozen: true,
    }],
  });

  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_AVAILABILITY_OVERRIDDEN && w.employeeId === 'e1'));
  assert.ok(!result.warnings.some((w) => w.code === WARN.PIN_UNAVAILABLE));
  const firstSlot = result.shifts.find((s) => s.start === start);
  assert.equal(firstSlot.employeeId, 'e1', 'the frozen assignment was not reshuffled');
  assert.equal(firstSlot.pinned, true);
  assert.equal(firstSlot.frozen, true, 'the shift carries the pin\'s frozen flag, for the UI to tell it apart from a manual pin');
});

test('a manual (non-frozen) pin produces a shift with frozen: false', () => {
  const start = START;
  const end = start + HOUR;
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'A' }, { id: 'e2', name: 'B' }],
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
    pins: [{ missionId: 'l', employeeId: 'e1', start, end }],
  });

  const shift = result.shifts.find((s) => s.employeeId === 'e1');
  assert.equal(shift.pinned, true);
  assert.equal(shift.frozen, false);
});

test('a frozen pin still expands with its mission when switched to remote, now honoured past availability', () => {
  // The pin was frozen while the mission was local, covering just the first
  // hour; once the mission is remote, normalizePins expands it to the whole
  // window as always. Under the old rules this used to lose a bypass and get
  // dropped for exceeding e1's availability. Under rule 4 there is no bypass
  // left to lose - frozen or not, a pin is never dropped for availability, so
  // e1 keeps the whole remote mission with an informational warning instead.
  const start = START;
  const end = start + 4 * HOUR;
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'Early', end: start + HOUR },
      { id: 'e2', name: 'Full' },
    ],
    missions: [{ id: 'm', name: 'M', type: 'remote', start, end, count: 1 }],
    pins: [{
      missionId: 'm', employeeId: 'e1', start, end: start + HOUR, frozen: true,
    }],
  });

  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_AVAILABILITY_OVERRIDDEN && w.employeeId === 'e1'));
  const own = result.shifts.filter((s) => s.missionId === 'm');
  assert.equal(own.length, 1);
  assert.equal(own[0].employeeId, 'e1', 'the frozen assignment still stands for the whole widened window');
  assert.equal(own[0].end, end);
});

test('a frozen whole-mission pin still stands when the remote mission window is later extended', () => {
  // Same story as above for the other way a remote pin's coverage can widen
  // past what it was frozen for: the mission's own window growing, rather
  // than a local-to-remote type change.
  const start = START;
  const originalEnd = start + 2 * HOUR;
  const extendedEnd = start + 4 * HOUR;
  const result = runPlan({
    start,
    end: extendedEnd,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'Early', end: originalEnd },
      { id: 'e2', name: 'Full' },
    ],
    // The mission's own window has already been extended past what e1 was
    // frozen for.
    missions: [{ id: 'm', name: 'M', type: 'remote', start, end: extendedEnd, count: 1 }],
    pins: [{
      missionId: 'm', employeeId: 'e1', start, end: originalEnd, frozen: true,
    }],
  });

  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_AVAILABILITY_OVERRIDDEN && w.employeeId === 'e1'));
  const own = result.shifts.filter((s) => s.missionId === 'm');
  assert.equal(own.length, 1);
  assert.equal(own[0].employeeId, 'e1');
  assert.equal(own[0].end, extendedEnd);
});

test('a frozen pin whose resolved range still matches exactly what it was frozen for is still honoured, with a warning', () => {
  // e1 is only available for the mission's first hour, but the pin (frozen
  // for the mission's current, unchanged whole window) covers both. There
  // used to be a special "still the original frozen interval" case that
  // bypassed the availability check entirely and produced zero warnings.
  // That bypass is gone (rule 4 makes it redundant - nothing can drop a pin
  // for availability anymore, frozen or not), so this now looks exactly like
  // any other availability mismatch: honoured, with an informational note.
  const start = START;
  const end = start + 2 * HOUR;
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'Early', end: start + HOUR },
      { id: 'e2', name: 'Full' },
    ],
    missions: [{ id: 'm', name: 'M', type: 'remote', start, end, count: 1 }],
    // Frozen for exactly the mission's current (unchanged) whole window.
    pins: [{
      missionId: 'm', employeeId: 'e1', start, end, frozen: true,
    }],
  });

  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_AVAILABILITY_OVERRIDDEN && w.employeeId === 'e1'));
  const own = result.shifts.filter((s) => s.missionId === 'm');
  assert.equal(own.length, 1);
  assert.equal(own[0].employeeId, 'e1');
});

test('an unfrozen pin is honoured when the employee is unavailable, exactly like a frozen one', () => {
  // Rule 4 makes frozen and explicit pins behave identically with respect to
  // availability: neither can be dropped for it. This test used to be the
  // frozen test's mirror image, proving the *opposite* still held for a
  // plain manual pin (dropped, e2 covers). That asymmetry is gone on purpose.
  const start = START;
  const end = start + 2 * HOUR;
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'Late', start: start + HOUR },
      { id: 'e2', name: 'Full' },
    ],
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
    pins: [{
      missionId: 'l', employeeId: 'e1', start, end: start + HOUR, frozen: false,
    }],
  });

  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_AVAILABILITY_OVERRIDDEN && w.employeeId === 'e1'));
  const firstSlot = result.shifts.find((s) => s.start === start);
  assert.equal(firstSlot.employeeId, 'e1');
});

test('pins naming a deleted employee or mission are ignored silently', () => {
  const start = START;
  const end = start + 2 * HOUR;
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(2),
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
    pins: [
      { missionId: 'gone', employeeId: 'e1' },
      { missionId: 'l', employeeId: 'ghost' },
    ],
  });

  // Stale references are a normal consequence of editing a shared link; they
  // must not produce noise, only be dropped.
  const pinWarnings = result.warnings.filter((w) => String(w.code).startsWith('pin-'));
  assert.equal(pinWarnings.length, 0);
  assert.ok(result.shifts.length > 0);
});

test('planning is idempotent: the same document yields the same schedule', () => {
  const start = START;
  const end = start + 8 * HOUR;
  const input = {
    start,
    end,
    shiftMinutes: 30,
    employees: people(7),
    missions: [
      { id: 'r', name: 'Remote', type: 'remote', start, end: start + 4 * HOUR, count: 2 },
      { id: 'l', name: 'Gate', type: 'local', start, end, count: 2 },
    ],
    pins: [
      { missionId: 'r', employeeId: 'e5' },
      { missionId: 'l', employeeId: 'e1', start: start + 2 * HOUR, end: start + 150 * MIN },
    ],
  };

  const a = plan(input);
  const b = plan(input);
  assert.equal(JSON.stringify(a.shifts), JSON.stringify(b.shifts));
  assert.equal(JSON.stringify(a.timeline), JSON.stringify(b.timeline));
  assert.equal(JSON.stringify(a.warnings), JSON.stringify(b.warnings));
});

test('re-pinning the person the planner already chose changes nothing but the flag', () => {
  const start = START;
  const end = start + 3 * HOUR;
  const input = {
    start,
    end,
    shiftMinutes: 60,
    employees: people(3),
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
  };

  const before = plan(input);
  const first = before.shifts.find((s) => s.start === start);
  const after = runPlan({
    ...input,
    pins: [{ missionId: 'l', employeeId: first.employeeId, start, end: start + HOUR }],
  });

  const pinnedFirst = after.shifts.find((s) => s.start === start);
  assert.equal(pinnedFirst.employeeId, first.employeeId);
  assert.equal(pinnedFirst.pinned, true);
  assert.equal(after.shifts.length, before.shifts.length);
});

/* --- regressions ----------------------------------------------------- */

test('a partial pin on a remote mission covers the whole mission, not part of it', () => {
  const start = START;
  const end = start + 2 * HOUR;
  // A per-shift pin made while the mission was local, then switched to remote.
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(3),
    missions: [{ id: 'm', name: 'M', type: 'remote', start, end, count: 1 }],
    pins: [{ missionId: 'm', employeeId: 'e1', start, end: start + HOUR }],
  });

  const own = result.shifts.filter((s) => s.missionId === 'm');
  assert.equal(own.length, 1);
  assert.equal(own[0].start, start, 'the pin is widened to the whole remote mission');
  assert.equal(own[0].end, end);
  // The seat is genuinely filled end to end, so nothing is silently short.
  assert.ok(!result.warnings.some((w) => w.code === WARN.UNDERSTAFFED));
});

test('a partial remote pin that outruns availability is still widened to the whole mission and honoured', () => {
  // This used to assert the pin was dropped for outrunning e1's availability
  // ("not half-honoured", i.e. neither half nor whole). Under rule 4 it is
  // now honoured in full: the remote-widening rule above still expands it to
  // the whole mission, and availability can no longer veto that - it only
  // gets an informational warning.
  const start = START;
  const end = start + 2 * HOUR;
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'Early', end: start + HOUR },
      { id: 'e2', name: 'Full' },
    ],
    missions: [{ id: 'm', name: 'M', type: 'remote', start, end, count: 1 }],
    pins: [{ missionId: 'm', employeeId: 'e1', start, end: start + HOUR }],
  });

  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_AVAILABILITY_OVERRIDDEN && w.employeeId === 'e1'));
  const own = result.shifts.filter((s) => s.missionId === 'm');
  assert.equal(own.length, 1);
  assert.equal(own[0].employeeId, 'e1', 'the manual assignment holds the whole remote mission despite outrunning availability');
  assert.equal(own[0].end, end);
});

test('a swap over a whole-mission pin replaces the assignee rather than competing', () => {
  const start = START;
  const end = start + 2 * HOUR;
  // What PlanContext.pinShift must produce: the displaced person's covering pin
  // removed, the replacement written for the row's range.
  const result = runPlan({
    start,
    end,
    shiftMinutes: 60,
    employees: people(3),
    missions: [{ id: 'm', name: 'M', type: 'remote', start, end, count: 1 }],
    pins: [{ missionId: 'm', employeeId: 'e2', start, end }],
  });

  const own = result.shifts.filter((s) => s.missionId === 'm');
  assert.equal(own.length, 1);
  assert.equal(own[0].employeeId, 'e2');
  assert.ok(!result.warnings.some((w) => w.code === WARN.PIN_OVERFLOW));
});

/* --- a pin on a local mission is emitted per shift slot ---------------- */

/**
 * The rota this bug was reported from, rebuilt: a week at an hourly rotation,
 * four local missions, sixteen guards, and one person put on the five-seat
 * mission from the Missions page - the "4+1" arrangement, recorded as a single
 * whole-mission pin with no range of its own.
 */
const carmelRota = () => {
  // The historical digest includes absolute timestamps captured in UTC.
  const start = Date.UTC(2026, 8, 10, 16);
  return {
    start,
    end: start + 163 * HOUR,
    shiftMinutes: 60,
    strategy: 'rotation',
    employees: people(16),
    missions: [
      { id: 'm1', name: 'Gate', type: 'local', count: 1 },
      { id: 'm2', name: 'Kitchen', type: 'local', count: 2 },
      { id: 'm3', name: 'Carmel', type: 'local', count: 5 },
      { id: 'm4', name: 'Ops', type: 'local', count: 1 },
    ],
    pins: [{ missionId: 'm3', employeeId: 'e1' }],
  };
};

const staffedAt = (result, missionId, t) => result.shifts.filter(
  (s) => s.missionId === missionId && s.start <= t && s.end > t,
).length;

test('a whole-mission pin on a local mission is one row per shift, not one row for the week', () => {
  // It used to be a single 163-hour row. The agenda keys its slots on
  // (start, end), so that row became a slot of its own - "16:00 to 11:00, four
  // days later", one person, pinned - while every hourly slot of the same
  // mission showed four people against a headcount of five and read as short.
  const input = carmelRota();
  const result = plan(input);

  for (const s of result.shifts) {
    assert.equal(
      s.end - s.start,
      HOUR,
      'no row may outrun a single shift slot, pinned or not',
    );
  }

  const own = result.shifts.filter((s) => s.employeeId === 'e1');
  assert.equal(own.length, 163, 'the pinned person holds one row per hour of the week');
  assert.ok(own.every((s) => s.pinned && s.missionId === 'm3'));

  for (let t = input.start; t < input.end; t += HOUR) {
    assert.equal(staffedAt(result, 'm3', t), 5, `the mission is fully staffed at ${t}`);
  }

  const stats = result.stats.perEmployee.find((p) => p.employeeId === 'e1');
  assert.equal(stats.stints, 163, 'and reads as 163 shifts worked, like anyone else on the rota');
  assert.equal(stats.minutes, 163 * 60);
});

test('the rotation itself is untouched by the pin being split into rows', () => {
  // The engine's *decision* was never wrong - only the shape it reported it
  // in - so every generated row must land exactly where it did before. This
  // digest is of the pre-fix engine's output for the rota above; a change to
  // it means the split leaked into policy, which is the one thing it must not
  // do. (The pinned rows are excluded, since they are what the fix changes.)
  const result = plan(carmelRota());
  const generated = JSON.stringify(
    result.shifts.filter((s) => !s.pinned).map((s) => [s.start, s.missionId, s.employeeId]),
  );
  assert.equal(
    createHash('sha256').update(generated).digest('hex'),
    '3c12bab5f85cb0027faaf6f41983c501da27d762e4bdd01414558a51625d7afc',
  );
});

test('a whole-mission pin on an off-grid mission gets partial rows at the mission edges only', () => {
  // The mission runs from half past the hour to half past the hour, so its own
  // window is the only thing off the plan's grid. The pin is not allowed to add
  // edges of its own, so what comes out is the mission's own segmentation: a
  // half-hour row at each end and whole slots in between.
  const start = START;
  const result = runPlan({
    start,
    end: start + 6 * HOUR,
    shiftMinutes: 60,
    employees: people(4),
    missions: [{
      id: 'm', name: 'Gate', type: 'local', start: start + 30 * MIN, end: start + 270 * MIN, count: 1,
    }],
    pins: [{ missionId: 'm', employeeId: 'e1' }],
  });

  const own = result.shifts.filter((s) => s.employeeId === 'e1');
  assert.deepEqual(
    own.map((s) => [(s.start - start) / MIN, (s.end - s.start) / MIN]),
    [[30, 30], [60, 60], [120, 60], [180, 60], [240, 30]],
  );
  assert.ok(own.every((s) => s.pinned));
});

test('a pinned slot torn by an unrelated availability edge merges back into one row', () => {
  // e3 arriving mid-slot breaks the segment grid at 08:30 for every local
  // mission, e1's pinned hour included. That is exactly what mergeRows is for,
  // and it must repair a pinned row the same way it repairs a generated one -
  // without ever welding two consecutive slots together.
  const start = START;
  const result = runPlan({
    start,
    end: start + 3 * HOUR,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'Emp01' },
      { id: 'e2', name: 'Emp02' },
      { id: 'e3', name: 'Emp03', start: start + 30 * MIN, end: start + 3 * HOUR },
    ],
    missions: [{ id: 'm', name: 'Gate', type: 'local', count: 2 }],
    pins: [{ missionId: 'm', employeeId: 'e1' }],
  });

  const own = result.shifts.filter((s) => s.employeeId === 'e1');
  assert.deepEqual(
    own.map((s) => [(s.start - start) / MIN, (s.end - s.start) / MIN]),
    [[0, 60], [60, 60], [120, 60]],
    'the torn first hour is rejoined, and the three hours stay three rows',
  );
});
