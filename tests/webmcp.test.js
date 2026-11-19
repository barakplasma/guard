import test from 'node:test';
import assert from 'node:assert/strict';
import { registerWebMcpTools } from '../src/lib/webmcp.js';

function harness() {
  const tools = new Map();
  const modelContext = {
    async registerTool(tool, options) {
      tools.set(tool.name, { tool, options });
    },
  };
  const calls = [];
  let state = {
    doc: {
      title: 'Night watch', start: 1000, end: 5000, shiftMinutes: 60,
      nightStart: 1320, nightEnd: 360,
      employees: [
        { id: 'e1', name: 'Alice', tags: [] },
        { id: 'e2', name: 'Bob', tags: [] },
      ],
      missions: [{ id: 'm1', name: 'Gate', type: 'local', count: 1 }],
    },
    schedule: {
      result: {
        shifts: [{ missionId: 'm1', employeeId: 'e1', start: 1000, end: 2000, pinned: false }],
        warnings: [{ code: 'rest-unsatisfied' }],
      },
    },
  };
  const actions = {
    addEmployees: (names) => calls.push(['addEmployees', names]),
    pinShift: (...args) => calls.push(['pinShift', ...args]),
    clearPin: (...args) => calls.push(['clearPin', ...args]),
  };
  return { tools, modelContext, calls, actions, getState: () => state, setState: (next) => { state = next; } };
}

test('registers the initial WebMCP tool set and cleans it up with abort signals', async () => {
  const h = harness();
  const cleanup = await registerWebMcpTools({ modelContext: h.modelContext, getState: h.getState, actions: h.actions });

  assert.deepEqual([...h.tools.keys()].sort(), [
    'add_employees', 'get_plan_summary', 'get_schedule', 'pin_shift', 'unpin_shift',
  ]);
  assert.ok([...h.tools.values()].every(({ options }) => options.signal.aborted === false));

  cleanup();
  assert.ok([...h.tools.values()].every(({ options }) => options.signal.aborted === true));
});

test('summary reads current state instead of the state at registration time', async () => {
  const h = harness();
  await registerWebMcpTools({ modelContext: h.modelContext, getState: h.getState, actions: h.actions });
  h.setState({ ...h.getState(), doc: { ...h.getState().doc, title: 'Updated watch' } });

  const result = await h.tools.get('get_plan_summary').tool.execute({});
  assert.equal(result.structuredContent.title, 'Updated watch');
  assert.equal(result.structuredContent.warningCounts['rest-unsatisfied'], 1);
});

test('pin tool accepts an exact live shift and rejects stale assignment references', async () => {
  const h = harness();
  await registerWebMcpTools({ modelContext: h.modelContext, getState: h.getState, actions: h.actions });

  await h.tools.get('pin_shift').tool.execute({
    missionId: 'm1', employeeId: 'e2', start: 1000, end: 2000,
    replacingEmployeeId: 'e1',
  });

  assert.deepEqual(h.calls, [
    ['pinShift', 'm1', 'e2', 1000, 2000, 'e1'],
  ]);
  await assert.rejects(
    h.tools.get('pin_shift').tool.execute({
      missionId: 'm1', employeeId: 'missing', start: 1000, end: 2000,
    }),
  );
  await assert.rejects(
    h.tools.get('pin_shift').tool.execute({
      missionId: 'm1', employeeId: 'e2', start: 1500, end: 2500,
    }),
  );
  await assert.rejects(
    h.tools.get('pin_shift').tool.execute({
      missionId: 'm1', employeeId: 'e2', start: 1000, end: 2000,
      replacingEmployeeId: 'missing',
    }),
  );
});

test('unpin tool only removes an exact currently pinned shift', async () => {
  const h = harness();
  h.setState({
    ...h.getState(),
    schedule: { result: { shifts: [
      { missionId: 'm1', employeeId: 'e1', start: 1000, end: 2000, pinned: true },
    ], warnings: [] } },
  });
  await registerWebMcpTools({ modelContext: h.modelContext, getState: h.getState, actions: h.actions });

  await h.tools.get('unpin_shift').tool.execute({
    missionId: 'm1', employeeId: 'e1', start: 1000, end: 2000,
  });
  assert.deepEqual(h.calls, [['clearPin', 'm1', 'e1', 1000, 2000]]);

  await assert.rejects(h.tools.get('unpin_shift').tool.execute({
    missionId: 'm1', employeeId: 'e2', start: 1000, end: 2000,
  }));
});

test('schedule tools distinguish incomplete plans and planner failures from empty schedules', async () => {
  const h = harness();
  await registerWebMcpTools({ modelContext: h.modelContext, getState: h.getState, actions: h.actions });

  h.setState({ ...h.getState(), schedule: {} });
  let result = await h.tools.get('get_schedule').tool.execute({});
  assert.deepEqual(result.structuredContent, { ready: false, error: null, shifts: [], warnings: [] });

  h.setState({ ...h.getState(), schedule: { error: 'planner failed' } });
  result = await h.tools.get('get_schedule').tool.execute({});
  assert.deepEqual(result.structuredContent, {
    ready: false, error: 'planner failed', shifts: [], warnings: [],
  });
  const summary = await h.tools.get('get_plan_summary').tool.execute({});
  assert.equal(summary.structuredContent.scheduleReady, false);
  assert.equal(summary.structuredContent.scheduleError, 'planner failed');
});
