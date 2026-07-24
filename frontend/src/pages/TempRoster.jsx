import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { pb } from '../lib/pocketbase.js';
import { TempRosterResponseSchema } from '../lib/schemas.js';
import { useLocale } from '../lib/LocaleContext.jsx';

function formatRange(start, end, lang) {
  const locale = lang === 'he' ? 'he-IL' : 'en-IL';
  const startFormat = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const endFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  return `${startFormat.format(start)} - ${endFormat.format(end)}`;
}

function dayLabel(date, lang) {
  return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-IL', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export default function TempRoster() {
  const { code = '' } = useParams();
  const { t, lang } = useLocale();
  const [shifts, setShifts] = useState([]);
  const [guardFilter, setGuardFilter] = useState('all');
  const [showPast, setShowPast] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await pb.send(`/api/guard/temp-login/${encodeURIComponent(code)}`);
        const records = TempRosterResponseSchema.parse(response);
        if (!cancelled) {
          setShifts(records);
          setError(null);
        }
      } catch {
        if (!cancelled) setError(t('tempRoster.invalid'));
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [code, t]);

  const allGuards = useMemo(() => {
    const names = new Map();
    for (const shift of shifts) {
      if (shift.guard) names.set(shift.guard.id, shift.guard.name);
    }
    return [...names.entries()];
  }, [shifts]);

  const now = Date.now();
  const visible = useMemo(() => shifts.filter((shift) => {
    if (!showPast && new Date(shift.end).getTime() < now) return false;
    return guardFilter === 'all' || shift.guard?.id === guardFilter;
  }), [shifts, showPast, guardFilter, now]);

  const grouped = useMemo(() => {
    const byDay = new Map();
    for (const shift of visible) {
      const start = new Date(shift.start);
      const dayKey = start.toDateString();
      if (!byDay.has(dayKey)) byDay.set(dayKey, { label: dayLabel(start, lang), slots: new Map() });
      const day = byDay.get(dayKey);
      const slotKey = `${shift.start}-${shift.end}`;
      if (!day.slots.has(slotKey)) day.slots.set(slotKey, { start: shift.start, end: shift.end, entries: [] });
      day.slots.get(slotKey).entries.push({
        positionName: shift.position?.name || '?',
        guardName: shift.guard?.name || '?',
      });
    }
    return [...byDay.values()].map((day) => ({
      label: day.label,
      items: [...day.slots.values()].sort((a, b) => new Date(a.start) - new Date(b.start)),
    }));
  }, [visible, lang]);

  if (error) {
    return <Box sx={{ maxWidth: 720, mx: 'auto', p: 2 }}><Alert severity="error">{error}</Alert></Box>;
  }

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: 2 }}>
      <Typography variant="h5" gutterBottom>{t('roster.title')}</Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <TextField select size="small" label={t('roster.filterAll')} value={guardFilter}
          onChange={(event) => setGuardFilter(event.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="all">{t('roster.filterAll')}</MenuItem>
          {allGuards.map(([id, name]) => <MenuItem key={id} value={id}>{name}</MenuItem>)}
        </TextField>
        <FormControlLabel control={<Switch checked={showPast} onChange={(event) => setShowPast(event.target.checked)} />}
          label={t('roster.pastToggle')} />
      </Box>

      {grouped.length === 0 && <Typography color="text.secondary">{t('roster.empty')}</Typography>}
      {grouped.map((day) => (
        <Box key={day.label} sx={{ mb: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{day.label}</Typography>
          <Divider sx={{ mb: 1 }} />
          <List dense>
            {day.items.map((slot) => {
              const start = new Date(slot.start).getTime();
              const end = new Date(slot.end).getTime();
              const isCurrent = start <= now && now < end;
              return (
                <ListItem key={`${slot.start}-${slot.end}`}
                  sx={{ bgcolor: isCurrent ? 'action.selected' : undefined, borderRadius: 1 }}>
                  <ListItemText primary={formatRange(start, end, lang)}
                    secondary={slot.entries.map((entry) => `${entry.positionName} - ${entry.guardName}`).join(', ')} />
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
