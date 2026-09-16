// lz-string ships as CommonJS: named imports resolve under Vite's interop but
// not under plain Node ESM, which the test suite runs on. The default import
// works in both.
import lzString from 'lz-string';
import { planSchema, SCHEMA_VERSION } from './planSchema.js';
import { isElapsedBeforePeriod, resolvePinWindow } from './planner.js';

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

/** The schema's own default, repeated here so an unset value encodes to nothing. */
const DEFAULT_MEMORY_DAYS = 21;

/**
 * The document's real ceiling, in characters of the encoded plan.
 *
 * The plan has always lived in the URL fragment - the app runs under
 * `HashRouter`, so `#/schedule?p=...` is one fragment and the `?p=` inside it
 * never reaches a server. What ADR 012's successor adds is that the fragment's
 * size is now the *document's* bound, because the log is never cleared and so
 * only grows.
 *
 * Sixty-four thousand is a measured starting point, not a guess: it sits under
 * every desktop and Android fragment limit the prototype work touched, and
 * well under what the address bar accepts. `tests/urlState.fifo.e2e.mjs` opens
 * a link of exactly this length in a real browser and asserts every row
 * decodes; if a device proves more, the constant goes up.
 *
 * `URL_WARN_LENGTH` stays what it is - a warning about pasting into chat,
 * which the WhatsApp message and the iCal exports exist to avoid. This is a
 * different question with a different answer.
 */
export const FRAGMENT_LIMIT = 64_000;

const TYPE_CODE = { local: 0, remote: 1, daily: 2 };
const CODE_TYPE = ['local', 'remote', 'daily'];

const outTs = (v) => (v == null ? 0 : v);
const inTs = (v) => (v === 0 || v == null ? null : v);

/** The mission tuple as it stood before per-mission shift lengths were added. */
const MISSION_TUPLE_WAS = 7;

/** The pin tuple as it stood before pins could carry their own history record. */
const PIN_TUPLE_WAS = 5;

/**
 * Drop trailing "not set" slots from a positional tuple, never shortening it
 * past `keep`.
 *
 * Field order is the wire format, so a new field can only be appended - and a
 * document that uses none of the new fields has to encode to exactly the bytes
 * it encoded to before they existed, or every link already shared changes
 * shape for no reason. `keep` is the tuple's length at the last build people
 * hold links from; anything beyond it is written only when it carries a value,
 * and a position the decoder does not find reads back as unset.
 */
function trimTail(tuple, keep) {
  let length = tuple.length;
  while (length > keep && (tuple[length - 1] == null
    || (Array.isArray(tuple[length - 1]) && tuple[length - 1].length === 0)
    || (length <= 9 && tuple[length - 1] === 0))) length--;
  return length === tuple.length ? tuple : tuple.slice(0, length);
}

