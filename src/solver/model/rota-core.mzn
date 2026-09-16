% Guard rota: one assignment matrix over the global segment grid (ADR 017).
% Time is a segment index; every duration is `segmentMinutes`.
%
% This file declares the parameters, the decision, the hard rules and every
% named quantity. It is never solved on its own: `rota-optimize.mzn` adds a
% `solve minimize`, `rota-check.mzn` adds the fixing constraint and a `solve
% satisfy`. Two entry files over one core is what makes "the model computed
% something other than it reported" a detectable defect rather than an
% article of faith - see src/solver/check.ts.

include "lex_lesseq.mzn";

int: MODEL_VERSION = 1;
int: LEVEL_COUNT = 14;
int: OFF_DUTY = 0;

% ---- sizes ----------------------------------------------------------------
int: employeeCount;
int: missionCount;
int: segmentCount;
int: nightCount;
int: pinCount;
int: requirementCount;
int: longRunWindowCount;
int: sleepWindowCount;

set of int: Employees      = 1..employeeCount;
set of int: Missions       = 1..missionCount;
set of int: MissionOrOff   = 0..missionCount;
set of int: Segments       = 1..segmentCount;
set of int: Nights         = 1..nightCount;
set of int: Pins           = 1..pinCount;
set of int: Requirements   = 1..requirementCount;
set of int: LongRunWindows = 1..longRunWindowCount;
set of int: SleepWindows   = 1..sleepWindowCount;
set of int: Levels         = 1..LEVEL_COUNT;
set of int: Hours          = 0..23;

% ---- the grid -------------------------------------------------------------
array[Segments] of int: segmentMinutes;
array[Segments] of int: nightOfSegment;          % 0 = day
array[Missions, Segments] of int: seatsWanted;   % 0 = not running
array[Missions, Segments] of int: slotOfSegment; % rotation slot, 0 = none
array[Missions, Segments] of int: holdOfSegment; % indivisible hold, 0 = none

% ---- people ---------------------------------------------------------------
array[Employees, Segments] of bool: isAvailable;
array[Employees, Missions] of bool: isAllowed;   % not excluded by tag or name

% ---- what the log says about the memory horizon (see src/solver/prepare.ts)
array[Employees] of int: idleMinutesAtHorizonStart; % since the last logged duty, capped
array[Employees] of int: recentTurns;
array[Employees] of int: recentNightMinutes;
array[Employees, Missions] of int: recentTurnsOnMission;
array[Employees, Missions] of bool: heldWithinCooldown;
array[Employees, Hours] of int: recentHourHolds;   % turns begun at that hour of day
array[Segments] of int: hourOfSegment;             % 0..23, at the segment's start
array[Missions] of int: repeatAfterDays;           % 0 = no once-per-rotation rule
array[Employees] of int: requiredNightRestMinutes; % 0 = no requirement
array[Employees] of int: symmetryClass;            % 0 = nobody else is like me

% ---- missions -------------------------------------------------------------
array[MissionOrOff] of bool: isSleepable;        % index OFF_DUTY is true

% ---- commitments: manual pins and logged duty, one row per covered cell ---
array[Pins] of Employees: pinEmployee;
array[Pins] of Missions:  pinMission;
array[Pins] of Segments:  pinSegment;

% ---- qualification requirements -------------------------------------------
array[Requirements] of Missions: requirementMission;
array[Requirements] of int: requirementSeats;
array[Requirements, Employees] of bool: holdsRequirement;

% ---- windows longer than the unbroken-run cap (ADR 016) -------------------
array[LongRunWindows] of Segments: longRunFirstSegment;
array[LongRunWindows] of Segments: longRunLastSegment;

% ---- windows inside one night long enough for the target night's sleep ----
array[SleepWindows] of Segments: sleepWindowFirstSegment;
array[SleepWindows] of Segments: sleepWindowLastSegment;
array[SleepWindows] of Nights:   sleepWindowNight;

% ---- the ladder (optimize mode reads these; check mode ignores them) ------
int: objectiveLevel;
array[Levels] of int: objectiveCap;              % -1 = uncapped

% ---- the decision ---------------------------------------------------------
% One cell, one mission. Double booking is not a value this array can hold.
array[Employees, Segments] of var MissionOrOff: assignedMission :: add_to_output;

% ---- derived views of the decision ---------------------------------------
array[Employees, Missions, Segments] of var bool: isOnMission =
  array3d(Employees, Missions, Segments, [
    assignedMission[employee, segment] == mission
    | employee in Employees, mission in Missions, segment in Segments ]);

