/**
 * ADR 015 on screen: carried duty is visible, and the spread says which one it
 * means.
 *
 * The engine change is covered by `tests/planner.carriedDuty.test.js`. What
 * cannot be covered there is the part that goes wrong in this codebase: a
 * caption inside a `TableCell`, on a table that already crowds a 360px phone,
 * in a summary whose columns have overflowed before.
 *
 * It also pins the thing ADR 015 flagged and did not fix in the engine. While a
 * debt is being repaid the window spread is deliberately wide, and the app
 * shows the window spread - so a reader sees a number that looks like a fault
 * and is a fix. Both figures are printed for exactly that reason, and this is
 * the assertion that they are.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { planSchema } from '../src/lib/planSchema.js';
import { encodePlan } from '../src/lib/urlState.js';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const SHOT_DIR = process.env.SHOT_DIR || '/tmp/guard-shots';
await mkdir(SHOT_DIR, { recursive: true });

const HOUR = 3600000;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
try {
  const context = await browser.newContext({
    viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true,
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  // Far enough ahead that nothing has elapsed, so the history freeze plays no
  // part in what the summary shows.
  const start = Date.parse('2030-09-10T08:00:00+03:00');
  const carrying = planSchema.parse({
    start, end: start + 6 * HOUR, shiftMinutes: 60,
    employees: [
      { id: 'e1', name: 'דנה', carriedMinutes: 36 * 60 },
      { id: 'e2', name: 'יוסי' },
    ],
    missions: [{ id: 'gate', name: 'שער', type: 'local', count: 1 }],
    pins: [],
  });
  await page.goto(`${BASE}/#/schedule?p=${encodeURIComponent(encodePlan(carrying))}`, { waitUntil: 'networkidle' });

  const row = page.getByTestId('summary-e1');
  await row.waitFor();
  const carried = await row.innerText();
  assert.match(carried, /36:00/, 'the carried total is on the row');
  assert.match(carried, /מתקופות קודמות/, 'and it says what it is');
  assert.doesNotMatch(
    await page.getByTestId('summary-e2').innerText(), /מתקופות קודמות/,
    'someone carrying nothing gets no caption at all',
  );

  // Thirty-six hours ahead, six hourly seats: דנה stands none of them.
  assert.match(await row.innerText(), /0:00/, 'the one who is ahead is given nothing this window');

  const spread = await page.getByText(/פער/).first().innerText();
  assert.match(spread, /פער בחלון/, 'the window spread is labelled as the window');
  assert.match(spread, /פער כולל תקופות קודמות/, 'and the figure being evened out is beside it');
  assert.match(spread, /30:00/, 'which is 36 carried against 6 worked');

  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'phone has no horizontal overflow',
  );
  await page.screenshot({ path: join(SHOT_DIR, 'carried-duty.png'), fullPage: true });

  // With nobody carrying anything the summary reads exactly as it always did -
  // one spread figure, no captions. The engine returns the same object shape it
  // returned before this feature existed, which is what keeps every golden
  // fixture and every shared link unchanged.
  const plain = planSchema.parse({
    start, end: start + 6 * HOUR, shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'דנה' }, { id: 'e2', name: 'יוסי' }],
    missions: [{ id: 'gate', name: 'שער', type: 'local', count: 1 }],
    pins: [],
  });
  await page.goto(`${BASE}/#/schedule?p=${encodeURIComponent(encodePlan(plain))}`, { waitUntil: 'networkidle' });
  await page.getByTestId('summary-e1').waitFor();
  const plainSpread = await page.getByText(/פער/).first().innerText();
  assert.doesNotMatch(plainSpread, /פער בחלון/, 'no split figure when there is nothing to split');
  assert.equal(await page.getByText(/מתקופות קודמות/).count(), 0, 'and no captions');

  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS carried duty at 360px: row caption, split spread figure, and an untouched plain plan');
} finally {
  await browser.close();
}
