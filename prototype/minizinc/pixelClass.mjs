/**
 * ADR 011's last open acceptance criterion: what does this cost on a phone?
 *
 *   npm i --no-save minizinc playwright
 *   node prototype/minizinc/pixelClass.mjs
 *
 * The criterion stayed open for a specific reason, and it is worth stating
 * because it invalidated every throttled figure taken before it.
 * `Emulation.setCPUThrottlingRate` - the obvious tool, and the one the first
 * attempt used - is implemented in the renderer's main-thread scheduler. The
 * solver runs in a Web Worker, which never sees it. Measured:
 *
 *   throttle   main-thread spin   worker spin   level-1 solve
 *       1x           4738/ms         3199/ms          2130ms
 *       8x (CDP)      646/ms         4434/ms          2356ms
 *
 * The main thread slowed 7.3x, the worker did not slow at all, and the solve
 * moved by 10% - which is noise. Every "phone" number from that setup was a
 * desktop number.
 *
 * `browser.mjs` now throttles by SIGSTOPping the renderer processes on a duty
 * cycle instead. The signal lands on the process, so every thread in it stops
 * in the same proportion, which is what a slower core does.
 *
 * ## Why this reports a curve rather than a number
 *
 * This machine is not a Pixel, and no amount of throttling makes it one. What
 * it can do is measure the *relationship* between how fast the solver's thread
 * runs and how long a solve takes, across a range that brackets phone-class
 * hardware. Then the device places itself: open `browser/index.html` on the
 * phone, read the worker spin rate it prints, and find the matching row.
 *
 * That is a bracket, not a substitute. The criterion asks for a measurement on
 * real hardware and this is not one - but it turns "unknown" into "known within
 * a band, with a one-step procedure for closing it".
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HORIZONS = (process.env.HOURS ?? '24,72').split(',').map(Number);
const RATES = (process.env.RATES ?? '1,2,4,8').split(',').map(Number);
const solver = process.env.SOLVER ?? 'highs';

function run(hours, rate) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HERE, 'browser.mjs'), String(hours), solver, String(rate)], {
      env: process.env,
    });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}\n${out}`))));
  });
}

const num = (text, re) => { const m = text.match(re); return m ? Number(m[1]) : null; };

const rows = [];
for (const hours of HORIZONS) {
  for (const rate of RATES) {
    process.stderr.write(`  measuring ${hours}h at ${rate}x…\n`);
    const out = await run(hours, rate);
    const levels = [...out.matchAll(/level \d: +(\d+)ms/g)].map((m) => Number(m[1]));
    rows.push({
      hours,
      rate,
      segments: num(out, /(\d+) segments/),
      workerSpin: num(out, /worker spin +: (\d+)\/ms/),
      initMs: num(out, /init \(fetch\+compile\): (\d+)ms/),
      ladderMs: levels.reduce((a, b) => a + b, 0),
      slowest: Math.max(...levels),
      rssPeak: num(out, /-> (\d+)MB peak/),
      rssDelta: num(out, /\(\+(\d+)MB\)/),
    });
  }
}

console.log('\nEach row is one full lexicographic ladder - four solves - in a WebAssembly');
console.log('worker, throttled at the operating system so the worker is throttled too.\n');
console.log('  horizon  segments  worker spin   first load   ladder    slowest level   peak rss');
for (const r of rows) {
  console.log(`  ${String(`${r.hours}h`).padStart(7)}${String(r.segments).padStart(10)}`
    + `${String(`${r.workerSpin}/ms`).padStart(13)}${String(`${r.initMs}ms`).padStart(13)}`
    + `${String(`${(r.ladderMs / 1000).toFixed(1)}s`).padStart(9)}`
    + `${String(`${(r.slowest / 1000).toFixed(1)}s`).padStart(16)}`
    + `${String(`${r.rssPeak}MB`).padStart(11)}`);
}

console.log('\nTo place a real device on this curve, open browser/standalone.html on it -');
console.log('one file, no Node, no server, servable straight from a raw-file host. It');
console.log('measures the same four solves, prints its own worker spin, and carries a copy');
console.log('of the table above so it names its own row.');
console.log('\nThe curve is for reasoning about hardware nobody has to hand. A device that');
console.log('is to hand should just be read.');
