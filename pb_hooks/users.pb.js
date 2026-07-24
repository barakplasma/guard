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
// users (to set min_sleep_hours / toggle `active` for vacation) and lets a user
// edit their own record. Protections for non-superusers, using only the
// original-vs-new field comparison (no request-body introspection):
//   - `role` is superuser-only, always (nobody self-promotes to commander).
//   - Editing SOMEONE ELSE's record (only commanders reach here, per the rule):
//     `email` may not change. A cross-user `password` reset is already blocked
//     by PocketBase itself - the users collection has no manageRule, so only a
//     superuser can set another account's password without its old one - so a
//     commander is left with just min_sleep_hours and active, which is intended.
//   - Editing your OWN record: you may change your name/password, but not
//     `active` (you can't self-reactivate a disabled account).
onRecordUpdateRequest((e) => {
  const isSuperuser = !!e.auth && e.auth.collection().name === '_superusers';
  if (!isSuperuser) {
    const original = e.record.original();
    if (e.record.get('role') !== original.get('role')) {
      throw new ForbiddenError("Only a superuser can change a user's role.");
    }
    const editingSomeoneElse = !e.auth || e.auth.id !== e.record.id;
    if (editingSomeoneElse) {
      if (e.record.get('email') !== original.get('email')) {
        throw new ForbiddenError("A commander cannot change another user's email.");
      }
    } else if (e.record.get('active') !== original.get('active')) {
      throw new ForbiddenError("Only a commander or superuser can change a user's active status.");
    }
  }
  e.next();
}, 'users');
