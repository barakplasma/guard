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

function relationId(value) {
  if (Array.isArray(value)) return relationId(value[0]);
  if (value && typeof value === 'object') return value.id;
  return value || null;
}

function isOnVacation(user, now) {
  if (!user.vacation_start || !user.vacation_end) return false;
  return new Date(user.vacation_start).getTime() <= now && now < new Date(user.vacation_end).getTime();
}

function formatDateTime(value, lang) {
  return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function GuardList({ title, guards, emptyText, chip, secondary }) {
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">{title}</Typography>
      {guards.length === 0 ? (
        <Typography color="text.secondary" sx={{ mt: 1 }}>{emptyText}</Typography>
      ) : (
        <List dense disablePadding>
          {guards.map((guard) => (
            <ListItem key={guard.id} secondaryAction={chip ? <Chip size="small" {...chip(guard)} /> : null}>
              <ListItemText primary={guard.name || '—'} secondary={secondary?.(guard) || null} />
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
      const [userRecords, shiftRecords] = await Promise.all([
        pb.collection('users').getFullList({ filter: 'approved = true && active = true', sort: 'name' }),
        pb.collection('shifts').getFullList({
          sort: '-end',
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

  const currentAssignments = useMemo(() => {
    const assignments = new Map();
    for (const shift of shifts) {
      const start = new Date(shift.start).getTime();
      const end = new Date(shift.end).getTime();
      if (!(start <= now && now < end)) continue;
      const guardId = relationId(shift.guard) || shift.expand?.guard?.id;
      if (!guardId) continue;
      const existing = assignments.get(guardId) || { positions: [], end: shift.end };
      const position = shift.expand?.position?.name || '?';
      if (!existing.positions.includes(position)) existing.positions.push(position);
      if (new Date(shift.end) > new Date(existing.end)) existing.end = shift.end;
      assignments.set(guardId, existing);
    }
    return assignments;
  }, [shifts, now]);

  const lastShiftByGuard = useMemo(() => {
    const last = new Map();
    for (const shift of shifts) {
      const end = new Date(shift.end).getTime();
      if (end > now) continue;
      const guardId = relationId(shift.guard) || shift.expand?.guard?.id;
      if (!guardId || last.has(guardId)) continue;
      last.set(guardId, shift);
    }
    return last;
  }, [shifts, now]);

  const groups = useMemo(() => {
    const byName = (a, b) => (a.name || '').localeCompare(b.name || '', lang === 'he' ? 'he' : 'en');
    const byOldestLastShift = (a, b) => {
      const aEnd = lastShiftByGuard.has(a.id)
        ? new Date(lastShiftByGuard.get(a.id).end).getTime()
        : Number.NEGATIVE_INFINITY;
      const bEnd = lastShiftByGuard.has(b.id)
        ? new Date(lastShiftByGuard.get(b.id).end).getTime()
        : Number.NEGATIVE_INFINITY;
      return aEnd - bEnd || byName(a, b);
    };

    return {
      available: users
        .filter((user) => !isOnVacation(user, now) && !currentAssignments.has(user.id))
        .sort(byOldestLastShift),
      onDuty: users
        .filter((user) => !isOnVacation(user, now) && currentAssignments.has(user.id))
        .sort(byName),
      vacation: users.filter((user) => isOnVacation(user, now)).sort(byName),
    };
  }, [users, now, currentAssignments, lastShiftByGuard, lang]);

  if (!isCommander) {
    return <Box sx={{ p: 3 }}><Alert severity="warning">{t('availability.forbidden')}</Alert></Box>;
  }

  const vacationChip = (guard) => ({
    label: formatDateTime(guard.vacation_end, lang),
    color: 'warning',
  });

  const onDutySecondary = (guard) => {
    const assignment = currentAssignments.get(guard.id);
    if (!assignment) return null;
    const until = new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-IL', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(assignment.end));
    return lang === 'he'
      ? `${assignment.positions.join(', ')} · עד ${until}`
      : `${assignment.positions.join(', ')} · until ${until}`;
  };

  const availableSecondary = (guard) => {
    const lastShift = lastShiftByGuard.get(guard.id);
    if (!lastShift) return lang === 'he' ? 'טרם שובץ למשמרת' : 'No previous guard shift';
    const formatted = formatDateTime(lastShift.end, lang);
    return lang === 'he' ? `משמרת אחרונה הסתיימה: ${formatted}` : `Last guard shift ended: ${formatted}`;
  };

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: 2 }}>
      <Typography variant="h5" gutterBottom>{t('availability.title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('availability.help')}
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Box sx={{ display: 'grid', gap: 2 }}>
        <GuardList
          title={t('availability.onDuty')}
          guards={groups.onDuty}
          emptyText={t('availability.noneOnDuty')}
          secondary={onDutySecondary}
          chip={(guard) => ({
            label: currentAssignments.get(guard.id)?.positions.join(', ') || t('availability.onDuty'),
            color: 'info',
          })}
        />
        <GuardList
          title={t('availability.available')}
          guards={groups.available}
          emptyText={t('availability.noneAvailable')}
          secondary={availableSecondary}
        />
        <GuardList
          title={t('availability.onVacation')}
          guards={groups.vacation}
          emptyText={t('availability.noneOnVacation')}
          chip={vacationChip}
        />
      </Box>
    </Box>
  );
}
