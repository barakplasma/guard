/** Headless acceptance coverage for Plans 3–5. Run against a built preview. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { planSchema } from '../src/lib/planSchema.js';
import { encodePlan, decodePlan } from '../src/lib/urlState.js';
const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const SHOT = process.env.SHOT_DIR || '/tmp/guard-features';
mkdirSync(SHOT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || '/usr/bin/chromium' });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, timezoneId: 'Asia/Jerusalem', locale: 'en-GB' });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const start = Date.parse('2030-09-10T08:00:00+03:00');
  const initial = planSchema.parse({ start, end: start + 2 * 86400000, shiftMinutes: 60,
    employees: ['אבי', 'דנה', 'גיל'].map((name, i) => ({ id: `e${i}`, name })),
    missions: [{ id: 'k', name: 'מטבח', type: 'local', count: 2 }] });
  const go = (doc, route) => page.goto(`${BASE}/#/${route}?p=${encodeURIComponent(encodePlan(doc))}`, { waitUntil: 'networkidle' });
  const current = () => decodePlan(new URLSearchParams(page.url().split('?')[1]).get('p')).plan;
  const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
  await go(initial, 'employees');
  assert.ok(await page.title());
  await page.getByTestId('add-tag').click();
  await page.getByTestId('tag-name-q1').fill('נהג');
  await page.getByTestId('tag-rest-q1').fill('360');
  await page.getByTestId('add-tag').click();
  await page.getByTestId('tag-name-q2').fill('מפקד');
  const pick = async (testId, name) => {
    await page.getByTestId(testId).fill(name);
    await page.getByRole('option', { name, exact: true }).click();
    await page.keyboard.press('Escape');
    await page.locator('.MuiAutocomplete-root').filter({ has: page.getByTestId(testId) }).getByText(name, { exact: true }).waitFor();
  };
  await pick('employee-tags-e0', 'נהג');
  await pick('employee-tags-e0', 'מפקד');
  await pick('employee-tags-e1', 'מפקד');
  assert.deepEqual(current().employees[0].tags, ['q1', 'q2']);
  await noOverflow();
  await page.screenshot({ path: `${SHOT}/qualifications-360.png`, fullPage: true });
  await page.getByTestId('tab-missions').click();
  await page.getByTestId('type-daily-k').click();
  await page.getByTestId('mission-day-start-k').getByRole('spinbutton', { name: 'שעות', exact: true }).press('8');
  await page.getByTestId('mission-day-start-k').getByRole('spinbutton', { name: 'דקות', exact: true }).press('0');
  await page.getByTestId('mission-day-end-k').getByRole('spinbutton', { name: 'שעות', exact: true }).press('8');
  await page.getByTestId('mission-day-end-k').getByRole('spinbutton', { name: 'דקות', exact: true }).press('0');
  await pick('mission-requires-k', 'נהג');
  await pick('mission-requires-k', 'מפקד');
  assert.equal(current().missions[0].dayEnd, 480);
  await noOverflow();
  await page.screenshot({ path: `${SHOT}/daily-mission-360.png`, fullPage: true });
  await page.getByTestId('tab-schedule').click();
  const slots = page.locator('[data-testid^="slot-"]');
  await slots.first().waitFor();
  assert.equal(await slots.count(), 2, 'two full daily holds');
  assert.equal(await page.getByTestId('finding-missing-required-tag').count(), 0);
  assert.ok(await page.getByTestId('shift-qualifications-e0').count());
  assert.ok(await page.getByTestId('finding-rest-unsatisfied').count(), 'staffing continued despite rest shortfall');
  assert.equal(await page.getByTestId('engine-error').count(), 0);
  await noOverflow();
  await page.screenshot({ path: `${SHOT}/schedule-360.png`, fullPage: true });
  const staffed = current();
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(current(), staffed, 'shared URL retains every input');
  const missing = structuredClone(staffed);
  missing.employees[0].tags = ['q2'];
  await go(missing, 'schedule');
  assert.ok(await page.getByTestId('finding-missing-required-tag').count());
  assert.ok(await page.getByTestId('copy-link').isEnabled());
  await noOverflow();
  await page.screenshot({ path: `${SHOT}/shortage-360.png`, fullPage: true });
  await go(staffed, 'employees');
  await page.getByTestId('remove-tag-q1').click();
  await page.getByTestId('confirm-remove-tag').click();
  assert.ok(!current().tags.some((t) => t.id === 'q1'));
  assert.ok(!current().missions[0].requires.some((r) => r.tag === 'q1'));
  assert.ok(!current().employees[0].tags.includes('q1'));
  const invalid = { ...staffed, end: staffed.start };
  await go(invalid, 'schedule');
  assert.ok(await page.getByTestId('copy-link').isEnabled(), 'source link survives computation error');
  assert.ok(await page.getByTestId('download-csv').isDisabled());
  // A same-tab corrupt link shows a blank document, whose next edit must not
  // resurrect the previously cached roster.
  await page.evaluate(() => { window.location.hash = '/employees?p=corrupt'; });
  await page.getByTestId('new-employee-name').fill('חדש');
  await page.getByTestId('add-employee').click();
  assert.equal(current().missions.length, 0, 'blank document does not restore cached missions');
  assert.equal(current().employees.length, 1);
  assert.equal(current().employees[0].name, 'חדש');
  await page.setViewportSize({ width: 1280, height: 800 });
  await go(staffed, 'schedule');
  await noOverflow();
  await page.screenshot({ path: `${SHOT}/schedule-desktop.png`, fullPage: true });
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS Plans 3–5: daily holds, qualification controls, rest/coverage findings, URL, deletion, error sharing, 360px and desktop');
} catch (error) {
  console.error('Browser errors:', errors);
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error((await page.locator('body').innerText()).slice(0, 4000));
    await page.screenshot({ path: `${SHOT}/failure.png`, fullPage: true });
  }
  throw error;
} finally { await browser.close(); }
