import { useEffect, useMemo, useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton,
  ListItemText, TextField, Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { nameKey } from '../lib/employees.js';
import { formatRange } from '../lib/format.js';
import { t } from '../strings.js';

/**
 * The roster picker for one shift, as a full-width list inside a dialog.
 *
 * It replaced an inline dropdown for one reason: the control sat in a column a
 * few characters wide, so every name longer than "זוהר" arrived on screen as
 * "ש..." - a rota nobody can read. A dialog owns the whole screen width, which
 * is the only place a Hebrew full name reliably fits, and it lets each row
 * carry its availability note beside the name instead of hiding it behind a
 * dropdown nobody opens.
 *
 * The search box is deliberately *not* auto-focused: on a phone that raises the
 * keyboard over the very list the reader came to read. Typing is the fallback
 * for a large roster, not the primary route.
 */
export default function AssignDialog({
  open, shift, employees, busyElsewhere, onSelect, onClose,
}) {
  const [query, setQuery] = useState('');
  // Each opening starts from the whole roster - a filter left over from the
  // last shift would hide most of it with no visible cause.
  useEffect(() => { if (open) setQuery(''); }, [open]);

  const rows = useMemo(() => {
    const needle = nameKey(query);
    return employees
      .map((employee) => ({
        employee,
        // Same eligibility the engine applies: someone whose availability
        // does not cover this slot cannot be given it by hand either.
        unavailable: (employee.start ?? -Infinity) > shift.start
          || (employee.end ?? Infinity) < shift.end,
        taken: busyElsewhere.has(employee.id) && employee.id !== shift.employeeId,
      }))
      .filter(({ employee }) => !needle || nameKey(employee.name).includes(needle));
  }, [employees, query, shift.start, shift.end, shift.employeeId, busyElsewhere]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" scroll="paper">
      <DialogTitle sx={{ pb: 1 }}>
        <Typography component="div" variant="subtitle1" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
          {shift.missionName || '—'}
        </Typography>
        <Typography component="div" variant="body2" color="text.secondary">
          {formatRange(shift.start, shift.end)}
        </Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ px: 1.5 }}>
        <TextField
          fullWidth
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          label={t.replaceEmployee}
          sx={{ mb: 1 }}
          slotProps={{ htmlInput: { 'data-testid': 'assign-search', autoComplete: 'off' } }}
        />
        {rows.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            {t.noMatchingEmployees}
          </Typography>
        )}
        <List role="listbox" aria-label={t.replaceEmployee} disablePadding>
          {rows.map(({ employee, unavailable, taken }) => {
            const selected = employee.id === shift.employeeId;
            return (
              <ListItemButton
                key={employee.id}
                role="option"
                aria-selected={selected}
                selected={selected}
                disabled={unavailable}
                onClick={() => onSelect(employee.id)}
                data-testid={`assign-option-${employee.id}`}
                sx={{ borderRadius: 1, alignItems: 'flex-start', gap: 1 }}
              >
                <ListItemText
                  primary={employee.name}
                  secondary={unavailable ? t.unavailable : taken ? t.onDuty : null}
                  slotProps={{
                    // The whole point of the dialog: the name wraps to as many
                    // lines as it needs instead of being cut to one letter.
                    primary: { sx: { overflowWrap: 'anywhere' }, fontWeight: selected ? 700 : 400 },
                    secondary: { variant: 'caption' },
                  }}
                />
                {selected && <CheckIcon fontSize="small" color="primary" sx={{ mt: 0.5 }} />}
              </ListItemButton>
            );
          })}
        </List>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} data-testid="assign-cancel">{t.cancel}</Button>
      </DialogActions>
    </Dialog>
  );
}