array[Employees, Segments] of var bool: isOnDuty =
  array2d(Employees, Segments, [
    assignedMission[employee, segment] != OFF_DUTY
    | employee in Employees, segment in Segments ]);

array[Employees, Segments] of bool: isPinnedCell =
  array2d(Employees, Segments, [
    exists(pin in Pins)(pinEmployee[pin] == employee /\ pinSegment[pin] == segment)
    | employee in Employees, segment in Segments ]);

array[Missions, Segments] of var 0..employeeCount: seatsFilled :: add_to_output =
  array2d(Missions, Segments, [
    sum(employee in Employees)(isOnMission[employee, mission, segment])
    | mission in Missions, segment in Segments ]);

% ---- hard rules -----------------------------------------------------------
% A commitment is a fact. Two commitments on one cell make the instance
% infeasible rather than one of them disappearing.
constraint forall(pin in Pins)(
  assignedMission[pinEmployee[pin], pinSegment[pin]] == pinMission[pin]);

% Availability and exclusions bind every cell a person did not commit by hand.
constraint forall(employee in Employees, segment in Segments
    where not isAvailable[employee, segment] /\ not isPinnedCell[employee, segment])(
  assignedMission[employee, segment] == OFF_DUTY);

constraint forall(employee in Employees, mission in Missions, segment in Segments
    where not isAllowed[employee, mission] /\ not isPinnedCell[employee, segment])(
  assignedMission[employee, segment] != mission);

% Nobody stands a mission that is not running.
constraint forall(employee in Employees, mission in Missions, segment in Segments
    where seatsWanted[mission, segment] == 0)(
  assignedMission[employee, segment] != mission);

% A mission never holds more people than it wants.
constraint forall(mission in Missions, segment in Segments)(
  seatsFilled[mission, segment] <= seatsWanted[mission, segment]);

% Crew inside a hold cannot change: a remote mission end to end, a daily
% occurrence whole.
constraint forall(employee in Employees, mission in Missions, segment in 2..segmentCount
    where holdOfSegment[mission, segment] > 0
       /\ holdOfSegment[mission, segment] == holdOfSegment[mission, segment - 1])(
  isOnMission[employee, mission, segment] == isOnMission[employee, mission, segment - 1]);

% Interchangeable people are ordered, so the solver does not walk their
% permutations. Prunes nothing real: members of a class can be swapped without
% changing any quantity below.
constraint forall(employee in 1..employeeCount - 1
    where symmetryClass[employee] > 0
       /\ symmetryClass[employee] == symmetryClass[employee + 1])(
  lex_lesseq([assignedMission[employee + 1, segment] | segment in Segments],
             [assignedMission[employee,     segment] | segment in Segments]));

% ---- named quantities -----------------------------------------------------
% Every floor is declared. MiniZinc does not fold the headcount rule into the
% inferred bounds of a `seatsWanted - seatsFilled` sum, and an unbounded
% objective turns a millisecond optimum into minutes of failed proof.

% The one rest number the owner optimises for: eight hours off. Six hours is
% not a constant here; it is the configured per-qualification minimum
% (`requiredNightRestMinutes`, six by default for drivers), a strongly
% suggested floor the user may lower in a pinch, and it is enforced only as
% level 4 below coverage, with the shortfall reported in actual minutes.
int: TARGET_REST_MINUTES = 480;

int: horizonMinutes = sum(segment in Segments)(segmentMinutes[segment]);
int: totalSeatMinutes = sum(mission in Missions, segment in Segments)(
  seatsWanted[mission, segment] * segmentMinutes[segment]);
int: totalRequirementMinutes = sum(requirement in Requirements, segment in Segments
    where seatsWanted[requirementMission[requirement], segment] > 0)(
  requirementSeats[requirement] * segmentMinutes[segment]);
int: totalNightMinutes = sum(segment in Segments where nightOfSegment[segment] > 0)(
  segmentMinutes[segment]);

% Level 1: required qualifications not covered, in seat-minutes.
array[Requirements, Segments] of var 0..employeeCount: qualifiedSeatsFilled :: add_to_output =
  array2d(Requirements, Segments, [
    sum(employee in Employees where holdsRequirement[requirement, employee])(
      isOnMission[employee, requirementMission[requirement], segment])
    | requirement in Requirements, segment in Segments ]);

var 0..totalRequirementMinutes: unmetQualificationMinutes :: add_to_output =
  sum(requirement in Requirements, segment in Segments
      where seatsWanted[requirementMission[requirement], segment] > 0)(
    max(0, requirementSeats[requirement] - qualifiedSeatsFilled[requirement, segment])
      * segmentMinutes[segment]);

