/**
 * Brute-force oracle for `rota.mzn`, and the random instances to point it at.
 *
 * ADR 011 asks for the model to be checked against an exhaustive search on
 * small instances before anything downstream trusts it. "The solver agrees with
 * itself" proves nothing; an oracle that enumerates every assignment and picks
 * the lexicographic best is the only statement worth making here.
 *
 * Enumeration is per segment: within one segment each person goes to exactly one
 * of {nowhere, m1..mM}, so the space is (nM+1)^(nE*nS). Keep instances small -
 * the generator below does.
 */

/** Hard feasibility, stated once and used by both the oracle and the checker. */
export function violations(inst, x) {
  const { nE, nM, nS } = inst;
  const bad = [];
  for (let e = 0; e < nE; e++) {
    for (let s = 0; s < nS; s++) {
      let at = 0;
      for (let m = 0; m < nM; m++) if (x[e][m][s]) at++;
      if (at > 1) bad.push(`e${e} in ${at} places at s${s}`);
    }
  }
  for (let e = 0; e < nE; e++) {
    for (let m = 0; m < nM; m++) {
      for (let s = 0; s < nS; s++) {
        if (inst.pinned[e][m][s] && !x[e][m][s]) bad.push(`pin e${e}/m${m}/s${s} dropped`);
        if (!x[e][m][s] || inst.pinned[e][m][s]) continue;
        if (!inst.avail[e][s]) bad.push(`e${e} unavailable at s${s}`);
        if (!inst.allowed[e][m]) bad.push(`e${e} excluded from m${m}`);
      }
    }
  }
  for (let m = 0; m < nM; m++) {
    for (let s = 0; s < nS; s++) {
      let on = 0;
      for (let e = 0; e < nE; e++) if (x[e][m][s]) on++;
      if (on > inst.want[m][s]) bad.push(`m${m}/s${s} holds ${on} of ${inst.want[m][s]}`);
    }
  }
  for (let e = 0; e < nE; e++) {
    for (let m = 0; m < nM; m++) {
      for (let s = 1; s < nS; s++) {
        const h = inst.holdOf[m][s];
        if (h > 0 && h === inst.holdOf[m][s - 1] && x[e][m][s] !== x[e][m][s - 1]) {
          bad.push(`e${e} changed hands inside hold ${h} on m${m}`);
        }
      }
    }
  }
  return bad;
}

/** The objectives, in the order the ladder minimises them. */
export function score(inst, x) {
  const { nE, nM, nS } = inst;
  let unmetQualifications = 0;
  for (const r of inst.requires) {
    for (let s = 0; s < nS; s++) {
      if (inst.want[r.mission][s] <= 0) continue;
      let have = 0;
      for (let e = 0; e < nE; e++) if (r.holds[e] && x[e][r.mission][s]) have++;
      unmetQualifications += Math.max(0, r.count - have);
    }
  }
  let unfilledSeats = 0;
  for (let m = 0; m < nM; m++) {
    for (let s = 0; s < nS; s++) {
      let on = 0;
      for (let e = 0; e < nE; e++) if (x[e][m][s]) on++;
      unfilledSeats += inst.want[m][s] - on;
    }
  }
  let slotChurn = 0;
  for (let e = 0; e < nE; e++) {
    for (let m = 0; m < nM; m++) {
      for (let s = 1; s < nS; s++) {
        if (inst.want[m][s] <= 0 || inst.want[m][s - 1] <= 0) continue;
        if (inst.slotOf[m][s] !== inst.slotOf[m][s - 1]) continue;
        if (x[e][m][s] !== x[e][m][s - 1]) slotChurn++;
      }
    }
  }
  const load = Array.from({ length: nE }, (_, e) => {
    let n = 0;
    for (let m = 0; m < nM; m++) for (let s = 0; s < nS; s++) if (x[e][m][s]) n++;
    return n;
  });
  return [unmetQualifications, unfilledSeats, slotChurn, Math.max(...load) - Math.min(...load)];
}

const lexLess = (a, b) => a.some((v, i) => v !== b[i] && v < b[i] && a.slice(0, i).every((u, j) => u === b[j]));

const blank = (inst) => Array.from({ length: inst.nE }, () => (
  Array.from({ length: inst.nM }, () => Array.from({ length: inst.nS }, () => false))));

