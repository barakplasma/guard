import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import IconButton from '@mui/material/IconButton';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import FormGroup from '@mui/material/FormGroup';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import { pb } from '../lib/pocketbase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useLocale } from '../lib/LocaleContext.jsx';

const BLANK = { name: '', people_count: 1, eligible_users: [], time_restricted: false, window_start: '22:00', window_end: '06:00', active: true };

export default function Positions() {
  const { isCommander } = useAuth();
  const { t } = useLocale();

  const [positions, setPositions] = useState([]);
  const [users, setUsers] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState(null);

  const load = () => Promise.all([
    pb.collection('positions').getFullList({ sort: 'name' }),
    pb.collection('users').getFullList({ filter: 'active = true', sort: 'name' }),
  ]).then(([positionRecords, userRecords]) => {
    setPositions(positionRecords);
    setUsers(userRecords);
  });

  useEffect(() => {
    if (!isCommander) return;
    load();
  }, [isCommander]);

  if (!isCommander) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">{t('positions.forbidden')}</Alert>
      </Box>
    );
  }

  const openCreate = () => {
    setEditingId(null);
    setForm(BLANK);
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (position) => {
    setEditingId(position.id);
    setForm({
      name: position.name,
      people_count: position.people_count || 1,
      eligible_users: position.eligible_users || [],
      time_restricted: position.time_restricted,
      window_start: position.window_start || '22:00',
      window_end: position.window_end || '06:00',
      active: position.active,
    });
    setError(null);
    setDialogOpen(true);
  };

  const save = async () => {
    try {
      const peopleCount = Number(form.people_count);
      if (!Number.isInteger(peopleCount) || peopleCount < 1 || peopleCount > users.length) {
        setError(t('positions.peopleCountError', { count: users.length }));
        return;
      }
      if (form.eligible_users.length > 0 && form.eligible_users.length < peopleCount) {
        setError(t('positions.eligibleUsersCountError'));
        return;
      }
      const body = {
        name: form.name,
        people_count: peopleCount,
        eligible_users: form.eligible_users,
        time_restricted: form.time_restricted,
        window_start: form.time_restricted ? form.window_start : '',
        window_end: form.time_restricted ? form.window_end : '',
        active: form.active,
      };
      if (editingId) {
        await pb.collection('positions').update(editingId, body);
      } else {
        await pb.collection('positions').create(body);
      }
      setDialogOpen(false);
      load();
    } catch (err) {
      setError(t('positions.error', { error: err?.message || String(err) }));
    }
  };

  const remove = async (id) => {
    await pb.collection('positions').delete(id);
    load();
  };

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5">{t('positions.title')}</Typography>
        <Button variant="contained" onClick={openCreate}>
          {t('positions.add')}
        </Button>
      </Box>

      {positions.length === 0 && <Typography color="text.secondary">{t('positions.empty')}</Typography>}

      <List dense>
        {positions.map((position) => (
          <ListItem
            key={position.id}
            secondaryAction={
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <IconButton edge="end" onClick={() => openEdit(position)} aria-label={t('positions.edit')}>
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton edge="end" onClick={() => remove(position.id)} aria-label={t('positions.delete')}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            }
          >
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  {position.name}
                  <Chip size="small" label={t('positions.peopleCountValue', { count: position.people_count || 1 })} />
                  {position.time_restricted && (
                    <Chip size="small" label={`${position.window_start}-${position.window_end}`} />
                  )}
                  <Chip
                    size="small"
                    color={position.active ? 'success' : 'default'}
                    variant={position.active ? 'filled' : 'outlined'}
                    label={position.active ? t('positions.statusActive') : t('positions.statusInactive')}
                  />
                </Box>
              }
            />
          </ListItem>
        ))}
      </List>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogTitle>{editingId ? t('positions.edit') : t('positions.add')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 320, pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('positions.name')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            autoFocus
            fullWidth
          />
          <TextField
            label={t('positions.peopleCount')}
            type="number"
            value={form.people_count}
            onChange={(e) => setForm((f) => ({ ...f, people_count: e.target.value }))}
            inputProps={{ min: 1, max: users.length }}
            helperText={t('positions.peopleCountHelp', { count: users.length })}
            fullWidth
          />
          <Box>
            <Typography variant="subtitle2">{t('positions.eligibleUsers')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {t('positions.eligibleUsersHelp')}
            </Typography>
            <FormGroup row>
              {users.map((user) => (
                <FormControlLabel
                  key={user.id}
                  control={<Checkbox checked={form.eligible_users.includes(user.id)} onChange={(e) => setForm((f) => ({
                    ...f,
                    eligible_users: e.target.checked ? [...f.eligible_users, user.id] : f.eligible_users.filter((id) => id !== user.id),
                  }))} />}
                  label={user.name}
                />
              ))}
            </FormGroup>
          </Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={form.time_restricted}
                onChange={(e) => setForm((f) => ({ ...f, time_restricted: e.target.checked }))}
              />
            }
            label={t('positions.timeRestricted')}
          />
          {form.time_restricted && (
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label={t('positions.windowStart')}
                type="time"
                value={form.window_start}
                onChange={(e) => setForm((f) => ({ ...f, window_start: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label={t('positions.windowEnd')}
                type="time"
                value={form.window_end}
                onChange={(e) => setForm((f) => ({ ...f, window_end: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Box>
          )}
          <FormControlLabel
            control={
              <Checkbox
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
            }
            label={t('positions.active')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('positions.cancel')}</Button>
          <Button variant="contained" disabled={!form.name} onClick={save}>
            {t('positions.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
