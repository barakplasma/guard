import { useEffect, useState } from 'react';
import { TextField } from '@mui/material';

const clock = (value) => value == null ? '' : `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

/** Always military time, even in browsers whose native time control uses AM/PM. */
export default function DailyClockField({ value, onChange, label, testId }) {
  const [draft, setDraft] = useState(clock(value));
  useEffect(() => setDraft(clock(value)), [value]);
  return <TextField label={label} value={draft} placeholder="08:00" sx={{ width: 180 }}
    slotProps={{ inputLabel: { shrink: true }, htmlInput: { dir: 'ltr', inputMode: 'numeric', maxLength: 5, 'data-testid': testId } }}
    onBlur={() => setDraft(clock(value))}
    onChange={(e) => {
      const raw = e.target.value;
      setDraft(raw);
      if (!raw) { onChange(null); return; }
      const formatted = /^\d{4}$/.test(raw) ? `${raw.slice(0, 2)}:${raw.slice(2)}` : raw;
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(formatted)) {
        const [h, m] = formatted.split(':').map(Number);
        onChange(h * 60 + m); setDraft(formatted);
      }
    }} />;
}
