import { useMemo, useState } from 'react';
import {
  Box, Button, Divider, Paper, Stack, Typography,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import DownloadIcon from '@mui/icons-material/Download';
import ChatIcon from '@mui/icons-material/Chat';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import { shareUrl, URL_WARN_LENGTH } from '../lib/urlState.js';
import { downloadCsv, shiftsToCsv } from '../lib/exportCsv.js';
import { copyText, whatsappText } from '../lib/exportText.js';
import { downloadIcs, employeeIcs, overviewIcs } from '../lib/exportIcal.js';
import { SHARE_WINDOW_MS, clipResult, defaultShareFrom } from '../lib/shareWindow.js';
import DateTimeField from './DateTimeField.jsx';
import EmployeeSelect from './EmployeeSelect.jsx';
import useCopyToast from '../hooks/useCopyToast.jsx';
import { formatRange } from '../lib/format.js';
import { t } from '../strings.js';

function sanitizeFilename(name) {
  return (name || 'shifts').replace(/[^\p{L}\p{N}_-]+/gu, '_');
}

/** Copy-link / CSV / WhatsApp / iCal actions for a generated schedule. */
export default function ShareBar({ doc, result, now = Date.now() }) {
  const { copy, setToast, toastNode } = useCopyToast();
  const [icsEmployeeId, setIcsEmployeeId] = useState(doc.employees[0]?.id ?? '');

  // `null` means "wherever the default falls", so the window keeps following
  // the clock until somebody picks a time, rather than freezing at whatever
  // moment the page happened to load.
  const [chosenFrom, setChosenFrom] = useState(null);
  const from = chosenFrom ?? defaultShareFrom(doc, now);
  const to = from + SHARE_WINDOW_MS;
  // The link and the CSV are the whole plan on purpose: a link is the document
  // itself, and trimming it would change the schedule the recipient computes.
  const shared = useMemo(() => clipResult(result, from, to), [result, from, to]);

  const onCopyLink = async () => {
    const url = shareUrl(doc, '/schedule');
    const ok = await copyText(url);
    if (ok && url.length > URL_WARN_LENGTH) setToast(t.longUrlWarning);
    else setToast(ok ? t.copied : t.copyFailed);
  };

  const onCsv = () => {
    downloadCsv(shiftsToCsv(result, doc), `${sanitizeFilename(doc.title)}.csv`);
  };

  const onWhatsapp = async () => {
    await copy(whatsappText(shared, { title: doc.title }));
  };

  const onIcsOverview = () => {
    const name = sanitizeFilename(doc.title);
    downloadIcs(overviewIcs(shared, { title: doc.title }), `${name}.ics`);
  };

  const selectedEmployee = doc.employees.find((e) => e.id === icsEmployeeId) ?? doc.employees[0];

  const onIcsEmployee = () => {
    if (!selectedEmployee) return;
    const ics = employeeIcs(shared, {
      employeeId: selectedEmployee.id,
      employeeName: selectedEmployee.name,
      title: doc.title,
    });
    downloadIcs(ics, `${sanitizeFilename(selectedEmployee.name)}.ics`);
  };

  return (
    <>
      {/*
        Two distinct jobs, so two labelled sections: sharing the plan itself
        (link, spreadsheet, WhatsApp message) and downloading a calendar file.
        In one undivided row of buttons the iCal actions read as more of the
        same, and the employee picker looks like it belongs to all of them.
      */}
      <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
        <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ display: 'block', mb: 0.5 }}>
          {t.shareWindow}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          <DateTimeField
            label={t.shareWindowFrom}
            value={from}
            onChange={(v) => v != null && setChosenFrom(v)}
            testId="share-from"
            nullable={false}
          />
          <Typography variant="caption" color="text.secondary" data-testid="share-window-range">
            {t.shareWindowRange(formatRange(from, to))}
            {shared && ` · ${t.shareWindowCount(shared.shifts.length)}`}
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, mb: 1 }}>
          {t.shareWindowHelp}
        </Typography>

        <Divider sx={{ mb: 1.25 }} />

        <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ display: 'block', mb: 0.5 }}>
          {t.shareSection}
        </Typography>
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Button size="small" variant="outlined" startIcon={<LinkIcon />} onClick={onCopyLink} data-testid="copy-link">
            {t.copyLink}
          </Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} disabled={!result} onClick={onCsv} data-testid="download-csv">
            {t.downloadCsv}
          </Button>
          <Button size="small" variant="outlined" startIcon={<ChatIcon />} disabled={!result} onClick={onWhatsapp} data-testid="copy-whatsapp">
            {t.copyWhatsapp}
          </Button>
        </Stack>

        <Divider sx={{ my: 1.25 }} />

        <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ display: 'block', mb: 0.5 }}>
          {t.calendarSection}
        </Typography>
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<CalendarMonthIcon />}
            disabled={!result} onClick={onIcsOverview}
            data-testid="download-ics-overview"
          >
            {t.downloadIcsOverview}
          </Button>
          {selectedEmployee && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75 }}>
              <EmployeeSelect
                value={selectedEmployee.id}
                onChange={(id) => id != null && setIcsEmployeeId(id)}
                employees={doc.employees}
                label={t.icsEmployeeSelect}
                testId="ics-employee-select"
              />
              <Button
                size="small"
                variant="outlined"
                startIcon={<CalendarMonthIcon />}
                disabled={!result} onClick={onIcsEmployee}
                data-testid="download-ics-employee"
              >
                {t.downloadIcsEmployee}
              </Button>
            </Box>
          )}
        </Stack>
      </Paper>

      {toastNode}
    </>
  );
}
