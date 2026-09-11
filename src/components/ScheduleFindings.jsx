import { Alert, Box, Button, Typography } from '@mui/material';
import { ERROR_FINDINGS, findingText } from '../lib/findings.js';
import { formatRange } from '../lib/format.js';
import { usePlan } from '../state/PlanContext.jsx';
import { t } from '../strings.js';

/** Aggregate by person/mission; ranges remain available without an alert wall. */
function WarningAlerts({ warnings, compact }) {
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

/**
 * Actionable corrections the engine cannot make on its own. A proposal names
 * the qualified person preserved history is holding and what accepting would
 * change - nothing moves until the button is tapped, and the acceptance
 * travels in the shared link like any other edit. A blocked proposal is text
 * only: a manual assignment is never replaced, so there is nothing to apply.
 */
function CorrectionAlerts({ proposals, onApply }) {
  return proposals.map((p, i) => p.code === 'correction-proposal' ? (
    <Alert key={`${p.missionId}-${p.start}-${i}`} severity="warning" sx={{ mb: 1, overflowWrap: 'anywhere' }}
      data-testid={`proposal-${p.missionId}-${p.start}`}>
      {t.correctionProposal(p.missionName, p.driverName)}
      {p.release.map((r, j) => <Typography key={j} variant="body2" sx={{ display: 'block' }}>
        {`${formatRange(r.start, r.end)}: ${t.correctionRelease(r.missionName, r.substituteName)}`}
      </Typography>)}
      {p.restImpact && <Typography variant="body2" sx={{ display: 'block' }}>
        {t.correctionRestImpact(p.restImpact.before.totalMinutes, p.restImpact.after.totalMinutes, p.restImpact.needed)}
      </Typography>}
      <Button size="small" variant="outlined" sx={{ mt: 0.5 }}
        data-testid={`apply-proposal-${p.missionId}-${p.start}`}
        onClick={() => onApply(p)}>
        {t.correctionApply}
      </Button>
    </Alert>
  ) : (
    <Alert key={`${p.missionId}-${p.start}-${i}`} severity="info" sx={{ mb: 1, overflowWrap: 'anywhere' }}
      data-testid={`blocked-${p.missionId}-${p.start}`}>
      {`${t.correctionBlocked(p.missionName, p.driverName)} ${t.pinnedLocked}.`}
    </Alert>
  ));
}

export default function ScheduleFindings({ warnings, proposals = [], compact = false, onApplyCorrection }) {
  return <>
    {proposals.length > 0 && <CorrectionAlerts proposals={proposals} onApply={onApplyCorrection} />}
    <WarningAlerts warnings={warnings} compact={compact} />
  </>;
}
