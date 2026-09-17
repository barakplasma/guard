import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodePlan, FRAGMENT_LIMIT, fitPlanToFragment, loggedOldestFirst,
} from '../src/lib/urlState.js';
import { DAY, docOf, HOUR, loggedPin, people } from './solverHelpers.js';

/**
 * The fragment is the document's limit, and the log is a first-in, first-out
 * queue against it.
 *
 * This is the owner's alternative to a clear button: logged duty stays in the
 * document and is the scheduler's memory, so the only thing that may ever
 * remove it is running out of room. Everything else here exists to make sure
 * "running out of room" never takes something that is not history - the export
 * half of ADR 012 already consumed somebody's plan once by keying on the wrong
 * side of the window.
 */

const START = new Date(2026, 2, 1, 12, 0, 0, 0).getTime();

function withHistory(count, extra = {}) {
  const pins = Array.from({ length: count }, (_, i) => loggedPin({
    missionId: 'm1',
    employeeId: `e${(i % 4) + 1}`,
    // Oldest first in document order, one hour each, walking backwards.
    start: START - (count - i) * HOUR,
    end: START - (count - i - 1) * HOUR,
  }));
  return docOf({
    start: START,
    end: START + DAY,
    employees: people(4),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
    pins,
    ...extra,
  });
}

test('a document under the limit comes back by identity', () => {
  const doc = withHistory(5);
  const fitted = fitPlanToFragment(doc);
  assert.equal(fitted.doc, doc);
  assert.equal(fitted.dropped, 0);
});

test('a document over the limit is brought under it', () => {
  const doc = withHistory(9000);
  assert.ok(encodePlan(doc).length > FRAGMENT_LIMIT, 'the fixture has to actually overflow');
  const fitted = fitPlanToFragment(doc);
  assert.ok(encodePlan(fitted.doc).length <= FRAGMENT_LIMIT);
  assert.ok(fitted.dropped > 0);
  assert.equal(fitted.doc.pins.length, doc.pins.length - fitted.dropped);
});

test('the oldest logged shifts drop first', () => {
  const doc = withHistory(9000);
  const fitted = fitPlanToFragment(doc);
  const kept = fitted.doc.pins.map((pin) => pin.end);
  const dropped = doc.pins.map((pin) => pin.end).filter((end) => !kept.includes(end));
  assert.ok(dropped.length > 0);
  assert.ok(Math.max(...dropped) <= Math.min(...kept), 'nothing newer went before something older');
});

test('nothing inside or after the window is ever dropped', () => {
  const doc = withHistory(9000, {});
  const live = [
    // A manual assignment inside the window: an instruction, not a record.
    { missionId: 'm1', employeeId: 'e1', start: START + HOUR, end: START + 2 * HOUR, frozen: false, record: null },
    // And one for next week: somebody's plan.
    { missionId: 'm1', employeeId: 'e2', start: START + 3 * DAY, end: START + 3 * DAY + HOUR, frozen: false, record: null },
  ];
  const withLive = { ...doc, pins: [...doc.pins, ...live] };
  const fitted = fitPlanToFragment(withLive);
  for (const pin of live) {
    assert.ok(
      fitted.doc.pins.some((kept) => kept.start === pin.start && kept.employeeId === pin.employeeId),
      'a pin that is not history survives the trim',
    );
  }
});

test('a pin with no record is never a drop candidate, however old', () => {
  const doc = docOf({
    start: START,
    employees: people(2),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
    pins: [
      { missionId: 'm1', employeeId: 'e1', start: START - 5 * DAY, end: START - 5 * DAY + HOUR, frozen: false, record: null },
      loggedPin({ missionId: 'm1', employeeId: 'e2', start: START - 4 * DAY, end: START - 4 * DAY + HOUR }),
    ],
  });
  const candidates = loggedOldestFirst(doc);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].pin.employeeId, 'e2');
});

test('the drop order is stable: equal ends fall back to mission and employee id', () => {
  const doc = docOf({
    start: START,
    employees: people(3),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
    pins: [
      loggedPin({ missionId: 'm1', employeeId: 'e3', start: START - DAY, end: START - DAY + HOUR }),
      loggedPin({ missionId: 'm1', employeeId: 'e1', start: START - DAY, end: START - DAY + HOUR }),
      loggedPin({ missionId: 'm1', employeeId: 'e2', start: START - DAY, end: START - DAY + HOUR }),
    ],
  });
  assert.deepEqual(
    loggedOldestFirst(doc).map((entry) => entry.pin.employeeId),
    ['e1', 'e2', 'e3'],
  );
  assert.deepEqual(
    loggedOldestFirst(doc).map((entry) => entry.pin.employeeId),
    loggedOldestFirst(doc).map((entry) => entry.pin.employeeId),
  );
});

test('a plan that cannot fit even with every record gone says so honestly', () => {
  // Nothing droppable at all: the overflow is the roster itself.
  const doc = docOf({
    start: START,
    // Deliberately incompressible names: a roster of "Employee 1..n" packs
    // down to almost nothing, and what has to overflow here is the part of the
    // document the trim may never touch.
    employees: Array.from({ length: 6000 }, (_, i) => ({
      id: `e${i}`,
      name: `${(i * 2654435761 % 2 ** 32).toString(36)}-${(i * 40503 % 65521).toString(36)}`,
    })),
    missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
  });
  assert.ok(encodePlan(doc).length > FRAGMENT_LIMIT);
  const fitted = fitPlanToFragment(doc);
  assert.equal(fitted.dropped, 0, 'it took nothing it was not allowed to take');
});

test('the trim is idempotent: fitting a fitted document changes nothing', () => {
  const once = fitPlanToFragment(withHistory(9000));
  const twice = fitPlanToFragment(once.doc);
  assert.equal(twice.dropped, 0);
  assert.equal(twice.doc, once.doc);
});
