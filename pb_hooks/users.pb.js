/// <reference path="../pb_data/types.d.ts" />

// Signup is open (see the "users" createRule migration) since the app is now
// reachable over the public internet with no Cloudflare Access restriction -
// every self-signed-up account must land as an inactive plain guard, pending
// a commander's approval. The users collection's authRule ("active = true",
// see 1700000008_users_approval_gate.js) means a pending account literally
// cannot log in yet, not just that it's flagged.
onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    e.record.set('role', 'guard');
    e.record.set('active', false);
  }
  e.next();
}, 'users');

// Approval gate: only a commander (or the superuser, e.g. via the Admin UI /
// scripted account provisioning) may activate a pending account or change
// anyone's role. Needed because the users updateRule ("id = @request.auth.id")
// only checks identity, not which fields change - without this, any guard
// could flip their own active/role field.
onRecordUpdateRequest((e) => {
  const activeChanged = e.record.get('active') !== e.record.original().get('active');
  const roleChanged = e.record.get('role') !== e.record.original().get('role');

  if (
    (activeChanged || roleChanged) &&
    !e.hasSuperuserAuth() &&
    (!e.auth || e.auth.get('role') !== 'commander')
  ) {
    throw new ForbiddenError('Only a commander can approve accounts or change roles.');
  }

  e.next();
}, 'users');
