/// <reference path="../pb_data/types.d.ts" />

// Signup is open (see the "users" createRule migration) since only hotspot
// clients can reach the server at all - but every self-signed-up account must
// land as a plain guard. Only the superuser (Admin UI) promotes commanders.
onRecordCreateRequest((e) => {
  e.record.set('role', 'guard');
  e.record.set('active', true);
  e.next();
}, 'users');
