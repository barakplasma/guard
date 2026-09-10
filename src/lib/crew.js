/** Duplicate requirements describe the same minimum, not additional seats. */
export function requirementsOf(requirements = []) {
  const counts = new Map();
  for (const r of requirements) counts.set(r.tag, Math.max(counts.get(r.tag) ?? 0, r.count));
  return [...counts].map(([tag, count]) => ({ tag, count }));
}

/** Maximum number of required roles that can be held by different people. */
function separateRoles(crew, requirements) {
  const seats = requirements.flatMap((r) => Array(Math.min(r.count, crew.length)).fill(r.tag));
  const owner = new Map();
  function claim(i, seen) {
    for (let s = 0; s < seats.length; s++) {
      if (seen.has(s) || !(crew[i].tags ?? []).includes(seats[s])) continue;
      seen.add(s);
      if (!owner.has(s) || claim(owner.get(s), seen)) { owner.set(s, i); return true; }
    }
    return false;
  }
  let count = 0;
  for (let i = 0; i < crew.length; i++) if (claim(i, new Set())) count++;
  return count;
}

/**
 * Exact search over qualification groups, not permutations of employees.
 * Ranking within a group remains the strategy's order. Optimize coverage, then
 * distinct role holders, then lexicographic strategy preference. No rest or
 * qualification configuration changes the legacy slice path.
 */
export function selectCrew(candidates, pinned, need, rawRequirements = []) {
  const requirements = requirementsOf(rawRequirements);
  const take = Math.min(Math.max(0, need), candidates.length);
  if (!take || !requirements.length) return candidates.slice(0, take);
  const grouped = new Map();
  candidates.forEach((p, index) => {
    const key = requirements.map((r) => Number((p.tags ?? []).includes(r.tag))).join('');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(index);
  });
  const groups = [...grouped.values()];
  let best = null, bestScore = [-1, -1];
  function visit(group, chosen) {
    if (chosen.length === take) {
      const indices = [...chosen].sort((a, b) => a - b);
      const crew = [...pinned, ...indices.map((i) => candidates[i])];
      const coverage = requirements.reduce((n, r) => n + Math.min(r.count, crew.filter((p) => (p.tags ?? []).includes(r.tag)).length), 0);
      if (coverage < bestScore[0]) return;
      const separate = separateRoles(crew, requirements);
      const betterTie = best == null || indices.some((v, i) => v !== best[i] && indices.slice(0, i).every((x, j) => x === best[j]) && v < best[i]);
      if (coverage > bestScore[0] || (coverage === bestScore[0] && (separate > bestScore[1] || (separate === bestScore[1] && betterTie)))) {
        best = indices; bestScore = [coverage, separate];
      }
      return;
    }
    if (group === groups.length) return;
    const remaining = groups.slice(group + 1).reduce((n, g) => n + g.length, 0);
    const max = Math.min(take - chosen.length, groups[group].length);
    const min = Math.max(0, take - chosen.length - remaining);
    for (let n = max; n >= min; n--) visit(group + 1, [...chosen, ...groups[group].slice(0, n)]);
  }
  visit(0, []);
  return (best ?? []).map((i) => candidates[i]);
}

/** Per-window coverage, including pins. */
export function missingQualifications(crew, requires) {
  return requirementsOf(requires).flatMap((r) => {
    const got = crew.filter((p) => (p.tags ?? []).includes(r.tag)).length;
    return got < r.count ? [{ tag: r.tag, needed: r.count, got }] : [];
  });
}
