import { MenuItem, Select } from '@mui/material';
import { t } from '../strings.js';

/**
 * Pick one person out of the roster.
 *
 * Shared by the personal-calendar export and the schedule's per-person filter,
 * so the two read as the same control doing the same thing - which is what
 * makes "the picker from the iCal row" a usable instruction rather than a
 * coincidence of styling.
 *
 * `allLabel` adds an "everyone" entry whose value is the empty string. A caller
 * that needs a real person (an iCal file has to be somebody's) simply omits it.
 */
export default function EmployeeSelect({
  value, onChange, employees, label, testId, allLabel, sx,
}) {
  return (
    <Select
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      size="small"
      displayEmpty={allLabel != null}
      aria-label={label ?? t.icsEmployeeSelect}
      data-testid={testId}
      sx={{ minWidth: 110, maxWidth: '100%', '& .MuiSelect-select': { py: 0.5 }, ...sx }}
    >
      {allLabel != null && <MenuItem value="">{allLabel}</MenuItem>}
      {employees.map((employee) => (
        <MenuItem key={employee.id} value={employee.id}>{employee.name}</MenuItem>
      ))}
    </Select>
  );
}
