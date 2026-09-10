import { useState } from 'react';
import { Autocomplete, Button, IconButton, Paper, Stack, TextField, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { usePlan } from '../state/PlanContext.jsx';
import { makeId } from '../lib/planSchema.js';
import { removeTag } from '../lib/tags.js';
import NumberField from './NumberField.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { t } from '../strings.js';

function TagPicker({ tags, value, onChange, label, testId, disabledIds = [] }) {
  return <Autocomplete multiple getOptionDisabled={(tag) => disabledIds.includes(tag.id)} options={tags} value={tags.filter((tag) => value.includes(tag.id))}
    getOptionLabel={(tag) => tag.name || t.qualificationName} isOptionEqualToValue={(a, b) => a.id === b.id}
    onChange={(_, selected) => onChange(selected.map((tag) => tag.id))}
    sx={{ minWidth: 0, width: '100%', '& .MuiChip-root': { maxWidth: '100%' } }}
    renderInput={(params) => <TextField {...params} label={label}
      slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, 'data-testid': testId } }} />} />;
}

export function EmployeeQualifications({ employee, onChange }) {
  const { doc } = usePlan();
  if (!doc.tags.length) return null;
  return <TagPicker tags={doc.tags} value={employee.tags ?? []} label={t.qualifications}
    testId={`employee-tags-${employee.id}`} onChange={(tags) => onChange({ tags })} />;
}

export function MissionQualifications({ mission, onChange }) {
  const { doc } = usePlan();
  if (!doc.tags.length) return null;
  const requires = mission.requires ?? [];
  return <Stack spacing={1}>
    <TagPicker tags={doc.tags} disabledIds={mission.excludes ?? []}
      value={requires.map((r) => r.tag)} label={t.requiredQualifications}
      testId={`mission-requires-${mission.id}`} onChange={(ids) => onChange({ requires: ids.map((tag) => requires.find((r) => r.tag === tag) ?? { tag, count: 1 }) })} />
    <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
      {requires.map((r) => <NumberField key={r.tag} label={doc.tags.find((tag) => tag.id === r.tag)?.name || t.qualificationName}
        value={r.count} testId={`require-count-${mission.id}-${r.tag}`}
        onChange={(count) => onChange({ requires: requires.map((x) => x.tag === r.tag ? { ...x, count } : x) })} />)}
    </Stack>
    <TagPicker tags={doc.tags} disabledIds={requires.map((r) => r.tag)}
      value={mission.excludes ?? []} label={t.excludedQualifications}
      testId={`mission-excludes-${mission.id}`} onChange={(excludes) => onChange({ excludes })} />
    <Typography variant="caption">{t.combinedQualificationsHelp}</Typography>
  </Stack>;
}

export default function QualificationManager() {
  const { doc, update } = usePlan();
  const [pending, setPending] = useState(null);
  const change = (id, patch) => update((d) => ({ ...d, tags: d.tags.map((tag) => tag.id === id ? { ...tag, ...patch } : tag) }));
  return <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
    <Typography variant="subtitle1">{t.qualifications}</Typography>
    <Stack spacing={1} sx={{ my: 1 }}>
      {doc.tags.map((tag) => <Stack key={tag.id} direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField label={t.qualificationName} value={tag.name} sx={{ flex: '1 1 140px', minWidth: 0 }}
          slotProps={{ htmlInput: { maxLength: 80, 'data-testid': `tag-name-${tag.id}` } }} onChange={(e) => change(tag.id, { name: e.target.value })} />
        <NumberField label={t.nightRestMinutes} value={tag.minNightRestMinutes} sx={{ flex: '1 1 220px', minWidth: 0 }}
          nullable max={1440} testId={`tag-rest-${tag.id}`}
          onChange={(minNightRestMinutes) => change(tag.id, { minNightRestMinutes })} />
        <IconButton aria-label={t.remove} data-testid={`remove-tag-${tag.id}`} onClick={() => setPending(tag)}><DeleteOutlineIcon /></IconButton>
      </Stack>)}
    </Stack>
    <Button data-testid="add-tag" onClick={() => update((d) => ({ ...d, tags: [...d.tags, { id: makeId('q', d.tags.map((tag) => tag.id)), name: '', minNightRestMinutes: null }] }))}>{t.addQualification}</Button>
    {doc.tags.length > 0 && <Typography variant="caption" sx={{ display: 'block' }}>{t.restHelp}</Typography>}
    <ConfirmDialog open={pending != null} title={t.removeQualification}
      body={pending ? t.removeQualificationBody(pending.name,
        doc.employees.filter((e) => e.tags.includes(pending.id)).length,
        doc.missions.filter((m) => m.excludes.includes(pending.id) || m.requires.some((r) => r.tag === pending.id)).length) : ''}
      onCancel={() => setPending(null)} onConfirm={() => { update((d) => removeTag(d, pending.id)); setPending(null); }}
      confirmTestId="confirm-remove-tag" cancelTestId="cancel-remove-tag" />
  </Paper>;
}
