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
import { encodePlan, decodePlan } from '../src/lib/urlState.js';
import { planSchema, topOfHour } from '../src/lib/planSchema.js';
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
// Who a shift-select control says is on duty. It is a button showing the name
// as wrapping text, not an input - a dropdown truncated every Hebrew name
// longer than four letters to "ש..." on a phone, so the name is plain text
// now and the roster moved into a dialog behind it.
const assignee = (locator) => locator.innerText().then(norm);

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
check('the count chip reads the roster size',
  norm(await page.getByTestId('employee-count').innerText()) === '10 אנשים');

// Duplicates are refused on the way in, from both boxes, and the roster is
// left exactly as it was - the rest of this file counts on these 10 names.
await page.getByTestId('bulk-names').fill([NAMES[0], '  ' + NAMES[3] + ' '].join('\n'));
await page.getByTestId('add-bulk').click();
await page.waitForTimeout(300);
check('a duplicate paste adds nobody',
  (await page.locator('[data-testid^="employee-name-"]').count()) === 10);
check('the duplicates are named in a toast',
  (await page.getByTestId('employee-toast').innerText()).includes(NAMES[3]));

await page.getByTestId('new-employee-name').fill(NAMES[1]);
await page.getByTestId('add-employee').click();
await page.waitForTimeout(300);
check('a duplicate single name adds nobody',
  (await page.locator('[data-testid^="employee-name-"]').count()) === 10);
check('the refused name stays in the box for editing',
  (await page.getByTestId('new-employee-name').inputValue()) === NAMES[1]);
await page.getByTestId('new-employee-name').fill('');
await page.waitForTimeout(150);

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
const returnedEnd = decodePlan(new URLSearchParams(page.url().split('?')[1]).get('p')).plan.missions.find((m) => m.id === 'm1').end;
check('returned-now sets an end time', Number.isFinite(returnedEnd), returnedEnd);
check('returned-now rounds to the top of the hour', new Date(returnedEnd).getMinutes() === 0, returnedEnd);
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
  .map((n) => n.innerText.trim()));
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
const beforeSwap = await assignee(firstLocal);
check('a shift shows the full name, not a truncated one', !beforeSwap.includes('…'), beforeSwap);
await firstLocal.click();
await page.waitForTimeout(300);
check('tapping a shift opens the roster dialog',
  await page.getByTestId('assign-search').isVisible());

const options = page.getByRole('option');
let swappedTo = null;
for (let i = 0, n = await options.count(); i < n; i++) {
  const o = options.nth(i);
  // The name is the first line; an availability note, when there is one,
  // follows it on a second.
  const [label, note] = norm(await o.innerText()).split('\n').map((line) => line.trim());
  if (label !== beforeSwap && (await o.getAttribute('aria-disabled')) !== 'true' && !note) {
    swappedTo = label;
    await o.click();
    break;
  }
}
await page.waitForTimeout(500);
check('a swap target was available', swappedTo !== null);
check('choosing someone closes the dialog',
  await page.getByTestId('assign-search').isHidden());
check('the swap took effect',
  (await assignee(page.locator('[data-testid^="shift-select-m2-"]').first())) === swappedTo);
