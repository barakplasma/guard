/**
 * `FRAGMENT_LIMIT` is a measured number, and this is the measurement.
 *
 * The plan lives in the URL fragment, and ADR 012's successor makes the
 * fragment's size the document's ceiling - so the constant has to be a length a
 * real browser actually carries, not a length that seemed safe. This opens a
 * link of exactly that length in Chromium and asserts every row decodes back.
 *
 * Run it on the Pixel 10 before trusting the constant, as AGENTS.md requires:
 * a desktop pass is necessary and not sufficient. If the device proves more,
 * the constant goes up.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { planSchema } from '../src/lib/planSchema.js';
import { decodePlan, encodePlan, FRAGMENT_LIMIT, fitPlanToFragment, PARAM } from '../src/lib/urlState.js';
import { baseUrl, launchBrowser, watchErrors } from './e2eHelpers.mjs';

const SHOT_DIR = process.env.SHOT_DIR || '/tmp/guard-shots';
await mkdir(SHOT_DIR, { recursive: true });

const HOUR = 3600000;
const start = Date.parse('2030-09-10T08:00:00+03:00');

/** A document with `count` logged shifts behind the window. */
function withHistory(count) {
  return planSchema.parse({
    start,
    end: start + 6 * HOUR,
    shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'דנה' }, { id: 'e2', name: 'יוסי' }],
    missions: [{ id: 'gate', name: 'שער', type: 'local', count: 1 }],
    pins: Array.from({ length: count }, (_, i) => ({
      missionId: 'gate',
      employeeId: i % 2 === 0 ? 'e1' : 'e2',
      start: start - (count - i) * HOUR,
      end: start - (count - i - 1) * HOUR,
      frozen: true,
      record: {
        employeeName: i % 2 === 0 ? 'דנה' : 'יוסי',
        missionName: 'שער',
        missionType: 'local',
        tags: [],
      },
    })),
  });
}

/** The largest history that still encodes inside the limit. */
function atTheLimit() {
  let low = 1;
  let high = 20_000;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encodePlan(withHistory(mid)).length <= FRAGMENT_LIMIT) low = mid; else high = mid - 1;
  }
  return withHistory(low);
}

const browser = await launchBrowser();
try {
  const doc = atTheLimit();
  const blob = encodePlan(doc);
  assert.ok(blob.length <= FRAGMENT_LIMIT, 'the fixture sits inside the limit');
  assert.ok(blob.length > FRAGMENT_LIMIT * 0.9, `and close to it (${blob.length} of ${FRAGMENT_LIMIT})`);

  const context = await browser.newContext({
    viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true,
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem',
  });
  const page = await context.newPage();
  const errors = [];
  watchErrors(page, errors);

  await page.goto(`${baseUrl}/#/schedule?p=${encodeURIComponent(blob)}`, { waitUntil: 'networkidle' });
  await page.getByTestId('toggle-debug').waitFor();

  // The fragment reached the page intact: the browser carried every character,
  // and what the page holds decodes back to the document that was sent.
  const carried = await page.evaluate((param) => {
    const hash = window.location.hash;
    return new URLSearchParams(hash.slice(hash.indexOf('?'))).get(param);
  }, PARAM);
  assert.equal(carried, blob, 'the browser carried the whole fragment');

  const decoded = decodePlan(carried);
  assert.ok(decoded.ok, 'and it still decodes');
  assert.equal(decoded.plan.pins.length, doc.pins.length, 'with every logged shift present');
  assert.equal(decoded.plan.pins.at(-1).record.employeeName, doc.pins.at(-1).record.employeeName);

  // One more row would not fit, and the trim takes the oldest.
  const overflowing = withHistory(doc.pins.length + 40);
  assert.ok(encodePlan(overflowing).length > FRAGMENT_LIMIT);
  const fitted = fitPlanToFragment(overflowing);
  assert.ok(fitted.dropped > 0);
  assert.ok(encodePlan(fitted.doc).length <= FRAGMENT_LIMIT);
  assert.equal(
    fitted.doc.pins[0].start,
    overflowing.pins[fitted.dropped].start,
    'the survivors are the newest ones',
  );

  assert.deepEqual(errors, [], 'no console errors on a link at the ceiling');
  console.log(`fragment limit: ok (${blob.length} characters, ${doc.pins.length} logged shifts)`);
  await context.close();
} catch (error) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      await page.screenshot({ path: `${SHOT_DIR}/fragment-limit-failure.png` });
    }
  }
  throw error;
} finally {
  await browser.close();
}