export function encodePlan(doc) {
  const compact = {
    v: doc.version ?? SCHEMA_VERSION,
    t: doc.title || '',
    s: doc.start,
    e: doc.end,
    m: doc.shiftMinutes,
    st: doc.strategy,
    ns: doc.nightStart,
    ne: doc.nightEnd,
    // Positions 5 and 6 are carried duty (ADR 006's table, ADR 015). Written
    // only when non-zero, so an employee who has carried nothing encodes to
    // exactly the bytes they always did.
    emp: doc.employees.map((x) => trimTail([
      x.id, x.name, outTs(x.start), outTs(x.end), x.tags ?? [],
      x.carriedMinutes || null, x.carriedStints || null,
    ], 4)),
    // Everything past `count` is *appended* to the mission tuple. Field order
    // is the wire format here, so appending is safe and reordering is not: an
    // older link simply has no seventh element and reads back as `null`, i.e.
    // "same headcount at night", which is exactly what it always meant. The
    // positions are reserved once, in docs/plans/README.md, so two features
    // built in either order cannot claim the same one.
    mis: doc.missions.map((x) => trimTail([
      x.id, x.name, TYPE_CODE[x.type] ?? 0, outTs(x.start), outTs(x.end), x.count, x.nightCount ?? 0,
      x.shiftMinutes ?? 0, x.nightShiftMinutes ?? 0,
      x.dayStart ?? null, x.dayEnd ?? null,
      (x.requires ?? []).flatMap((r) => [r.tag, r.count]), x.excludes ?? [],
      // Position 13: on-call. Written only when true, so plans that never
      // heard of the flag encode to the exact bytes they always did.
      x.onCall ? 1 : null,
      // Position 14: excluded employee ids. Empty arrays are trimmed by
      // `trimTail`, so the same holds - a mission excluding nobody encodes
      // exactly as it did before this field existed (ADR 006, ADR 014).
      x.excludeEmployees ?? [],
      // Position 15: the once-per-rotation cooldown in days, written only when
      // set. A mission with no rule - every mission but the kitchen - encodes
      // to exactly the bytes it always did.
      x.repeatAfterDays ?? null,
    ], MISSION_TUPLE_WAS)),
    // Position 5 is the history record (ADR 006's table, ADR 012's correction),
    // written only once a pin has become a record of duty. One nested array
    // rather than four appended positions on purpose: the mission type encodes
    // as `0` for local, and `trimTail` cannot tell a meaningful trailing zero
    // from an unset one. Nested, the whole stamp is either there or it is not.
    pin: doc.pins.map((x) => trimTail([
      x.missionId, x.employeeId, outTs(x.start), outTs(x.end), x.frozen ? 1 : 0,
      x.record
        ? [x.record.employeeName, x.record.missionName, TYPE_CODE[x.record.missionType] ?? 0, x.record.tags ?? []]
        : null,
    ], PIN_TUPLE_WAS)),
    // A new *plan-level* field needs no version bump and does not get one: a
    // short key with a schema default means every link written before it
    // existed parses and keeps its old meaning. Written only when it differs
    // from that default, so those links keep their exact bytes too.
    ...(doc.memoryDays != null && doc.memoryDays !== DEFAULT_MEMORY_DAYS ? { md: doc.memoryDays } : {}),
    ...(doc.tags?.length ? { tg: doc.tags.map((t) => [t.id, t.name, t.minNightRestMinutes]) } : {}),
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
      // A link written before strategies existed carries no `st`; the schema
      // default is the behaviour those links were made with.
      strategy: raw.st ?? undefined,
      // Same story as `strategy`: absent means the schema default, which is the
      // night these links were written under whether they knew it or not.
      nightStart: raw.ns ?? undefined,
      nightEnd: raw.ne ?? undefined,
      memoryDays: raw.md ?? undefined,
      tags: (raw.tg ?? []).map(([id, name, minNightRestMinutes]) => ({ id, name, minNightRestMinutes })),
      employees: (raw.emp ?? []).map(([id, name, s, e, tags, carriedMinutes, carriedStints]) => ({
        id, name, start: inTs(s), end: inTs(e), tags,
        carriedMinutes: carriedMinutes ?? 0,
        carriedStints: carriedStints ?? 0,
      })),
      missions: (raw.mis ?? []).map((
        [id, name, type, s, e, count, nightCount, shiftMinutes, nightShiftMinutes, dayStart, dayEnd, requires, excludes, onCall, excludeEmployees, repeatAfterDays],
      ) => ({
        id,
        name,
        type: CODE_TYPE[type] ?? 'local',
        start: inTs(s),
        end: inTs(e),
        count,
        // `0` is the "not set" spelling here, as it is for the timestamps: a
        // headcount of zero is not a thing a mission can ask for, and neither
        // is a zero-length shift. A position the encoder trimmed away arrives
        // as `undefined` and reads the same way.
        nightCount: nightCount || null,
        shiftMinutes: shiftMinutes || null,
        nightShiftMinutes: nightShiftMinutes || null,
        dayStart: dayStart ?? null,
        dayEnd: dayEnd ?? null,
        requires: requires == null ? [] : Array.from({ length: Math.ceil(requires.length / 2) }, (_, i) => ({ tag: requires[i * 2], count: requires[i * 2 + 1] })),
        excludes: excludes ?? [],
        onCall: onCall === 1,
        excludeEmployees: excludeEmployees ?? [],
        repeatAfterDays: repeatAfterDays ?? null,
      })),
      pins: (raw.pin ?? []).map(([missionId, employeeId, s, e, f, rec]) => ({
        missionId,
        employeeId,
        start: inTs(s),
        end: inTs(e),
        frozen: Boolean(f),
        // A link written before pins could carry a record has no sixth element
        // and reads back as `null`, which is exactly what it always meant: this
        // pin is an instruction, not yet a record.
        record: rec == null ? null : {
          employeeName: rec[0] ?? '',
          missionName: rec[1] ?? '',
          missionType: CODE_TYPE[rec[2]] ?? 'local',
          tags: rec[3] ?? [],
        },
      })),
    });
    return { ok: true, plan: doc };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/**
 * Logged duty in the order it would drop: oldest first.
 *
 * Only a pin that is **both** a stamped record and behind the plan window is a
 * candidate. A pin without a record is an instruction to the scheduler, not
 * history, and one inside or after the window is somebody's plan - narrowing
 * the period must never consume either (ADR 012's correction).
 */
