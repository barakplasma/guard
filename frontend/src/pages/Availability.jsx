import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { pb } from '../lib/pocketbase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useLocale } from '../lib/LocaleContext.jsx';

function isOnVacation(user, now) {
  if (!user.vacation_start || !user.vacation_end) return false;
  return new Date(user.vacation_start).getTime() <= now && now < new Date(user.vacation_end).getTime();
}

function GuardList({ title, guards, emptyText, chip }) {
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">{title}</Typography>
      {guards.length === 0 ? (
        <Typography color="text.secondary" sx={{ mt: 1 }}>{emptyText}</Typography>
      ) : (
        <List dense disablePadding>
          {guards.map((guard) => (
            <ListItem key={guard.id} secondaryAction={chip ? <Chip size="small" {...chip(guard)} /> : null}>
              <ListItemText primary={guard.name} secondary={guard.email} />
            </ListItem>
          ))}
        </List>
      )}
    </Paper>
  );
}

export default function Availability() {
  const { isCommander } = useAuth();
  const { t, lang } = useLocale();
  const [users, setUsers] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const loadedAt = new Date().toISOString();
      const [userRecords, shiftRecords] = await Promise.all([
        pb.collection('users').getFullList({ filter: 'approved = true && active = true', sort: 'name' }),
        pb.collection('shifts').getFullList({
          filter: `end > "${loadedAt}"`,
          expand: 'guard,position',
        }),
      ]);
      setUsers(userRecords);
      setShifts(shiftRecords);
      setNow(Date.now());
      setError(null);
    } catch (err) {
      setError(err?.message || String(err));
    }
  }, []);

  useEffect(() => {
    if (!isCommander) return undefined;
    load();
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    let unsubscribeUsers;
    let unsubscribeShifts;
    pb.collection('users').subscribe('*', load).then((fn) => { unsubscribeUsers = fn; });
    pb.collection('shifts').subscribe('*', load).then((fn) => { unsubscribeShifts = fn; });
    return () => {
      window.clearInterval(timer);
      unsubscribeUsers?.();
      unsubscribeShifts?.();
    };
  }, [isCommander, load]);

  const groups = useMemo(() => {
    const onDutyIds = new Set(shifts
      .filter((shift) => new Date(shift.start).getTime() <= now && now < new Date(shift.end).getTime())
      .map((shift) => shift.guard));
    return {
      available: users.filter((user) => !isOnVacation(user, now) && !onDutyIds.has(user.id)),
      onDuty: users.filter((user) => !isOnVacation(user, now) && onDutyIds.has(user.id)),
      vacation: users.filter((user) => isOnVacation(user, now)),
    };
  }, [users, shifts, now]);

  const positionByGuard = useMemo(() => new Map(shifts
    .filter((shift) => new Date(shift.start).getTime() <= now && now < new Date(shift.end).getTime())
    .map((shift) => [
      shift.guard,
      shift.expand?.position?.name || t('availability.onDuty'),
    ])), [shifts, now, t]);

  if (!isCommander) {
    return <Box sx={{ p: 3 }}><Alert severity="warning">{t('availability.forbidden')}</Alert></Box>;
  }

  const vacationChip = (guard) => ({
    label: new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-IL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(guard.vacation_end)),
    color: 'warning',
  });

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: 2 }}>
      <Typography variant="h5" gutterBottom>{t('availability.title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('availability.help')}
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Box sx={{ display: 'grid', gap: 2 }}>
        <GuardList title={t('availability.available')} guards={groups.available}
          emptyText={t('availability.noneAvailable')} />
        <GuardList title={t('availability.onDuty')} guards={groups.onDuty}
          emptyText={t('availability.noneOnDuty')}
          chip={(guard) => ({ label: positionByGuard.get(guard.id), color: 'info' })} />
        <GuardList title={t('availability.onVacation')} guards={groups.vacation}
          emptyText={t('availability.noneOnVacation')} chip={vacationChip} />
      </Box>
    </Box>
  );
}
