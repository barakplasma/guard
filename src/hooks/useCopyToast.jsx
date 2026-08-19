import { useState } from 'react';
import { Alert, Snackbar } from '@mui/material';
import { copyText } from '../lib/exportText.js';
import { t } from '../strings.js';

/**
 * Clipboard-copy + toast, shared by `ShareBar` and `DebugSection`. Extracted
 * rather than duplicated so the two copy-to-clipboard buttons stay in sync -
 * `setToast` is exposed directly because `ShareBar`'s link button has one
 * extra path (`t.longUrlWarning`) that isn't a plain success/failure toast.
 */
export default function useCopyToast() {
  const [toast, setToast] = useState(null);

  const copy = async (text) => {
    const ok = await copyText(text);
    setToast(ok ? t.copied : t.copyFailed);
  };

  const toastNode = (
    <Snackbar
      open={Boolean(toast)}
      autoHideDuration={3000}
      onClose={() => setToast(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert severity="info" onClose={() => setToast(null)}>{toast}</Alert>
    </Snackbar>
  );

  return { copy, setToast, toastNode };
}