/**
 * Every feasible assignment, best triple wins. Returns `null` when the hard
 * rules cannot be met at all - contradictory pins, in practice.
 */
export function bruteForce(inst) {
  const { nE, nM, nS } = inst;
  const x = blank(inst);
  let best = null;
  const place = (e, s) => {
    // The one slot this person is pinned to in this segment, if any: a pin is
    // not a choice, so the branch collapses to it.
    for (let m = 0; m < nM; m++) if (inst.pinned[e][m][s]) return [m];
    const options = [-1];
    for (let m = 0; m < nM; m++) {
      if (inst.want[m][s] > 0 && inst.avail[e][s] && inst.allowed[e][m]) options.push(m);
    }
    return options;
  };
  const walk = (i) => {
    if (i === nE * nS) {
      if (violations(inst, x).length) return;
      const got = score(inst, x);
      if (!best || lexLess(got, best.score)) {
        best = { score: got, x: x.map((r) => r.map((c) => c.slice())) };
      }
      return;
    }
    const e = Math.floor(i / nS);
    const s = i % nS;
    for (const m of place(e, s)) {
      if (m >= 0) x[e][m][s] = true;
      walk(i + 1);
      if (m >= 0) x[e][m][s] = false;
    }
  };
  walk(0);
  return best;
}

/** Deterministic PRNG - a failing case has to be reproducible from its seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A small random instance. Deliberately tight: scarce people, missions that
 * overlap in time, and qualification requirements that can only be met by a few
 * - which is the shape the greedy engine gets wrong (ADR 008 defect 3).
 */
export function randomInstance(seed) {
  const r = rng(seed);
  const pick = (n) => Math.floor(r() * n);
  const nE = 2 + pick(3);          // 2..4
  const nM = 1 + pick(2);          // 1..2
  const nS = 1 + pick(3);          // 1..3
  const inst = { nE, nM, nS };
  inst.want = Array.from({ length: nM }, () => (
    Array.from({ length: nS }, () => (r() < 0.2 ? 0 : 1 + pick(2)))));
  // Segments grouped into slots, so some instances carry a slot torn in two and
  // the churn term has something to say. A fresh slot number per segment, with
  // an even chance of continuing the previous one.
  // Roughly a third of missions are an indivisible hold - a remote mission, or
  // one occurrence of a daily one.
  inst.holdOf = Array.from({ length: nM }, () => {
    const whole = r() < 0.33;
    return Array.from({ length: nS }, () => (whole ? 1 : 0));
  });
  inst.slotOf = Array.from({ length: nM }, () => {
    const out = [];
    let slot = 0;
    for (let s = 0; s < nS; s++) {
      if (s > 0 && r() < 0.5) slot++;
      out.push(slot);
    }
    return out;
  });
  inst.avail = Array.from({ length: nE }, () => (
    Array.from({ length: nS }, () => r() < 0.85)));
  inst.allowed = Array.from({ length: nE }, () => (
    Array.from({ length: nM }, () => r() < 0.85)));
  inst.pinned = Array.from({ length: nE }, () => (
    Array.from({ length: nM }, () => Array.from({ length: nS }, () => false))));
  // At most one pin per (person, segment), or the instance is contradictory for
  // a reason that says nothing about the model.
  for (let e = 0; e < nE; e++) {
    for (let s = 0; s < nS; s++) {
      if (r() < 0.12) {
        const m = pick(nM);
        if (inst.want[m][s] > 0) inst.pinned[e][m][s] = true;
      }
    }
  }
  // ...and no more pins on a mission than it has seats, same reason.
  for (let m = 0; m < nM; m++) {
    for (let s = 0; s < nS; s++) {
      let seen = 0;
      for (let e = 0; e < nE; e++) {
        if (!inst.pinned[e][m][s]) continue;
        seen++;
        if (seen > inst.want[m][s]) inst.pinned[e][m][s] = false;
      }
    }
  }
  inst.requires = [];
  if (r() < 0.6) {
    const mission = pick(nM);
    const holds = Array.from({ length: nE }, () => r() < 0.4);
    inst.requires.push({ mission, count: 1 + pick(2), holds });
  }
  return inst;
}
