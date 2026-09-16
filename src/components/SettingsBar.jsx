import { useState } from 'react';
import {
  Button, Menu, MenuItem, Paper, Stack, TextField, Tooltip,
} from '@mui/material';
import ScheduleIcon from '@mui/icons-material/Schedule';
import DateTimeField from './DateTimeField.jsx';
import NumberField from './NumberField.jsx';
import DailyClockField from './DailyClockField.jsx';
import { usePlan } from '../state/PlanContext.jsx';
import { topOfHour, nextTopOfHour } from '../lib/planSchema.js';
import { STRATEGY } from '../lib/strategies.js';
import { t } from '../strings.js';

/**
 * Plan-wide settings: the window everything else defaults to, the rotation
 * length, when night runs, and which strategy decides who works a given slot.
 */
export default function SettingsBar() {
  const { doc, setField, update } = usePlan();
  const [anchorEl, setAnchorEl] = useState(null);

  // Moving the start keeps the plan's duration, so `end` doesn't detach from it.
  const jumpStart = (newStart) => {
    const delta = doc.end - doc.start;
    update((d) => ({ ...d, start: newStart, end: newStart + delta }));
    setAnchorEl(null);
  };

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
          testId="plan-start" nullable={false}
        />
        <Button
          startIcon={<ScheduleIcon />}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          aria-label={t.startOptions}
          data-testid="start-now-menu"
        >
          {t.startOptions}
        </Button>
        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
          <MenuItem data-testid="start-now" onClick={() => jumpStart(topOfHour(Date.now()))}>
            {t.startNow}
          </MenuItem>
          <MenuItem data-testid="start-next-hour" onClick={() => jumpStart(nextTopOfHour(Date.now()))}>
            {t.startNextHour}
          </MenuItem>
        </Menu>
        <DateTimeField
          label={t.planEnd}
          value={doc.end}
          onChange={(v) => v != null && setField('end', v)}
          testId="plan-end" nullable={false}
        />
        <NumberField
          label={t.shiftLength}
          value={doc.shiftMinutes}
          onChange={(n) => setField('shiftMinutes', n)}
          min={5} max={1440} step={5} testId="shift-minutes"
        />
        {/* The log is never cleared, so this is the only thing that says how
            much of it still counts - see planSchema's `memoryDays`. */}
        <Tooltip title={t.memoryDaysHelp}>
          <NumberField
            label={t.memoryDays}
            value={doc.memoryDays}
            onChange={(n) => setField('memoryDays', n)}
            min={1} max={90} step={1} testId="memory-days"
          />
        </Tooltip>
        <Tooltip title={t.nightWindowHelp}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <DailyClockField label={t.nightStart} value={doc.nightStart} nullable={false}
              onChange={(minutes) => setField('nightStart', minutes)} testId="night-start" />
            <DailyClockField label={t.nightEnd} value={doc.nightEnd} nullable={false}
              onChange={(minutes) => setField('nightEnd', minutes)} testId="night-end" />
          </Stack>
        </Tooltip>
        <Tooltip
          title={doc.strategy === STRATEGY.ROTATION
            ? t.strategyRotationHelp
            : t.strategyBalancedHelp}
        >
          <TextField
            select
            label={t.strategy}
            value={doc.strategy}
            onChange={(e) => setField('strategy', e.target.value)}
            slotProps={{ htmlInput: { 'data-testid': 'strategy' } }}
            sx={{ width: 180 }}
          >
            <MenuItem value={STRATEGY.BALANCED} data-testid="strategy-balanced">
              {t.strategyBalanced}
            </MenuItem>
            <MenuItem value={STRATEGY.ROTATION} data-testid="strategy-rotation">
              {t.strategyRotation}
            </MenuItem>
          </TextField>
        </Tooltip>
      </Stack>
    </Paper>
  );
}
