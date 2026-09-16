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

    /* --- the mission's once-per-rotation days --- */
    await page.goto(`${baseUrl}/#/missions?${new URL(await page.url()).hash.split('?')[1]}`, { waitUntil: 'networkidle' });
    const repeat = page.getByTestId('mission-repeat-days-kitchen');
    await repeat.waitFor();
    assert.equal(await repeat.inputValue(), '', 'empty means no rule, not a misleading zero');

    await page.getByTestId('mission-repeat-days-kitchen-increment').tap();
    await page.waitForTimeout(150);
    const after = await planOnPage(page);
    assert.equal(after.missions[0].repeatAfterDays, 1, 'the mission carries the rule');

    /* --- and what happens when the two disagree --- */
    await repeat.fill('60');
    await repeat.blur();
    await page.waitForTimeout(200);
    const warning = page.getByTestId('mission-repeat-warning-kitchen');
    await warning.waitFor();
    const text = await warning.innerText();
    assert.match(text, /60/, 'the helper text names the cooldown');
    assert.match(text, /20/, 'and the memory it outruns');

    await repeat.fill('7');
    await repeat.blur();
    await page.waitForTimeout(200);
    assert.equal(await warning.count(), 0, 'and it goes away once they agree');

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
