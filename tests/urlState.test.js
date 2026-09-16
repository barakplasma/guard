import test from 'node:test';
import assert from 'node:assert/strict';
import lzString from 'lz-string';
import { decodePlan, encodePlan, PARAM } from '../src/lib/urlState.js';
import { emptyPlan, planSchema, prunePins, toPlannerInput } from '../src/lib/planSchema.js';
import { plan } from '../src/lib/planner.js';

const HOUR = 3600 * 1000;
// The committed URL fixture contains UTC instants, independent of the test host.
const START = Date.UTC(2026, 0, 5, 8);

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
    { id: 'm1', name: 'שער', type: 'local', start: null, end: null, count: 2, nightCount: 4 },
    { id: 'm2', name: 'סיור', type: 'remote', start: START, end: START + 4 * HOUR, count: 1 },
  ],
  pins: [
    { missionId: 'm2', employeeId: 'e1', start: null, end: null },
    { missionId: 'm1', employeeId: 'e3', start: START + HOUR, end: START + 2 * HOUR },
  ],
});

function legacyPayload(doc, { includeStrategy = false, includeFrozen = false } = {}) {
  return {
    v: doc.version,
    t: doc.title,
    s: doc.start,
    e: doc.end,
    m: doc.shiftMinutes,
    ...(includeStrategy ? { st: doc.strategy } : {}),
    emp: doc.employees.map((employee) => [
      employee.id, employee.name, employee.start ?? 0, employee.end ?? 0,
    ]),
    mis: doc.missions.map((mission) => [
      mission.id, mission.name, mission.type === 'remote' ? 1 : 0,
      mission.start ?? 0, mission.end ?? 0, mission.count,
    ]),
    pin: doc.pins.map((pin) => [
      pin.missionId, pin.employeeId, pin.start ?? 0, pin.end ?? 0,
      ...(includeFrozen ? [pin.frozen ? 1 : 0] : []),
    ]),
  };
}

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
  const legacyCompact = legacyPayload(doc);
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

test('the strategy survives the round trip', () => {
  const doc = planSchema.parse({ ...sample(), strategy: 'rotation' });
  const { plan: back } = decodePlan(encodePlan(doc));
  assert.equal(back.strategy, 'rotation');
  assert.equal(toPlannerInput(back).strategy, 'rotation');
});

test('a link encoded before strategies existed decodes as the original behaviour', () => {
  // Old links carry no `st` key at all. They were written when there was one
  // way to schedule, so they have to keep meaning that - silently switching a
  // shared plan to a different strategy would reshuffle everybody.
  const doc = sample();
  const legacyCompact = legacyPayload(doc);
  const blob = lzString.compressToEncodedURIComponent(JSON.stringify(legacyCompact));

  const result = decodePlan(blob);
  assert.equal(result.ok, true);
  assert.equal(result.plan.strategy, 'balanced');
});

test('the night window and per-mission night headcount survive the round trip', () => {
  // 18:00 rather than a realistic 22:00 only because the sample plan runs
  // 08:00-20:00; a night starting after it ends resolves to no windows at all.
  const doc = planSchema.parse({ ...sample(), nightStart: 18 * 60, nightEnd: 5 * 60 + 30 });
  const back = decodePlan(encodePlan(doc)).plan;

  assert.equal(back.nightStart, 18 * 60);
  assert.equal(back.nightEnd, 5 * 60 + 30);
  assert.equal(back.missions[0].nightCount, 4);
  // And it reaches the engine - a field missed in the adapter is silently inert.
  const input = toPlannerInput(back);
  assert.equal(input.missions[0].nightCount, 4);
  assert.ok(input.nightWindows.length > 0);
});

test('per-mission shift lengths survive the round trip and reach the engine', () => {
  const doc = planSchema.parse({
    ...sample(),
    missions: [
      { ...sample().missions[0], shiftMinutes: 120, nightShiftMinutes: 60 },
      sample().missions[1],
    ],
  });
  const back = decodePlan(encodePlan(doc)).plan;

  assert.equal(back.missions[0].shiftMinutes, 120);
  assert.equal(back.missions[0].nightShiftMinutes, 60);
  assert.equal(back.missions[1].shiftMinutes, null);
  // And they reach the engine - a field missed in the adapter is silently inert.
  const input = toPlannerInput(back);
  assert.equal(input.missions[0].shiftMinutes, 120);
  assert.equal(input.missions[0].nightShiftMinutes, 60);
  assert.equal(input.missions[1].shiftMinutes, undefined);
});

