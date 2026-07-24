/// <reference path="../pb_data/types.d.ts" />

// Signup is open (see the "users" createRule migration) since only hotspot
// clients can reach the server at all - but every self-signed-up account must
// land as a plain guard. Only the superuser (Admin UI) promotes commanders.
onRecordCreateRequest((e) => {
  e.record.set('role', 'guard');
  e.record.set('active', true);
  e.next();
}, 'users');

// Privilege guard on update. The users updateRule lets a commander edit other
// users (needed to set min_sleep_hours - see 1700000009) and lets a user edit
// their own record. Two protections:
//   1. `role`/`active` are superuser-only, even on your own record - otherwise a
//      commander (or a self-editing guard) could self-promote or reactivate a
//      disabled account through the normal users API.
//   2. When editing SOMEONE ELSE'S record (only commanders can, per the rule),
//      the only field allowed to change is `min_sleep_hours`. Without this a
//      commander could PATCH another user's `password` and take over the account
//      (PocketBase doesn't require the old password when an authorized user
//      updates a different record), or change their email/verified state.
onRecordUpdateRequest((e) => {
  const info = e.requestInfo();
  if (!info.hasSuperuserAuth()) {
    const original = e.record.original();
    if (e.record.get('role') !== original.get('role')) {
      throw new ForbiddenError("Only a superuser can change a user's role.");
    }
    if (e.record.get('active') !== original.get('active')) {
      throw new ForbiddenError("Only a superuser can change a user's active status.");
    }

    const editingSomeoneElse = !e.auth || e.auth.id !== e.record.id;
    if (editingSomeoneElse) {
      const body = info.body || {};
      for (const field of Object.keys(body)) {
        if (field !== 'min_sleep_hours') {
          throw new ForbiddenError('Commanders may only change min_sleep_hours on other users.');
        }
      }
    }
  }
  e.next();
}, 'users');
