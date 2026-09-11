import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { heIL } from '@mui/x-date-pickers/locales';
import 'dayjs/locale/he';
import App from './App.jsx';
import AppTheme from './theme.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppTheme>
      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="he"
        localeText={heIL.components.MuiLocalizationProvider.defaultProps.localeText}>
        <App />
      </LocalizationProvider>
    </AppTheme>
  </StrictMode>,
);

// Everything this app does runs client-side, so precaching the shell is all
// that offline support needs. `autoUpdate` swaps in a new build on next load.
registerSW({ immediate: true });
