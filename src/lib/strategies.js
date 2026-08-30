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
 *     `Array#sort` comparator. `ctx` is
 *     `{ mission, start, end, kind, planStart, shiftMinutes }` where `kind` is
 *     `'local'` (one rotation slot) or `'remote'` (a whole mission held end to
 *     end), and `planStart`/`shiftMinutes` describe the shift grid the plan
 *     rotates on. It must be a total order - every comparator here ends in a
 *     tiebreak that can never return 0 for two different people.
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
 *
 * An interval flagged `remote` never merges, in either direction. A remote
 * mission is claimed once and held end to end, which the ring charges as a
 * single turn however long it runs (see `ringKeys`); welding it to a local
 * slot that happens to start the moment it ends would swallow that local turn
 * into the same free ride.
 */
export function mergedRuns(intervals) {
  const sorted = [...intervals].sort((x, y) => x.start - y.start || x.end - y.end);
  const runs = [];
  for (const iv of sorted) {
    const last = runs[runs.length - 1];
    // `>=` and not `>`: back-to-back shifts are one unbroken stint on duty.
    if (last && !last.remote && !iv.remote && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      runs.push({ start: iv.start, end: iv.end, ...(iv.remote ? { remote: true } : null) });
    }
  }
  return runs;
}

/**
 * How many turns one run costs on a shift grid anchored at `planStart` and
 * stepping every `step` ms: the number of grid slots the run touches.
 *
 * This is the distinction the ring lives or dies on. A run split apart *inside*
 * a slot - by an unrelated employee's availability edge - still touches one
 * slot and still costs one turn, which is what `mergedRuns` exists to protect.
 * A run that carries straight on across three consecutive slots is three turns,
 * because it is three shifts somebody else did not get.
 */
function slotSpan(run, planStart, step) {
  if (!(step > 0)) return 1;
  return Math.max(
    1,
    Math.ceil((run.end - planStart) / step) - Math.floor((run.start - planStart) / step),
  );
}

/**
 * The ring's two sort keys for one candidate, measured as of `ctx.start`: when
 * their last turn ended, and how many turns they have taken.
 *
 * A candidate is only ever asked about a slot they are free for, so a run that
 * started before the slot cannot still be running at it - which is why one pass
 * yields both keys. The merged run list is cached against `busy.length`, since
 * the engine only ever appends to it.
 */
function ringKeys(st, ctx) {
  const at = ctx.start;
  if (st.runsFor !== st.busy.length) {
    st.runs = mergedRuns(st.busy);
    st.runsFor = st.busy.length;
  }
  const step = ctx.shiftMinutes * 60 * 1000;
  let turns = 0;
  let lastEnd = -Infinity;
  for (const run of st.runs) {
    if (run.start >= at) continue;
    turns += run.remote ? 1 : slotSpan(run, ctx.planStart, step);
    if (run.end > lastEnd) lastEnd = run.end;
  }
  return { turns, lastEnd };
}

/**
 * Pure rotation: guards sit in a fixed circular list and take turns round it.
 * Total time on duty is deliberately never consulted - a twelve-hour remote
 * mission and a one-hour slot each cost exactly one turn, because each is one
 * claim taken once. What is counted is turns, and a local block spanning
 * several rotation slots is several of them (`slotSpan`) - not because of its
 * length but because it is that many shifts nobody else got a turn at.
 *
 * 1. earliest end of last turn  -> longest rested goes first
 * 2. fewest turns taken so far   -> separates people who came off at the same instant
 * 3. `ringIndex`                 -> the list order, and a total tiebreak
 *
 * Rest time leads rather than the turn count, and that ordering is load
 * bearing: the person who just came off is by definition the least rested and
 * goes last, which is the thing the strategy exists to maximize.
 *
 * Rest-first is not on its own enough, though, and assuming it was cost three
 * guards eighty-eight unbroken hours in a real rota. Whenever there are more
 * seats than there are rested people - seventeen guards against ten seats a
 * slot, say - somebody *must* work the slot they just finished, and every
 * candidate's last turn ended on the same grid boundary, so key 1 ties and key
 * 2 decides. Counting a multi-slot block as a single turn made that key say the
 * opposite of the truth: the guard who never got a break had the *lowest* turn
 * count, won the tie, stayed on post, and stayed cheap - and `ringIndex` then
 * pinned the whole thing to the same lowest-numbered guards for four days.
 * `slotSpan` is the fix: a block across N slots costs N turns, so the guard who
 * has been doubling up is the expensive one and the doubling rotates.
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
    const ka = ringKeys(a, ctx);
    const kb = ringKeys(b, ctx);
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
