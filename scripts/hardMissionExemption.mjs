/**
 * Why the hard-mission exemption is a level of its own.
 *
 * Three people, one of them a commander, and a kitchen running three days.
 * The commander should sit the rotation out: 2/1/0 is the answer wanted, and
 * 1/1/1 - which hands them a kitchen day - is the answer to avoid.
 *
 * Every way of folding "leave them out of the rotation" into one number scores
 * 1/1/1 at least as well as 2/1/0, so a single-objective form of this level
 * prefers exactly the arrangement the rule exists to prevent. Lexicographic
 * tiers are what this model has instead of weights, so the exemption gets a
 * tier: `exemptHardVisits` above `hardMissionSpread`.
 *
 * Run: node scripts/hardMissionExemption.mjs
 */

const arrangements = [
  { name: 'commander sits out (2/1/0)', rotation: [2, 1], exempt: [0] },
  { name: 'commander takes a day (1/1/1)', rotation: [1, 1], exempt: [1] },
];

const spread = (counts) => Math.max(...counts) - Math.min(...counts);
const sum = (counts) => counts.reduce((total, n) => total + n, 0);

/** The single-number candidates, and the two-tier answer. */
const formulas = {
  'max over all - min over rotation': (a) => Math.max(...a.rotation, ...a.exempt) - Math.min(...a.rotation),
  'spread over rotation only': (a) => spread(a.rotation),
  'spread + exempt visits': (a) => spread(a.rotation) + sum(a.exempt),
  'exemptHardVisits, then spread': (a) => [sum(a.exempt), spread(a.rotation)],
};

const lex = (a, b) => {
  const x = [a].flat();
  const y = [b].flat();
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};

const wanted = arrangements[0].name;
for (const [label, score] of Object.entries(formulas)) {
  const scored = arrangements.map((a) => ({ name: a.name, value: score(a) }));
  const order = lex(scored[0].value, scored[1].value);
  const picked = order < 0 ? scored[0].name : order > 0 ? scored[1].name : 'a tie';
  const verdict = picked === wanted ? 'correct' : 'WRONG';
  console.log(
    label.padEnd(34),
    scored.map((s) => `${s.name.split(' (')[1].replace(')', '')}=${JSON.stringify(s.value)}`).join('  ').padEnd(28),
    `-> ${picked}`.padEnd(34),
    verdict,
  );
}
