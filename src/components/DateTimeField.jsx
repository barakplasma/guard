import { useLayoutEffect, useState } from 'react';
import dayjs from 'dayjs';
import { uses12HourClock } from '../lib/pickerLocale.js';
import { MobileDateTimePicker } from '@mui/x-date-pickers/MobileDateTimePicker';

/** Local calendar values cross the document boundary only as epoch milliseconds. */
export default function DateTimeField({ label, value, onChange, testId, sx, nullable = true, ...rest }) {
  const saved = value == null ? null : dayjs(value);
  const [draft, setDraft] = useState(saved);
  useLayoutEffect(() => setDraft(value == null ? null : dayjs(value)), [value]);
  const save = (next, context) => {
    if (context.validationError == null && (next?.isValid() || (nullable && next == null))) {
      onChange(next == null ? null : next.second(0).millisecond(0).valueOf());
    }
  };
  return <MobileDateTimePicker {...rest} label={label} value={draft}
    ampm={uses12HourClock} format={uses12HourClock ? 'DD/MM/YYYY hh:mm A' : 'DD/MM/YYYY HH:mm'} closeOnSelect={false}
    onChange={(next, context) => { setDraft(next); if (context.source === 'field') save(next, context); }}
    onAccept={save}
    onClose={() => setDraft(saved)}
    slotProps={{
      textField: { 'data-testid': testId },
      openPickerButton: { 'data-testid': `${testId}-open` },
      actionBar: { actions: nullable ? ['clear', 'cancel', 'accept'] : ['cancel', 'accept'] },
    }}
    sx={{ width: { xs: '100%', md: 260 }, ...sx }} />;
}
