/**
 * Regression tests for normalizePins around pin precedence.
 *
 * First round (defects 1-3): a doomed overflow pin destroying a survivor, a
 * whole-mission pin and a literal-range pin describing the same assignment
 * double-counting, and a frozen (machine-written) pin outranking an explicit
 * (human-written) one. See CLAUDE.md, "match pins by coverage, never by
 * literal range."
 *
 * Second round (rules 4-5): the user stated the governing principle directly
 * - "What I change manually must always win and become fact for the
 * algorithm to work around." A manual assignment is an input fact, not a
 * suggestion the engine may veto:
 *   - availability can no longer drop ANY pin, only note the mismatch
 *     (PIN_AVAILABILITY_OVERRIDDEN) and honour the pin anyway;
 *   - a contested seat goes to the NEWEST manual assignment (later document
 *     index), not the earliest, with the explicit-beats-frozen rule from
 *     round one still sitting above it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, WARN } from '../src/lib/planner.js';

const localTime = (y, m, d, h = 0, min = 0) => new Date(y, m, d, h, min, 0, 0).getTime();
const START = localTime(2026, 0, 5, 8, 0);
const HOUR = 3600 * 1000;
const H = (h) => Date.UTC(2026, 0, 1, h);

/* ------------------------------------------------------------------ */
/* Defect 1 - a rejected pin must not destroy a survivor elsewhere      */
/* ------------------------------------------------------------------ */

test('a pin that loses a seat contest does not evict an unrelated survivor as a side effect', () => {
  // Under "newest wins" (rule 5), this scenario resolves differently than it
  // did before that rule existed: a's later convoy claim (written after c's)
  // now legitimately outranks c's for that one seat, and a's own earlier gate
  // claim is then superseded by a's own newer convoy commitment - the same
  // "latest pin for this person wins" rule that already governed a single
  // person's conflicting pins. b, the only remaining gate claimant, gets the
  // now-vacant gate seat. The point this test actually guards - that a
  // rejection is a plain "continue", never an eviction of something already
  // accepted - is structurally enforced by normalizePins now (accepted
  // claimants are only ever pushed, never spliced back out), so what is left
  // to check is that the cascade above lands on the correct, fully-explained
  // final state, not a corrupted one.
  const input = {
    start: H(7),
    end: H(11),
    shiftMinutes: 60,
    employees: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
    missions: [
      { id: 'gate', name: 'gate', type: 'local', start: H(7), end: H(8), count: 1 },
      { id: 'conv', name: 'convoy', type: 'remote', start: H(7), end: H(10), count: 1 },
    ],
    pins: [
      { missionId: 'gate', employeeId: 'a', start: H(7), end: H(8) }, // 0: A hand-placed on gate
      { missionId: 'conv', employeeId: 'c' }, // 1: C holds the only convoy seat
      { missionId: 'conv', employeeId: 'a' }, // 2: A also pinned to convoy - newer than C's, wins it
      { missionId: 'gate', employeeId: 'b', start: H(7), end: H(8) }, // 3: B pinned to gate too
    ],
  };

  const result = plan(input);
  const gate = result.shifts.filter((s) => s.missionId === 'gate');
  const conv = result.shifts.filter((s) => s.missionId === 'conv');
  assert.deepEqual(gate.map((s) => s.employeeId), ['b'], 'b is the only claim left standing on gate');
  assert.deepEqual(conv.map((s) => s.employeeId), ['a'], 'a\'s newer convoy pin outranks c\'s older one');

  assert.ok(
    result.warnings.some((w) => w.code === WARN.PIN_OVERFLOW && w.missionId === 'conv' && w.employeeId === 'c'),
    'c\'s older convoy claim is reported overflowed, not silently dropped',
  );
  assert.ok(
    result.warnings.some((w) => w.code === WARN.PIN_CONFLICT && w.missionId === 'gate' && w.employeeId === 'a'),
    'a\'s older gate claim is reported cancelled by a\'s own newer convoy commitment',
  );
});

/* ------------------------------------------------------------------ */
/* Defect 2 - same person, same mission, same coverage = one claimant   */
/* ------------------------------------------------------------------ */