% Level 2: seats left empty, in seat-minutes.
var 0..totalSeatMinutes: unfilledSeatMinutes :: add_to_output =
  sum(mission in Missions, segment in Segments)(
    (seatsWanted[mission, segment] - seatsFilled[mission, segment]) * segmentMinutes[segment]);

% Level 3: crew changing hands between two segments of one rotation slot.
% Soft, because a commitment covering half a slot must be able to hand over at
% its own edge. Above rest on purpose: a rest preference must never create a
% shift boundary (AGENTS.md).
var 0..employeeCount * missionCount * segmentCount: slotHandoverCount :: add_to_output =
  sum(employee in Employees, mission in Missions, segment in 2..segmentCount
      where seatsWanted[mission, segment] > 0
         /\ seatsWanted[mission, segment - 1] > 0
         /\ slotOfSegment[mission, segment] == slotOfSegment[mission, segment - 1])(
    isOnMission[employee, mission, segment] != isOnMission[employee, mission, segment - 1]);

% Rest is measured inside the night and inside the person's own availability,
% exactly as rest.js measures it. On-call duty is slept through (ADR 007).
array[Employees, Segments] of var bool: isAwakeOnDuty =
  array2d(Employees, Segments, [
    not isSleepable[assignedMission[employee, segment]]
    | employee in Employees, segment in Segments ]);

array[Employees, Nights] of var 0..totalNightMinutes: nightRestMinutes :: add_to_output =
  array2d(Employees, Nights, [
    sum(segment in Segments
        where nightOfSegment[segment] == night /\ isAvailable[employee, segment])(
      segmentMinutes[segment] * (1 - isAwakeOnDuty[employee, segment]))
    | employee in Employees, night in Nights ]);

% Level 4: shortfall against the configured per-qualification minimum.
int: maxRequiredNightRest = max([0] ++ requiredNightRestMinutes);
var 0..employeeCount * nightCount * maxRequiredNightRest: restShortfallMinutes :: add_to_output =
  sum(employee in Employees, night in Nights where requiredNightRestMinutes[employee] > 0)(
    max(0, requiredNightRestMinutes[employee] - nightRestMinutes[employee, night]));

% Level 5: shortfall against eight hours off in total, for everyone present.
% A configured minimum above eight ratchets the target up, never down.
array[Employees, Nights] of bool: isPresentForNight =
  array2d(Employees, Nights, [
    exists(segment in Segments where nightOfSegment[segment] == night)(
      isAvailable[employee, segment])
    | employee in Employees, night in Nights ]);

var 0..employeeCount * nightCount * max(TARGET_REST_MINUTES, maxRequiredNightRest):
  targetRestShortfallMinutes :: add_to_output =
  sum(employee in Employees, night in Nights where isPresentForNight[employee, night])(
    max(0, max(requiredNightRestMinutes[employee], TARGET_REST_MINUTES)
             - nightRestMinutes[employee, night]));

% Level 6: as many people as possible sleep the full eight hours in one
% stretch. Everyone counts, not only people with a rest requirement, and a
% night the person is not present for eight hours of is not held against the
% schedule.
array[Employees, Nights] of bool: canSleepTarget =
  array2d(Employees, Nights, [
    exists(window in SleepWindows where sleepWindowNight[window] == night)(
      forall(segment in sleepWindowFirstSegment[window]..sleepWindowLastSegment[window])(
        isAvailable[employee, segment]))
    | employee in Employees, night in Nights ]);

array[Employees, Nights] of var bool: sleepsTarget :: add_to_output =
  array2d(Employees, Nights, [
    exists(window in SleepWindows where sleepWindowNight[window] == night)(
      forall(segment in sleepWindowFirstSegment[window]..sleepWindowLastSegment[window])(
        isAvailable[employee, segment] /\ not isAwakeOnDuty[employee, segment]))
    | employee in Employees, night in Nights ]);

var 0..employeeCount * nightCount: nightsWithoutTargetSleep :: add_to_output =
  sum(employee in Employees, night in Nights where canSleepTarget[employee, night])(
    1 - sleepsTarget[employee, night]);

% Level 7: unbroken runs past the cap (ADR 016). One per (person, window)
% fully on duty. Soft, so a roster with nobody spare still gets an answer.
array[Employees] of var 0..longRunWindowCount: longRunsByEmployee :: add_to_output =
  [ sum(window in LongRunWindows)(
      forall(segment in longRunFirstSegment[window]..longRunLastSegment[window])(
        isOnDuty[employee, segment]))
    | employee in Employees ];
var 0..employeeCount * longRunWindowCount: longRunCount :: add_to_output = sum(longRunsByEmployee);

