import { Alert, Box, Typography } from '@mui/material';
import { ERROR_FINDINGS, findingText } from '../lib/findings.js';
import { formatRange } from '../lib/format.js';
import { usePlan } from '../state/PlanContext.jsx';
import { t } from '../strings.js';

/** Aggregate by person/mission; ranges remain available without an alert wall. */
export default function ScheduleFindings({ warnings, compact = false }) {
  const { doc } = usePlan();
  const groups = new Map();
  for (const w of warnings) {
    if (!ERROR_FINDINGS.has(w.code) && w.code !== 'rest-incomplete') continue;
    const key = `${w.code}|${w.missionId ?? ''}|${w.employeeId ?? ''}|${w.tag ?? ''}`;
    if (!groups.has(key)) groups.set(key, { ...w, windows: [] });
    const group = groups.get(key);
    if (w.got != null) group.got = Math.min(group.got ?? Infinity, w.got);
    group.windows.push(...(w.windows ?? (w.start != null ? [{ start: w.start, end: w.end }] : [])));
  }
  return [...groups].map(([key, w]) => <Alert key={key} severity={ERROR_FINDINGS.has(w.code) ? 'error' : 'warning'}
    sx={{ mb: 1, overflowWrap: 'anywhere' }} data-testid={`finding-${w.code}`}>
    {findingText(w, doc)}
    {!compact && w.windows.length > 0 && <Box component="details">
      <Typography component="summary" variant="caption">{t.findingWindows(w.windows.length)}</Typography>
      {w.windows.map((win, i) => <Typography key={i} variant="caption" sx={{ display: 'block' }}>{formatRange(win.start, win.end)}</Typography>)}
    </Box>}
  </Alert>);
}
