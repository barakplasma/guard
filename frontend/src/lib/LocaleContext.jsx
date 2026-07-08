import { createContext, useContext, useMemo, useState, useEffect } from 'react';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { translate, detectDefaultLang, dirFor } from './i18n.js';

const LocaleContext = createContext(null);

const STORAGE_KEY = 'guard.lang';

function buildCache(dir) {
  return createCache({
    key: dir === 'rtl' ? 'mui-rtl' : 'mui',
    stylisPlugins: dir === 'rtl' ? [prefixer, rtlPlugin] : [prefixer],
  });
}

export function LocaleProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem(STORAGE_KEY) || detectDefaultLang());

  const dir = dirFor(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    localStorage.setItem(STORAGE_KEY, lang);
  }, [lang, dir]);

  const cache = useMemo(() => buildCache(dir), [dir]);
  const theme = useMemo(
    () =>
      createTheme({
        direction: dir,
        palette: { mode: 'light' },
        // System font stack only - no webfonts to download, matching the
        // fully-offline requirement (DESIGN.md section 6): Android already
        // ships Hebrew glyphs, so there is nothing to vendor.
        typography: {
          fontFamily: 'system-ui, "Segoe UI", Roboto, "Noto Sans Hebrew", sans-serif',
        },
      }),
    [dir],
  );

  const t = useMemo(() => (key, params) => translate(lang, key, params), [lang]);

  const toggleLang = () => setLang((prev) => (prev === 'he' ? 'en' : 'he'));

  const value = useMemo(() => ({ lang, dir, t, toggleLang }), [lang, dir, t]);

  return (
    <LocaleContext.Provider value={value}>
      <CacheProvider value={cache}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </ThemeProvider>
      </CacheProvider>
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}
