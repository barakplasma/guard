/**
 * Serve the probe page so a phone can open it.
 *
 *   npm i --no-save minizinc
 *   node prototype/minizinc/serve.mjs [hours]
 *
 * `browser.mjs` serves the same files, but only to a Playwright it drives
 * itself. This is the other half of ADR 011's Pixel-class criterion: the
 * measurement that actually closes it happens on the device, and the device
 * needs a URL.
 *
 * Binds every interface and prints the LAN addresses, because the phone is not
 * on localhost. No COOP/COEP headers, deliberately - `browser.mjs` established
 * that `crossOriginIsolated` is false and the solver works anyway, and a
 * measurement taken under headers GitHub Pages cannot set would answer a
 * question nobody asked.
 *
 * Nothing here is shipped. This directory is a prototype and stays one until
 * ADR 011 is acted on.
 */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toInstance } from './fromPlan.mjs';
import { toDzn } from './solve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '../../node_modules/minizinc/dist');
const hours = Number(process.argv[2] ?? 72);
const port = Number(process.env.PORT ?? 8099);

if (!existsSync(DIST)) {
  console.error('node_modules/minizinc is missing. Run: npm i --no-save minizinc');
  process.exit(1);
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const START = new Date(2026, 0, 5, 8, 0, 0, 0).getTime();
const at = START + 20 * MIN;

// The same fixture browser.mjs measures, so a device figure and a curve row are
// comparable. Changing it here without changing it there makes both useless.
const inst = toInstance({
  start: START,
  end: START + hours * HOUR,
  shiftMinutes: 60,
  strategy: 'balanced',
  employees: Array.from({ length: 8 }, (_, i) => ({
    id: `e${i + 1}`, name: `G${i + 1}`, tags: i < 2 ? ['driver'] : [],
  })),
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

createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  try {
    if (path === '/instance.dzn') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(dzn);
    }
    if (path === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const name = path === '/' ? 'index.html' : path.replace(/^\//, '');
    const candidates = [join(HERE, 'browser', name), join(HERE, name), join(DIST, name)];
    const local = candidates.find((c) => existsSync(c));
    if (!local) throw new Error('not found');
    res.writeHead(200, { 'content-type': TYPES[extname(local)] ?? 'application/octet-stream' });
    return res.end(await readFile(local));
  } catch {
    res.writeHead(404);
    return res.end('not found');
  }
}).listen(port, '0.0.0.0', () => {
  const addresses = Object.values(networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  console.log(`Serving the ${hours}h fixture (${inst.nS} segments) on port ${port}.\n`);
  console.log('Open one of these on the phone, on the same network:');
  for (const a of addresses.length ? addresses : ['(no non-loopback interface found)']) {
    console.log(`  http://${a}:${port}/`);
  }
  console.log('\nIt prints a worker spin rate and a total. Both are what ADR 011 asks for.');
  console.log('Over a cable instead: chrome://inspect, port-forward this port, open localhost.');
});
