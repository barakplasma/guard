import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import { pb } from '../lib/pocketbase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useLocale } from '../lib/LocaleContext.jsx';

export default function MyShifts() {
  const { user } = useAuth();
  const { t, lang } = useLocale();

  const [shifts, setShifts] = useState([]);
  const [users, setUsers] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [swapDialogShift, setSwapDialogShift] = useState(null);
  const [swapTarget, setSwapTarget] = useState('');
  const [error, setError] = useState(null);

  const load = async () => {
    const nowIso = new Date().toISOString();
    const [myShifts, allUsers, incomingReqs, outgoingReqs] = await Promise.all([
      pb.collection('shifts').getFullList({
        filter: `guard = "${user.id}" && end > "${nowIso}"`,
        sort: 'start',
        expand: 'guard,position',
      }),
      pb.collection('users').getFullList({ filter: 'active = true', sort: 'name' }),
      pb.collection('swap_requests').getFullList({
        filter: `to_user = "${user.id}" && status = "pending"`,
        expand: 'shift.position,from_user',
      }),
      pb.collection('swap_requests').getFullList({
        filter: `from_user = "${user.id}" && status = "pending"`,
        expand: 'shift.position,to_user',
      }),
    ]);
    setShifts(myShifts);
    setUsers(allUsers);
    setIncoming(incomingReqs);
    setOutgoing(outgoingReqs);
  };

  useEffect(() => {
    load();
    let unsubShifts;
    let unsubSwaps;
    pb.collection('shifts')
      .subscribe('*', () => load())
      .then((fn) => (unsubShifts = fn));
    pb.collection('swap_requests')
      .subscribe('*', () => load())
      .then((fn) => (unsubSwaps = fn));
    return () => {
      unsubShifts?.();
      unsubSwaps?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const otherGuardsFor = (shift) => users.filter((u) => u.id !== shift.expand?.guard?.id);

  const openSwapDialog = (shift) => {
    setSwapDialogShift(shift);
    setSwapTarget('');
    setError(null);
  };

  const submitSwap = async () => {
    try {
      await pb.collection('swap_requests').create({
        shift: swapDialogShift.id,
        from_user: user.id,
        to_user: swapTarget,
        status: 'pending',
      });
      setSwapDialogShift(null);
      load();
    } catch (err) {
      setError(err?.message || String(err));
    }
  };

  const respond = async (requestId, status) => {
    await pb.collection('swap_requests').update(requestId, { status });
    load();
  };

  const cancel = async (requestId) => {
    await pb.collection('swap_requests').update(requestId, { status: 'cancelled' });
    load();
  };

  const fmt = useMemo(
    () => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-IL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }),
    [lang],
  );

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: 2 }}>
      <Typography variant="h5" gutterBottom>
        {t('me.title')}
      </Typography>

      <Typography variant="subtitle1">{t('me.upcoming')}</Typography>
      {shifts.length === 0 && <Typography color="text.secondary">{t('me.noShifts')}</Typography>}
      <List dense>
        {shifts.map((shift) => (
          <ListItem
            key={shift.id}
            secondaryAction={
              <Button size="small" onClick={() => openSwapDialog(shift)}>
                {t('me.requestSwap')}
              </Button>
            }
          >
            <ListItemText
              primary={`${fmt.format(new Date(shift.start))} - ${fmt.format(new Date(shift.end))}`}
              secondary={shift.expand?.position?.name}
            />
          </ListItem>
        ))}
      </List>

      <Divider sx={{ my: 2 }} />

      <Typography variant="subtitle1">{t('me.incoming')}</Typography>
      <List dense>
        {incoming.map((req) => (
          <ListItem
            key={req.id}
            secondaryAction={
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" onClick={() => respond(req.id, 'accepted')}>
                  {t('me.accept')}
                </Button>
                <Button size="small" color="error" onClick={() => respond(req.id, 'declined')}>
                  {t('me.decline')}
                </Button>
              </Box>
            }
          >
            <ListItemText
              primary={req.expand?.shift ? `${fmt.format(new Date(req.expand.shift.start))} - ${fmt.format(new Date(req.expand.shift.end))}` : ''}
              secondary={req.expand?.from_user?.name}
            />
          </ListItem>
        ))}
      </List>

      <Typography variant="subtitle1">{t('me.outgoing')}</Typography>
      <List dense>
        {outgoing.map((req) => (
          <ListItem
            key={req.id}
            secondaryAction={
              <Button size="small" color="error" onClick={() => cancel(req.id)}>
                {t('me.cancel')}
              </Button>
            }
          >
            <ListItemText
              primary={req.expand?.shift ? `${fmt.format(new Date(req.expand.shift.start))} - ${fmt.format(new Date(req.expand.shift.end))}` : ''}
              secondary={req.expand?.to_user?.name}
            />
          </ListItem>
        ))}
      </List>

      <Dialog open={!!swapDialogShift} onClose={() => setSwapDialogShift(null)}>
        <DialogTitle>{t('me.requestSwap')}</DialogTitle>
        <DialogContent sx={{ minWidth: 280 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <TextField
            select
            fullWidth
            label={t('me.swapWith')}
            value={swapTarget}
            onChange={(e) => setSwapTarget(e.target.value)}
            sx={{ mt: 1 }}
          >
            {swapDialogShift &&
              otherGuardsFor(swapDialogShift).map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.name}
                </MenuItem>
              ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSwapDialogShift(null)}>{t('me.cancel')}</Button>
          <Button variant="contained" disabled={!swapTarget} onClick={submitSwap}>
            {t('me.requestSwap')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
