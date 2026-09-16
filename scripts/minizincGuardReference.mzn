% Independent Guard reference model.
% Time is represented as atomic intervals relative to the plan start.
int: P;
int: M;
int: T;
int: Q;
set of int: PEOPLE = 1..P;
set of int: MISSIONS = 1..M;
set of int: TIMES = 1..T;
set of int: QUALS = 1..Q;

array[TIMES] of int: duration;
array[MISSIONS, TIMES] of int: demand;
array[PEOPLE, TIMES] of bool: available;
array[PEOPLE, MISSIONS] of bool: excluded;
array[PEOPLE, QUALS] of bool: has_qualification;
array[MISSIONS, QUALS] of int: required_qualification;

% A pin is an overriding manual decision. History is exact: -1 means future
% and therefore undecided; 0/1 records the accepted elapsed assignment.
array[PEOPLE, MISSIONS, TIMES] of bool: pinned;
array[PEOPLE, MISSIONS, TIMES] of -1..1: history;

array[PEOPLE, MISSIONS, TIMES] of var bool: work;

constraint forall(p in PEOPLE, t in TIMES)(
  sum(m in MISSIONS)(bool2int(work[p,m,t])) <= 1
);
constraint forall(p in PEOPLE, m in MISSIONS, t in TIMES)(
  pinned[p,m,t] -> work[p,m,t]
);
constraint forall(p in PEOPLE, m in MISSIONS, t in TIMES where history[p,m,t] >= 0)(
  work[p,m,t] = (history[p,m,t] = 1)
);
constraint forall(p in PEOPLE, m in MISSIONS, t in TIMES)(
  work[p,m,t] -> (
    pinned[p,m,t] \/ history[p,m,t] = 1 \/
    (available[p,t] /\ not excluded[p,m])
  )
);

array[MISSIONS, TIMES] of var 0..P: staffed =
  array2d(MISSIONS, TIMES,
    [sum(p in PEOPLE)(bool2int(work[p,m,t])) | m in MISSIONS, t in TIMES]);
array[MISSIONS, TIMES] of int: fixed_staff =
  array2d(MISSIONS, TIMES,
    [sum(p in PEOPLE)(bool2int(pinned[p,m,t] \/ history[p,m,t] = 1))
      | m in MISSIONS, t in TIMES]);
% Automatic work never creates surplus seats. Manual pins and accepted history
% remain exact facts even when they exceed today's configured headcount.
constraint forall(m in MISSIONS, t in TIMES)(
  staffed[m,t] <= max(demand[m,t], fixed_staff[m,t])
);
array[MISSIONS, TIMES] of var 0..P: missing_seats =
  array2d(MISSIONS, TIMES,
    [max(0, demand[m,t] - staffed[m,t]) | m in MISSIONS, t in TIMES]);

array[MISSIONS, QUALS, TIMES] of var 0..P: qualified_staffed =
  array3d(MISSIONS, QUALS, TIMES,
    [sum(p in PEOPLE)(bool2int(work[p,m,t] /\ has_qualification[p,q]))
      | m in MISSIONS, q in QUALS, t in TIMES]);
array[MISSIONS, QUALS, TIMES] of var 0..P: missing_qualifications =
  array3d(MISSIONS, QUALS, TIMES,
    [if demand[m,t] > 0 then
       max(0, required_qualification[m,q] - qualified_staffed[m,q,t])
     else 0 endif
      | m in MISSIONS, q in QUALS, t in TIMES]);

var int: coverage_error =
  sum(m in MISSIONS, t in TIMES)(missing_seats[m,t] * duration[t]) +
  sum(m in MISSIONS, q in QUALS, t in TIMES)(
    missing_qualifications[m,q,t] * duration[t]
  );

array[PEOPLE] of var 0..sum(t in TIMES)(duration[t]): workload =
  [sum(m in MISSIONS, t in TIMES)(bool2int(work[p,m,t]) * duration[t])
    | p in PEOPLE];
var int: max_load = max(workload);
var int: min_load = min(workload);
var int: spread = max_load - min_load;

int: stage;
int: best_coverage;
int: best_max_load;
constraint stage >= 2 -> coverage_error = best_coverage;
constraint stage >= 3 -> max_load = best_max_load;
var int: objective =
  if stage = 1 then coverage_error
  elseif stage = 2 then max_load
  else spread
  endif;

solve :: bool_search(
  [work[p,m,t] | p in PEOPLE, m in MISSIONS, t in TIMES],
  first_fail, indomain_max, complete
) minimize objective;

output [
  "{\"coverage_error\":", show(coverage_error),
  ",\"max_load\":", show(max_load),
  ",\"spread\":", show(spread),
  ",\"workload\":", show(workload),
  ",\"work\":", show(array3d(PEOPLE, MISSIONS, TIMES, work)),
  "}"
];
