import { useState } from 'react';
import {
  Box, Button, Chip, FormControl, IconButton, InputLabel, MenuItem,
  OutlinedInput, Paper, Select, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import DateTimeField from '../components/DateTimeField.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { usePlan } from '../state/PlanContext.jsx';
import { sortByHebrewName } from '../lib/sort.js';
import { t } from '../strings.js';

function MissionCard({ mission, doc, onChange, onRemove, onAssign }) {
  // Whole-window pins are the mission's "fixed" roster. Per-shift pins (which
  // carry a start/end) are manual swaps made on the schedule and are edited
  // there, so they are deliberately not shown in this picker.
  const assigned = doc.pins
    .filter((p) => p.missionId === mission.id && p.start == null && p.end == null)
    .map((p) => p.employeeId);

  // A whole-mission assignment needs the person available for the mission's
  // entire window - the planner clamps it to that regardless (see
  // normalizePins in planner.js), so anyone who does not cover it gets their
  // pin silently dropped with a warning the picker itself never showed.
  // Flagging it here, the same way the schedule's per-shift dropdown already
  // does, is what stops someone from disappearing after being "assigned" with
  // no visible reason why.
  const missionStart = mission.start ?? doc.start;
  const missionEnd = mission.end ?? doc.end;
  const unavailableFor = (employeeId) => {
    const e = doc.employees.find((x) => x.id === employeeId);
    if (!e) return false;
    return (e.start ?? -Infinity) > missionStart || (e.end ?? Infinity) < missionEnd;
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}>
          <TextField
            label={t.missionName}
            value={mission.name}
            onChange={(e) => onChange({ name: e.target.value })}
            sx={{ flex: 1, minWidth: 160 }}
            slotProps={{ htmlInput: { 'data-testid': `mission-name-${mission.id}` } }}
          />

          <ToggleButtonGroup
            exclusive
            size="small"
            value={mission.type}
            onChange={(_, v) => v && onChange({ type: v })}
          >
            <ToggleButton value="local" data-testid={`type-local-${mission.id}`}>
              {t.typeLocal}
            </ToggleButton>
            <ToggleButton value="remote" data-testid={`type-remote-${mission.id}`}>
              {t.typeRemote}
            </ToggleButton>
          </ToggleButtonGroup>

          <TextField
            label={t.headcount}
            type="number"
            value={mission.count}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1) onChange({ count: n });
            }}
            slotProps={{ htmlInput: { min: 1, 'data-testid': `mission-count-${mission.id}` } }}
            sx={{ width: 120 }}
          />

          <IconButton
            aria-label={t.remove}
            onClick={onRemove}
            sx={{ marginInlineStart: 'auto', p: 1 }}
            data-testid={`remove-mission-${mission.id}`}
          >
            <DeleteOutlineIcon />
          </IconButton>
        </Stack>

        <Typography variant="caption" color="text.secondary">
          {mission.type === 'remote' ? t.typeRemoteHelp : t.typeLocalHelp}
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}>
          {mission.start != null || mission.end != null ? (
            <>
              <DateTimeField
                label={t.missionStart}
                value={mission.start ?? doc.start}
                onChange={(v) => onChange({ start: v })}
              />
              <DateTimeField
                label={t.missionEnd}
                value={mission.end ?? doc.end}
                onChange={(v) => onChange({ end: v })}
              />
              <Button size="small" onClick={() => onChange({ start: null, end: null })}>
                {t.wholePeriod}
              </Button>
            </>
          ) : (
            <Chip
              label={t.wholePeriod}
              variant="outlined"
              onClick={() => onChange({ start: doc.start, end: doc.end })}
              data-testid={`limit-mission-${mission.id}`}
            />
          )}
        </Stack>

        <FormControl fullWidth>
          <InputLabel id={`assign-${mission.id}`}>
            {`${t.assignedPeople} (${assigned.length}/${mission.count})`}
          </InputLabel>
          <Select
            labelId={`assign-${mission.id}`}
            multiple
            value={assigned}
            onChange={(e) => onAssign(
              typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value,
            )}
            input={<OutlinedInput label={`${t.assignedPeople} (${assigned.length}/${mission.count})`} />}
            renderValue={(ids) => (
              <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {ids.map((id) => (
                  <Chip
                    key={id}
                    size="small"
                    color={unavailableFor(id) ? 'warning' : 'default'}
                    label={doc.employees.find((e) => e.id === id)?.name ?? id}
                  />
                ))}
              </Stack>
            )}
            data-testid={`assign-${mission.id}`}
          >
            {sortByHebrewName(doc.employees).map((e) => (
              <MenuItem key={e.id} value={e.id} sx={unavailableFor(e.id) ? { color: 'warning.main' } : undefined}>
                {e.name}
                {unavailableFor(e.id) ? ` — ${t.unavailable}` : ''}
              </MenuItem>
            ))}
          </Select>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            {t.assignedHelp}
          </Typography>
        </FormControl>
      </Stack>
    </Paper>
  );
}

export default function MissionsPage() {
  const { doc, addMission, updateMission, removeMission, setMissionAssignees } = usePlan();
  const [pendingRemove, setPendingRemove] = useState(null);

  return (
    <Box>
      <Stack direction="row" sx={{ mb: 2, alignItems: 'center' }}>
        <Typography variant="h6" sx={{ flex: 1 }}>{t.missions}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={addMission} data-testid="add-mission">
          {t.addMission}
        </Button>
      </Stack>

      <Stack spacing={2}>
        {doc.missions.length === 0 && (
          <>
            <Typography color="text.secondary">{t.noMissions}</Typography>
            <Typography variant="caption" color="text.secondary">{t.emptyMissionsHint}</Typography>
          </>
        )}
        {doc.missions.map((m) => (
          <MissionCard
            key={m.id}
            mission={m}
            doc={doc}
            onChange={(patch) => updateMission(m.id, patch)}
            onRemove={() => setPendingRemove(m)}
            onAssign={(ids) => setMissionAssignees(m.id, ids)}
          />
        ))}
      </Stack>

      <ConfirmDialog
        open={pendingRemove != null}
        title={t.confirmRemoveMissionTitle}
        body={pendingRemove && t.confirmRemoveMissionBody(
          pendingRemove.name || t.missionName,
          doc.pins.filter((p) => p.missionId === pendingRemove.id).length,
        )}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          removeMission(pendingRemove.id);
          setPendingRemove(null);
        }}
        confirmTestId="confirm-remove-mission"
        cancelTestId="cancel-remove-mission"
      />
    </Box>
  );
}