test('on-call survives the round trip; off encodes to the legacy bytes', () => {
  const doc = planSchema.parse({
    ...sample(),
    missions: [{ ...sample().missions[0], onCall: true }, sample().missions[1]],
  });
  const back = decodePlan(encodePlan(doc)).plan;

  assert.equal(back.missions[0].onCall, true);
  assert.equal(back.missions[1].onCall, false);
  // And it reaches the engine - a field missed in the adapter is silently inert.
  const input = toPlannerInput(back);
  assert.equal(input.missions[0].onCall, true);

  // Schema defaults inject `onCall: false` everywhere; the encoder must trim
  // that trailing slot away, or every link written before the field existed
  // changes shape the moment it is re-shared.
  const plain = planSchema.parse(sample());
  const legacy = plain.missions.map(({ onCall: _dropped, ...rest }) => rest);
  assert.equal(encodePlan(plain), encodePlan({ ...plain, missions: legacy }));
});

test('a night length on its own round-trips without a day length', () => {
  // Position 7 is written as `0` so position 8 keeps its place: the tuple is
  // positional, so a hole cannot be closed up.
  const doc = planSchema.parse({
    ...sample(),
    missions: [{ ...sample().missions[0], nightShiftMinutes: 45 }, sample().missions[1]],
  });
  const back = decodePlan(encodePlan(doc)).plan;
  assert.equal(back.missions[0].shiftMinutes, null);
  assert.equal(back.missions[0].nightShiftMinutes, 45);
});

test('a document using neither new field encodes to the exact bytes it always did', () => {
  // Captured from the build before per-mission shift lengths existed. Trailing
  // unset positions are trimmed, so every link already shared stays the string
  // it was - which is the whole reason the positions are appended rather than
  // inserted, and the reason `trimTail` exists at all. If this fails, links in
  // the wild have quietly changed shape.
  assert.equal(
    encodePlan(sample()),
    'N4IgbiBcCMA0IBcokIeghV0EMegACQl6CEXQNQI9AR4BnKaAdgDYaAGBxh+AUwppoBYBmAJibrwAtlACcgkKSSQQAIwCGAG3kA7AMYsAJiRAryMPhJVtI3ahJZCADlADatkC2g7AC6B5Am6AlBdALqwHLLw6gMuggAeggCugJFS05mYCsNE0vAAcyQJ+Adw6AJoA9qQsAGZYADog2WVYAPIA5ABCAE4AliwqXrC+fiBCTfr23c7wOISAF6Dt3rC8sJwZ3UHwKO5oYwkJHOYCzInU0Jyc8XCd8FZNbZD9QvOOgxO+-gM6LFlrMXRxTC-0lPwfnQC+QA',
  );
});

test('a mission staffed evenly round the clock keeps a null night count', () => {
  const doc = sample();
  const back = decodePlan(encodePlan(doc)).plan;
  assert.equal(back.missions[1].nightCount, null);
  assert.equal(toPlannerInput(back).missions[1].nightCount, undefined);
});

test('a link encoded before night headcounts existed decodes as the original behaviour', () => {
  // The exact shape an older build wrote: six-element mission tuples, no `ns`
  // or `ne`. It must still parse, and must schedule identically to the same
  // plan with the fields left unset.
  const doc = sample();
  const legacy = lzString.compressToEncodedURIComponent(JSON.stringify(
    legacyPayload(doc, { includeStrategy: true, includeFrozen: true }),
  ));

  const back = decodePlan(legacy);
  assert.equal(back.ok, true);
  for (const m of back.plan.missions) {
    assert.equal(m.nightCount, null);
    // Positions 7 and 8 are simply not there, and read back as "inherit".
    assert.equal(m.shiftMinutes, null);
    assert.equal(m.nightShiftMinutes, null);
  }
  assert.equal(back.plan.nightStart, 22 * 60);

  const evenlyStaffed = planSchema.parse({
    ...doc,
    missions: doc.missions.map((m) => ({ ...m, nightCount: null })),
  });
  assert.equal(
    JSON.stringify(plan(toPlannerInput(back.plan))),
    JSON.stringify(plan(toPlannerInput(evenlyStaffed))),
  );
});
