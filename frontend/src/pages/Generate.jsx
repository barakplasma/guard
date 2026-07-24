import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import { pb } from '../lib/pocketbase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useLocale } from '../lib/LocaleContext.jsx';
import { generateShifts, computeStats } from '../lib/scheduler.js';

function toEpoch(datetimeLocalValue) {
  return new Date(datetimeLocalValue).getTime();
}

export default function Generate() {
  const { isCommander } = useAuth();
  const { t, lang } = useLocale();

  const [users, setUsers] = useState([]);
  const [positions, setPositions] = useState([]);
  const [selectedGuards, setSelectedGuards] = useState([]);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [shiftMinutes, setShiftMinutes] = useState(60);
  const [restMinutes, setRestMinutes] = useState(0);
  const [fairnessWindowHours, setFairnessWindowHours] = useState(0);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isCommander) return;
    pb.collection('users')
      .getFullList({ filter: 'active = true', sort: 'name' })
      .then((records) => {
        setUsers(records);
        setSelectedGuards(records.map((r) => r.id));
      });
    pb.collection('positions')
      .getFullList({ filter: 'active = true', sort: 'name' })
      .then((records) => {
        setPositions(records);
        setSelectedPositions(records.map((r) => r.id));
      });
  }, [isCommander]);

  const guardIdToName = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const positionById = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);

  // Multiple positions share the same start/end now, so group rows by slot
  // for a readable preview: "18:00 - 19:00: דרומי - Alice, ש''ג - Bob".
  const groupedPreview = useMemo(() => {
    if (!preview) return [];
    const bySlot = new Map();
    for (const shift of preview.shifts) {
      const key = `${shift.start}-${shift.end}`;
      if (!bySlot.has(key)) bySlot.set(key, { start: shift.start, end: shift.end, entries: [] });
      bySlot.get(key).entries.push({
        positionName: positionById.get(shift.position)?.name || shift.position,
        guard: guardIdToName.get(shift.guard) || shift.guard,
      });
    }
    return [...bySlot.values()].sort((a, b) => a.start - b.start);
  }, [preview, positionById, guardIdToName]);

  if (!isCommander) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">{t('generate.forbidden')}</Alert>
      </Box>
    );
  }

  const toggleGuard = (id) => {
    setSelectedGuards((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  };

  const togglePosition = (id) => {
    setSelectedPositions((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };

  const runPreview = async () => {
    setError(null);
    setSaved(false);
    try {
      const startMs = toEpoch(start);
      const endMs = toEpoch(end);
      // The scheduler is keyed by stable user IDs, not display names (names
      // aren't unique - two namesakes would otherwise collapse and a shift could
      // be saved against the wrong person). Assigned guards are already stored as
      // IDs on the position, so they pass straight through.
      const unavailablePeriods = Object.fromEntries(
        users
          .filter((user) => user.vacation_start && user.vacation_end)
          .map((user) => [user.id, [{
            start: new Date(user.vacation_start).getTime(),
            end: new Date(user.vacation_end).getTime(),
          }]]),
      );
      const positionDescriptors = selectedPositions.map((id) => {
        const p = positionById.get(id);
        return {
          id: p.id,
          name: p.name,
          timeRestricted: p.time_restricted,
          windowStart: p.window_start,
          windowEnd: p.window_end,
          headcount: p.headcount,
          guards: p.guards || [],
        };
      });
      // A position's assigned guards must be schedulable even if unchecked in
      // the general list, so the pool is the union of both (the scheduler
      // rejects assigned guards that aren't in the pool).
      const guardIds = [...new Set([...selectedGuards, ...positionDescriptors.flatMap((p) => p.guards)])];

      const existingShifts = await pb.collection('shifts').getFullList({
        filter: `end > "${new Date().toISOString()}"`,
      });
      const existingForScheduler = existingShifts.map((s) => ({
        start: new Date(s.start).getTime(),
        end: new Date(s.end).getTime(),
        guard: s.guard,
        position: s.position,
      }));

      const fairnessWindowMinutes = Number(fairnessWindowHours) > 0 ? Number(fairnessWindowHours) * 60 : null;
      const newShifts = generateShifts({
        start: startMs,
        end: endMs,
        shiftMinutes: Number(shiftMinutes),
        positions: positionDescriptors,
        guards: guardIds,
        existingShifts: existingForScheduler,
        unavailablePeriods,
        restMinutes: Number(restMinutes),
        fairnessWindowMinutes,
      });

      const stats = computeStats([...existingForScheduler, ...newShifts]);
      setPreview({ shifts: newShifts, stats });
    } catch (err) {
      setError(t('generate.error', { error: err?.message || String(err) }));
      setPreview(null);
    }
  };

  const save = async () => {
    if (!preview) return;
    setSaving(true);
    setError(null);
    let scheduleRecord;
    try {
      scheduleRecord = await pb.collection('schedules').create({
        start: new Date(toEpoch(start)).toISOString(),
        end: new Date(toEpoch(end)).toISOString(),
        shift_minutes: Number(shiftMinutes),
        positions: selectedPositions,
        created_by: pb.authStore.record.id,
      });

      const batch = pb.createBatch();
      for (const shift of preview.shifts) {
        batch.collection('shifts').create({
          schedule: scheduleRecord.id,
          position: shift.position,
          start: new Date(shift.start).toISOString(),
          end: new Date(shift.end).toISOString(),
          guard: shift.guard, // already a stable user id from the scheduler
        });
      }
      await batch.send();

      setSaved(true);
      setPreview(null);
    } catch (err) {
      // Clean up the schedule (and any shifts already committed via the batch's
      // own transaction) rather than leaving an empty/partial batch behind.
      if (scheduleRecord) {
        await pb.collection('schedules').delete(scheduleRecord.id).catch(() => {});
      }
      setError(t('generate.error', { error: err?.message || String(err) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: 2 }}>
      <Typography variant="h5" gutterBottom>
        {t('generate.title')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {saved && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {t('generate.save')} ✓
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
        <TextField
          label={t('generate.start')}
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label={t('generate.end')}
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label={t('generate.shiftMinutes')}
          type="number"
          value={shiftMinutes}
          onChange={(e) => setShiftMinutes(e.target.value)}
        />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {[30, 60, 90, 120, 180].map((minutes) => (
            <Button
              key={minutes}
              size="small"
              variant={Number(shiftMinutes) === minutes ? 'contained' : 'outlined'}
              onClick={() => setShiftMinutes(minutes)}
            >
              {minutes}m
            </Button>
          ))}
        </Box>
        <TextField
          label={t('generate.restMinutes')}
          type="number"
          value={restMinutes}
          onChange={(e) => setRestMinutes(e.target.value)}
          helperText={t('generate.restMinutesHelp')}
          InputProps={{ inputProps: { min: 0 } }}
        />
        <TextField
          label={t('generate.fairnessWindowHours')}
          type="number"
          value={fairnessWindowHours}
          onChange={(e) => setFairnessWindowHours(e.target.value)}
          helperText={t('generate.fairnessWindowHelp')}
          InputProps={{ inputProps: { min: 0 } }}
        />

        <Typography variant="subtitle2">{t('generate.positions')}</Typography>
        {positions.length === 0 ? (
          <Alert severity="info">{t('generate.noPositions')}</Alert>
        ) : (
          <FormGroup row>
            {positions.map((p) => (
              <FormControlLabel
                key={p.id}
                control={<Checkbox checked={selectedPositions.includes(p.id)} onChange={() => togglePosition(p.id)} />}
                label={p.name}
              />
            ))}
          </FormGroup>
        )}

        <Typography variant="subtitle2">{t('generate.guards')}</Typography>
        <FormGroup row>
          {users.map((u) => (
            <FormControlLabel
              key={u.id}
              control={<Checkbox checked={selectedGuards.includes(u.id)} onChange={() => toggleGuard(u.id)} />}
              label={u.name}
            />
          ))}
        </FormGroup>

        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button variant="outlined" onClick={runPreview} disabled={!start || !end || selectedPositions.length === 0}>
            {t('generate.preview')}
          </Button>
          <Button variant="contained" onClick={save} disabled={!preview || saving}>
            {saving ? t('generate.saving') : t('generate.save')}
          </Button>
        </Box>
      </Box>

      {preview && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6">{t('generate.previewTitle')}</Typography>
          <List dense>
            {groupedPreview.map((slot, i) => (
              <ListItem key={i}>
                <ListItemText
                  primary={`${new Date(slot.start).toLocaleString(lang === 'he' ? 'he-IL' : 'en-IL')} - ${new Date(
                    slot.end,
                  ).toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-IL')}`}
                  secondary={slot.entries.map((e) => `${e.positionName} - ${e.guard}`).join(', ')}
                />
              </ListItem>
            ))}
          </List>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2">{t('generate.hoursPerGuard')}</Typography>
          {[...preview.stats.hoursPerGuard.entries()].map(([id, hours]) => (
            <Typography key={id} variant="body2">
              {guardIdToName.get(id) || id}: {hours.toFixed(1)}h
            </Typography>
          ))}
          {preview.stats.variance !== null && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {t('stats.variance', { variance: preview.stats.variance.toFixed(3) })}
            </Typography>
          )}
        </Paper>
      )}
    </Box>
  );
}
