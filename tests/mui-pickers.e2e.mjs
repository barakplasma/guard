import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { planSchema } from '../src/lib/planSchema.js';
import { encodePlan, decodePlan } from '../src/lib/urlState.js';
const base = process.env.BASE || 'http://127.0.0.1:4173';
const shots = process.env.SHOT_DIR || '/tmp/guard-mui-pickers';
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Jerusalem', locale: 'he-IL' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const start = Date.parse('2030-09-10T08:00:00+03:00');
  const doc = planSchema.parse({ start, end: start + 2 * 86400000, shiftMinutes: 60,
    employees: [{ id: 'e', name: 'אבי' }],
    missions: [{ id: 'g', name: 'מטבח', type: 'daily', count: 1, dayStart: 480, dayEnd: 480 }] });
  await page.goto(`${base}/#/employees?p=${encodeURIComponent(encodePlan(doc))}`, { waitUntil: 'networkidle' });
  const current = () => decodePlan(new URLSearchParams(page.url().split('?')[1]).get('p')).plan;
  assert.equal(await page.getByTestId('plan-start-open').count(), 1, 'date fields must open a MUI picker');
  await page.getByTestId('plan-start-open').tap();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.getByRole('gridcell', { name: '11', exact: true }).tap();
  await dialog.getByRole('button', { name: 'ביטול', exact: true }).tap();
  assert.equal(current().start, start, 'cancel does not change the saved date');
  await page.getByTestId('plan-start-open').tap();
  await dialog.getByRole('gridcell', { name: '11', exact: true }).tap();
  await dialog.getByRole('button', { name: 'אישור', exact: true }).tap();
  assert.equal(current().start, start + 86400000, 'accept saves the selected local date');
  await page.getByTestId('plan-start').getByRole('spinbutton', { name: 'שעות', exact: true }).press('ArrowUp');
  assert.equal(current().start, start + 86400000 + 3600000, 'field editing preserves viewer-local time');
  await page.getByTestId('tab-missions').tap();
  const daily = page.getByTestId('mission-day-start-g');
  await daily.getByRole('spinbutton', { name: 'שעות', exact: true }).press('ArrowUp');
  assert.equal(current().missions[0].dayStart, 540);
  await page.getByTestId('mission-day-end-g').getByRole('spinbutton', { name: 'שעות', exact: true }).press('ArrowUp');
  assert.equal(current().missions[0].dayEnd, 540, 'equal times remain next-day duty');
  await page.waitForFunction(() => document.querySelector('[data-testid="mission-day-start-g"] [aria-label="שעות"]')?.getAttribute('aria-valuenow') === '9');
  await page.getByTestId('mission-day-start-g-open').tap();
  await dialog.waitFor();
  const hour = await dialog.getByRole('option', { name: '10 שעות', exact: true }).boundingBox();
  // The clock's mask handles touch coordinates over the labelled dial numbers.
  await page.touchscreen.tap(hour.x + hour.width / 2, hour.y + hour.height / 2);
  await dialog.getByRole('button', { name: 'אישור', exact: true }).tap();
  assert.equal(current().missions[0].dayStart, 600, 'accept saves selected clock hours');
  await page.getByTestId('mission-day-start-g-open').tap();
  await page.screenshot({ animations: 'disabled', path: `${shots}/time-dialog.png` });
  await dialog.getByRole('button', { name: 'ניקוי', exact: true }).tap();
  assert.equal(current().missions[0].dayStart, null, 'optional clocks can be cleared');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(current().missions[0].dayStart, null);
  for (const width of [360, 412, 1280]) {
    await page.setViewportSize({ width, height: 915 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}px`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS MUI date/time dialogs, cancel, keyboard sections, timezone, equal clocks, clear, URL persistence, responsive layout');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error((await page.locator('body').innerText()).slice(0, 5000));
    await page.screenshot({ path: `${shots}/failure.png` });
  }
  throw error;
} finally { await browser.close(); }
