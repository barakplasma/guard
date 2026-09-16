import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

export const baseUrl = process.env.BASE || 'http://127.0.0.1:4173';

export function screenshotDirectory(fallback) {
  const directory = process.env.SHOT_DIR || fallback;
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function launchBrowser() {
  const executablePath = process.env.CHROME
    || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  return chromium.launch({ headless: true, executablePath });
}

export function watchErrors(page, errors) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
}

export async function captureFailure(browser, path) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error((await page.locator('body').innerText()).slice(0, 5000));
    await page.screenshot({ path });
  }
}

export async function assertResponsive(page, assert, widths = [360, 412, 1280], height = 915) {
  for (const width of widths) {
    await page.setViewportSize({ width, height });
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    assert.ok(fits, `no overflow at ${width}px`);
  }
}
