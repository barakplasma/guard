import { useMemo } from 'react';
import {
  Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import ShiftRow from './ShiftRow.jsx';
import { dayKey, formatDay, formatRange } from '../lib/format.js';
import { offDutyDuring, slotContainsInstant } from '../lib/agenda.js';
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
  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}
    >
      {mission.entries.map((shift) => (
        <ShiftRow
          key={`${shift.missionId}-${shift.employeeId}-${shift.start}`}
          shift={shift}
          employees={employees}
          busyElsewhere={busy}
          onSwap={(employeeId) => onSwap(shift, employeeId)}
          onClearPin={() => onClearPin(shift)}
        />
      ))}
    </Stack>
  );
}

/**
 * Phone layout: one card per slot instead of a table. Four columns of times,
 * names and dropdowns cannot share a 360px screen without either overflowing
 * into each other or being squeezed until nothing is readable.
 */
function SlotCard({ info, employees, includeOffDuty, onSwap, onClearPin }) {
  const { slot, busy, free, isNow, isNowAnchor } = info;

  return (
    <Paper
      variant="outlined"
      id={isNowAnchor ? 'now-slot' : undefined}
      data-testid={`slot-${slot.start}`}
      sx={{
        p: 1.5,
        ...(isNow && {
          bgcolor: 'action.hover',
          borderInlineStartWidth: 4,
          borderInlineStartStyle: 'solid',
          // Resolved from the theme by hand: sx only palette-maps `borderColor`,
          // so a token here would be emitted as an invalid CSS colour and dropped.
          borderInlineStartColor: (theme) => theme.palette.primary.main,
        }),
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}
      >
        <Typography variant="subtitle2" fontWeight={700}>
          {formatRange(slot.start, slot.end)}
        </Typography>
        {isNow && <Chip size="small" label={t.now} color="primary" />}
      </Stack>

      {slot.missions.map((mission, index) => (
        <Box key={mission.missionId} sx={{ mt: index === 0 ? 0 : 1.5 }}>
          <MissionChip mission={mission} />
          <Box sx={{ mt: 0.75 }}>
            <Assignments
              mission={mission}
              employees={employees}
              busy={busy}
              onSwap={onSwap}
              onClearPin={onClearPin}
            />
          </Box>
        </Box>
      ))}

      {includeOffDuty && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary" component="div">
            {t.offDuty}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid={`off-duty-${slot.start}`}
            sx={{ overflowWrap: 'anywhere' }}
          >
            {free.length ? free.join(', ') : t.nobody}
          </Typography>
        </Box>
      )}
    </Paper>
  );
}

/** Tablet and up: the real table, scrolling sideways rather than squeezing. */
function SlotTable({ slots, employees, includeOffDuty, onSwap, onClearPin }) {
  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: includeOffDuty ? 680 : 540 }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{t.shiftTime}</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{t.missionName}</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{t.onDuty}</TableCell>
            {includeOffDuty && <TableCell sx={{ whiteSpace: 'nowrap' }}>{t.offDuty}</TableCell>}
          </TableRow>
        </TableHead>
        {slots.map((info) => {
          const { slot, busy, free, isNow, isNowAnchor } = info;
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
                    <Assignments
                      mission={mission}
                      employees={employees}
                      busy={busy}
                      onSwap={onSwap}
                      onClearPin={onClearPin}
                    />
                  </TableCell>
                  {includeOffDuty && index === 0 && (
                    <TableCell
                      rowSpan={slot.missions.length}
                      data-testid={`off-duty-${slot.start}`}
                      sx={{ color: 'text.secondary', verticalAlign: 'top' }}
                    >
                      {free.length ? free.join(', ') : t.nobody}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          );
        })}
      </Table>
    </TableContainer>
  );
}

/** One calendar day of the agenda: its time slots, and who is on/off duty in each. */
export default function AgendaDay({
  day, result, employees, now, nowSlotKey, includeOffDuty, onSwap, onClearPin,
}) {
  const theme = useTheme();
  // Only one of the two layouts is mounted, so the test ids stay unique.
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const isToday = now != null && dayKey(now) === day.day;

  const slots = useMemo(() => {
    const nameOf = (id) => employees.find((e) => e.id === id)?.name ?? id;
    return day.slots.map((slot) => ({
      slot,
      // Everyone on duty anywhere in this slot - so the dropdown can mark
      // people who are already taken.
      busy: new Set(
        result.shifts
          .filter((s) => s.start < slot.end && s.end > slot.start)
          .map((s) => s.employeeId),
      ),
      free: includeOffDuty ? offDutyDuring(result, slot.start, slot.end).map(nameOf) : [],
      isNow: slotContainsInstant(slot, now),
      // Only the single canonical "now" slot (picked in SchedulePage via
      // findNowSlot) gets this id - a long-running mission and the current
      // hour of a rotating one can both be "now" at once, and duplicate
      // ids would make the jump-to-now button's getElementById() pick
      // whichever happens to come first in the DOM, not the current shift.
      isNowAnchor: nowSlotKey != null && `${slot.start}|${slot.end}` === nowSlotKey,
    }));
  }, [day.slots, result, employees, includeOffDuty, now, nowSlotKey]);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 2 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" fontWeight={700}>
          {formatDay(day.day)}
        </Typography>
        {isToday && <Chip size="small" label={t.today} color="primary" variant="outlined" />}
      </Stack>

      {compact ? (
        <Stack spacing={1.5}>
          {slots.map((info) => (
            <SlotCard
              key={`${info.slot.start}-${info.slot.end}`}
              info={info}
              employees={employees}
              includeOffDuty={includeOffDuty}
              onSwap={onSwap}
              onClearPin={onClearPin}
            />
          ))}
        </Stack>
      ) : (
        <SlotTable
          slots={slots}
          employees={employees}
          includeOffDuty={includeOffDuty}
          onSwap={onSwap}
          onClearPin={onClearPin}
        />
      )}
    </Paper>
  );
}