% Level 8: a mission everyone hates comes round once per rotation. A mission
% with `repeatAfterDays` set, kitchen say, costs one for every person who takes
% it while their last logged turn on it is inside the cooldown, and one more
% for every extra turn on it inside this window. The cooldown is measured from
% the log to the horizon start, an approximation of at most one window's
% length, which on a 24-hour plan is one day. Above round robin on purpose:
% this decides who is eligible for the kitchen, the wait decides who goes next
% among them.
array[Employees, Missions] of var 0..segmentCount: turnsOnMission :: add_to_output =
  array2d(Employees, Missions, [
    sum(segment in Segments
        where seatsWanted[mission, segment] > 0
           /\ (if segment == 1 then true
               else slotOfSegment[mission, segment] != slotOfSegment[mission, segment - 1]
                 \/ holdOfSegment[mission, segment] != holdOfSegment[mission, segment - 1]
               endif))(
      isOnMission[employee, mission, segment])
    | employee in Employees, mission in Missions ]);

var 0..employeeCount * missionCount * (segmentCount + 1): cooldownBreachCount :: add_to_output =
  sum(employee in Employees, mission in Missions where repeatAfterDays[mission] > 0)(
    bool2int(heldWithinCooldown[employee, mission]) * bool2int(turnsOnMission[employee, mission] >= 1)
    + max(0, turnsOnMission[employee, mission] - 1));

% Level 9: fairness is round robin, and nothing else. Whoever has waited
% longest goes next, and somebody back from a long mission goes to the end of
% the queue. Hours are never consulted; `dutyMinutes` is reported for the
% summary table and optimised nowhere.
array[Employees] of var 0..horizonMinutes: dutyMinutes :: add_to_output =
  [ sum(segment in Segments)(segmentMinutes[segment] * isOnDuty[employee, segment])
    | employee in Employees ];

