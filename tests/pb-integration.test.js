// Integration tests against a REAL, isolated PocketBase instance - not the
// `guard.service` one on :8090. Every run gets its own --dir (a throwaway
// tmp SQLite data dir) and its own port, and both are torn down afterwards,
// so this never reads or writes anything under the repo's pb_data/.
//
// Requires the `pocketbase` binary at the repo root (gitignored, produced by
// scripts/setup.sh). If it's missing, these tests are skipped rather than
// failed, so `node --test` still runs cleanly on a machine that only has the
// scheduler.js unit tests set up (see tests/scheduler.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateShifts } from '../scheduler/scheduler.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PB_BIN = join(ROOT, 'pocketbase');
const PORT = 8099;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const HAS_PB = existsSync(PB_BIN);

const ADMIN_EMAIL = 'integration_test_admin@example.com';
const ADMIN_PASSWORD = 'IntegrationTestAdmin123';

let dataDir;
let pbProcess;

function runCli(args) {
  const output = execFileSync(PB_BIN, [
    ...args,
    `--dir=${dataDir}`,
    `--migrationsDir=${join(ROOT, 'pb_migrations')}`,
    `--hooksDir=${join(ROOT, 'pb_hooks')}`,
  ], { encoding: 'utf8' });
  // `migrate up` / `superuser upsert` have been seen to print "Error: ..."
  // while still exiting 0 (see scripts/setup.sh) - grep instead of trusting
  // the exit code alone.
  if (output.includes('Error:')) {
    throw new Error(`pocketbase ${args.join(' ')} failed:\n${output}`);
  }
  return output;
}

async function waitForHealth(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`pocketbase did not become healthy within ${timeoutMs}ms`);
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function signup(email, password, name) {
  const { status, json } = await api('/api/collections/users/records', {
    method: 'POST',
    body: { email, password, passwordConfirm: password, name },
  });
  assert.equal(status, 200, `signup for ${email} failed: ${JSON.stringify(json)}`);
  return json;
}

async function login(email, password) {
  const { status, json } = await api('/api/collections/users/auth-with-password', {
    method: 'POST',
    body: { identity: email, password },
  });
  assert.equal(status, 200, `login for ${email} failed: ${JSON.stringify(json)}`);
  return json.token;
}

// The CLI-created admin lives in `_superusers`, a separate auth collection
// from the app's `users` - a different endpoint from login() above.
async function loginAdmin(email, password) {
  const { status, json } = await api('/api/collections/_superusers/auth-with-password', {
    method: 'POST',
    body: { identity: email, password },
  });
  assert.equal(status, 200, `admin login for ${email} failed: ${JSON.stringify(json)}`);
  return json.token;
}

async function approve(token, userId, fields = {}) {
  const { status, json } = await api(`/api/collections/users/records/${userId}`, {
    method: 'PATCH',
    token,
    body: { active: true, ...fields },
  });
  assert.equal(status, 200, `approve user failed: ${JSON.stringify(json)}`);
}

async function createPosition(token, body) {
  const { status, json } = await api('/api/collections/positions/records', {
    method: 'POST',
    token,
    body: { people_count: 1, ...body },
  });
  assert.equal(status, 200, `create position failed: ${JSON.stringify(json)}`);
  return json;
}

test.before(async () => {
  if (!HAS_PB) {
    console.log(`Skipping pb-integration tests: no pocketbase binary at ${PB_BIN} (run scripts/setup.sh)`);
    return;
  }

  dataDir = mkdtempSync(join(tmpdir(), 'guard-pb-test-'));

  runCli(['migrate', 'up']);
  runCli(['superuser', 'upsert', ADMIN_EMAIL, ADMIN_PASSWORD]);

  pbProcess = spawn(PB_BIN, [
    'serve',
    `--http=127.0.0.1:${PORT}`,
    `--dir=${dataDir}`,
    `--migrationsDir=${join(ROOT, 'pb_migrations')}`,
    `--hooksDir=${join(ROOT, 'pb_hooks')}`,
    `--publicDir=${join(dataDir, 'empty_public')}`,
  ]);
  pbProcess.stderr.on('data', () => {}); // avoid EPIPE noise if the process exits early
  await waitForHealth();
});

