import { useState } from 'react';
import {
  Box, Button, Checkbox, Chip, FormControl, FormControlLabel, IconButton, InputLabel, MenuItem,
  OutlinedInput, Paper, Select, Stack, Switch, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import DateTimeField from '../components/DateTimeField.jsx';
import NumberField from '../components/NumberField.jsx';
import DailyClockField from '../components/DailyClockField.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { usePlan } from '../state/PlanContext.jsx';
import { sortByHebrewName } from '../lib/sort.js';
import { nextTopOfHour } from '../lib/planSchema.js';
import { t } from '../strings.js';
import { MissionQualifications } from '../components/Qualifications.jsx';

function MissionCard({ mission, doc, onChange, onRemove, onAssign }) {
  // Anyone holding a pin on this mission is on its roster. A whole-mission
  // assignment does not stay whole: clearing or swapping a single shift cuts
  // it into ranges (see cutPin in pins.js), and listing only the untouched
  // null/null pins would drop someone who still works six days of seven the
  // moment one hour of theirs changed hands. They are listed with a "partial"
  // marker instead; unticking them still releases every pin they hold here.
  const missionPins = doc.pins.filter((p) => p.missionId === mission.id);
  const assigned = [...new Set(missionPins.map((p) => p.employeeId))];
  const partiallyAssigned = (employeeId) => !missionPins.some(
    (p) => p.employeeId === employeeId && p.start == null && p.end == null,
  );

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

  // A mission with a start but no end runs to the plan's end, and keeps
  // following that boundary if the period is later extended.
  const openEnded = mission.end == null;

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
            <ToggleButton value="daily" data-testid={`type-daily-${mission.id}`}>{t.typeDaily}</ToggleButton>
            <ToggleButton value="remote" data-testid={`type-remote-${mission.id}`}>
              {t.typeRemote}
            </ToggleButton>
          </ToggleButtonGroup>

          <NumberField label={mission.type === 'daily' ? t.headcountPerOccurrence : mission.type === 'remote' ? t.headcount : t.headcountDay} value={mission.count}
            testId={`mission-count-${mission.id}`}
            onChange={(value) => onChange({ count: value })} />

          {/*
            Remote missions are held end to end by one set of people, so there is
            no night shift to staff differently and the field would only mislead.
            Left blank it stays null, i.e. "same as by day", and follows the
            field beside it.
          */}
          {mission.type === 'local' && (
            <Tooltip title={t.headcountNightHelp}>
              <NumberField label={t.headcountNight} value={mission.nightCount}
                nullable fallbackValue={mission.count} testId={`mission-night-count-${mission.id}`}
                onChange={(value) => onChange({ nightCount: value })} />
            </Tooltip>
          )}

          <Tooltip title={t.onCallHelp}>
            <FormControlLabel
              sx={{ flexShrink: 0 }}
              control={(
                <Switch
                  size="small"
                  checked={mission.onCall ?? false}
                  onChange={(e) => onChange({ onCall: e.target.checked })}
                  data-testid={`mission-oncall-${mission.id}`}
                />
              )}
              label={t.onCall}
            />
          </Tooltip>

          <IconButton
            aria-label={t.remove}
            onClick={onRemove}
            sx={{ marginInlineStart: 'auto', p: 1 }}
            data-testid={`remove-mission-${mission.id}`}
          >
            <DeleteOutlineIcon />
          </IconButton>
        </Stack>

        {/*
          How long one of this mission's own shifts is, by day and by night.
          Remote missions have no shifts to size - one set of people holds the
          whole window - so the pair is hidden there exactly like the night
          headcount. Left blank each field inherits: the day length from the
          plan's default, the night length from the day one.
        */}
        {mission.type === 'local' && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: { xs: 'stretch', sm: 'center' } }}>
            <Tooltip title={t.shiftLengthDayHelp}>
              <NumberField label={t.shiftLengthDay} value={mission.shiftMinutes}
                nullable min={5} max={1440} step={5} fallbackValue={doc.shiftMinutes} testId={`mission-shift-${mission.id}`}
                onChange={(value) => onChange({ shiftMinutes: value })} />
            </Tooltip>
            <Tooltip title={t.shiftLengthNightHelp}>
              <NumberField label={t.shiftLengthNight} value={mission.nightShiftMinutes}
                nullable min={5} max={1440} step={5} fallbackValue={mission.shiftMinutes ?? doc.shiftMinutes} testId={`mission-night-shift-${mission.id}`}
                onChange={(value) => onChange({ nightShiftMinutes: value })} />
            </Tooltip>
          </Stack>
        )}

        {mission.type === 'daily' && (
          <Stack direction="row" useFlexGap spacing={2} sx={{ flexWrap: 'wrap' }}>
            {['dayStart', 'dayEnd'].map((field) => (
              <DailyClockField key={field} label={field === 'dayStart' ? t.dailyFrom : t.dailyTo}
                value={mission[field]} onChange={(value) => onChange({ [field]: value })}
                testId={`mission-day-${field === 'dayStart' ? 'start' : 'end'}-${mission.id}`} />
            ))}
            <Typography variant="caption" sx={{ width: '100%' }}>
              {mission.dayStart == null || mission.dayEnd == null ? t.dailyIncomplete
                : mission.dayEnd <= mission.dayStart ? t.dailyNextDay : ''}
            </Typography>
          </Stack>
        )}

        <Typography variant="caption" color="text.secondary">
          {mission.type === 'daily' ? t.typeDailyHelp : mission.type === 'remote' ? t.typeRemoteHelp : t.typeLocalHelp}
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: { xs: 'stretch', sm: 'center' } }}>
          {mission.start != null || mission.end != null ? (
            <>
              <DateTimeField
                label={t.missionStart}
                value={mission.start ?? doc.start}
                onChange={(v) => onChange({ start: v })}
                testId={`mission-start-${mission.id}`}
              />
              {!openEnded && (
                <DateTimeField
                  label={t.missionEnd}
                  value={mission.end ?? doc.end}
                  onChange={(v) => onChange({ end: v })}
                  testId={`mission-end-${mission.id}`}
                />
              )}
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={openEnded}
                    onChange={(_, checked) => onChange({ end: checked ? null : doc.end })}
                    slotProps={{ input: { 'data-testid': `mission-open-ended-${mission.id}` } }}
                  />
                )}
                label={t.missionNoEnd}
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
          {mission.type === 'remote' && (
            <Tooltip title={t.missionReturnedNowHelp}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => onChange({ end: nextTopOfHour(Date.now()) })}
                data-testid={`mission-returned-now-${mission.id}`}
              >
                {t.missionReturnedNow}
              </Button>
            </Tooltip>
          )}
        </Stack>

        <MissionQualifications mission={mission} onChange={onChange} />
        {openEnded && (
          <Typography variant="caption" color="text.secondary">
            {t.missionNoEndHelp}
          </Typography>
        )}

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
                {ids.map((id) => {
                  const name = doc.employees.find((e) => e.id === id)?.name ?? id;
                  return (
                    <Chip
                      key={id}
                      size="small"
                      color={unavailableFor(id) ? 'warning' : 'default'}
                      label={partiallyAssigned(id) ? `${name} · ${t.assignedPartially}` : name}
                    />
                  );
                })}
              </Stack>
            )}
            data-testid={`assign-${mission.id}`}
          >
            {sortByHebrewName(doc.employees).map((e) => (
              <MenuItem key={e.id} value={e.id} sx={unavailableFor(e.id) ? { color: 'warning.main' } : undefined}>
                {e.name}
                {unavailableFor(e.id) ? ` — ${t.unavailable}` : ''}
                {partiallyAssigned(e.id) && assigned.includes(e.id) ? ` — ${t.assignedPartially}` : ''}
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
