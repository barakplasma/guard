import { Paper, Stack, TextField } from '@mui/material';
import DateTimeField from './DateTimeField.jsx';
import { usePlan } from '../state/PlanContext.jsx';
import { t } from '../strings.js';

/** Plan-wide settings: the window everything else defaults to, and the rotation length. */
export default function SettingsBar() {
  const { doc, setField } = usePlan();

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <TextField
          label={t.planTitle}
          placeholder={t.planTitlePlaceholder}
          value={doc.title}
          onChange={(e) => setField('title', e.target.value)}
          sx={{ flex: 1, minWidth: 160 }}
          slotProps={{ htmlInput: { 'data-testid': 'plan-title' } }}
        />
        <DateTimeField
          label={t.planStart}
          value={doc.start}
          onChange={(v) => v != null && setField('start', v)}
          testId="plan-start"
        />
        <DateTimeField
          label={t.planEnd}
          value={doc.end}
          onChange={(v) => v != null && setField('end', v)}
          testId="plan-end"
        />
        <TextField
          label={t.shiftLength}
          type="number"
          value={doc.shiftMinutes}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 5 && n <= 1440) setField('shiftMinutes', n);
          }}
          slotProps={{ htmlInput: { min: 5, max: 1440, step: 5, 'data-testid': 'shift-minutes' } }}
          sx={{ width: 160 }}
        />
      </Stack>
    </Paper>
  );
}
