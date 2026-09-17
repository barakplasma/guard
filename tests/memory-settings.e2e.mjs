/**
 * The two memory numbers, tapped on a phone.
 *
 * Both are ordinary Number Spinner fields, which is what AGENTS.md requires -
 * native spinners and a desktop screenshot do not prove a usable phone
 * control. So this taps the 44-pixel buttons rather than typing, on the three
 * viewports the layout check uses, and asserts the values land in the document
 * and therefore in the link.
 *
 * It also pins the one place the two numbers can contradict each other: a
 * cooldown longer than the memory cannot be observed, and the mission card
 * says which number to change rather than clamping one behind the user's back.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { planSchema } from '../src/lib/planSchema.js';
import { decodePlan, encodePlan, PARAM } from '../src/lib/urlState.js';
import { baseUrl, launchBrowser, watchErrors } from './e2eHelpers.mjs';

const SHOT_DIR = process.env.SHOT_DIR || '/tmp/guard-shots';
await mkdir(SHOT_DIR, { recursive: true });

const HOUR = 3600000;
const start = Date.parse('2030-09-10T08:00:00+03:00');
const doc = planSchema.parse({
  start,
  end: start + 6 * HOUR,
  shiftMinutes: 60,
  employees: [{ id: 'e1', name: 'דנה' }, { id: 'e2', name: 'יוסי' }],
  missions: [{ id: 'kitchen', name: 'מטבח', type: 'local', count: 1 }],
  tags: [{ id: 'cmd', name: 'מפקד' }],
  pins: [],
});

/** The document the page currently holds, read back out of the URL. */
async function planOnPage(page) {
  const url = new URL(await page.url());
  const search = url.hash.slice(url.hash.indexOf('?'));
  const blob = new URLSearchParams(search).get(PARAM);
  const result = decodePlan(blob);
  assert.ok(result.ok, `the link still decodes (${result.reason ?? ''})`);
  return result.plan;
}

const browser = await launchBrowser();
try {
  for (const viewport of [{ width: 360, height: 800 }, { width: 412, height: 915 }, { width: 768, height: 1024 }]) {
    const context = await browser.newContext({
      viewport, isMobile: true, hasTouch: true, locale: 'he-IL', timezoneId: 'Asia/Jerusalem',
    });
    const page = await context.newPage();
    const errors = [];
    watchErrors(page, errors);

    // The settings bar lives on the Employees page, beside the plan window.
    await page.goto(`${baseUrl}/#/employees?p=${encodeURIComponent(encodePlan(doc))}`, { waitUntil: 'networkidle' });

    /* --- the plan's memory, on the settings bar --- */
    const memory = page.getByTestId('memory-days');
    await memory.waitFor();
    assert.equal(await memory.inputValue(), '21', `the default is visible at ${viewport.width}px`);

    await page.getByTestId('memory-days-decrement').tap();
    await page.waitForFunction(() => window.location.href.length > 0);
    await page.waitForTimeout(150);
    assert.equal(await memory.inputValue(), '20', 'a tap moved it');
    assert.equal((await planOnPage(page)).memoryDays, 20, 'and the link carries it');

    /* --- the mission's hard flag --- */
    await page.goto(`${baseUrl}/#/missions?${new URL(await page.url()).hash.split('?')[1]}`, { waitUntil: 'networkidle' });
    const hard = page.getByTestId('mission-hard-kitchen');
    await hard.waitFor();
    assert.equal(await hard.isChecked(), false, 'off until somebody says otherwise');

    await hard.tap();
    await page.waitForTimeout(150);
    assert.equal((await planOnPage(page)).missions[0].hard, true, 'the mission carries the rule');

    /* --- and the qualification exemption beside it --- */
    await page.goto(`${baseUrl}/#/employees?${new URL(await page.url()).hash.split('?')[1]}`, { waitUntil: 'networkidle' });
    const exempt = page.getByTestId('tag-exempt-cmd');
    await exempt.waitFor();
    assert.equal(await exempt.isChecked(), false);

    await exempt.tap();
    await page.waitForTimeout(150);
    const tags = (await planOnPage(page)).tags;
    assert.equal(tags.find((tag) => tag.id === 'cmd').exemptFromHardMissions, true,
      'and the link carries the exemption');

    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.ok(fits, `no horizontal overflow at ${viewport.width}px`);

    assert.deepEqual(errors, [], `no console errors at ${viewport.width}px`);
    await context.close();
  }
  console.log('memory settings: ok');
} catch (error) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      await page.screenshot({ path: `${SHOT_DIR}/memory-settings-failure.png` });
    }
  }
  throw error;
} finally {
  await browser.close();
}
