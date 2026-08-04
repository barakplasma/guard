import { useMemo } from 'react';
import {
  Alert, Box, Button, Paper, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Typography,
} from '@mui/material';
import AgendaDay from '../components/AgendaDay.jsx';
import ShareBar from '../components/ShareBar.jsx';
import { usePlan } from '../state/PlanContext.jsx';
import { plan as runPlanner, WARN } from '../lib/planner.js';
import { toPlannerInput } from '../lib/planSchema.js';
import { groupAgenda } from '../lib/agenda.js';
import { formatDuration } from '../lib/format.js';
import { t } from '../strings.js';

/**
 * The schedule is recomputed from the document on every render rather than
 * stored: the engine is deterministic and fast, so "the plan" is always exactly
 * what the URL says, and a manual swap takes effect immediately.
 */
function useSchedule(doc) {
  return useMemo(() => {
    if (doc.employees.length === 0) return { error: t.needEmployees };
    if (doc.missions.length === 0) return { error: t.needMissions };
    try {
      return { result: runPlanner(toPlannerInput(doc)) };
    } catch (e) {
      return { error: e.message };
    }
  }, [doc]);
}

function warningText(warning, doc) {
  const employee = doc.employees.find((e) => e.id === warning.employeeId)?.name ?? warning.employeeId;
  const mission = doc.missions.find((m) => m.id === warning.missionId)?.name ?? warning.missionId;
  switch (warning.code) {
    case WARN.UNDERSTAFFED: return t.warnUnderstaffed(mission, warning.needed, warning.got);
    case WARN.EMPLOYEE_UNUSED: return t.warnEmployeeUnused(employee);
    case WARN.MISSION_OUTSIDE_WINDOW: return t.warnMissionOutside(mission);
    case WARN.EMPLOYEE_WINDOW_OUTSIDE_PLAN: return t.warnEmployeeOutside(employee);
    case WARN.PIN_CONFLICT: return t.warnPinConflict(employee);
    case WARN.PIN_OVERFLOW: return t.warnPinOverflow(employee);
    case WARN.PIN_UNAVAILABLE: return t.warnPinUnavailable(employee);
    default: return warning.code;
  }
}

function SummaryTable({ result }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>{t.summary}</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t.employeeName}</TableCell>
            <TableCell align="right">{t.totalTime}</TableCell>
            <TableCell align="right">{t.stints}</TableCell>
            <TableCell align="right">{t.minGap}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {result.stats.perEmployee.map((row) => (
            <TableRow key={row.employeeId} data-testid={`summary-${row.employeeId}`}>
              <TableCell>{row.name}</TableCell>
              <TableCell align="right">{formatDuration(row.minutes)}</TableCell>
              <TableCell align="right">{row.stints}</TableCell>
              <TableCell align="right">
                {row.minGapMinutes == null ? '—' : formatDuration(row.minGapMinutes)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        {`${t.spread}: ${formatDuration(result.stats.spreadMinutes)}`}
      </Typography>
    </Paper>
  );
}

export default function SchedulePage() {
  const { doc, pinShift, clearPin, clearAllPins, decodeFailed } = usePlan();
  const { result, error } = useSchedule(doc);

  const days = useMemo(() => (result ? groupAgenda(result) : []), [result]);

  return (
    <Box>
      {decodeFailed && <Alert severity="warning" sx={{ mb: 2 }}>{t.badLink}</Alert>}

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <Typography variant="h6" sx={{ flex: 1 }}>{t.schedule}</Typography>
        {doc.pins.length > 0 && (
          <Button size="small" onClick={clearAllPins} data-testid="clear-all-pins">
            {t.clearAllPins}
          </Button>
        )}
      </Stack>

      {error && <Alert severity="info" sx={{ mb: 2 }}>{error}</Alert>}

      {result && (
        <>
          <Box sx={{ mb: 2 }}>
            <ShareBar doc={doc} result={result} />
          </Box>

          {result.warnings.map((w, i) => (
            <Alert
              key={`${w.code}-${w.missionId ?? ''}-${w.employeeId ?? ''}-${w.start ?? i}`}
              severity="warning"
              sx={{ mb: 1 }}
            >
              {warningText(w, doc)}
            </Alert>
          ))}

          {days.length === 0 && <Alert severity="info">{t.emptySchedule}</Alert>}

          {days.map((day) => (
            <AgendaDay
              key={day.day}
              day={day}
              result={result}
              employees={doc.employees}
              onSwap={(shift, employeeId) => pinShift(
                shift.missionId, employeeId, shift.start, shift.end,
              )}
              onClearPin={(shift) => clearPin(
                shift.missionId, shift.employeeId, shift.start, shift.end,
              )}
            />
          ))}

          {result.shifts.length > 0 && <SummaryTable result={result} />}
        </>
      )}
    </Box>
  );
}
