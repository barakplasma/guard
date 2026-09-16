% Guard rota: one segment-grid assignment, solved globally.
%
% ADR 011's prototype. This is NOT shipped and is not wired into the app; it
% exists to be measured against that record's acceptance criteria before
% anything replaces the hand-written engine.
%
% Scope, stated plainly so nobody reads more into it than is here. This models
% the part ADR 008's defect 3 is about: given a segment grid, who stands where.
% Hard rules are pins, availability, exclusions and headcount. Not modelled yet:
% night rest, daily occurrences as distinct holds, remote wholeness, and the
% per-mission grids themselves - the grid arrives already computed, because
% building it is domain work the engine does well and a solver has no opinion on.
%
% Time is a **segment index**, not an epoch millisecond (ADR 011). The horizon is
% 72 hours, so the caller maps absolute instants onto 1..nS before it gets here
% and back again afterwards. Epoch values would blow up every domain for nothing.

include "lex_lesseq.mzn";

int: nE;                                     % employees
int: nM;                                     % missions
int: nS;                                     % segments of the grid
set of int: E = 1..nE;
set of int: M = 1..nM;
set of int: S = 1..nS;

array[M, S] of int: want;                    % seats wanted; 0 where not running
% Which grid slot each segment belongs to, per mission. Two segments of one
% mission sharing a slot number are two halves of one shift - an availability
% edge, a night edge or a pin bound tore the slot in two. The engine stamps
% every row with this for the same reason (`slotStart`/`slotEnd`): the slot, not
% the segment, is the unit a turn is counted in and the unit `mergeRows` rejoins
% on. Without it here the solver would happily rotate people through the halves
% of a single hour to shave the imbalance, which is not a schedule anybody wants
% to stand.
array[M, S] of int: slotOf;
% Segments that are one indivisible hold, as a group id per mission per segment;
% 0 means "not one". A remote mission is one set of people end to end, and a
% daily mission is one set per calendar occurrence - the engine expresses that by
% never walking their segments at all, claiming them whole in phase 2. A model
% has no phases to hide it in, so it has to be said: crew inside a group cannot
% change. This one *is* hard. Unlike a torn slot, there is no pin shape that
% needs a handover mid-hold; `normalizePins` already widens a remote pin to the
% whole mission before the engine sees it.
array[M, S] of int: holdOf;
array[E, S] of bool: avail;                  % free to work this segment
array[E, M] of bool: allowed;                % not excluded, by tag or by name
array[E, M, S] of bool: pinned;              % manual assignment: an input fact

int: nReq;                                   % qualification requirements
set of int: R = 1..nReq;
array[R] of M: reqMission;
array[R] of int: reqCount;
array[R, E] of bool: reqHolds;               % employee holds the required tag

% Interchangeable employees, as a class id per employee; 0 means "nobody else
% is like me". Two guards are interchangeable when nothing in the instance can
% tell them apart: same availability, same exclusions, same qualifications, and
% neither of them pinned anywhere. Derived in the driver rather than asked of
% the caller, because a caller that got it wrong would prune real solutions.
array[E] of int: symClass;

% --- the decision -----------------------------------------------------------
array[E, M, S] of var bool: x;

% --- hard rules -------------------------------------------------------------

% A pin is an input fact, not a suggestion. It outranks availability and
% exclusion both, exactly as normalizePins already treats it - the person
% editing knows who actually showed up better than a stale window does.
constraint forall(e in E, m in M, s in S)(pinned[e, m, s] -> x[e, m, s]);

% Nobody is in two places at once.
constraint forall(e in E, s in S)(sum(m in M)(bool2int(x[e, m, s])) <= 1);

% Availability and exclusions bind everyone the user did not pin.
constraint forall(e in E, m in M, s in S)(
  (not avail[e, s] /\ not pinned[e, m, s]) -> not x[e, m, s]
);
constraint forall(e in E, m in M, s in S)(
  (not allowed[e, m] /\ not pinned[e, m, s]) -> not x[e, m, s]
);

constraint forall(e in E, m in M, s in 2..nS where
  holdOf[m, s] > 0 /\ holdOf[m, s] == holdOf[m, s - 1]
)(x[e, m, s] == x[e, m, s - 1]);

