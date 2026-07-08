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
      expand: 'guard,position',
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
      if (shift.expand?.guard) names.set(shift.expand.guard.id, shift.expand.guard.name);
    }
    return [...names.entries()];
  }, [shifts]);

  const now = Date.now();

  const visible = useMemo(() => {
    return shifts.filter((shift) => {
      if (!showPast && new Date(shift.end).getTime() < now) return false;
      if (guardFilter !== 'all' && shift.expand?.guard?.id !== guardFilter) return false;
      return true;
    });
  }, [shifts, showPast, guardFilter, now]);

  // Every position sharing a time-slot is now its own row, so group them back
  // into one displayed line per slot: "18:00 - 19:00: דרומי - Alice, ש''ג - Bob".
  const grouped = useMemo(() => {
    const byDay = new Map();
    for (const shift of visible) {
      const start = new Date(shift.start);
      const dayKey = start.toDateString();
      if (!byDay.has(dayKey)) byDay.set(dayKey, { label: dayLabel(start, lang), slots: new Map() });
      const day = byDay.get(dayKey);
      const slotKey = `${shift.start}-${shift.end}`;
      if (!day.slots.has(slotKey)) {
        day.slots.set(slotKey, { start: shift.start, end: shift.end, entries: [] });
      }
      day.slots.get(slotKey).entries.push({
        positionName: shift.expand?.position?.name || '?',
        guardName: shift.expand?.guard?.name || '?',
        guardId: shift.expand?.guard?.id,
      });
    }
    return [...byDay.values()].map((day) => ({
      label: day.label,
      items: [...day.slots.values()].sort((a, b) => new Date(a.start) - new Date(b.start)),
    }));
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
            {day.items.map((slot) => {
              const start = new Date(slot.start).getTime();
              const end = new Date(slot.end).getTime();
              const isCurrent = start <= now && now < end;
              const includesMe = slot.entries.some((e) => e.guardId === user?.id);
              return (
                <ListItem
                  key={`${slot.start}-${slot.end}`}
                  sx={{
                    bgcolor: isCurrent ? 'action.selected' : includesMe ? 'action.hover' : undefined,
                    borderRadius: 1,
                  }}
                >
                  <ListItemText
                    primary={formatRange(start, end, lang)}
                    secondary={slot.entries.map((e) => `${e.positionName} - ${e.guardName}`).join(', ')}
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
