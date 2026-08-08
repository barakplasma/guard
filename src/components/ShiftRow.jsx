import { Box, Chip, IconButton, MenuItem, Select, Tooltip } from '@mui/material';
import PushPinIcon from '@mui/icons-material/PushPin';
import CloseIcon from '@mui/icons-material/Close';
import { t } from '../strings.js';

/**
 * One person in one shift, rendered as a dropdown so swapping who covers a role
 * is a single click.
 *
 * Choosing someone else writes a pin over this exact range rather than editing
 * the generated output - so the displaced person is freed and automatically
 * rescheduled elsewhere by the fairness pass, and the edit survives sharing.
 *
 * Layout note: the wrapping here uses `gap`, never MUI's margin-based
 * `spacing`. Margin spacing on a wrapping row offsets the items that fall to
 * the second line, which is what made the pin badge and its clear button
 * overlap the row underneath on a phone.
 */
export default function ShiftRow({ shift, employees, busyElsewhere, onSwap, onClearPin }) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 0.5,
        rowGap: 0.5,
        maxWidth: '100%',
        minWidth: 0,
        py: 0.25,
        ...(shift.pinned && {
          borderInlineStart: '3px solid', borderColor: 'primary.main', pl: 1,
        }),
      }}
    >
      <Select
        value={shift.employeeId}
        onChange={(e) => onSwap(e.target.value)}
        size="small"
        sx={{ minWidth: { xs: 128, sm: 150 }, maxWidth: '100%' }}
        data-testid={`shift-select-${shift.missionId}-${shift.start}-${shift.employeeId}`}
      >
        {employees.map((e) => {
          const unavailable = (e.start ?? -Infinity) > shift.start || (e.end ?? Infinity) < shift.end;
          const taken = busyElsewhere.has(e.id) && e.id !== shift.employeeId;
          return (
            <MenuItem key={e.id} value={e.id} disabled={unavailable}>
              {e.name}
              {unavailable ? ` — ${t.unavailable}` : taken ? ` — ${t.onDuty}` : ''}
            </MenuItem>
          );
        })}
      </Select>

      {shift.pinned && (
        // Badge and its clear button stay one unit so they never wrap apart.
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
          <Tooltip title={t.pinned}>
            <Chip
              size="small"
              icon={<PushPinIcon fontSize="small" />}
              label={t.pinned}
              color="primary"
              variant="outlined"
              sx={{ maxWidth: '100%' }}
              data-testid={`pinned-${shift.missionId}-${shift.start}`}
            />
          </Tooltip>
          <IconButton
            size="small"
            aria-label={t.clearPin}
            onClick={onClearPin}
            sx={{ p: 0.5 }}
            data-testid={`clear-pin-${shift.missionId}-${shift.start}`}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}
