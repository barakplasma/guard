import { useMemo } from 'react';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';
import {
  createTheme, ThemeProvider, CssBaseline, useMediaQuery,
} from '@mui/material';

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

/**
 * Olive/khaki palette in both schemes - no manual toggle. Which one applies
 * follows `prefers-color-scheme`, which is how a device's own night mode /
 * ambient light handling already reaches the browser; there is no
 * cross-browser ambient-light API worth depending on instead.
 */
const darkPalette = {
  mode: 'dark',
  primary: {
    main: '#7C8F4A', light: '#A9B872', dark: '#4B5320', contrastText: '#12140D',
  },
  secondary: { main: '#C9A96B', contrastText: '#12140D' },
  background: { default: '#14170F', paper: '#1E2318' },
  text: { primary: '#ECEADF', secondary: '#B7B49B' },
  divider: 'rgba(236,234,223,0.12)',
  warning: { main: '#E0A93E', contrastText: '#14170D' },
  error: { main: '#E0645C' },
};

const lightPalette = {
  mode: 'light',
  primary: {
    main: '#4B5320', light: '#6B7A3A', dark: '#333B16', contrastText: '#FFFFFF',
  },
  secondary: { main: '#8A6D3B', contrastText: '#FFFFFF' },
  background: { default: '#F5F1E6', paper: '#FFFFFF' },
  text: { primary: '#1E2318', secondary: '#4B4A3E' },
  warning: { main: '#B26A00' },
  error: { main: '#B3261E' },
};

const typography = {
  fontFamily: [
    'system-ui', '-apple-system', 'Segoe UI', 'Roboto',
    'Noto Sans Hebrew', 'Arial', 'sans-serif',
  ].join(','),
};

const components = {
  MuiTextField: { defaultProps: { size: 'small' } },
  MuiSelect: { defaultProps: { size: 'small' } },
};

export default function AppTheme({ children }) {
  useMemo(() => {
    document.documentElement.lang = 'he';
    document.documentElement.dir = 'rtl';
  }, []);

  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });
  const theme = useMemo(() => createTheme({
    direction: 'rtl',
    palette: prefersDark ? darkPalette : lightPalette,
    typography,
    shape: { borderRadius: 10 },
    components,
  }), [prefersDark]);

  return (
    <CacheProvider value={cacheRtl}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  );
}
