/**
 * Mobile viewport testing for different screen sizes.
 *
 * Tests the app at multiple viewports to identify layout issues:
 * - 360×740 (small Android)
 * - 768×1024 (tablet/split-view)
 * - Landscape orientation on phone-width
 *
 * Run after: npm run build && npx vite preview --port 4173 --strictPort
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4173';
const SHOT = process.env.SHOT_DIR || 'mobile-screenshots';
mkdirSync(SHOT, { recursive: true });

const VIEWPORTS = [
  { name: 'small-android', width: 360, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'landscape-phone', width: 812, height: 375 }, // iPhone X landscape
];

// CHROME points at an existing Chromium when the sandbox already ships one,
// matching how tests/e2e.mjs is run.
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
});

const findings = [];

for (const viewport of VIEWPORTS) {
  console.log(`\n--- Testing ${viewport.name} (${viewport.width}×${viewport.height}) ---`);

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  const page = await context.newPage();
  page.on('pageerror', (e) => {
    findings.push(`[${viewport.name}] PAGE ERROR: ${e.message}`);
  });

  // Navigate to home page
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  // Test 1: Basic navigation and employee add
  console.log(`  [${viewport.name}] Testing basic navigation...`);
  const bulkNames = page.getByTestId('bulk-names');
  await bulkNames.fill('אבי\nדנה\nיוסי');
  await page.getByTestId('add-bulk').click();
  await page.waitForTimeout(300);

  const employeeCount = await page.locator('[data-testid^="employee-name-"]').count();
  if (employeeCount === 3) {
    console.log(`  [${viewport.name}] ✓ Employee bulk add works`);
  } else {
    findings.push(`[${viewport.name}] ✗ Employee bulk add failed: got ${employeeCount}, expected 3`);
  }

  await page.screenshot({ path: `${SHOT}/${viewport.name}-01-employees.png`, fullPage: true });

  // Test 2: Navigate to missions tab
  console.log(`  [${viewport.name}] Testing missions tab...`);
  await page.getByTestId('tab-missions').click();
  await page.waitForTimeout(300);

  // Check for overflow issues
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  if (bodyWidth > viewportWidth) {
    findings.push(`[${viewport.name}] ⚠ HORIZONTAL OVERFLOW: body width ${bodyWidth}px > viewport ${viewportWidth}px`);
  } else {
    console.log(`  [${viewport.name}] ✓ No horizontal overflow`);
  }

  await page.screenshot({ path: `${SHOT}/${viewport.name}-02-missions.png`, fullPage: true });

  // Test 3: Create a mission and test schedule view
  console.log(`  [${viewport.name}] Testing schedule generation...`);
  await page.getByTestId('add-mission').click();
  await page.waitForTimeout(200);
  await page.getByTestId('mission-name-m1').fill('בדיקה');
  await page.waitForTimeout(150);
  await page.getByTestId('mission-count-m1').fill('2');
  await page.waitForTimeout(200);

  await page.getByTestId('tab-schedule').click();
  await page.waitForTimeout(600);

  await page.screenshot({ path: `${SHOT}/${viewport.name}-03-schedule.png`, fullPage: true });

  // A cell narrower than its own content does not clip - it spills over the
  // neighbouring column, which is how the agenda's times ended up printed on
  // top of the mission names on a phone.
  const spilling = await page.evaluate(() => [...document.querySelectorAll('td, th')]
    .filter((c) => c.scrollWidth > c.clientWidth + 1)
    .map((c) => `"${c.innerText.trim().replace(/\s+/g, ' ').slice(0, 24)}" needs ${c.scrollWidth}px, has ${c.clientWidth}px`));

  if (spilling.length > 0) {
    findings.push(`[${viewport.name}] ⚠ ${spilling.length} table cell(s) overflow their column: ${spilling.slice(0, 3).join('; ')}`);
  } else {
    console.log(`  [${viewport.name}] ✓ No table cell overflows its column`);
  }

  // The off-duty list adds a column on the schedule; check that state too.
  const offDutyToggle = page.getByTestId('include-off-duty');
  if (await offDutyToggle.count() > 0) {
    await offDutyToggle.click();
    await page.waitForTimeout(400);
    const overflowWithOffDuty = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    if (overflowWithOffDuty) {
      findings.push(`[${viewport.name}] ⚠ HORIZONTAL OVERFLOW with the off-duty list shown`);
    } else {
      console.log(`  [${viewport.name}] ✓ No horizontal overflow with the off-duty list shown`);
    }
    await page.screenshot({ path: `${SHOT}/${viewport.name}-03b-off-duty.png`, fullPage: true });
    await offDutyToggle.click();
    await page.waitForTimeout(300);
  }

  // Check for vertical crowding with sticky AppBar
  const appBarInfo = await page.evaluate(() => {
    const appBar = document.querySelector('header');
    if (!appBar) return null;
    const rect = appBar.getBoundingClientRect();
    return {
      height: rect.height,
      top: rect.top,
      position: window.getComputedStyle(appBar).position
    };
  });

  if (appBarInfo) {
    console.log(`  [${viewport.name}] AppBar height: ${appBarInfo.height}px, position: ${appBarInfo.position}`);

    if (appBarInfo.height > 100) {
      findings.push(`[${viewport.name}] ⚠ AppBar is tall (${appBarInfo.height}px), may crowd content on short screens`);
    }

    // Test 4: Scroll behavior with sticky AppBar
    console.log(`  [${viewport.name}] Testing scroll behavior...`);
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(300);

    const appBarAfterScroll = await page.evaluate(() => {
      const appBar = document.querySelector('header');
      if (!appBar) return null;
      const rect = appBar.getBoundingClientRect();
      return {
        top: rect.top,
        position: window.getComputedStyle(appBar).position
      };
    });

    if (appBarAfterScroll && appBarAfterScroll.position === 'sticky' && appBarAfterScroll.top <= 0) {
      console.log(`  [${viewport.name}] ✓ Sticky AppBar works correctly`);
    } else {
      findings.push(`[${viewport.name}] ✗ Sticky AppBar may not be working: position=${JSON.stringify(appBarAfterScroll)}`);
    }
  } else {
    findings.push(`[${viewport.name}] ⚠ AppBar not found in DOM`);
  }

  await page.screenshot({ path: `${SHOT}/${viewport.name}-04-scroll.png`, fullPage: true });

  // Test 5: Test the "now" indicator and jump to now button
  console.log(`  [${viewport.name}] Testing now indicator...`);
  await page.getByTestId('tab-schedule').click();
  await page.waitForTimeout(400);

  const jumpToNowButton = page.getByTestId('jump-to-now');
  const hasJumpButton = await jumpToNowButton.count() > 0;

  if (hasJumpButton) {
    console.log(`  [${viewport.name}] ✓ Jump to now button present`);
    await jumpToNowButton.click();
    await page.waitForTimeout(300);
    console.log(`  [${viewport.name}] ✓ Jump to now button clickable`);
  } else {
    findings.push(`[${viewport.name}] ⚠ Jump to now button not found (may need a generated schedule)`);
  }

  await page.screenshot({ path: `${SHOT}/${viewport.name}-05-now-indicator.png`, fullPage: true });

  // Check for clipped content (text overflow beyond viewport)
  const clippedContent = await page.evaluate(() => {
    const clipped = [];
    const elements = document.querySelectorAll('h1, h2, h3, p, button, [role="button"]');
    elements.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        clipped.push(`${el.tagName} clipped at right edge`);
      }
      if (rect.left < 0) {
        clipped.push(`${el.tagName} clipped at left edge`);
      }
    });
    return clipped;
  });

  if (clippedContent.length > 0) {
    findings.push(`[${viewport.name}] ⚠ Found clipped content: ${clippedContent.join(', ')}`);
  }

  await context.close();
}

await browser.close();

// Report findings
console.log('\n' + '='.repeat(60));
console.log('MOBILE VIEWPORT TEST SUMMARY');
console.log('='.repeat(60));

if (findings.length === 0) {
  console.log('✓ All viewports tested successfully!');
  console.log('  - No horizontal overflow detected');
  console.log('  - Sticky AppBar working correctly');
  console.log('  - No major layout issues found');
  console.log('\nScreenshots saved to:', SHOT);
} else {
  console.log(`Found ${findings.length} issue(s) to review:\n`);
  for (const finding of findings) {
    console.log(`  ${finding}`);
  }
  console.log('\nScreenshots saved to:', SHOT);
  console.log('\nPlease review screenshots for visual issues.');
}

process.exit(findings.length === 0 ? 0 : 1);
