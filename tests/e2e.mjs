/**
 * End-to-end smoke test against the built app.
 *
 * Deliberately NOT part of `npm test`: it needs a browser and a running
 * preview server, which CI does not provision. Run it by hand after a build:
 *
 *   npm run build
 *   npx vite preview --port 4173 --strictPort &
 *   npm i --no-save playwright && npx playwright install chromium
 *   node tests/e2e.mjs
 *
 * Set BASE to point at another origin, and CHROME to an existing Chromium
 * binary when the sandbox already ships one.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4173';
const SHOT = process.env.SHOT_DIR || 'screenshots';
mkdirSync(SHOT, { recursive: true });

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name} ${extra}`); failures++; }
};
// MUI's Select injects zero-width and bidi marks into its rendered label.
const norm = (x) => x.replace(/[​-‏‪-‮]/g, '').trim();

const browser = await chromium.launch(
  process.env.CHROME ? { executablePath: process.env.CHROME } : {},
);
const context = await browser.newContext({
  permissions: ['clipboard-read', 'clipboard-write'],
  acceptDownloads: true,
});
const page = await context.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); failures++; });

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

/* ---------- employees ---------- */
const NAMES = ['אבי', 'דנה', 'יוסי', 'מיכל', 'רון', 'תמר', 'נועה', 'גיל', 'עמית', 'שיר'];
await page.getByTestId('bulk-names').fill(NAMES.join('\n'));
await page.getByTestId('add-bulk').click();
await page.waitForTimeout(300);
check('10 employees added', (await page.locator('[data-testid^="employee-name-"]').count()) === 10);
check('plan is stored in the URL', page.url().includes('?p='));

await page.getByTestId('plan-title').fill('בדיקה');
await page.waitForTimeout(200);

/* ---------- missions ---------- */
await page.getByTestId('tab-missions').click();
await page.waitForTimeout(200);

await page.getByTestId('add-mission').click();
await page.waitForTimeout(200);
await page.getByTestId('mission-name-m1').fill('סיור מרוחק');
await page.waitForTimeout(150);
await page.getByTestId('type-remote-m1').click();
await page.waitForTimeout(150);
await page.getByTestId('mission-count-m1').fill('4');
await page.waitForTimeout(200);

await page.getByTestId('add-mission').click();
await page.waitForTimeout(200);
await page.getByTestId('mission-name-m2').fill('שער');
await page.waitForTimeout(150);
await page.getByTestId('mission-count-m2').fill('2');
await page.waitForTimeout(250);
check('two missions defined', (await page.locator('[data-testid^="mission-name-"]').count()) === 2);

/* ---------- "returned now" rounds a remote mission's end up to the hour ---------- */
await page.getByTestId('mission-returned-now-m1').click();
await page.waitForTimeout(200);
const returnedEnd = await page.getByTestId('mission-end-m1').inputValue();
check('returned-now sets an end time', returnedEnd !== '', returnedEnd);
check('returned-now rounds to the top of the hour', /T\d{2}:00$/.test(returnedEnd), returnedEnd);
check('local mission has no returned-now button',
  (await page.locator('[data-testid="mission-returned-now-m2"]').count()) === 0);

/* ---------- assign specific people to the remote mission ---------- */
await page.getByTestId('assign-m1').click();
await page.waitForTimeout(300);
await page.getByRole('option', { name: 'אבי', exact: true }).click();
await page.getByRole('option', { name: 'דנה', exact: true }).click();
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

