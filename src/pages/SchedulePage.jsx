import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import AgendaDay from '../components/AgendaDay.jsx';
import ShareBar from '../components/ShareBar.jsx';
import DebugSection from '../components/DebugSection.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { usePlan } from '../state/PlanContext.jsx';
import { plan as runPlanner } from '../lib/planner.js';
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
    doc, pinShift, clearPin, clearAllPins, clearPinByWarning, clearStalePins, decodeFailed,
  } = usePlan();
  const { result, error } = useSchedule(doc);

  const days = useMemo(() => (result ? groupAgenda(result) : []), [result]);
  const sortedEmployees = useMemo(() => sortByHebrewName(doc.employees), [doc.employees]);
  const now = useNow();
  const nowSlot = useMemo(() => findNowSlot(days, now), [days, now]);
  const nowSlotKey = nowSlot ? `${nowSlot.start}|${nowSlot.end}` : null;
  const [confirmClearPins, setConfirmClearPins] = useState(false);

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

          <DebugSection
            doc={doc}
            result={result}
            onClearPinByWarning={clearPinByWarning}
            onClearStalePins={clearStalePins}
          />
        </>
      )}
    </Box>
  );
}
