/** Acceptance coverage for searchable 19-person rosters and standard MUI disclosure/pickers. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { planSchema } from '../src/lib/planSchema.js';
import { encodePlan, decodePlan } from '../src/lib/urlState.js';
const base = process.env.BASE || 'http://127.0.0.1:4173';
const shots = process.env.SHOT_DIR || '/tmp/guard-mui-controls';
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  // The last name is deliberately far longer than a narrow agenda column: it is
  // the case that used to arrive on screen as "ש..." and made the rota useless.
  const names = ['אבי', 'דנה', 'יוסי', 'מיכל', 'רון', 'תמר', 'נועה', 'גיל', 'עמית', 'שיר', 'אורי', 'נטע', 'רותם', 'עדי', 'יעל', 'יובל', 'אלון', 'זוהר',
    'שוהם בן-דוד הכהן'];
  const start = Date.parse('2030-09-10T22:00:00+03:00');
  const doc = planSchema.parse({ start, end: start + 8 * 3600000, shiftMinutes: 60,
    employees: names.map((name, i) => ({ id: `e${i}`, name, ...(i === 17 ? { end: start - 3600000 } : {}) })),
    missions: [{ id: 'g', name: 'שמירה', type: 'local', count: 2 }],
    pins: [{ missionId: 'g', employeeId: 'e0', start, end: start + 3600000 }] });
  await page.goto(`${base}/#/missions?p=${encodeURIComponent(encodePlan(doc))}`, { waitUntil: 'networkidle' });
  const current = () => decodePlan(new URLSearchParams(page.url().split('?')[1]).get('p')).plan;
  const assign = page.getByTestId('assign-g');
  assert.equal(await assign.getAttribute('role'), 'combobox', 'mission assignees must support typed search');
  await assign.fill('יובל');
  assert.equal(await page.getByRole('option').count(), 1, 'search filters 19 people');
  await page.getByRole('option', { name: 'יובל', exact: true }).tap();
  await page.keyboard.press('Escape');
  assert.ok(current().pins.some((p) => p.employeeId === 'e15'));
  assert.ok(current().pins.some((p) => p.employeeId === 'e0' && p.end === start + 3600000), 'adding a name preserves existing partial pins');
  await assign.fill('זוהר');
  assert.ok((await page.getByRole('option').innerText()).includes('זמינ'), 'unavailable roster entries retain their explanation');
  await page.keyboard.press('Escape');
  await page.getByTestId('tab-schedule').tap();
  const replacement = page.locator('[data-testid^="shift-select-g-"]').first();
  await replacement.waitFor();
  // The name is text on a button now, not the value of an input: an input is
  // only as wide as its column, and that is what cut every long Hebrew name.
  assert.equal(await replacement.evaluate((node) => node.tagName), 'BUTTON');
  assert.ok(await replacement.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    'the assigned name fits its control instead of being cut');
  await replacement.tap();
  const search = page.getByTestId('assign-search');
  await search.waitFor();
  await search.fill('זוהר');
  assert.equal(await page.getByRole('option').getAttribute('aria-disabled'), 'true');
  await search.fill('שוהם');
  const longName = page.getByTestId('assign-option-e18');
  assert.equal(await longName.innerText(), 'שוהם בן-דוד הכהן', 'a long name is listed in full');
  assert.ok(await longName.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    'a long name wraps inside the dialog instead of overflowing it');
  await page.screenshot({ path: `${shots}/assign-dialog.png` });
  await search.fill('אלון');
  await page.getByRole('option', { name: /^אלון/ }).tap();
  await page.getByTestId('assign-search').waitFor({ state: 'hidden' });
  assert.ok(current().pins.some((p) => p.employeeId === 'e16' && p.start === start));
  const toggle = page.getByTestId('toggle-debug');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.tap();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(await page.getByTestId('plan-data-text').isVisible());
  await toggle.press('Space');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await page.getByTestId('tab-missions').tap();
  for (const width of [360, 412, 1280]) {
    await page.setViewportSize({ width, height: 915 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 412, height: 915 });
  await assign.scrollIntoViewIfNeeded();
  await assign.fill('י');
  await page.screenshot({ path: `${shots}/roster-search.png` });
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS 19-person search, partial pins, unavailable replacements, swaps, accordion keyboard/ARIA, responsive layouts');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error((await page.locator('body').innerText()).slice(0, 5000));
    await page.screenshot({ path: `${shots}/failure.png` });
  }
  throw error;
} finally { await browser.close(); }