% Six identical guards are 720 identical schedules, and the solver will walk all
% of them to prove nothing better exists. Ordering interchangeable employees
% collapses that to one. It prunes no real solution: by construction the members
% of a class can be permuted into each other without changing any objective.
constraint forall(e in 1..nE - 1 where symClass[e] > 0 /\ symClass[e] == symClass[e + 1])(
  lex_lesseq([bool2int(x[e + 1, m, s]) | m in M, s in S],
             [bool2int(x[e, m, s])     | m in M, s in S])
);

% A mission never holds more people than it asked for, and nobody is assigned
% to one that is not running.
constraint forall(m in M, s in S)(sum(e in E)(bool2int(x[e, m, s])) <= want[m, s]);

% --- what is being optimised ------------------------------------------------
% Kept as separate named quantities rather than folded into one weighted sum.
% A weighted sum needs weights large enough that no amount of fairness can
% outbid one empty seat, and "large enough" depends on the instance - get it
% wrong and the solver trades away coverage silently. Lexicographic ordering
% says the same thing without a magic number.

% Every objective below is declared with an explicit domain, and that is not
% tidiness. `unfilledSeats` is a sum of `want - sum(x)` terms, each non-negative
% only because of the headcount constraint above - which MiniZinc does not fold
% into the expression's inferred bounds. Left as `var int` the solver found the
% optimum in milliseconds and then spent minutes failing to prove nothing beat
% it, because as far as its bounds were concerned a negative total was still on
% the table. Naming the floor turns that proof into propagation.
int: totalSeats = sum(m in M, s in S)(want[m, s]);
int: maxUnmet = sum(r in R, s in S where want[reqMission[r], s] > 0)(reqCount[r]);

% 1. Required qualifications not covered, summed over every running segment.
var 0..maxUnmet: unmetQualifications = sum(r in R, s in S where want[reqMission[r], s] > 0)(
  max(0, reqCount[r] - sum(e in E where reqHolds[r, e])(bool2int(x[e, reqMission[r], s])))
);

% 2. Seats left empty.
var 0..totalSeats: unfilledSeats = sum(m in M, s in S)(
  want[m, s] - sum(e in E)(bool2int(x[e, m, s]))
);

% 3. Crew changing hands inside one slot. Soft rather than hard, because a pin
% covering half a slot *must* be able to hand over at its own edge - the engine
% splits segments on accepted pin bounds precisely so it can. A hard equality
% would make such a pin infeasible or silently swallow the rest of the slot.
var 0..nE * nM * nS: slotChurn = sum(e in E, m in M, s in 2..nS where
    want[m, s] > 0 /\ want[m, s - 1] > 0 /\ slotOf[m, s] == slotOf[m, s - 1]
  )(bool2int(x[e, m, s] != x[e, m, s - 1]));

% 4. Workload imbalance: the gap between the busiest and the idlest.
array[E] of var 0..nS: load = [sum(m in M, s in S)(bool2int(x[e, m, s])) | e in E];
var 0..nS: imbalance = max(load) - min(load);

% --- the lexicographic ladder -----------------------------------------------
% One model, solved once per level. The driver passes the previous levels'
% proven optima back in as caps, so each round searches inside the set of
% solutions the earlier rounds already settled. `-1` means "not yet fixed".
%
% Doing it this way rather than with three model files means the hard rules
% above have exactly one definition, which is the whole reason to move this
% into a model in the first place.

int: level;                    % 1 qualifications, 2 seats, 3 churn, 4 imbalance
int: capUnmet;
int: capUnfilled;
int: capChurn;

constraint capUnmet    >= 0 -> unmetQualifications <= capUnmet;
constraint capUnfilled >= 0 -> unfilledSeats       <= capUnfilled;
constraint capChurn    >= 0 -> slotChurn           <= capChurn;

var 0..totalSeats + maxUnmet + nE * nM * nS: objective =
  if level == 1 then unmetQualifications
  elseif level == 2 then unfilledSeats
  elseif level == 3 then slotChurn
  else imbalance endif;

solve minimize objective;

output [
  "objective = ", show(objective), ";\n",
  "unmetQualifications = ", show(unmetQualifications), ";\n",
  "unfilledSeats = ", show(unfilledSeats), ";\n",
  "slotChurn = ", show(slotChurn), ";\n",
  "imbalance = ", show(imbalance), ";\n",
  "x = ", show([bool2int(x[e, m, s]) | e in E, m in M, s in S]), ";\n",
];
