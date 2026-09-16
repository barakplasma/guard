/**
 * An accepted schedule, read as the result shape the app already renders.
 *
 * Keeping `shifts`, `timeline`, `stats`, `warnings`, `rest` and `proposals`
 * means the schedule page, the agenda, the exports and the findings panel
 * change only where they are told something genuinely new. Nothing here
 * decides legality: every judgement has already been made by the model and
 * recomputed by check mode, and these functions only *read* that answer.
 */

import { normalizedInput, segmentGrid } from '../lib/planner.js'
import { toPlannerInput } from '../lib/planSchema.js'
import { proposeCorrections } from '../lib/corrections.js'
import {
  availabilityMatrix, enumerateSleepWindows, nightOfSegment, requirementTables, seatsWantedMatrix
} from './compile.ts'
import type { AcceptedSchedule, InstanceIndex, Interval, PreparedProblem } from './types.ts'

const MINUTE = 60_000

// oxlint-disable-next-line no-explicit-any
type Draft = any

export interface ShiftRow {
  missionId: string
  missionName: string
  type: 'local' | 'remote' | 'daily'
  employeeId: string
  employeeName: string
  start: number
  end: number
  slotStart: number
  slotEnd: number
  pinned: boolean
  frozen: boolean
}

interface Names {
  employee: Map<string, string>
  mission: Map<string, { name: string, type: 'local' | 'remote' | 'daily' }>
}

function namesOf (draft: Draft): Names {
  return {
    employee: new Map(draft.employees.map((e: Draft) => [e.id, e.name])),
    mission: new Map(draft.missions.map((m: Draft) => [m.id, { name: m.name, type: m.type }]))
  }
}

/**
 * One row per (employee, mission, run of consecutive segments in one slot or
 * hold).
 *
 * Adjacent segments are joined *within* a slot and never across one - the rule
 * `mergeRows` follows in `planner.js`, and for the reason CLAUDE.md records:
 * welding consecutive shifts together turned a guard held over eleven slots
 * into one 88-hour row. Rows carry `slotStart`/`slotEnd` from the index, which
 * is the grid's slot, not the row's own extent.
 */
export function candidateRows (
  accepted: AcceptedSchedule,
  index: InstanceIndex,
  problem: PreparedProblem,
  draft: Draft,
  options: { merge?: boolean } = {}
): ShiftRow[] {
  const merge = options.merge ?? true
  const names = namesOf(draft)
  const segmentCount = index.segments.length
  const committed = commitmentLookup(problem, index)
  const rows: ShiftRow[] = []

  index.employeeIds.forEach((employeeId, employeeIndex) => {
    let open: ShiftRow | null = null
    let openSlot = 0
    for (let segment = 0; segment < segmentCount; segment++) {
      const missionCode = accepted.assignment[employeeIndex * segmentCount + segment]
      if (missionCode === 0) { open = null; openSlot = 0; continue }
      const missionIndex = missionCode - 1
      const missionId = index.missionIds[missionIndex]
      const slot = index.slotOfSegment[missionIndex][segment]
      const bounds = index.slotBoundsById.get(slot) ?? index.segments[segment]
      const here = index.segments[segment]
      const key = `${employeeId}|${missionId}|${segment}`
      const pinned = committed.pinned.has(key)
      const frozen = committed.frozen.has(key)

      const continues = merge && open !== null &&
        open.missionId === missionId &&
        openSlot === slot &&
        open.end === here.start &&
        open.pinned === pinned &&
        open.frozen === frozen
      if (continues && (open != null)) {
        open.end = here.end
        continue
      }
      const missionMeta: { name: string, type: ShiftRow['type'] } =
        names.mission.get(missionId) ?? { name: missionId, type: 'local' }
      open = {
        missionId,
        missionName: missionMeta.name,
        type: missionMeta.type,
        employeeId,
        employeeName: names.employee.get(employeeId) ?? employeeId,
        start: here.start,
        end: here.end,
        slotStart: bounds.start,
        slotEnd: bounds.end,
        pinned,
        frozen
      }
      openSlot = slot
      rows.push(open)
    }
  })

  return rows.sort((a, b) => a.start - b.start || a.end - b.end ||
    (a.missionId < b.missionId ? -1 : a.missionId > b.missionId ? 1 : 0) ||
    (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0))
}

