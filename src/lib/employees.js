/**
 * Employee-list helpers: how two names are judged to be the same person, and
 * the counting that rides on it. Pure and outside the React context so the
 * rule stays testable - the same reasoning as `pins.js`.
 *
 * The engine never sees any of this: it keys on ids, so two rows that read the
 * same are two separate guards to it. Duplicates are a data-entry problem, and
 * they are caught here, on the way in.
 */
import { makeId } from './planSchema.js';

/**
 * The key two names are compared by. Trims, collapses internal whitespace and
 * case-folds, so "  דנה " and "דנה" are one person, as are "Dana" and "dana" -
 * a list pasted out of a spreadsheet routinely carries both.
 *
 * A blank name is deliberately *not* a key: rows are added empty and filled in
 * later, and two half-typed rows must not accuse each other of being a
 * duplicate. Callers skip empty keys rather than grouping by them.
 */
export function nameKey(name) {
  return String(name ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Append `names` to `employees`, dropping any that is already there and any
 * repeated inside `names` itself - one paste of a roster often contains the
 * same person twice.
 *
 * Returns the new list plus what was `added` and what was `skipped`, because
 * silently swallowing half a paste is worse than the duplicate: the caller
 * says so out loud.
 */
export function addUniqueEmployees(employees, names) {
  const taken = new Set(employees.map((e) => nameKey(e.name)).filter(Boolean));
  const next = [...employees];
  const added = [];
  const skipped = [];

  for (const raw of names) {
    const name = String(raw ?? '').trim();
    const key = nameKey(name);
    if (!key) continue;
    if (taken.has(key)) {
      skipped.push(name);
      continue;
    }
    taken.add(key);
    const employee = {
      id: makeId('e', next.map((e) => e.id)),
      name,
      start: null,
      end: null,
    };
    next.push(employee);
    added.push(employee);
  }

  return { employees: next, added, skipped };
}

/**
 * Ids of employees sharing a name with another row. Renaming is never blocked
 * mid-keystroke - "דנ" on the way to "דנה" would collide with itself - so an
 * existing list is flagged rather than corrected.
 */
export function duplicateEmployeeIds(employees) {
  const counts = new Map();
  for (const e of employees) {
    const key = nameKey(e.name);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set(
    employees.filter((e) => counts.get(nameKey(e.name)) > 1).map((e) => e.id),
  );
}
