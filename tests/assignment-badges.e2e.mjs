/** Manual locks and preserved history remain distinct on a touch viewport. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { planSchema } from '../src/lib/planSchema.js';
import { encodePlan, decodePlan } from '../src/lib/urlState.js';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || '/usr/bin/chromium' });
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const start = Date.parse('2030-09-10T08:00:00+03:00');
  const hour = 3600000;
  const doc = planSchema.parse({ start, end: start + 3 * hour, shiftMinutes: 60,
    employees: [{ id: 'a', name: 'אבי' }, { id: 'b', name: 'דנה' }],
    missions: [{ id: 'gate', name: 'שער', type: 'local', count: 1 }],
    pins: [
      { missionId: 'gate', employeeId: 'a', start, end: start + hour },
      { missionId: 'gate', employeeId: 'b', start: start + hour, end: start + 2 * hour, frozen: true },
    ],
  });
  await page.goto(`${BASE}/#/schedule?p=${encodeURIComponent(encodePlan(doc))}`, { waitUntil: 'networkidle' });
  assert.ok(await page.title());
  assert.ok(page.url().includes('/#/schedule?'));
  const manual = page.getByTestId(`pinned-gate-${start}`);
  const history = page.getByTestId(`pinned-gate-${start + hour}`);
  await manual.waitFor();
  assert.equal(await manual.getByTestId('LockIcon').count(), 1, 'manual assignment has a lock');
  assert.equal(await history.getByTestId('HistoryIcon').count(), 1, 'preserved assignment has a history icon');
  assert.equal(await manual.getAttribute('aria-label'), 'שיבוץ ידני נעול');
  assert.equal(await history.getAttribute('aria-label'), 'שיבוץ עבר שנשמר אוטומטית');
  assert.equal(await page.getByTestId(`clear-pin-gate-${start + hour}`).getAttribute('aria-label'), 'שחרור שיבוץ עבר שנשמר');
  assert.equal(await page.locator('[data-testid^="pinned-gate-"]').count(), 2, 'automatic future assignment has no lock');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone has no horizontal overflow');
  await page.screenshot({ path: '/tmp/guard-assignment-badges.png', fullPage: true });
  await page.getByTestId(`clear-pin-gate-${start}`).tap();
  await manual.waitFor({ state: 'detached' });
  const shared = decodePlan(new URLSearchParams(page.url().split('?')[1]).get('p')).plan;
  assert.equal(shared.pins.length, 1, 'tap removes only the selected manual lock');
  assert.equal(shared.pins[0].frozen, true, 'preserved history remains');
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS manual lock/history icons, Hebrew labels, touch release, shared state, and 360px layout');

  /* ---------- a correction proposal for history holding the only driver ----
   * Preserved history pins the sole qualified driver onto one mission while
   * another requires him; the findings panel must offer the named move, and
   * tapping it must apply the correction as pins that survive in the URL.
   */
  const ctx2 = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const page2 = await ctx2.newPage();
  page2.on('pageerror', (error) => errors.push(error.message));
  page2.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const day = Date.parse('2030-09-10T16:00:00+03:00');
  const doc2 = planSchema.parse({
    start: day, end: day + 7 * hour, shiftMinutes: 60,
    tags: [{ id: 'd', name: 'נהג', minNightRestMinutes: 360 }],
    employees: [
      { id: 'drv', name: 'אבי', tags: ['d'] },
      { id: 'c1', name: 'דנה', tags: [] },
      { id: 'c2', name: 'גיל', tags: [] },
    ],
    missions: [
      { id: 'initiative2', name: 'יוזמה 2', type: 'local', start: day + 2 * hour, end: day + 4 * hour, count: 1, requires: [{ tag: 'd', count: 1 }] },
      { id: 'scout', name: 'סיור', type: 'remote', start: day + hour, end: day + 5 * hour, count: 1 },
    ],
    pins: [{ missionId: 'scout', employeeId: 'drv', frozen: true }],
  });
  await page2.goto(`${BASE}/#/schedule?p=${encodeURIComponent(encodePlan(doc2))}`, { waitUntil: 'networkidle' });
  const proposal = page2.getByTestId(`proposal-initiative2-${day + 2 * hour}`);
  await proposal.waitFor();
  assert.ok((await proposal.innerText()).includes('אבי'), 'the proposal names the held driver');
  assert.ok((await page2.getByTestId(`finding-missing-required-tag`).count()) >= 1, 'the shortage is reported alongside the fix');
  await page2.screenshot({ path: '/tmp/guard-correction-proposal.png', fullPage: true });
  assert.ok(await page2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone has no horizontal overflow');

  await page2.getByTestId(`apply-proposal-initiative2-${day + 2 * hour}`).tap();
  await page2.waitForTimeout(600);
  assert.equal(await page2.getByTestId(`finding-missing-required-tag`).count(), 0, 'the shortage is gone after acceptance');
  assert.equal(await page2.locator('[data-testid^="proposal-"]').count(), 0, 'the proposal is gone after acceptance');
  const applied = decodePlan(new URLSearchParams(page2.url().split('?')[1]).get('p')).plan;
  assert.ok(applied.pins.some((p) => p.missionId === 'initiative2' && p.employeeId === 'drv' && !p.frozen),
    'the accepted correction pins the driver on the mission');
  assert.ok(applied.pins.some((p) => p.missionId === 'scout' && p.employeeId !== 'drv'),
    'the released history pin was replaced');
  assert.ok(!applied.pins.some((p) => p.missionId === 'scout' && p.employeeId === 'drv'),
    'the old preserved pin is gone');
  // A reload of the shared URL shows the accepted state, not the proposal again.
  await page2.reload({ waitUntil: 'networkidle' });
  await page2.waitForTimeout(400);
  assert.equal(await page2.getByTestId(`finding-missing-required-tag`).count(), 0, 'the accepted correction survives a reload');
  assert.equal(await page2.locator('vite-error-overlay').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS correction proposal at 360px: named driver, apply on tap, pins persist through reload');
} finally {
  await browser.close();
}