/** Which cells a commitment covers, and which of those are machine records. */
function commitmentLookup (problem: PreparedProblem, index: InstanceIndex) {
  const pinned = new Set<string>()
  const frozen = new Set<string>()
  for (const commitment of problem.commitments) {
    index.segments.forEach((segment, segmentIndex) => {
      if (!(segment.start < commitment.coverage.end && commitment.coverage.start < segment.end)) return
      const key = `${commitment.employeeId}|${commitment.missionId}|${segmentIndex}`
      pinned.add(key)
      if (commitment.provenance === 'logged') frozen.add(key)
    })
  }
  return { pinned, frozen }
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export interface TimelineSegment {
  start: number
  end: number
  onDuty: Array<{ employeeId: string, missionId: string }>
  offDuty: string[]
  unavailable: string[]
}

export function timelineFrom (
  accepted: AcceptedSchedule,
  index: InstanceIndex,
  problem: PreparedProblem
): TimelineSegment[] {
  const isAvailable = availabilityMatrix(problem, index.segments)
  const segmentCount = index.segments.length
  return index.segments.map((segment, segmentIndex) => {
    const onDuty: Array<{ employeeId: string, missionId: string }> = []
    const offDuty: string[] = []
    const unavailable: string[] = []
    index.employeeIds.forEach((employeeId, employeeIndex) => {
      const missionCode = accepted.assignment[employeeIndex * segmentCount + segmentIndex]
      if (missionCode > 0) onDuty.push({ employeeId, missionId: index.missionIds[missionCode - 1] })
      else if (isAvailable[employeeIndex][segmentIndex]) offDuty.push(employeeId)
      else unavailable.push(employeeId)
    })
    return { start: segment.start, end: segment.end, onDuty, offDuty, unavailable }
  })
}

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */

/** Consecutive segments carrying the same shortfall, merged into one window. */
function mergeWindows (
  segments: readonly Interval[],
  hit: (segmentIndex: number) => number | null
): Array<{ start: number, end: number, got: number }> {
  const windows: Array<{ start: number, end: number, got: number }> = []
  segments.forEach((segment, segmentIndex) => {
    const got = hit(segmentIndex)
    if (got == null) return
    const last = windows[windows.length - 1]
    if (last && last.end === segment.start && last.got === got) last.end = segment.end
    else windows.push({ start: segment.start, end: segment.end, got })
  })
  return windows
}

/**
 * The findings panel's list, as a reading of the model's own diagnostics.
 *
 * Elapsed segments are exempt from the two coverage findings, exactly as they
 * are today (ADR 009): the engine no longer staffs that time, so an alert
 * there is one nobody can act on arriving on every render.
 */
export function warningsFrom (
  accepted: AcceptedSchedule,
  index: InstanceIndex,
  problem: PreparedProblem
): object[] {
  const warnings: object[] = [...problem.issues]
  const seatsWanted = seatsWantedMatrix(problem, index.segments)
  const requirements = requirementTables(problem)
  const elapsed = (segmentIndex: number) => index.segments[segmentIndex].end <= problem.loggedBefore

  index.missionIds.forEach((missionId, missionIndex) => {
    for (const window of mergeWindows(index.segments, (segmentIndex) => {
      if (elapsed(segmentIndex)) return null
      const wanted = seatsWanted[missionIndex][segmentIndex]
      const filled = accepted.diagnostics.seatsFilled[missionIndex][segmentIndex]
      return filled < wanted ? filled : null
    })) {
      warnings.push({
        code: 'understaffed',
        missionId,
        start: window.start,
        end: window.end,
        needed: seatsWanted[missionIndex][index.segments.findIndex((s) => s.start === window.start)],
        got: window.got
      })
    }
  })

  requirements.requirementMission.forEach((missionOneBased, requirementIndex) => {
    const missionIndex = missionOneBased - 1
    const mission = problem.missions[missionIndex]
    const seats = requirements.requirementSeats[requirementIndex]
    // Requirements are emitted in mission order, one per `requires` entry, so
    // this walks back to the tag that produced this row.
    const before = requirements.requirementMission
      .slice(0, requirementIndex)
      .filter((m) => m === missionOneBased).length
    const tag = mission.requires[before]?.tag
    const windows = mergeWindows(index.segments, (segmentIndex) => {
      if (elapsed(segmentIndex) || seatsWanted[missionIndex][segmentIndex] === 0) return null
      const got = accepted.diagnostics.qualifiedSeatsFilled[requirementIndex][segmentIndex]
      return got < seats ? got : null
    })
    if (windows.length > 0) {
      warnings.push({
        code: 'missing-required-tag', missionId: mission.id, tag, needed: seats, windows
      })
    }
  })

  const nights = nightOfSegment(problem, index.segments)
  const isAvailable = availabilityMatrix(problem, index.segments)
  const sleepWindows = enumerateSleepWindows(index.segments, nights)

  problem.employees.forEach((employee, employeeIndex) => {
    if (accepted.diagnostics.longRunsByEmployee[employeeIndex] > 0) {
      warnings.push({
        code: 'long-unbroken-run',
        employeeId: employee.id,
        count: accepted.diagnostics.longRunsByEmployee[employeeIndex]
      })
    }
    index.nights.forEach((night, nightIndex) => {
      const got = accepted.diagnostics.nightRestMinutes[employeeIndex][nightIndex]
      if (employee.requiredNightRestMinutes > 0 && got < employee.requiredNightRestMinutes) {
        warnings.push({
          code: 'rest-unsatisfied',
          employeeId: employee.id,
          start: night.start,
          end: night.end,
          needed: employee.requiredNightRestMinutes,
          got
        })
      }
      // The eight-hour target, reported only where it was reachable: a night
      // the person is not present for eight hours of is not held against the
      // schedule, and neither is one nobody could have slept through.
      const canSleep = sleepWindows.first.some((first, windowIndex) => {
        if (sleepWindows.night[windowIndex] !== nightIndex + 1) return false
        for (let s = first - 1; s < sleepWindows.last[windowIndex]; s++) {
          if (!isAvailable[employeeIndex][s]) return false
        }
        return true
      })
      if (canSleep && !accepted.diagnostics.sleepsTarget[employeeIndex][nightIndex]) {
        warnings.push({
          code: 'target-sleep-missed', employeeId: employee.id, start: night.start, end: night.end
        })
      }
    })
  })

  return warnings
}

/* ------------------------------------------------------------------ */
/* Rest and stats                                                      */
/* ------------------------------------------------------------------ */

export interface RestMetric {
  employeeId: string
  start: number
  end: number
  needed: number
  totalMinutes: number
  longestMinutes: number
  sleptTarget: boolean
}

/**
 * The model answers the yes/no; the continuous figure beside it is measured
 * here, over the accepted rows, because it is a presentation number rather
 * than something the ladder optimises.
 */
export function restMetricsFrom (
  accepted: AcceptedSchedule,
  index: InstanceIndex,
  problem: PreparedProblem,
  rows: readonly ShiftRow[]
): RestMetric[] {
  const sleepable = new Set(problem.missions.filter((m) => m.onCall).map((m) => m.id as string))
  const out: RestMetric[] = []
  problem.employees.forEach((employee, employeeIndex) => {
    index.nights.forEach((night, nightIndex) => {
      const lo = Math.max(night.start, employee.available.start)
      const hi = Math.min(night.end, employee.available.end)
      if (!(hi > lo)) return
      const awake = rows
        .filter((row) => row.employeeId === employee.id && !sleepable.has(row.missionId))
        .map((row) => ({ start: Math.max(row.start, lo), end: Math.min(row.end, hi) }))
        .filter((row) => row.end > row.start)
        .sort((a, b) => a.start - b.start)
      let cursor = lo
      let longest = 0
      for (const row of awake) {
        longest = Math.max(longest, row.start - cursor)
        cursor = Math.max(cursor, row.end)
      }
      longest = Math.max(longest, hi - cursor)
      out.push({
        employeeId: employee.id,
        start: lo,
        end: hi,
        needed: employee.requiredNightRestMinutes,
        totalMinutes: accepted.diagnostics.nightRestMinutes[employeeIndex][nightIndex],
        longestMinutes: longest / MINUTE,
        sleptTarget: accepted.diagnostics.sleepsTarget[employeeIndex][nightIndex]
      })
    })
  })
  return out
}

export interface Stats {
  perEmployee: Array<{
    employeeId: string; name: string; minutes: number; stints: number
    minGapMinutes: number | null; nightMinutes?: number; carriedTurns?: number
    carriedNightMinutes?: number
  }>
  spreadMinutes: number
  shortestWaitMinutes: number
  turnSpread: number
}

/**
 * The summary table keeps showing hours, because that is what people ask
 * about. Nothing optimises them: the numbers the ladder actually settled are
 * the shortest wait and the spread of turns, and those are printed beside the
 * hours rather than derived from them.
 */
export function statsFrom (
  accepted: AcceptedSchedule,
  index: InstanceIndex,
  problem: PreparedProblem,
  draft: Draft,
  rows: readonly ShiftRow[]
): Stats {
  const names = namesOf(draft)
  const perEmployee = problem.employees.map((employee, employeeIndex) => {
    const own = rows.filter((row) => row.employeeId === employee.id).sort((a, b) => a.start - b.start)
    let minGap: number | null = null
    for (let i = 1; i < own.length; i++) {
      const gap = (own[i].start - own[i - 1].end) / MINUTE
      if (gap > 0 && (minGap == null || gap < minGap)) minGap = gap
    }
    const memory = employee.memory
    return {
      employeeId: employee.id as string,
      name: names.employee.get(employee.id) ?? employee.id,
      minutes: accepted.diagnostics.dutyMinutes[employeeIndex],
      stints: accepted.diagnostics.turnsTaken[employeeIndex],
      minGapMinutes: minGap,
      nightMinutes: accepted.diagnostics.nightMinutesInWindow[employeeIndex],
      // Written only when the log carries something, so a plan with no history
      // produces exactly the object it always produced.
      ...(memory.turns > 0 ? { carriedTurns: memory.turns } : {}),
      ...(memory.nightMinutes > 0 ? { carriedNightMinutes: memory.nightMinutes } : {})
    }
  })
  const minutes = perEmployee.map((row) => row.minutes)
  return {
    perEmployee,
    spreadMinutes: (minutes.length > 0) ? Math.max(...minutes) - Math.min(...minutes) : 0,
    shortestWaitMinutes: accepted.quantities.shortestWaitMinutes,
    turnSpread: accepted.quantities.turnSpread
  }
}

/* ------------------------------------------------------------------ */
/* The whole result                                                    */
/* ------------------------------------------------------------------ */

export interface ScheduleResult {
  shifts: ShiftRow[]
  timeline: TimelineSegment[]
  stats: Stats
  warnings: object[]
  rest: RestMetric[]
  proposals: object[]
}

export function scheduleResultFrom (
  accepted: AcceptedSchedule,
  index: InstanceIndex,
  problem: PreparedProblem,
  draft: Draft
): ScheduleResult {
  const segments = candidateRows(accepted, index, problem, draft, { merge: false })
  const shifts = candidateRows(accepted, index, problem, draft)
  return {
    shifts,
    timeline: timelineFrom(accepted, index, problem),
    stats: statsFrom(accepted, index, problem, draft, shifts),
    warnings: warningsFrom(accepted, index, problem),
    rest: restMetricsFrom(accepted, index, problem, shifts),
    // Decision C: a proposal is a suggestion a person accepts, not a legality
    // claim, so it stays where it is and keeps reading rows. Whatever is
    // accepted is then solved and checked by MiniZinc like any other edit.
    proposals: correctionProposals(segments, draft, problem)
  }
}

function correctionProposals (rows: readonly ShiftRow[], draft: Draft, problem: PreparedProblem): object[] {
  const input = toPlannerInput(draft, problem.loggedBefore)
  const normalized = normalizedInput(input)
  const grid = segmentGrid(input)
  const segmentsByMission = new Map<string, Array<{ start: number, end: number, slot: { start: number, end: number } }>>(
    grid.map((entry: Draft) => [entry.mission.id, entry.segments])
  )
  const sleepable = new Set(problem.missions.filter((m) => m.onCall).map((m) => m.id as string))
  return proposeCorrections([...rows], {
    employees: normalized.employees,
    tags: draft.tags ?? [],
    missions: normalized.missions,
    nightWindows: problem.nights.map((night) => ({ start: night.start as number, end: night.end as number })),
    start: problem.horizon.start,
    end: problem.horizon.end,
    sleepable,
    segmentsOf: (mission: Draft) => segmentsByMission.get(mission.id) ?? []
  })
}
