import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, IconButton, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AgendaDay from '../components/AgendaDay.jsx';
import ShareBar from '../components/ShareBar.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { usePlan } from '../state/PlanContext.jsx';
import { plan as runPlanner, WARN } from '../lib/planner.js';
import { toPlannerInput } from '../lib/planSchema.js';
import { findNowSlot, groupAgenda } from '../lib/agenda.js';
import { formatDuration } from '../lib/format.js';
import { sortByHebrewName } from '../lib/sort.js';
import useNow from '../hooks/useNow.js';
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

const jumpToNow = () => document.getElementById('now-slot')?.scrollIntoView({ behavior: 'smooth', block: 'center' });

const PIN_WARNING_CODES = new Set([WARN.PIN_CONFLICT, WARN.PIN_OVERFLOW, WARN.PIN_UNAVAILABLE]);

function warningKey(warning, index) {
  return `${warning.code}-${warning.missionId ?? ''}-${warning.employeeId ?? ''}-${warning.start ?? index}`;
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
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 2 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>{t.summary}</Typography>
      {/* Headers wrap onto a second line on a phone instead of forcing the
          table wider than the screen: a forced min-width here overflowed a
          360px phone, and since the table is RTL, the browser's default
          scroll position hid the far column completely rather than showing
          a truncated header - there was no visible way to reach it. */}
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ whiteSpace: { xs: 'normal', sm: 'nowrap' } }}>{t.employeeName}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: { xs: 'normal', sm: 'nowrap' } }}>{t.totalTime}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: { xs: 'normal', sm: 'nowrap' } }}>{t.stints}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: { xs: 'normal', sm: 'nowrap' } }}>{t.minGap}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.stats.perEmployee.map((row) => (
              <TableRow key={row.employeeId} data-testid={`summary-${row.employeeId}`}>
                <TableCell sx={{ overflowWrap: 'break-word' }}>{row.name}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatDuration(row.minutes)}</TableCell>
                <TableCell align="right">{row.stints}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  {row.minGapMinutes == null ? '—' : formatDuration(row.minGapMinutes)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        {`${t.spread}: ${formatDuration(result.stats.spreadMinutes)}`}
      </Typography>
    </Paper>
  );
}

export default function SchedulePage() {
  const {
    doc, pinShift, clearPin, clearAllPins, clearPinByWarning, decodeFailed,
  } = usePlan();
  const { result, error } = useSchedule(doc);

  const days = useMemo(() => (result ? groupAgenda(result) : []), [result]);
  const sortedEmployees = useMemo(() => sortByHebrewName(doc.employees), [doc.employees]);
  const now = useNow();
  const nowSlot = useMemo(() => findNowSlot(days, now), [days, now]);
  const nowSlotKey = nowSlot ? `${nowSlot.start}|${nowSlot.end}` : null;
  const [confirmClearPins, setConfirmClearPins] = useState(false);
  // Session-only, never written to the URL: dismissing a warning is a "stop
  // showing me this" for the current visit, not a document edit. Keyed the
  // same way as the Alert below it, so a warning that changes shape (a
  // different range, a different person) reappears rather than staying
  // hidden under a key nobody is dismissing anymore.
  const [dismissedWarnings, setDismissedWarnings] = useState(() => new Set());

  return (
    <Box>
      {decodeFailed && <Alert severity="warning" sx={{ mb: 2 }}>{t.badLink}</Alert>}

      <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ flex: 1, fontSize: { xs: '1.05rem', sm: '1.25rem' } }}>
          {t.schedule}
        </Typography>
        {nowSlotKey != null && (
          <Button size="small" onClick={jumpToNow} data-testid="jump-to-now">
            {t.jumpToNow}
          </Button>
        )}
        {doc.pins.length > 0 && (
          <Button size="small" onClick={() => setConfirmClearPins(true)} data-testid="clear-all-pins">
            {t.clearAllPins}
          </Button>
        )}
      </Stack>

      <ConfirmDialog
        open={confirmClearPins}
        title={t.confirmClearPinsTitle}
        body={t.confirmClearPinsBody}
        onCancel={() => setConfirmClearPins(false)}
        onConfirm={() => {
          clearAllPins();
          setConfirmClearPins(false);
        }}
        confirmLabel={t.clearAllPins}
        confirmTestId="confirm-clear-all-pins"
        cancelTestId="cancel-clear-all-pins"
      />

      {error && <Alert severity="info" sx={{ mb: 2 }}>{error}</Alert>}

      {result && (
        <>
          <Box sx={{ mb: { xs: 1, sm: 2 } }}>
            <ShareBar doc={doc} result={result} />
          </Box>

          {result.warnings.map((w, i) => {
            const key = warningKey(w, i);
            if (dismissedWarnings.has(key)) return null;
            return (
              <Alert
                key={key}
                severity="warning"
                sx={{ mb: 1 }}
                action={(
                  <Stack direction="row" spacing={0.5} useFlexGap sx={{ alignItems: 'center' }}>
                    {PIN_WARNING_CODES.has(w.code) && (
                      <Button
                        color="inherit"
                        size="small"
                        onClick={() => clearPinByWarning(w)}
                        data-testid={`remove-pin-warning-${key}`}
                      >
                        {t.removeBadPin}
                      </Button>
                    )}
                    <IconButton
                      color="inherit"
                      size="small"
                      aria-label={t.dismissWarning}
                      onClick={() => setDismissedWarnings((prev) => new Set(prev).add(key))}
                      data-testid={`dismiss-warning-${key}`}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                )}
              >
                {warningText(w, doc)}
              </Alert>
            );
          })}

          {days.length === 0 && <Alert severity="info">{t.emptySchedule}</Alert>}

          {days.map((day) => (
            <AgendaDay
              key={day.day}
              day={day}
              result={result}
              employees={sortedEmployees}
              now={now}
              nowSlotKey={nowSlotKey}
              onSwap={(shift, employeeId) => pinShift(
                shift.missionId, employeeId, shift.start, shift.end, shift.employeeId,
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
