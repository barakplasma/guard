% Optimize mode: one level of the ladder. Everything else is in the core.
include "rota-core.mzn";

solve :: int_search([assignedMission[employee, segment]
                     | employee in Employees, segment in Segments],
                    first_fail, indomain_min)
      minimize objectives[objectiveLevel];
