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
    e.record.set('approved', false);
  }
  e.next();
}, 'users');

// Privilege guard on update. The users updateRule lets a commander edit other
// users and lets a user edit their own record. Protections for non-superusers:
//   - Editing SOMEONE ELSE'S record (only commanders reach here, per the rule):
//     commanders may manage account state, vacation dates, and sleep needs.
//     Everything else is rejected - notably `role` (promotion is
//     superuser-only) and `password`
//     (PocketBase doesn't require the old password for an authorized cross-user
//     update, so without this a commander could reset a guard's password and
//     take over the account) and `email`.
//   - Editing your OWN record: you may change your name/password, but not your
//     privilege fields - only a superuser sets `role`, and `active` is a
//     commander/superuser call (you can't self-reactivate a disabled account).
onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const editingSomeoneElse = !e.auth || e.auth.id !== e.record.id;
    if (editingSomeoneElse) {
      // Hook callbacks execute in an isolated JS runtime, so this allowlist
      // must live inside the callback rather than in module scope.
      const commanderEditable = new Set([
        'active',
        'approved',
        'min_sleep_hours',
        'vacation_start',
        'vacation_end',
      ]);
      const body = e.requestInfo().body || {};
      for (const field of Object.keys(body)) {
        if (!commanderEditable.has(field)) {
          throw new ForbiddenError('Commanders may only manage account status, vacation, or sleep settings.');
        }
      }
    } else {
      const original = e.record.original();
      if (e.record.get('role') !== original.get('role')) {
        throw new ForbiddenError("Only a superuser can change a user's role.");
      }
      if (e.record.get('active') !== original.get('active')) {
        throw new ForbiddenError("Only a commander or superuser can change a user's active status.");
      }
      if (e.record.get('approved') !== original.get('approved')) {
        throw new ForbiddenError("Only a commander or superuser can approve a user.");
      }
    }
  }
  e.next();
}, 'users');
