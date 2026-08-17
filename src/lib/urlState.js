// lz-string ships as CommonJS: named imports resolve under Vite's interop but
// not under plain Node ESM, which the test suite runs on. The default import
// works in both.
import lzString from 'lz-string';
import { planSchema, SCHEMA_VERSION } from './planSchema.js';

const { compressToEncodedURIComponent, decompressFromEncodedURIComponent } = lzString;

/**
 * Plan <-> URL codec.
 *
 * The document is first squeezed into positional tuples with one-or-two-letter
 * keys, then LZ-compressed into a URI-safe string. The tuple step matters: JSON
 * with full key names roughly triples the payload before compression, and the
 * URL is the only storage this app has.
 *
 * `0` in a timestamp slot means "not set", i.e. inherit the plan window - which
 * is the common case and costs one character instead of thirteen.
 */

export const PARAM = 'p';

/** Beyond this, some clients and chat apps start mangling links. */
export const URL_WARN_LENGTH = 8000;

const TYPE_CODE = { local: 0, remote: 1 };
const CODE_TYPE = ['local', 'remote'];

const outTs = (v) => (v == null ? 0 : v);
const inTs = (v) => (v === 0 || v == null ? null : v);

export function encodePlan(doc) {
  const compact = {
    v: doc.version ?? SCHEMA_VERSION,
    t: doc.title || '',
    s: doc.start,
    e: doc.end,
    m: doc.shiftMinutes,
    emp: doc.employees.map((x) => [x.id, x.name, outTs(x.start), outTs(x.end)]),
    mis: doc.missions.map((x) => [x.id, x.name, TYPE_CODE[x.type] ?? 0, outTs(x.start), outTs(x.end), x.count]),
    pin: doc.pins.map((x) => [x.missionId, x.employeeId, outTs(x.start), outTs(x.end), x.frozen ? 1 : 0]),
  };
  return compressToEncodedURIComponent(JSON.stringify(compact));
}

/**
 * @returns {{ok: true, plan: object} | {ok: false, reason: string}}
 * Never throws: a truncated or hand-mangled link must not white-screen the app,
 * it should fall back to an empty plan and say so.
 */
export function decodePlan(blob) {
  if (!blob) return { ok: false, reason: 'empty' };
  let raw;
  try {
    const json = decompressFromEncodedURIComponent(blob);
    if (!json) return { ok: false, reason: 'corrupt' };
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'corrupt' };
  if (raw.v !== SCHEMA_VERSION) return { ok: false, reason: 'version' };

  try {
    const doc = planSchema.parse({
      version: raw.v,
      title: raw.t ?? '',
      start: raw.s,
      end: raw.e,
      shiftMinutes: raw.m,
      employees: (raw.emp ?? []).map(([id, name, s, e]) => ({
        id, name, start: inTs(s), end: inTs(e),
      })),
      missions: (raw.mis ?? []).map(([id, name, type, s, e, count]) => ({
        id, name, type: CODE_TYPE[type] ?? 'local', start: inTs(s), end: inTs(e), count,
      })),
      pins: (raw.pin ?? []).map(([missionId, employeeId, s, e, f]) => ({
        missionId, employeeId, start: inTs(s), end: inTs(e), frozen: Boolean(f),
      })),
    });
    return { ok: true, plan: doc };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/**
 * Build the full shareable URL for a plan on a given hash route.
 * The blob rides inside the hash's own query string ("#/schedule?p=...") so
 * routing stays hash-based - no server rewrite rules needed on static hosting.
 */
export function shareUrl(doc, route = '/schedule', href = window.location.href) {
  const base = href.split('#')[0];
  // lz-string's URI alphabet includes "+", which URLSearchParams reads back as a
  // space - so the blob must be percent-encoded, not pasted in raw, or every
  // shared link with a "+" in it decodes to garbage.
  return `${base}#${route}?${PARAM}=${encodeURIComponent(encodePlan(doc))}`;
}
