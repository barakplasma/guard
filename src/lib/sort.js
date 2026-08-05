/** Display-order helpers. Never used inside the pure planner engine. */

/** A new array, sorted by Hebrew collation. Stable, so ties keep their original order. */
export function sortByHebrewName(list, nameKey = 'name') {
  return [...list].sort((a, b) => (a[nameKey] || '').localeCompare(b[nameKey] || '', 'he'));
}
