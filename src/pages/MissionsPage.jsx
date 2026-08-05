import {
  Box, Button, Chip, FormControl, IconButton, InputLabel, MenuItem,
  OutlinedInput, Paper, Select, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import DateTimeField from '../components/DateTimeField.jsx';
import SettingsBar from '../components/SettingsBar.jsx';
import { usePlan } from '../state/PlanContext.jsx';
import { t } from '../strings.js';

function MissionCard({ mission, doc, onChange, onRemove, onAssign }) {
  // Whole-window pins are the mission's "fixed" roster. Per-shift pins (which
  // carry a start/end) are manual swaps made on the schedule and are edited
  // there, so they are deliberately not shown in this picker.
  const assigned = doc.pins
    .filter((p) => p.missionId === mission.id && p.start == null && p.end == null)
    .map((p) => p.employeeId);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
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
            sx={{ marginInlineStart: 'auto' }}
            data-testid={`remove-mission-${mission.id}`}
          >
            <DeleteOutlineIcon />
          </IconButton>
        </Stack>

        <Typography variant="caption" color="text.secondary">
          {mission.type === 'remote' ? t.typeRemoteHelp : t.typeLocalHelp}
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
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
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                {ids.map((id) => (
                  <Chip
                    key={id}
                    size="small"
                    label={doc.employees.find((e) => e.id === id)?.name ?? id}
                  />
                ))}
              </Stack>
            )}
            data-testid={`assign-${mission.id}`}
          >
            {doc.employees.map((e) => (
              <MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>
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

  return (
    <Box>
      <SettingsBar />

      <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>{t.missions}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={addMission} data-testid="add-mission">
          {t.addMission}
        </Button>
      </Stack>

      <Stack spacing={2}>
        {doc.missions.length === 0 && (
          <Typography color="text.secondary">{t.noMissions}</Typography>
        )}
        {doc.missions.map((m) => (
          <MissionCard
            key={m.id}
            mission={m}
            doc={doc}
            onChange={(patch) => updateMission(m.id, patch)}
            onRemove={() => removeMission(m.id)}
            onAssign={(ids) => setMissionAssignees(m.id, ids)}
          />
        ))}
      </Stack>
    </Box>
  );
}