check('the displaced person is rescheduled, not dropped',
  (await page.locator('[data-testid^="shift-select-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.innerText.trim()))).includes(beforeSwap));
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
  .map((n) => `${n.dataset.testid}=${n.innerText.trim()}`).join('|'));
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

// The window starts three hours in the past, so its first few hourly shifts
// are already-elapsed history, and the document arrives carrying no pins and
// no edit yet - the state this check wants to observe.
//
// Seeded through the URL rather than typed: nudging the start field backwards
// is arithmetic on a clock, and a 12-hour field counts inside its own half of
// the day, so the same three keypresses moved the start back three hours in
// the morning and forward nine in the afternoon. The freeze this tests has
// nothing to do with how a date got entered.
const elapsedStart = topOfHour(Date.now()) - 3 * 3600 * 1000;
const freezeDoc = planSchema.parse({
  start: elapsedStart,
  end: elapsedStart + 24 * 3600 * 1000,
  shiftMinutes: 60,
  employees: [{ id: 'e1', name: 'רותם' }, { id: 'e2', name: 'עדי' }],
  missions: [{ id: 'm1', name: '', type: 'local', count: 1 }],
});
await page3.goto(`${BASE}/#/schedule?p=${encodeURIComponent(encodePlan(freezeDoc))}`, { waitUntil: 'networkidle' });
await page3.waitForTimeout(500);
const firstShift = page3.locator('[data-testid^="shift-select-m1-"]').first();
const firstShiftTestId = await firstShift.getAttribute('data-testid');
const [, , missionId, shiftStart] = firstShiftTestId.split('-');
const beforeAssignee = await assignee(firstShift);
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
const afterAssignee = await assignee(page3.locator(`[data-testid="${firstShiftTestId}"]`));
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

/* ---------- a whole-mission pin on a local mission ----------------------
 * The "4+1" arrangement: five seats on a rotating mission, one of them given
 * to a named person from the Missions page. That pin used to reach the agenda
 * as a single row spanning the whole plan - a slot of its own, keyed on the
 * same start as the first hour - while every hourly slot showed four people
 * against a headcount of five and read as one short.
 */
const ctx6 = await browser.newContext();
const page6 = await ctx6.newPage();
page6.on('pageerror', (e) => { console.log('PAGEERROR(whole-mission pin)', e.message); failures++; });

await page6.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page6.getByTestId('bulk-names').fill(['אבי', 'דנה', 'יוסי', 'מיכל', 'רון', 'תמר'].join('\n'));
await page6.getByTestId('add-bulk').click();
await page6.waitForTimeout(300);

await page6.getByTestId('tab-missions').click();
await page6.waitForTimeout(200);
await page6.getByTestId('add-mission').click();
await page6.waitForTimeout(250);
await page6.getByTestId('mission-name-m1').fill('כרמל מוצב');
await page6.waitForTimeout(150);
await page6.getByTestId('mission-count-m1').fill('5');
await page6.waitForTimeout(250);
await page6.getByTestId('assign-m1').click();
await page6.waitForTimeout(300);
await page6.getByRole('option', { name: 'אבי', exact: true }).click();
await page6.keyboard.press('Escape');
await page6.waitForTimeout(400);

await page6.getByTestId('tab-schedule').click();
await page6.waitForTimeout(700);

const slotStarts = await page6.evaluate(() => [...document.querySelectorAll('[data-testid^="slot-"]')]
  .map((n) => Number(n.dataset.testid.slice('slot-'.length))));
check('every agenda slot is its own distinct hour',
  slotStarts.length === 24 && new Set(slotStarts).size === 24, JSON.stringify(slotStarts));
check('no slot outruns one shift',
  slotStarts.every((t, i) => i === 0 || t - slotStarts[i - 1] === 3600 * 1000),
  JSON.stringify(slotStarts));

const firstSlot = Math.min(...slotStarts);
const firstSlotPeople = await page6
  .locator(`[data-testid="slot-${firstSlot}"] [data-testid^="shift-select-m1-"]`).count();
check('the first hour is staffed by all five, the hand-assigned person included',
  firstSlotPeople === 5, String(firstSlotPeople));
check('the hand-assigned person shows as pinned inside that hour',
  (await page6.locator(`[data-testid="slot-${firstSlot}"] [data-testid^="pinned-m1-"]`).count()) === 1);
check('and inside every other hour of the plan, not just the first',
  (await page6.locator('[data-testid^="pinned-m1-"]').count()) === 24);
await page6.screenshot({ path: `${SHOT}/07-whole-mission-pin.png` });
await ctx6.close();

/* ---------- a mission with its own shift length ------------------------
 * חמ"ל runs two-hour shifts by day and one-hour shifts at night while the
 * gate beside it stays hourly. The grid is a property of the mission, so the
 * agenda has to show three different slot lengths on one screen.
 */
const ctx7 = await browser.newContext();
const page7 = await ctx7.newPage();
page7.on('pageerror', (e) => { console.log('PAGEERROR(shift length)', e.message); failures++; });

await page7.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page7.getByTestId('bulk-names').fill(['אבי', 'דנה', 'יוסי', 'מיכל'].join('\n'));
await page7.getByTestId('add-bulk').click();
await page7.waitForTimeout(300);

await page7.getByTestId('tab-missions').click();
await page7.waitForTimeout(200);
await page7.getByTestId('add-mission').click();
await page7.waitForTimeout(250);
await page7.getByTestId('mission-name-m1').fill('ש"ג');
await page7.waitForTimeout(200);
await page7.getByTestId('add-mission').click();
await page7.waitForTimeout(250);
await page7.getByTestId('mission-name-m2').fill('חמ"ל');
await page7.waitForTimeout(200);
await page7.getByTestId('mission-shift-m2').fill('120');
await page7.waitForTimeout(250);
await page7.getByTestId('mission-night-shift-m2').fill('60');
await page7.waitForTimeout(400);
check('the shift-length inputs keep what was typed',
  (await page7.getByTestId('mission-shift-m2').inputValue()) === '120'
  && (await page7.getByTestId('mission-night-shift-m2').inputValue()) === '60');
await page7.screenshot({ path: `${SHOT}/08-mission-shift-length.png` });

await page7.getByTestId('tab-schedule').click();
await page7.waitForTimeout(700);

// Every rendered slot, with the missions inside it. Slots are keyed on
// (start, end), so the same start can appear twice with different ends.
const rendered = await page7.evaluate(() => [...document.querySelectorAll('[data-testid^="slot-"]')]
  .map((n) => ({
    start: Number(n.dataset.testid.slice('slot-'.length)),
    end: Number(n.dataset.slotEnd),
    missions: [...new Set(
      [...n.querySelectorAll('[data-testid^="shift-select-"]')]
        .map((s) => s.dataset.testid.split('-')[2]),
    )],
  })));

const minutes = (s) => (s.end - s.start) / 60000;
const forMission = (id) => rendered.filter((s) => s.missions.includes(id));

check('the hourly mission is still hourly throughout',
  forMission('m1').length === 24 && forMission('m1').every((s) => minutes(s) === 60),
  JSON.stringify(forMission('m1').map(minutes)));

const opsMinutes = forMission('m2').map(minutes);
check('חמ"ל gets two-hour slots by day',
  opsMinutes.includes(120), JSON.stringify(opsMinutes));
check('and one-hour slots at night',
  opsMinutes.includes(60), JSON.stringify(opsMinutes));
check('and never a slot longer than the two hours it asked for',
  opsMinutes.every((m) => m <= 120), JSON.stringify(opsMinutes));
check('the two grids together still cover the whole day',
  opsMinutes.reduce((sum, m) => sum + m, 0) === 24 * 60, JSON.stringify(opsMinutes));
await page7.screenshot({ path: `${SHOT}/09-mixed-shift-lengths.png`, fullPage: true });
await ctx7.close();

await browser.close();
console.log(failures === 0 ? '\nALL E2E CHECKS PASSED' : `\n${failures} E2E CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
