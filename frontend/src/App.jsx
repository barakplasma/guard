import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext.jsx';
import { LocaleProvider } from './lib/LocaleContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Roster from './pages/Roster.jsx';
import Generate from './pages/Generate.jsx';
import Positions from './pages/Positions.jsx';
import MyShifts from './pages/MyShifts.jsx';
import Stats from './pages/Stats.jsx';
import Guards from './pages/Guards.jsx';

// Hash routing (no History API) so PocketBase can serve pb_public/ as a plain
// static directory with no server-side rewrite config - see DESIGN.md section 5.

function RequireAuth({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/roster" element={<Roster />} />
        <Route path="/generate" element={<Generate />} />
        <Route path="/positions" element={<Positions />} />
        <Route path="/guards" element={<Guards />} />
        <Route path="/me" element={<MyShifts />} />
        <Route path="/stats" element={<Stats />} />
      </Route>
      <Route path="*" element={<Navigate to="/roster" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <LocaleProvider>
      <AuthProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </AuthProvider>
    </LocaleProvider>
  );
}
