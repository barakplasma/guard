/**
 * Acceptance coverage for the date and time fields.
 *
 * They are native `datetime-local` / `time` inputs in a MUI TextField, not a
 * MUI picker: a native field opens the platform's own picker on a phone, needs
 * no date library, and speaks only 24-hour `HH:mm` whatever the device shows.
 * That last part is why the picker went - on a 12-hour device its hour section
 * counted inside its own half of the day, so stepping a plan's start back over
 * noon threw it nine hours forward, and the history-freezing test only caught
 * it after midday.
 */
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
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const start = Date.parse('2030-09-10T08:00:00+03:00');
  const doc = planSchema.parse({ start, end: start + 2 * 86400000, shiftMinutes: 60,
    employees: [{ id: 'e', name: 'אבי' }],
    missions: [{ id: 'g', name: 'מטבח', type: 'daily', count: 1, dayStart: 480, dayEnd: 480 }] });
  await page.goto(`${base}/#/employees?p=${encodeURIComponent(encodePlan(doc))}`, { waitUntil: 'networkidle' });
  const current = () => decodePlan(new URLSearchParams(page.url().split('?')[1]).get('p')).plan;

  const planStart = page.getByTestId('plan-start');
  assert.equal(await planStart.getAttribute('type'), 'datetime-local',
    'the plan bounds use the platform date field');
  assert.equal(await planStart.inputValue(), '2030-09-10T08:00',
    'the field shows the viewer-local instant on a 24-hour clock');

  // Typing a whole value is one edit, and it is stored as the local instant.
  await planStart.fill('2030-09-11T08:00');
  assert.equal(current().start, start + 86400000, 'editing saves the selected local date');

  // The value is 24-hour, so hour arithmetic is plain arithmetic - including
  // across noon, where a 12-hour field wraps inside the afternoon instead.
  await planStart.fill('2030-09-11T12:00');
  const noon = current().start;
  await planStart.fill('2030-09-11T09:00');
  assert.equal(current().start, noon - 3 * 3600000, 'three hours back from noon is 09:00, not 21:00');

  await page.getByTestId('tab-missions').tap();
  const dayStart = page.getByTestId('mission-day-start-g');
  assert.equal(await dayStart.getAttribute('type'), 'time', 'daily clocks use the platform time field');
  assert.equal(await dayStart.inputValue(), '08:00');
  await dayStart.fill('09:00');
  assert.equal(current().missions[0].dayStart, 540, 'a wall clock is stored as minutes past midnight');
  await page.getByTestId('mission-day-end-g').fill('09:00');
  assert.equal(current().missions[0].dayEnd, 540, 'equal times remain next-day duty');
  await page.screenshot({ animations: 'disabled', path: `${shots}/time-fields.png` });

  // An optional clock can be emptied again; the plan's own bounds cannot, so
  // there is no clear button on those to empty them by accident.
  await page.getByTestId('mission-day-start-g-clear').tap();
  assert.equal(current().missions[0].dayStart, null, 'optional clocks can be cleared');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(current().missions[0].dayStart, null);
  assert.equal(await page.getByTestId('plan-start-clear').count(), 0,
    'a required bound offers no clear button');

  for (const width of [360, 412, 1280]) {
    await page.setViewportSize({ width, height: 915 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}px`);
  }

  // A 12-hour device gets the same 24-hour value. Every rendered time in the
  // app goes through format.js with hourCycle 'h23', and the field's value is
  // part of the contract, not a matter of locale.
  const usContext = await browser.newContext({ locale: 'en-US', timezoneId: 'Asia/Jerusalem' });
  const usPage = await usContext.newPage();
  usPage.on('pageerror', (error) => errors.push(error.message));
  const noonStart = Date.parse('2030-09-10T12:00:00+03:00');
  const usDoc = planSchema.parse({ start: noonStart, end: noonStart + 86400000, shiftMinutes: 60,
    employees: [{ id: 'e', name: 'אבי' }], missions: [] });
  await usPage.goto(`${base}/#/employees?p=${encodeURIComponent(encodePlan(usDoc))}`, { waitUntil: 'networkidle' });
  assert.equal(await usPage.getByTestId('plan-start').inputValue(), '2030-09-10T12:00',
    'a 12-hour device still reads and writes a 24-hour value');
  await usPage.getByTestId('plan-start').fill('2030-09-10T09:00');
  const usStart = decodePlan(new URLSearchParams(usPage.url().split('?')[1]).get('p')).plan.start;
  assert.equal(usStart, noonStart - 3 * 3600000, 'and stores the same instant a Hebrew device would');
  await usContext.close();

  assert.deepEqual(errors, []);
  console.log('PASS native date/time fields, 24-hour values across device locales, clearable optional clocks, URL persistence, responsive layout');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error((await page.locator('body').innerText()).slice(0, 5000));
    await page.screenshot({ path: `${shots}/failure.png` });
  }
  throw error;
} finally { await browser.close(); }