% The bottleneck wait. Stated globally rather than one slot at a time: the
% shortest wait before any turn the solver chose is as long as it can be. A
% committed cell is not the solver's choice, so the wait before it is not
% scored.
%
% A wait is capped at the eight-hour target. After a night's sleep it no
% longer matters when somebody last stood post (the owner's words), and most
% plans are a day or less, so the queue only has to remember the last eight
% hours. Any eight hours off counts, not only a night: on a horizon this short
% an eight-hour break is a night's sleep in practice, and the cap keeps every
% domain here small.

% Minutes off duty running up to each segment, capped: the idle time at the
% horizon start, then a stretch that resets to zero after every on-duty
% segment and stops growing at the cap.
array[Employees, Segments] of var 0..TARGET_REST_MINUTES: idleMinutesBefore;
constraint forall(employee in Employees)(
  idleMinutesBefore[employee, 1] == min(TARGET_REST_MINUTES, idleMinutesAtHorizonStart[employee]));
constraint forall(employee in Employees, segment in 2..segmentCount)(
  idleMinutesBefore[employee, segment] ==
    min(TARGET_REST_MINUTES,
        (1 - isOnDuty[employee, segment - 1])
          * (idleMinutesBefore[employee, segment - 1] + segmentMinutes[segment - 1])));

array[Employees, Segments] of var bool: startsChosenTurn =
  array2d(Employees, Segments, [
    isOnDuty[employee, segment]
    /\ (if segment == 1 then true else not isOnDuty[employee, segment - 1] endif)
    /\ not isPinnedCell[employee, segment]
    | employee in Employees, segment in Segments ]);

% Written as a `min` rather than as a free variable bounded from above, so it
% is *determined* by the assignment. Check mode only fixes `assignedMission`;
% a free variable would satisfy the same instance at any value below the true
% minimum, and the objective comparison that catches "the model computed
% something other than it reported" would compare against nothing.
var 0..TARGET_REST_MINUTES: shortestWaitMinutes :: add_to_output =
  min([TARGET_REST_MINUTES] ++ [
    if startsChosenTurn[employee, segment]
      then idleMinutesBefore[employee, segment] else TARGET_REST_MINUTES endif
    | employee in Employees, segment in Segments ]);

% Minimised, so the wait is maximised. Zero means everyone the solver chose
% had eight hours off first; from there the queue is turns alone (level 10).
% With no chosen turn at all the level is trivially proved.
var 0..TARGET_REST_MINUTES: waitDeficitMinutes :: add_to_output = TARGET_REST_MINUTES - shortestWaitMinutes;

% Level 10: once the bottleneck wait is settled, turns are shared out, the
% turns the log remembers included. A turn is one distinct rotation slot
% entered, plus one per hold.
array[Employees] of var 0..missionCount * segmentCount: turnsTaken :: add_to_output =
  [ sum(mission in Missions)(turnsOnMission[employee, mission]) | employee in Employees ];
int: maxRecentTurns = max([0] ++ recentTurns);
array[Employees] of var 0..missionCount * segmentCount + maxRecentTurns: totalTurns =
  [ turnsTaken[employee] + recentTurns[employee] | employee in Employees ];
var 0..missionCount * segmentCount + maxRecentTurns: turnSpread :: add_to_output =
  max(totalTurns) - min(totalTurns);

% Level 11: prefer distinct people for distinct required roles. A person on a
% mission holding more than one of its required qualifications costs the
% surplus, so a driver who is also the commander is chosen only when nobody
% else can hold the second seat. An approximation, recorded as one.
var 0..employeeCount * segmentCount * requirementCount: sharedRoleCount :: add_to_output =
  sum(employee in Employees, mission in Missions, segment in Segments
      where seatsWanted[mission, segment] > 0)(
    isOnMission[employee, mission, segment]
      * max(0, sum(requirement in Requirements
                   where requirementMission[requirement] == mission)(
                 holdsRequirement[requirement, employee]) - 1));

% Level 12: night is much harder than day, so night duty is evened out over
% the memory horizon, not only inside this window. Somebody who only ever
% stands 01:00 while another only ever stands 13:00 is what this level exists
% to stop.
array[Employees] of var 0..totalNightMinutes: nightMinutesInWindow :: add_to_output =
  [ sum(segment in Segments where nightOfSegment[segment] > 0)(
      segmentMinutes[segment] * isOnDuty[employee, segment])
    | employee in Employees ];
int: maxRecentNightMinutes = max([0] ++ recentNightMinutes);
array[Employees] of var 0..totalNightMinutes + maxRecentNightMinutes: totalNightMinutesHeld =
  [ nightMinutesInWindow[employee] + recentNightMinutes[employee] | employee in Employees ];
var 0..totalNightMinutes + maxRecentNightMinutes: nightDutySpreadMinutes :: add_to_output =
  max(totalNightMinutesHeld) - min(totalNightMinutesHeld);

% Level 13: rotate people across missions. Every turn on a mission costs the
% number of turns the log already shows that person on that mission, so
% whoever has done it least lately is the cheapest to send. With enough drivers
% this is what swaps who takes the morning and the night patrol, and what sends
% somebody on patrol one day and to the gate the next.
int: missionRepeatCeiling = segmentCount
  * sum(employee in Employees, mission in Missions)(recentTurnsOnMission[employee, mission]);
var 0..missionRepeatCeiling: missionRepeatCost :: add_to_output =
  sum(employee in Employees, mission in Missions)(
    recentTurnsOnMission[employee, mission] * turnsOnMission[employee, mission]);

% Level 14: not the same person at the same night hour every night. Standing a
% night segment costs the number of turns the log shows that person beginning
% at that hour of the day, so the 01:00 post moves around.
int: nightHourRepeatCeiling = segmentCount
  * sum(employee in Employees, hour in Hours)(recentHourHolds[employee, hour]);
var 0..nightHourRepeatCeiling: nightHourRepeatCost :: add_to_output =
  sum(employee in Employees, segment in Segments where nightOfSegment[segment] > 0)(
    recentHourHolds[employee, hourOfSegment[segment]] * isOnDuty[employee, segment]);

% ---- the ladder -----------------------------------------------------------
array[Levels] of var int: objectives = [
  unmetQualificationMinutes,      % 1  coverage
  unfilledSeatMinutes,            % 2  coverage
  slotHandoverCount,              % 3  a slot is stood whole
  restShortfallMinutes,           % 4  the configured minimum
  targetRestShortfallMinutes,     % 5  eight hours off in total, everyone
  nightsWithoutTargetSleep,       % 6  eight hours in one stretch, for as many as possible
  longRunCount,                   % 7  nobody stands six hours if anyone is free
  cooldownBreachCount,            % 8  kitchen once per rotation
  waitDeficitMinutes,             % 9  the longest wait (round robin)
  turnSpread,                     % 10 turns shared out
  sharedRoleCount,                % 11 distinct people for distinct roles
  nightDutySpreadMinutes,         % 12 night duty evened out over the memory
  missionRepeatCost,              % 13 rotate people across missions
  nightHourRepeatCost             % 14 not the same night hour every night
];

constraint forall(level in Levels where objectiveCap[level] >= 0)(
  objectives[level] <= objectiveCap[level]);

var int: echoedModelVersion :: add_to_output = MODEL_VERSION;
