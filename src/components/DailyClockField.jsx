import { IconButton, InputAdornment, TextField } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { fromClockInput, toClockInput } from '../lib/localInput.js';
import { t } from '../strings.js';

/**
 * A bare wall-clock time, as the platform's own field.
 *
 * Wall-clock minutes are independent of the arbitrary calendar date a picker
 * would need, and a native `time` input's value is always 24-hour `HH:mm` -
 * see `DateTimeField` for why that matters more than it sounds.
 */
export default function DailyClockField({
  value, onChange, label, testId, nullable = true, sx,
}) {
  const clearable = nullable && value != null;
  return (
    <TextField
      type="time"
      size="small"
      label={label}
      value={toClockInput(value)}
      onChange={(event) => {
        const next = fromClockInput(event.target.value);
        if (next != null) onChange(next);
        else if (nullable && event.target.value === '') onChange(null);
      }}
      slotProps={{
        inputLabel: { shrink: true },
        htmlInput: { 'data-testid': testId, step: 60, dir: 'ltr' },
        input: clearable ? {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                size="small"
                aria-label={t.clearValue}
                onClick={() => onChange(null)}
                data-testid={`${testId}-clear`}
                sx={{ p: 0.25 }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        } : undefined,
      }}
      sx={{ width: 180, maxWidth: '100%', ...sx }}
    />
  );
}
