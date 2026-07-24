import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { pb } from '../lib/pocketbase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useLocale } from '../lib/LocaleContext.jsx';

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function Guards() {
  const { isCommander } = useAuth();
  const { t } = useLocale();
  const [guards, setGuards] = useState([]);
  const [vacations, setVacations] = useState({});
  const [minSleep, setMinSleep] = useState({});
  const [error, setError] = useState(null);
  const [savingId, setSavingId] = useState(null);

  const load = async () => {
    const records = await pb.collection('users').getFullList({ sort: 'name' });
    setGuards(records);
    setVacations(Object.fromEntries(records.map((guard) => [guard.id, {
      start: toLocalInput(guard.vacation_start),
      end: toLocalInput(guard.vacation_end),
    }])));
    setMinSleep(Object.fromEntries(records.map((guard) => [guard.id, guard.min_sleep_hours || 0])));
  };

  useEffect(() => {
    if (isCommander) load().catch((err) => setError(err?.message || String(err)));
  }, [isCommander]);

  if (!isCommander) {
    return <Box sx={{ p: 3 }}><Alert severity="warning">{t('guards.forbidden')}</Alert></Box>;
  }

  const change = (id, field, value) => {
    setVacations((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  };

  const savePersonnel = async (guard) => {
    const vacation = vacations[guard.id] || {};
    if ((vacation.start && !vacation.end) || (!vacation.start && vacation.end)) {
      setError(t('guards.vacationBothRequired'));
      return;
    }
    if (vacation.start && new Date(vacation.end) <= new Date(vacation.start)) {
      setError(t('guards.vacationInvalid'));
      return;
    }
    setSavingId(guard.id);
    setError(null);
    try {
      await pb.collection('users').update(guard.id, {
        vacation_start: vacation.start ? new Date(vacation.start).toISOString() : '',
        vacation_end: vacation.end ? new Date(vacation.end).toISOString() : '',
        min_sleep_hours: Math.max(0, Number(minSleep[guard.id]) || 0),
      });
      await load();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSavingId(null);
    }
  };

  const setAccountState = async (guard, active) => {
    setSavingId(guard.id);
    setError(null);
    try {
      await pb.collection('users').update(guard.id, {
        active,
        ...(guard.approved ? {} : { approved: true }),
      });
      await load();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: 2 }}>
      <Typography variant="h5" gutterBottom>{t('guards.title')}</Typography>
      <Typography variant="body2" sx={{ mb: 2 }}>{t('guards.vacationHelp')}</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <List disablePadding>
        {guards.map((guard) => {
          const vacation = vacations[guard.id] || {};
          return (
            <Paper component={ListItem} key={guard.id} sx={{ display: 'block', mb: 1, p: 2 }}>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    {guard.name}
                    <Chip
                      size="small"
                      color={guard.active ? 'success' : guard.approved ? 'default' : 'warning'}
                      label={t(guard.active
                        ? 'guards.statusActive'
                        : guard.approved
                          ? 'guards.statusDisabled'
                          : 'guards.statusPending')}
                    />
                  </Box>
                }
                secondary={guard.email}
                sx={{ mb: 1 }}
              />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                <TextField
                  label={t('guards.minSleep')}
                  type="number"
                  value={minSleep[guard.id] ?? 0}
                  onChange={(event) => setMinSleep((current) => ({ ...current, [guard.id]: event.target.value }))}
                  InputProps={{ inputProps: { min: 0, step: 0.5 } }}
                  sx={{ width: 120 }}
                />
                <TextField label={t('guards.vacationStart')} type="datetime-local" value={vacation.start || ''}
                  onChange={(event) => change(guard.id, 'start', event.target.value)} InputLabelProps={{ shrink: true }} />
                <TextField label={t('guards.vacationEnd')} type="datetime-local" value={vacation.end || ''}
                  onChange={(event) => change(guard.id, 'end', event.target.value)} InputLabelProps={{ shrink: true }} />
                <Button variant="contained" onClick={() => savePersonnel(guard)} disabled={savingId === guard.id}>
                  {savingId === guard.id ? t('guards.saving') : t('guards.save')}
                </Button>
                {(vacation.start || vacation.end) && (
                  <Button onClick={() => setVacations((current) => ({ ...current, [guard.id]: { start: '', end: '' } }))}>
                    {t('guards.clearVacation')}
                  </Button>
                )}
                {guard.active ? (
                  <Button color="warning" onClick={() => setAccountState(guard, false)} disabled={savingId === guard.id}>
                    {t('guards.disable')}
                  </Button>
                ) : (
                  <Button color="success" onClick={() => setAccountState(guard, true)} disabled={savingId === guard.id}>
                    {t(guard.approved ? 'guards.reactivate' : 'guards.approve')}
                  </Button>
                )}
              </Box>
            </Paper>
          );
        })}
      </List>
    </Box>
  );
}
