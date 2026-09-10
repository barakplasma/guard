import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import AppTheme from './theme.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppTheme>
      <App />
    </AppTheme>
  </StrictMode>,
);

// Everything this app does runs client-side, so precaching the shell is all
// that offline support needs. `autoUpdate` swaps in a new build on next load.
registerSW({ immediate: true });
