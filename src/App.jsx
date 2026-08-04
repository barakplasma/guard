import {
  AppBar, Box, Container, Tab, Tabs, Toolbar, Typography,
} from '@mui/material';
import {
  HashRouter, Navigate, Route, Routes, useLocation, useNavigate,
} from 'react-router-dom';
import { PlanProvider } from './state/PlanContext.jsx';
import EmployeesPage from './pages/EmployeesPage.jsx';
import MissionsPage from './pages/MissionsPage.jsx';
import SchedulePage from './pages/SchedulePage.jsx';
import { t } from './strings.js';

const ROUTES = ['/employees', '/missions', '/schedule'];

function Nav() {
  const location = useLocation();
  const navigate = useNavigate();
  const current = ROUTES.indexOf(location.pathname);

  // Navigating must carry the plan blob along - it is the entire application
  // state, and dropping it would reset the plan on every tab click.
  const go = (index) => navigate({ pathname: ROUTES[index], search: location.search });

  return (
    <Tabs
      value={current === -1 ? 0 : current}
      onChange={(_, v) => go(v)}
      textColor="inherit"
      indicatorColor="secondary"
    >
      <Tab label={t.navEmployees} data-testid="tab-employees" />
      <Tab label={t.navMissions} data-testid="tab-missions" />
      <Tab label={t.navSchedule} data-testid="tab-schedule" />
    </Tabs>
  );
}

/**
 * Land unknown routes on the first page while keeping the query string - a
 * shared link of the form "#/?p=..." must not lose the plan on redirect.
 */
function DefaultRedirect() {
  const location = useLocation();
  return <Navigate to={{ pathname: '/employees', search: location.search }} replace />;
}

function Shell() {
  return (
    <PlanProvider>
      <AppBar position="static">
        <Toolbar sx={{ gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="h6" component="h1">{t.appTitle}</Typography>
          <Nav />
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Box component="main">
          <Routes>
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/missions" element={<MissionsPage />} />
            <Route path="/schedule" element={<SchedulePage />} />
            <Route path="*" element={<DefaultRedirect />} />
          </Routes>
        </Box>
      </Container>
    </PlanProvider>
  );
}

export default function App() {
  // HashRouter keeps everything - route and plan blob - after the "#", so the
  // app needs no server rewrite rules and works from a file:// path too.
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
