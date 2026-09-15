import { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ERROR_FINDINGS, INFO_FINDINGS, findingText } from '../lib/findings.js';
import { formatRange } from '../lib/format.js';
import { usePlan } from '../state/PlanContext.jsx';
import useCopyToast from '../hooks/useCopyToast.jsx';
import { t } from '../strings.js';

/* global __APP_VERSION__ */

function Finding({ warning: w, doc, compact }) {
  return <Alert severity={ERROR_FINDINGS.has(w.code) ? 'error' : INFO_FINDINGS.has(w.code) ? 'info' : 'warning'}
    sx={{ mb: 1, overflowWrap: 'anywhere' }} data-testid={`finding-${w.code}`}>
    {findingText(w, doc)}
    {!compact && w.windows.length > 0 && <Box component="details">
      <Typography component="summary" variant="caption">{t.findingWindows(w.windows.length)}</Typography>
      {w.windows.map((win, i) => <Typography key={i} variant="caption" sx={{ display: 'block' }}>{formatRange(win.start, win.end)}</Typography>)}
    </Box>}
  </Alert>;
}

function ChecksPanel({ groups, doc, result }) {
  const [expanded, setExpanded] = useState(null);
  const [filter, setFilter] = useState('all');
  const { copy, toastNode } = useCopyToast();
  const errors = groups.filter(([, w]) => ERROR_FINDINGS.has(w.code)).length;
  const matches = (w) => filter === 'all' || (filter === 'errors' && ERROR_FINDINGS.has(w.code))
    || (filter === 'duration' && ['short-shift', 'long-shift'].includes(w.code))
    || (filter === 'workload' && ['workload-outlier', 'no-rest-between-shifts', 'same-mission-consecutive', 'long-unbroken-run'].includes(w.code))
    || (filter === 'unused' && w.code === 'employee-unused');
  const shown = groups.filter(([, w]) => matches(w));
  return <>
    <Accordion variant="outlined" disableGutters expanded={expanded ?? errors > 0}
      onChange={(_, value) => setExpanded(value)} sx={{ mb: 2 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} data-testid="toggle-schedule-checks">
        <Typography color={errors ? 'error' : 'text.primary'}>{t.scheduleChecks(errors, groups.length - errors)}</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>{t.scheduleChecksHelp}</Typography>
        <ToggleButtonGroup exclusive value={filter} onChange={(_, value) => value && setFilter(value)}
          data-testid="schedule-check-filter" aria-label={t.checkAll} sx={{ flexWrap: 'wrap', mb: 1 }}>
          {[['all', t.checkAll], ['errors', t.checkErrors], ['duration', t.checkDurations], ['workload', t.checkWorkload], ['unused', t.checkUnused]].map(([value, label]) => (
            <ToggleButton key={value} value={value} sx={{ minHeight: 44 }}>{label}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        {shown.length ? shown.map(([key, w]) => <Finding key={key} warning={w} doc={doc} />)
          : <Typography variant="body2">{t.noMatchingFindings}</Typography>}
        <Button data-testid="copy-schedule-report" sx={{ minHeight: 44 }} onClick={() => copy(JSON.stringify({
          appVersion: __APP_VERSION__, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          plan: doc, warnings: result.warnings, shifts: result.shifts,
        }, null, 2))}>{t.copyScheduleReport}</Button>
      </AccordionDetails>
    </Accordion>
    {toastNode}
  </>;
}

/** Aggregate by person/mission; ranges remain available without an alert wall. */
export default function ScheduleFindings({ warnings, proposals = [], compact = false, panel = false, result, onApplyCorrection }) {
  const { doc } = usePlan();
  const groups = new Map();
  for (const w of warnings) {
    const key = `${w.code}|${w.missionId ?? ''}|${w.employeeId ?? ''}|${w.tag ?? ''}|${w.rule ?? ''}|${w.expectedMinutes ?? ''}|${w.actualMinutes ?? ''}`;
    if (!groups.has(key)) groups.set(key, { ...w, windows: [] });
    const group = groups.get(key);
    if (w.got != null && w.got < (group.got ?? Infinity)) {
      group.got = w.got;
      group.longestMinutes = w.longestMinutes;
    }
    group.windows.push(...(w.windows ?? [{ start: w.start, end: w.end }])
      .filter((win) => Number.isFinite(win.start) && Number.isFinite(win.end) && win.end > win.start));
  }
  return <>
    {proposals.length > 0 && <CorrectionAlerts proposals={proposals} onApply={onApplyCorrection} />}
    {panel ? <ChecksPanel groups={[...groups]} doc={doc} result={result} />
      : [...groups].filter(([, w]) => ERROR_FINDINGS.has(w.code) || w.code === 'rest-incomplete')
        .map(([key, w]) => <Finding key={key} warning={w} doc={doc} compact={compact} />)}
  </>;
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
