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
// their own record, but neither may touch the privilege fields: only the
// superuser (Admin UI) may change a user's `role` or `active`. Without this a
// commander (or a self-editing guard) could promote themselves to commander or
// reactivate a disabled account through the normal users API. (Password/email
// are already protected by PocketBase's own oldPassword/verification checks.)
onRecordUpdateRequest((e) => {
  const isSuperuser = !!e.auth && e.auth.collection().name === '_superusers';
  if (!isSuperuser) {
    const original = e.record.original();
    if (e.record.get('role') !== original.get('role')) {
      throw new ForbiddenError("Only a superuser can change a user's role.");
    }
    if (e.record.get('active') !== original.get('active')) {
      throw new ForbiddenError("Only a superuser can change a user's active status.");
    }
  }
  e.next();
}, 'users');