test('a whole-mission pin and a literal-range pin describing the same assignment count as one claimant', () => {
  const start = START;
  const end = start + 3 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'A' }, { id: 'e2', name: 'B' }],
    missions: [{ id: 'm', name: 'M', type: 'remote', start, end, count: 1 }],
    pins: [
      { missionId: 'm', employeeId: 'e1' }, // whole-mission pin
      { missionId: 'm', employeeId: 'e1', start, end }, // literal range == the mission's own window
    ],
  });

  const own = result.shifts.filter((s) => s.missionId === 'm');
  assert.equal(own.length, 1, 'only one seat is consumed');
  assert.equal(own[0].employeeId, 'e1');
  assert.ok(
    !result.warnings.some((w) => w.code === WARN.PIN_CONFLICT),
    'the two pins describe one mission, not two overlapping ones, so there is no conflict',
  );
  assert.ok(
    !result.warnings.some((w) => w.code === WARN.PIN_OVERFLOW),
    'the duplicate does not count as a second claimant, so the seat is not overflowed',
  );
});

test('a byte-identical duplicate pin is idempotent', () => {
  const start = START;
  const end = start + HOUR;
  const dup = { missionId: 'm', employeeId: 'e1', start, end, frozen: true };
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'A' }, { id: 'e2', name: 'B' }],
    missions: [{ id: 'm', name: 'M', type: 'local', start, end, count: 1 }],
    pins: [dup, { ...dup }],
  });

  const own = result.shifts.filter((s) => s.missionId === 'm');
  assert.equal(own.length, 1, 'the byte-identical duplicate does not consume a second seat');
  assert.equal(own[0].employeeId, 'e1');
  assert.ok(!result.warnings.some((w) => w.code === WARN.PIN_OVERFLOW));
});

/* ------------------------------------------------------------------ */
/* Defect 3 - an explicit pin outranks a frozen one in a seat contest   */
/* ------------------------------------------------------------------ */

test('an explicit pin wins a contested seat against a frozen pin - explicit first, frozen second', () => {
  const start = START;
  const end = start + HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'Explicit' }, { id: 'e2', name: 'Frozen' }, { id: 'e3', name: 'C' }],
    missions: [{ id: 'm', name: 'M', type: 'local', start, end, count: 1 }],
    pins: [
      { missionId: 'm', employeeId: 'e1', start, end }, // explicit, written first
      { missionId: 'm', employeeId: 'e2', start, end, frozen: true }, // frozen, written second
    ],
  });

  const own = result.shifts.filter((s) => s.missionId === 'm');
  assert.equal(own.length, 1);
  assert.equal(own[0].employeeId, 'e1', 'the explicit pin holds the seat');
  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_OVERFLOW && w.employeeId === 'e2'));
});

test('an explicit pin wins a contested seat against a frozen pin - frozen first, explicit second', () => {
  const start = START;
  const end = start + HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'Explicit' }, { id: 'e2', name: 'Frozen' }, { id: 'e3', name: 'C' }],
    missions: [{ id: 'm', name: 'M', type: 'local', start, end, count: 1 }],
    pins: [
      { missionId: 'm', employeeId: 'e2', start, end, frozen: true }, // frozen, written first
      { missionId: 'm', employeeId: 'e1', start, end }, // explicit, written second
    ],
  });

  const own = result.shifts.filter((s) => s.missionId === 'm');
  assert.equal(own.length, 1);
  assert.equal(
    own[0].employeeId,
    'e1',
    'the explicit pin still wins even though the frozen one arrived first and would have under pure document order',
  );
  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_OVERFLOW && w.employeeId === 'e2'));
});

/* ------------------------------------------------------------------ */
/* Rule 4 - availability may never veto a manual pin                    */
/* ------------------------------------------------------------------ */

test('a pin outside the employee\'s availability is honoured, with an informational warning instead of a drop', () => {
  const start = START;
  const end = start + 4 * HOUR;
  const result = plan({
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

  assert.ok(
    result.warnings.some(
      (w) => w.code === WARN.PIN_AVAILABILITY_OVERRIDDEN && w.employeeId === 'e1' && w.missionId === 'l',
    ),
    'the mismatch is reported informationally',
  );
  assert.ok(!result.warnings.some((w) => w.code === WARN.PIN_UNAVAILABLE), 'availability alone must never produce a rejection');
  assert.ok(
    result.shifts.some((s) => s.employeeId === 'e1' && s.missionId === 'l' && s.start === start && s.end === start + HOUR),
    'the manual assignment is an input fact - it is actually scheduled, not merely tolerated in theory',
  );
});

test('a pin that resolves to zero duration outside the mission window still cannot be honoured', () => {
  const start = START;
  const missionStart = start + HOUR;
  const missionEnd = start + 2 * HOUR;
  const result = plan({
    start,
    end: start + 3 * HOUR,
    shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'A' }, { id: 'e2', name: 'B' }],
    missions: [{ id: 'm', name: 'M', type: 'local', start: missionStart, end: missionEnd, count: 1 }],
    // Entirely before the mission's own window: clamped to nothing, not a
    // shift anyone could work - unlike an availability mismatch, there is no
    // fact here for the engine to honour.
    pins: [{ missionId: 'm', employeeId: 'e1', start, end: missionStart }],
  });

  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_UNAVAILABLE && w.employeeId === 'e1'));
  // e1 may still end up on the mission through ordinary fair rotation - what
  // must never happen is the *pin itself* being honoured.
  assert.ok(!result.shifts.some((s) => s.employeeId === 'e1' && s.missionId === 'm' && s.pinned));
});

