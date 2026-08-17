import { useState } from 'react';
import {
  Alert, Box, Button, Collapse, Divider, MenuItem, Paper, Select, Snackbar, Stack, Typography,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import DownloadIcon from '@mui/icons-material/Download';
import ChatIcon from '@mui/icons-material/Chat';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CodeIcon from '@mui/icons-material/Code';
import { shareUrl, URL_WARN_LENGTH } from '../lib/urlState.js';
import { downloadCsv, shiftsToCsv } from '../lib/exportCsv.js';
import { copyText, whatsappText } from '../lib/exportText.js';
import { downloadIcs, employeeIcs, overviewIcs } from '../lib/exportIcal.js';
import { planToReadableText } from '../lib/planText.js';
import { t } from '../strings.js';

function sanitizeFilename(name) {
  return (name || 'shifts').replace(/[^\p{L}\p{N}_-]+/gu, '_');
}

/** Copy-link / CSV / WhatsApp / iCal actions for a generated schedule. */
export default function ShareBar({ doc, result }) {
  const [toast, setToast] = useState(null);
  const [icsEmployeeId, setIcsEmployeeId] = useState(doc.employees[0]?.id ?? '');
  const [showPlanData, setShowPlanData] = useState(false);

  const notify = (ok) => setToast(ok ? t.copied : t.copyFailed);

  const onCopyLink = async () => {
    const url = shareUrl(doc, '/schedule');
    const ok = await copyText(url);
    if (ok && url.length > URL_WARN_LENGTH) setToast(t.longUrlWarning);
    else notify(ok);
  };

  const onCsv = () => {
    downloadCsv(shiftsToCsv(result), `${sanitizeFilename(doc.title)}.csv`);
  };

  const onWhatsapp = async () => {
    const text = whatsappText(result, { title: doc.title });
    notify(await copyText(text));
  };

  const onCopyPlanData = async () => {
    notify(await copyText(planToReadableText(doc)));
  };

  const onIcsOverview = () => {
    const name = sanitizeFilename(doc.title);
    downloadIcs(overviewIcs(result, { title: doc.title }), `${name}.ics`);
  };

  const selectedEmployee = doc.employees.find((e) => e.id === icsEmployeeId) ?? doc.employees[0];

  const onIcsEmployee = () => {
    if (!selectedEmployee) return;
    const ics = employeeIcs(result, {
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
          {t.shareSection}
        </Typography>
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Button size="small" variant="outlined" startIcon={<LinkIcon />} onClick={onCopyLink} data-testid="copy-link">
            {t.copyLink}
          </Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={onCsv} data-testid="download-csv">
            {t.downloadCsv}
          </Button>
          <Button size="small" variant="outlined" startIcon={<ChatIcon />} onClick={onWhatsapp} data-testid="copy-whatsapp">
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
            onClick={onIcsOverview}
            data-testid="download-ics-overview"
          >
            {t.downloadIcsOverview}
          </Button>
          {selectedEmployee && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75 }}>
              <Select
                value={selectedEmployee.id}
                onChange={(e) => setIcsEmployeeId(e.target.value)}
                size="small"
                sx={{ minWidth: 110, '& .MuiSelect-select': { py: 0.5 } }}
                aria-label={t.icsEmployeeSelect}
                data-testid="ics-employee-select"
              >
                {doc.employees.map((e) => (
                  <MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>
                ))}
              </Select>
              <Button
                size="small"
                variant="outlined"
                startIcon={<CalendarMonthIcon />}
                onClick={onIcsEmployee}
                data-testid="download-ics-employee"
              >
                {t.downloadIcsEmployee}
              </Button>
            </Box>
          )}
        </Stack>

        <Divider sx={{ my: 1.25 }} />

        <Button
          size="small"
          variant="text"
          startIcon={<CodeIcon />}
          onClick={() => setShowPlanData((v) => !v)}
          data-testid="toggle-plan-data"
        >
          {showPlanData ? t.hidePlanData : t.showPlanData}
        </Button>
        <Collapse in={showPlanData}>
          <Box sx={{ mt: 1 }}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ flex: 1 }}>
                {t.planDataTitle}
              </Typography>
              <Button size="small" onClick={onCopyPlanData} data-testid="copy-plan-data">
                {t.copyPlanData}
              </Button>
            </Stack>
            <Box
              component="pre"
              data-testid="plan-data-text"
              sx={{
                m: 0,
                p: 1,
                bgcolor: 'action.hover',
                borderRadius: 1,
                fontFamily: 'inherit',
                fontSize: '0.8rem',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxHeight: 320,
                overflowY: 'auto',
              }}
            >
              {planToReadableText(doc)}
            </Box>
          </Box>
        </Collapse>
      </Paper>

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
