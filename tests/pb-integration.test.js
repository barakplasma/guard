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

async function createPosition(token, body) {
  const { status, json } = await api('/api/collections/positions/records', { method: 'POST', token, body });
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

test('signup always lands as an active guard, never commander', { skip: !HAS_PB }, async () => {
  const record = await signup('guard.role.test@example.com', 'testpass123', 'Guard Role Test');
  assert.equal(record.role, 'guard');
  assert.equal(record.active, true);
});

test('a commander can set another user\'s min_sleep_hours, a guard cannot edit others', { skip: !HAS_PB }, async () => {
  const boss = await signup('sleep.boss@example.com', 'testpass123', 'Sleep Boss');
  const driver = await signup('sleep.driver@example.com', 'testpass123', 'Sleep Driver');
  const nosy = await signup('sleep.nosy@example.com', 'testpass123', 'Sleep Nosy');

  const adminToken = await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);
  await api(`/api/collections/users/records/${boss.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { role: 'commander' },
  });

  // Commander sets the driver's minimum sleep to 6h.
  const commanderToken = await login('sleep.boss@example.com', 'testpass123');
  const { status: setStatus, json: updated } = await api(`/api/collections/users/records/${driver.id}`, {
    method: 'PATCH',
    token: commanderToken,
    body: { min_sleep_hours: 6 },
  });
  assert.equal(setStatus, 200, JSON.stringify(updated));
  assert.equal(updated.min_sleep_hours, 6);

  // A commander may also toggle another user's `active` flag (marking them on
  // vacation) - it's on the allowlist alongside min_sleep_hours.
  const { status: vacationStatus, json: onVacation } = await api(`/api/collections/users/records/${driver.id}`, {
    method: 'PATCH',
    token: commanderToken,
    body: { active: false },
  });
  assert.equal(vacationStatus, 200, JSON.stringify(onVacation));
  assert.equal(onVacation.active, false);

  // A plain guard must not be able to edit another user's record (the rule folds
  // into the lookup, so a mismatch reads as 404 - see the swap test).
  const nosyToken = await login('sleep.nosy@example.com', 'testpass123');
  const { status: forbidden } = await api(`/api/collections/users/records/${driver.id}`, {
    method: 'PATCH',
    token: nosyToken,
    body: { min_sleep_hours: 0 },
  });
  assert.equal(forbidden, 404);

  // The widened rule must NOT let a commander escalate privileges: `role` is
  // superuser-only (not on the commander allowlist), enforced by the update
  // hook (403, not 200).
  const { status: roleEscalation } = await api(`/api/collections/users/records/${driver.id}`, {
    method: 'PATCH',
    token: commanderToken,
    body: { role: 'commander' },
  });
  assert.equal(roleEscalation, 403); // ForbiddenError from the update hook
  const { json: stillGuard } = await api(`/api/collections/users/records/${driver.id}`, { token: commanderToken });
  assert.equal(stillGuard.role, 'guard');

  // Nor may a guard self-promote by editing their own record.
  const { status: selfPromote } = await api(`/api/collections/users/records/${nosy.id}`, {
    method: 'PATCH',
    token: nosyToken,
    body: { role: 'commander' },
  });
  assert.equal(selfPromote, 403);

  // A commander editing another user may ONLY touch min_sleep_hours - not the
  // password (which would be an account takeover, since PocketBase doesn't
  // require the old password for an authorized cross-user update) nor the email.
  const { status: pwTakeover } = await api(`/api/collections/users/records/${driver.id}`, {
    method: 'PATCH',
    token: commanderToken,
    body: { password: 'hijacked12345', passwordConfirm: 'hijacked12345' },
  });
  assert.equal(pwTakeover, 403);
  // The driver's original password still works (the takeover was blocked).
  const driverToken = await login('sleep.driver@example.com', 'testpass123');
  assert.ok(driverToken);

  const { status: emailChange } = await api(`/api/collections/users/records/${driver.id}`, {
    method: 'PATCH',
    token: commanderToken,
    body: { email: 'attacker@example.com' },
  });
  assert.equal(emailChange, 403);
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
      positions: [],
      created_by: 'anything',
    },
  });
  assert.equal(status, 400);
});

test('a guard cannot create a position (commander-only createRule), but can list them', { skip: !HAS_PB }, async () => {
  await signup('guard.pos.test@example.com', 'testpass123', 'Guard Pos Test');
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
    const { status: promoteStatus } = await api(`/api/collections/users/records/${guardIds.get(commanderName)}`, {
      method: 'PATCH',
      token: adminToken,
      body: { role: 'commander' },
    });
    assert.equal(promoteStatus, 200);
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
  await api(`/api/collections/users/records/${guardIds.get('Erez')}`, {
    method: 'PATCH',
    token: adminToken,
    body: { role: 'commander' },
  });
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
  // Patrol is one continuous 22:00->06:00 block per night, not eight hourly rows.
  assert.equal(plannedShifts.filter((s) => s.position === patrol.id).length, 1);

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
  assert.equal(stored.items.length, 1);
  const patrolBlock = stored.items[0];
  assert.equal(new Date(patrolBlock.start).getHours(), 22);
  assert.equal(new Date(patrolBlock.end).getHours(), 6);
  assert.equal((new Date(patrolBlock.end).getTime() - new Date(patrolBlock.start).getTime()) / (3600 * 1000), 8);
});

// A position with headcount 2 must persist two distinct-guard rows per slot -
// round-tripped through the real collections, not just planned in memory.
test('a headcount-2 position persists two distinct guards per slot', { skip: !HAS_PB }, async () => {
  const guardNames = ['Hila', 'Ivan', 'Jord'];
  const guardIds = new Map();
  for (const name of guardNames) {
    const record = await signup(`${name.toLowerCase()}.hc2@example.com`, 'testpass123', name);
    guardIds.set(name, record.id);
  }

  const adminToken = await loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);
  await api(`/api/collections/users/records/${guardIds.get('Hila')}`, {
    method: 'PATCH',
    token: adminToken,
    body: { role: 'commander' },
  });
  const commanderToken = await login('hila.hc2@example.com', 'testpass123');

  const post = await createPosition(commanderToken, { name: 'Double (hc2)', active: true, headcount: 2 });

  const start = new Date(2027, 8, 1, 0, 0, 0).getTime();
  const end = start + 3 * 3600 * 1000; // 3 one-hour slots

  const plannedShifts = generateShifts({
    start,
    end,
    shiftMinutes: 60,
    positions: [{ id: post.id, name: post.name, headcount: 2 }],
    guards: guardNames,
  });
  assert.equal(plannedShifts.length, 6); // 3 slots x 2 seats

  const { json: schedule } = await api('/api/collections/schedules/records', {
    method: 'POST',
    token: commanderToken,
    body: {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      shift_minutes: 60,
      positions: [post.id],
      created_by: guardIds.get('Hila'),
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
    `/api/collections/shifts/records?filter=${encodeURIComponent(`schedule = "${schedule.id}"`)}&perPage=100`,
    { token: commanderToken },
  );
  assert.equal(stored.items.length, 6);
  const bySlot = new Map();
  for (const item of stored.items) {
    const key = new Date(item.start).getTime();
    if (!bySlot.has(key)) bySlot.set(key, new Set());
    bySlot.get(key).add(item.guard);
  }
  assert.equal(bySlot.size, 3);
  for (const guardsInSlot of bySlot.values()) {
    assert.equal(guardsInSlot.size, 2); // two different guards on the same slot
  }
});
