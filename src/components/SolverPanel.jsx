import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Divider, Stack, Typography,
} from '@mui/material';
import useScheduleSession from '../state/useScheduleSession.js';
import { findingText } from '../lib/findings.js';
import { t } from '../strings.js';

/**
 * MiniZinc's answer, shown beside the engine's.
 *
 * Step 5 of ADR 017's migration: the engine is still the authority and this
 * panel is instrumentation - what the model proved, what it reported, and how
 * far its assignments differ from the ones on screen. Only step 6 flips
 * `acceptSchedule`, and there is deliberately no step where both are the
 * authority.
 *
 * Off until asked. Turning it on downloads a 19 MB WebAssembly runtime, which
 * is not a cost to impose on somebody who opened a link to read tonight's
 * rota - so the whole solver, assets and module graph alike, stays out of the
 * way of a page that never runs it.
 */
function outcomeText(status, outcome) {
  switch (status) {
    case 'ready':
      return outcome?.kind === 'optimal'
        ? t.solverOptimal(outcome.accepted.provenLevels)
        : t.solverFeasible(outcome?.accepted?.provenLevels ?? 0);
    case 'infeasible': return t.solverInfeasible;
    case 'unknown': return t.solverUnknown(outcome?.level ?? 1);
    case 'failed': return t.solverFailed(outcome?.reason ?? '');
    case 'stale': return t.solverStale;
    case 'solving': return t.solverSolving;
    default: return t.solverOff;
  }
}

const rowKey = (row) => `${row.employeeId}|${row.missionId}|${row.start}|${row.end}`;

export default function SolverPanel({ doc, result }) {
  const [enabled, setEnabled] = useState(false);
  // Frozen at the moment the panel is switched on, so a ticking clock does not
  // hand every render a new revision to solve - see useScheduleSession.
  const [now, setNow] = useState(null);
  const session = useScheduleSession(doc, enabled, now ?? 0);

  const diff = useMemo(() => {
    if (!session.result) return null;
    const engine = new Set(result.shifts.map(rowKey));
    const same = session.result.shifts.filter((row) => engine.has(rowKey(row))).length;
    return { same, total: Math.max(engine.size, session.result.shifts.length) };
  }, [session.result, result.shifts]);

  return (
    <Box sx={{ mt: 1 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ flex: 1 }}>
          {t.solverPanel}
        </Typography>
        <Button
          size="small"
          onClick={() => { setNow(Date.now()); setEnabled(true); }}
          disabled={enabled}
          data-testid="run-solver"
        >
          {t.solverRun}
        </Button>
      </Stack>

      <Alert
        severity={session.status === 'ready' ? 'success' : session.status === 'failed' || session.status === 'infeasible' ? 'warning' : 'info'}
        sx={{ mb: 1 }}
        data-testid="solver-status"
      >
        {outcomeText(session.status, session.outcome)}
      </Alert>

      {diff && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }} data-testid="solver-diff">
          {t.solverDiff(diff.same, diff.total)}
        </Typography>
      )}

      {session.result && session.result.warnings.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Box data-testid="solver-findings">
            {session.result.warnings.map((warning, index) => (
              <Typography
                key={`${warning.code}-${warning.employeeId ?? warning.missionId ?? index}`}
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block' }}
              >
                {findingText(warning, doc)}
              </Typography>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}
