import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { pb } from '../lib/pocketbase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useLocale } from '../lib/LocaleContext.jsx';
import { copyRosterText, rosterAsText } from '../lib/rosterExport.js';

const POSITION_COLORS = ['primary', 'secondary', 'success', 'warning', 'info', 'error'];

function positionColor(name) {
  let hash = 0;
  for (const character of name) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return POSITION_COLORS[Math.abs(hash) % POSITION_COLORS.length];
}

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
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);

  const load = async () => {
    const records = await pb.collection('shifts').getFullList({
      sort: 'start',
      expand: 'guard,position',
    });
    setShifts(records);
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    let unsubscribe;
    pb.collection('shifts')
      .subscribe('*', () => load())
      .then((fn) => {
        unsubscribe = fn;
      });
    return () => {
      window.clearInterval(timer);
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

  const visible = useMemo(() => shifts.filter((shift) => {
    if (!showPast && new Date(shift.end).getTime() <= now) return false;
    if (guardFilter !== 'all' && shift.expand?.guard?.id !== guardFilter) return false;
    return true;
  }), [shifts, showPast, guardFilter, now]);

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

  const handleCopy = async () => {
    await copyRosterText(rosterAsText(grouped, lang));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: { xs: 1.25, sm: 2 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} sx={{ mb: 1 }}>
        <Typography variant="h5">{t('roster.title')}</Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={<ContentCopyIcon />}
          onClick={handleCopy}
          disabled={grouped.length === 0}
          sx={{ flexShrink: 0 }}
        >
          {copied
            ? (lang === 'he' ? 'הועתק' : 'Copied')
            : (lang === 'he' ? 'העתקה כטקסט' : 'Copy as text')}
        </Button>
      </Stack>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label={t('roster.filterAll')}
          value={guardFilter}
          onChange={(event) => setGuardFilter(event.target.value)}
          sx={{ minWidth: { xs: '100%', sm: 180 } }}
        >
          <MenuItem value="all">{t('roster.filterAll')}</MenuItem>
          {allGuards.map(([id, name]) => (
            <MenuItem key={id} value={id}>{name}</MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={<Switch checked={showPast} onChange={(event) => setShowPast(event.target.checked)} />}
          label={t('roster.pastToggle')}
        />
      </Box>

      {grouped.length === 0 && <Typography color="text.secondary">{t('roster.empty')}</Typography>}

      {grouped.map((day) => (
        <Box key={day.label} sx={{ mb: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{day.label}</Typography>
          <Divider sx={{ mb: 1.5 }} />
          <Stack spacing={1.25}>
            {day.items.map((slot) => {
              const start = new Date(slot.start).getTime();
              const end = new Date(slot.end).getTime();
              const isCurrent = start <= now && now < end;
              const includesMe = slot.entries.some((entry) => entry.guardId === user?.id);
              return (
                <Paper
                  key={`${slot.start}-${slot.end}`}
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderWidth: isCurrent ? 2 : 1,
                    borderColor: isCurrent ? 'primary.main' : includesMe ? 'secondary.main' : 'divider',
                  }}
                >
                  <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      {formatRange(start, end, lang)}
                    </Typography>
                    {isCurrent && <Chip size="small" color="primary" label={t('roster.now')} />}
                  </Stack>
                  <Stack spacing={0.75} sx={{ mt: 1 }}>
                    {slot.entries.map((entry) => (
                      <Stack
                        key={`${entry.positionName}-${entry.guardId}`}
                        direction="row"
                        alignItems="center"
                        spacing={1}
                      >
                        <Chip
                          size="small"
                          color={positionColor(entry.positionName)}
                          label={entry.positionName}
                          sx={{ minWidth: 88, fontWeight: 700 }}
                        />
                        <Typography variant="body1" sx={{ fontWeight: entry.guardId === user?.id ? 700 : 400 }}>
                          {entry.guardName}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        </Box>
      ))}
    </Box>
  );
}
