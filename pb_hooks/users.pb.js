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
// users and lets a user edit their own record. Protections for non-superusers:
//   - Editing SOMEONE ELSE'S record (only commanders reach here, per the rule):
//     the only fields allowed to change are `min_sleep_hours` and `active` (the
//     latter is how a commander marks a person on vacation). Everything else is
//     rejected - notably `role` (promotion is superuser-only) and `password`
//     (PocketBase doesn't require the old password for an authorized cross-user
//     update, so without this a commander could reset a guard's password and
//     take over the account) and `email`.
//   - Editing your OWN record: you may change your name/password, but not your
//     privilege fields - only a superuser sets `role`, and `active` is a
//     commander/superuser call (you can't self-reactivate a disabled account).
const COMMANDER_EDITABLE_ON_OTHERS = new Set(['min_sleep_hours', 'active']);
onRecordUpdateRequest((e) => {
  const info = e.requestInfo();
  if (!info.hasSuperuserAuth()) {
    const editingSomeoneElse = !e.auth || e.auth.id !== e.record.id;
    if (editingSomeoneElse) {
      for (const field of Object.keys(info.body || {})) {
        if (!COMMANDER_EDITABLE_ON_OTHERS.has(field)) {
          throw new ForbiddenError('Commanders may only change min_sleep_hours or active on other users.');
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
    }
  }
  e.next();
}, 'users');
