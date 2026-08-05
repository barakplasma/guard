import { TextField } from '@mui/material';
import { fromLocalInput, toLocalInput } from '../lib/format.js';

/**
 * `datetime-local` bridged to epoch-ms values. Native rather than a MUI picker
 * so there is no extra dependency to precache and mobile gets its own OS picker.
 *
 * `slotProps` is built here rather than passed through: MUI v9 no longer
 * forwards the legacy `inputProps`, and merging in the caller would clobber the
 * shrunk label a datetime input always needs.
 */
export default function DateTimeField({
  label, value, onChange, testId, sx, ...rest
}) {
  return (
    <TextField
      label={label}
      type="datetime-local"
      value={toLocalInput(value)}
      onChange={(e) => onChange(fromLocalInput(e.target.value))}
      slotProps={{
        inputLabel: { shrink: true },
        htmlInput: testId ? { 'data-testid': testId } : undefined,
      }}
      sx={{ width: { xs: '100%', md: 'auto' }, ...sx }}
      {...rest}
    />
  );
}
