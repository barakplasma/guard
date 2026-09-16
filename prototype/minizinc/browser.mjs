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
 * With `OFFLINE=1` it asks a fourth, and the one that matters most against this
 * project's no-network rule: the page is loaded once with a service worker
 * precaching the assets, the network is then cut at the browser, and the whole
 * ladder is run again from cache alone.
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
import { readdirSync, readFileSync } from 'node:fs';
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
    // The page and its service worker live in `browser/`, the model beside this
    // file, and everything else in the installed package's `dist/`.
    const name = path === '/' ? 'index.html' : path.replace(/^\//, '');
    const candidates = [join(HERE, 'browser', name), join(HERE, name), join(DIST, name)];
    const local = candidates.find((c) => existsSync(c));
    if (!local) throw new Error('not found');
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

/**
 * Resident memory of the whole browser process tree, in MB.
 *
 * The JS heap the page reports excludes WebAssembly memory, which is where all
 * of this solver's memory is - so it reads 2MB while the wasm holds hundreds.
 * RSS over the process tree is coarser and attributes Chromium's own footprint
 * to the solver, but it is the only figure here that includes the thing being
 * measured. Reported as a delta from idle for that reason.
 */
function treeRssMB(rootPid) {
  const kids = new Map();
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      kids.set(Number(entry), ppid);
    } catch { /* the process went away mid-read */ }
  }
  const wanted = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, ppid] of kids) {
      if (!wanted.has(pid) && wanted.has(ppid)) { wanted.add(pid); grew = true; }
    }
  }
  let kb = 0;
  for (const pid of wanted) {
    try {
      const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
      if (m) kb += Number(m[1]);
    } catch { /* same */ }
  }
  return Math.round(kb / 1024);
}

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

// Playwright's `Browser` exposes no pid, so find the Chromium tree by name.
// Crude, and fine here: this sandbox runs exactly one.
const rootPid = (() => {
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmd = readFileSync(`/proc/${entry}/cmdline`, 'utf8');
      if (cmd.includes('chrome-linux/chrome') && !cmd.includes('--type=')) return Number(entry);
    } catch { /* gone */ }
  }
  return null;
})();
const idleRss = rootPid ? treeRssMB(rootPid) : 0;
let peakRss = idleRss;
const sampler = rootPid ? setInterval(() => {
  peakRss = Math.max(peakRss, treeRssMB(rootPid));
}, 200) : null;

const offline = process.env.OFFLINE === '1';
const query = `solver=${solver}${offline ? '&sw=1' : ''}${process.env.NO_SOLVE === '1' ? '&noSolve=1' : ''}`;

const opened = Date.now();
await page.goto(`http://localhost:${port}/?${query}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.rotaProbe?.done, null, { timeout: 15 * 60 * 1000 });
let result = await page.evaluate(() => window.rotaProbe);
await Promise.all(bodies);
let wall = Date.now() - opened;

if (offline) {
  const cached = result.cached;
  console.log(`warm pass          : ${cached} assets cached by the service worker`);
  // Cut the network at the browser *and* stop the server, so a cache miss
  // cannot be quietly served by a socket that was still open.
  await page.context().setOffline(true);
  server.close();
  const reloaded = Date.now();
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.rotaProbe?.done, null, { timeout: 15 * 60 * 1000 });
  result = await page.evaluate(() => window.rotaProbe);
  wall = Date.now() - reloaded;
  console.log('offline pass       : network cut, server stopped, reloaded\n');
}
if (sampler) clearInterval(sampler);

console.log(`cpu throttle       : ${throttle}x (main-thread spin ${result.spinPerMs}/ms)`);
console.log(`fixture            : ${hours}h horizon, ${inst.nE} guards, ${inst.nM} missions, ${inst.nS} segments`);
console.log(`crossOriginIsolated: ${result.crossOriginIsolated}   (false means no COOP/COEP needed)`);
console.log(`solvers in the wasm: ${(result.solvers ?? []).join(', ') || '(none reported)'}`);
if (result.shape) console.log(`solution output keys: ${result.shape.join(', ')}`);
console.log(`bytes over the wire: ${(transferred / 1048576).toFixed(1)}MB`);
console.log(`init (fetch+compile): ${result.initMs}ms`);
if (result.baseline) console.log('baseline pass      : MiniZinc never initialised');
for (const l of result.levels) {
  console.log(`  level ${l.level}: ${String(l.ms).padStart(6)}ms  ${l.status}  unmet=${l.unmetQualifications} unfilled=${l.unfilledSeats} churn=${l.slotChurn} imbalance=${l.imbalance}`);
}
if (result.heapMB) console.log(`js heap            : ${result.heapMB}MB  (excludes wasm memory - see the note on treeRssMB)`);
if (rootPid) console.log(`browser tree rss   : ${idleRss}MB idle -> ${peakRss}MB peak  (+${peakRss - idleRss}MB)`);
console.log(`wall clock         : ${wall}ms`);
if (result.error) console.log(`\nERROR\n${result.error}`);

await browser.close();
server.close();
process.exit(result.error ? 1 : 0);
