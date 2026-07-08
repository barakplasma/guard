import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import { useAuth } from '../lib/AuthContext.jsx';
import { useLocale } from '../lib/LocaleContext.jsx';

export default function Login() {
  const { login, signup } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await signup(email, password, name);
      }
      navigate('/roster');
    } catch (err) {
      setError(t('login.error', { error: err?.message || String(err) }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6, px: 2 }}>
      <Paper sx={{ p: 4, width: '100%', maxWidth: 400 }} elevation={3}>
        <Typography variant="h5" gutterBottom>
          {mode === 'login' ? t('login.title') : t('login.signupTitle')}
        </Typography>
        <Tabs value={mode} onChange={(_e, value) => setMode(value)} sx={{ mb: 2 }}>
          <Tab label={t('login.title')} value="login" />
          <Tab label={t('login.signupTitle')} value="signup" />
        </Tabs>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {mode === 'signup' && (
            <TextField
              label={t('login.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              fullWidth
            />
          )}
          <TextField
            label={t('login.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
          />
          <TextField
            label={t('login.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            fullWidth
          />
          <Button type="submit" variant="contained" disabled={submitting} fullWidth>
            {mode === 'login' ? t('login.submit') : t('login.signupSubmit')}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
