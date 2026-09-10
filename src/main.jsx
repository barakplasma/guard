import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalStyles } from '@mui/material';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import AppTheme from './theme.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppTheme>
      {/* Native number steppers are hover/focus-only, which on a phone means
          never. Pinning opacity keeps the built-in up/down control visible on
          every numeric field. */}
      <GlobalStyles
        styles={{
          'input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button': {
            opacity: 1,
          },
        }}
      />
      <App />
    </AppTheme>
  </StrictMode>,
);

// Everything this app does runs client-side, so precaching the shell is all
// that offline support needs. `autoUpdate` swaps in a new build on next load.
registerSW({ immediate: true });
