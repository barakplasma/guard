import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import { pb } from '../lib/pocketbase.js';
import { useLocale } from '../lib/LocaleContext.jsx';
import { computeStats } from '../lib/scheduler.js';
import { sleepReport } from '../lib/sleep.js';

function todayStr() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Build the [start, end) night window from a local date + "HH:MM" bounds.
// An overnight window (end at/before start, e.g. 22:00-06:00) ends on the
// following local calendar day. We advance the day field and let the Date
// constructor resolve the wall-clock time, so the window is the intended
// local hours even across a daylight-saving transition (adding a fixed 24h
// would land an hour early/late on spring-forward/fall-back nights).
function nightBounds(dateStr, startHHMM, endHHMM) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  const endsNextDay = eh * 60 + em <= sh * 60 + sm;
  const start = new Date(y, m - 1, d, sh, sm, 0, 0);
  const end = new Date(y, m - 1, d + (endsNextDay ? 1 : 0), eh, em, 0, 0);
  return { start: start.getTime(), end: end.getTime() };
}

export default function Stats() {
  const { t } = useLocale();

  const [shifts, setShifts] = useState([]);
  const [users, setUsers] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const [night, setNight] = useState(todayStr);
  const [nightStartTime, setNightStartTime] = useState('22:00');
  const [nightEndTime, setNightEndTime] = useState('06:00');

  useEffect(() => {
    Promise.all([
      pb.collection('shifts').getFullList({ expand: 'guard' }),
      pb.collection('users').getFullList({ filter: 'active = true', sort: 'name' }),
    ]).then(([shiftRecords, userRecords]) => {
      setShifts(
        shiftRecords.map((s) => ({
          start: new Date(s.start).getTime(),
          end: new Date(s.end).getTime(),
          guard: s.expand?.guard?.name, // for the name-keyed hours stats
          guardId: s.expand?.guard?.id, // for the id-keyed sleep report
        })),
      );
      setUsers(userRecords);
      setLoaded(true);
    });
  }, []);

  const stats = useMemo(() => computeStats(shifts), [shifts]);

  // Keyed by user id, not display name: names aren't unique, so a name-keyed
  // report would merge namesakes and (worse) persist an edit to the wrong user.
  // Only active people are on the roster, so only they get a sleep row.
  const sleep = useMemo(() => {
    if (!users.length) return [];
    const { start, end } = nightBounds(night, nightStartTime, nightEndTime);
    return sleepReport({
      nightStart: start,
      nightEnd: end,
      shifts: shifts.map((s) => ({ start: s.start, end: s.end, guard: s.guardId })),
      people: users.map((u) => ({ id: u.id, minSleepHours: u.min_sleep_hours })),
    });
  }, [users, shifts, night, nightStartTime, nightEndTime]);
  const sleepById = useMemo(() => new Map(sleep.map((r) => [r.id, r])), [sleep]);

  if (!loaded) return null;

  const entries = [...stats.hoursPerGuard.entries()].sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: 2 }}>
      <Typography variant="h5" gutterBottom>
        {t('stats.title')}
      </Typography>
      <Typography variant="subtitle1" gutterBottom>
        {t('stats.hoursPerGuard')}
      </Typography>
      {entries.map(([name, hours]) => (
        <Box key={name} sx={{ mb: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2">{name}</Typography>
            <Typography variant="body2">{hours.toFixed(1)}h</Typography>
          </Box>
          <LinearProgress variant="determinate" value={max ? (hours / max) * 100 : 0} />
        </Box>
      ))}
      {stats.variance !== null && (
        <Typography variant="body2" sx={{ mt: 2 }}>
          {t('stats.variance', { variance: stats.variance.toFixed(3) })}
        </Typography>
      )}

      <Divider sx={{ my: 3 }} />

      <Typography variant="subtitle1" gutterBottom>
        {t('stats.sleepTitle')}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {t('stats.sleepHelp')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <TextField
          label={t('stats.sleepNight')}
          type="date"
          size="small"
          value={night}
          onChange={(e) => setNight(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label={t('stats.sleepStart')}
          type="time"
          size="small"
          value={nightStartTime}
          onChange={(e) => setNightStartTime(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label={t('stats.sleepEnd')}
          type="time"
          size="small"
          value={nightEndTime}
          onChange={(e) => setNightEndTime(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
      </Box>

      {users.map((u) => {
        const row = sleepById.get(u.id);
        return (
          <Box
            key={u.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexWrap: 'wrap',
              py: 1,
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Typography
              variant="body2"
              sx={{ flexGrow: 1, minWidth: 100 }}
            >
              {u.name}
            </Typography>

            {row ? (
              <>
                <Chip
                  size="small"
                  color={row.meetsMinimum ? 'success' : 'error'}
                  label={t('stats.longestSleep', { hours: row.longestSleepHours.toFixed(1) })}
                />
                <Typography variant="caption" color="text.secondary">
                  {t('stats.totalFree', { hours: row.totalFreeHours.toFixed(1) })}
                </Typography>
                {!row.meetsMinimum && row.minSleepHours > 0 && (
                  <Chip size="small" variant="outlined" color="error" label={t('stats.underMinimum')} />
                )}
                {row.minSleepHours > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    {t('stats.minSleep')}: {row.minSleepHours}h
                  </Typography>
                )}
              </>
            ) : (
              <Chip size="small" variant="outlined" label={t('stats.onVacation')} />
            )}

          </Box>
        );
      })}
    </Box>
  );
}
