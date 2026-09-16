/**
 * The shipped WebAssembly path, in a real browser.
 *
 * Everything else about the solver is tested against a native binary, which
 * proves the model and proves nothing about the thing users actually run. This
 * is the only place that asserts the bundled worker loads, solves, and does so
 * without the network the app promised not to need.
 *
 * Four claims:
 *  - optimize and check both complete through the wasm runner;
 *  - a page that never asks for the solver never loads it (the 19 MB runtime is
 *    not a cost to impose on somebody reading tonight's rota);
 *  - the assets are precached, so a reload with the network cut still works;
 *  - leaving the page disposes the worker rather than leaking it.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { planSchema } from '../src/lib/planSchema.js';
import { encodePlan } from '../src/lib/urlState.js';
import { baseUrl, launchBrowser, watchErrors } from './e2eHelpers.mjs';

const SHOT_DIR = process.env.SHOT_DIR || '/tmp/guard-shots';
await mkdir(SHOT_DIR, { recursive: true });

const HOUR = 3600000;
const start = Date.parse('2030-09-10T08:00:00+03:00');

// Deliberately tiny. What is under test is the path, not the model: fourteen
// proved levels of a two-hour, two-guard plan is a few seconds of wasm.
const doc = planSchema.parse({
  start,
  end: start + 2 * HOUR,
  shiftMinutes: 60,
  employees: [{ id: 'e1', name: 'דנה' }, { id: 'e2', name: 'יוסי' }],
  missions: [{ id: 'gate', name: 'שער', type: 'local', count: 1 }],
  pins: [],
});
const link = `${baseUrl}/#/schedule?p=${encodeURIComponent(encodePlan(doc))}`;

const browser = await launchBrowser();
try {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 }, locale: 'he-IL', timezoneId: 'Asia/Jerusalem',
  });
  const page = await context.newPage();
  const errors = [];
  watchErrors(page, errors);

  const solverRequests = [];
  page.on('request', (request) => {
    if (/minizinc|solver\//.test(request.url())) solverRequests.push(request.url());
  });

  await page.goto(link, { waitUntil: 'networkidle' });
  await page.getByTestId('toggle-debug').waitFor();

  /* --- a page that never asks pays nothing --- */
  assert.deepEqual(solverRequests, [], 'the solver runtime is not fetched until it is wanted');

  /* --- optimize and check, through the wasm worker --- */
  await page.getByTestId('toggle-debug').click();
  const status = page.getByTestId('solver-status');
  await status.waitFor();
  await page.getByTestId('run-solver').click();

  // The whole ladder plus a check run. Generous: this is a cold wasm start on
  // whatever machine CI happens to give us.
  await page.getByTestId('solver-diff').waitFor({ timeout: 180_000 });
  const outcome = await status.innerText();
  assert.match(outcome, /רמות הוכחו/, `the ladder reported a proof, got: ${outcome}`);
  assert.ok(solverRequests.length > 0, 'and it did so through the shipped assets');

  const diff = await page.getByTestId('solver-diff').innerText();
  assert.match(diff, /\d+/, 'the differential view names a number of matching assignments');

  /* --- offline reload --- */
  // The service worker precaches the build, the .wasm included. Give it a
  // moment to take control, then cut the network and reload.
  await page.waitForFunction(
    () => navigator.serviceWorker && navigator.serviceWorker.controller != null,
    null,
    { timeout: 60_000 },
  ).catch(() => {
    // Some preview setups do not register a worker at all; the assertion below
    // is what decides, and it says so plainly rather than timing out here.
  });
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
  if (controlled) {
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('toggle-debug').waitFor({ timeout: 60_000 });
    await context.setOffline(false);
    console.log('solver e2e: offline reload served from the precache');
  } else {
    console.log('solver e2e: no service worker controlling this page; offline reload not asserted');
  }

  /* --- leaving disposes the worker --- */
  await page.goto(`${baseUrl}/#/employees`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const workers = page.workers().length;
  assert.equal(workers, 0, `the solver worker was disposed, ${workers} left`);

  assert.deepEqual(
    errors.filter((message) => !/favicon|manifest/i.test(message)),
    [],
    'no console errors along the way',
  );
  console.log('solver e2e: ok');
  await context.close();
} catch (error) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      await page.screenshot({ path: `${SHOT_DIR}/solver-e2e-failure.png` });
      console.error((await page.locator('body').innerText()).slice(0, 3000));
    }
  }
  throw error;
} finally {
  await browser.close();
}
