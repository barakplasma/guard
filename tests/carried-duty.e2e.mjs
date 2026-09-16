/**
 * What the screen says about duty the window has rolled past.
 *
 * Two halves of the same situation, so one browser launch covers both: ADR 015
 * counts those hours towards fairness, and ADR 008's second defect asks that
 * they be *visible* rather than only exportable.
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

  // Thirty-six hours ahead against a six-hour window: דנה stands none of it and
  // יוסי stands all six. A window may only repay six hours of debt (ADR 015's
  // cap, which is ADR 016's run cap), and six hours is the whole window here -
  // so the tilt is total and still bounded. Nobody exceeds six unbroken hours
  // because there is no seventh slot to give them.
  assert.match(await row.innerText(), /0:00/, 'the one who is ahead stands none of it');
  assert.match(await page.getByTestId('summary-e2').innerText(), /6:00/, 'and the other stands all six');

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

  // ADR 008's defect 2, visibility half. A plan whose period has rolled past
  // some recorded duty shows it, read-only, beside the alert that counts it and
  // the button that exports and removes it. Pressing that button used to be an
  // act of faith: it said how many assignments it was about to carry away and
  // nothing about whose they were.
  const past = { start: start - 30 * HOUR, end: start - 26 * HOUR };
  const rolled = planSchema.parse({
    start, end: start + 6 * HOUR, shiftMinutes: 60,
    employees: [{ id: 'e1', name: 'דנה' }, { id: 'e2', name: 'יוסי' }],
    missions: [
      { id: 'gate', name: 'שער', type: 'local', count: 1 },
      { id: 'old', name: 'ישן', type: 'local', ...past, count: 1 },
    ],
    pins: [{ missionId: 'old', employeeId: 'e1', ...past, frozen: true }],
  });
  await page.goto(`${BASE}/#/schedule?p=${encodeURIComponent(encodePlan(rolled))}`, { waitUntil: 'networkidle' });
  await page.getByTestId('toggle-debug').click();
  const log = page.getByTestId('past-log-text');
  await log.waitFor();
  const logText = await log.innerText();
  assert.match(logText, /ישן/, 'the mission it was stood on');
  assert.match(logText, /דנה/, 'and who stood it');
  assert.match(logText, /בספטמבר/, 'dated, since it is before the period and the day is the point');
  assert.equal(
    await page.getByTestId('remove-stale-pins').count(), 1,
    'shown beside the button that exports and removes it, which is the whole reason it is here',
  );
  assert.equal(await log.locator('input, button, select').count(), 0, 'and nothing in it is editable');
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'still no horizontal overflow with the log open',
  );

  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS rolled-past duty at 360px: carried caption, split spread, and a read-only log of what the export would take');
} finally {
  await browser.close();
}
