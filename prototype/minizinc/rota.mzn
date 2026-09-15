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

int: nE;                                     % employees
int: nM;                                     % missions
int: nS;                                     % segments of the grid
set of int: E = 1..nE;
set of int: M = 1..nM;
set of int: S = 1..nS;

array[M, S] of int: want;                    % seats wanted; 0 where not running
array[E, S] of bool: avail;                  % free to work this segment
array[E, M] of bool: allowed;                % not excluded, by tag or by name
array[E, M, S] of bool: pinned;              % manual assignment: an input fact

int: nReq;                                   % qualification requirements
set of int: R = 1..nReq;
array[R] of M: reqMission;
array[R] of int: reqCount;
array[R, E] of bool: reqHolds;               % employee holds the required tag

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

% A mission never holds more people than it asked for, and nobody is assigned
% to one that is not running.
constraint forall(m in M, s in S)(sum(e in E)(bool2int(x[e, m, s])) <= want[m, s]);

% --- what is being optimised ------------------------------------------------
% Kept as separate named quantities rather than folded into one weighted sum.
% A weighted sum needs weights large enough that no amount of fairness can
% outbid one empty seat, and "large enough" depends on the instance - get it
% wrong and the solver trades away coverage silently. Lexicographic ordering
% says the same thing without a magic number.

% 1. Required qualifications not covered, summed over every running segment.
var int: unmetQualifications = sum(r in R, s in S where want[reqMission[r], s] > 0)(
  max(0, reqCount[r] - sum(e in E where reqHolds[r, e])(bool2int(x[e, reqMission[r], s])))
);

% 2. Seats left empty.
var int: unfilledSeats = sum(m in M, s in S)(
  want[m, s] - sum(e in E)(bool2int(x[e, m, s]))
);

% 3. Workload imbalance: the gap between the busiest and the idlest.
array[E] of var 0..nS: load = [sum(m in M, s in S)(bool2int(x[e, m, s])) | e in E];
var int: imbalance = max(load) - min(load);

% --- the lexicographic ladder -----------------------------------------------
% One model, solved once per level. The driver passes the previous levels'
% proven optima back in as caps, so each round searches inside the set of
% solutions the earlier rounds already settled. `-1` means "not yet fixed".
%
% Doing it this way rather than with three model files means the hard rules
% above have exactly one definition, which is the whole reason to move this
% into a model in the first place.

int: level;                                  % 1 = coverage, 2 = seats, 3 = fairness
int: capUnmet;
int: capUnfilled;

constraint capUnmet    >= 0 -> unmetQualifications <= capUnmet;
constraint capUnfilled >= 0 -> unfilledSeats       <= capUnfilled;

var int: objective =
  if level == 1 then unmetQualifications
  elseif level == 2 then unfilledSeats
  else imbalance endif;

solve minimize objective;

output [
  "objective = ", show(objective), ";\n",
  "unmetQualifications = ", show(unmetQualifications), ";\n",
  "unfilledSeats = ", show(unfilledSeats), ";\n",
  "imbalance = ", show(imbalance), ";\n",
  "x = ", show([bool2int(x[e, m, s]) | e in E, m in M, s in S]), ";\n",
];
