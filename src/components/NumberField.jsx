import { useLayoutEffect, useId, useState } from 'react';
import { NumberField as BaseNumberField } from '@base-ui/react/number-field';
import { Box, Button, FormControl, FormLabel, OutlinedInput } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { t } from '../strings.js';

/** MUI's Number Spinner composition, with plan-specific nullable/inherited values. */
export default function NumberField({ value, onChange, min = 1, max = 999, step = 1,
  nullable = false, fallbackValue, testId, label, disabled = false, sx, ...props }) {
  const id = useId();
  const [draft, setDraft] = useState(value ?? null);
  useLayoutEffect(() => setDraft(value ?? null), [value]);
  const valid = (n) => Number.isSafeInteger(n) && n >= min && n <= max;
  return <BaseNumberField.Root {...props} id={id} value={draft} min={min} max={max}
    step={step} smallStep={1} disabled={disabled} allowOutOfRange
    format={{ useGrouping: false, maximumFractionDigits: 0 }}
    onValueChange={(next, details) => {
      // Empty overrides step from the inherited value, not from zero.
      if (draft == null && fallbackValue != null
        && (['increment-press', 'decrement-press'].includes(details.reason)
          || (details.reason === 'keyboard' && ['ArrowUp', 'ArrowDown'].includes(details.event.key)))) {
        const direction = details.reason === 'decrement-press' || details.event.key === 'ArrowDown' ? -1 : 1;
        next = Math.max(min, Math.min(max, fallbackValue + direction * (details.event.altKey ? 1 : details.event.shiftKey ? 10 : step)));
      }
      setDraft(next);
      if (valid(next) || (nullable && next == null)) onChange(next);
    }}
    onValueCommitted={(next) => {
      if (!valid(next) && !(nullable && next == null)) setDraft(value ?? null);
    }}
    render={<FormControl sx={[{ width: 220, maxWidth: '100%' }, ...(Array.isArray(sx) ? sx : [sx])]} />}>
    <FormLabel htmlFor={id} sx={{ fontSize: '0.875rem', mb: 0.5 }}>{label}</FormLabel>
    <Box sx={{ display: 'flex', direction: 'ltr' }}>
      <BaseNumberField.Decrement data-testid={`${testId}-decrement`}
        render={<Button variant="outlined" aria-label={t.decreaseNumber(label)}
          sx={{ minWidth: 44, minHeight: 44, borderTopRightRadius: 0, borderBottomRightRadius: 0 }} />}>
        <RemoveIcon fontSize="small" />
      </BaseNumberField.Decrement>
      <BaseNumberField.Input data-testid={testId} inputMode="numeric"
        placeholder={fallbackValue == null ? undefined : String(fallbackValue)}
        render={(inputProps, state) => <OutlinedInput
          inputRef={inputProps.ref} value={state.inputValue}
          onBlur={inputProps.onBlur} onChange={inputProps.onChange} onFocus={inputProps.onFocus}
          onKeyDown={inputProps.onKeyDown} onKeyUp={inputProps.onKeyUp}
          slotProps={{ input: { ...inputProps, sx: { textAlign: 'center', minWidth: 0 } } }}
          sx={{ borderRadius: 0, flex: 1, minWidth: 0 }} />} />
      <BaseNumberField.Increment data-testid={`${testId}-increment`}
        render={<Button variant="outlined" aria-label={t.increaseNumber(label)}
          sx={{ minWidth: 44, minHeight: 44, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }} />}>
        <AddIcon fontSize="small" />
      </BaseNumberField.Increment>
    </Box>
  </BaseNumberField.Root>;
}
