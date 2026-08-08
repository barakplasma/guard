import { useMemo } from 'react';
import {
  Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import ShiftRow from './ShiftRow.jsx';
import { dayKey, formatDay, formatRange, formatRangeLines } from '../lib/format.js';
import { slotContainsInstant } from '../lib/agenda.js';
import { t } from '../strings.js';

/**
 * The mission's name. It wraps rather than ellipsising: on a phone the column
 * is narrow enough that a single-line chip truncates a Hebrew name down to one
 * letter, which tells the reader nothing about which mission this is.
 */
function MissionChip({ mission }) {
  return (
    <Chip
      size="small"
      label={mission.missionName || '—'}
      color={mission.type === 'remote' ? 'secondary' : 'default'}
      sx={{
        maxWidth: '100%',
        height: 'auto',
        py: 0.25,
        '& .MuiChip-label': {
          whiteSpace: 'normal', overflowWrap: 'anywhere', display: 'block',
        },
      }}
    />
  );
}

/** Everyone covering one mission in one slot, each swappable. */
function Assignments({ mission, employees, busy, onSwap, onClearPin }) {
  return mission.entries.map((shift) => (
    <ShiftRow
      key={`${shift.missionId}-${shift.employeeId}-${shift.start}`}
      shift={shift}
      employees={employees}
      busyElsewhere={busy}
      onSwap={(employeeId) => onSwap(shift, employeeId)}
      onClearPin={() => onClearPin(shift)}
    />
  ));
}

/**
 * Portrait layout: a time gutter with the missions beside it, so a one-mission
 * slot costs a single row instead of a card. Four table columns cannot share a
 * 360px screen - squeezing them truncated the mission name to one letter and
 * spilled the times over it - but stacking every field costs a screenful per
 * hour, which is just as unusable on a 24-hour plan.
 */
function SlotRow({ info, employees, hideMissionName, onSwap, onClearPin }) {
  const { slot, busy, isNow, isNowAnchor } = info;
  const [from, to] = formatRangeLines(slot.start, slot.end);

  return (
    <Box
      id={isNowAnchor ? 'now-slot' : undefined}
      data-testid={`slot-${slot.start}`}
      sx={{
        display: 'flex',
        gap: 1,
        py: 0.75,
        borderTop: '1px solid',
        borderColor: 'divider',
        ...(isNow && {
          bgcolor: 'action.hover',
          borderInlineStart: '3px solid',
          borderInlineStartColor: (theme) => theme.palette.primary.main,
          pl: 0.75,
        }),
      }}
    >
      <Box sx={{ flex: '0 0 4rem', pt: 0.75 }}>
        <Typography variant="caption" fontWeight={700} sx={{ display: 'block', lineHeight: 1.3 }}>
          {from}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
          {to}
        </Typography>
        {isNow && (
          <Chip size="small" label={t.now} color="primary" sx={{ mt: 0.5, height: 20 }} />
        )}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {slot.missions.map((mission, index) => (
          <Box
            key={mission.missionId}
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 0.75,
              mt: index === 0 ? 0 : 0.75,
            }}
          >
            {!hideMissionName && <MissionChip mission={mission} />}
            <Assignments
              mission={mission}
              employees={employees}
              busy={busy}
              onSwap={onSwap}
              onClearPin={onClearPin}
            />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** Tablet and up: the real table, scrolling sideways rather than squeezing. */
function SlotTable({ slots, employees, onSwap, onClearPin }) {
  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 540 }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{t.shiftTime}</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{t.missionName}</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{t.onDuty}</TableCell>
          </TableRow>
        </TableHead>
        {slots.map((info) => {
          const { slot, busy, isNow, isNowAnchor } = info;
          return (
            <TableBody
              key={`${slot.start}-${slot.end}`}
              id={isNowAnchor ? 'now-slot' : undefined}
              data-testid={`slot-${slot.start}`}
              sx={isNow ? {
                '& > tr': { bgcolor: 'action.hover' },
                '& > tr > td:first-of-type': {
                  borderInlineStart: '4px solid', borderColor: 'primary.main',
                },
              } : undefined}
            >
              {slot.missions.map((mission, index) => (
                <TableRow key={mission.missionId}>
                  {index === 0 && (
                    <TableCell rowSpan={slot.missions.length} sx={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      <Stack
                        direction="row"
                        spacing={0.5}
                        useFlexGap
                        sx={{ alignItems: 'center' }}
                      >
                        <Typography variant="body2" fontWeight={700}>
                          {formatRange(slot.start, slot.end)}
                        </Typography>
                        {isNow && <Chip size="small" label={t.now} color="primary" />}
                      </Stack>
                    </TableCell>
                  )}
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    <MissionChip mission={mission} />
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                      <Assignments
                        mission={mission}
                        employees={employees}
                        busy={busy}
                        onSwap={onSwap}
                        onClearPin={onClearPin}
                      />
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          );
        })}
      </Table>
    </TableContainer>
  );
}

/** One calendar day of the agenda: its time slots, and who is on duty in each. */
export default function AgendaDay({
  day, result, employees, now, nowSlotKey, onSwap, onClearPin,
}) {
  const theme = useTheme();
  // Only one of the two layouts is mounted, so the test ids stay unique.
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const isToday = now != null && dayKey(now) === day.day;

  const slots = useMemo(() => day.slots.map((slot) => ({
    slot,
    // Everyone on duty anywhere in this slot - so the dropdown can mark
    // people who are already taken.
    busy: new Set(
      result.shifts
        .filter((s) => s.start < slot.end && s.end > slot.start)
        .map((s) => s.employeeId),
    ),
    isNow: slotContainsInstant(slot, now),
    // Only the single canonical "now" slot (picked in SchedulePage via
    // findNowSlot) gets this id - a long-running mission and the current
    // hour of a rotating one can both be "now" at once, and duplicate
    // ids would make the jump-to-now button's getElementById() pick
    // whichever happens to come first in the DOM, not the current shift.
    isNowAnchor: nowSlotKey != null && `${slot.start}|${slot.end}` === nowSlotKey,
  })), [day.slots, result, now, nowSlotKey]);

  // A day with a single mission repeats its name on every row for no
  // information. In portrait it moves to the day header instead, which turns
  // the common one-mission plan into one line per shift.
  const soleMission = useMemo(() => {
    const seen = new Map();
    for (const slot of day.slots) for (const m of slot.missions) seen.set(m.missionId, m);
    return seen.size === 1 ? [...seen.values()][0] : null;
  }, [day.slots]);
  const headerMission = compact ? soleMission : null;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mb: { xs: 1, sm: 2 } }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" fontWeight={700}>
          {formatDay(day.day)}
        </Typography>
        {isToday && <Chip size="small" label={t.today} color="primary" variant="outlined" />}
        {headerMission && <MissionChip mission={headerMission} />}
      </Stack>

      {compact ? (
        slots.map((info) => (
          <SlotRow
            key={`${info.slot.start}-${info.slot.end}`}
            info={info}
            employees={employees}
            hideMissionName={headerMission != null}
            onSwap={onSwap}
            onClearPin={onClearPin}
          />
        ))
      ) : (
        <SlotTable
          slots={slots}
          employees={employees}
          onSwap={onSwap}
          onClearPin={onClearPin}
        />
      )}
    </Paper>
  );
}
