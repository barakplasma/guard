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

test('signup always lands as an active guard, never commander', { skip: !HAS_PB }, async () => {
  const record = await signup('guard.role.test@example.com', 'testpass123', 'Guard Role Test');
  assert.equal(record.role, 'guard');
  assert.equal(record.active, true);
});

test('a guard cannot create a schedule (commander-only createRule)', { skip: !HAS_PB }, async () => {
  await signup('guard.perm.test@example.com', 'testpass123', 'Guard Perm Test');
  const token = await login('guard.perm.test@example.com', 'testpass123');

  const { status } = await api('/api/collections/schedules/records', {
    method: 'POST',
    token,
    body: {
      start: '2027-01-01 00:00:00',
      end: '2027-01-02 00:00:00',
      shift_minutes: 60,
      positions: 1,
      created_by: 'anything',
    },
  });
  assert.equal(status, 400);
});

test('unauthenticated requests see an empty shift list, not an error', { skip: !HAS_PB }, async () => {
  const { status, json } = await api('/api/collections/shifts/records');
  assert.equal(status, 200);
  assert.deepEqual(json.items, []);
});

// "check multiple different guard positions roster": generate + persist a
// schedule for several different `positions` values (1, 2, 3 guards per
// shift) and confirm what PocketBase actually stored matches what
// scheduler.js planned - not just that the API call succeeded.
for (const positions of [1, 2, 3]) {
  test(`commander can generate and persist a roster with positions=${positions}`, { skip: !HAS_PB }, async () => {
    const guardNames = ['Alice', 'Bob', 'Carol', 'Dana'];
    const suffix = `pos${positions}`;
    const guardIds = new Map();

    for (const name of guardNames) {
      const email = `${name.toLowerCase()}.${suffix}@example.com`;
      const record = await signup(email, 'testpass123', name);
      guardIds.set(name, record.id);
    }

    // Promote the first guard to commander via the ephemeral instance's own
    // admin account (never touches the real superuser/prod instance).
    const adminToken = await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);
    const commanderName = guardNames[0];
    const { status: promoteStatus } = await api(`/api/collections/users/records/${guardIds.get(commanderName)}`, {
      method: 'PATCH',
      token: adminToken,
      body: { role: 'commander' },
    });
    assert.equal(promoteStatus, 200);
    const commanderToken = await login(`${commanderName.toLowerCase()}.${suffix}@example.com`, 'testpass123');

    // Each `positions` value gets its own day so guard availability never
    // overlaps across the 3 sub-tests sharing this guard pool.
    const dayIndex = positions;
    const start = Date.UTC(2027, 0, dayIndex, 0, 0, 0);
    const end = start + 6 * 3600 * 1000; // 6 one-hour shifts

    const plannedShifts = generateShifts({
      start,
      end,
      shiftMinutes: 60,
      positions,
      guards: guardNames,
    });
    assert.equal(plannedShifts.length, 6);
    for (const shift of plannedShifts) {
      assert.equal(shift.guards.length, positions);
    }

    const { status: scheduleStatus, json: schedule } = await api('/api/collections/schedules/records', {
      method: 'POST',
      token: commanderToken,
      body: {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        shift_minutes: 60,
        positions,
        created_by: guardIds.get(commanderName),
      },
    });
    assert.equal(scheduleStatus, 200, JSON.stringify(schedule));

    for (const shift of plannedShifts) {
      const { status } = await api('/api/collections/shifts/records', {
        method: 'POST',
        token: commanderToken,
        body: {
          schedule: schedule.id,
          start: new Date(shift.start).toISOString(),
          end: new Date(shift.end).toISOString(),
          guards: shift.guards.map((name) => guardIds.get(name)),
        },
      });
      assert.equal(status, 200);
    }

    const { status: listStatus, json: stored } = await api(
      `/api/collections/shifts/records?filter=${encodeURIComponent(`schedule = "${schedule.id}"`)}&sort=start&expand=guards`,
      { token: commanderToken },
    );
    assert.equal(listStatus, 200);
    assert.equal(stored.items.length, 6);

    for (let i = 0; i < stored.items.length; i++) {
      const storedGuardNames = stored.items[i].expand.guards.map((g) => g.name).sort();
      const expectedGuardNames = [...plannedShifts[i].guards].sort();
      assert.deepEqual(
        storedGuardNames,
        expectedGuardNames,
        `shift ${i} (positions=${positions}): stored guards don't match what generateShifts planned`,
      );
    }
  });
}

test('swap accept moves the guard, and only the recipient may accept', { skip: !HAS_PB }, async () => {
  const guardA = await signup('swap.a@example.com', 'testpass123', 'Swap A');
  const guardB = await signup('swap.b@example.com', 'testpass123', 'Swap B');
  const guardC = await signup('swap.c@example.com', 'testpass123', 'Swap C');

  const adminToken = await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);
  await api(`/api/collections/users/records/${guardA.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { role: 'commander' },
  });
  const commanderToken = await login('swap.a@example.com', 'testpass123');

  const { json: schedule } = await api('/api/collections/schedules/records', {
    method: 'POST',
    token: commanderToken,
    body: {
      start: '2027-06-01 00:00:00',
      end: '2027-06-01 06:00:00',
      shift_minutes: 60,
      positions: 1,
      created_by: guardA.id,
    },
  });
  const { json: shift } = await api('/api/collections/shifts/records', {
    method: 'POST',
    token: commanderToken,
    body: {
      schedule: schedule.id,
      start: '2027-06-01 00:00:00',
      end: '2027-06-01 01:00:00',
      guards: [guardA.id],
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
  assert.deepEqual(shiftAfter.guards, [guardB.id]);
});