test('auto-assignment still respects availability - only manual pins are input facts', () => {
  const start = START;
  const end = start + 4 * HOUR;
  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'Late', start: start + 2 * HOUR },
      { id: 'e2', name: 'Full' },
    ],
    missions: [{ id: 'l', name: 'Gate', type: 'local', start, end, count: 1 }],
    // No pins at all - every shift here is the engine's own choice.
  });

  const early = result.shifts.filter((s) => s.start < start + 2 * HOUR);
  assert.ok(early.length > 0, 'sanity: there are slots before e1 becomes available');
  assert.ok(
    early.every((s) => s.employeeId !== 'e1'),
    'the scheduler itself must never place someone outside their own availability window',
  );
});

/* ------------------------------------------------------------------ */
/* Rule 5 - on a contested seat, the newest manual assignment wins      */
/* ------------------------------------------------------------------ */

test('three explicit pins for a two-seat mission: the two newest win, the oldest overflows - order A', () => {
  const start = START;
  const end = start + HOUR;
  const mission = { id: 'm', name: 'M', type: 'local', start, end, count: 2 };
  const employees = [{ id: 'e1', name: 'E1' }, { id: 'e2', name: 'E2' }, { id: 'e3', name: 'E3' }];

  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees,
    missions: [mission],
    pins: [
      { missionId: 'm', employeeId: 'e1', start, end }, // oldest
      { missionId: 'm', employeeId: 'e2', start, end },
      { missionId: 'm', employeeId: 'e3', start, end }, // newest
    ],
  });

  const winners = result.shifts.filter((s) => s.missionId === 'm').map((s) => s.employeeId).sort();
  assert.deepEqual(winners, ['e2', 'e3'], 'the two most recently written pins win the two seats');
  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_OVERFLOW && w.employeeId === 'e1'));
});

test('three explicit pins for a two-seat mission: the two newest win, the oldest overflows - order B (reshuffled)', () => {
  // Same three people, same mission - but now e3 (the winner in order A) is
  // written FIRST and e1 (the loser in order A) is written LAST. If the rule
  // were secretly keyed on employee id or original mission position rather
  // than array order, this would not flip the outcome. It must.
  const start = START;
  const end = start + HOUR;
  const mission = { id: 'm', name: 'M', type: 'local', start, end, count: 2 };
  const employees = [{ id: 'e1', name: 'E1' }, { id: 'e2', name: 'E2' }, { id: 'e3', name: 'E3' }];

  const result = plan({
    start,
    end,
    shiftMinutes: 60,
    employees,
    missions: [mission],
    pins: [
      { missionId: 'm', employeeId: 'e3', start, end }, // oldest this time
      { missionId: 'm', employeeId: 'e1', start, end },
      { missionId: 'm', employeeId: 'e2', start, end }, // newest this time
    ],
  });

  const winners = result.shifts.filter((s) => s.missionId === 'm').map((s) => s.employeeId).sort();
  assert.deepEqual(winners, ['e1', 'e2'], 'the winners follow document order, not employee identity');
  assert.ok(result.warnings.some((w) => w.code === WARN.PIN_OVERFLOW && w.employeeId === 'e3'));
});

/* ------------------------------------------------------------------ */
/* Determinism                                                          */
/* ------------------------------------------------------------------ */

test('a contested seat with mixed frozen/explicit pins still plans identically every time', () => {
  const start = START;
  const end = start + 2 * HOUR;
  const input = {
    start,
    end,
    shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'E1' }, { id: 'e2', name: 'E2' }, { id: 'e3', name: 'E3' }, { id: 'e4', name: 'E4' },
    ],
    missions: [{ id: 'm', name: 'M', type: 'remote', start, end, count: 2 }],
    pins: [
      { missionId: 'm', employeeId: 'e1', frozen: true },
      { missionId: 'm', employeeId: 'e2' },
      { missionId: 'm', employeeId: 'e3', frozen: true },
      { missionId: 'm', employeeId: 'e4' },
    ],
  };

  const a = plan(input);
  const b = plan(input);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
