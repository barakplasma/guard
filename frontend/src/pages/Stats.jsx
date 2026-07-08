import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import { pb } from '../lib/pocketbase.js';
import { useLocale } from '../lib/LocaleContext.jsx';
import { computeStats } from '../lib/scheduler.js';

export default function Stats() {
  const { t } = useLocale();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    pb.collection('shifts')
      .getFullList({ expand: 'guards' })
      .then((records) => {
        const forScheduler = records.map((s) => ({
          start: new Date(s.start).getTime(),
          end: new Date(s.end).getTime(),
          guards: (s.expand?.guards || []).map((g) => g.name),
        }));
        setStats(computeStats(forScheduler));
      });
  }, []);

  if (!stats) return null;

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
    </Box>
  );
}