export function loggedOldestFirst(doc) {
  const missionById = new Map(doc.missions.map((m) => [m.id, m]));
  return doc.pins
    .map((pin, index) => ({ pin, index }))
    .filter(({ pin }) => pin.record
      && isElapsedBeforePeriod(pin, missionById.get(pin.missionId), doc.start, doc.end))
    .map((entry) => ({
      ...entry,
      end: resolvePinWindow(entry.pin, missionById.get(entry.pin.missionId), doc.start, doc.end).end,
    }))
    .sort((a, b) => a.end - b.end
      || (a.pin.missionId < b.pin.missionId ? -1 : a.pin.missionId > b.pin.missionId ? 1 : 0)
      || (a.pin.employeeId < b.pin.employeeId ? -1 : a.pin.employeeId > b.pin.employeeId ? 1 : 0)
      || a.index - b.index);
}

/**
 * Fit the document inside the fragment, dropping the oldest logged shifts
 * first.
 *
 * The owner's decision, and the alternative to a clear button: logged duty
 * stays in the document and is the scheduler's memory, so the only thing that
 * may ever remove it is running out of room. First in, first out - and only
 * over the stamped records behind the window, so an instruction to the
 * scheduler and a plan for next week are both untouchable.
 *
 * The number of rows to drop is found by binary search, so this encodes
 * O(log n) times rather than once per row: `encodePlan` compresses, and a
 * document at the ceiling has thousands of candidates.
 *
 * Returns `doc` itself when it already fits, so the common path allocates
 * nothing and `setDoc` can tell "nothing happened" by identity.
 */
export function fitPlanToFragment(doc) {
  if (encodePlan(doc).length <= FRAGMENT_LIMIT) return { doc, dropped: 0 };
  const candidates = loggedOldestFirst(doc);
  const without = (count) => {
    if (count === 0) return doc;
    const drop = new Set(candidates.slice(0, count).map((entry) => entry.index));
    return { ...doc, pins: doc.pins.filter((_, index) => !drop.has(index)) };
  };

  let lo = 0;
  let hi = candidates.length;
  if (encodePlan(without(hi)).length > FRAGMENT_LIMIT) {
    // Even with every droppable record gone it does not fit. Nothing else here
    // may be removed - the rest is the plan itself - so the caller gets the
    // smallest document this can produce and the honest count of what went.
    return { doc: without(hi), dropped: hi };
  }
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (encodePlan(without(mid)).length <= FRAGMENT_LIMIT) hi = mid; else lo = mid + 1;
  }
  return { doc: without(lo), dropped: lo };
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
