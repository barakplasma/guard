import {
  Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Typography,
} from '@mui/material';
import ShiftRow from './ShiftRow.jsx';
import { dayKey, formatDay, formatRange } from '../lib/format.js';
import { offDutyDuring, slotContainsInstant } from '../lib/agenda.js';
import { t } from '../strings.js';

/** One calendar day of the agenda: its time slots, and who is on/off duty in each. */
export default function AgendaDay({
  day, result, employees, now, nowSlotKey, includeOffDuty, onSwap, onClearPin,
}) {
  const nameOf = (id) => employees.find((e) => e.id === id)?.name ?? id;
  const isToday = now != null && dayKey(now) === day.day;

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
        <Typography variant="subtitle1" fontWeight={700}>
          {formatDay(day.day)}
        </Typography>
        {isToday && <Chip size="small" label={t.today} color="primary" variant="outlined" />}
      </Stack>

      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: includeOffDuty ? 680 : 540 }}>
          <TableHead>
            <TableRow>
              <TableCell>{t.shiftTime}</TableCell>
              <TableCell>{t.missionName}</TableCell>
              <TableCell>{t.onDuty}</TableCell>
              {includeOffDuty && <TableCell>{t.offDuty}</TableCell>}
            </TableRow>
          </TableHead>
        {day.slots.map((slot) => {
          // Everyone on duty anywhere in this slot - so the dropdown can mark
          // people who are already taken.
          const busy = new Set(
            result.shifts
              .filter((s) => s.start < slot.end && s.end > slot.start)
              .map((s) => s.employeeId),
          );
          const free = includeOffDuty
            ? offDutyDuring(result, slot.start, slot.end).map(nameOf)
            : [];
          const isNow = slotContainsInstant(slot, now);
          // Only the single canonical "now" slot (picked in SchedulePage via
          // findNowSlot) gets this id - a long-running mission and the current
          // hour of a rotating one can both be "now" at once, and duplicate
          // ids would make the jump-to-now button's getElementById() pick
          // whichever happens to come first in the DOM, not the current shift.
          const isNowAnchor = nowSlotKey != null && `${slot.start}|${slot.end}` === nowSlotKey;

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
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant="body2" fontWeight={700}>
                          {formatRange(slot.start, slot.end)}
                        </Typography>
                        {isNow && <Chip size="small" label={t.now} color="primary" />}
                      </Stack>
                    </TableCell>
                  )}
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    <Chip
                      size="small"
                      label={mission.missionName || '—'}
                      color={mission.type === 'remote' ? 'secondary' : 'default'}
                      sx={{ minWidth: 110 }}
                    />
                  </TableCell>
                  <TableCell>
                    <Stack
                      direction="row"
                      spacing={1}
                      useFlexGap
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
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
    </Paper>
  );
}
