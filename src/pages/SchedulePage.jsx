import { useCallback, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import AgendaDay from '../components/AgendaDay.jsx';
import ScheduleFindings from '../components/ScheduleFindings.jsx';
import ShareBar from '../components/ShareBar.jsx';
import DebugSection from '../components/DebugSection.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import EmployeeSelect from '../components/EmployeeSelect.jsx';
import { usePlan } from '../state/PlanContext.jsx';
import { plan as runPlanner } from '../lib/planner.js';
import { toPlannerInput } from '../lib/planSchema.js';
import { outOfPeriodLog, logFilename } from '../lib/logExport.js';
import { shiftsToCsv, downloadCsv } from '../lib/exportCsv.js';
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
      // `Date.now()` enters here, in the UI, and reaches the engine only as the
      // absolute `loggedBefore` instant the adapter resolves - the engine still
      // owns no clock (ADR 009). Recomputing on `doc` alone is deliberate: the
      // schedule should move when the plan moves, not tick over on its own.
      return { result: runPlanner({ ...toPlannerInput(doc, Date.now()), onInvariantViolation: 'report' }) };
    } catch (e) {
      return { error: e.message };
    }
  }, [doc]);
}

const jumpToNow = () => document.getElementById('now-slot')?.scrollIntoView({ behavior: 'smooth', block: 'center' });

function SummaryTable({ result, highlightId }) {
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
              <TableRow
                key={row.employeeId}
                selected={row.employeeId === highlightId}
                data-testid={`summary-${row.employeeId}`}
              >
                <TableCell sx={{ overflowWrap: 'break-word' }}>
                  {row.name}
                  {/* Deliberately a second line under the name rather than a
                      fifth column: four columns already crowd a 360px phone,
                      and this text is absent for everyone who has carried
                      nothing, which is the ordinary case. */}
                  {(row.carriedMinutes ?? 0) > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {t.carriedBefore(formatDuration(row.carriedMinutes))}
                    </Typography>
                  )}
                </TableCell>
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
        {/* While a carried debt is being repaid the window spread is
            deliberately wide - that is the engine catching somebody up, not a
            fault - so the number it is actually evening out is shown beside it.
            With nothing carried the two are equal and only one is worth
            printing (ADR 015). */}
        {(result.stats.totalSpreadMinutes ?? result.stats.spreadMinutes) === result.stats.spreadMinutes
          ? `${t.spread}: ${formatDuration(result.stats.spreadMinutes)}`
          : t.spreadWithCarried(
            formatDuration(result.stats.spreadMinutes),
            formatDuration(result.stats.totalSpreadMinutes),
          )}
      </Typography>
    </Paper>
  );
}

export default function SchedulePage() {
  const {
    doc, pinShift, clearPin, clearAllPins, clearPinByWarning, clearStalePins, applyCorrection, decodeFailed,
  } = usePlan();
  const { result, error } = useSchedule(doc);

  /**
   * ADR 012: a window the plan has rolled past is *exported*, not dropped. So
   * the out-of-period button downloads the record before removing it, and
   * removes nothing if the download could not be produced - losing a window to
   * a failed export is the data loss this exists to prevent.
   */
  const exportAndClearStalePins = useCallback(() => {
    const rows = outOfPeriodLog(doc);
    if (rows.length === 0) return;
    try {
      downloadCsv(shiftsToCsv({ shifts: rows }, doc), logFilename(doc, rows));
    } catch {
      return;
    }
    clearStalePins();
  }, [doc, clearStalePins]);

  // View state, not plan data: it never reaches the document or the URL, so
  // sharing a link never sends your filter along with it.
  const [filterId, setFilterId] = useState(null);
  // The agenda is filtered; `result` is not. Everything that has to reason
  // about the whole rota - who is already on duty in this slot, what the
  // engine warned about, the per-person totals being compared - still sees it.
  const shown = useMemo(() => (result && filterId
    ? { ...result, shifts: result.shifts.filter((s) => s.employeeId === filterId) }
    : result), [result, filterId]);

  const days = useMemo(() => (shown ? groupAgenda(shown) : []), [shown]);
  const sortedEmployees = useMemo(() => sortByHebrewName(doc.employees), [doc.employees]);
  const filtered = sortedEmployees.find((e) => e.id === filterId) ?? null;
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
        {doc.employees.length > 0 && (
          <EmployeeSelect
            value={filterId}
            onChange={setFilterId}
            employees={sortedEmployees}
            label={t.filterEmployee}
            allLabel={t.allEmployees}
            testId="filter-employee"
          />
        )}
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

      <Box sx={{ mb: { xs: 1, sm: 2 } }}><ShareBar doc={doc} result={result} now={now} /></Box>
      {result && <ScheduleFindings warnings={result.warnings} proposals={result.proposals}
        onApplyCorrection={applyCorrection} result={result} panel />}
      {result && (
        <>

          {days.length === 0 && (
            <Alert severity="info" data-testid="agenda-empty">
              {filtered ? t.filterNoShifts(filtered.name) : t.emptySchedule}
            </Alert>
          )}

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

          {result.shifts.length > 0 && <SummaryTable result={result} highlightId={filterId} />}

          <DebugSection
            doc={doc}
            result={result}
            onClearPinByWarning={clearPinByWarning}
            onClearStalePins={exportAndClearStalePins}
          />
        </>
      )}
    </Box>
  );
}
