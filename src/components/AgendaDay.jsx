import {
  Box, Chip, Divider, Paper, Stack, Typography,
} from '@mui/material';
import ShiftRow from './ShiftRow.jsx';
import { dayKey, formatDay, formatRange } from '../lib/format.js';
import { offDutyDuring, slotContainsInstant } from '../lib/agenda.js';
import { t } from '../strings.js';

/** One calendar day of the agenda: its time slots, and who is on/off duty in each. */
export default function AgendaDay({
  day, result, employees, now, nowSlotKey, onSwap, onClearPin,
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

      <Stack divider={<Divider flexItem />} spacing={1.5}>
        {day.slots.map((slot) => {
          // Everyone on duty anywhere in this slot - so the dropdown can mark
          // people who are already taken.
          const busy = new Set(
            result.shifts
              .filter((s) => s.start < slot.end && s.end > slot.start)
              .map((s) => s.employeeId),
          );
          const free = offDutyDuring(result, slot.start, slot.end).map(nameOf);
          const isNow = slotContainsInstant(slot, now);
          // Only the single canonical "now" slot (picked in SchedulePage via
          // findNowSlot) gets this id - a long-running mission and the current
          // hour of a rotating one can both be "now" at once, and duplicate
          // ids would make the jump-to-now button's getElementById() pick
          // whichever happens to come first in the DOM, not the current shift.
          const isNowAnchor = nowSlotKey != null && `${slot.start}|${slot.end}` === nowSlotKey;

          return (
            <Box
              key={`${slot.start}-${slot.end}`}
              id={isNowAnchor ? 'now-slot' : undefined}
              data-testid={`slot-${slot.start}`}
              sx={isNow ? {
                borderInlineStart: '4px solid',
                borderColor: 'primary.main',
                bgcolor: 'action.hover',
                pl: 1,
              } : undefined}
            >
              <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: 'center' }}>
                <Typography variant="body2" fontWeight={700}>
                  {formatRange(slot.start, slot.end)}
                </Typography>
                {isNow && <Chip size="small" label={t.now} color="primary" />}
              </Stack>

              <Stack spacing={1}>
                {slot.missions.map((mission) => (
                  <Stack
                    key={mission.missionId}
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    sx={{ alignItems: { xs: 'flex-start', sm: 'center' } }}
                  >
                    <Chip
                      size="small"
                      label={mission.missionName || '—'}
                      color={mission.type === 'remote' ? 'secondary' : 'default'}
                      sx={{ minWidth: 110 }}
                    />
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
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
                  </Stack>
                ))}
              </Stack>

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {`${t.offDuty}: ${free.length ? free.join(', ') : t.nobody}`}
              </Typography>
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}
