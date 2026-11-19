import { z } from 'zod';

const id = z.string().trim().min(1).max(64);
const namesInput = z.object({
  names: z.array(z.string().trim().min(1).max(80)).min(1).max(100),
}).strict();
const shiftFields = z.object({
  missionId: id,
  employeeId: id,
  start: z.number().int().safe(),
  end: z.number().int().safe(),
  replacingEmployeeId: id.optional(),
}).strict();
const validRange = (schema) => schema.refine(
  ({ start, end }) => end > start, { message: 'end must be after start' },
);
const shiftInput = validRange(shiftFields);
const unpinInput = validRange(shiftFields.omit({ replacingEmployeeId: true }));

const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const stringId = { type: 'string', minLength: 1, maxLength: 64 };
const shiftProperties = {
  missionId: stringId,
  employeeId: stringId,
  start: { type: 'integer', description: 'Shift start as Unix milliseconds.' },
  end: { type: 'integer', description: 'Shift end as Unix milliseconds.' },
};

function response(structuredContent) {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function scheduleState(schedule) {
  if (schedule?.result) return {
    ready: true,
    error: null,
    shifts: schedule.result.shifts ?? [],
    warnings: schedule.result.warnings ?? [],
  };
  return {
    ready: false,
    error: schedule?.error ?? null,
    shifts: [],
    warnings: [],
  };
}

function currentShift(state, value, { pinned = false } = {}) {
  const schedule = scheduleState(state.schedule);
  if (!schedule.ready) throw new Error(schedule.error ?? 'Schedule is not ready.');
  if (!state.doc.employees.some((employee) => employee.id === value.employeeId)) {
    throw new Error(`Unknown employee: ${value.employeeId}`);
  }
  if (!state.doc.missions.some((mission) => mission.id === value.missionId)) {
    throw new Error(`Unknown mission: ${value.missionId}`);
  }
  const rows = schedule.shifts.filter((shift) => shift.missionId === value.missionId
    && shift.start === value.start && shift.end === value.end);
  if (!rows.length) throw new Error('No current shift matches that mission and interval.');
  if (pinned && !rows.some((shift) => shift.employeeId === value.employeeId && shift.pinned)) {
    throw new Error('No matching manual assignment exists.');
  }
  return rows;
}

function warningCounts(warnings = []) {
  return warnings.reduce((counts, warning) => ({
    ...counts,
    [warning.code]: (counts[warning.code] ?? 0) + 1,
  }), {});
}

function toolDefinitions(getState, actions) {
  return [
    {
      name: 'get_plan_summary',
      title: 'Get plan summary',
      description: 'Read current plan settings, people, missions, and finding counts.',
      inputSchema: objectSchema({}),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async () => {
        const { doc, schedule } = getState();
        const current = scheduleState(schedule);
        return response({
          title: doc.title,
          start: doc.start,
          end: doc.end,
          shiftMinutes: doc.shiftMinutes,
          nightStartMinutes: doc.nightStart,
          nightEndMinutes: doc.nightEnd,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          employees: doc.employees.map(({ id: employeeId, name, tags = [] }) => ({ employeeId, name, tags })),
          missions: doc.missions.map(({ id: missionId, name, type, count }) => ({ missionId, name, type, count })),
          scheduleReady: current.ready,
          scheduleError: current.error,
          warningCounts: warningCounts(current.warnings),
        });
      },
    },
    {
      name: 'get_schedule',
      title: 'Get schedule',
      description: 'Read current generated shifts and findings, including IDs and Unix-millisecond times used by pin tools.',
      inputSchema: objectSchema({}),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async () => {
        return response(scheduleState(getState().schedule));
      },
    },
    {
      name: 'add_employees',
      title: 'Add employees',
      description: 'Add up to 100 people to the roster. This can regenerate future automatic staffing.',
      inputSchema: objectSchema({
        names: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 80 } },
      }),
      annotations: { consequentialHint: true, untrustedContentHint: true },
      execute: async (input) => {
        const { added, skipped } = actions.addEmployees(namesInput.parse(input).names);
        return response({
          added: added.map(({ id: employeeId, name }) => ({ employeeId, name })),
          skipped,
        });
      },
    },
    {
      name: 'pin_shift',
      title: 'Pin shift assignment',
      description: 'Manually assign or replace a person on one mission shift. Manual assignments override automatic staffing.',
      inputSchema: objectSchema({ ...shiftProperties, replacingEmployeeId: stringId }, Object.keys(shiftProperties)),
      annotations: { consequentialHint: true },
      execute: async (input) => {
        const value = shiftInput.parse(input);
        const state = getState();
        const rows = currentShift(state, value);
        if (value.replacingEmployeeId
          && !rows.some((shift) => shift.employeeId === value.replacingEmployeeId)) {
          throw new Error('The employee being replaced is not assigned to that shift.');
        }
        actions.pinShift(value.missionId, value.employeeId, value.start, value.end, value.replacingEmployeeId);
        return response({ status: 'pinned', ...value });
      },
    },
    {
      name: 'unpin_shift',
      title: 'Remove manual assignment',
      description: 'Remove a manual pin from one mission shift so automatic scheduling can choose the assignment again.',
      inputSchema: objectSchema(shiftProperties),
      annotations: { consequentialHint: true },
      execute: async (input) => {
        const value = unpinInput.parse(input);
        currentShift(getState(), value, { pinned: true });
        actions.clearPin(value.missionId, value.employeeId, value.start, value.end);
        return response({ status: 'unpinned', ...value });
      },
    },
  ];
}

/** Register Guard's page-local tools. Returns a cleanup callback. */
export async function registerWebMcpTools({ modelContext, getState, actions }) {
  if (!modelContext?.registerTool) return () => {};
  const controller = new AbortController();
  try {
    for (const tool of toolDefinitions(getState, actions)) {
      await modelContext.registerTool(tool, { signal: controller.signal });
    }
  } catch (error) {
    controller.abort();
    console.warn('WebMCP tools were not registered.', error);
  }
  return () => controller.abort();
}

export function browserModelContext() {
  if (typeof document !== 'undefined' && document.modelContext) return document.modelContext;
  if (typeof navigator !== 'undefined' && navigator.modelContext) return navigator.modelContext;
  return null;
}
