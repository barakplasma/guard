import { TextField } from '@mui/material';
import { fromLocalDateTimeInput, toLocalDateTimeInput } from '../lib/localInput.js';

/**
 * A date and time, as the platform's own field.
 *
 * This used to be a MUI `MobileDateTimePicker`. A native `datetime-local` input
 * opens the OS picker on a phone, needs no date library, and - the reason it
 * replaced the picker - speaks only 24-hour `HH:mm`, so hour arithmetic cannot
 * depend on the device's clock format. The picker followed that format, and on
 * a 12-hour device its hour section counted inside its own half of the day:
 * stepping a plan's start back over noon threw it nine hours forward instead.
 *
 * Local calendar values cross the document boundary only as epoch milliseconds.
 */
export default function DateTimeField({
  label, value, onChange, testId, sx, nullable = true, ...rest
}) {
  return (
    <TextField
      {...rest}
      type="datetime-local"
      size="small"
      label={label}
      value={toLocalDateTimeInput(value)}
      onChange={(event) => {
        const next = fromLocalDateTimeInput(event.target.value);
        // A half-filled field reads as an empty string. Only a field that may
        // be empty takes that as "cleared"; a required one keeps what it had
        // rather than tearing a bound out of the document mid-edit.
        if (next != null) onChange(next);
        else if (nullable && event.target.value === '') onChange(null);
      }}
      slotProps={{
        // A native date input always shows its own placeholder, so the label
        // has to sit above it or the two overlap.
        inputLabel: { shrink: true },
        htmlInput: { 'data-testid': testId, step: 60, dir: 'ltr' },
      }}
      sx={{ width: { xs: '100%', md: 260 }, ...sx }}
    />
  );
}
