import { useState } from 'react';
import {
  Alert, Button, Checkbox, FormControlLabel, Snackbar, Stack,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import DownloadIcon from '@mui/icons-material/Download';
import ChatIcon from '@mui/icons-material/Chat';
import { shareUrl, URL_WARN_LENGTH } from '../lib/urlState.js';
import { downloadCsv, shiftsToCsv } from '../lib/exportCsv.js';
import { copyText, whatsappText } from '../lib/exportText.js';
import { t } from '../strings.js';

/** Copy-link / CSV / WhatsApp actions for a generated schedule. */
export default function ShareBar({ doc, result, includeOffDuty, setIncludeOffDuty }) {
  const [toast, setToast] = useState(null);

  const notify = (ok) => setToast(ok ? t.copied : t.copyFailed);

  const onCopyLink = async () => {
    const url = shareUrl(doc, '/schedule');
    const ok = await copyText(url);
    if (ok && url.length > URL_WARN_LENGTH) setToast(t.longUrlWarning);
    else notify(ok);
  };

  const onCsv = () => {
    const name = (doc.title || 'shifts').replace(/[^\p{L}\p{N}_-]+/gu, '_');
    downloadCsv(shiftsToCsv(result), `${name}.csv`);
  };

  const onWhatsapp = async () => {
    const text = whatsappText(result, {
      title: doc.title,
      employeeNames: new Map(doc.employees.map((e) => [e.id, e.name])),
      includeOffDuty,
    });
    notify(await copyText(text));
  };

  return (
    <>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Button startIcon={<LinkIcon />} onClick={onCopyLink} data-testid="copy-link">
          {t.copyLink}
        </Button>
        <Button startIcon={<DownloadIcon />} onClick={onCsv} data-testid="download-csv">
          {t.downloadCsv}
        </Button>
        <Button startIcon={<ChatIcon />} onClick={onWhatsapp} data-testid="copy-whatsapp">
          {t.copyWhatsapp}
        </Button>
        <FormControlLabel
          control={(
            <Checkbox
              size="small"
              checked={includeOffDuty}
              onChange={(e) => setIncludeOffDuty(e.target.checked)}
              data-testid="include-off-duty"
            />
          )}
          label={t.includeOffDuty}
        />
      </Stack>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="info" onClose={() => setToast(null)}>{toast}</Alert>
      </Snackbar>
    </>
  );
}
