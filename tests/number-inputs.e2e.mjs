/** Touch controls must be real buttons: mobile Chrome can omit native spinners. */
import assert from 'node:assert/strict';
import { planSchema } from '../src/lib/planSchema.js';
import { encodePlan, decodePlan } from '../src/lib/urlState.js';
import { assertResponsive, baseUrl as base, launchBrowser, screenshotDirectory, watchErrors } from './e2eHelpers.mjs';

const shots = screenshotDirectory('/tmp/guard-number-inputs');
const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'Asia/Jerusalem' });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  watchErrors(page, errors);
  const start = Date.parse('2030-09-10T22:00:00+03:00');
  const doc = planSchema.parse({ start, end: start + 8 * 3600000, shiftMinutes: 60,
    employees: [{ id: 'e', name: 'אבי', tags: ['d'] }],
    tags: [{ id: 'd', name: 'נהג', minNightRestMinutes: 360 }],
    missions: [{ id: 'g', name: 'שמירה', type: 'local', count: 1, requires: [{ tag: 'd', count: 1 }] }] });
  await page.goto(`${base}/#/missions?p=${encodeURIComponent(encodePlan(doc))}`, { waitUntil: 'networkidle' });
  assert.ok(await page.title());
  const current = () => decodePlan(new URLSearchParams(page.url().split('?')[1]).get('p')).plan;
  const field = (id) => page.getByTestId(id);
  const displays = (id, value) => page.waitForFunction((expected) => document.querySelector(`[data-testid="${expected.id}"]`)?.value === expected.value, { id, value });
  const button = (id, direction) => field(`${id}-${direction}`);
  const count = 'mission-count-g';
  assert.equal(await button(count, 'increment').count(), 1, 'numeric fields need explicit increment buttons on mobile');
  for (const direction of ['increment', 'decrement']) {
    const box = await button(count, direction).boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, 'touch targets are at least 44px');
    assert.ok(await button(count, direction).getAttribute('aria-label'));
  }
  assert.ok(await button(count, 'decrement').isDisabled());
  await button(count, 'increment').tap();
  assert.equal(current().missions[0].count, 2);
  await button(count, 'decrement').tap();
  assert.equal(current().missions[0].count, 1);
  await field(count).fill('999');
  assert.ok(await button(count, 'increment').isDisabled());
  await field(count).fill('1000');
  assert.equal(current().missions[0].count, 999, 'invalid input cannot corrupt the shared document');
  await field(count).blur();
  await displays(count, '999');
  await field(count).fill('');
  await field(count).blur();
  await displays(count, '999');
  await field(count).fill('1');
  await displays(count, '1');
  await field(count).press('ArrowUp');
  await displays(count, '2');
  assert.equal(current().missions[0].count, 2);

  await page.waitForFunction(() => document.querySelector('[data-testid="mission-night-count-g"]')?.placeholder === '2');
  await button('mission-night-count-g', 'increment').tap();
  assert.equal(current().missions[0].nightCount, 3, 'step from inherited day count');
  await field('mission-night-count-g').fill('');
  assert.equal(current().missions[0].nightCount, null);
  await button('mission-shift-g', 'increment').tap();
  assert.equal(current().missions[0].shiftMinutes, 65);
  await page.waitForFunction(() => document.querySelector('[data-testid="mission-night-shift-g"]')?.placeholder === '65');
  await button('mission-night-shift-g', 'decrement').tap();
  assert.equal(current().missions[0].nightShiftMinutes, 60);
  await field('mission-shift-g').fill('');
  assert.equal(current().missions[0].shiftMinutes, null);
  await displays('mission-shift-g', '');
  await field('mission-shift-g').press('Home');
  assert.equal(current().missions[0].shiftMinutes, 5);
  await field('mission-shift-g').fill('');
  await displays('mission-shift-g', '');
  await field('mission-shift-g').press('End');
  assert.equal(current().missions[0].shiftMinutes, 1440);
  await field('mission-shift-g').fill('');

  await button('require-count-g-d', 'increment').tap();
  assert.equal(current().missions[0].requires[0].count, 2);
  await button('require-count-g-d', 'decrement').tap();
  await field(count).fill('1');
  await page.getByTestId('mission-oncall-g').getByRole('switch').tap();
  assert.equal(current().missions[0].onCall, true);
  const shared = current();
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(current(), shared);
  assert.ok(await page.getByTestId('mission-oncall-g').getByRole('switch').isChecked());
  await assertResponsive(page, assert);
  await page.setViewportSize({ width: 412, height: 915 });
  await field(count).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/missions-412.png` });
  await page.getByTestId('tab-schedule').tap();
  await page.locator('[data-testid^="slot-"]').first().waitFor();
  assert.equal(await page.getByTestId('finding-rest-unsatisfied').count(), 0);
  await page.getByTestId('tab-missions').tap();
  await page.getByTestId('mission-oncall-g').getByRole('switch').tap();
  await page.getByTestId('tab-schedule').tap();
  await page.getByTestId('finding-rest-unsatisfied').first().waitFor();
  await page.getByTestId('tab-employees').tap();
  await button('tag-rest-d', 'decrement').tap();
  assert.equal(current().tags[0].minNightRestMinutes, 359);
  await field('tag-rest-d').fill('');
  await button('tag-rest-d', 'increment').tap();
  assert.equal(current().tags[0].minNightRestMinutes, 1);
  await button('shift-minutes', 'increment').tap();
  assert.equal(current().shiftMinutes, 65);
  assert.deepEqual(errors, []);
  console.log('PASS touch buttons, bounds, keyboard, inherited/blank values, qualifications, on-call URL persistence, responsive layout');
} finally {
  await browser.close();
}
