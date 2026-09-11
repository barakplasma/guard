import { useLayoutEffect, useState } from 'react';
import dayjs from 'dayjs';
import { uses12HourClock } from '../lib/pickerLocale.js';
import { MobileTimePicker } from '@mui/x-date-pickers/MobileTimePicker';

/** Wall-clock minutes are independent of the arbitrary calendar date used by the picker. */
export default function DailyClockField({ value, onChange, label, testId, nullable = true, sx }) {
  const time = value == null ? null : dayjs('2000-01-01').hour(Math.floor(value / 60)).minute(value % 60);
  const [draft, setDraft] = useState(time);
  useLayoutEffect(() => setDraft(value == null ? null : dayjs('2000-01-01').hour(Math.floor(value / 60)).minute(value % 60)), [value]);
  const save = (next, context) => {
    if (context.validationError == null && (next?.isValid() || (nullable && next == null))) {
      onChange(next == null ? null : next.hour() * 60 + next.minute());
    }
  };
  return <MobileTimePicker label={label} value={draft} ampm={uses12HourClock} format={uses12HourClock ? 'hh:mm A' : 'HH:mm'} minutesStep={1}
    closeOnSelect={false}
    onChange={(next, context) => { setDraft(next); if (context.source === 'field') save(next, context); }}
    onAccept={save}
    onClose={() => setDraft(time)}
    slotProps={{
      textField: { 'data-testid': testId },
      openPickerButton: { 'data-testid': `${testId}-open` },
      actionBar: { actions: nullable ? ['clear', 'cancel', 'accept'] : ['cancel', 'accept'] },
    }}
    sx={{ width: 180, maxWidth: '100%', ...sx }} />;
}
