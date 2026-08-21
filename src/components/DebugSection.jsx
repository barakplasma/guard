import { useState } from 'react';
import {
  Alert, Box, Button, Collapse, Divider, Paper, Stack, Typography,
} from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import { WARN } from '../lib/planner.js';
import { planToReadableText } from '../lib/planText.js';
import { whatsappText } from '../lib/exportText.js';
import useCopyToast from '../hooks/useCopyToast.jsx';
import { t } from '../strings.js';

// Codes where a manual assignment was actually dropped, so "remove this pin" is
// a real repair. PIN_AVAILABILITY_OVERRIDDEN is deliberately absent: that pin
// was honoured, and the only thing the button could do is delete the
// assignment the planner insisted on - the exact override this app must not do.
const PIN_WARNING_CODES = new Set([WARN.PIN_CONFLICT, WARN.PIN_OVERFLOW, WARN.PIN_UNAVAILABLE]);

/**
 * Nothing is broken when a pin merely outranks an availability window, nor
 * when assignments are left over from a period the plan has moved past.
 */
const INFO_CODES = new Set([WARN.PIN_AVAILABILITY_OVERRIDDEN, WARN.PIN_OUT_OF_PERIOD]);

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
    case WARN.PIN_OUT_OF_PERIOD: return t.warnPinOutOfPeriod(warning.count);
    case WARN.PIN_AVAILABILITY_OVERRIDDEN: return t.warnPinAvailabilityOverridden(employee);
    default: return warning.code;
  }
}

/**
 * The repair button an alert carries, if any. The out-of-period alert counts
 * pins rather than naming one, so its button clears the whole set at once;
 * the rest name a single dropped pin and remove exactly that one.
 */
function warningAction(warning, key, onClearPinByWarning, onClearStalePins) {
  if (warning.code === WARN.PIN_OUT_OF_PERIOD) {
    return (
      <Button color="inherit" size="small" onClick={onClearStalePins} data-testid="remove-stale-pins">
        {t.removeStalePins}
      </Button>
    );
  }
  if (!PIN_WARNING_CODES.has(warning.code)) return undefined;
  return (
    <Button
      color="inherit"
      size="small"
      onClick={() => onClearPinByWarning(warning)}
      data-testid={`remove-pin-warning-${key}`}
    >
      {t.removeBadPin}
    </Button>
  );
}

const preSx = {
  m: 0,
  p: 1,
  bgcolor: 'action.hover',
  borderRadius: 1,
  fontFamily: 'inherit',
  fontSize: '0.8rem',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  maxHeight: 320,
  overflowY: 'auto',
};

/**
 * Warnings plus the two "what did we actually feed/get from the engine" text
 * dumps, collapsed behind one toggle at the bottom of the schedule page. This
 * used to be a wall of Alerts above the agenda, pushing the schedule itself
 * off a phone screen - collapsed-by-default keeps it reachable without being
 * the first thing anyone sees.
 */
export default function DebugSection({ doc, result, onClearPinByWarning, onClearStalePins }) {
  const [open, setOpen] = useState(false);
  const { copy, toastNode } = useCopyToast();

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
      <Button
        size="small"
        variant="text"
        startIcon={<CodeIcon />}
        onClick={() => setOpen((v) => !v)}
        data-testid="toggle-debug"
      >
        {t.debugToggle(result.warnings.length)}
      </Button>
      <Collapse in={open}>
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ display: 'block', mb: 0.5 }}>
            {t.warningsTitle}
          </Typography>
          {result.warnings.length === 0 ? (
            <Typography variant="caption" color="text.secondary">{t.noWarnings}</Typography>
          ) : result.warnings.map((w, i) => {
            const key = warningKey(w, i);
            return (
              <Alert
                key={key}
                severity={INFO_CODES.has(w.code) ? 'info' : 'warning'}
                sx={{ mb: 1 }}
                action={warningAction(w, key, onClearPinByWarning, onClearStalePins)}
              >
                {warningText(w, doc)}
              </Alert>
            );
          })}

          <Divider sx={{ my: 1.25 }} />

          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ flex: 1 }}>
              {t.planDataTitle}
            </Typography>
            <Button size="small" onClick={() => copy(planToReadableText(doc))} data-testid="copy-plan-data">
              {t.copyPlanData}
            </Button>
          </Stack>
          <Box component="pre" data-testid="plan-data-text" sx={preSx}>
            {planToReadableText(doc)}
          </Box>

          <Divider sx={{ my: 1.25 }} />

          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ flex: 1 }}>
              {t.scheduleTextTitle}
            </Typography>
            <Button
              size="small"
              onClick={() => copy(whatsappText(result, { title: doc.title }))}
              data-testid="copy-schedule-text"
            >
              {t.copyPlanData}
            </Button>
          </Stack>
          <Box component="pre" data-testid="schedule-text" sx={preSx}>
            {whatsappText(result, { title: doc.title })}
          </Box>
        </Box>
      </Collapse>
      {toastNode}
    </Paper>
  );
}
