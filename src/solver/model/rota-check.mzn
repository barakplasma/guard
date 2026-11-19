% Check mode: the same rules and the same named quantities, with the candidate
% assignment fixed and nothing to optimise. Its answer is the only thing the
% app is allowed to accept - see src/solver/check.ts.
include "rota-core.mzn";

array[Employees, Segments] of MissionOrOff: candidateAssignment;
constraint forall(employee in Employees, segment in Segments)(
  assignedMission[employee, segment] == candidateAssignment[employee, segment]);

solve satisfy;
