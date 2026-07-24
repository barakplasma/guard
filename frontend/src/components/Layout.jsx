import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import LogoutIcon from '@mui/icons-material/Logout';
import TranslateIcon from '@mui/icons-material/Translate';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import ListAltIcon from '@mui/icons-material/ListAlt';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import BadgeIcon from '@mui/icons-material/Badge';
import GroupsIcon from '@mui/icons-material/Groups';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import PersonIcon from '@mui/icons-material/Person';
import BarChartIcon from '@mui/icons-material/BarChart';
import Box from '@mui/material/Box';
import { useAuth } from '../lib/AuthContext.jsx';
import { useLocale } from '../lib/LocaleContext.jsx';
import { pb } from '../lib/pocketbase.js';

const ROUTES = ['/roster', '/generate', '/positions', '/guards', '/availability', '/me', '/stats'];

export default function Layout() {
  const { user, isCommander, logout } = useAuth();
  const { t, toggleLang } = useLocale();
  const [tempLink, setTempLink] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isCommander) {
      setTempLink(null);
      return undefined;
    }
    let cancelled = false;
    pb.send('/api/guard/temp-login-link').then(({ code }) => {
      if (!cancelled) setTempLink(`${window.location.origin}${window.location.pathname}#/temp-login/${code}`);
    }).catch(() => {
      if (!cancelled) setTempLink(null);
    });
    return () => { cancelled = true; };
  }, [isCommander]);

  const currentTab = ROUTES.find((route) => location.pathname.startsWith(route)) || '/roster';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {t('app.title')}
          </Typography>
          <IconButton color="inherit" onClick={toggleLang} aria-label="toggle language">
            <TranslateIcon />
          </IconButton>
          {user && (
            <IconButton color="inherit" onClick={logout} aria-label={t('nav.logout')}>
              <LogoutIcon />
            </IconButton>
          )}
        </Toolbar>
      </AppBar>

      <Box sx={{ flexGrow: 1, pb: 7 }}>
        {isCommander && tempLink && (
          <Box sx={{ px: 2, py: 1, bgcolor: 'action.hover', fontSize: '0.85rem' }}>
            {t('tempRoster.shareLink')}: <a href={tempLink}>{tempLink}</a>
          </Box>
        )}
        <Outlet />
      </Box>

      <BottomNavigation
        showLabels
        value={currentTab}
        onChange={(_e, value) => navigate(value)}
        sx={{ position: 'fixed', bottom: 0, insetInline: 0 }}
      >
        <BottomNavigationAction label={t('nav.roster')} value="/roster" icon={<ListAltIcon />} />
        {isCommander && (
          <BottomNavigationAction label={t('nav.generate')} value="/generate" icon={<AddCircleIcon />} />
        )}
        {isCommander && (
          <BottomNavigationAction label={t('nav.positions')} value="/positions" icon={<BadgeIcon />} />
        )}
        {isCommander && (
          <BottomNavigationAction label={t('nav.guards')} value="/guards" icon={<GroupsIcon />} />
        )}
        {isCommander && (
          <BottomNavigationAction label={t('nav.availability')} value="/availability" icon={<EventAvailableIcon />} />
        )}
        <BottomNavigationAction label={t('nav.me')} value="/me" icon={<PersonIcon />} />
        <BottomNavigationAction label={t('nav.stats')} value="/stats" icon={<BarChartIcon />} />
      </BottomNavigation>
    </Box>
  );
}
