import { useState } from 'react';
import {
  Alert, Box, Button, Chip, IconButton, Paper, Snackbar, Stack, TextField, Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import DateTimeField from '../components/DateTimeField.jsx';
import SettingsBar from '../components/SettingsBar.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { usePlan } from '../state/PlanContext.jsx';
import { sortByHebrewName } from '../lib/sort.js';
import { duplicateEmployeeIds } from '../lib/employees.js';
import { t } from '../strings.js';

function EmployeeRow({ employee, planStart, planEnd, duplicate, onChange, onRemove }) {
  // "Whole period" is the default and by far the common case, so it stays a
  // single chip until someone actually needs a narrower window.
  const limited = employee.start != null || employee.end != null;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}>
        <TextField
          label={t.employeeName}
          value={employee.name}
          onChange={(e) => onChange({ name: e.target.value })}
          error={duplicate}
          helperText={duplicate ? t.duplicateName : undefined}
          sx={{ flex: 1, minWidth: 160 }}
          slotProps={{ htmlInput: { 'data-testid': `employee-name-${employee.id}` } }}
        />

        {limited ? (
          <>
            <DateTimeField
              label={t.availableFrom}
              value={employee.start ?? planStart}
              onChange={(v) => onChange({ start: v })}
            />
            <DateTimeField
              label={t.availableUntil}
              value={employee.end ?? planEnd}
              onChange={(v) => onChange({ end: v })}
            />
            <Button
              size="small"
              onClick={() => onChange({ start: null, end: null })}
              data-testid={`reset-availability-${employee.id}`}
            >
              {t.wholePeriod}
            </Button>
          </>
        ) : (
          <Chip
            label={t.wholePeriod}
            variant="outlined"
            onClick={() => onChange({ start: planStart, end: planEnd })}
            data-testid={`limit-availability-${employee.id}`}
          />
        )}

        <IconButton
          aria-label={t.remove}
          onClick={onRemove}
          sx={{ marginInlineStart: 'auto', p: 1 }}
          data-testid={`remove-employee-${employee.id}`}
        >
          <DeleteOutlineIcon />
        </IconButton>
      </Stack>
    </Paper>
  );
}

export default function EmployeesPage() {
  const { doc, addEmployee, addEmployees, updateEmployee, removeEmployee } = usePlan();
  const [name, setName] = useState('');
  const [bulk, setBulk] = useState('');
  const [pendingRemove, setPendingRemove] = useState(null);
  const [toast, setToast] = useState(null);

  // Flagged, not blocked: a rename passes through every prefix of itself, so
  // the only place a duplicate can be refused outright is on the way in.
  const duplicates = duplicateEmployeeIds(doc.employees);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { skipped } = addEmployee(trimmed);
    if (skipped.length > 0) {
      // The name stays in the box: the usual fix is to tell the two people
      // apart ("דנה כ."), not to retype the whole thing.
      setToast(t.duplicateSkippedOne(skipped[0]));
      return;
    }
    setName('');
  };

  const submitBulk = () => {
    const names = bulk.split('\n').map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) return;
    const { skipped } = addEmployees(names);
    if (skipped.length > 0) {
      setToast(skipped.length === 1
        ? t.duplicateSkippedOne(skipped[0])
        : t.duplicateSkippedMany(skipped));
    }
    setBulk('');
  };

  return (
    <Box>
      <SettingsBar />

      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
        <Typography variant="h6">{t.employees}</Typography>
        {/* The headline number people check their own list against. */}
        <Chip
          size="small"
          label={t.employeeCount(doc.employees.length)}
          data-testid="employee-count"
        />
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <TextField
          label={t.employeeName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { 'data-testid': 'new-employee-name' } }}
        />
        <Button variant="contained" startIcon={<AddIcon />} onClick={submit} data-testid="add-employee">
          {t.addEmployee}
        </Button>
      </Stack>

      <Stack spacing={1} sx={{ mb: 3 }}>
        {doc.employees.length === 0 && (
          <>
            <Typography color="text.secondary">{t.noEmployees}</Typography>
            <Typography variant="caption" color="text.secondary">{t.emptyEmployeesHint}</Typography>
          </>
        )}
        {sortByHebrewName(doc.employees).map((e) => (
          <EmployeeRow
            key={e.id}
            employee={e}
            duplicate={duplicates.has(e.id)}
            planStart={doc.start}
            planEnd={doc.end}
            onChange={(patch) => updateEmployee(e.id, patch)}
            onRemove={() => setPendingRemove(e)}
          />
        ))}
      </Stack>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <TextField
          label={t.addManyLabel}
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          multiline
          minRows={3}
          fullWidth
          slotProps={{ htmlInput: { 'data-testid': 'bulk-names' } }}
        />
        <Button onClick={submitBulk} sx={{ mt: 1 }} data-testid="add-bulk">{t.addMany}</Button>
      </Paper>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="info" onClose={() => setToast(null)} data-testid="employee-toast">
          {toast}
        </Alert>
      </Snackbar>

      <ConfirmDialog
        open={pendingRemove != null}
        title={t.confirmRemoveEmployeeTitle}
        body={pendingRemove && t.confirmRemoveEmployeeBody(
          pendingRemove.name || t.employeeName,
          doc.pins.filter((p) => p.employeeId === pendingRemove.id).length,
        )}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          removeEmployee(pendingRemove.id);
          setPendingRemove(null);
        }}
        confirmTestId="confirm-remove-employee"
        cancelTestId="cancel-remove-employee"
      />
    </Box>
  );
}
