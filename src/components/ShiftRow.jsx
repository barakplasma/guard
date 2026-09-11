import { useState } from 'react';
import { Box, ButtonBase, Chip, IconButton, Tooltip, Typography } from '@mui/material';
import PushPinIcon from '@mui/icons-material/PushPin';
import LockIcon from '@mui/icons-material/Lock';
import CloseIcon from '@mui/icons-material/Close';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import AssignDialog from './AssignDialog.jsx';
import { t } from '../strings.js';

/**
 * One person in one shift: their name, in full, with an edit affordance that
 * opens the roster picker.
 *
 * The name used to live inside an inline dropdown, and that is what made the
 * agenda unreadable on a phone - the input is only as wide as its column, so a
 * three-syllable Hebrew name rendered as "ש..." and the rota stopped saying who
 * was on duty. Text wraps; an input does not. The picker moved into a dialog
 * (`AssignDialog`), which is the only surface wide enough to show a whole
 * roster of whole names.
 *
 * Choosing someone else writes a pin over this exact range rather than editing
 * the generated output - so the displaced person is freed and automatically
 * rescheduled elsewhere by the fairness pass, and the edit survives sharing.
 *
 * Layout note: the wrapping here uses `gap`, never MUI's margin-based
 * `spacing`. Margin spacing on a wrapping row offsets the items that fall to
 * the second line, which is what made the pin badge and its clear button
 * overlap the row underneath on a phone.
 */
export default function ShiftRow({ shift, employees, busyElsewhere, onSwap, onClearPin }) {
  const [picking, setPicking] = useState(false);
  const name = employees.find((e) => e.id === shift.employeeId)?.name || '—';

  return (
    <Box
      sx={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 0.5,
        rowGap: 0.5,
        // Always the full row width on a phone: a two-column packing (each
        // person given only a ~6rem share) reads fine for a two-person
        // mission, but a mission with a large headcount turns into a wall of
        // cramped, hard-to-read names. One assignment per line costs more
        // vertical space but stays legible regardless of headcount. On a wide
        // screen the column is roomy already.
        flex: { xs: '1 1 100%', sm: '0 0 auto' },
        maxWidth: '100%',
        minWidth: 0,
        ...(shift.pinned && {
          borderInlineStart: '3px solid', borderColor: 'primary.main', pl: 0.75,
        }),
      }}
    >
      <ButtonBase
        onClick={() => setPicking(true)}
        aria-label={`${t.replaceEmployee}: ${name}`}
        data-testid={`shift-select-${shift.missionId}-${shift.start}-${shift.employeeId}`}
        sx={{
          flex: '1 1 auto',
          minWidth: 0,
          // Capped on a wide screen so a long name wraps inside its own
          // control instead of stretching the table column past the viewport -
          // the failure `tests/mobile-viewports.mjs` checks for.
          maxWidth: { xs: '100%', sm: 260 },
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          textAlign: 'start',
          // Comfortably tappable without the height of a full text field.
          minHeight: 36,
        }}
      >
        <Typography
          variant="body2"
          sx={{ minWidth: 0, overflowWrap: 'anywhere', textAlign: 'start', lineHeight: 1.3 }}
        >
          {name}
        </Typography>
        <EditOutlinedIcon fontSize="small" sx={{ flex: '0 0 auto', color: 'text.secondary' }} />
      </ButtonBase>

      {shift.pinned && (
        // Badge and its clear button stay one unit so they never wrap apart.
        // Icon-only: a lock means the engine froze this shift because its time
        // already elapsed, a pin means a person chose it by hand - the text
        // label this used to carry is gone, so the distinction has to survive
        // on the icon and the tooltip alone.
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
          <Tooltip title={shift.frozen ? t.frozenPinNote : t.pinned}>
            <Chip
              size="small"
              icon={shift.frozen ? <LockIcon fontSize="small" /> : <PushPinIcon fontSize="small" />}
              label=""
              color="primary"
              variant="outlined"
              aria-label={shift.frozen ? t.frozenPinNote : t.pinned}
              sx={{
                maxWidth: '100%',
                // The icon's built-in margin assumes a label follows it; with
                // the label hidden that leaves lopsided padding on one side.
                '& .MuiChip-label': { display: 'none' },
                '& .MuiChip-icon': { m: 0 },
                px: 0.75,
              }}
              data-testid={`pinned-${shift.missionId}-${shift.start}`}
            />
          </Tooltip>
          <IconButton
            size="small"
            aria-label={t.clearPin}
            onClick={onClearPin}
            sx={{ p: 0.5 }}
            data-testid={`clear-pin-${shift.missionId}-${shift.start}`}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      <AssignDialog
        open={picking}
        shift={shift}
        employees={employees}
        busyElsewhere={busyElsewhere}
        onSelect={(employeeId) => { setPicking(false); onSwap(employeeId); }}
        onClose={() => setPicking(false)}
      />
    </Box>
  );
}