/* ---------- schedule ---------- */
await page.getByTestId('tab-schedule').click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOT}/01-agenda.png` });

const bodyText = await page.locator('body').innerText();
check('agenda rendered', bodyText.includes('סיור מרוחק') && bodyText.includes('שער'));
check('manual assignments show as pinned',
  (await page.locator('[data-testid^="pinned-"]').count()) >= 2);

const remotePeople = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="shift-select-m1-"]')]
  .map((n) => n.textContent.trim()));
check('remote mission staffed by 4', remotePeople.length === 4, JSON.stringify(remotePeople));
check('the hand-assigned people are the ones on it',
  remotePeople.some((p) => p.includes('אבי')) && remotePeople.some((p) => p.includes('דנה')),
  JSON.stringify(remotePeople));

/* ---------- the debug section is collapsed, but advertises its contents ----
 * The warnings used to be a wall of Alerts above the agenda. They now live
 * behind one toggle at the bottom, which is only safe as long as the toggle
 * still says how many there are - that label is the only route left to the
 * "remove this pin" repair button.
 */
check('the plan dump is not visible before opening the debug section',
  await page.getByTestId('plan-data-text').isHidden());
check('the debug toggle is below the summary table', await page.evaluate(() => {
  const summary = document.querySelector('[data-testid^="summary-"]');
  const toggle = document.querySelector('[data-testid="toggle-debug"]');
  if (!summary || !toggle) return false;
  return summary.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING;
}));
await page.getByTestId('toggle-debug').click();
await page.waitForTimeout(400);
check('opening the debug section reveals the plan dump',
  await page.getByTestId('plan-data-text').isVisible());
const debugPlanText = await page.getByTestId('plan-data-text').innerText();
check('the plan dump is the human-readable document, not the encoded blob',
  debugPlanText.includes('סיור מרוחק') && debugPlanText.includes('שער') && !debugPlanText.includes('?p='),
  debugPlanText.slice(0, 80));
const debugScheduleText = await page.getByTestId('schedule-text').innerText();
check('the debug section also shows the computed schedule as text',
  debugScheduleText.includes('סיור מרוחק') && /\d{2}:\d{2}/.test(debugScheduleText),
  debugScheduleText.slice(0, 80));
await page.screenshot({ path: `${SHOT}/05-debug-section.png` });
await page.getByTestId('toggle-debug').click();
await page.waitForTimeout(300);

/* ---------- manual swap ---------- */
const firstLocal = page.locator('[data-testid^="shift-select-m2-"]').first();
const beforeSwap = norm(await firstLocal.innerText());
await firstLocal.click();
await page.waitForTimeout(300);

const options = page.getByRole('option');
let swappedTo = null;
for (let i = 0, n = await options.count(); i < n; i++) {
  const o = options.nth(i);
  const label = norm(await o.innerText());
  if (label !== beforeSwap && (await o.getAttribute('aria-disabled')) !== 'true' && !label.includes('—')) {
    swappedTo = label;
    await o.click();
    break;
  }
}
await page.waitForTimeout(500);
check('a swap target was available', swappedTo !== null);
check('the swap took effect',
  norm(await page.locator('[data-testid^="shift-select-m2-"]').first().innerText()) === swappedTo);
check('the displaced person is rescheduled, not dropped',
  (await page.locator('body').innerText()).includes(beforeSwap));
await page.screenshot({ path: `${SHOT}/02-after-swap.png` });
const urlWithSwap = page.url();

/* ---------- CSV ---------- */
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByTestId('download-csv').click(),
]);
await download.saveAs(`${SHOT}/shifts.csv`);
const csv = readFileSync(`${SHOT}/shifts.csv`, 'utf8');
check('CSV carries the BOM', csv.charCodeAt(0) === 0xfeff);
check('CSV mentions both missions', csv.includes('סיור מרוחק') && csv.includes('שער'));
const individualShiftAssignments = await page.locator('[data-testid^="shift-select-"]').count();
check('CSV has one data row per individual shift assignment',
  csv.trimEnd().split('\r\n').length - 1 === individualShiftAssignments);

/* ---------- WhatsApp ---------- */
await page.getByTestId('copy-whatsapp').click();
await page.waitForTimeout(400);
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('WhatsApp text has a bold heading', clip.startsWith('*בדיקה*'), clip.slice(0, 40));
check('WhatsApp text uses a plain time - names table, not bulleted mission rows',
  !clip.includes('•') && clip.includes('*שער*') && /\*[^*\n]*סיור מרוחק\*/.test(clip), clip);
check('WhatsApp text lists only who is on duty', !clip.includes('פנויים'));

/* ---------- the shared link ---------- */
const ctx2 = await browser.newContext();
const page2 = await ctx2.newPage();
page2.on('pageerror', (e) => { console.log('PAGEERROR(shared)', e.message); failures++; });
await page2.goto(urlWithSwap, { waitUntil: 'networkidle' });
await page2.waitForTimeout(700);

const dump = (p) => p.evaluate(() => [...document.querySelectorAll('[data-testid^="shift-select-"]')]
  .map((n) => `${n.dataset.testid}=${n.textContent.trim()}`).join('|'));
const [a, b] = [await dump(page), await dump(page2)];
check('a shared URL reproduces the identical schedule, manual swap included',
  a === b && a.length > 0);
await page2.screenshot({ path: `${SHOT}/03-shared-link.png` });
await ctx2.close();

check('the document is RTL', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');

/* ---------- offline ---------- */
await page.waitForTimeout(1200);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
check('the service worker controls the page', await page.evaluate(async () => {
  await navigator.serviceWorker.ready;
  return Boolean(navigator.serviceWorker.controller);
}));

await context.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const offlineText = await page.locator('body').innerText();
check('the app still renders with the network off',
  offlineText.includes('שער') && offlineText.includes('סיור מרוחק'),
  offlineText.slice(0, 120));
await page.screenshot({ path: `${SHOT}/04-offline.png` });
await context.setOffline(false);

/* ---------- freezing the past across pages ----------------------------
 * A plan whose window already started, edited from a page other than the
 * schedule - the exact case a render-effect-only freeze would miss, since
 * that effect is unmounted while on Employees/Missions.
 */
const ctx3 = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page3 = await ctx3.newPage();
page3.on('pageerror', (e) => { console.log('PAGEERROR(freeze)', e.message); failures++; });

const pad2 = (n) => String(n).padStart(2, '0');
const localInput = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

await page3.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page3.getByTestId('bulk-names').fill(['רותם', 'עדי'].join('\n'));
await page3.getByTestId('add-bulk').click();
await page3.waitForTimeout(300);

// Push the window's start three hours into the past, so the first few hourly
// shifts are already-elapsed history by the time the mission below exists.
await page3.getByTestId('plan-start').fill(localInput(Date.now() - 3 * 3600 * 1000));
await page3.waitForTimeout(200);

await page3.getByTestId('tab-missions').click();
await page3.waitForTimeout(200);
// Deliberately not naming the mission: filling the name field would itself be
// a second edit, and this check wants to observe the state right after the
// single edit that created the mission - before anything has a chance to freeze.
await page3.getByTestId('add-mission').click();
await page3.waitForTimeout(250);

await page3.getByTestId('tab-schedule').click();
await page3.waitForTimeout(500);
const firstShift = page3.locator('[data-testid^="shift-select-m1-"]').first();
const firstShiftTestId = await firstShift.getAttribute('data-testid');
const [, , missionId, shiftStart] = firstShiftTestId.split('-');
const beforeAssignee = norm(await firstShift.innerText());
const pinnedBefore = await page3.locator('[data-testid^="pinned-m1-"]').count();
check('the elapsed shift is not yet pinned before any further edit', pinnedBefore === 0, String(pinnedBefore));

// An edit made from the Employees page, not the schedule screen.
await page3.getByTestId('tab-employees').click();
await page3.waitForTimeout(200);
await page3.getByTestId('bulk-names').fill('שיר');
await page3.getByTestId('add-bulk').click();
await page3.waitForTimeout(300);

await page3.getByTestId('tab-schedule').click();
await page3.waitForTimeout(500);
const afterAssignee = norm(await page3.locator(`[data-testid="${firstShiftTestId}"]`).innerText());
check('an edit made on the Employees page did not reshuffle an elapsed shift',
  afterAssignee === beforeAssignee, `${beforeAssignee} -> ${afterAssignee}`);
const pinnedAfter = await page3.locator('[data-testid^="pinned-m1-"]').count();
check('the elapsed shift was frozen into a real pin by that edit', pinnedAfter > 0, String(pinnedAfter));

// Clearing that frozen shift must stick, not bounce back on the next render.
const clearTestId = `clear-pin-${missionId}-${shiftStart}`;
await page3.getByTestId(clearTestId).click();
await page3.waitForTimeout(300);
const pinnedStillThere = await page3.locator(`[data-testid="pinned-${missionId}-${shiftStart}"]`).count();
check('clearing a frozen elapsed shift actually clears it', pinnedStillThere === 0, String(pinnedStillThere));

await page3.getByTestId('tab-employees').click();
await page3.waitForTimeout(200);
await page3.getByTestId('tab-schedule').click();
await page3.waitForTimeout(400);
const pinnedAfterNavigation = await page3.locator(`[data-testid="pinned-${missionId}-${shiftStart}"]`).count();
check('the clear survives navigating away and back, with no other edit in between',
  pinnedAfterNavigation === 0, String(pinnedAfterNavigation));

await ctx3.close();

/* ---------- open-ended missions ---------------------------------------
 * A mission with a start but no chosen end. `end: null` already meant "runs
 * to the plan's end" in the schema, the codec and the engine - the only thing
 * missing was a way to say it. Its own context so the checkbox cannot perturb
 * the main flow's schedule.
 */
const ctx4 = await browser.newContext();
const page4 = await ctx4.newPage();
page4.on('pageerror', (e) => { console.log('PAGEERROR(open-ended)', e.message); failures++; });

await page4.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page4.getByTestId('bulk-names').fill(['אורי', 'נטע'].join('\n'));
await page4.getByTestId('add-bulk').click();
await page4.waitForTimeout(300);
await page4.getByTestId('tab-missions').click();
await page4.waitForTimeout(200);
await page4.getByTestId('add-mission').click();
await page4.waitForTimeout(250);

// Whole-period by default, so the explicit-window editor is behind the chip.
await page4.getByTestId('limit-mission-m1').click();
await page4.waitForTimeout(250);
check('limiting a mission reveals both time fields',
  (await page4.locator('[data-testid="mission-end-m1"]').count()) === 1);

// A plain click, not Playwright's check()/uncheck(): ticking the box unmounts
// the end field right next to it, and the resulting layout shift makes
// check()'s click-then-verify retry, toggling the box straight back off.
await page4.getByTestId('mission-open-ended-m1').click();
await page4.waitForTimeout(400);
check('the open-ended box is ticked', await page4.getByTestId('mission-open-ended-m1').isChecked());
check('marking a mission open-ended removes the end field entirely',
  (await page4.locator('[data-testid="mission-end-m1"]').count()) === 0);
check('the start field survives going open-ended',
  (await page4.locator('[data-testid="mission-start-m1"]').count()) === 1);

// The whole point of null-not-a-timestamp: it has to survive the codec.
const openEndedUrl = page4.url();
const ctx5 = await browser.newContext();
const page5 = await ctx5.newPage();
page5.on('pageerror', (e) => { console.log('PAGEERROR(open-ended shared)', e.message); failures++; });
await page5.goto(openEndedUrl, { waitUntil: 'networkidle' });
await page5.waitForTimeout(600);
await page5.getByTestId('tab-missions').click();
await page5.waitForTimeout(400);
check('open-ended survives a round trip through the shared link',
  await page5.getByTestId('mission-open-ended-m1').isChecked()
  && (await page5.locator('[data-testid="mission-end-m1"]').count()) === 0);

// It must schedule to the plan's end, not stop early or vanish.
await page5.getByTestId('tab-schedule').click();
await page5.waitForTimeout(600);
const openEndedShifts = await page5.locator('[data-testid^="shift-select-m1-"]').count();
check('an open-ended mission still produces shifts', openEndedShifts > 0, String(openEndedShifts));
await page5.screenshot({ path: `${SHOT}/06-open-ended.png` });

// Unticking restores an editable end, so the state is not a one-way door.
await page4.getByTestId('mission-open-ended-m1').click();
await page4.waitForTimeout(400);
check('unticking restores an explicit, editable end',
  (await page4.getByTestId('mission-end-m1').inputValue()) !== '');

await ctx5.close();
await ctx4.close();

await browser.close();
console.log(failures === 0 ? '\nALL E2E CHECKS PASSED' : `\n${failures} E2E CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
