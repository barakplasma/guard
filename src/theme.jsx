import { useMemo } from 'react';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';
import { createTheme, ThemeProvider, CssBaseline } from '@mui/material';

/**
 * RTL setup. MUI needs both halves: `direction: 'rtl'` on the theme for its own
 * logic, and an Emotion cache running stylis-plugin-rtl so the generated CSS
 * has its physical properties flipped.
 *
 * The font stack is deliberately system-only - no webfonts - so the app renders
 * identically offline instead of falling back mid-session.
 */
const cacheRtl = createCache({
  key: 'murtl',
  stylisPlugins: [prefixer, rtlPlugin],
});

const theme = createTheme({
  direction: 'rtl',
  typography: {
    fontFamily: [
      'system-ui', '-apple-system', 'Segoe UI', 'Roboto',
      'Noto Sans Hebrew', 'Arial', 'sans-serif',
    ].join(','),
  },
  shape: { borderRadius: 10 },
  components: {
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiSelect: { defaultProps: { size: 'small' } },
  },
});

export default function AppTheme({ children }) {
  useMemo(() => {
    document.documentElement.lang = 'he';
    document.documentElement.dir = 'rtl';
  }, []);

  return (
    <CacheProvider value={cacheRtl}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  );
}
