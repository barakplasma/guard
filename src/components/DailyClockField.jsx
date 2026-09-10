import { useEffect, useState } from 'react';
import { TextField } from '@mui/material';

const pad2 = (n) => String(n).padStart(2, '0');

/** Minutes past midnight -> "HH:mm", what `<input type="time">` expects. */
export const toTimeInput = (value) => value == null ? '' : `${pad2(Math.floor(value / 60))}:${pad2(value % 60)}`;

/** "HH:mm" -> minutes past midnight, or null while the field is half-typed or cleared. */
export function fromTimeInput(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

/**
 * A wall-clock time of day picked from the browser's native time control -
 * the same `<input type="time">` the plan-level night window uses, so every
 * clock on the missions page behaves alike. The value stored is minutes past
 * midnight; a half-typed or cleared field is dropped rather than written,
 * because a time input emits on every keystroke.
 */
export default function DailyClockField({ value, onChange, label, testId }) {
  const [draft, setDraft] = useState(toTimeInput(value));
  useEffect(() => setDraft(toTimeInput(value)), [value]);
  return (
    <TextField
      label={label}
      type="time"
      value={draft}
      sx={{ width: 180 }}
      slotProps={{
        inputLabel: { shrink: true },
        htmlInput: { step: 300, 'data-testid': testId },
      }}
      onBlur={() => setDraft(toTimeInput(value))}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw === '') { onChange(null); return; }
        const minutes = fromTimeInput(raw);
        if (minutes != null) onChange(minutes);
      }}
    />
  );
}
