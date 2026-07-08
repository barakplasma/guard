import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Divider from '@mui/material/Divider';
import { pb } from '../lib/pocketbase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useLocale } from '../lib/LocaleContext.jsx';

function formatRange(start, end, lang) {
  const fmt = new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${fmt.format(start)} - ${new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-IL', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(end)}`;
}

function dayLabel(date, lang) {
  return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-IL', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export default function Roster() {
  const { user } = useAuth();
  const { t, lang } = useLocale();
  const [shifts, setShifts] = useState([]);
  const [guardFilter, setGuardFilter] = useState('all');
  const [showPast, setShowPast] = useState(false);

  const load = async () => {
    const records = await pb.collection('shifts').getFullList({
      sort: 'start',
      expand: 'guards',
    });
    setShifts(records);
  };

  useEffect(() => {
    load();
    let unsubscribe;
    pb.collection('shifts')
      .subscribe('*', () => load())
      .then((fn) => {
        unsubscribe = fn;
      });
    return () => {
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allGuards = useMemo(() => {
    const names = new Map();
    for (const shift of shifts) {
      for (const guard of shift.expand?.guards || []) {
        names.set(guard.id, guard.name);
      }
    }
    return [...names.entries()];
  }, [shifts]);

  const now = Date.now();

  const visible = useMemo(() => {
    return shifts.filter((shift) => {
      if (!showPast && new Date(shift.end).getTime() < now) return false;
      if (guardFilter !== 'all') {
        const ids = (shift.expand?.guards || []).map((g) => g.id);
        if (!ids.includes(guardFilter)) return false;
      }
      return true;
    });
  }, [shifts, showPast, guardFilter, now]);

  const grouped = useMemo(() => {
    const byDay = new Map();
    for (const shift of visible) {
      const start = new Date(shift.start);
      const key = start.toDateString();
      if (!byDay.has(key)) byDay.set(key, { label: dayLabel(start, lang), items: [] });
      byDay.get(key).items.push(shift);
    }
    return [...byDay.values()];
  }, [visible, lang]);

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: 2 }}>
      <Typography variant="h5" gutterBottom>
        {t('roster.title')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label={t('roster.filterAll')}
          value={guardFilter}
          onChange={(e) => setGuardFilter(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="all">{t('roster.filterAll')}</MenuItem>
          {allGuards.map(([id, name]) => (
            <MenuItem key={id} value={id}>
              {name}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={<Switch checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />}
          label={t('roster.pastToggle')}
        />
      </Box>

      {grouped.length === 0 && <Typography color="text.secondary">{t('roster.empty')}</Typography>}

      {grouped.map((day) => (
        <Box key={day.label} sx={{ mb: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {day.label}
          </Typography>
          <Divider sx={{ mb: 1 }} />
          <List dense>
            {day.items.map((shift) => {
              const start = new Date(shift.start).getTime();
              const end = new Date(shift.end).getTime();
              const isCurrent = start <= now && now < end;
              const guardNames = (shift.expand?.guards || []).map((g) => g.name);
              const includesMe = (shift.expand?.guards || []).some((g) => g.id === user?.id);
              return (
                <ListItem
                  key={shift.id}
                  sx={{
                    bgcolor: isCurrent ? 'action.selected' : includesMe ? 'action.hover' : undefined,
                    borderRadius: 1,
                  }}
                >
                  <ListItemText
                    primary={formatRange(start, end, lang)}
                    secondary={guardNames.join(', ')}
                  />
                  {isCurrent && <Chip size="small" color="primary" label={t('roster.now')} />}
                </ListItem>
              );
            })}
          </List>
        </Box>
      ))}
    </Box>
  );
}
