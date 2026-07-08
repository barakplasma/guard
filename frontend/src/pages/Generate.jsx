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
  const [selectedGuards, setSelectedGuards] = useState([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [shiftMinutes, setShiftMinutes] = useState(60);
  const [positions, setPositions] = useState(1);
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
  }, [isCommander]);

  const guardIdToName = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);

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

  const runPreview = async () => {
    setError(null);
    setSaved(false);
    try {
      const startMs = toEpoch(start);
      const endMs = toEpoch(end);
      const guardNames = selectedGuards.map((id) => guardIdToName.get(id));

      const existingShifts = await pb.collection('shifts').getFullList({
        filter: `end > "${new Date().toISOString()}"`,
        expand: 'guards',
      });
      const existingForScheduler = existingShifts.map((s) => ({
        start: new Date(s.start).getTime(),
        end: new Date(s.end).getTime(),
        guards: (s.expand?.guards || []).map((g) => g.name),
      }));

      const newShifts = generateShifts({
        start: startMs,
        end: endMs,
        shiftMinutes: Number(shiftMinutes),
        positions: Number(positions),
        guards: guardNames,
        existingShifts: existingForScheduler,
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
        positions: Number(positions),
        created_by: pb.authStore.record.id,
      });

      const nameToId = new Map(users.map((u) => [u.name, u.id]));
      const batch = pb.createBatch();
      for (const shift of preview.shifts) {
        batch.collection('shifts').create({
          schedule: scheduleRecord.id,
          start: new Date(shift.start).toISOString(),
          end: new Date(shift.end).toISOString(),
          guards: shift.guards.map((name) => nameToId.get(name)),
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
        <TextField
          label={t('generate.positions')}
          type="number"
          value={positions}
          onChange={(e) => setPositions(e.target.value)}
        />

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
          <Button variant="outlined" onClick={runPreview} disabled={!start || !end}>
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
            {preview.shifts.map((shift, i) => (
              <ListItem key={i}>
                <ListItemText
                  primary={`${new Date(shift.start).toLocaleString(lang === 'he' ? 'he-IL' : 'en-IL')} - ${new Date(
                    shift.end,
                  ).toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-IL')}`}
                  secondary={shift.guards.join(', ')}
                />
              </ListItem>
            ))}
          </List>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2">{t('generate.hoursPerGuard')}</Typography>
          {[...preview.stats.hoursPerGuard.entries()].map(([name, hours]) => (
            <Typography key={name} variant="body2">
              {name}: {hours.toFixed(1)}h
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
