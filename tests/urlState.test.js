import test from 'node:test';
import assert from 'node:assert/strict';
import lzString from 'lz-string';
import { decodePlan, encodePlan, PARAM } from '../src/lib/urlState.js';
import { emptyPlan, planSchema, prunePins, toPlannerInput } from '../src/lib/planSchema.js';
import { plan } from '../src/lib/planner.js';

const HOUR = 3600 * 1000;
const START = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();

const sample = () => planSchema.parse({
  version: 1,
  title: 'סוף שבוע',
  start: START,
  end: START + 12 * HOUR,
  shiftMinutes: 90,
  employees: [
    { id: 'e1', name: 'אבי', start: null, end: null },
    { id: 'e2', name: 'דנה', start: START + HOUR, end: START + 8 * HOUR },
    { id: 'e3', name: 'Yosef "Y" O\'Brien', start: null, end: null },
  ],
  missions: [
    { id: 'm1', name: 'שער', type: 'local', start: null, end: null, count: 2 },
    { id: 'm2', name: 'סיור', type: 'remote', start: START, end: START + 4 * HOUR, count: 1 },
  ],
  pins: [
    { missionId: 'm2', employeeId: 'e1', start: null, end: null },
    { missionId: 'm1', employeeId: 'e3', start: START + HOUR, end: START + 2 * HOUR },
  ],
});

test('encode -> decode round-trips the document exactly', () => {
  const doc = sample();
  const result = decodePlan(encodePlan(doc));
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan, doc);
});

test('pins survive the round trip, including whole-mission ones', () => {
  const doc = sample();
  const { plan: back } = decodePlan(encodePlan(doc));
  assert.equal(back.pins.length, 2);
  assert.deepEqual(back.pins[0], {
    missionId: 'm2', employeeId: 'e1', start: null, end: null, frozen: false,
  });
  assert.equal(back.pins[1].start, START + HOUR);
});

test('a shared link reproduces an identical schedule', () => {
  const doc = sample();
  const { plan: back } = decodePlan(encodePlan(doc));
  // This is the property the whole URL-state design rests on: whoever opens the
  // link must see exactly what the planner saw.
  assert.equal(
    JSON.stringify(plan(toPlannerInput(doc))),
    JSON.stringify(plan(toPlannerInput(back))),
  );
});

test('the encoded blob stays compact', () => {
  const doc = sample();
  const blob = encodePlan(doc);
  assert.ok(blob.length < 400, `blob was ${blob.length} chars`);
});

test('a blob survives being carried in a query string', () => {
  // lz-string's alphabet contains "+", which URLSearchParams reads back as a
  // space unless the value is percent-encoded - the bug this guards against.
  const doc = sample();
  const blob = encodePlan(doc);
  const params = new URLSearchParams();
  params.set(PARAM, blob);
  const readBack = new URLSearchParams(params.toString()).get(PARAM);
  assert.equal(readBack, blob);
  assert.equal(decodePlan(readBack).ok, true);
});

test('malformed input degrades instead of throwing', () => {
  for (const bad of ['', null, undefined, 'not-a-blob', '!!!!', 'N4IgdghgtgpiBcIQ']) {
    const result = decodePlan(bad);
    assert.equal(result.ok, false, `expected failure for ${JSON.stringify(bad)}`);
    assert.ok(typeof result.reason === 'string');
  }
});

test('a truncated link degrades instead of throwing', () => {
  const blob = encodePlan(sample());
  for (const cut of [0.25, 0.5, 0.75, 0.9]) {
    const result = decodePlan(blob.slice(0, Math.floor(blob.length * cut)));
    assert.equal(result.ok, false);
  }
});

test('a document from a future schema version is rejected, not misread', () => {
  const doc = sample();
  const blob = encodePlan({ ...doc, version: 99 });
  assert.deepEqual(decodePlan(blob), { ok: false, reason: 'version' });
});

test('emptyPlan is a valid document', () => {
  const doc = emptyPlan(START);
  assert.equal(planSchema.parse(doc).start, doc.start);
  assert.ok(doc.end > doc.start);
  assert.equal(decodePlan(encodePlan(doc)).ok, true);
});

test('the frozen flag survives the round trip', () => {
  const doc = planSchema.parse({
    ...sample(),
    pins: [
      { missionId: 'm2', employeeId: 'e1', start: null, end: null, frozen: true },
      { missionId: 'm1', employeeId: 'e3', start: START + HOUR, end: START + 2 * HOUR, frozen: false },
    ],
  });
  const { plan: back } = decodePlan(encodePlan(doc));
  assert.equal(back.pins[0].frozen, true);
  assert.equal(back.pins[1].frozen, false);
});

test('a link encoded before the frozen flag existed decodes as unfrozen', () => {
  // Old links only have 4 elements per pin tuple; the decoder must not choke
  // on the missing 5th slot, and must treat it as an ordinary, unfrozen pin.
  const doc = sample();
  const legacyCompact = {
    v: doc.version,
    t: doc.title,
    s: doc.start,
    e: doc.end,
    m: doc.shiftMinutes,
    emp: doc.employees.map((x) => [x.id, x.name, x.start ?? 0, x.end ?? 0]),
    mis: doc.missions.map((x) => (
      [x.id, x.name, x.type === 'remote' ? 1 : 0, x.start ?? 0, x.end ?? 0, x.count]
    )),
    pin: doc.pins.map((x) => [x.missionId, x.employeeId, x.start ?? 0, x.end ?? 0]),
  };
  const legacyBlob = lzString.compressToEncodedURIComponent(JSON.stringify(legacyCompact));
  const { ok, plan: back } = decodePlan(legacyBlob);
  assert.equal(ok, true);
  assert.equal(back.pins.every((p) => p.frozen === false), true);
});

test('prunePins drops references to deleted employees and missions', () => {
  const doc = sample();
  const withoutE3 = prunePins({ ...doc, employees: doc.employees.filter((e) => e.id !== 'e3') });
  assert.equal(withoutE3.pins.length, 1);
  assert.equal(withoutE3.pins[0].employeeId, 'e1');

  const withoutM2 = prunePins({ ...doc, missions: doc.missions.filter((m) => m.id !== 'm2') });
  assert.equal(withoutM2.pins.length, 1);
  assert.equal(withoutM2.pins[0].missionId, 'm1');

  // No dangling references means the object is returned untouched.
  assert.equal(prunePins(doc), doc);
});
