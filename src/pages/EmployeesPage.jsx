import { useState } from 'react';
import {
  Box, Button, Chip, IconButton, Paper, Stack, TextField, Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import DateTimeField from '../components/DateTimeField.jsx';
import SettingsBar from '../components/SettingsBar.jsx';
import { usePlan } from '../state/PlanContext.jsx';
import { t } from '../strings.js';

function EmployeeRow({ employee, planStart, planEnd, onChange, onRemove }) {
  // "Whole period" is the default and by far the common case, so it stays a
  // single chip until someone actually needs a narrower window.
  const limited = employee.start != null || employee.end != null;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <TextField
          label={t.employeeName}
          value={employee.name}
          onChange={(e) => onChange({ name: e.target.value })}
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
          sx={{ marginInlineStart: 'auto' }}
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

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addEmployee(trimmed);
    setName('');
  };

  const submitBulk = () => {
    const names = bulk.split('\n').map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) return;
    addEmployees(names);
    setBulk('');
  };

  return (
    <Box>
      <SettingsBar />

      <Typography variant="h6" sx={{ mb: 1 }}>{t.employees}</Typography>

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
          <Typography color="text.secondary">{t.noEmployees}</Typography>
        )}
        {doc.employees.map((e) => (
          <EmployeeRow
            key={e.id}
            employee={e}
            planStart={doc.start}
            planEnd={doc.end}
            onChange={(patch) => updateEmployee(e.id, patch)}
            onRemove={() => removeEmployee(e.id)}
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
    </Box>
  );
}
