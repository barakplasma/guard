import { Autocomplete, Box, Chip, IconButton, TextField, Tooltip } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import HistoryIcon from '@mui/icons-material/History';
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
        // Always the full row width on a phone: a two-column packing (each
        // person given only a ~6rem share) reads fine for a two-person
        // mission, but a mission with a large headcount turns into a wall of
        // cramped, hard-to-read dropdowns. One assignment per line costs more
        // vertical space but stays legible regardless of headcount. On a wide
        // screen the column is roomy already, and a name-wide control beats a
        // stretched one.
        flex: { xs: '1 1 100%', sm: '0 0 auto' },
        maxWidth: '100%',
        minWidth: 0,
        ...(shift.pinned && {
          borderInlineStart: '3px solid', borderColor: 'primary.main', pl: 0.75,
        }),
      }}
    >
      <Autocomplete
        disableClearable
        value={employees.find((e) => e.id === shift.employeeId) ?? null}
        options={employees}
        getOptionLabel={(e) => e.name}
          getOptionKey={(e) => e.id}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        getOptionDisabled={(e) => (e.start ?? -Infinity) > shift.start || (e.end ?? Infinity) < shift.end}
        noOptionsText={t.noMatchingEmployees}
        onChange={(_, employee) => employee && onSwap(employee.id)}
        size="small"
        sx={{ flex: '1 1 auto', minWidth: { xs: 0, sm: 180 }, maxWidth: '100%' }}
        renderOption={({ key, ...props }, employee) => {
          const unavailable = (employee.start ?? -Infinity) > shift.start || (employee.end ?? Infinity) < shift.end;
          const taken = busyElsewhere.has(employee.id) && employee.id !== shift.employeeId;
          return <li key={key} {...props}>{employee.name}{unavailable ? ` — ${t.unavailable}` : taken ? ` — ${t.onDuty}` : ''}</li>;
        }}
        renderInput={(params) => <TextField {...params}
          slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput,
            'aria-label': t.replaceEmployee,
            'data-testid': `shift-select-${shift.missionId}-${shift.start}-${shift.employeeId}` } }} />} />

      {shift.pinned && (
        // Badge and its clear button stay one unit so they never wrap apart.
        // Icon-only: a lock means a person chose this assignment by hand and
        // it always wins over scheduling, a history icon means the engine
        // preserved an already-elapsed assignment - the two kinds of lock
        // must never read as the same thing, so each carries its own icon,
        // accessible label, and release-button label.
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
          <Tooltip title={shift.frozen ? t.frozenHistory : t.pinnedLocked}>
            <Chip
              size="small"
              icon={shift.frozen
                ? <HistoryIcon fontSize="small" data-testid="HistoryIcon" />
                : <LockIcon fontSize="small" data-testid="LockIcon" />}
              label=""
              color="primary"
              variant="outlined"
              aria-label={shift.frozen ? t.frozenHistory : t.pinnedLocked}
              sx={{
                maxWidth: '100%',
                // The icon's built-in margin assumes a label follows it; with
                // the label hidden that leaves lopsided padding on one side.
                '& .MuiChip-label': { display: 'none' },
                '& .MuiChip-icon': { m: 0 },
                px: 0.75,
              }}
              data-testid={`pinned-${shift.missionId}-${shift.start}`}
            />
          </Tooltip>
          <IconButton
            size="small"
            aria-label={shift.frozen ? t.releaseFrozen : t.clearPin}
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
