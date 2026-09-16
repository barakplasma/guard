/**
 * ADR 011's last untouched acceptance criterion: the real browser path.
 *
 *   npm i --no-save minizinc playwright
 *   node prototype/minizinc/browser.mjs [hours] [solver]
 *
 * Everything else in this directory spawns a native MiniZinc binary, four times
 * per plan. That says nothing about what the app would pay, because shipping
 * means a WebAssembly worker, an 18.8MB `.wasm` and a 0.5MB `.data` that the
 * service worker has to cache, all on a phone.
 *
 * Three questions, in order of how much they could cost:
 *
 *   1. Does it need `crossOriginIsolated`? COOP/COEP headers cannot be set on
 *      GitHub Pages, which `release.yml` publishes to. If the answer is yes,
 *      the hosting decision changes, not just the engine.
 *   2. Is HiGHS in the WebAssembly build? The package's build script says
 *      `gecode cbc chuffed highs`, but reading a build script is not running
 *      one, and ADR 011's backend now depends on the answer.
 *   3. What does first load cost, and what does a 72-hour solve cost?
 *
 * The page is served with no special headers on purpose - that is the GitHub
 * Pages condition, and a measurement taken under headers Pages cannot set would
 * answer a question nobody asked.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { toInstance } from './fromPlan.mjs';
import { toDzn } from './solve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '../../node_modules/minizinc/dist');
const hours = Number(process.argv[2] ?? 72);
const solver = process.argv[3] ?? 'highs';
// A stand-in for a phone. This machine is not a Pixel, and reporting its
// numbers as if it were would be the more misleading of the two errors.
const throttle = Number(process.argv[4] ?? 1);

if (!existsSync(DIST)) {
  console.error('node_modules/minizinc is missing. Run: npm i --no-save minizinc');
  process.exit(1);
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const START = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
const employees = Array.from({ length: 8 }, (_, i) => ({
  id: `e${i + 1}`, name: `G${i + 1}`, tags: i < 2 ? ['driver'] : [],
}));
const at = START + 20 * MIN;
const inst = toInstance({
  start: START,
  end: START + hours * HOUR,
  shiftMinutes: 60,
  strategy: 'balanced',
  employees,
  missions: [
    { id: 'gate', name: 'שער', type: 'local', count: 3, requires: [], excludes: [] },
    { id: 'patrol', name: 'סיור', type: 'local', count: 2, requires: [], excludes: [] },
    {
      id: 'callout', name: 'קריאה', type: 'local', start: at, end: at + 2 * HOUR,
      count: 2, requires: [{ tag: 'driver', count: 2 }], excludes: [],
    },
  ],
  pins: [],
  nightWindows: [],
  tags: [{ id: 'driver' }],
});
const dzn = toDzn(inst, { level: 1, capUnmet: -1, capUnfilled: -1, capChurn: -1 });

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.data': 'application/octet-stream',
  '.mzn': 'text/plain', '.dzn': 'text/plain',
};

const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  try {
    if (path === '/instance.dzn') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(dzn);
    }
    if (path === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const local = path === '/' || path === '/index.html'
      ? join(HERE, 'browser/index.html')
      : path === '/rota.mzn'
        ? join(HERE, 'rota.mzn')
        : join(DIST, path.replace(/^\//, ''));
    const body = await readFile(local);
    // No COOP/COEP. See the note at the top: that is the condition being tested.
    res.writeHead(200, { 'content-type': TYPES[extname(local)] ?? 'application/octet-stream' });
    return res.end(body);
  } catch {
    res.writeHead(404);
    return res.end('not found');
  }
});

await new Promise((r) => server.listen(0, r));
const { port } = server.address();

const browser = await chromium.launch(
  process.env.CHROME ? { executablePath: process.env.CHROME } : {},
);
const page = await browser.newPage();
if (throttle > 1) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
}
page.on('console', (m) => { if (m.type() === 'error') console.error('  console:', m.text()); });

// Byte counts come from the bodies, not `content-length`: this server sets no
// such header, and a measurement that silently read 0 would flatter the result
// exactly where it matters most.
let transferred = 0;
const bodies = [];
page.on('response', (r) => {
  bodies.push(r.body().then((b) => { transferred += b.length; }).catch(() => {}));
});

const opened = Date.now();
await page.goto(`http://localhost:${port}/?solver=${solver}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.rotaProbe?.done, null, { timeout: 15 * 60 * 1000 });
const result = await page.evaluate(() => window.rotaProbe);
await Promise.all(bodies);
const wall = Date.now() - opened;

console.log(`cpu throttle       : ${throttle}x (main-thread spin ${result.spinPerMs}/ms)`);
console.log(`fixture            : ${hours}h horizon, ${inst.nE} guards, ${inst.nM} missions, ${inst.nS} segments`);
console.log(`crossOriginIsolated: ${result.crossOriginIsolated}   (false means no COOP/COEP needed)`);
console.log(`solvers in the wasm: ${(result.solvers ?? []).join(', ') || '(none reported)'}`);
if (result.shape) console.log(`solution output keys: ${result.shape.join(', ')}`);
console.log(`bytes over the wire: ${(transferred / 1048576).toFixed(1)}MB`);
console.log(`init (fetch+compile): ${result.initMs}ms`);
for (const l of result.levels) {
  console.log(`  level ${l.level}: ${String(l.ms).padStart(6)}ms  ${l.status}  unmet=${l.unmetQualifications} unfilled=${l.unfilledSeats} churn=${l.slotChurn} imbalance=${l.imbalance}`);
}
if (result.heapMB) console.log(`js heap            : ${result.heapMB}MB`);
console.log(`wall clock         : ${wall}ms`);
if (result.error) console.log(`\nERROR\n${result.error}`);

await browser.close();
server.close();
process.exit(result.error ? 1 : 0);