test.after(() => {
  if (!HAS_PB) return;
  pbProcess?.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test('signup lands as an inactive guard pending commander approval', { skip: !HAS_PB }, async () => {
  const record = await signup('guard.role.test@example.com', 'testpass123', 'Guard Role Test');
  assert.equal(record.role, 'guard');
  assert.equal(record.active, false);
});

test('a guard cannot create a schedule (commander-only createRule)', { skip: !HAS_PB }, async () => {
  const guard = await signup('guard.perm.test@example.com', 'testpass123', 'Guard Perm Test');
  await approve(await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD), guard.id);
  const token = await login('guard.perm.test@example.com', 'testpass123');

  const { status } = await api('/api/collections/schedules/records', {
    method: 'POST',
    token,
    body: {
      start: '2027-01-01 00:00:00',
      end: '2027-01-02 00:00:00',
      shift_minutes: 60,
      positions: [],
      created_by: 'anything',
    },
  });
  assert.equal(status, 400);
});

test('a guard cannot create a position (commander-only createRule), but can list them', { skip: !HAS_PB }, async () => {
  const guard = await signup('guard.pos.test@example.com', 'testpass123', 'Guard Pos Test');
  await approve(await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD), guard.id);
  const token = await login('guard.pos.test@example.com', 'testpass123');

  const { status: createStatus } = await api('/api/collections/positions/records', {
    method: 'POST',
    token,
    body: { name: 'Should Fail', active: true },
  });
  assert.equal(createStatus, 400);

  const { status: listStatus } = await api('/api/collections/positions/records', { token });
  assert.equal(listStatus, 200);
});

test('a commander can set a guard vacation period', { skip: !HAS_PB }, async () => {
  const commander = await signup('vacation.commander@example.com', 'testpass123', 'Vacation Commander');
  const guard = await signup('vacation.guard@example.com', 'testpass123', 'Vacation Guard');
  const adminToken = await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);
  await approve(adminToken, commander.id, { role: 'commander' });
  await approve(adminToken, guard.id);
  const commanderToken = await login('vacation.commander@example.com', 'testpass123');

  const vacationStart = '2027-07-01 08:00:00.000Z';
  const vacationEnd = '2027-07-03 18:00:00.000Z';
  const { status, json } = await api(`/api/collections/users/records/${guard.id}`, {
    method: 'PATCH',
    token: commanderToken,
    body: { vacation_start: vacationStart, vacation_end: vacationEnd },
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(new Date(json.vacation_start).getTime(), new Date(vacationStart).getTime());
  assert.equal(new Date(json.vacation_end).getTime(), new Date(vacationEnd).getTime());
});

test('unauthenticated requests see an empty shift list, not an error', { skip: !HAS_PB }, async () => {
  const { status, json } = await api('/api/collections/shifts/records');
  assert.equal(status, 200);
  assert.deepEqual(json.items, []);
});

// "check multiple different guard positions roster": generate + persist a
// schedule with several different NAMED positions per slot (1, 2, then 3
// concurrent posts) and confirm what PocketBase actually stored matches what
// scheduler.js planned - not just that the API calls succeeded.
for (const positionCount of [1, 2, 3]) {
  test(`commander can generate and persist a roster with ${positionCount} named position(s) per slot`, { skip: !HAS_PB }, async () => {
    const guardNames = ['Alice', 'Bob', 'Carol', 'Dana'];
    const suffix = `posn${positionCount}`;
    const guardIds = new Map();

    for (const name of guardNames) {
      const email = `${name.toLowerCase()}.${suffix}@example.com`;
      const record = await signup(email, 'testpass123', name);
      guardIds.set(name, record.id);
    }

    const adminToken = await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);
    const commanderName = guardNames[0];
    for (const name of guardNames) {
      await approve(adminToken, guardIds.get(name), name === commanderName ? { role: 'commander' } : {});
    }
    const commanderToken = await login(`${commanderName.toLowerCase()}.${suffix}@example.com`, 'testpass123');

    const positionNames = ['South', 'Gate', 'Patrol'].slice(0, positionCount);
    const positionRecords = [];
    for (const name of positionNames) {
      positionRecords.push(await createPosition(commanderToken, { name: `${name} (${suffix})`, active: true }));
    }
    const positionDescriptors = positionRecords.map((p) => ({ id: p.id, name: p.name }));

    // Each positionCount value gets its own day so guard availability never
    // overlaps across the 3 sub-tests sharing this guard pool.
    const start = Date.UTC(2027, 0, positionCount, 0, 0, 0);
    const end = start + 6 * 3600 * 1000; // 6 one-hour slots

    const plannedShifts = generateShifts({
      start,
      end,
      shiftMinutes: 60,
      positions: positionDescriptors,
      guards: guardNames,
    });
    assert.equal(plannedShifts.length, 6 * positionCount);

    const { status: scheduleStatus, json: schedule } = await api('/api/collections/schedules/records', {
      method: 'POST',
      token: commanderToken,
      body: {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        shift_minutes: 60,
        positions: positionRecords.map((p) => p.id),
        created_by: guardIds.get(commanderName),
      },
    });
    assert.equal(scheduleStatus, 200, JSON.stringify(schedule));

    for (const shift of plannedShifts) {
      const { status, json } = await api('/api/collections/shifts/records', {
        method: 'POST',
        token: commanderToken,
        body: {
          schedule: schedule.id,
          position: shift.position,
          start: new Date(shift.start).toISOString(),
          end: new Date(shift.end).toISOString(),
          guard: guardIds.get(shift.guard),
        },
      });
      assert.equal(status, 200, JSON.stringify(json));
    }

    const { status: listStatus, json: stored } = await api(
      `/api/collections/shifts/records?filter=${encodeURIComponent(`schedule = "${schedule.id}"`)}&sort=start&perPage=100&expand=guard,position`,
      { token: commanderToken },
    );
    assert.equal(listStatus, 200);
    assert.equal(stored.items.length, plannedShifts.length);

    // Compare (start, position id, guard id) triples as sorted sets rather
    // than by array index - multiple rows now share the same start/end, one
    // per position, so index order isn't guaranteed to match insertion order.
    const guardIdToName = new Map([...guardIds.entries()].map(([name, id]) => [id, name]));
    const expected = plannedShifts
      .map((s) => `${s.start}|${s.position}|${s.guard}`)
      .sort();
    const actual = stored.items
      .map((s) => `${new Date(s.start).getTime()}|${s.expand.position.id}|${guardIdToName.get(s.expand.guard.id)}`)
      .sort();
    assert.deepEqual(actual, expected);
  });
}

