/**
 * A stable identity for "the question the solver was asked".
 *
 * The session keys everything on this: a request whose revision matches the
 * run in flight is a no-op, a completion whose revision no longer matches is
 * discarded, and `acceptedFor(revision)` hands back an accepted schedule only
 * when it answers *this* document. Without it an async solver's answer can
 * land on a document it was not computed from, which is the failure ADR 011's
 * prerequisite is about.
 *
 * Two deliberate properties:
 *
 * - **Nothing here is a name.** A `PreparedProblem` carries ids, windows and
 *   counts and no display text at all, so renaming a guard does not re-solve.
 * - **It is synchronous.** `prepareProblem` runs on the render path and must
 *   return a finished value; `crypto.subtle.digest` is a promise in the
 *   browser, and awaiting it would make every consumer async for a token that
 *   is an identity, not a security boundary. So this is a 128-bit FNV-1a
 *   walked over a canonical serialization rather than SHA-256 - the same job,
 *   done in the one shape the call site can use.
 */

/** Deterministic JSON: object keys sorted, Maps and Sets written as sorted pairs. */
function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'n';
  if (typeof value === 'number') return Number.isFinite(value) ? `#${value}` : `#${value > 0 ? 'inf' : '-inf'}`;
  if (typeof value === 'boolean') return value ? 'T' : 'F';
  if (typeof value === 'string') return `"${value}"`;
  if (value instanceof Map) {
    return `{${[...value.entries()]
      .map(([k, v]) => [canonical(k), canonical(v)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${k}:${v}`)
      .join(',')}}`;
  }
  if (value instanceof Set) {
    return `[${[...value].map(canonical).sort().join(',')}]`;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return `{${entries.map(([k, v]) => `"${k}":${canonical(v)}`).join(',')}}`;
  }
  return `?${String(value)}`;
}

/**
 * 128 bits as four FNV-1a lanes over the same bytes with different offsets.
 * One 32-bit lane collides at a few tens of thousands of documents, which is
 * well inside one editing session's worth of keystrokes.
 */
const OFFSETS = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];

export function digestOf(value: unknown): string {
  const text = canonical(value);
  const lanes = [...OFFSETS];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    for (let lane = 0; lane < lanes.length; lane++) {
      lanes[lane] = Math.imul(lanes[lane] ^ code ^ lane, 0x01000193) >>> 0;
    }
  }
  return lanes.map((lane) => lane.toString(16).padStart(8, '0')).join('');
}
