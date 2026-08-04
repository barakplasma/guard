import {
  Box, Chip, Divider, Paper, Stack, Typography,
} from '@mui/material';
import ShiftRow from './ShiftRow.jsx';
import { formatDay, formatRange } from '../lib/format.js';
import { offDutyDuring } from '../lib/agenda.js';
import { t } from '../strings.js';

/** One calendar day of the agenda: its time slots, and who is on/off duty in each. */
export default function AgendaDay({ day, result, employees, onSwap, onClearPin }) {
  const nameOf = (id) => employees.find((e) => e.id === id)?.name ?? id;

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
        {formatDay(day.day)}
      </Typography>

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

          return (
            <Box key={`${slot.start}-${slot.end}`} data-testid={`slot-${slot.start}`}>
              <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>
                {formatRange(slot.start, slot.end)}
              </Typography>

              <Stack spacing={1}>
                {slot.missions.map((mission) => (
                  <Stack
                    key={mission.missionId}
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ sm: 'center' }}
                  >
                    <Chip
                      size="small"
                      label={mission.missionName || '—'}
                      color={mission.type === 'remote' ? 'secondary' : 'default'}
                      sx={{ minWidth: 110 }}
                    />
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
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
