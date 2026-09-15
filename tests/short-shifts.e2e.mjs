/** The shared regression and its minute/hour correction on a touch viewport. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { decodePlan } from '../src/lib/urlState.js';
import { encodePlan } from '../src/lib/urlState.js';
import { shortShiftsBlob } from './fixtures/short-shifts.js';

const base = process.env.BASE || 'http://127.0.0.1:4173';
const shots = process.env.SHOT_DIR || '/tmp/guard-short-shifts-proof';
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 },
    isMobile: true, hasTouch: true, locale: 'he-IL', timezoneId: 'Asia/Jerusalem',
    permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Edits must not turn this historic reproduction into newly frozen history.
  await page.clock.install({ time: new Date('2026-09-15T11:00:00+03:00') });
  await page.goto(`${base}/#/schedule?p=${encodeURIComponent(shortShiftsBlob)}`, { waitUntil: 'networkidle' });
  const assertHourly = async () => {
    await page.locator('[data-testid^="slot-"]').first().waitFor();
    const rows = await page.locator('[data-testid^="slot-"]').evaluateAll((nodes) => nodes.map((n) => ({
      start: Number(n.dataset.testid.slice(5)), end: Number(n.dataset.slotEnd),
    })));
    assert.equal(rows.length, 21);
    assert.ok(rows.every((r) => r.end - r.start === 3600000));
    assert.equal(await page.getByTestId('finding-engine-bug').count(), 0);
  };
  await assertHourly();
  await page.getByTestId(`slot-${Date.parse('2026-09-15T22:00:00+03:00')}`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/hourly-schedule.png` });
  await page.getByTestId('tab-employees').tap();
  const current = () => decodePlan(new URLSearchParams(page.url().split('?')[1]).get('p')).plan;
  assert.deepEqual(current().tags.map((t) => t.minNightRestMinutes), [6, 3, 3], 'opening old links preserves their units');
  for (const [id, hours] of [['q1', 6], ['q2', 3], ['q3', 3]]) {
    const correction = page.getByTestId(`tag-rest-hours-${id}`);
    await correction.scrollIntoViewIfNeeded();
    assert.ok((await correction.innerText()).includes(String(hours * 60)));
    await correction.tap();
    assert.equal(current().tags.find((t) => t.id === id).minNightRestMinutes, hours * 60);
    await correction.waitFor({ state: 'detached' });
  }
  await page.getByTestId('tag-rest-q1').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/rest-units.png` });
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(current().tags.map((t) => t.minNightRestMinutes), [360, 180, 180]);
  await page.getByTestId('tab-schedule').tap();
  await assertHourly();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  // A manual hold is valid, but its workload concentration and unused crew
  // must be discoverable without opening the developer debug section.
  const concentrated = current();
  concentrated.pins = [{ missionId: 'm1', employeeId: 'e1', start: concentrated.start, end: concentrated.end }];
  await page.goto(`${base}/#/schedule?p=${encodeURIComponent(encodePlan(concentrated))}`, { waitUntil: 'networkidle' });
  const checks = page.getByTestId('toggle-schedule-checks');
  await checks.waitFor();
  assert.ok((await checks.innerText()).includes('16'));
  await checks.tap();
  await page.getByTestId('finding-workload-outlier').waitFor();
  assert.equal(await page.getByTestId('finding-employee-unused').count(), 15);
  assert.equal(await page.getByTestId('toggle-debug').getAttribute('aria-expanded'), 'false');
  await page.getByTestId('schedule-check-filter').getByRole('button', { name: 'ללא משמרות', exact: true }).tap();
  assert.equal(await page.getByTestId('finding-workload-outlier').count(), 0);
  assert.equal(await page.getByTestId('finding-employee-unused').count(), 15);
  await checks.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/schedule-checks.png` });
  concentrated.pins[0].end = concentrated.start + 6 * 60000;
  await page.goto(`${base}/#/schedule?p=${encodeURIComponent(encodePlan(concentrated))}`, { waitUntil: 'networkidle' });
  if (await page.getByTestId('toggle-schedule-checks').getAttribute('aria-expanded') !== 'true') {
    await page.getByTestId('toggle-schedule-checks').tap();
  }
  await page.getByTestId('schedule-check-filter').getByRole('button', { name: 'אורך משמרת', exact: true }).tap();
  await page.getByTestId('finding-short-shift').first().waitFor();
  assert.ok((await page.getByTestId('finding-short-shift').first().innerText()).includes('6 דקות'));
  await page.getByTestId('copy-schedule-report').tap();
  await page.waitForFunction(async () => (await navigator.clipboard.readText()).startsWith('{'));
  const report = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  assert.equal(report.timeZone, 'Asia/Jerusalem');
  assert.ok(report.appVersion);
  assert.equal(report.plan.pins[0].end - report.plan.pins[0].start, 6 * 60000);
  assert.ok(report.warnings.some((w) => w.code === 'short-shift' && w.actualMinutes === 6));
  assert.ok(report.shifts.length > 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log('PASS hourly schedule, hours correction, runtime findings/filters, reproducible report, touch layout');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error((await page.locator('body').innerText()).slice(0, 5000));
    await page.screenshot({ path: `${shots}/failure.png` });
  }
  throw error;
} finally {
  await browser.close();
}