test('a position persists its staffing rules and creates one shift per required person', { skip: !HAS_PB }, async () => {
  const guards = [];
  for (const name of ['Staff Commander', 'Qualified One', 'Qualified Two']) {
    guards.push(await signup(`${name.toLowerCase().replaceAll(' ', '.')}@staffing.example.com`, 'testpass123', name));
  }

  const adminToken = await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);
  // This also keeps the test compatible with the approval gate when it is
  // enabled: only active users may authenticate.
  for (const [index, guard] of guards.entries()) {
    const { status } = await api(`/api/collections/users/records/${guard.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: { active: true, ...(index === 0 ? { role: 'commander' } : {}) },
    });
    assert.equal(status, 200);
  }

  const commanderToken = await login('staff.commander@staffing.example.com', 'testpass123');
  const patrol = await createPosition(commanderToken, {
    name: 'Qualified patrol',
    people_count: 2,
    eligible_users: [guards[1].id, guards[2].id],
    active: true,
  });
  assert.equal(patrol.people_count, 2);
  assert.deepEqual(patrol.eligible_users.sort(), [guards[1].id, guards[2].id].sort());

  const start = Date.UTC(2027, 8, 1, 8, 0, 0);
  const plannedShifts = generateShifts({
    start,
    end: start + 60 * 60 * 1000,
    shiftMinutes: 60,
    positions: [{
      id: patrol.id,
      name: patrol.name,
      peopleCount: patrol.people_count,
      eligibleGuards: ['Qualified One', 'Qualified Two'],
    }],
    guards: guards.map((guard) => guard.name),
  });
  assert.equal(plannedShifts.length, 2);
  assert.deepEqual(plannedShifts.map((shift) => shift.guard).sort(), ['Qualified One', 'Qualified Two']);
});

test('swap accept moves the guard, and only the recipient may accept', { skip: !HAS_PB }, async () => {
  const guardA = await signup('swap.a@example.com', 'testpass123', 'Swap A');
  const guardB = await signup('swap.b@example.com', 'testpass123', 'Swap B');
  const guardC = await signup('swap.c@example.com', 'testpass123', 'Swap C');

  const adminToken = await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);
  await approve(adminToken, guardA.id, { role: 'commander' });
  await approve(adminToken, guardB.id);
  await approve(adminToken, guardC.id);
  const commanderToken = await login('swap.a@example.com', 'testpass123');
  const position = await createPosition(commanderToken, { name: 'Gate (swap test)', active: true });

  const { json: schedule } = await api('/api/collections/schedules/records', {
    method: 'POST',
    token: commanderToken,
    body: {
      start: '2027-06-01 00:00:00',
      end: '2027-06-01 06:00:00',
      shift_minutes: 60,
      positions: [position.id],
      created_by: guardA.id,
    },
  });
  const { json: shift } = await api('/api/collections/shifts/records', {
    method: 'POST',
    token: commanderToken,
    body: {
      schedule: schedule.id,
      position: position.id,
      start: '2027-06-01 00:00:00',
      end: '2027-06-01 01:00:00',
      guard: guardA.id,
    },
  });

  const tokenA = await login('swap.a@example.com', 'testpass123');
  const { json: swap } = await api('/api/collections/swap_requests/records', {
    method: 'POST',
    token: tokenA,
    body: { shift: shift.id, from_user: guardA.id, to_user: guardB.id, status: 'pending' },
  });

  // guard C (not the recipient) must not be able to accept it. PocketBase
  // folds the updateRule into the record lookup, so a rule mismatch on a
  // specific ID reads as "not found" (404) rather than the generic 400
  // "Failed to update record" a createRule violation gives (see the
  // schedules test above) - confirmed against the live binary, not assumed.
  const tokenC = await login('swap.c@example.com', 'testpass123');
  const { status: wrongAcceptStatus } = await api(`/api/collections/swap_requests/records/${swap.id}`, {
    method: 'PATCH',
    token: tokenC,
    body: { status: 'accepted' },
  });
  assert.equal(wrongAcceptStatus, 404);

  const tokenB = await login('swap.b@example.com', 'testpass123');
  const { status: acceptStatus } = await api(`/api/collections/swap_requests/records/${swap.id}`, {
    method: 'PATCH',
    token: tokenB,
    body: { status: 'accepted' },
  });
  assert.equal(acceptStatus, 200);

  const { json: shiftAfter } = await api(`/api/collections/shifts/records/${shift.id}`, { token: tokenB });
  assert.equal(shiftAfter.guard, guardB.id);
});

test('a time-restricted position (patrol) only generates + persists shifts inside its window', { skip: !HAS_PB }, async () => {
  const guardNames = ['Erez', 'Fadi', 'Gila'];
  const guardIds = new Map();
  for (const name of guardNames) {
    const record = await signup(`${name.toLowerCase()}.patrol@example.com`, 'testpass123', name);
    guardIds.set(name, record.id);
  }

  const adminToken = await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);
  await approve(adminToken, guardIds.get('Erez'), { role: 'commander' });
  const commanderToken = await login('erez.patrol@example.com', 'testpass123');

  const gate = await createPosition(commanderToken, { name: 'Gate (patrol test)', active: true });
  const patrol = await createPosition(commanderToken, {
    name: 'Patrol (patrol test)',
    time_restricted: true,
    window_start: '22:00',
    window_end: '06:00',
    active: true,
  });

  // 20:00 -> 08:00 next day, 1h slots: patrol should only cover 22:00-06:00 (8 of 12).
  const start = new Date(2027, 7, 1, 20, 0, 0).getTime();
  const end = new Date(2027, 7, 2, 8, 0, 0).getTime();

  const plannedShifts = generateShifts({
    start,
    end,
    shiftMinutes: 60,
    positions: [
      { id: gate.id, name: gate.name },
      { id: patrol.id, name: patrol.name, timeRestricted: true, windowStart: '22:00', windowEnd: '06:00' },
    ],
    guards: guardNames,
  });
  assert.equal(plannedShifts.filter((s) => s.position === gate.id).length, 12);
  assert.equal(plannedShifts.filter((s) => s.position === patrol.id).length, 8);

  const { json: schedule } = await api('/api/collections/schedules/records', {
    method: 'POST',
    token: commanderToken,
    body: {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      shift_minutes: 60,
      positions: [gate.id, patrol.id],
      created_by: guardIds.get('Erez'),
    },
  });

  for (const shift of plannedShifts) {
    const { status } = await api('/api/collections/shifts/records', {
      method: 'POST',
      token: commanderToken,
      body: {
        schedule: schedule.id,
        position: shift.position,
        start: new Date(shift.start).toISOString(),
        end: new Date(shift.end).toISOString(),
        guard: guardIds.get(shift.guard),
      },
    });
    assert.equal(status, 200);
  }

  const { json: stored } = await api(
    `/api/collections/shifts/records?filter=${encodeURIComponent(`schedule = "${schedule.id}" && position = "${patrol.id}"`)}&perPage=100`,
    { token: commanderToken },
  );
  assert.equal(stored.items.length, 8);
  for (const item of stored.items) {
    const hour = new Date(item.start).getHours();
    assert.ok(hour >= 22 || hour < 6, `patrol shift at hour ${hour} is outside its 22:00-06:00 window`);
  }
});
