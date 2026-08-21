/**
 * Scheduling strategies - the *policy* half of the planner.
 *
 * `planner.js` decides who is eligible for a slot (availability, existing
 * bookings, mission windows, pins); a strategy decides which of those eligible
 * people actually gets it. Everything here is pure and dependency-free for the
 * same reason the engine is: a shared link must render identically for
 * everyone who opens it, forever.
 *
 * A strategy is `{ id, seed, compare }`:
 *   - `seed(employee, index)` returns extra per-employee fields merged into the
 *     engine's scheduling state. Omit it if the shared state is enough.
 *   - `compare(a, b, ctx)` orders candidate states best-first, exactly like an
 *     `Array#sort` comparator. `ctx` is `{ mission, start, end, kind }` where
 *     `kind` is `'local'` (one rotation slot) or `'remote'` (a whole mission
 *     held end to end). It must be a total order - every comparator here ends
 *     in a tiebreak that can never return 0 for two different people.
 *
 * Adding a strategy is one object below plus an entry in `STRATEGY`; the engine
 * itself does not change.
 */

export const STRATEGY = {
  /** Even out total time on duty. The original behaviour, and still the default. */
  BALANCED: 'balanced',
  /** A circular list of guards. Turns go round the ring; hours are never consulted. */
  ROTATION: 'rotation',
};

export const DEFAULT_STRATEGY = STRATEGY.BALANCED;

/* ------------------------------------------------------------------ */
/* balanced                                                            */
/* ------------------------------------------------------------------ */

/**
 * 1. fewest minutes so far      -> even rotation
 * 2. earliest `lastEnd`         -> maximizes the gap since last on duty
 * 3. fewest minutes on *this* mission -> rotates people across mission types,
 *    not just across time - otherwise two concurrent local missions can settle
 *    into "always the same person on A, always the other on B" even though
 *    their total minutes stay perfectly balanced.
 * 4. `seq`                      -> round-robin among exact ties
 *
 * A remote mission is claimed once and held end to end, so the per-mission
 * variety term is meaningless there and is skipped.
 */
const balanced = {
  id: STRATEGY.BALANCED,
  compare(a, b, ctx) {
    if (ctx.kind === 'remote') {
      return a.minutes - b.minutes
        || a.lastEnd - b.lastEnd
        || a.seq - b.seq;
    }
    return a.minutes - b.minutes
      || a.lastEnd - b.lastEnd
      || (a.missionMinutes.get(ctx.mission.id) ?? 0) - (b.missionMinutes.get(ctx.mission.id) ?? 0)
      || a.seq - b.seq;
  },
};

/* ------------------------------------------------------------------ */
/* rotation                                                            */
/* ------------------------------------------------------------------ */

/**
 * Merge an unsorted interval list into maximal contiguous runs.
 *
 * One continuous stretch on duty can reach the engine as several intervals:
 * the segment grid breaks at *every* employee's availability edge, so an
 * unrelated person's window can split someone else's otherwise-whole shift in
 * two. Counting those as two turns would charge a guard twice for one stint,
 * so the ring counts merged runs, not rows.
 */
export function mergedRuns(intervals) {
  const sorted = [...intervals].sort((x, y) => x.start - y.start || x.end - y.end);
  const runs = [];
  for (const iv of sorted) {
    const last = runs[runs.length - 1];
    // `>=` and not `>`: back-to-back shifts are one unbroken stint on duty.
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else runs.push({ start: iv.start, end: iv.end });
  }
  return runs;
}

/**
 * The ring's two sort keys for one candidate, measured as of `at`: when their
 * last turn ended, and how many turns they have begun.
 *
 * A candidate is only ever asked about a slot they are free for, so a run that
 * started before `at` cannot still be running at `at` - which is why one pass
 * yields both keys. The merged run list is cached against `busy.length`, since
 * the engine only ever appends to it.
 */
function ringKeys(st, at) {
  if (st.runsFor !== st.busy.length) {
    st.runs = mergedRuns(st.busy);
    st.runsFor = st.busy.length;
  }
  let turns = 0;
  let lastEnd = -Infinity;
  for (const run of st.runs) {
    if (run.start >= at) continue;
    turns += 1;
    if (run.end > lastEnd) lastEnd = run.end;
  }
  return { turns, lastEnd };
}

/**
 * Pure rotation: guards sit in a fixed circular list and take turns round it.
 * Total time on duty is deliberately never consulted - a twelve-hour remote
 * mission and a one-hour slot each cost exactly one turn.
 *
 * 1. earliest end of last turn  -> longest rested goes first
 * 2. fewest turns taken so far   -> separates people who came off at the same instant
 * 3. `ringIndex`                 -> the list order, and a total tiebreak
 *
 * Rest time leads rather than the turn count, and that ordering is load
 * bearing. A stint that runs across several slots is one unbroken run, so its
 * turn count does not rise while it is going on; ranked on turns first, whoever
 * started a block would keep winning the slot after it and hold the post
 * indefinitely. Ranked on rest first, the person who just came off is by
 * definition the least rested and goes last - which is also the thing the
 * strategy exists to maximize.
 *
 * Both keys are measured *as of the slot being filled* rather than read off a
 * running counter, which is what keeps the result independent of the order the
 * engine happens to place things. The engine fills pins first, then remote
 * missions, then local slots chronologically; a running counter would let a
 * pin for a late-evening shift push its holder to the back of the ring before
 * the morning slots were even assigned.
 *
 * Two consequences fall out of this for free:
 *   - Somebody unavailable for their turn keeps their place. They are filtered
 *     out of the candidate list, so they are still the longest rested and sort
 *     first again at the next slot they can actually cover.
 *   - A by-name assignment moves only that person. Their pinned shift is an
 *     interval like any other, so from its own time onward it counts as time on
 *     duty; everyone else's place in the ring is untouched.
 */
const rotation = {
  id: STRATEGY.ROTATION,
  seed: (employee, index) => ({ ringIndex: index, runs: [], runsFor: -1 }),
  compare(a, b, ctx) {
    const ka = ringKeys(a, ctx.start);
    const kb = ringKeys(b, ctx.start);
    // Compared rather than subtracted: two people who have never been on duty
    // both carry -Infinity, and `-Infinity - -Infinity` is NaN.
    if (ka.lastEnd !== kb.lastEnd) return ka.lastEnd < kb.lastEnd ? -1 : 1;
    if (ka.turns !== kb.turns) return ka.turns - kb.turns;
    return a.ringIndex - b.ringIndex;
  },
};

/* ------------------------------------------------------------------ */

const BY_ID = new Map([balanced, rotation].map((s) => [s.id, s]));

/**
 * Never throws and never returns undefined: an unknown name means a link
 * written by a newer build, and rendering it with the default beats blanking
 * the page.
 */
export function getStrategy(name) {
  return BY_ID.get(name) ?? BY_ID.get(DEFAULT_STRATEGY);
}
